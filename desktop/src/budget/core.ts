/*
 * Budget governor — pure functions (Phase 13). This file is the browser
 * mirror of src-tauri/src/budget/governor.rs: same order of checks, same
 * epsilon, same arithmetic, so both backends return the same verdicts for the
 * same inputs (shared vectors in test/desktop/budget-core.test.ts).
 *
 * Nothing here talks to a store or a backend; everything takes `now`.
 */
import {
  estimateCost,
  isLocalModel,
  modelInfo,
  modelLabel,
  MODEL_REGISTRY,
  round6,
} from './models';
import {
  DAY_MS,
  HOUR_MS,
  localDayIndex,
  periodFor,
  shortDate,
  shortDayLabel,
  type Period,
} from './period';
import {
  CATEGORY_LABEL,
  SPEND_CATEGORIES,
  type BreakdownBy,
  type BreakdownRow,
  type BudgetOverview,
  type BudgetSettings,
  type BudgetStateId,
  type PauseReason,
  type PreCallCheck,
  type PreCallCode,
  type PreCallRequest,
  type SeriesBucket,
  type SpendCategory,
  type SpendEvent,
  type SpendFilter,
  type SpendKind,
  type SpendRange,
  type SpendSort,
} from './types';

/** A user with a $5.00 limit is not blocked at $4.99996; $5.02 does trip. */
export const EPS = 0.0001;
export const SPIKE_WINDOW_MS = 5 * 60_000;
/** Bar turns red here; state `danger`. */
export const DANGER_PCT = 0.85;

export const SPEND_KINDS: readonly SpendKind[] = [
  'llm_call',
  'tool_call',
  'voice',
  'compute',
];

export function isSpendKind(kind: SpendKind): boolean {
  return SPEND_KINDS.includes(kind);
}

/* ── Counters ──────────────────────────────────────────────────────────── */

export interface RecentSpend {
  ts: number;
  cost: number;
}

/** In-memory running totals — what the Rust governor keeps for O(1) checks. */
export interface Counters {
  periodStart: number;
  dayStart: number;
  spentMonth: number;
  spentToday: number;
  tokensInMonth: number;
  tokensOutMonth: number;
  agentMonth: Record<string, number>;
  workspaceMonth: Record<string, number>;
  blockedMonth: number;
  downshiftedMonth: number;
  eventsTotal: number;
  biggest: {
    sessionId: string | null;
    costUsd: number;
    model: string | null;
  } | null;
  /** Spend inside the last SPIKE_WINDOW_MS (pruned on write). */
  recent: RecentSpend[];
}

export function emptyCounters(periodStart: number, dayStart: number): Counters {
  return {
    periodStart,
    dayStart,
    spentMonth: 0,
    spentToday: 0,
    tokensInMonth: 0,
    tokensOutMonth: 0,
    agentMonth: {},
    workspaceMonth: {},
    blockedMonth: 0,
    downshiftedMonth: 0,
    eventsTotal: 0,
    biggest: null,
    recent: [],
  };
}

/** Fold one event into the counters (in place) — same as Rust `apply`. */
export function applySpend(c: Counters, e: SpendEvent, now: number): Counters {
  c.eventsTotal += 1;
  if (e.kind === 'blocked') {
    if (e.ts >= c.periodStart) c.blockedMonth += 1;
    return c;
  }
  if (e.kind === 'downshifted') {
    if (e.ts >= c.periodStart) c.downshiftedMonth += 1;
    return c;
  }
  if (!isSpendKind(e.kind)) return c;
  const cost = round6(e.costUsd);
  if (e.ts >= c.periodStart) {
    c.spentMonth = round6(c.spentMonth + cost);
    c.tokensInMonth += e.tokensIn;
    c.tokensOutMonth += e.tokensOut;
    if (e.agent)
      c.agentMonth[e.agent] = round6((c.agentMonth[e.agent] ?? 0) + cost);
    if (e.workspace)
      c.workspaceMonth[e.workspace] = round6(
        (c.workspaceMonth[e.workspace] ?? 0) + cost
      );
    if (!c.biggest || cost > c.biggest.costUsd + EPS) {
      c.biggest = { sessionId: e.sessionId, costUsd: cost, model: e.model };
    }
  }
  if (e.ts >= c.dayStart) c.spentToday = round6(c.spentToday + cost);
  if (e.ts > now - SPIKE_WINDOW_MS) {
    c.recent.push({ ts: e.ts, cost });
    pruneRecent(c, now);
  }
  return c;
}

