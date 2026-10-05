/*
 * Brain · virtualized trace tree (Phase 9, brief §4c).
 *
 * react-window v2 `List` over a precomputed "visible rows" array (DFS order
 * of expanded nodes, or search-matches + dimmed ancestors). Row height
 * 28px, 46px when selected (metadata second line). The 10k-node stress run
 * scrolls at 60fps because only ~30 rows mount.
 */
/* eslint-disable react-refresh/only-export-components -- leaf tree module:
   the list, its row, and the scroll/seen helpers are one cohesive API. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  FileText,
  Globe,
  Loader2,
  Pause,
  Shield,
  Terminal,
  User,
  Wrench,
  XCircle,
  CircleSlash,
} from 'lucide-react';
import { List, type ListImperativeAPI } from 'react-window';

import {
  CATEGORY_LABEL,
  type SpanCategory,
  type SpanStatus,
} from '@/brain/types';
import { fmtDuration, fmtTokens, fmtUsd } from '@/brain/format';
import { cn } from '@/lib/utils';
import { useBrainStore } from '@/stores/brainStore';

export const ROW_H = 28;
export const ROW_H_SELECTED = 46;

/* ── Visible rows derivation ──────────────────────────────────────────── */

export interface TreeRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** Search mode: shown but not a match (ancestor of a match). */
  dimmed: boolean;
  /** Search mode: name contains the query. */
  match: boolean;
}

/**
 * Derive the visible row array from the store. Memoised on the exact inputs
 * that change it (spans ref, expanded set, search, root) — a 10k run
 * recomputes in well under a millisecond, 10Hz at most while a span ticks.
 */
export function useVisibleRows(runId: string | undefined): TreeRow[] {
  const spans = useBrainStore((s) =>
    runId ? s.data[runId]?.spans : undefined
  );
  const childrenByParent = useBrainStore((s) =>
    runId ? s.data[runId]?.childrenByParent : undefined
  );
  const expanded = useBrainStore((s) =>
    runId ? s.data[runId]?.expanded : undefined
  );
  const rootId = useBrainStore((s) =>
    runId ? s.runs[runId]?.rootSpanId : undefined
  );
  const search = useBrainStore((s) => s.search);

  return useMemo(() => {
    if (!spans || !childrenByParent || !expanded || !rootId) return [];
    const rows: TreeRow[] = [];
    const query = search.trim().toLowerCase();

    const pushRow = (
      id: string,
      depth: number,
      forced: boolean,
      match: boolean
    ): void => {
      const sp = spans[id];
      if (!sp) return;
      const kids = childrenByParent[id];
      const hasChildren = !!kids && kids.length > 0;
      const isExpanded = forced || expanded.has(id);
      rows.push({
        id,
        depth,
        hasChildren,
        isExpanded,
        dimmed: !!query && !match,
        match,
      });
      if (hasChildren && isExpanded) {
        for (const k of kids) pushRow(k, depth + 1, forced, false);
      }
    };

    if (!query) {
      pushRow(rootId, 0, false, false);
    } else {
      const keep = new Set<string>();
      const matchIds = new Set<string>();
      for (const sp of Object.values(spans)) {
        if (
          sp.name.toLowerCase().includes(query) ||
          sp.id.toLowerCase().includes(query)
        ) {
          matchIds.add(sp.id);
          keep.add(sp.id);
          let p: string | null = sp.parentId;
          while (p) {
            keep.add(p);
            p = spans[p]?.parentId ?? null;
          }
        }
      }
      const walk = (id: string, depth: number): void => {
        if (!keep.has(id)) return;
        const sp = spans[id];
        if (!sp) return;
        const kids = childrenByParent[id];
        const hasChildren = !!kids && kids.length > 0;
        const match = matchIds.has(id);
        rows.push({
          id,
          depth,
          hasChildren,
          isExpanded: true,
          dimmed: !match,
          match,
        });
        if (hasChildren) {
          for (const k of kids) walk(k, depth + 1);
        }
      };
      walk(rootId, 0);
    }
    return rows;
  }, [spans, childrenByParent, expanded, rootId, search]);
}

/* ── Icons ────────────────────────────────────────────────────────────── */

const CAT_ICON: Record<SpanCategory, typeof Brain> = {
  llm: Brain,
  tool: Wrench,
  file: FileText,
  network: Globe,
  shell: Terminal,
  approval: Shield,
  user: User,
  agent: Cpu,
  subagent: Cpu,
};

const MONO_CATS: ReadonlySet<SpanCategory> = new Set([
  'tool',
  'file',
  'network',
  'shell',
  'approval',
]);

export function catColor(category: SpanCategory): string {
  return `var(--cat-${category === 'subagent' ? 'agent' : category})`;
}

