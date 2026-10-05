/*
 * Runs store (Phase 11, brief §2) — the canonical list of every agent run
 * across every surface. One Zustand store, `RunSummary` rows keyed by id.
 *
 * Who writes here:
 *   - `seedMockHistory()` on first load (deterministic demo history)
 *   - `runs/bridge.ts` projecting brainStore's live `Run`s (token ticks,
 *     approval waits, completion) and the Tauri `brain:run-update` /
 *     `run:cancelled` events from other windows
 *   - the user: kill / stop all / archive / filters
 *
 * Hot-path discipline: `runs` is replaced immutably on every change, but the
 * sorted/filtered id list is memoised on `listVersion`, which only bumps on
 * STRUCTURAL changes (insert, status, archive, metadata). Token/cost ticks
 * re-render just the affected row. `clock` is the shared "now" the running
 * rows derive their duration from (one timer, not one per row).
 */
import { toast } from 'sonner';
import { create } from 'zustand';

import type { BrainUpdate } from '@/brain/events';
import type { RunStatus, RunSummary } from '@/brain/types';
import { isTauri } from '@/lib/tauri';
import {
  DEFAULT_SORT,
  exportFilename,
  filterBase,
  filterRuns,
  inProgress,
  nextSort,
  runDuration,
  runStatusOf,
  sortRuns,
  summaryFromRun,
  toCsv,
  toJson,
  type DateRange,
  type SortColumn,
  type SortState,
  type StatusFilter,
} from '@/runs/core';
import { seedMockHistory, seedStress } from '@/runs/seed';
import { useBrainStore } from '@/stores/brainStore';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type FlashKind = 'new' | 'completed' | 'failed' | 'killed' | 'waiting';

export interface RunFlash {
  kind: FlashKind;
  at: number;
}

export type StopDialogState =
  null | { kind: 'all' } | { kind: 'one'; id: string };

export type SeedMode = 'default' | 'none' | 'stress';

export interface RunsState {
  runs: Record<string, RunSummary>;
  /** Bumps on structural change only (see header comment). */
  listVersion: number;
  /** Shared "now" for live durations / relative times. */
  clock: number;
  /** running + waiting — maintained incrementally for the topbar dot. */
  inProgressCount: number;
  /** Recent transitions → one-shot row animations. */
  flashes: Record<string, RunFlash>;

  statusFilter: StatusFilter;
  search: string;
  dateRange: DateRange;
  sort: SortState;
  chartsOpen: boolean;
  selectedId: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  stopDialog: StopDialogState;
  /** aria-live announcement (counter lets identical texts re-announce). */
  announce: { n: number; text: string } | null;

  load: (opts?: { seed?: SeedMode }) => Promise<void>;
  tick: (now?: number) => void;
  /** Idempotent insert/update; detects transitions for flashes + toasts. */
  upsert: (next: RunSummary, origin?: 'brain' | 'event' | 'local') => void;
  upsertFromBrain: (run: import('@/brain/types').Run) => void;
  applyBrainUpdate: (payload: BrainUpdate) => void;
  applyCancelled: (
    ids: string[],
    meta?: { by?: 'user' | 'shield'; reason?: string }
  ) => void;

  setStatusFilter: (f: StatusFilter) => void;
  cycleStatusFilter: (dir: 1 | -1) => void;
  setSearch: (s: string) => void;
  setDateRange: (r: DateRange) => void;
  setSort: (col: SortColumn) => void;
  toggleCharts: () => void;
  select: (id: string | null) => void;
  clearFilters: () => void;

  requestKill: (id: string) => void;
  requestKillAll: () => void;
  closeStopDialog: () => void;
  kill: (id: string, reason?: string) => Promise<void>;
  /** Resolves with the number of runs that were in progress. */
  killAll: (
    reason?: string,
    opts?: { silent?: boolean; by?: 'user' | 'shield' }
  ) => Promise<number>;
  retry: (id: string) => void;
  archive: (id: string) => void;
  unarchive: (id: string) => void;
  copyId: (id: string) => Promise<void>;
  startDemoRun: (title?: string) => string;

