/*
 * Budget backend seam (Phase 13).
 *
 * Native shell: every call is a Rust command (src-tauri/src/budget/) — the
 * governor there is the enforcement boundary; the webview only renders its
 * verdicts. Plain browser (Vite preview / e2e): the same contract is served
 * from memory + localStorage using budget/core.ts, which mirrors the Rust
 * math so the UI behaves identically. Either way the UI never decides whether
 * a call may spend — it asks.
 */
import { isTauri } from '@/lib/tauri';

import {
  applySpend,
  breakdown as breakdownOf,
  checkPreCall,
  countersFrom,
  deriveState,
  evaluateTrip,
  filterEvents,
  lastResetAt,
  newSpendId,
  overviewFrom,
  periodNow,
  seriesFor,
  sortEvents,
  totalCost,
  type Counters,
} from './core';
import { round6 } from './models';
import { DAY_MS, localDayStart, type Period } from './period';
import { seedEvents, SEED_VERSION } from './seed';
import {
  DEFAULT_BUDGET_SETTINGS,
  type BreakdownBy,
  type BreakdownRow,
  type BudgetOverview,
  type BudgetSettings,
  type BudgetSettingsPatch,
  type PauseReason,
  type PreCallCheck,
  type PreCallRequest,
  type SeriesBucket,
  type SpendEvent,
  type SpendFilter,
  type SpendInput,
  type SpendPage,
  type SpendRange,
  type SpendSort,
  type StateChange,
} from './types';

export interface RecordResult {
  event: SpendEvent;
  overview: BudgetOverview;
  /** The breaker tripped on this spend (the backend already paused). */
  tripped: Extract<PauseReason, 'threshold' | 'spike'> | null;
}

export interface BudgetEvents {
  onStateChange?: (change: StateChange) => void;
  onSpend?: (event: SpendEvent) => void;
  onSettings?: (settings: BudgetSettings) => void;
}

export interface BudgetBackend {
  /** First call per session: tells the governor the webview's UTC offset. */
  init(tzOffsetMin: number): Promise<BudgetOverview>;
  overview(): Promise<BudgetOverview>;
  /** The gate. Records `blocked` / `downshifted` events and trips pauses. */
  check(req: PreCallRequest): Promise<PreCallCheck>;
  record(input: SpendInput): Promise<RecordResult>;
  listEvents(
    filter: SpendFilter,
    sort: SpendSort,
    cursor: string | null,
    limit: number
  ): Promise<SpendPage>;
  series(range: SpendRange): Promise<SeriesBucket[]>;
  breakdown(by: BreakdownBy, range: SpendRange): Promise<BreakdownRow[]>;
  updateSettings(patch: BudgetSettingsPatch): Promise<BudgetSettings>;
  setPaused(
    paused: boolean,
    reason: PauseReason | null
  ): Promise<BudgetSettings>;
  resetMonth(): Promise<BudgetOverview>;
  /** Everything gone (settings + events). Used by "Reset all" and tests. */
  clearAll(): Promise<BudgetOverview>;
  exportEvents(range: SpendRange): Promise<SpendEvent[]>;
  saveExport(
    filename: string,
    text: string,
    mime: string
  ): Promise<{ saved: boolean; path: string | null }>;
  subscribe(handlers: BudgetEvents): Promise<() => void>;
}

// ─── Browser backend ───────────────────────────────────────────────────────

const LS = {
  settings: 'xr.budget.settings',
  events: 'xr.budget.events',
  seeded: 'xr.budget.seeded',
} as const;

const EVENT_CAP = 5000;
const DOM_EVENT = 'xr-budget';

function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — memory copy still serves this session */
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : fallback;
}

