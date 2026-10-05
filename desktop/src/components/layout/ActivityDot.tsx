/*
 * Topbar activity indicator (Phase 11, brief §8): a 6 px cyan dot that
 * pulses while any run is in progress, sits left of the bell, and opens
 * the Control Room pre-filtered to running. Renders nothing when idle.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRunsStore } from '@/stores/runsStore';

export function ActivityDot() {
  const n = useRunsStore((s) => s.inProgressCount);
  const navigate = useNavigate();
  const label = `${n} ${n === 1 ? 'run' : 'runs'} in progress`;

  return (
    <AnimatePresence initial={false}>
      {n > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.button
              key="activity"
              type="button"
              aria-label={`${label} — open Control Room`}
              data-testid="topbar-activity"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.16 }}
              onClick={() => navigate('/runs?status=running')}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="xr-dot-pulse bg-accent block size-1.5 rounded-full"
              />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="border-none bg-[var(--tooltip-bg)] text-[var(--tooltip-fg)]"
          >
            {label}
          </TooltipContent>
        </Tooltip>
      )}
    </AnimatePresence>
  );
}
