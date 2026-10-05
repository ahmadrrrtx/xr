/*
 * Shield → Audit Log (Phase 12, SCREEN-BRIEFS §8 Tab 3). Filter bar, a
 * react-window ARIA grid (32 px rows), sort on Time/Cost, a 420 px slide-over
 * for the selected entry and client-side progressive reveal (+100 rows past
 * 80 % scroll). Filters run over the loaded log; export writes exactly what
 * is on screen.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { List, type RowComponentProps } from 'react-window';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  Search,
  X,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DECISION_LABEL, fmtCost, fmtWhen } from '@/shield/core';
import {
  AUDIT_DECISIONS,
  AUDIT_RANGES,
  AUDIT_RANGE_LABEL,
  type AuditEntry,
  type AuditSort,
} from '@/shield/types';
import { useShieldStore } from '@/stores/shieldStore';

import { ActorChip, DecisionMark } from './shared';

export const ROW_HEIGHT = 32;
const GRID =
  'grid grid-cols-[132px_112px_104px_minmax(200px,1.2fr)_minmax(160px,1fr)_120px_72px_minmax(120px,0.8fr)] items-center gap-x-3';

const COLUMNS: {
  id: string;
  label: string;
  sort?: AuditSort['col'];
  right?: boolean;
}[] = [
  { id: 'ts', label: 'Time', sort: 'ts' },
  { id: 'actor', label: 'Actor' },
  { id: 'skill', label: 'Skill' },
  { id: 'action', label: 'Action' },
  { id: 'resource', label: 'Resource' },
  { id: 'decision', label: 'Decision' },
  { id: 'cost', label: 'Cost', sort: 'costUsd', right: true },
  { id: 'rule', label: 'Rule ID' },
];

interface Props {
  rows: AuditEntry[];
  total: number;
  loading: boolean;
  fresh: boolean;
}

export const AuditTab = forwardRef<HTMLInputElement, Props>(function AuditTab(
  { rows, total, loading, fresh },
  searchRef
) {
  const filter = useShieldStore((s) => s.auditFilter);
  const sort = useShieldStore((s) => s.auditSort);
  const visible = useShieldStore((s) => s.auditVisible);
  const selectedId = useShieldStore((s) => s.selectedAuditId);
  const shown = useMemo(() => rows.slice(0, visible), [rows, visible]);
  const filtered =
    filter.search !== '' ||
    filter.decision !== 'all' ||
    filter.actor !== 'all' ||
    filter.range !== 'all';

  const onRowsRendered = useCallback(
    (
      _v: { startIndex: number; stopIndex: number },
      all: { stopIndex: number }
    ) => {
      const st = useShieldStore.getState();
      if (st.auditVisible >= rows.length) return;
      if (all.stopIndex >= Math.floor(st.auditVisible * 0.8))
        st.revealMoreAudit();
    },
    [rows.length]
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="shield-audit-tab"
    >
      {/* Filter bar */}
      <div className="border-border-subtle flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <label className="relative flex items-center">
          <Search
            size={13}
            strokeWidth={1.75}
            aria-hidden="true"
            className="text-text-tertiary pointer-events-none absolute left-2.5"
          />
          <input
            ref={searchRef}
            type="search"
            value={filter.search}
            onChange={(e) =>
              useShieldStore
                .getState()
                .setAuditFilter({ search: e.target.value })
            }
            placeholder="Search action, resource, skill…"
            aria-label="Search audit log"
            data-testid="audit-search"
            className="border-border-subtle bg-bg-ink text-text-primary placeholder:text-text-tertiary focus-visible:border-accent h-8 w-[240px] rounded-lg border pr-8 pl-7 text-[13px] outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="absolute right-2 flex items-center">
            {filter.search ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() =>
                  useShieldStore.getState().setAuditFilter({ search: '' })
                }
                className="text-text-tertiary hover:text-text-primary flex size-5 cursor-pointer items-center justify-center rounded"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            ) : (
              <Kbd className="h-4 text-[10px]">/</Kbd>
            )}
          </span>
        </label>

        <Select
          value={filter.decision}
          onValueChange={(v) =>
            useShieldStore
              .getState()
              .setAuditFilter({ decision: v as typeof filter.decision })
          }
        >
          <SelectTrigger
            aria-label="Decision"
            data-testid="audit-decision"
            className="border-border-subtle bg-bg-ink h-8! w-[140px] text-[13px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[13px]">
              All decisions
            </SelectItem>
            {AUDIT_DECISIONS.map((d) => (
              <SelectItem key={d} value={d} className="text-[13px]">
                {DECISION_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.actor}
          onValueChange={(v) =>
            useShieldStore
              .getState()
              .setAuditFilter({ actor: v as typeof filter.actor })
          }
        >
          <SelectTrigger
            aria-label="Actor"
            data-testid="audit-actor"
            className="border-border-subtle bg-bg-ink h-8! w-[120px] text-[13px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[13px]">
              All actors
            </SelectItem>
            <SelectItem value="user" className="text-[13px]">
              You
            </SelectItem>
            <SelectItem value="agent" className="text-[13px]">
              Agents
            </SelectItem>
            <SelectItem value="system" className="text-[13px]">
              System
            </SelectItem>
          </SelectContent>
        </Select>

        <div
          role="radiogroup"
          aria-label="Date range"
          className="bg-bg-raised/60 border-border-subtle flex h-8 items-center gap-0.5 rounded-lg border p-0.5"
        >
          {AUDIT_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={filter.range === r}
              data-testid={`audit-range-${r}`}
              onClick={() =>
                useShieldStore.getState().setAuditFilter({ range: r })
              }
              className={cn(
                'h-full cursor-pointer rounded-md px-2.5 text-[12px] transition-colors',
                filter.range === r
                  ? 'bg-bg-ink text-text-primary shadow-xs'
                  : 'text-text-tertiary hover:text-text-secondary'
              )}
            >
              {AUDIT_RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="text-text-tertiary text-[12px] tabular-nums"
            data-testid="audit-count"
          >
            {rows.length === total
              ? `${total} entries`
              : `${rows.length} of ${total} entries`}
          </span>
          <ExportMenu count={rows.length} />
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 px-4 pt-3 pb-4">
        <div className="border-border-subtle bg-bg-ink h-full min-h-0 overflow-x-auto overflow-y-hidden rounded-lg border">
          {loading && rows.length === 0 ? (
            <AuditSkeleton />
          ) : fresh ? (
            <EmptyState
              title="No audit entries yet"
              body="Every approval, block and policy change will be recorded here — hash-chained, newest first."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No entries match"
              body={
                filtered
                  ? 'Try a wider date range or clear the filters.'
                  : 'Nothing recorded in this window.'
              }
              action={
                filtered ? (
                  <button
                    type="button"
                    onClick={() =>
                      useShieldStore.getState().setAuditFilter({
                        search: '',
                        decision: 'all',
                        actor: 'all',
                        range: 'all',
                      })
                    }
                    className="text-accent hover:bg-bg-raised mt-1 h-7 cursor-pointer rounded px-2 text-[12px]"
                  >
                    Clear filters
                  </button>
                ) : null
              }
            />
          ) : (
            <div
              role="grid"
              aria-label="Audit log"
              aria-rowcount={rows.length + 1}
              aria-colcount={COLUMNS.length}
              data-testid="audit-table"
              className="flex h-full min-h-0 min-w-[1080px] flex-col"
            >
              <Header sort={sort} />
              <List<RowProps>
                role="rowgroup"
                rowComponent={AuditRow}
                rowCount={shown.length}
                rowHeight={ROW_HEIGHT}
                rowKey={(i, p) => p.rows[i].id}
                rowProps={{ rows: shown, selectedId }}
                overscanCount={10}
                onRowsRendered={onRowsRendered}
                className="min-h-0 flex-1"
                style={{ height: '100%' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ── Export ────────────────────────────────────────────────────────────── */

export function ExportMenu({
  count,
  ghost,
}: {
  count: number;
  ghost?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="audit-export"
          disabled={count === 0}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            ghost
              ? 'text-text-secondary hover:text-text-primary hover:bg-bg-raised'
              : 'border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary hover:bg-bg-raised border'
          )}
        >
          <Download size={13} strokeWidth={1.75} aria-hidden="true" />
          Export audit
          <ChevronDown
            size={12}
            strokeWidth={1.75}
            aria-hidden="true"
            className="opacity-60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuItem
          onSelect={() => void useShieldStore.getState().exportAudit('csv')}
        >
          CSV
          <span className="text-text-tertiary ml-auto font-mono text-[11px]">
            {count} rows
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void useShieldStore.getState().exportAudit('json')}
        >
          JSON
          <span className="text-text-tertiary ml-auto font-mono text-[11px]">
            {count} rows
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Header ────────────────────────────────────────────────────────────── */

function Header({ sort }: { sort: AuditSort }) {
  return (
    <div
      role="row"
      aria-rowindex={1}
      className={cn(
        GRID,
        'border-border-subtle bg-bg-ink sticky top-0 z-10 h-8 shrink-0 border-b px-3'
      )}
    >
      {COLUMNS.map((c, i) => {
        const active = c.sort && sort.col === c.sort;
        const inner = (
          <>
            {c.label}
            {active &&
              (sort.dir === 'desc' ? (
                <ArrowDown size={11} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ArrowUp size={11} strokeWidth={2} aria-hidden="true" />
              ))}
          </>
        );
        return (
          <div
            key={c.id}
            role="columnheader"
            aria-colindex={i + 1}
            aria-sort={
              active
                ? sort.dir === 'desc'
                  ? 'descending'
                  : 'ascending'
                : undefined
            }
            className={cn(
              'text-text-tertiary text-[11px] font-medium tracking-[0.06em] uppercase',
              c.right && 'text-right'
            )}
          >
            {c.sort ? (
              <button
                type="button"
                onClick={() => useShieldStore.getState().setAuditSort(c.sort!)}
                data-testid={`audit-sort-${c.sort}`}
                className={cn(
                  'hover:text-text-primary flex h-full cursor-pointer items-center gap-1 uppercase',
                  c.right && 'ml-auto',
                  active && 'text-text-primary'
                )}
              >
                {inner}
              </button>
            ) : (
              inner
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Row ───────────────────────────────────────────────────────────────── */

interface RowProps {
  rows: AuditEntry[];
  selectedId: string | null;
}

function AuditRowImpl({
  index,
  style,
  rows,
  selectedId,
}: RowComponentProps<RowProps>) {
  const e = rows[index];
  const selected = e.id === selectedId;
  const open = (): void =>
    useShieldStore.getState().selectAudit(selected ? null : e.id);
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      tabIndex={0}
      data-testid="audit-row"
      data-decision={e.decision}
      style={style as CSSProperties}
      onClick={open}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      }}
      className={cn(
        GRID,
        'border-border-subtle hover:bg-bg-raised/60 focus-visible:bg-bg-raised/60 cursor-pointer border-b px-3 text-[12px] outline-none',
        selected && 'bg-accent/8'
      )}
    >
      <div
        role="gridcell"
        className="text-text-secondary truncate font-mono text-[11px] tabular-nums"
      >
        {fmtWhen(e.ts)}
      </div>
      <div role="gridcell" className="min-w-0">
        <ActorChip actor={e.actor} />
      </div>
      <div role="gridcell" className="text-text-secondary truncate">
        {e.skill ?? <span className="text-text-tertiary">—</span>}
      </div>
      <div role="gridcell" className="text-text-primary truncate">
        {e.action}
      </div>
      <div
        role="gridcell"
        className="text-text-secondary truncate font-mono text-[11px]"
      >
        {e.resource ?? <span className="text-text-tertiary">—</span>}
      </div>
      <div role="gridcell" className="text-text-secondary min-w-0">
        <DecisionMark decision={e.decision} />
      </div>
      <div
        role="gridcell"
        className="text-text-secondary text-right font-mono text-[11px] tabular-nums"
      >
        {fmtCost(e.costUsd)}
      </div>
      <div
        role="gridcell"
        className="text-text-tertiary truncate font-mono text-[11px]"
      >
        {e.ruleId ?? '—'}
      </div>
    </div>
  );
}

// react-window types rowComponent as a plain element-returning function.
const AuditRow = memo(AuditRowImpl) as unknown as typeof AuditRowImpl;

/* ── States ────────────────────────────────────────────────────────────── */

function AuditSkeleton() {
  return (
    <div className="p-3" data-testid="audit-skeleton" aria-busy="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={cn(GRID, 'h-8 px-0')}>
          {COLUMNS.map((c) => (
            <Skeleton key={c.id} className="h-3 w-[70%]" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
      data-testid="audit-empty"
    >
      <p className="text-text-primary text-[14px] font-medium">{title}</p>
      <p className="text-text-tertiary max-w-[420px] text-[12px] leading-relaxed">
        {body}
      </p>
      {action}
    </div>
  );
}
