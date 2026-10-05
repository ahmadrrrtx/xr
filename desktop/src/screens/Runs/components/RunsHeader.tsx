/*
 * Sticky header (Phase 11, brief §4.1): title, scope line, STOP ALL.
 * STOP ALL only renders while something is in progress; its slot is
 * width-reserved so the header never reflows when it appears.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { OctagonX } from 'lucide-react';

import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DATE_RANGE_LABEL, type DateRange } from '@/runs/core';
import { useRunsStore } from '@/stores/runsStore';

export function RunsHeader({
  total,
  range,
}: {
  total: number;
  range: DateRange;
}) {
  const inProgress = useRunsStore((s) => s.inProgressCount);
  const scope =
    range === 'all'
      ? 'All time'
      : `Last ${DATE_RANGE_LABEL[range].toLowerCase()}`;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-[24px] leading-none font-semibold tracking-tight">
          Control Room
        </h1>
        <p
          className="text-text-tertiary truncate text-[12px]"
          data-testid="runs-scope"
        >
          {total.toLocaleString()} {total === 1 ? 'run' : 'runs'}
          <span aria-hidden="true"> • </span>
          {scope}
          {inProgress > 0 && (
            <>
              <span aria-hidden="true"> • </span>
              <span className="text-accent">{inProgress} in progress</span>
            </>
          )}
        </p>
      </div>

      {/* Reserved slot — no layout shift when the button mounts. */}
      <div className="flex h-8 w-[132px] shrink-0 items-center justify-end">
        <AnimatePresence initial={false}>
          {inProgress > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  key="stop-all"
                  type="button"
                  data-testid="stop-all"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => useRunsStore.getState().requestKillAll()}
                  className="run-stop-all bg-danger text-danger-contrast flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold tracking-wide uppercase transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 focus-visible:outline-none"
                >
                  <OctagonX
                    className="size-4"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  Stop all
                </motion.button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="border-none bg-[var(--tooltip-bg)] text-[var(--tooltip-fg)]"
              >
                <span className="flex items-center gap-2">
                  Stop {inProgress} {inProgress === 1 ? 'run' : 'runs'}
                  <Kbd className="h-4 text-[10px]">S</Kbd>
                </span>
              </TooltipContent>
            </Tooltip>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
