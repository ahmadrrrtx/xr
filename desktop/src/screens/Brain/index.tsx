/*
 * Brain — the proof-of-trust screen (Phase 9, brief §4–§5).
 *
 *   /brain          → hero + recent runs + "Start a demo run"
 *   /brain/:runId   → header (id/title/status/tokens/cost/actions) + tabs
 *                     (Trace / Timeline / Events / Cost / Logs) + resizable
 *                     split: virtualized tree | Gantt + detail panel.
 *
 * Everything renders from mock data (honest: the button says "demo");
 * the store's StreamHooks seam is where Phase 14's real runtime plugs in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Brain as BrainIcon,
  Eye,
  Maximize2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Square,
  Target,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { useListRef } from 'react-window';

import { DetailPanel } from '@/brain/detail';
import { Gantt } from '@/brain/gantt';
import {
  fmtClock,
  fmtClockTime,
  fmtDuration,
  fmtRelative,
  fmtTokens,
  fmtUsd,
} from '@/brain/format';
import { CostTab, EventsTab, LogsTab, TimelineTab } from '@/brain/tabs';
import {
  scrollTreeToRow,
  TraceTree,
  useVisibleRows,
  type TreeRow,
} from '@/brain/tree';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  type BrainTab,
  type SpanStatus,
} from '@/brain/types';
import { Resizer } from '@/components/Resizer';
import { ConfirmDialog } from '@/components/settings/dialogs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useBrainStore,
  useRunningSpanId,
  useRun,
  useTweenNumber,
} from '@/stores/brainStore';

export default function BrainScreen() {
  const { runId } = useParams<{ runId?: string }>();
  if (!runId) return <BrainIndex />;
  return <BrainRun runId={runId} />;
}

/* ══════════════════════════════════════════════════════════════════════
 * Index (/brain) — brief §5
 * ══════════════════════════════════════════════════════════════════════ */

const RECENT_FLAVORS: {
  id: string;
  shortId: string;
  title: string;
  agent: string;
  model: string;
  status: SpanStatus;
  startedAgo: number;
  durationMs: number;
  cost: number;
}[] = [
  {
    id: 'mock-medium',
    shortId: '#847',
    title: 'Summarize Q3 reports',
    agent: 'Main',
    model: 'gpt-4o',
    status: 'completed',
    startedAgo: 12 * 60_000,
    durationMs: 27_400,
    cost: 0.187,
  },
  {
    id: 'mock-error',
    shortId: '#303',
    title: 'Deploy staging build',
    agent: 'Coder',
    model: 'gpt-4o',
    status: 'failed',
    startedAgo: 41 * 60_000,
    durationMs: 9_600,
    cost: 0.031,
  },
  {
    id: 'mock-long',
    shortId: '#512',
    title: 'Research: agentic AI trust in Q3',
    agent: 'Research',
    model: 'gpt-4o',
    status: 'completed',
    startedAgo: 3 * 3_600_000,
    durationMs: 90_000,
    cost: 0.942,
  },
  {
    id: 'mock-waiting',
    shortId: '#847',
    title: 'Summarize Q3 reports',
    agent: 'Main',
    model: 'gpt-4o',
    status: 'waiting',
    startedAgo: 4 * 60_000,
    durationMs: 17_200,
    cost: 0.104,
  },
  {
    id: 'mock-short',
    shortId: '#101',
    title: 'Quick question: best way to log spans',
    agent: 'Main',
    model: 'gpt-4o-mini',
    status: 'completed',
    startedAgo: 6 * 3_600_000,
    durationMs: 4_600,
    cost: 0.002,
  },
  {
    id: 'mock-stress',
    shortId: '#900',
    title: 'Stress: 10,000-span ingest',
    agent: 'Main',
    model: 'gpt-4o-mini',
    status: 'completed',
    startedAgo: 26 * 3_600_000,
    durationMs: 30_000,
    cost: 0.31,
  },
];

// The index table is a snapshot (not a live view) — capture "now" once so
// render stays pure (same convention as SessionList's MOUNT_NOW).
const MOUNT_NOW = Date.now();

