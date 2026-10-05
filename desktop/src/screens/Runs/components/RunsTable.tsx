/*
 * Virtualized runs table (Phase 11, brief §4.4). react-window v2 `List`
 * (36 px rows, overscan 8) under a sticky sortable header. ARIA: the whole
 * thing is role="table"; the list root is the rowgroup, every row carries
 * aria-rowindex so screen readers can count past the virtual window.
 *
 * Each row subscribes to ITS run only — token/cost ticks never re-render
 * neighbours. `clock` (shared "now") comes through rowProps.
 */
import {
  memo,
  useCallback,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  List,
  type ListImperativeAPI,
  type RowComponentProps,
} from 'react-window';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  FolderOpen,
  MoreHorizontal,
  RotateCcw,
  ShieldX,
  Square,
} from 'lucide-react';

import type { RunSummary } from '@/brain/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  fmtCostCell,
  fmtLiveDuration,
  fmtStarted,
  fmtStartedFull,
  fmtTokenPair,
  inProgress,
  isLocalModel,
  runDuration,
  type SortColumn,
  type SortState,
} from '@/runs/core';
import { useRunsStore, type RunFlash } from '@/stores/runsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { AgentChip, ModelCell, StatusIcon } from './shared';

export const ROW_HEIGHT = 36;
const FLASH_MS = 1200;

/** 11 columns; min width 1040 px, Title/Workspace flex. */
export const GRID =
  'grid grid-cols-[36px_76px_minmax(160px,1.6fr)_118px_minmax(96px,0.8fr)_150px_104px_76px_104px_72px_88px] items-center gap-x-2';

interface Column {
  key: SortColumn | 'status' | 'actions';
  label: string;
  sortable: boolean;
  align?: 'right';
  srOnly?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'status', label: 'Status', sortable: false, srOnly: true },
  { key: 'id', label: 'ID', sortable: true },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'agent', label: 'Agent', sortable: true },
  { key: 'workspace', label: 'Workspace', sortable: true },
  { key: 'model', label: 'Model', sortable: true },
  { key: 'startedAt', label: 'Started', sortable: true },
  { key: 'duration', label: 'Duration', sortable: true, align: 'right' },
  { key: 'tokens', label: 'Tokens', sortable: true, align: 'right' },
  { key: 'cost', label: 'Cost', sortable: true, align: 'right' },
  { key: 'actions', label: 'Actions', sortable: false, srOnly: true },
];

/* ── Header ────────────────────────────────────────────────────────────── */

