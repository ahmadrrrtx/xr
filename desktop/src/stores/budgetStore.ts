/*
 * Budget store (Phase 13) — the one canonical store for spend state.
 *
 * It renders what the governor (budget/api.ts → Rust or the browser mirror)
 * reports; it never decides whether a call may spend. Enforcement side
 * effects (toasts, bell, audit, orb) live in budget/enforce.ts, which
 * subscribes to the same backend events.
 */
import { toast } from 'sonner';
import { create } from 'zustand';

import { budgetBackend } from '@/budget/api';
import {
  eventsCsv,
  eventsJson,
  exportFilename,
  fmtUsd,
  nextSort,
} from '@/budget/core';
import { modelLabel } from '@/budget/models';
import {
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_SPEND_FILTER,
  type BreakdownRow,
  type BudgetOverview,
  type BudgetSettings,
  type BudgetSettingsPatch,
  type BudgetStateId,
  type PauseReason,
  type SeriesBucket,
  type SpendEvent,
  type SpendFilter,
  type SpendRange,
  type SpendSort,
  type SpendSortKey,
  type StateChange,
} from '@/budget/types';

const PAGE = 100;
const LS_DISMISSED = 'xr.budget.warnDismissed';

export interface BudgetState {
  initialised: boolean;
  loading: boolean;
  error: string | null;
  tz: number;
  overview: BudgetOverview | null;
  settings: BudgetSettings;
  lastChange: StateChange | null;

  // Spend history
  events: SpendEvent[];
  eventsTotal: number;
  eventsTotalCost: number;
  nextCursor: string | null;
  eventsLoading: boolean;
  filter: SpendFilter;
  sort: SpendSort;

  // Charts
  series: SeriesBucket[];
  seriesRange: SpendRange;
  byModel: BreakdownRow[];
  byAgent: BreakdownRow[];
  byWorkspace: BreakdownRow[];
  byCategory: BreakdownRow[];

  /** 80 % banner dismissed for this period (periodStart it applies to). */
  warnDismissedFor: number | null;

  load(): Promise<void>;
  refresh(): Promise<void>;
  loadEventsPage(reset?: boolean): Promise<void>;
  setFilter(patch: Partial<SpendFilter>): void;
  setSort(key: SpendSortKey): void;
  setSeriesRange(range: SpendRange): void;
  loadCharts(): Promise<void>;
  updateSettings(
    patch: BudgetSettingsPatch,
    opts?: { quiet?: boolean }
  ): Promise<void>;
  pause(reason?: PauseReason): Promise<void>;
  resume(): Promise<void>;
  resetMonth(): Promise<void>;
  clearAll(): Promise<void>;
  exportSpend(format: 'csv' | 'json', range?: SpendRange): Promise<void>;
  testCharge(amount: number, model?: string): Promise<void>;
  dismissWarn(): void;
  setAgentCap(agent: string, usd: number): Promise<void>;
  setWorkspaceCap(workspace: string, usd: number): Promise<void>;
  setDefaultModel(id: string): Promise<void>;
  addModel(id: string): Promise<void>;
  removeModel(id: string): Promise<void>;
  installLocal(id: string): Promise<void>;
}

let unsubscribe: (() => void) | null = null;
let refreshTimer: number | null = null;