  exportCsv: () => Promise<void>;
  exportJson: () => Promise<void>;

  /** Dev helpers (R key / stress seed). */
  reseed: (mode?: SeedMode) => void;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const FLASH_CAP = 64;

function trimFlashes(f: Record<string, RunFlash>): Record<string, RunFlash> {
  const keys = Object.keys(f);
  if (keys.length <= FLASH_CAP) return f;
  const out: Record<string, RunFlash> = {};
  for (const k of keys.slice(-FLASH_CAP)) out[k] = f[k];
  return out;
}

function flashFor(prev: RunStatus | null, next: RunStatus): FlashKind | null {
  if (prev === null) return inProgress(next) ? 'new' : null;
  if (prev === next) return null;
  if (next === 'completed') return 'completed';
  if (next === 'failed') return 'failed';
  if (next === 'killed') return 'killed';
  if (next === 'waiting') return 'waiting';
  return null;
}

/** Metadata that changes the sort/filter outcome (tokens/cost excluded). */
function structurallyDiffers(a: RunSummary, b: RunSummary): boolean {
  return (
    a.status !== b.status ||
    a.title !== b.title ||
    a.agent !== b.agent ||
    a.model !== b.model ||
    a.workspace !== b.workspace ||
    a.startedAt !== b.startedAt ||
    a.archived !== b.archived
  );
}

async function invokeCancel(ids: string[], reason?: string): Promise<void> {
  if (!isTauri() || ids.length === 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (ids.length === 1) {
      await invoke('cancel_run', { id: ids[0], reason: reason ?? null });
    } else {
      await invoke('bulk_cancel_runs', { ids, reason: reason ?? null });
    }
  } catch {
    /* best-effort — the mock stream was already stopped in-process */
  }
}

/**
 * Save text to disk: native save dialog in the shell (defaults to
 * Downloads), Blob download in the browser. Resolves with the saved path
 * (Tauri) or null (browser / cancelled).
 */
async function saveText(
  filename: string,
  text: string,
  mime: string
): Promise<{ saved: boolean; path: string | null }> {
  if (!isTauri()) {
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
  // Rust-side dialog + write (commands/runs.rs): no webview fs/dialog
  // capability needed, and the dialog stays off the main thread.
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const target = await invoke<string | null>('save_runs_export', {
      filename,
      contents: text,
    });
    if (!target) return { saved: false, path: null };
    return { saved: true, path: target };
  } catch (e) {
    toast.error('Export failed', {
      description: e instanceof Error ? e.message : String(e),
    });
    return { saved: false, path: null };
  }
}

/** Folder of a saved file (for the toast's "Open folder" action). */
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

/* ── Store ─────────────────────────────────────────────────────────────── */

let firstLoadAt = 0;

export const useRunsStore = create<RunsState>()((set, get) => {
  const announce = (text: string): void =>
    set((s) => ({ announce: { n: (s.announce?.n ?? 0) + 1, text } }));

  /** Apply a sorted/filtered snapshot for export (same rules as the table). */
  const exportRows = (): RunSummary[] => {
    const s = get();
    const now = Date.now();
    const rows = filterRuns(Object.values(s.runs), {
      status: s.statusFilter,
      search: s.search,
      range: s.dateRange,
      now,
    });
    return sortRuns(rows, s.sort, now);
  };

  const finishExport = async (
    ext: 'csv' | 'json',
    text: string,
    count: number
  ): Promise<void> => {
    const filename = exportFilename(ext, Date.now());
    const mime = ext === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const res = await saveText(filename, text, mime);
    if (!res.saved) return; // dialog cancelled — nothing to announce
    const label = ext === 'csv' ? 'CSV' : 'JSON';
    toast.success(
      `Exported ${count} ${count === 1 ? 'run' : 'runs'} to ${label}`,
      {
        description: res.path ?? filename,
        action: res.path
          ? {
              label: 'Open folder',
              onClick: () => {
                const folder = dirname(res.path as string);
                void import('@/lib/settingsApi').then((m) =>
                  m.revealPath(folder)
                );
              },
            }
          : undefined,
      }
    );
    announce(`Exported ${count} runs to ${label}.`);
  };

  return {
    runs: {},
    listVersion: 0,
    clock: Date.now(),
    inProgressCount: 0,
    flashes: {},

    statusFilter: 'all',
    search: '',
    dateRange: '30d',
    sort: DEFAULT_SORT,
    chartsOpen: false,
    selectedId: null,
    loading: false,
    loaded: false,
    error: null,
    stopDialog: null,
    announce: null,

    load: async (opts) => {
      const mode: SeedMode = opts?.seed ?? 'default';
      const st = get();
      if (st.loaded && mode === 'default') return;
      set({ loading: true, error: null });
      if (!firstLoadAt) firstLoadAt = Date.now();
      const now = Date.now();

      // The Rust side returns the shell's known runs (empty in Phase 11 —
      // the TS seed is the source; the command is the Phase 14 contract).
      let hostRuns: RunSummary[] = [];
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          hostRuns = (await invoke<RunSummary[]>('list_runs')) ?? [];
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      }

      let seeded: RunSummary[] = [];
      if (mode === 'stress') seeded = seedStress(now);
      else if (mode === 'default') seeded = seedMockHistory(now);

      // Keep live rows (bridged from brainStore) across a reseed.
      const keep: Record<string, RunSummary> = {};
      for (const r of Object.values(get().runs)) {
        if (inProgress(r.status) || r.id.startsWith('mock-latest'))
          keep[r.id] = r;
      }
      const runs: Record<string, RunSummary> = {};
      for (const r of seeded) runs[r.id] = r;
      for (const r of hostRuns) runs[r.id] = r;
      for (const r of Object.values(keep)) runs[r.id] = r;

      // First paint: hold the skeleton briefly so a near-instant load doesn't
      // flash empty → full. Subsequent loads are immediate.
      const sinceFirst = Date.now() - firstLoadAt;
      if (!get().loaded && sinceFirst < 250) {
        await new Promise((r) => window.setTimeout(r, 250 - sinceFirst));
      }

      let inProg = 0;
      for (const r of Object.values(runs))
        if (inProgress(r.status)) inProg += 1;
      set((s) => ({
        runs,
        inProgressCount: inProg,
        listVersion: s.listVersion + 1,
        loading: false,
        loaded: true,
        clock: Date.now(),
      }));
    },

    tick: (now = Date.now()) => set({ clock: now }),

    upsert: (next, origin = 'local') => {
      const s = get();
      const prev = s.runs[next.id];
      const prevStatus = prev?.status ?? null;
      const flash = flashFor(prevStatus, next.status);
      const structural = !prev || structurallyDiffers(prev, next);
      const merged: RunSummary = prev
        ? { ...prev, ...next, archived: prev.archived }
        : next;

      const wasIn = prev ? inProgress(prev.status) : false;
      const isIn = inProgress(merged.status);
      const delta = (isIn ? 1 : 0) - (wasIn ? 1 : 0);

      set((st) => ({
        runs: { ...st.runs, [merged.id]: merged },
        listVersion: structural ? st.listVersion + 1 : st.listVersion,
        inProgressCount: Math.max(0, st.inProgressCount + delta),
        flashes: flash
          ? trimFlashes({
              ...st.flashes,
              [merged.id]: { kind: flash, at: Date.now() },
            })
          : st.flashes,
      }));

      // Toasts for transitions brainStore doesn't already announce in this
      // window (it toasts for the runs it streams itself).
      if (origin === 'event' && flash === 'failed') {
        toast.error(`Run ${merged.shortId} failed`, {
          description: merged.errorSummary ?? merged.title,
        });
      } else if (origin === 'event' && flash === 'killed') {
        toast(`Run ${merged.shortId} stopped`);
      }
      if (flash === 'new')
        announce(`Run ${merged.shortId} started: ${merged.title}`);
      else if (flash === 'failed') announce(`Run ${merged.shortId} failed.`);
      else if (flash === 'completed')
        announce(`Run ${merged.shortId} completed.`);
    },

    upsertFromBrain: (run) => {
      const prev = get().runs[run.id];
      get().upsert(summaryFromRun(run, prev), 'brain');
    },

    applyBrainUpdate: (payload) => {
      const s = get();
      switch (payload.kind) {
        case 'run-start': {
          const prev = s.runs[payload.runId];
          get().upsert(summaryFromRun(payload.run, prev), 'event');
          return;
        }
        case 'run-end': {
          const prev = s.runs[payload.runId];
          if (!prev) return;
          const endedAt =
            payload.durationMs != null
              ? prev.startedAt + payload.durationMs
              : Date.now();
          get().upsert(
            {
              ...prev,
              status: runStatusOf(payload.status),
              endedAt,
              durationMs: Math.max(0, endedAt - prev.startedAt),
              costUsd: payload.costUsd,
            },
            'event'
          );
          return;
        }
        case 'run-status': {
          const prev = s.runs[payload.runId];
          if (!prev) return;
          get().upsert(
            { ...prev, status: runStatusOf(payload.status) },
            'event'
          );
          return;
        }
        default:
          return; // span-level events don't change a list row
      }
    },

    applyCancelled: (ids, meta) => {
      const now = Date.now();
      for (const id of ids) {
        const prev = get().runs[id];
        if (!prev || !inProgress(prev.status)) continue;
        get().upsert(
          {
            ...prev,
            status: 'killed',
            endedAt: now,
            durationMs: now - prev.startedAt,
            ...(meta?.by === 'shield'
              ? {
                  killedBy: 'shield' as const,
                  errorSummary:
                    meta.reason ?? 'Paused by XR Shield emergency revoke',
                }
              : {}),
          },
          'event'
        );
      }
    },

    setStatusFilter: (f) => set({ statusFilter: f, selectedId: null }),
    cycleStatusFilter: (dir) => {
      const order: StatusFilter[] = [
        'all',
        'running',
        'completed',
        'failed',
        'killed',
      ];
      const i = order.indexOf(get().statusFilter);
      const next = order[(i + dir + order.length) % order.length];
      set({ statusFilter: next, selectedId: null });
    },
    setSearch: (search) => set({ search }),
    setDateRange: (dateRange) => set({ dateRange }),
    setSort: (col) => set((s) => ({ sort: nextSort(s.sort, col) })),
    toggleCharts: () => set((s) => ({ chartsOpen: !s.chartsOpen })),
    select: (selectedId) => set({ selectedId }),
    clearFilters: () =>
      set({
        statusFilter: 'all',
        search: '',
        dateRange: '30d',
        selectedId: null,
      }),

    requestKill: (id) => {
      const r = get().runs[id];
      if (r && inProgress(r.status)) set({ stopDialog: { kind: 'one', id } });
    },
    requestKillAll: () => {
      if (get().inProgressCount > 0) set({ stopDialog: { kind: 'all' } });
      else toast('No runs in progress');
    },
    closeStopDialog: () => set({ stopDialog: null }),

    kill: async (id, reason) => {
      const r = get().runs[id];
      if (!r || !inProgress(r.status)) return;
      set({ stopDialog: null });
      const brain = useBrainStore.getState();
      const owned =
        brain.runs[id] && inProgress(runStatusOf(brain.runs[id].status));
      if (owned) brain.stopRun(id, { silent: true });
      // Not streamed by this window (or the stream was already gone): settle locally.
      if (inProgress(get().runs[id]?.status ?? 'killed'))
        get().applyCancelled([id]);
      await invokeCancel([id], reason);
      toast(`Stopped run ${r.shortId}`, { description: r.title });
      announce(`Stopped run ${r.shortId}.`);
    },

    killAll: async (reason, opts) => {
      const s = get();
      const ids = Object.values(s.runs)
        .filter((r) => inProgress(r.status))
        .map((r) => r.id);
      set({ stopDialog: null });
      if (ids.length === 0) return 0;
      const brain = useBrainStore.getState();
      for (const id of ids) {
        const owned =
          brain.runs[id] && inProgress(runStatusOf(brain.runs[id].status));
        if (owned) brain.stopRun(id, { silent: true, reason });
      }
      get().applyCancelled(ids, { by: opts?.by, reason });
      await invokeCancel(ids, reason);
      if (!opts?.silent) {
        toast.error(
          `Stopped ${ids.length} ${ids.length === 1 ? 'agent' : 'agents'}.`,
          {
            description: reason
              ? `Reason: ${reason}`
              : 'No new work will start.',
          }
        );
        announce(`Stopped ${ids.length} agents.`);
      }
      return ids.length;
    },

    retry: () => {
      toast('Retry will re-run in Phase 14.', {
        description: 'The real agent runtime lands with the runner.',
      });
    },

    archive: (id) => {
      const r = get().runs[id];
      if (!r) return;
      // A live agent never disappears from the Control Room.
      if (inProgress(r.status)) {
        toast(`Run ${r.shortId} is still in progress`, {
          description: 'Stop it first if you want it out of the way.',
        });
        return;
      }
      set((s) => ({
        runs: { ...s.runs, [id]: { ...r, archived: true } },
        listVersion: s.listVersion + 1,
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
      toast(`Archived run ${r.shortId}`, {
        description: 'Hidden from every view until reload.',
        action: { label: 'Undo', onClick: () => get().unarchive(id) },
      });
    },

    unarchive: (id) => {
      const r = get().runs[id];
      if (!r) return;
      set((s) => ({
        runs: { ...s.runs, [id]: { ...r, archived: false } },
        listVersion: s.listVersion + 1,
      }));
    },

    copyId: async (id) => {
      const r = get().runs[id];
      if (!r) return;
      try {
        if (isTauri()) {
          const { writeText } =
            await import('@tauri-apps/plugin-clipboard-manager');
          await writeText(r.id);
        } else {
          await navigator.clipboard.writeText(r.id);
        }
        toast(`Copied ${r.id}`);
      } catch {
        toast.error('Could not copy to the clipboard');
      }
    },

    startDemoRun: (title) => {
      const id = useBrainStore.getState().startMockRun(title);
      return id;
    },

    exportCsv: async () => {
      const rows = exportRows();
      await finishExport('csv', toCsv(rows, Date.now()), rows.length);
    },

    exportJson: async () => {
      const rows = exportRows();
      await finishExport('json', toJson(rows, Date.now()), rows.length);
    },

    reseed: (mode = 'default') => {
      set({ loaded: false });
      void get().load({ seed: mode });
    },
  };
});

/* ── Derived selectors ─────────────────────────────────────────────────── */

/** Tabs count over range+search (what you'd see under each tab). */
export function selectBase(s: RunsState, now: number): RunSummary[] {
  return filterBase(Object.values(s.runs), {
    search: s.search,
    range: s.dateRange,
    now,
  });
}

/** Visible, sorted rows for the table (pure; memoised by the screen). */
export function selectVisible(s: RunsState, now: number): RunSummary[] {
  return sortRuns(
    filterRuns(Object.values(s.runs), {
      status: s.statusFilter,
      search: s.search,
      range: s.dateRange,
      now,
    }),
    s.sort,
    now
  );
}

export { runDuration };