function capsOf(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

function strList(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : fallback;
}

/** Clamp a settings patch into the ranges the sliders promise. */
export function coerceSettings(value: unknown): BudgetSettings {
  const d = DEFAULT_BUDGET_SETTINGS;
  if (typeof value !== 'object' || value === null) return { ...d };
  const v = value as Partial<Record<keyof BudgetSettings, unknown>>;
  const reason = v.pauseReason;
  return {
    monthlyLimit: num(v.monthlyLimit, d.monthlyLimit, 0, 100_000),
    hardCap: typeof v.hardCap === 'boolean' ? v.hardCap : d.hardCap,
    circuitBreakerPct: num(v.circuitBreakerPct, d.circuitBreakerPct, 0.5, 1),
    circuitBreakerSpendPer5min: num(
      v.circuitBreakerSpendPer5min,
      d.circuitBreakerSpendPer5min,
      0,
      1000
    ),
    modelDownshifting:
      typeof v.modelDownshifting === 'boolean'
        ? v.modelDownshifting
        : d.modelDownshifting,
    finalizationReservePct: num(
      v.finalizationReservePct,
      d.finalizationReservePct,
      0,
      0.2
    ),
    dailyLimit: num(v.dailyLimit, d.dailyLimit, 0, 100_000),
    perRequestLimit: num(v.perRequestLimit, d.perRequestLimit, 0, 1000),
    notifyWarnPct: num(v.notifyWarnPct, d.notifyWarnPct, 0.5, 1),
    notifyOs: typeof v.notifyOs === 'boolean' ? v.notifyOs : d.notifyOs,
    notifyToast:
      typeof v.notifyToast === 'boolean' ? v.notifyToast : d.notifyToast,
    billingTier: v.billingTier === 'pro' ? 'pro' : 'personal',
    perAgentCaps: capsOf(v.perAgentCaps),
    perWorkspaceCaps: capsOf(v.perWorkspaceCaps),
    monthStartDay: Math.round(num(v.monthStartDay, d.monthStartDay, 1, 28)),
    paused: typeof v.paused === 'boolean' ? v.paused : false,
    pauseReason:
      reason === 'manual' ||
      reason === 'threshold' ||
      reason === 'spike' ||
      reason === 'emergency'
        ? reason
        : null,
    pausedAt: typeof v.pausedAt === 'number' ? v.pausedAt : null,
    configuredModels: strList(v.configuredModels, d.configuredModels),
    installedLocal: strList(v.installedLocal, d.installedLocal),
    defaultModel:
      typeof v.defaultModel === 'string' ? v.defaultModel : d.defaultModel,
  };
}

interface DomPayload {
  type: 'state-change' | 'spend' | 'settings';
  payload: unknown;
}

function emitDom(type: DomPayload['type'], payload: unknown): void {
  window.dispatchEvent(
    new CustomEvent<DomPayload>(DOM_EVENT, { detail: { type, payload } })
  );
}

class BrowserBackend implements BudgetBackend {
  private settings: BudgetSettings;
  private events: SpendEvent[];
  private tz = 0;
  private counters: Counters | null = null;
  private period: Period | null = null;

  constructor() {
    this.settings = coerceSettings(readJSON(LS.settings));
    this.events = (readJSON<SpendEvent[]>(LS.events) ?? []).filter(
      (e) => typeof e?.id === 'string' && typeof e.ts === 'number'
    );
  }

  private persist(): void {
    writeJSON(LS.settings, this.settings);
    writeJSON(LS.events, this.events.slice(-EVENT_CAP));
  }

  /** Counters follow the local day / period; rebuild when either rolls. */
  private fresh(now: number): { c: Counters; p: Period } {
    const p = periodNow(
      this.settings,
      now,
      this.tz,
      lastResetAt(this.events, now)
    );
    const dayStart = localDayStart(now, this.tz);
    if (
      !this.counters ||
      !this.period ||
      this.period.start !== p.start ||
      this.counters.dayStart !== dayStart
    ) {
      this.period = p;
      this.counters = countersFrom(this.events, p, now, this.tz);
    } else {
      this.period = p;
    }
    return { c: this.counters, p: this.period };
  }

  private invalidate(): void {
    this.counters = null;
  }

  private overviewNow(now = Date.now()): BudgetOverview {
    const { c, p } = this.fresh(now);
    return overviewFrom(this.settings, c, p, now);
  }

  private push(input: SpendInput, now: number): SpendEvent {
    const e: SpendEvent = {
      id: newSpendId(),
      ts: input.ts ?? now,
      kind: input.kind,
      agent: input.agent ?? null,
      workspace: input.workspace ?? null,
      sessionId: input.sessionId ?? null,
      model: input.model ?? null,
      tokensIn: Math.max(0, Math.floor(input.tokensIn ?? 0)),
      tokensOut: Math.max(0, Math.floor(input.tokensOut ?? 0)),
      costUsd: round6(Math.max(0, input.costUsd)),
      category: input.category ?? 'llm',
      detail: input.detail ?? null,
    };
    this.events.push(e);
    if (this.events.length > EVENT_CAP)
      this.events = this.events.slice(-EVENT_CAP);
    const { c } = this.fresh(now);
    applySpend(c, e, now);
    emitDom('spend', e);
    return e;
  }

  private transition(
    prevState: BudgetOverview['state'],
    reason: string,
    now: number
  ): void {
    const next = deriveState(this.settings, this.fresh(now).c);
    if (next !== prevState) {
      emitDom('state-change', {
        prev: prevState,
        next,
        reason,
        at: now,
      } satisfies StateChange);
    }
  }

  private pause(reason: PauseReason, now: number, note: string): void {
    this.settings = {
      ...this.settings,
      paused: true,
      pauseReason: reason,
      pausedAt: now,
    };
    this.push(
      { kind: 'paused', costUsd: 0, detail: { reason, note }, ts: now },
      now
    );
    emitDom('settings', this.settings);
  }

  async init(tzOffsetMin: number): Promise<BudgetOverview> {
    this.tz = tzOffsetMin;
    this.invalidate();
    const seeded = readJSON<number>(LS.seeded);
    if (seeded !== SEED_VERSION && this.events.length === 0) {
      this.events = seedEvents(Date.now(), tzOffsetMin);
      writeJSON(LS.seeded, SEED_VERSION);
      this.persist();
    }
    return this.overviewNow();
  }

  async overview(): Promise<BudgetOverview> {
    return this.overviewNow();
  }

  async check(req: PreCallRequest): Promise<PreCallCheck> {
    const now = Date.now();
    const { c, p } = this.fresh(now);
    const prev = deriveState(this.settings, c);
    const result = checkPreCall(this.settings, c, req, {
      now,
      resetDate: p.resetDate,
    });
    const base = {
      agent: req.agent ?? null,
      workspace: req.workspace ?? null,
      sessionId: req.sessionId ?? null,
      category: 'llm' as const,
      ts: now,
    };
    if (!result.allowed) {
      this.push(
        {
          ...base,
          kind: 'blocked',
          model: req.model,
          costUsd: 0,
          detail: {
            code: result.code,
            estimatedCost: result.estimatedCost,
            surface: req.surface,
            reason: result.reason,
          },
        },
        now
      );
      if (result.code === 'spike')
        this.pause('spike', now, result.reason ?? 'spike');
    } else if (result.downgradedToModel) {
      this.push(
        {
          ...base,
          kind: 'downshifted',
          model: result.downgradedToModel,
          costUsd: 0,
          detail: {
            from: req.model,
            to: result.downgradedToModel,
            why: result.downshiftWhy,
            surface: req.surface,
          },
        },
        now
      );
    }
    this.persist();
    this.transition(
      prev,
      result.allowed ? 'check' : `blocked:${result.code}`,
      now
    );
    return result;
  }

  async record(input: SpendInput): Promise<RecordResult> {
    const now = Date.now();
    const { c } = this.fresh(now);
    const prev = deriveState(this.settings, c);
    const event = this.push(input, now);
    const trip = evaluateTrip(this.settings, c, now);
    if (trip)
      this.pause(
        trip,
        now,
        trip === 'spike' ? 'Spending spike' : 'Circuit breaker threshold'
      );
    this.persist();
    this.transition(prev, trip ? `breaker:${trip}` : 'spend', now);
    return { event, overview: this.overviewNow(now), tripped: trip };
  }

  async listEvents(
    filter: SpendFilter,
    sort: SpendSort,
    cursor: string | null,
    limit: number
  ): Promise<SpendPage> {
    const now = Date.now();
    const filtered = sortEvents(filterEvents(this.events, filter, now), sort);
    const offset = cursor ? Number(cursor) || 0 : 0;
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      events: page,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      total: filtered.length,
      totalCost: totalCost(filtered),
    };
  }

  async series(range: SpendRange): Promise<SeriesBucket[]> {
    return seriesFor(this.events, range, Date.now(), this.tz);
  }

  async breakdown(by: BreakdownBy, range: SpendRange): Promise<BreakdownRow[]> {
    return breakdownOf(this.events, by, range, Date.now());
  }

  async updateSettings(patch: BudgetSettingsPatch): Promise<BudgetSettings> {
    const now = Date.now();
    const prevSettings = this.settings;
    const prev = deriveState(prevSettings, this.fresh(now).c);
    const next = coerceSettings({ ...prevSettings, ...patch });
    this.settings = next;
    const limitChanged =
      next.monthlyLimit !== prevSettings.monthlyLimit ||
      next.dailyLimit !== prevSettings.dailyLimit ||
      next.perRequestLimit !== prevSettings.perRequestLimit ||
      next.hardCap !== prevSettings.hardCap;
    if (limitChanged) {
      this.push(
        {
          kind: 'cap_set',
          costUsd: 0,
          detail: {
            monthlyLimit: next.monthlyLimit,
            dailyLimit: next.dailyLimit,
            perRequestLimit: next.perRequestLimit,
            hardCap: next.hardCap,
          },
          ts: now,
        },
        now
      );
    }
    if (next.monthStartDay !== prevSettings.monthStartDay) this.invalidate();
    this.persist();
    emitDom('settings', this.settings);
    this.transition(prev, 'settings', now);
    return this.settings;
  }

  async setPaused(
    paused: boolean,
    reason: PauseReason | null
  ): Promise<BudgetSettings> {
    const now = Date.now();
    const prev = deriveState(this.settings, this.fresh(now).c);
    if (paused) {
      this.pause(reason ?? 'manual', now, 'Paused by user');
    } else {
      this.settings = {
        ...this.settings,
        paused: false,
        pauseReason: null,
        pausedAt: null,
      };
      this.push(
        { kind: 'resumed', costUsd: 0, detail: { from: reason }, ts: now },
        now
      );
      emitDom('settings', this.settings);
    }
    this.persist();
    this.transition(
      prev,
      paused ? `paused:${reason ?? 'manual'}` : 'resumed',
      now
    );
    return this.settings;
  }

  async resetMonth(): Promise<BudgetOverview> {
    const now = Date.now();
    const prev = deriveState(this.settings, this.fresh(now).c);
    const spent = this.fresh(now).c.spentMonth;
    this.push(
      { kind: 'reset', costUsd: 0, detail: { spentBefore: spent }, ts: now },
      now
    );
    this.invalidate();
    this.persist();
    this.transition(prev, 'reset', now);
    return this.overviewNow(now);
  }

  async clearAll(): Promise<BudgetOverview> {
    const now = Date.now();
    const prev = deriveState(this.settings, this.fresh(now).c);
    this.events = [];
    this.settings = { ...DEFAULT_BUDGET_SETTINGS };
    this.invalidate();
    this.persist();
    writeJSON(LS.seeded, SEED_VERSION); // a cleared install stays empty
    emitDom('settings', this.settings);
    this.transition(prev, 'cleared', now);
    return this.overviewNow(now);
  }

  async exportEvents(range: SpendRange): Promise<SpendEvent[]> {
    const now = Date.now();
    const start =
      range === 'all'
        ? 0
        : now - (range === '24h' ? 1 : range === '7d' ? 7 : 30) * DAY_MS;
    return this.events.filter((e) => e.ts >= start).sort((a, b) => a.ts - b.ts);
  }

  async saveExport(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { saved: true, path: null };
  }

  async subscribe(handlers: BudgetEvents): Promise<() => void> {
    const onDom = (ev: Event): void => {
      const { type, payload } = (ev as CustomEvent<DomPayload>).detail;
      if (type === 'state-change')
        handlers.onStateChange?.(payload as StateChange);
      else if (type === 'spend') handlers.onSpend?.(payload as SpendEvent);
      else handlers.onSettings?.(payload as BudgetSettings);
    };
    window.addEventListener(DOM_EVENT, onDom);
    return () => window.removeEventListener(DOM_EVENT, onDom);
  }
}