function BrainIndex() {
  const navigate = useNavigate();
  const runOrder = useBrainStore((s) => s.runOrder);
  const runs = useBrainStore((s) => s.runs);
  const startMockRun = useBrainStore((s) => s.startMockRun);
  const reduced = useReducedMotion();

  const startDemo = (): void => {
    const id = startMockRun();
    navigate(`/brain/${id}`);
  };

  // Recent runs = this session's real store entries, then the canned mocks
  // (which seed the list until the user has their own history).
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof RECENT_FLAVORS = [];
    for (const id of runOrder) {
      const r = runs[id];
      if (!r || seen.has(r.shortId)) continue;
      seen.add(r.shortId);
      out.push({
        id: r.id,
        shortId: r.shortId,
        title: r.title,
        agent: r.agent,
        model: r.model,
        status: r.status,
        startedAgo: MOUNT_NOW - r.startedAt,
        durationMs: r.endedAt
          ? r.endedAt - r.startedAt
          : MOUNT_NOW - r.startedAt,
        cost: r.costUsd,
      });
    }
    for (const c of RECENT_FLAVORS) {
      if (seen.has(c.shortId) || out.length >= 10) continue;
      seen.add(c.shortId);
      out.push(c);
    }
    return out.slice(0, 10);
  }, [runOrder, runs]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col items-center pt-10 pb-16">
      {/* Hero */}
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col items-center text-center"
      >
        <span
          className="text-accent mb-4 inline-flex"
          style={{ filter: 'drop-shadow(0 0 12px var(--accent-glow))' }}
        >
          <BrainIcon size={56} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 className="font-display text-[28px] leading-tight font-bold tracking-wide">
          Brain
        </h1>
        <p className="text-text-tertiary mt-1 text-[13px]">
          Watch XR think, step by step.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button
            onClick={startDemo}
            aria-label="Start a demo run"
            className="h-9 gap-2 px-4 text-[13px]"
          >
            <Play size={14} strokeWidth={1.5} aria-hidden="true" />
            Start a demo run
          </Button>
          <button
            type="button"
            onClick={() =>
              toast(
                'The trust model ships with the docs in Phase 12 (Shield).',
                {
                  description:
                    'For now: every span, input, output, approval and cost is visible in the trace.',
                }
              )
            }
            className="text-text-secondary hover:text-text-primary px-2 py-1 text-[12px] underline underline-offset-2"
          >
            Learn about XR's trust model
          </button>
        </div>
      </motion.div>

      {/* Recent runs */}
      <div className="mt-12 w-full max-w-[720px]">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="text-text-tertiary font-mono text-[11px] tracking-wider uppercase">
            Recent runs
          </div>
          {/* Phase 11: the full history lives in the Control Room. */}
          <button
            type="button"
            onClick={() => navigate('/runs')}
            className="text-text-secondary hover:text-text-primary text-[12px] underline-offset-2 hover:underline"
          >
            All runs in Control Room →
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="border-border-subtle bg-bg-ink rounded-lg border p-6 text-center">
            <p className="text-text-secondary text-[13px]">
              No runs yet. Start a demo run above or use XR in Chat to begin.
            </p>
          </div>
        ) : (
          <div className="border-border-subtle bg-bg-ink overflow-hidden rounded-lg border">
            <div className="border-border-subtle grid grid-cols-[56px_minmax(0,1.6fr)_64px_84px_88px_84px_64px_64px_32px] items-center gap-2 border-b px-3 py-1.5 font-mono text-[10px] tracking-wide uppercase">
              <span className="text-text-tertiary">ID</span>
              <span className="text-text-tertiary">Title</span>
              <span className="text-text-tertiary">Agent</span>
              <span className="text-text-tertiary">Model</span>
              <span className="text-text-tertiary">Status</span>
              <span className="text-text-tertiary">Started</span>
              <span className="text-text-tertiary">Duration</span>
              <span className="text-text-tertiary text-right">Cost</span>
              <span />
            </div>
            {recent.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/brain/${r.id}`)}
                className="border-border-subtle hover:bg-bg-raised grid w-full grid-cols-[56px_minmax(0,1.6fr)_64px_84px_88px_84px_64px_64px_32px] items-center gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0"
                aria-label={`Open run ${r.shortId}: ${r.title}`}
              >
                <span className="bg-bg-raised rounded px-1.5 py-0.5 text-center font-mono text-[11px]">
                  {r.shortId}
                </span>
                <span className="truncate text-[13px]">{r.title}</span>
                <span className="text-text-secondary truncate text-[12px]">
                  {r.agent}
                </span>
                <span className="text-text-secondary truncate font-mono text-[11px]">
                  {r.model}
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusDot
                    status={r.status}
                    pulse={r.status === 'running' || r.status === 'waiting'}
                  />
                  <span className="text-text-secondary truncate text-[11px]">
                    {STATUS_LABEL[r.status]}
                  </span>
                </span>
                <span className="text-text-tertiary font-mono text-[11px]">
                  {fmtRelative(MOUNT_NOW - r.startedAgo, MOUNT_NOW)}
                </span>
                <span className="text-text-tertiary font-mono text-[11px]">
                  {fmtDuration(r.durationMs)}
                </span>
                <span className="text-text-secondary text-right font-mono text-[11px]">
                  {fmtUsd(r.cost)}
                </span>
                <span className="flex justify-end">
                  <Eye
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="text-text-tertiary"
                  />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * Status dot (shared by index + run header)
 * ══════════════════════════════════════════════════════════════════════ */

const DOT_COLOR: Record<SpanStatus, string> = {
  running: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  waiting: 'var(--warning)',
  killed: 'var(--text-tertiary)',
  pending: 'var(--text-tertiary)',
};

function StatusDot({
  status,
  pulse = false,
}: {
  status: SpanStatus;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        pulse && 'xr-dot-pulse'
      )}
      style={{ backgroundColor: DOT_COLOR[status] }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * Run view (/brain/:runId)
 * ══════════════════════════════════════════════════════════════════════ */

const TABS: { id: BrainTab; label: string }[] = [
  { id: 'trace', label: 'Trace' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'events', label: 'Events' },
  { id: 'cost', label: 'Cost' },
  { id: 'logs', label: 'Logs' },
];

function BrainRun({ runId }: { runId: string }) {
  const run = useRun(runId);
  const loadRun = useBrainStore((s) => s.loadRun);
  const activeTab = useBrainStore((s) => s.activeTab);
  const setTab = useBrainStore((s) => s.setTab);
  const search = useBrainStore((s) => s.search);
  const setSearch = useBrainStore((s) => s.setSearch);
  const follow = useBrainStore((s) => s.followRunning);
  const toggleFollow = useBrainStore((s) => s.toggleFollow);
  const selectedSpanId = useBrainStore((s) => s.selectedSpanId);
  const selectSpan = useBrainStore((s) => s.selectSpan);
  const toggleExpanded = useBrainStore((s) => s.toggleExpanded);
  const expandTo = useBrainStore((s) => s.expandTo);
  const zoom = useBrainStore((s) => s.ganttZoom);
  const setZoom = useBrainStore((s) => s.setZoom);
  const resetView = useBrainStore((s) => s.resetView);
  const stopRun = useBrainStore((s) => s.stopRun);
  const restartRun = useBrainStore((s) => s.restartRun);
  const exportJson = useBrainStore((s) => s.exportJson);
  const announce = useBrainStore((s) => s.announce);
  const runningSpanId = useRunningSpanId(runId);
  const spans = useBrainStore((s) => s.data[runId]?.spans);

  const rows = useVisibleRows(runId);
  const treeListRef = useListRef();

  /* ── Load on mount / id change ─────────────────────────────────────── */
  useEffect(() => {
    void loadRun(runId);
  }, [runId, loadRun]);

  /* ── Search input + focus plumbing ─────────────────────────────────── */
  const searchRef = useRef<HTMLInputElement | null>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  /* ── Keyboard focus row (tree nav) ─────────────────────────────────── */
  const [focusRow, setFocusRow] = useState(-1);

  const rowByIdx = useCallback(
    (i: number): TreeRow | undefined => rows[i],
    [rows]
  );

  /* ── Follow the running node (debounced so it never fights the user) ── */
  useEffect(() => {
    if (!follow || !runningSpanId) return;
    const idx = rows.findIndex((r) => r.id === runningSpanId);
    if (idx < 0) return;
    const t = window.setTimeout(() => {
      scrollTreeToRow(treeListRef.current, idx, 'auto');
    }, 100);
    return () => window.clearTimeout(t);
  }, [follow, runningSpanId, rows, treeListRef]);

  /* ── Confirm dialogs ───────────────────────────────────────────────── */
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);

  const requestStop = useCallback((): void => {
    if (!run || (run.status !== 'running' && run.status !== 'waiting')) return;
    setConfirm('stop');
  }, [run]);

  const requestRestart = useCallback((): void => {
    if (!run) return;
    if (run.status === 'running' || run.status === 'waiting')
      setConfirm('restart');
    else restartRun(runId);
  }, [run, restartRun, runId]);

  /* ── Screen-level keyboard map (brief §11) ─────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const dialogOpen = !!document.querySelector(
        '[role="dialog"], [role="alertdialog"]'
      );

      if (e.key === 'Escape') {
        if (dialogOpen) return; // the dialog handles its own Esc
        if (typing) {
          if (target === searchRef.current && search) {
            // First Esc clears the filter; a second Esc (now empty) blurs.
            e.preventDefault();
            setSearch('');
            return;
          }
          (target as HTMLInputElement).blur();
          return;
        }
        selectSpan(null);
        return;
      }
      if (typing || dialogOpen) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        if (e.key === 'e' || e.key === 'E') {
          e.preventDefault();
          exportJson(runId);
          return;
        }
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoom(zoom * 1.25);
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          setZoom(zoom / 1.25);
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          resetView();
          return;
        }
        return;
      }

      switch (e.key) {
        case '/':
          e.preventDefault();
          focusSearch();
          return;
        case 's':
        case 'S':
          requestStop();
          return;
        case 'r':
        case 'R':
          requestRestart();
          return;
        case ' ':
          if (focusRow >= 0 && rows[focusRow]) {
            e.preventDefault();
            selectSpan(rows[focusRow].id);
          }
          return;
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(rows.length - 1, focusRow + 1);
          if (next !== focusRow) {
            setFocusRow(next);
            scrollTreeToRow(treeListRef.current, next, 'auto');
          }
          return;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const next = Math.max(0, focusRow - 1);
          if (next !== focusRow) {
            setFocusRow(next);
            scrollTreeToRow(treeListRef.current, next, 'auto');
          }
          return;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const row = rowByIdx(focusRow);
          if (!row) return;
          if (row.hasChildren && !row.isExpanded) {
            toggleExpanded(runId, row.id);
            return;
          }
          // Descend to first child: next row with depth+1.
          for (let i = focusRow + 1; i < rows.length; i++) {
            if (rows[i].depth > row.depth) {
              setFocusRow(i);
              scrollTreeToRow(treeListRef.current, i, 'auto');
              return;
            }
            if (rows[i].depth <= row.depth) break;
          }
          return;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const row = rowByIdx(focusRow);
          if (!row) return;
          if (row.hasChildren && row.isExpanded) {
            toggleExpanded(runId, row.id);
            return;
          }
          // Ascend to parent: previous row with depth-1.
          for (let i = focusRow - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              setFocusRow(i);
              scrollTreeToRow(treeListRef.current, i, 'auto');
              return;
            }
            if (rows[i].depth > row.depth) break;
          }
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    exportJson,
    focusRow,
    focusSearch,
    resetView,
    requestRestart,
    requestStop,
    rows,
    rowByIdx,
    runId,
    search,
    selectSpan,
    setSearch,
    setZoom,
    toggleExpanded,
    treeListRef,
    zoom,
  ]);

  /* ── Resizable split (persisted) ───────────────────────────────────── */
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState({ w: 0, h: 0 });
  const [leftW, setLeftW] = useState(0);
  const [ganttH, setGanttH] = useState(0);
  const initSplit = useRef(false);

  // The split row only exists once `run` resolves (RunLoading before that),
  // so attach the observer in the same phase — a mount-only effect would see
  // a null ref and the pane would stay at width 0.
  const hasRun = run != null;
  useEffect(() => {
    const el = splitRef.current;
    if (!el || !hasRun) return;
    const ro = new ResizeObserver(() =>
      setSplit({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setSplit({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [hasRun]);

  useEffect(() => {
    if (initSplit.current || split.w === 0 || split.h === 0) return;
    initSplit.current = true;
    setLeftW(Math.round(split.w * 0.55));
    setGanttH(Math.round(split.h * 0.4));
  }, [split]);

  /* ── Render ────────────────────────────────────────────────────────── */
  if (!run) {
    return <RunLoading />;
  }

  const selectedSpan = selectedSpanId
    ? (spans?.[selectedSpanId] ?? null)
    : null;
  const live = run.status === 'running' || run.status === 'waiting';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Row 1: identity + live counters + actions ─────────────────── */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="bg-bg-raised border-border-subtle shrink-0 rounded px-2 py-0.5 font-mono text-[11px]">
          {run.shortId}
        </span>
        <span className="min-w-0 truncate text-[15px] font-semibold">
          {run.title}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--cat-agent) 15%, transparent)',
            color: 'var(--cat-agent)',
          }}
        >
          {run.agent}
        </span>
        <span className="bg-bg-raised text-text-secondary hidden shrink-0 rounded px-2 py-0.5 font-mono text-[11px] sm:inline">
          {run.model}
        </span>
        {run.workspace && (
          <span className="text-text-tertiary hidden shrink-0 font-mono text-[11px] md:inline">
            {run.workspace}
          </span>
        )}

        <span className="ml-1 flex shrink-0 items-center gap-1.5">
          <StatusDot status={run.status} pulse={live} />
          <span className="text-text-secondary text-[12px]">
            {STATUS_LABEL[run.status]}
          </span>
        </span>

        {/* Live counters */}
        <span className="text-text-secondary ml-auto hidden shrink-0 items-center gap-3 font-mono text-[12px] lg:flex">
          <span title="Started at">
            {fmtClockTime(run.startedAt)}
            <span className="text-text-tertiary"> · </span>
            <Elapsed
              startedAt={run.startedAt}
              endedAt={run.endedAt}
              live={live}
            />
          </span>
          <span title="Tokens in / out">
            <TokenCounter n={run.tokensIn} label="in" />
            <span className="text-text-tertiary"> / </span>
            <TokenCounter n={run.tokensOut} label="out" />
          </span>
          <span className="text-accent" title="Cumulative cost">
            <CostTween value={run.costUsd} />
          </span>
        </span>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 pl-2">
          <button
            type="button"
            disabled={!live}
            onClick={requestStop}
            aria-label={`Stop run ${run.shortId} (S)`}
            title="Stop run (S)"
            className={cn(
              'h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors',
              'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
              live
                ? 'border-danger/50 text-danger hover:bg-danger/10'
                : 'border-border-subtle text-text-tertiary cursor-not-allowed'
            )}
          >
            <Square size={12} strokeWidth={1.5} aria-hidden="true" />
            Stop
          </button>
          <button
            type="button"
            onClick={requestRestart}
            aria-label={`Restart run ${run.shortId} (R)`}
            title="Restart run (R)"
            className="text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] focus-visible:ring-2 focus-visible:outline-none"
          >
            <RotateCcw size={12} strokeWidth={1.5} aria-hidden="true" />
            Restart
          </button>
          <button
            type="button"
            onClick={() =>
              toast('Share link copied', { description: `xr://brain/${runId}` })
            }
            aria-label={`Share run ${run.shortId}`}
            title="Share run"
            className="text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent hidden h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] focus-visible:ring-2 focus-visible:outline-none md:flex"
          >
            <Share2 size={12} strokeWidth={1.5} aria-hidden="true" />
            Share
          </button>
          <button
            type="button"
            onClick={() => exportJson(runId)}
            aria-label={`Export run ${run.shortId} as JSON (⌘E)`}
            title="Export JSON (⌘E)"
            className="text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent hidden h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] focus-visible:ring-2 focus-visible:outline-none sm:flex"
          >
            <Download size={12} strokeWidth={1.5} aria-hidden="true" />
            Export
          </button>
        </div>
      </div>

      {/* ── Row 2: tabs + search + follow ─────────────────────────────── */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <nav aria-label="Brain views" className="flex h-full items-stretch">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={activeTab === t.id ? 'page' : undefined}
              className={cn(
                'relative flex items-center px-3 text-[13px] transition-colors',
                activeTab === t.id
                  ? 'text-text-primary font-medium'
                  : 'text-text-tertiary hover:text-text-secondary'
              )}
            >
              {t.label}
              {activeTab === t.id && (
                <span
                  aria-hidden="true"
                  className="bg-accent absolute right-2 -bottom-[1px] left-2 h-[1.5px] rounded-full"
                  style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
                />
              )}
            </button>
          ))}
        </nav>

        {/* Legend — decode the category colors at a glance */}
        <span
          className="ml-4 hidden items-center gap-3 xl:flex"
          aria-hidden="true"
        >
          {(
            ['llm', 'tool', 'file', 'network', 'shell', 'approval'] as const
          ).map((c) => (
            <span key={c} className="flex items-center gap-1">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: `var(--cat-${c})` }}
              />
              <span className="text-text-tertiary font-mono text-[10px]">
                {CATEGORY_LABEL[c]}
              </span>
            </span>
          ))}
        </span>

        {/* Search + follow */}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              strokeWidth={1.5}
              aria-hidden="true"
              className="text-text-tertiary pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
            />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter spans…  ( / )"
              aria-label="Filter spans"
              className="border-input text-text-primary placeholder:text-text-tertiary focus-visible:border-ring focus-visible:ring-ring/50 h-7 w-[200px] rounded-md border bg-transparent pr-2 pl-7 font-mono text-[12px] outline-none"
            />
          </div>
          <button
            type="button"
            onClick={toggleFollow}
            aria-pressed={follow}
            aria-label={
              follow
                ? 'Stop following the running span'
                : 'Follow the running span'
            }
            title="Follow the running span"
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors',
              'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
              follow
                ? 'bg-accent/15 text-accent'
                : 'text-text-tertiary hover:bg-bg-raised'
            )}
          >
            <Target size={12} strokeWidth={1.5} aria-hidden="true" />
            Follow
          </button>
        </div>
      </div>
      <div className="border-border-subtle shrink-0 border-b" />

      {/* ── Main split ────────────────────────────────────────────────── */}
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {activeTab === 'trace' ? (
          <>
            <div style={{ width: leftW }} className="min-w-0 shrink-0">
              <TraceTree
                runId={runId}
                rows={rows}
                selectedSpanId={selectedSpanId}
                focusedRow={focusRow}
                runningSpanId={runningSpanId}
                onSelect={(id) => {
                  selectSpan(id);
                  expandTo(runId, id);
                }}
                onToggle={(id) => toggleExpanded(runId, id)}
                listRef={treeListRef}
              />
            </div>
            <Resizer
              orientation="vertical"
              storageKey="xr.brain.splitter.main"
              value={leftW}
              onChange={setLeftW}
              min={280}
              max={Math.max(280, split.w - 320)}
              defaultValue={Math.round(split.w * 0.55)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <div
                style={{ height: ganttH }}
                className="min-h-[120px] shrink-0"
              >
                <Gantt
                  runId={runId}
                  run={run}
                  rows={rows}
                  selectedSpanId={selectedSpanId}
                  onSelect={(id) => {
                    selectSpan(id);
                    expandTo(runId, id);
                  }}
                />
              </div>
              <Resizer
                orientation="horizontal"
                storageKey="xr.brain.splitter.detail"
                value={ganttH}
                onChange={setGanttH}
                min={120}
                max={Math.max(120, split.h - 160)}
                defaultValue={Math.round(split.h * 0.4)}
              />
              <div className="min-h-0 flex-1">
                <DetailPanel run={run} span={selectedSpan} />
              </div>
            </div>
          </>
        ) : activeTab === 'timeline' ? (
          <TimelineTab
            runId={runId}
            run={run}
            rows={rows}
            selectedSpanId={selectedSpanId}
            onSelect={(id) => {
              selectSpan(id);
              expandTo(runId, id);
            }}
          />
        ) : activeTab === 'events' ? (
          <EventsTab runId={runId} />
        ) : activeTab === 'cost' ? (
          <CostTab runId={runId} run={run} />
        ) : (
          <LogsTab runId={runId} />
        )}
      </div>

      {/* aria-live announcements (throttled in the store) */}
      <div className="sr-only" aria-live="polite" role="status">
        {announce?.text}
      </div>

      {/* Stop / Restart confirms */}
      <ConfirmDialog
        open={confirm === 'stop'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Stop run ${run.shortId}?`}
        body="In-flight spans are marked killed and the approval gate (if any) is withdrawn. The trace stays open."
        confirmLabel="Stop run"
        onConfirm={() => {
          stopRun(runId);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'restart'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Restart run ${run.shortId}?`}
        body="The current trace is replaced by a fresh replay of the same script."
        confirmLabel="Restart"
        onConfirm={() => {
          restartRun(runId);
          setConfirm(null);
        }}
      />

      {/* Zoom affordances for the Gantt (visible on non-Trace tabs too) */}
      {activeTab === 'timeline' && (
        <ZoomControls
          zoom={zoom}
          onIn={() => setZoom(zoom * 1.25)}
          onOut={() => setZoom(zoom / 1.25)}
          onFit={resetView}
        />
      )}
    </div>
  );
}

