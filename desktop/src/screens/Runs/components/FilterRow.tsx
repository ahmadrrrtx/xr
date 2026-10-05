/*
 * Filter row (Phase 11, brief §4.2): status tabs with live counts, search,
 * date range, export, charts toggle. Pure presentation — state in runsStore.
 */
import { forwardRef } from 'react';
import { BarChart3, ChevronDown, Download, Search, X } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import {
  DATE_RANGES,
  DATE_RANGE_LABEL,
  STATUS_FILTERS,
  STATUS_FILTER_LABEL,
  type DateRange,
  type StatusCounts,
  type StatusFilter,
} from '@/runs/core';
import { useRunsStore } from '@/stores/runsStore';

interface Props {
  counts: StatusCounts;
  visibleCount: number;
}

export const FilterRow = forwardRef<HTMLInputElement, Props>(function FilterRow(
  { counts, visibleCount },
  searchRef
) {
  const statusFilter = useRunsStore((s) => s.statusFilter);
  const search = useRunsStore((s) => s.search);
  const dateRange = useRunsStore((s) => s.dateRange);
  const chartsOpen = useRunsStore((s) => s.chartsOpen);

  return (
    <div
      className="border-border-subtle flex shrink-0 flex-wrap items-center gap-2 border-b px-4 pb-3"
      data-testid="runs-filters"
    >
      {/* Status tabs */}
      <div
        role="tablist"
        aria-label="Filter by status"
        className="bg-bg-raised/60 border-border-subtle flex h-8 items-center gap-0.5 rounded-lg border p-0.5"
      >
        {STATUS_FILTERS.map((f) => (
          <StatusTab
            key={f}
            filter={f}
            count={counts[f]}
            active={statusFilter === f}
            onSelect={() => useRunsStore.getState().setStatusFilter(f)}
          />
        ))}
      </div>

      {/* Search */}
      <label className="relative flex h-8 w-[280px] max-w-full items-center">
        <Search
          className="text-text-tertiary pointer-events-none absolute left-2.5 size-3.5"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => useRunsStore.getState().setSearch(e.target.value)}
          placeholder="Search by ID, agent, workspace…"
          aria-label="Search runs"
          data-testid="runs-search"
          className="border-border-subtle bg-bg-ink text-text-primary placeholder:text-text-tertiary focus-visible:border-border-accent h-8 w-full rounded-lg border pr-14 pl-8 text-[13px] outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="absolute right-2 flex items-center gap-1">
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => useRunsStore.getState().setSearch('')}
              className="text-text-tertiary hover:text-text-primary flex size-5 cursor-pointer items-center justify-center rounded"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : (
            <Kbd className="h-4 text-[10px]">/</Kbd>
          )}
        </span>
      </label>

      {/* Date range */}
      <Select
        value={dateRange}
        onValueChange={(v) =>
          useRunsStore.getState().setDateRange(v as DateRange)
        }
      >
        <SelectTrigger
          aria-label="Date range"
          data-testid="runs-range"
          className="border-border-subtle bg-bg-ink h-8! w-[120px] text-[13px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGES.map((r) => (
            <SelectItem key={r} value={r} className="text-[13px]">
              {DATE_RANGE_LABEL[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2">
        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="runs-export"
              disabled={visibleCount === 0}
              className="border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download
                className="size-3.5"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              Export
              <ChevronDown
                className="size-3 opacity-60"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              onSelect={() => void useRunsStore.getState().exportCsv()}
            >
              CSV
              <span className="text-text-tertiary ml-auto font-mono text-[11px]">
                {visibleCount} rows
              </span>
              <Kbd className="h-4 text-[10px]">E</Kbd>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void useRunsStore.getState().exportJson()}
            >
              JSON
              <span className="text-text-tertiary ml-auto font-mono text-[11px]">
                {visibleCount} rows
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Charts chip */}
        <button
          type="button"
          aria-pressed={chartsOpen}
          data-testid="runs-charts-toggle"
          onClick={() => useRunsStore.getState().toggleCharts()}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors',
            chartsOpen
              ? 'border-border-accent bg-accent/10 text-accent'
              : 'border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary hover:bg-bg-raised'
          )}
        >
          <BarChart3
            className="size-3.5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {chartsOpen ? 'Hide charts' : 'Show charts'}
        </button>
      </div>
    </div>
  );
});

function StatusTab({
  filter,
  count,
  active,
  onSelect,
}: {
  filter: StatusFilter;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`runs-tab-${filter}`}
      onClick={onSelect}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors',
        active
          ? 'bg-bg-ink text-text-primary shadow-sm'
          : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {STATUS_FILTER_LABEL[filter]}
      <span
        className={cn(
          'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[10px] tabular-nums',
          active
            ? 'bg-accent/15 text-accent'
            : 'bg-bg-raised text-text-tertiary',
          filter === 'running' && count > 0 && 'bg-accent/15 text-accent',
          filter === 'failed' && count > 0 && !active && 'text-danger'
        )}
      >
        {count.toLocaleString()}
      </span>
    </button>
  );
}
