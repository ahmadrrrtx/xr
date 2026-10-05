/*
 * Runs / Control Room (Phase 11 — SCREEN 9).
 *
 * The one place every agent run lands: a virtualized, live-updating table
 * with an emergency stop, filters, stats, hand-rolled charts and export.
 * State lives in `stores/runsStore.ts`; `runs/bridge.ts` feeds it from the
 * Brain store and the Tauri event bus. This file is layout + keyboard.
 *
 * Phase 9 shipped a static preview here (six canned rows with an eye
 * action); that behaviour survives as the "View trace" action on every row.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ListImperativeAPI } from 'react-window';
import { toast } from 'sonner';

import { isTauri } from '@/lib/tauri';
import { setRunsScreenActive } from '@/runs/bridge';
import {
  LIVE_SORT_COLUMNS,
  STATUS_FILTERS,
  aggregate,
  inProgress,
  matchesStatus,
  sortRuns,
  statusCounts,
  surfaceCounts,
  type StatusFilter,
} from '@/runs/core';
import { selectBase, useRunsStore, type SeedMode } from '@/stores/runsStore';

import { FilterRow } from './components/FilterRow';
import { RunCharts } from './components/RunCharts';
import { RunsHeader } from './components/RunsHeader';
import { RunsTable } from './components/RunsTable';
import { StatsBar, SurfaceChips } from './components/StatsBar';
import {
  EmptyFiltered,
  EmptyFresh,
  ErrorBanner,
  RunsSkeleton,
} from './components/States';
import { StopDialog } from './components/StopDialog';

const VALID_STATUS = new Set<string>(STATUS_FILTERS);

export default function RunsScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ListImperativeAPI>(null);

  const loading = useRunsStore((s) => s.loading);
  const loaded = useRunsStore((s) => s.loaded);
  const error = useRunsStore((s) => s.error);
  const listVersion = useRunsStore((s) => s.listVersion);
  const clock = useRunsStore((s) => s.clock);
  const inProgressCount = useRunsStore((s) => s.inProgressCount);
  const statusFilter = useRunsStore((s) => s.statusFilter);
  const search = useRunsStore((s) => s.search);
  const dateRange = useRunsStore((s) => s.dateRange);
  const sort = useRunsStore((s) => s.sort);
  const chartsOpen = useRunsStore((s) => s.chartsOpen);
  const selectedId = useRunsStore((s) => s.selectedId);
  const stopDialog = useRunsStore((s) => s.stopDialog);
  const announce = useRunsStore((s) => s.announce);

  /* ── Lifecycle: bridge ticker + load + URL intents ─────────────────── */
  useEffect(() => {
    setRunsScreenActive(true);
    const seed = params.get('seed');
    const mode: SeedMode =
      import.meta.env.DEV && (seed === 'none' || seed === 'stress')
        ? seed
        : 'default';
    if (mode !== 'default') useRunsStore.getState().reseed(mode);
    else void useRunsStore.getState().load();
    return () => setRunsScreenActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const status = params.get('status');
    const action = params.get('action');
    if (!status && !action) return;
    if (status && VALID_STATUS.has(status)) {
      useRunsStore.getState().setStatusFilter(status as StatusFilter);
    }
    if (action === 'stop-all') useRunsStore.getState().requestKillAll();
    const next = new URLSearchParams(params);
    next.delete('status');
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  /* ── Derived data (memoised on structure + coarse clock) ───────────── */
  // 1 s while anything is live (durations/sort/stats move), 15 s idle.
  const clockKey =
    inProgressCount > 0 ? Math.floor(clock / 1000) : Math.floor(clock / 15_000);
  const base = useMemo(
    () => selectBase(useRunsStore.getState(), clock),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listVersion, search, dateRange, clockKey]
  );
  const counts = useMemo(() => statusCounts(base), [base]);
  const liveSortKey =
    LIVE_SORT_COLUMNS.has(sort.col) && inProgressCount > 0 ? clockKey : 0;
  const visible = useMemo(
    () =>
      sortRuns(
        base.filter((r) => matchesStatus(r, statusFilter)),
        sort,
        clock
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, statusFilter, sort, liveSortKey]
  );
  const stats = useMemo(
    () => aggregate(Object.values(useRunsStore.getState().runs), clock),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listVersion, clockKey]
  );
  const surfaces = useMemo(
    () =>
      surfaceCounts(
        Object.values(useRunsStore.getState().runs).filter((r) =>
          inProgress(r.status)
        )
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listVersion, inProgressCount]
  );
  const totalInRange = base.length;
  const hasAnyRun = useRunsStore((s) => Object.keys(s.runs).length > 0);

  /* ── Keyboard (brief §4.8) ─────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      const st = useRunsStore.getState();
      if (st.stopDialog) return; // the alertdialog owns the keyboard
      // Any other open layer owns the keyboard too: Radix menus, the
      // approval modal (a demo run's approval span raises it app-wide),
      // the palette, settings dialogs.
      if (
        document.querySelector(
          '[data-slot$="-menu-content"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [cmdk-root]'
        ) ||
        target?.closest('[role="dialog"], [role="alertdialog"]')
      )
        return;

      if (e.key === 'Escape') {
        if (typing && target) {
          target.blur();
          return;
        }
        if (st.selectedId) st.select(null);
        else if (st.search) st.setSearch('');
        return;
      }
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      // ⌘⇧. — emergency stop (the global chord)
      if (mod && e.shiftKey && (e.key === '.' || e.key === '>')) {
        e.preventDefault();
        st.requestKillAll();
        return;
      }
      if (mod || e.altKey) return;

      const idx = st.selectedId
        ? visible.findIndex((r) => r.id === st.selectedId)
        : -1;
      const selectAt = (i: number): void => {
        const row = visible[Math.max(0, Math.min(visible.length - 1, i))];
        if (!row) return;
        st.select(row.id);
        const at = visible.indexOf(row);
        listRef.current?.scrollToRow({ index: at, align: 'auto' });
      };

      switch (e.key) {
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        case 'ArrowDown':
          e.preventDefault();
          selectAt(idx < 0 ? 0 : idx + 1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          selectAt(idx < 0 ? 0 : idx - 1);
          return;
        case 'Home':
          e.preventDefault();
          selectAt(0);
          return;
        case 'End':
          e.preventDefault();
          selectAt(visible.length - 1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          st.cycleStatusFilter(1);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          st.cycleStatusFilter(-1);
          return;
        case 'Enter':
          if (st.selectedId) {
            e.preventDefault();
            navigate(`/brain/${st.selectedId}`);
          }
          return;
        case ' ':
          if (st.selectedId) {
            e.preventDefault();
            st.requestKill(st.selectedId);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (st.selectedId) {
            e.preventDefault();
            st.archive(st.selectedId);
          }
          return;
        case 's':
        case 'S':
          e.preventDefault();
          st.requestKillAll();
          return;
        case 'r':
        case 'R':
          e.preventDefault();
          st.reseed('default');
          toast('Refreshed', {
            description: isTauri()
              ? 'Asked the shell for its run list.'
              : undefined,
          });
          return;
        case 'e':
        case 'E':
          e.preventDefault();
          void st.exportCsv();
          return;
        case 'c':
        case 'C':
          e.preventDefault();
          st.toggleCharts();
          return;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          e.preventDefault();
          const f = STATUS_FILTERS[Number(e.key) - 1];
          if (f) st.setStatusFilter(f);
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, navigate]);

  // Keep a keyboard-selected row visible after re-sorts.
  useEffect(() => {
    if (!selectedId) return;
    const i = visible.findIndex((r) => r.id === selectedId);
    if (i >= 0) listRef.current?.scrollToRow({ index: i, align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, statusFilter]);

  const showSkeleton = loading && !loaded;
  const showFresh = loaded && !hasAnyRun;
  const showFiltered = loaded && hasAnyRun && visible.length === 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-screen="runs">
      {/* Sticky top: header + filters */}
      <div className="bg-bg-void sticky top-0 z-20 shrink-0">
        <RunsHeader total={totalInRange} range={dateRange} />
        <FilterRow
          ref={searchRef}
          counts={counts}
          visibleCount={visible.length}
        />
      </div>

      {error && <ErrorBanner message={error} />}

      <SurfaceChips counts={surfaces} show={inProgressCount > 0} />
      <StatsBar stats={stats} />
      <RunCharts open={chartsOpen} rows={visible} now={clock} />

      {/* Table region */}
      <div className="min-h-[220px] flex-1 px-4 pt-3 pb-4">
        <div className="border-border-subtle bg-bg-ink h-full min-h-0 overflow-x-auto overflow-y-hidden rounded-lg border">
          {showSkeleton ? (
            <RunsSkeleton />
          ) : showFresh ? (
            <EmptyFresh />
          ) : showFiltered ? (
            <EmptyFiltered />
          ) : (
            <RunsTable
              rows={visible}
              clock={clock}
              sort={sort}
              listRef={listRef}
            />
          )}
        </div>
      </div>

      <StopDialog />
      {/* Polite announcer for list transitions (toasts are visual only). */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announce?.text}
      </div>
      {/* Keeps the dialog-open check cheap for the key handler. */}
      <span hidden data-stop-dialog={stopDialog ? 'open' : 'closed'} />
    </div>
  );
}