export function TableHeader({ sort }: { sort: SortState }) {
  return (
    <div
      role="row"
      aria-rowindex={1}
      className={cn(
        GRID,
        'border-border-subtle bg-bg-void/95 sticky top-0 z-10 h-8 border-b px-3 backdrop-blur-sm'
      )}
    >
      {COLUMNS.map((c) => {
        const active = c.sortable && sort.col === c.key;
        const ariaSort = active
          ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined;
        return (
          <div
            key={c.key}
            role="columnheader"
            aria-sort={c.sortable ? (ariaSort ?? 'none') : undefined}
            className={cn('min-w-0', c.align === 'right' && 'text-right')}
          >
            {c.sortable ? (
              <button
                type="button"
                data-testid={`sort-${c.key}`}
                onClick={() =>
                  useRunsStore.getState().setSort(c.key as SortColumn)
                }
                className={cn(
                  'group inline-flex max-w-full cursor-pointer items-center gap-1 font-mono text-[10px] tracking-wide uppercase transition-colors',
                  active
                    ? 'text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary',
                  c.align === 'right' && 'flex-row-reverse'
                )}
              >
                <span className="truncate">{c.label}</span>
                <span className="inline-flex size-3 items-center justify-center">
                  {active &&
                    (sort.dir === 'asc' ? (
                      <ArrowUp
                        className="size-3"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowDown
                        className="size-3"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    ))}
                </span>
              </button>
            ) : (
              <span
                className={cn(
                  'font-mono text-[10px] uppercase',
                  c.srOnly && 'sr-only'
                )}
              >
                {c.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Row ───────────────────────────────────────────────────────────────── */

interface RowProps {
  rows: RunSummary[];
  clock: number;
  selectedId: string | null;
  flashes: Record<string, RunFlash>;
  onOpen: (id: string) => void;
  nav: (path: string) => void;
}

function flashAttr(
  flash: RunFlash | undefined,
  clock: number
): string | undefined {
  if (!flash) return undefined;
  return clock - flash.at < FLASH_MS ? flash.kind : undefined;
}

function RunRowImpl({
  index,
  style,
  rows,
  clock,
  selectedId,
  flashes,
  onOpen,
  nav,
}: RowComponentProps<RowProps>) {
  const seed = rows[index];
  const run = useRunsStore((s) => s.runs[seed.id]) ?? seed;
  const selected = selectedId === run.id;
  const live = inProgress(run.status);
  const flash = flashAttr(flashes[run.id], clock);
  const duration = runDuration(run, clock);

  const select = (): void => useRunsStore.getState().select(run.id);
  const stop = (e?: MouseEvent): void => {
    e?.stopPropagation();
    useRunsStore.getState().requestKill(run.id);
  };

  const items = (
    Item: typeof ContextMenuItem | typeof DropdownMenuItem,
    Sep: typeof ContextMenuSeparator | typeof DropdownMenuSeparator
  ): ReactNode => {
    const st = useRunsStore.getState;
    return (
      <>
        <Item onSelect={() => onOpen(run.id)}>
          <Eye /> View trace
        </Item>
        <Item
          disabled={!run.workspaceId && !run.workspace}
          onSelect={() => {
            const ws = useWorkspaceStore
              .getState()
              .workspaces.find(
                (w) =>
                  w.id === run.workspaceId ||
                  (!!run.workspace &&
                    w.name.toLowerCase() === run.workspace.toLowerCase())
              );
            if (ws) nav(`/workspaces/${ws.id}`);
            else
              toast('Workspace not found', {
                description: `${run.workspace ?? run.workspaceId} is not in this XR.`,
              });
          }}
        >
          <FolderOpen /> Open workspace
        </Item>
        <Item onSelect={() => void st().copyId(run.id)}>
          <Copy /> Copy ID
        </Item>
        <Sep />
        <Item onSelect={() => st().retry(run.id)}>
          <RotateCcw /> Retry
        </Item>
        <Item disabled={live} onSelect={() => st().archive(run.id)}>
          <Archive /> Archive
        </Item>
        {live && (
          <>
            <Sep />
            <Item
              variant="destructive"
              onSelect={() => st().requestKill(run.id)}
            >
              <Square /> Stop run
            </Item>
          </>
        )}
      </>
    );
  };

  const rowStyle: CSSProperties = { ...style, height: ROW_HEIGHT };

  return (
    <ContextMenu onOpenChange={(o) => o && select()}>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          aria-rowindex={index + 2}
          aria-selected={selected}
          data-testid="run-row"
          data-run-id={run.id}
          data-status={run.status}
          data-selected={selected ? 'true' : undefined}
          data-flash={flash}
          tabIndex={-1}
          style={rowStyle}
          onClick={select}
          onDoubleClick={() => onOpen(run.id)}
          className={cn(
            GRID,
            'run-row border-border-subtle cursor-default border-b px-3 text-[12px] select-none'
          )}
        >
          {/* Status */}
          <div role="cell" className="flex items-center">
            {run.killedBy === 'shield' ? (
              <span
                role="img"
                aria-label="Shield revoked"
                title="Shield revoked — paused by XR Shield emergency revoke"
                data-testid="run-shield-revoked"
                className="inline-flex size-4 shrink-0 items-center justify-center"
              >
                <ShieldX
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  style={{ color: 'var(--danger)' }}
                />
              </span>
            ) : (
              <StatusIcon status={run.status} />
            )}
          </div>

          {/* ID + copy */}
          <div role="cell" className="group/id flex min-w-0 items-center gap-1">
            <span className="text-text-secondary truncate font-mono text-[12px]">
              {run.shortId}
            </span>
            <button
              type="button"
              aria-label={`Copy run ID ${run.id}`}
              onClick={(e) => {
                e.stopPropagation();
                void useRunsStore.getState().copyId(run.id);
              }}
              className="text-text-tertiary hover:text-text-primary flex size-5 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity group-hover/id:opacity-100 focus-visible:opacity-100"
            >
              <Copy className="size-3" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          {/* Title (+ error tooltip) */}
          <div role="cell" className="min-w-0">
            {(run.status === 'failed' || run.killedBy === 'shield') &&
            run.errorSummary ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-text-primary block cursor-help truncate underline decoration-[var(--danger)]/40 decoration-dotted underline-offset-2">
                    {run.title}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-[360px] border-none bg-[var(--tooltip-bg)] font-mono text-[11px] text-[var(--tooltip-fg)]"
                >
                  {run.errorSummary}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span
                className="text-text-primary block truncate"
                title={run.title}
              >
                {run.title}
              </span>
            )}
          </div>

          {/* Agent */}
          <div role="cell" className="min-w-0">
            <AgentChip agent={run.agent} kind={run.agentKind} />
          </div>

          {/* Workspace */}
          <div
            role="cell"
            className="text-text-secondary min-w-0 truncate"
            title={run.workspace}
          >
            {run.workspace || <span className="text-text-tertiary">—</span>}
          </div>

          {/* Model */}
          <div role="cell" className="min-w-0 truncate">
            <ModelCell model={run.model} local={isLocalModel(run.model)} />
          </div>

          {/* Started */}
          <div
            role="cell"
            className="text-text-secondary truncate font-mono text-[11px]"
            title={fmtStartedFull(run.startedAt)}
          >
            {fmtStarted(run.startedAt, clock)}
          </div>

          {/* Duration */}
          <div
            role="cell"
            className={cn(
              'text-right font-mono text-[12px] tabular-nums',
              live ? 'text-accent' : 'text-text-secondary'
            )}
          >
            {fmtLiveDuration(duration)}
          </div>

          {/* Tokens */}
          <div
            role="cell"
            className="text-text-secondary truncate text-right font-mono text-[12px] tabular-nums"
          >
            {fmtTokenPair(run.tokensIn, run.tokensOut)}
          </div>

          {/* Cost */}
          <div
            role="cell"
            className={cn(
              'text-right font-mono text-[12px] tabular-nums',
              run.costUsd > 0 ? 'text-accent' : 'text-text-tertiary'
            )}
          >
            {fmtCostCell(run.costUsd)}
          </div>

          {/* Actions */}
          <div role="cell" className="flex items-center justify-end gap-0.5">
            <IconBtn
              label="View trace"
              onClick={() => onOpen(run.id)}
              testId="row-view"
            >
              <Eye className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </IconBtn>
            {live ? (
              <IconBtn label="Stop run" onClick={stop} danger testId="row-stop">
                <Square
                  className="size-3"
                  strokeWidth={1.75}
                  fill="currentColor"
                  aria-hidden="true"
                />
              </IconBtn>
            ) : (
              <span className="size-6" aria-hidden="true" />
            )}
            <DropdownMenu onOpenChange={(o) => o && select()}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  data-testid="row-more"
                  onClick={(e) => e.stopPropagation()}
                  className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex size-6 cursor-pointer items-center justify-center rounded"
                >
                  <MoreHorizontal
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-[180px] text-[13px]"
              >
                {items(DropdownMenuItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>
          {run.shortId} · {run.id}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {items(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// react-window types rowComponent as a plain element-returning function;
// React.memo's NamedExoticComponent returns ReactNode, hence the cast.
const RunRow = memo(RunRowImpl) as unknown as typeof RunRowImpl;

function IconBtn({
  label,
  onClick,
  children,
  danger,
  testId,
}: {
  label: string;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        'flex size-6 cursor-pointer items-center justify-center rounded transition-colors',
        danger
          ? 'text-danger hover:bg-danger/10'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-raised'
      )}
    >
      {children}
    </button>
  );
}

/* ── Table ─────────────────────────────────────────────────────────────── */

export function RunsTable({
  rows,
  clock,
  sort,
  listRef,
}: {
  rows: RunSummary[];
  clock: number;
  sort: SortState;
  listRef: RefObject<ListImperativeAPI>;
}) {
  const navigate = useNavigate();
  const selectedId = useRunsStore((s) => s.selectedId);
  const flashes = useRunsStore((s) => s.flashes);
  const onOpen = useCallback(
    (id: string) => navigate(`/brain/${id}`),
    [navigate]
  );
  const nav = useCallback((path: string) => navigate(path), [navigate]);

  return (
    <div
      role="table"
      aria-label="Agent runs"
      aria-rowcount={rows.length + 1}
      aria-colcount={COLUMNS.length}
      data-testid="runs-table"
      className="flex h-full min-h-0 min-w-[1040px] flex-col"
    >
      <TableHeader sort={sort} />
      <List<RowProps>
        listRef={listRef}
        role="rowgroup"
        rowComponent={RunRow}
        rowCount={rows.length}
        rowHeight={ROW_HEIGHT}
        rowKey={(i, p) => p.rows[i].id}
        rowProps={{ rows, clock, selectedId, flashes, onOpen, nav }}
        overscanCount={8}
        className="min-h-0 flex-1"
        style={{ height: '100%' }}
      />
    </div>
  );
}