export function pruneRecent(c: Counters, now: number): void {
  const cutoff = now - SPIKE_WINDOW_MS;
  if (c.recent.length && c.recent[0].ts <= cutoff) {
    c.recent = c.recent.filter((r) => r.ts > cutoff);
  }
}

export function spikeSpend(c: Counters, now: number): number {
  const cutoff = now - SPIKE_WINDOW_MS;
  let sum = 0;
  for (const r of c.recent) if (r.ts > cutoff) sum += r.cost;
  return round6(sum);
}

/** Rebuild counters from a full event list (browser load / Rust startup). */
export function countersFrom(
  events: readonly SpendEvent[],
  period: Period,
  now: number,
  tzOffsetMin: number
): Counters {
  const dayStart =
    localDayIndex(now, tzOffsetMin) * DAY_MS + tzOffsetMin * 60_000;
  const c = emptyCounters(period.start, dayStart);
  const sorted = [...events].sort(
    (a, b) => a.ts - b.ts || a.id.localeCompare(b.id)
  );
  for (const e of sorted) applySpend(c, e, now);
  return c;
}

/** The most recent manual reset at or before `now` (moves the period start). */
export function lastResetAt(
  events: readonly SpendEvent[],
  now: number
): number | null {
  let at: number | null = null;
  for (const e of events) {
    if (e.kind === 'reset' && e.ts <= now && (at === null || e.ts > at))
      at = e.ts;
  }
  return at;
}

/* ── State ─────────────────────────────────────────────────────────────── */

export function usableLimit(s: BudgetSettings): number {
  return round6(s.monthlyLimit * (1 - s.finalizationReservePct));
}

export function reserveUsd(s: BudgetSettings): number {
  return round6(s.monthlyLimit - usableLimit(s));
}

export function deriveState(s: BudgetSettings, c: Counters): BudgetStateId {
  if (s.paused) return 'paused';
  if (s.monthlyLimit <= EPS) return 'local';
  const pct = c.spentMonth / s.monthlyLimit;
  if (s.hardCap) {
    if (c.spentMonth >= usableLimit(s) - EPS) return 'capped';
  } else if (c.spentMonth >= s.monthlyLimit - EPS) {
    return 'over';
  }
  if (pct >= DANGER_PCT - EPS) return 'danger';
  if (pct >= s.notifyWarnPct - EPS) return 'warn';
  return 'ok';
}

/** Should the breaker trip right now? (Only meaningful while not paused.) */
export function evaluateTrip(
  s: BudgetSettings,
  c: Counters,
  now: number
): Extract<PauseReason, 'threshold' | 'spike'> | null {
  if (s.paused) return null;
  if (s.hardCap && s.monthlyLimit > EPS) {
    if (c.spentMonth / s.monthlyLimit >= s.circuitBreakerPct - EPS)
      return 'threshold';
  }
  if (
    s.circuitBreakerSpendPer5min > EPS &&
    spikeSpend(c, now) > s.circuitBreakerSpendPer5min + EPS
  ) {
    return 'spike';
  }
  return null;
}

export const STATE_LABEL: Record<BudgetStateId, string> = {
  ok: 'Under limit',
  local: 'All local',
  warn: 'Near limit',
  danger: 'Near limit',
  capped: 'Limit reached',
  over: 'Over limit',
  paused: 'Paused',
};

/** Visual band for bars: green ≤ 60 %, amber 60–85 %, red above. */
export function barBand(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct >= DANGER_PCT - EPS) return 'danger';
  if (pct >= 0.6 - EPS) return 'warn';
  return 'ok';
}

/* ── Pre-call check ────────────────────────────────────────────────────── */

export interface CheckContext {
  now: number;
  /** For the repair path in the month-cap message. */
  resetDate?: string;
}

/** Models the governor may route to: configured cloud + installed local. */
export function availableModels(s: BudgetSettings): string[] {
  const ids = new Set<string>([...s.configuredModels, ...s.installedLocal]);
  return MODEL_REGISTRY.filter((m) => ids.has(m.id)).map((m) => m.id);
}

