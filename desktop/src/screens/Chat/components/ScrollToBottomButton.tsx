/*
 * Floating "jump to latest" pill (Phase 4) — 36px circle, arrow-down, shows
 * "N new" when messages completed while the user was scrolled up.
 * Entrance: opacity 0→1 + 8px rise, 200ms spring.
 */
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

export function ScrollToBottomButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      <motion.button
        type="button"
        onClick={onClick}
        aria-label={count > 0 ? `${count} new messages — jump to latest` : 'Jump to latest'}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="border-border-subtle bg-bg-ink text-text-secondary hover:text-text-primary absolute right-5 bottom-4 z-10 flex h-9 items-center gap-1.5 rounded-full border px-2.5 shadow-lg"
      >
        <ArrowDown aria-hidden="true" className="size-4" strokeWidth={1.5} />
        {count > 0 && (
          <span className="text-accent pr-1 text-[11px] font-semibold">
            {count} new
          </span>
        )}
      </motion.button>
    </AnimatePresence>
  );
}
