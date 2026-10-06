/*
 * Budget › Spend History (Phase 13). Filters → react-window table (32 px
 * rows, ARIA grid semantics) → sticky footer "N events · Total $X".
 * Session cells deep-link to the chat session or Brain run; the kind icon
 * explains governor decisions (blocked / downshifted / reset …) on hover.
 */
import {
  ArrowDownUp,
  Ban,
  Bot,
  Cpu,
  Download,
  ExternalLink,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  TrendingDown,
  Wrench,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  List,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window';
import { useNavigate } from 'react-router-dom';

import { fmtTokens, fmtUsd, kindLabel } from '@/budget/core';
import {
  SPEND_CATEGORIES,
  SPEND_RANGE_LABEL,
  SPEND_RANGES,
  type SpendCategory,
  type SpendEvent,
  type SpendFilter,
  type SpendKind,
  type SpendRange,
} from '@/budget/types';
import { SearchInput, Segmented, Select } from '@/components/settings/controls';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useBudgetStore } from '@/stores/budgetStore';

import { CategoryChip, EstimatePill, LocalPill } from './shared';
import { displayModel } from './model-display';

const ROW_HEIGHT = 32;
const GRID =
  'grid-cols-[150px_minmax(140px,1fr)_110px_minmax(150px,1.1fr)_96px_84px_92px_36px]';

const RANGE_OPTIONS = SPEND_RANGES.map((r) => ({
  value: r,
  label: SPEND_RANGE_LABEL[r],
}));
const KIND_OPTIONS: Array<{ value: SpendFilter['kind']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'spend', label: 'Spend' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'downshifted', label: 'Downshifted' },
];

const timeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function KindIcon({
  kind,
  category,
}: {
  kind: SpendKind;
  category: SpendCategory;
}) {
  const common = { size: 13, strokeWidth: 1.75, 'aria-hidden': true } as const;
  switch (kind) {
    case 'blocked':
      return <Ban {...common} className="text-danger" />;
    case 'downshifted':
      return <TrendingDown {...common} className="text-warning" />;
    case 'cap_set':
      return <Settings2 {...common} className="text-text-tertiary" />;
    case 'reset':
      return <RotateCcw {...common} className="text-text-tertiary" />;
    case 'paused':
      return <Pause {...common} className="text-danger" />;
    case 'resumed':
      return <Play {...common} className="text-text-tertiary" />;
    default:
      break;
  }
  const style = { color: `var(--spend-${category})` };
  if (category === 'tools') return <Wrench {...common} style={style} />;
  if (category === 'voice') return <Mic {...common} style={style} />;
  if (category === 'compute') return <Cpu {...common} style={style} />;
  return <Bot {...common} style={style} />;
}

function describe(e: SpendEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case 'blocked':
      return `Blocked (${String(d.code ?? 'cap')}) — ${String(d.reason ?? 'budget limit reached')}`;
    case 'downshifted':
      return `${String(d.from ?? '?')} → ${String(d.to ?? '?')}: ${String(d.why ?? 'cheaper model to stay within budget')}`;
    case 'cap_set':
      return `Limit set to ${fmtUsd(Number(d.monthlyLimit ?? 0))} · hard cap ${d.hardCap ? 'on' : 'off'}`;
    case 'reset':
      return `Month reset · ${fmtUsd(Number(d.spentBefore ?? 0))} archived`;
    case 'paused':
      return `Paused (${String(d.reason ?? 'manual')})${d.note ? ` — ${String(d.note)}` : ''}`;
    case 'resumed':
      return 'Spending resumed';
    case 'tool_call':
      return `Tool: ${String(d.tool ?? 'unknown')}`;
    case 'voice':
      return `Voice · ${String(d.seconds ?? '?')}s`;
    case 'compute':
      return `Compute · ${String(d.job ?? 'job')}`;
    default:
      return d.partial
        ? 'LLM call · cut off at the hard limit (partial charge)'
        : d.test
          ? 'Test charge'
          : 'LLM call';
  }
}

/* ── Row ───────────────────────────────────────────────────────────────── */

interface RowProps {
  rows: SpendEvent[];
  onOpen: (e: SpendEvent) => void;
}