type CapCode = Extract<
  PreCallCode,
  'per-request' | 'month' | 'day' | 'agent' | 'workspace'
>;

interface Caps {
  /** Static cap for a single call (0 = off). */
  perRequest: number;
  /** Remaining for new work, by dimension (undefined = no cap). */
  remaining: Partial<Record<Exclude<CapCode, 'per-request'>, number>>;
}

function capsFor(s: BudgetSettings, c: Counters, req: PreCallRequest): Caps {
  const remaining: Caps['remaining'] = {};
  if (s.monthlyLimit > EPS) {
    const ceiling = req.finalization ? s.monthlyLimit : usableLimit(s);
    remaining.month = round6(ceiling - c.spentMonth);
  }
  if (s.dailyLimit > EPS) remaining.day = round6(s.dailyLimit - c.spentToday);
  const agentCap = req.agent ? s.perAgentCaps[req.agent] : undefined;
  if (req.agent && agentCap !== undefined && agentCap > EPS) {
    remaining.agent = round6(agentCap - (c.agentMonth[req.agent] ?? 0));
  }
  const wsCap = req.workspace ? s.perWorkspaceCaps[req.workspace] : undefined;
  if (req.workspace && wsCap !== undefined && wsCap > EPS) {
    remaining.workspace = round6(
      wsCap - (c.workspaceMonth[req.workspace] ?? 0)
    );
  }
  return {
    perRequest: s.perRequestLimit > EPS ? s.perRequestLimit : 0,
    remaining,
  };
}

const CAP_ORDER: Array<Exclude<CapCode, 'per-request'>> = [
  'month',
  'day',
  'agent',
  'workspace',
];

/** First violated dimension for a call of `cost`, in a fixed order. */
function firstViolation(caps: Caps, cost: number): CapCode | null {
  if (caps.perRequest > 0 && cost > caps.perRequest + EPS) return 'per-request';
  for (const code of CAP_ORDER) {
    const r = caps.remaining[code];
    if (r !== undefined && cost > r + EPS) return code;
  }
  return null;
}

function minRemaining(caps: Caps): number {
  let min = Number.POSITIVE_INFINITY;
  for (const code of CAP_ORDER) {
    const r = caps.remaining[code];
    if (r !== undefined && r < min) min = r;
  }
  return min;
}

const REGISTRY_INDEX = new Map(MODEL_REGISTRY.map((m, i) => [m.id, i]));

function registryOrder(a: string, b: string): number {
  return (REGISTRY_INDEX.get(a) ?? 999) - (REGISTRY_INDEX.get(b) ?? 999);
}

interface Candidate {
  model: string;
  cost: number;
}

function candidatesCheaperThan(
  s: BudgetSettings,
  from: string,
  tokensIn: number,
  tokensOut: number,
  localOnly: boolean
): Candidate[] {
  const fromCost = estimateCost(from, tokensIn, tokensOut);
  return availableModels(s)
    .filter((id) => id !== from)
    .filter((id) => !localOnly || isLocalModel(id))
    .map((id) => ({ model: id, cost: estimateCost(id, tokensIn, tokensOut) }))
    .filter((x) => x.cost < fromCost - EPS);
}

/**
 * Per-request / local-only downshift: keep as much capability as the caps
 * allow — the most expensive cheaper model that fits every cap.
 */
export function pickFittingDownshift(
  s: BudgetSettings,
  from: string,
  tokensIn: number,
  tokensOut: number,
  caps: Caps,
  localOnly: boolean
): Candidate | null {
  const cands = candidatesCheaperThan(
    s,
    from,
    tokensIn,
    tokensOut,
    localOnly
  ).sort((a, b) => b.cost - a.cost || registryOrder(a.model, b.model));
  for (const cand of cands) {
    if (firstViolation(caps, cand.cost) === null) return cand;
  }
  return null;
}

/**
 * Approach downshift ("Sonnet → Haiku → local"): once spend passes the warn
 * threshold, route to the cheapest cloud model (same provider first); past
 * DANGER_PCT, to the best installed local model. Never above the cap — the
 * cap check still runs afterwards.
 */