// ─── Tauri backend ─────────────────────────────────────────────────────────

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

class TauriBackend implements BudgetBackend {
  init(tzOffsetMin: number): Promise<BudgetOverview> {
    return invoke<BudgetOverview>('budget_init', { tzOffsetMin });
  }
  overview(): Promise<BudgetOverview> {
    return invoke<BudgetOverview>('budget_overview');
  }
  check(req: PreCallRequest): Promise<PreCallCheck> {
    return invoke<PreCallCheck>('budget_check', { req });
  }
  record(input: SpendInput): Promise<RecordResult> {
    return invoke<RecordResult>('budget_record', { input });
  }
  listEvents(
    filter: SpendFilter,
    sort: SpendSort,
    cursor: string | null,
    limit: number
  ) {
    return invoke<SpendPage>('budget_events', { filter, sort, cursor, limit });
  }
  series(range: SpendRange): Promise<SeriesBucket[]> {
    return invoke<SeriesBucket[]>('budget_series', { range });
  }
  breakdown(by: BreakdownBy, range: SpendRange): Promise<BreakdownRow[]> {
    return invoke<BreakdownRow[]>('budget_breakdown', { by, range });
  }
  updateSettings(patch: BudgetSettingsPatch): Promise<BudgetSettings> {
    return invoke<BudgetSettings>('budget_update_settings', { patch });
  }
  setPaused(
    paused: boolean,
    reason: PauseReason | null
  ): Promise<BudgetSettings> {
    return invoke<BudgetSettings>('budget_set_paused', { paused, reason });
  }
  resetMonth(): Promise<BudgetOverview> {
    return invoke<BudgetOverview>('budget_reset_month');
  }
  clearAll(): Promise<BudgetOverview> {
    return invoke<BudgetOverview>('budget_clear');
  }
  exportEvents(range: SpendRange): Promise<SpendEvent[]> {
    return invoke<SpendEvent[]>('budget_export', { range });
  }
  async saveExport(filename: string, text: string) {
    // Same Rust save dialog Phase 11/12 use (filename-agnostic).
    const target = await invoke<string | null>('save_runs_export', {
      filename,
      contents: text,
    });
    return target
      ? { saved: true, path: target }
      : { saved: false, path: null };
  }
  async subscribe(handlers: BudgetEvents): Promise<() => void> {
    const { listen } = await import('@tauri-apps/api/event');
    const offs = await Promise.all([
      listen<StateChange>('budget:state-change', (e) =>
        handlers.onStateChange?.(e.payload)
      ),
      listen<SpendEvent>('budget:spend', (e) => handlers.onSpend?.(e.payload)),
      listen<BudgetSettings>('budget:settings', (e) =>
        handlers.onSettings?.(e.payload)
      ),
    ]);
    return () => offs.forEach((off) => off());
  }
}

let backend: BudgetBackend | null = null;

export function budgetBackend(): BudgetBackend {
  if (!backend) backend = isTauri() ? new TauriBackend() : new BrowserBackend();
  return backend;
}

/** Test/e2e seam: swap the backend (browser only). */
export function setBudgetBackend(next: BudgetBackend | null): void {
  backend = next;
}