function StatusIcon({ status }: { status: SpanStatus }) {
  switch (status) {
    case 'running':
      return (
        <Loader2
          aria-label="running"
          className="text-accent size-3.5 shrink-0 animate-spin"
          strokeWidth={1.5}
        />
      );
    case 'completed':
      return (
        <CheckCircle2
          aria-label="completed"
          className="text-success size-3.5 shrink-0"
          strokeWidth={1.5}
        />
      );
    case 'failed':
      return (
        <XCircle
          aria-label="failed"
          className="text-danger size-3.5 shrink-0"
          strokeWidth={1.5}
        />
      );
    case 'waiting':
      return (
        <Pause
          aria-label="waiting approval"
          className="text-warning size-3.5 shrink-0"
          strokeWidth={1.5}
        />
      );
    case 'killed':
      return (
        <CircleSlash
          aria-label="killed"
          className="text-text-tertiary size-3.5 shrink-0"
          strokeWidth={1.5}
        />
      );
    case 'pending':
    default:
      return (
        <Clock
          aria-label="pending"
          className="text-text-tertiary size-3.5 shrink-0"
          strokeWidth={1.5}
        />
      );
  }
}

/* ── Live elapsed badge (100ms tick while a span runs) ───────────────── */

function LiveElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  return <>{fmtDuration(now - since)}</>;
}

/* ── Row ──────────────────────────────────────────────────────────────── */