export function pickApproachDownshift(
  s: BudgetSettings,
  from: string,
  tokensIn: number,
  tokensOut: number,
  pct: number
): Candidate | null {
  if (isLocalModel(from)) return null;
  const cands = candidatesCheaperThan(s, from, tokensIn, tokensOut, false);
  if (cands.length === 0) return null;
  if (pct >= DANGER_PCT - EPS) {
    const locals = cands.filter((c) => isLocalModel(c.model));
    if (locals.length) {
      // Highest-quality installed local model (registry lists small → large).
      return locals.sort((a, b) => registryOrder(b.model, a.model))[0];
    }
  }
  const cloud = cands.filter((c) => !isLocalModel(c.model));
  if (cloud.length === 0) return null;
  const provider = modelInfo(from).provider;
  const same = cloud.filter((c) => modelInfo(c.model).provider === provider);
  const pool = same.length ? same : cloud;
  return pool.sort(
    (a, b) => a.cost - b.cost || registryOrder(a.model, b.model)
  )[0];
}

export function fmtUsd(
  n: number,
  opts: { compact?: boolean; precise?: boolean } = {}
): string {
  const abs = Math.abs(n);
  // compact: whole dollars drop the cents ("$5", "$100"); otherwise 2 dp.
  const digits =
    opts.precise || (abs > 0 && abs < 0.01)
      ? 4
      : opts.compact && (abs >= 100 || Number.isInteger(n))
        ? 0
        : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function fmtTokens(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function pauseReasonText(reason: PauseReason | null): string {
  switch (reason) {
    case 'threshold':
      return 'Spending auto-paused at the circuit-breaker threshold. Resume under Budget, or raise the limit.';
    case 'spike':
      return 'Spending paused — an unusual spike was detected. Review Spend History, then resume if it looks right.';
    case 'emergency':
      return 'Spending is paused by the emergency stop. Resume under Budget to continue.';
    default:
      return 'Spending is paused. Resume under Budget to continue.';
  }
}

function denialText(
  code: PreCallCode,
  s: BudgetSettings,
  c: Counters,
  req: PreCallRequest,
  cost: number,
  ctx: CheckContext
): string {
  switch (code) {
    case 'paused':
      return pauseReasonText(s.pauseReason);
    case 'per-request':
      return `This call would cost about ${fmtUsd(cost, { precise: true })}, more than your per-request limit of ${fmtUsd(s.perRequestLimit)}. Use a cheaper model or raise the limit under Budget → Settings.`;
    case 'month':
      return `Budget limit reached — you've spent ${fmtUsd(c.spentMonth)} of your ${fmtUsd(s.monthlyLimit)} limit. Raise the limit, switch to a local model, or wait for your reset${ctx.resetDate ? ` on ${shortDate(ctx.resetDate)}` : ''}.`;
    case 'day':
      return `Daily limit reached — ${fmtUsd(c.spentToday)} of ${fmtUsd(s.dailyLimit)} today. Raise the daily limit under Budget → Settings or try again tomorrow.`;
    case 'agent':
      return `${req.agent ?? 'This agent'} has reached its ${fmtUsd(s.perAgentCaps[req.agent ?? ''] ?? 0)} cap this month. Raise it under Budget → Agents.`;
    case 'workspace':
      return `Workspace ${req.workspace ?? ''} has reached its ${fmtUsd(s.perWorkspaceCaps[req.workspace ?? ''] ?? 0)} cap this month. Raise it under Budget → Workspaces.`;
    case 'local-only':
      return 'Cloud models are off while the monthly budget is $0. Raise the budget or pick a local model.';
    case 'spike':
      return `Unusual spending spike — ${fmtUsd(spikeSpend(c, ctx.now))} in the last 5 minutes. Spending is paused until you resume it under Budget.`;
    default:
      return '';
  }
}

/**
 * The governor. Order: paused → local-only → per-request → approach
 * downshift → caps (month, day, agent, workspace) → spike breaker → allow.
 * Pure: the caller records `blocked` / `downshifted` events and trips pauses.
 */
export function checkPreCall(
  s: BudgetSettings,
  c: Counters,
  req: PreCallRequest,
  ctx: CheckContext
): PreCallCheck {
  const state = deriveState(s, c);
  const tokensIn = Math.max(0, Math.floor(req.estimatedTokensIn));
  const tokensOut = Math.max(0, Math.floor(req.estimatedTokensOut));
  let model = req.model;
  let cost = round6(
    req.estimatedCost ?? estimateCost(model, tokensIn, tokensOut)
  );
  const caps = capsFor(s, c, req);
  const hardCaps: Caps = {
    perRequest: 0,
    remaining: {
      ...caps.remaining,
      ...(s.monthlyLimit > EPS
        ? { month: round6(s.monthlyLimit - c.spentMonth) }
        : {}),
    },
  };
  const hardMin = minRemaining(hardCaps);
  const base = {
    model,
    estimatedCost: cost,
    hardRemaining:
      s.hardCap && hardMin !== Number.POSITIVE_INFINITY
        ? Math.max(0, hardMin)
        : null,
    state,
    downgradedToModel: null as string | null,
    downshiftWhy: null as string | null,
    warning: null as string | null,
  };
  const usableMin = minRemaining(caps);
  const remainingNow =
    usableMin === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, usableMin);
  const deny = (code: PreCallCode): PreCallCheck => ({
    ...base,
    allowed: false,
    code,
    reason: denialText(code, s, c, req, cost, ctx),
    remaining: remainingNow,
  });
  const switchTo = (cand: Candidate, why: string): void => {
    base.downgradedToModel = cand.model;
    base.downshiftWhy = why;
    model = cand.model;
    cost = cand.cost;
    base.model = model;
    base.estimatedCost = cost;
  };

  if (s.paused) return deny('paused');

  const localOnly = s.monthlyLimit <= EPS;
  if (localOnly && !isLocalModel(model)) {
    const alt = s.modelDownshifting
      ? pickFittingDownshift(s, model, tokensIn, tokensOut, caps, true)
      : null;
    if (!alt) return deny('local-only');
    switchTo(alt, 'Monthly budget is $0 — local models only.');
  }

  if (caps.perRequest > 0 && cost > caps.perRequest + EPS) {
    const alt = s.modelDownshifting
      ? pickFittingDownshift(s, model, tokensIn, tokensOut, caps, localOnly)
      : null;
    if (!alt) return deny('per-request');
    switchTo(
      alt,
      `This call would have exceeded the ${fmtUsd(s.perRequestLimit)} per-request limit.`
    );
  }

  if (!localOnly && s.modelDownshifting && base.downgradedToModel === null) {
    const pct = c.spentMonth / s.monthlyLimit;
    if (pct >= s.notifyWarnPct - EPS) {
      const alt = pickApproachDownshift(s, model, tokensIn, tokensOut, pct);
      if (alt) switchTo(alt, `${fmtPct(pct)} of the monthly budget is used.`);
    }
  }

  const violation = firstViolation(caps, cost);
  if (violation !== null) {
    const soft = !s.hardCap && violation !== 'per-request';
    if (!soft) return deny(violation);
    base.warning = `Over budget — ${fmtUsd(c.spentMonth)} of ${fmtUsd(s.monthlyLimit)} spent. Hard cap is off, so this call was allowed.`;
    return {
      ...base,
      allowed: true,
      code: 'over-soft',
      reason: null,
      remaining: 0,
    };
  }

  if (
    s.circuitBreakerSpendPer5min > EPS &&
    spikeSpend(c, ctx.now) > s.circuitBreakerSpendPer5min + EPS
  ) {
    return deny('spike');
  }

  const after =
    usableMin === Number.POSITIVE_INFINITY
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, round6(usableMin - cost));
  return {
    ...base,
    allowed: true,
    code: base.downgradedToModel ? 'downshifted' : 'ok',
    reason: null,
    remaining: after,
  };
}