function readDismissed(): number | null {
  try {
    const raw = window.localStorage.getItem(LS_DISMISSED);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

export const useBudgetStore = create<BudgetState>()((set, get) => ({
  initialised: false,
  loading: false,
  error: null,
  tz: 0,
  overview: null,
  settings: { ...DEFAULT_BUDGET_SETTINGS },
  lastChange: null,
  events: [],
  eventsTotal: 0,
  eventsTotalCost: 0,
  nextCursor: null,
  eventsLoading: false,
  filter: { ...DEFAULT_SPEND_FILTER },
  sort: { key: 'ts', dir: 'desc' },
  series: [],
  seriesRange: '30d',
  byModel: [],
  byAgent: [],
  byWorkspace: [],
  byCategory: [],
  warnDismissedFor: readDismissed(),

  load: async () => {
    if (get().initialised) return;
    set({ initialised: true, loading: true, error: null });
    const tz = new Date().getTimezoneOffset();
    try {
      const overview = await budgetBackend().init(tz);
      set({ tz, overview, settings: overview.settings, loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Budget service unavailable.',
      });
    }
    if (!unsubscribe) {
      unsubscribe = await budgetBackend().subscribe({
        onSpend: (event) => {
          // Keep the history list live when it is showing the newest page.
          const st = get();
          if (st.sort.key === 'ts' && st.sort.dir === 'desc') {
            set({
              events: [event, ...st.events].slice(0, 2000),
              eventsTotal: st.eventsTotal + 1,
            });
          }
          scheduleRefresh();
        },
        onStateChange: (change) => {
          set({ lastChange: change });
          scheduleRefresh();
        },
        onSettings: (settings) => {
          set((s) => ({
            settings,
            overview: s.overview ? { ...s.overview, settings } : s.overview,
          }));
          scheduleRefresh();
        },
      });
    }
  },

  refresh: async () => {
    try {
      const overview = await budgetBackend().overview();
      set({ overview, settings: overview.settings, error: null });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : 'Budget service unavailable.',
      });
    }
  },

  loadEventsPage: async (reset = false) => {
    const st = get();
    if (st.eventsLoading) return;
    if (!reset && st.nextCursor === null && st.events.length > 0) return;
    set({ eventsLoading: true });
    try {
      const page = await budgetBackend().listEvents(
        st.filter,
        st.sort,
        reset ? null : st.nextCursor,
        PAGE
      );
      set((s) => ({
        events: reset ? page.events : [...s.events, ...page.events],
        eventsTotal: page.total,
        eventsTotalCost: page.totalCost,
        nextCursor: page.nextCursor,
        eventsLoading: false,
      }));
    } catch {
      set({ eventsLoading: false });
    }
  },

  setFilter: (patch) => {
    set((s) => ({
      filter: { ...s.filter, ...patch },
      events: [],
      nextCursor: null,
    }));
    void get().loadEventsPage(true);
  },

  setSort: (key) => {
    set((s) => ({ sort: nextSort(s.sort, key), events: [], nextCursor: null }));
    void get().loadEventsPage(true);
  },

  setSeriesRange: (range) => {
    set({ seriesRange: range });
    void get().loadCharts();
  },

  loadCharts: async () => {
    const range = get().seriesRange;
    try {
      const b = budgetBackend();
      const [series, byModel, byAgent, byWorkspace, byCategory] =
        await Promise.all([
          b.series(range),
          b.breakdown('model', range),
          b.breakdown('agent', range),
          b.breakdown('workspace', range),
          b.breakdown('category', range),
        ]);
      // Range may have changed while loading — keep the latest request only.
      if (get().seriesRange !== range) return;
      set({ series, byModel, byAgent, byWorkspace, byCategory });
    } catch {
      /* overview still renders; charts stay as they were */
    }
  },

  updateSettings: async (patch, opts) => {
    const prev = get().settings;
    // Optimistic: sliders feel immediate; the backend answer is authoritative.
    set({ settings: { ...prev, ...patch } });
    try {
      const settings = await budgetBackend().updateSettings(patch);
      set((s) => ({
        settings,
        overview: s.overview ? { ...s.overview, settings } : s.overview,
      }));
      await get().refresh();
      if (!opts?.quiet) {
        if (patch.monthlyLimit !== undefined) {
          toast(
            patch.monthlyLimit === 0
              ? 'Monthly limit set to $0 — local models only.'
              : `Monthly limit set to ${fmtUsd(settings.monthlyLimit)}.`
          );
        } else if (patch.hardCap === false) {
          toast('Hard cap off — XR will warn instead of block.', {
            description: 'Cloud calls can now exceed the monthly limit.',
          });
        } else if (patch.hardCap === true) {
          toast('Hard cap on — calls over the limit are blocked.');
        }
      }
    } catch (err) {
      set({ settings: prev });
      toast.error('Could not save budget settings.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  pause: async (reason = 'manual') => {
    try {
      const settings = await budgetBackend().setPaused(true, reason);
      set({ settings });
      await get().refresh();
    } catch (err) {
      toast.error('Could not pause spending.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  resume: async () => {
    const from = get().settings.pauseReason;
    try {
      const settings = await budgetBackend().setPaused(false, from);
      set({ settings });
      await get().refresh();
      toast('Spending resumed.');
    } catch (err) {
      toast.error('Could not resume spending.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  resetMonth: async () => {
    try {
      const overview = await budgetBackend().resetMonth();
      set({ overview, settings: overview.settings, warnDismissedFor: null });
      toast('Month reset — the counter starts from $0.00.', {
        description: 'Past events stay in Spend History.',
      });
      void get().loadEventsPage(true);
      void get().loadCharts();
    } catch (err) {
      toast.error('Could not reset the month.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  clearAll: async () => {
    try {
      const overview = await budgetBackend().clearAll();
      set({
        overview,
        settings: overview.settings,
        events: [],
        eventsTotal: 0,
        eventsTotalCost: 0,
        nextCursor: null,
        warnDismissedFor: null,
      });
      toast('Budget data cleared.', {
        description: 'Settings are back to defaults.',
      });
      void get().loadCharts();
    } catch (err) {
      toast.error('Could not clear budget data.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  exportSpend: async (format, range) => {
    const r = range ?? get().filter.range;
    try {
      const events = await budgetBackend().exportEvents(r);
      const text =
        format === 'csv'
          ? eventsCsv(events)
          : eventsJson(events, get().overview);
      const filename = exportFilename(r, Date.now(), format);
      const res = await budgetBackend().saveExport(
        filename,
        text,
        format === 'csv' ? 'text/csv' : 'application/json'
      );
      if (res.saved) {
        toast(`Exported ${events.length} events`, {
          description: res.path ?? filename,
        });
      }
    } catch (err) {
      toast.error('Export failed.', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  },

  testCharge: async (amount, model = 'claude-sonnet-4.5') => {
    // Goes through the real gate: a test charge can be blocked too.
    const { budgetGate, recordSpend } = await import('@/budget/enforce');
    const check = await budgetGate({
      model,
      estimatedTokensIn: 0,
      estimatedTokensOut: 0,
      estimatedCost: amount,
      agent: 'main',
      workspace: null,
      sessionId: null,
      surface: 'test',
    });
    if (!check.allowed) return; // the gate already toasted the reason
    await recordSpend({
      kind: 'llm_call',
      agent: 'main',
      model: check.model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: amount,
      category: 'llm',
      detail: { test: true },
    });
    toast(`Test charge of ${fmtUsd(amount)} recorded`, {
      description: `${modelLabel(check.model)} · appears in Spend History as a test.`,
    });
  },

  dismissWarn: () => {
    const start = get().overview?.periodStart ?? Date.now();
    set({ warnDismissedFor: start });
    try {
      window.localStorage.setItem(LS_DISMISSED, String(start));
    } catch {
      /* ignore */
    }
  },

  setAgentCap: async (agent, usd) => {
    const caps = { ...get().settings.perAgentCaps };
    if (usd <= 0) delete caps[agent];
    else caps[agent] = usd;
    await get().updateSettings({ perAgentCaps: caps }, { quiet: true });
  },

  setWorkspaceCap: async (workspace, usd) => {
    const caps = { ...get().settings.perWorkspaceCaps };
    if (usd <= 0) delete caps[workspace];
    else caps[workspace] = usd;
    await get().updateSettings({ perWorkspaceCaps: caps }, { quiet: true });
  },

  setDefaultModel: async (id) => {
    await get().updateSettings({ defaultModel: id }, { quiet: true });
    toast(`${modelLabel(id)} is now the default model.`);
  },

  addModel: async (id) => {
    const s = get().settings;
    if (s.configuredModels.includes(id)) return;
    await get().updateSettings(
      { configuredModels: [...s.configuredModels, id] },
      { quiet: true }
    );
  },

  removeModel: async (id) => {
    const s = get().settings;
    const patch: BudgetSettingsPatch = {
      configuredModels: s.configuredModels.filter((m) => m !== id),
      installedLocal: s.installedLocal.filter((m) => m !== id),
    };
    if (s.defaultModel === id) {
      patch.defaultModel =
        patch.configuredModels?.[0] ?? patch.installedLocal?.[0] ?? '';
    }
    await get().updateSettings(patch, { quiet: true });
    toast(`${modelLabel(id)} removed.`);
  },

  installLocal: async (id) => {
    const s = get().settings;
    if (s.installedLocal.includes(id)) return;
    await get().updateSettings(
      { installedLocal: [...s.installedLocal, id] },
      { quiet: true }
    );
  },
}));

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void useBudgetStore.getState().refresh();
  }, 150);
}

/* ── Selectors ─────────────────────────────────────────────────────────── */

export const selectBudgetState = (s: BudgetState): BudgetStateId =>
  s.overview?.state ?? (s.settings.paused ? 'paused' : 'ok');

export const selectRemaining = (s: BudgetState): number | null =>
  s.overview ? s.overview.remaining : null;

/** Should the 80 % banner show? (not dismissed for this period) */
export const selectWarnBanner = (s: BudgetState): boolean => {
  const o = s.overview;
  if (!o) return false;
  if (o.state !== 'warn' && o.state !== 'danger') return false;
  return s.warnDismissedFor !== o.periodStart;
};

/** Test/e2e seam. */
export function resetBudgetStoreForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  useBudgetStore.setState({ initialised: false, overview: null, events: [] });
}
