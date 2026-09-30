/*
 * Route transition wrapper (Phase 1 brief §5.4).
 *
 * Outgoing content fades out (80ms); incoming content fades in with a slight
 * 8px rise (spring 380/28). Keyed on the pathname so each route remounts.
 * `prefers-reduced-motion` drops the translation — opacity fades only.
 * Pages never slide horizontally (docs/DESIGN-SYSTEM.md §7.2).
 */
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';

export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="h-full min-h-0"
        initial={{ opacity: 0, ...(reducedMotion ? {} : { y: 8 }) }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={
          reducedMotion
            ? { duration: 0.08 }
            : {
                type: 'spring',
                stiffness: 380,
                damping: 28,
              }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