export function downshiftText(from: string, to: string): string {
  return `Switched from ${modelLabel(from)} to ${modelLabel(to)} to stay within budget.`;
}

/* ── Overview ──────────────────────────────────────────────────────────── */

export function overviewFrom(
  s: BudgetSettings,
  c: Counters,
  period: Period,
  now: number
): BudgetOverview {
  const pctUsedMonth = s.monthlyLimit > EPS ? c.spentMonth / s.monthlyLimit : 0;
  const pctUsedToday = s.dailyLimit > EPS ? c.spentToday / s.dailyLimit : 0;
  const avgPerDay = round6(c.spentMonth / period.daysElapsed);
  const projected = round6(
    c.spentMonth + avgPerDay * (period.daysUntilReset - 1)
  );
  const remaining =
    s.monthlyLimit > EPS
      ? Math.max(0, round6(usableLimit(s) - c.spentMonth))
      : 0;
  return {
    spentToday: c.spentToday,
    spentMonth: c.spentMonth,
    monthlyLimit: s.monthlyLimit,
    dailyLimit: s.dailyLimit,
    pctUsedMonth,
    pctUsedToday,
    tokensInMonth: c.tokensInMonth,
    tokensOutMonth: c.tokensOutMonth,
    daysUntilReset: period.daysUntilReset,
    resetDate: period.resetDate,
    periodStart: period.start,
    periodEnd: period.end,
    avgPerDay,
    projectedMonthEnd: projected,
    biggestRun: c.biggest,
    remaining,
    reserveUsd: reserveUsd(s),
    spentLast5min: spikeSpend(c, now),
    blockedMonth: c.blockedMonth,
    downshiftedMonth: c.downshiftedMonth,
    agentSpend: { ...c.agentMonth },
    workspaceSpend: { ...c.workspaceMonth },
    eventsTotal: c.eventsTotal,
    state: deriveState(s, c),
    settings: s,
    computedAt: now,
  };
}