export interface RowData {
  runId: string;
  rows: TreeRow[];
  selectedSpanId: string | null;
  focusedRow: number;
  runningSpanId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

interface RowElementProps extends RowData {
  index: number;
  style: React.CSSProperties;
  ariaAttributes: Record<string, unknown>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="text-accent rounded-sm bg-transparent px-0">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

function TraceRow({ index, style, ariaAttributes, ...data }: RowElementProps) {
  const {
    runId,
    rows,
    selectedSpanId,
    focusedRow,
    runningSpanId,
    onSelect,
    onToggle,
  } = data;
  const row = rows[index];
  const span = useBrainStore((s) =>
    runId ? s.data[runId]?.spans[row.id] : undefined
  );
  const query = useBrainStore((s) => s.search.trim());
  const reduced = useReducedMotion();
  if (!row || !span) return null;

  const Icon = CAT_ICON[span.category];
  const color = catColor(span.category);
  const indent = 8 + row.depth * 16;
  const selected = row.id === selectedSpanId;
  const running = row.id === runningSpanId;
  const h = selected ? ROW_H_SELECTED : ROW_H;

  const meta =
    span.model && (span.tokensIn != null || span.tokensOut != null)
      ? `${span.model} · in ${fmtTokens(span.tokensIn ?? 0)} · out ${fmtTokens(
          span.tokensOut
        )}${(span.costUsd ?? 0) > 0.005 ? ` · ${fmtUsd(span.costUsd)}` : ''}`
      : typeof span.metadata === 'object' && span.metadata
        ? String(
            (span.metadata as Record<string, unknown>).path ??
              (span.metadata as Record<string, unknown>).url ??
              (span.metadata as Record<string, unknown>).command ??
              ''
          ) || undefined
        : undefined;

  const duration =
    span.status === 'running' ? (
      <LiveElapsed since={span.startedAt} />
    ) : (
      fmtDuration(span.durationMs)
    );

  const tokBadge =
    span.category === 'llm' && (span.tokensOut ?? 0) > 0
      ? ` ${fmtTokens(span.tokensOut)} tok`
      : '';
  const costBadge =
    (span.costUsd ?? 0) > 0.005 ? ` ${fmtUsd(span.costUsd)}` : '';

  const appeared = !firstSeen.has(row.id);

  return (
    // Outer plain div: react-window positions rows with `transform`, which a
    // motion.div would hijack for its own animation — so the entrance anim
    // lives on the INNER div and never fights the list positioning.
    <div
      {...ariaAttributes}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={index + 1}
      aria-setsize={rows.length}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-selected={selected}
      aria-label={`${CATEGORY_LABEL[span.category]}: ${span.name} — ${span.status}`}
      data-xr-row={row.id}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect(row.id);
      }}
      style={{ ...style, height: h }}
    >
      <motion.div
        initial={
          appeared && !reduced
            ? { opacity: 0, y: -8 }
            : appeared
              ? { opacity: 0 }
              : false
        }
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0.12 }
            : { type: 'spring', stiffness: 300, damping: 28 }
        }
        className={cn(
          'group relative flex h-full w-full text-left select-none',
          'cursor-default',
          selected ? 'bg-bg-raised' : 'hover:bg-bg-raised/50',
          index === focusedRow && 'ring-accent/40 -ring-inset ring-1'
        )}
      >
        {/* Category spine — 3px, full height, at the indent edge. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0 bottom-0 w-[3px] rounded-full',
            running && 'xr-run-pulse border border-transparent'
          )}
          style={{
            left: Math.max(0, indent - 7),
            backgroundColor: color,
            opacity: row.dimmed ? 0.35 : 0.85,
          }}
        />
        {selected && (
          <span
            aria-hidden="true"
            className={cn(
              'bg-accent absolute top-0 bottom-0 left-0 w-[2px]',
              running && 'xr-run-pulse'
            )}
          />
        )}

        <span
          className="flex shrink-0 items-center"
          style={{ width: indent }}
          aria-hidden="true"
        >
          {row.hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                row.isExpanded ? `Collapse ${span.name}` : `Expand ${span.name}`
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggle(row.id);
              }}
              className="hover:bg-bg-raised focus-visible:ring-accent -ml-1 flex h-5 w-5 items-center justify-center rounded focus-visible:ring-1 focus-visible:outline-none"
            >
              <ChevronRight
                size={14}
                strokeWidth={1.5}
                className={cn(
                  'text-text-tertiary transition-transform duration-150',
                  row.isExpanded && 'rotate-90'
                )}
              />
            </button>
          ) : (
            <span className="w-3.5" />
          )}
        </span>

        <StatusIcon status={span.status} />
        <Icon
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
          className="shrink-0"
          style={{ color: row.dimmed ? 'var(--text-tertiary)' : color }}
        />

        <span
          className={cn(
            'min-w-0 flex-1',
            selected
              ? 'flex flex-col items-start justify-center'
              : 'flex items-center'
          )}
        >
          <span
            className={cn(
              'truncate',
              selected ? 'text-[13px] leading-5' : 'text-[13px] leading-5',
              MONO_CATS.has(span.category)
                ? 'font-mono text-[12px]'
                : 'font-medium',
              row.dimmed ? 'text-text-tertiary' : 'text-text-primary'
            )}
            title={span.name}
          >
            <Highlight text={span.name} query={query.toLowerCase()} />
          </span>
          {selected && meta && (
            <span className="text-text-tertiary max-w-full truncate font-mono text-[11px] leading-4">
              {meta}
            </span>
          )}
        </span>

        <span
          className={cn(
            'bg-bg-raised border-border-subtle shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap',
            row.dimmed ? 'text-text-tertiary opacity-60' : 'text-text-secondary'
          )}
        >
          {duration}
          <span className={span.category === 'llm' ? 'text-accent' : ''}>
            {tokBadge}
            {costBadge}
          </span>
        </span>
      </motion.div>
    </div>
  );
}

/* First-seen timestamps for the one-shot entrance animation. */
const firstSeen = new Map<string, number>();
export function markSpanSeen(id: string): void {
  if (!firstSeen.has(id)) firstSeen.set(id, Date.now());
}

/* ── The list ─────────────────────────────────────────────────────────── */

interface TraceTreeProps {
  runId: string;
  rows: TreeRow[];
  selectedSpanId: string | null;
  focusedRow: number;
  runningSpanId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  listRef: { current: ListImperativeAPI | null | undefined };
}

export function TraceTree({
  runId,
  rows,
  selectedSpanId,
  focusedRow,
  runningSpanId,
  onSelect,
  onToggle,
  listRef,
}: TraceTreeProps) {
  const [height, setHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Rows animate in on first mount only; mark them seen right after.
  useEffect(() => {
    for (const r of rows) {
      if (!firstSeen.has(r.id)) markSpanSeen(r.id);
    }
  }, [rows]);

  const rowHeight = (index: number, cellProps: RowData): number => {
    const row = cellProps.rows[index];
    return row && row.id === cellProps.selectedSpanId ? ROW_H_SELECTED : ROW_H;
  };

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Trace tree"
      className="h-full w-full"
    >
      {rows.length === 0 ? (
        <div className="text-text-tertiary flex h-full items-center justify-center text-[13px]">
          Run has no spans yet
        </div>
      ) : (
        <List<RowData>
          rowComponent={TraceRow}
          rowCount={rows.length}
          rowHeight={rowHeight}
          rowKey={(index) => rows[index].id}
          rowProps={{
            runId,
            rows,
            selectedSpanId,
            focusedRow,
            runningSpanId,
            onSelect,
            onToggle,
          }}
          listRef={listRef as React.Ref<ListImperativeAPI>}
          overscanCount={8}
          style={{ height }}
          className="select-none"
        />
      )}
    </div>
  );
}

export function scrollTreeToRow(
  api: ListImperativeAPI | null | undefined,
  index: number,
  align: 'auto' | 'center' = 'auto'
): void {
  try {
    api?.scrollToRow({ index, align, behavior: 'instant' });
  } catch {
    /* row may not exist yet */
  }
}