function HistoryRowImpl({
  index,
  style,
  rows,
  onOpen,
}: RowComponentProps<RowProps>) {
  const e = rows[index];
  const info = e.model ? displayModel(e.model) : null;
  const linkable = Boolean(e.sessionId);
  const decision = e.kind === 'blocked' || e.kind === 'downshifted';
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      style={style}
      data-testid="spend-row"
      data-kind={e.kind}
      className={cn(
        'border-border-subtle/60 grid items-center gap-2 border-b px-4 text-[12px]',
        GRID,
        e.kind === 'blocked' &&
          'bg-[color-mix(in_oklab,var(--danger)_4%,transparent)]'
      )}
    >
      <span role="cell" className="text-text-secondary font-mono tabular-nums">
        {timeFmt.format(e.ts)}
      </span>
      <span role="cell" className="min-w-0">
        {linkable ? (
          <button
            type="button"
            onClick={() => onOpen(e)}
            className="text-text-primary hover:text-accent flex max-w-full cursor-pointer items-center gap-1 truncate font-mono"
            title="Open"
          >
            <span className="truncate">{e.sessionId}</span>
            <ExternalLink
              size={10}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 opacity-60"
            />
          </button>
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </span>
      <span role="cell" className="text-text-secondary truncate">
        {e.agent ?? <span className="text-text-tertiary">—</span>}
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5">
        {info ? (
          <>
            <span className="text-text-primary truncate">{info.name}</span>
            {info.local && <LocalPill />}
            {info.estimate && <EstimatePill />}
          </>
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </span>
      <span role="cell" className="text-text-secondary font-mono tabular-nums">
        {e.tokensIn + e.tokensOut > 0 ? (
          <span
            title={`${e.tokensIn.toLocaleString()} in · ${e.tokensOut.toLocaleString()} out`}
          >
            {fmtTokens(e.tokensIn + e.tokensOut)}
          </span>
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </span>
      <span
        role="cell"
        className={cn(
          'text-right font-mono tabular-nums',
          e.costUsd > 0 ? 'text-text-primary' : 'text-text-tertiary'
        )}
      >
        {decision && typeof e.detail?.estimatedCost === 'number' ? (
          <span
            className="line-through opacity-70"
            title="Estimated — not charged"
          >
            {fmtUsd(e.detail.estimatedCost as number, { precise: true })}
          </span>
        ) : e.costUsd > 0 ? (
          fmtUsd(e.costUsd, { precise: e.costUsd < 0.01 })
        ) : (
          '—'
        )}
      </span>
      <span role="cell">
        {e.costUsd > 0 || e.kind === 'llm_call' ? (
          <CategoryChip category={e.category} />
        ) : null}
      </span>
      <span role="cell" className="flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`${kindLabel(e.kind)}: ${describe(e)}`}
              className="flex size-6 items-center justify-center rounded"
              data-testid={`kind-${e.kind}`}
            >
              <KindIcon kind={e.kind} category={e.category} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[280px] text-[11px]">
            <span className="font-medium">{kindLabel(e.kind)}</span>
            <br />
            {describe(e)}
          </TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

const HistoryRow = memo(HistoryRowImpl) as unknown as typeof HistoryRowImpl;

/* ── Tab ───────────────────────────────────────────────────────────────── */

export function HistoryTab() {
  const navigate = useNavigate();
  const events = useBudgetStore((s) => s.events);
  const total = useBudgetStore((s) => s.eventsTotal);
  const totalCost = useBudgetStore((s) => s.eventsTotalCost);
  const loading = useBudgetStore((s) => s.eventsLoading);
  const nextCursor = useBudgetStore((s) => s.nextCursor);
  const filter = useBudgetStore((s) => s.filter);
  const sort = useBudgetStore((s) => s.sort);
  const setFilter = useBudgetStore((s) => s.setFilter);
  const setSort = useBudgetStore((s) => s.setSort);
  const loadEventsPage = useBudgetStore((s) => s.loadEventsPage);
  const settings = useBudgetStore((s) => s.settings);
  const listRef = useRef<ListImperativeAPI>(null);

  useEffect(() => {
    if (events.length === 0 && !loading) void loadEventsPage(true);
    // Mount-only: subsequent loads are driven by filter/sort/scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelOptions = useMemo(() => {
    const ids = new Set<string>([
      ...settings.configuredModels,
      ...settings.installedLocal,
    ]);
    for (const e of events) if (e.model) ids.add(e.model);
    return [
      { value: 'all', label: 'All models' },
      ...[...ids]
        .sort()
        .map((id) => ({ value: id, label: displayModel(id).name })),
    ];
  }, [events, settings.configuredModels, settings.installedLocal]);

  const onOpen = useCallback(
    (e: SpendEvent) => {
      if (!e.sessionId) return;
      const route =
        typeof e.detail?.route === 'string' ? (e.detail.route as string) : null;
      if (route) navigate(route);
      else if (e.sessionId.startsWith('run_') || e.sessionId.startsWith('run-'))
        navigate(`/brain/${e.sessionId}`);
      else navigate(`/chat?session=${encodeURIComponent(e.sessionId)}`);
    },
    [navigate]
  );

  const onRowsRendered = useCallback(
    ({ stopIndex }: { startIndex: number; stopIndex: number }) => {
      if (nextCursor && !loading && stopIndex >= events.length - 20)
        void loadEventsPage();
    },
    [nextCursor, loading, events.length, loadEventsPage]
  );

  const empty = !loading && events.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="budget-history">
      {/* Filters */}
      <div className="border-border-subtle flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <SearchInput
          value={filter.search}
          onChange={(v) => setFilter({ search: v })}
          placeholder="Search session, agent, model…"
          id="spend-search"
          className="w-[240px]"
        />
        <Select
          ariaLabel="Category"
          value={filter.category}
          onChange={(v) =>
            setFilter({ category: v as SpendFilter['category'] })
          }
          options={[
            { value: 'all', label: 'All categories' },
            ...SPEND_CATEGORIES.map((c) => ({
              value: c,
              label: c === 'llm' ? 'LLM' : c[0].toUpperCase() + c.slice(1),
            })),
          ]}
          className="w-[150px]"
        />
        <Select
          ariaLabel="Model"
          value={filter.model}
          onChange={(v) => setFilter({ model: v })}
          options={modelOptions}
          className="w-[170px]"
        />
        <Segmented<SpendFilter['kind']>
          value={filter.kind}
          options={KIND_OPTIONS}
          onChange={(v) => setFilter({ kind: v })}
          ariaLabel="Event kind"
        />
        <Segmented<SpendRange>
          value={filter.range}
          options={RANGE_OPTIONS}
          onChange={(v) => setFilter({ range: v })}
          ariaLabel="Range"
        />
        <button
          type="button"
          data-testid="history-export-csv"
          disabled={total === 0}
          onClick={() =>
            void useBudgetStore.getState().exportSpend('csv', filter.range)
          }
          className="border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary hover:bg-bg-raised ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={13} strokeWidth={1.75} aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div
        role="table"
        aria-label="Spend events"
        aria-rowcount={total + 1}
        aria-colcount={8}
        data-testid="spend-table"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="row"
          aria-rowindex={1}
          className={cn(
            'text-text-tertiary border-border-subtle grid h-8 items-center gap-2 border-b px-4 text-[11px] font-medium tracking-[0.04em] uppercase',
            GRID
          )}
        >
          <SortHeader
            label="Time"
            active={sort.key === 'ts'}
            dir={sort.dir}
            onClick={() => setSort('ts')}
          />
          <span role="columnheader">Session</span>
          <span role="columnheader">Agent</span>
          <span role="columnheader">Model</span>
          <span role="columnheader">Tokens</span>
          <SortHeader
            label="Cost"
            active={sort.key === 'costUsd'}
            dir={sort.dir}
            onClick={() => setSort('costUsd')}
            align="right"
          />
          <span role="columnheader">Category</span>
          <span role="columnheader" className="text-center">
            Kind
          </span>
        </div>

        {empty ? (
          <div
            className="text-text-tertiary flex flex-1 flex-col items-center justify-center gap-1 py-16 text-[13px]"
            data-testid="history-empty"
          >
            <span>No spend events match these filters.</span>
            <button
              type="button"
              onClick={() =>
                setFilter({
                  search: '',
                  category: 'all',
                  model: 'all',
                  agent: 'all',
                  kind: 'all',
                  range: 'all',
                })
              }
              className="text-accent cursor-pointer text-[12px] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : events.length === 0 ? (
          <div
            className="flex flex-col"
            aria-busy="true"
            aria-label="Loading spend events"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="border-border-subtle/60 flex h-8 items-center gap-2 border-b px-4"
              >
                <div
                  className="bg-bg-raised h-3 w-full animate-pulse rounded"
                  style={{ opacity: 1 - i * 0.07 }}
                />
              </div>
            ))}
          </div>
        ) : (
          <List<RowProps>
            listRef={listRef}
            role="rowgroup"
            rowComponent={HistoryRow}
            rowCount={events.length}
            rowHeight={ROW_HEIGHT}
            rowKey={(i, p) => p.rows[i].id}
            rowProps={{ rows: events, onOpen }}
            overscanCount={10}
            onRowsRendered={onRowsRendered}
            className="min-h-0 flex-1"
            style={{ height: '100%' }}
          />
        )}
      </div>

      {/* Footer */}
      <div
        className="border-border-subtle bg-bg-ink/95 text-text-secondary sticky bottom-0 flex h-9 items-center justify-between border-t px-4 text-[12px] backdrop-blur"
        data-testid="history-footer"
        aria-live="polite"
      >
        <span>
          {total.toLocaleString()} {total === 1 ? 'event' : 'events'}
          {loading && <span className="text-text-tertiary"> · loading…</span>}
        </span>
        <span className="font-mono tabular-nums">
          Total{' '}
          <span className="text-text-primary">
            {fmtUsd(totalCost, { precise: totalCost > 0 && totalCost < 0.01 })}
          </span>
        </span>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'right';
}): ReactNode {
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={onClick}
      className={cn(
        'hover:text-text-primary flex cursor-pointer items-center gap-1 uppercase',
        align === 'right' && 'justify-end',
        active && 'text-text-primary'
      )}
    >
      {label}
      <ArrowDownUp
        size={10}
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn(!active && 'opacity-40')}
      />
    </button>
  );
}