export function periodNow(
  s: BudgetSettings,
  now: number,
  tz: number,
  resetAt: number | null
): Period {
  return periodFor(now, tz, s.monthStartDay, resetAt);
}

/* ── Filters / sort / aggregations ─────────────────────────────────────── */

export function rangeStart(range: SpendRange, now: number): number {
  switch (range) {
    case '24h':
      return now - DAY_MS;
    case '7d':
      return now - 7 * DAY_MS;
    case '30d':
      return now - 30 * DAY_MS;
    default:
      return 0;
  }
}

export function filterEvents(
  events: readonly SpendEvent[],
  f: SpendFilter,
  now: number
): SpendEvent[] {
  const start = rangeStart(f.range, now);
  const q = f.search.trim().toLowerCase();
  return events.filter((e) => {
    if (e.ts < start) return false;
    if (f.category !== 'all' && e.category !== f.category) return false;
    if (f.model !== 'all' && e.model !== f.model) return false;
    if (f.agent !== 'all' && e.agent !== f.agent) return false;
    if (f.kind === 'spend' && !isSpendKind(e.kind)) return false;
    if (f.kind === 'blocked' && e.kind !== 'blocked') return false;
    if (f.kind === 'downshifted' && e.kind !== 'downshifted') return false;
    if (q) {
      const hay = [
        e.kind,
        e.agent ?? '',
        e.workspace ?? '',
        e.sessionId ?? '',
        e.model ?? '',
        e.category,
        e.detail ? JSON.stringify(e.detail) : '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortEvents(
  events: readonly SpendEvent[],
  sort: SpendSort
): SpendEvent[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...events].sort((a, b) => {
    const d = sort.key === 'ts' ? a.ts - b.ts : a.costUsd - b.costUsd;
    return (d || a.ts - b.ts || a.id.localeCompare(b.id)) * dir;
  });
}

export function nextSort(current: SpendSort, key: SpendSort['key']): SpendSort {
  if (current.key !== key) return { key, dir: 'desc' };
  return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}

export function totalCost(events: readonly SpendEvent[]): number {
  let t = 0;
  for (const e of events) if (isSpendKind(e.kind)) t += e.costUsd;
  return round6(t);
}

function emptyByCategory(): Record<SpendCategory, number> {
  return { llm: 0, tools: 0, voice: 0, compute: 0 };
}

/** Hourly buckets for 24h, daily otherwise (local-aligned). */
export function seriesFor(
  events: readonly SpendEvent[],
  range: SpendRange,
  now: number,
  tzOffsetMin: number
): SeriesBucket[] {
  const hourly = range === '24h';
  const tzMs = tzOffsetMin * 60_000;
  const size = hourly ? HOUR_MS : DAY_MS;
  const nowIdx = Math.floor((now - tzMs) / size);
  let count: number;
  if (hourly) count = 24;
  else if (range === '7d') count = 7;
  else if (range === '30d') count = 30;
  else {
    const oldest = events.reduce(
      (m, e) => (isSpendKind(e.kind) && e.ts < m ? e.ts : m),
      now
    );
    count = Math.min(
      90,
      Math.max(7, nowIdx - Math.floor((oldest - tzMs) / size) + 1)
    );
  }
  const firstIdx = nowIdx - count + 1;
  const buckets: SeriesBucket[] = [];
  for (let i = 0; i < count; i++) {
    const idx = firstIdx + i;
    const at = idx * size + tzMs;
    const label = hourly
      ? `${String(((idx % 24) + 24) % 24).padStart(2, '0')}:00`
      : shortDayLabel(at, tzOffsetMin);
    buckets.push({ at, label, total: 0, byCategory: emptyByCategory() });
  }
  for (const e of events) {
    if (!isSpendKind(e.kind)) continue;
    const idx = Math.floor((e.ts - tzMs) / size) - firstIdx;
    if (idx < 0 || idx >= count) continue;
    const b = buckets[idx];
    b.total = round6(b.total + e.costUsd);
    b.byCategory[e.category] = round6(b.byCategory[e.category] + e.costUsd);
  }
  return buckets;
}

export function breakdown(
  events: readonly SpendEvent[],
  by: BreakdownBy,
  range: SpendRange,
  now: number
): BreakdownRow[] {
  const start = rangeStart(range, now);
  const map = new Map<string, BreakdownRow>();
  for (const e of events) {
    if (e.ts < start || !isSpendKind(e.kind)) continue;
    const key =
      by === 'model'
        ? (e.model ?? '—')
        : by === 'agent'
          ? (e.agent ?? '—')
          : by === 'workspace'
            ? (e.workspace ?? '—')
            : e.category;
    const row = map.get(key) ?? { key, cost: 0, tokens: 0, count: 0 };
    row.cost = round6(row.cost + e.costUsd);
    row.tokens += e.tokensIn + e.tokensOut;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => b.cost - a.cost || a.key.localeCompare(b.key)
  );
}

/** "nice" axis ceiling for a chart max. */
export function niceCeil(max: number): number {
  if (max <= 0) return 0.1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  const n = max / base;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * base;
}

/* ── Export ────────────────────────────────────────────────────────────── */

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas (same rule as the Phase 11/12 exports).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  'time',
  'kind',
  'category',
  'agent',
  'workspace',
  'session',
  'model',
  'tokens_in',
  'tokens_out',
  'cost_usd',
  'detail',
] as const;

export function eventsCsv(events: readonly SpendEvent[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    lines.push(
      [
        new Date(e.ts).toISOString(),
        e.kind,
        e.category,
        e.agent,
        e.workspace,
        e.sessionId,
        e.model,
        e.tokensIn,
        e.tokensOut,
        e.costUsd.toFixed(6),
        e.detail ? JSON.stringify(e.detail) : '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

export function eventsJson(
  events: readonly SpendEvent[],
  overview: BudgetOverview | null
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: 'Metered locally by XR. Estimates use list prices; your provider invoice is authoritative.',
      overview: overview
        ? {
            spentMonth: overview.spentMonth,
            monthlyLimit: overview.monthlyLimit,
            periodStart: new Date(overview.periodStart).toISOString(),
            resetDate: overview.resetDate,
          }
        : null,
      count: events.length,
      totalCost: totalCost(events),
      events,
    },
    null,
    2
  );
}

export function exportFilename(
  range: SpendRange,
  now: number,
  ext: 'csv' | 'json'
): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `xr-spend-${range}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export function newSpendId(): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `sp_${Date.now().toString(36)}${rnd}`;
}

export function kindLabel(k: SpendKind): string {
  switch (k) {
    case 'llm_call':
      return 'LLM call';
    case 'tool_call':
      return 'Tool call';
    case 'voice':
      return 'Voice';
    case 'compute':
      return 'Compute';
    case 'blocked':
      return 'Blocked';
    case 'downshifted':
      return 'Downshifted';
    case 'cap_set':
      return 'Limit changed';
    case 'reset':
      return 'Month reset';
    case 'paused':
      return 'Paused';
    case 'resumed':
      return 'Resumed';
  }
}

export function categoryLabel(c: SpendCategory): string {
  return CATEGORY_LABEL[c];
}

export function categoryVar(c: SpendCategory): string {
  return `var(--spend-${c})`;
}

export { SPEND_CATEGORIES, modelInfo, modelLabel };

/** Keys 1–6 → tabs (screen-scoped). */
export function tabForKey(key: string): number | null {
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n - 1 : null;
}