/* ── Small header pieces ──────────────────────────────────────────────── */

function Elapsed({
  startedAt,
  endedAt,
  live,
}: {
  startedAt: number;
  endedAt: number | null;
  live: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [live]);
  const ms = (endedAt ?? now) - startedAt;
  return (
    <span className={live ? 'text-accent' : ''}>
      {live ? fmtClock(ms) : fmtDuration(ms)}
    </span>
  );
}

function TokenCounter({ n, label }: { n: number; label: string }) {
  const v = useTweenNumber(n);
  return <span title={`${label} tokens`}>{fmtTokens(v)}</span>;
}

function CostTween({ value }: { value: number }) {
  const v = useTweenNumber(value);
  return <>{fmtUsd(v)}</>;
}

function ZoomControls({
  zoom,
  onIn,
  onOut,
  onFit,
}: {
  zoom: number;
  onIn: () => void;
  onOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="border-border-subtle bg-bg-ink absolute right-3 bottom-3 z-10 flex items-center gap-1 rounded-md border p-1">
      <button
        type="button"
        aria-label="Zoom out"
        onClick={onOut}
        className="text-text-secondary hover:bg-bg-raised flex h-6 w-6 items-center justify-center rounded"
      >
        <Minus size={13} strokeWidth={1.5} />
      </button>
      <span className="text-text-tertiary w-10 text-center font-mono text-[10px]">
        {zoom.toFixed(1)}×
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={onIn}
        className="text-text-secondary hover:bg-bg-raised flex h-6 w-6 items-center justify-center rounded"
      >
        <Plus size={13} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Fit timeline"
        onClick={onFit}
        className="text-text-secondary hover:bg-bg-raised flex h-6 w-6 items-center justify-center rounded"
      >
        <Maximize2 size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/* ── Loading skeleton (brief §4: 12 shimmer lines + skeleton Gantt) ───── */

function RunLoading() {
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      aria-busy="true"
      aria-label="Loading run"
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-5 w-14" />
        <Skeleton className="ml-auto h-5 w-40" />
      </div>
      <div className="h-9 shrink-0" />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[55%] flex-col gap-2 p-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton
                className="h-3"
                style={{ width: `${60 - (i % 5) * 8}%` }}
              />
              <Skeleton className="ml-auto h-3 w-10" />
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <Skeleton className="h-[40%] min-h-[120px]" />
          <Skeleton className="flex-1" />
        </div>
      </div>
    </div>
  );
}
