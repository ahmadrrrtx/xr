/*
 * App-wide paused banner (Phase 12). Sits under the Topbar in AppShell while
 * `shieldStore.paused` is true: a steady red stripe (no animation — a steady
 * state should look steady). Resume goes through the confirm dialog that
 * the Shield screen owns, so the banner opens it on any route.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { OctagonX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useShieldStore } from '@/stores/shieldStore';

import { ResumeDialogHost } from './ResumeDialogHost';

export function PausedBanner() {
  const paused = useShieldStore((s) => s.paused);
  const hydrated = useShieldStore((s) => s.hydrated);
  const reduced = useReducedMotion();
  const navigate = useNavigate();

  return (
    <>
      <AnimatePresence initial={false}>
        {hydrated && paused && (
          <motion.div
            key="paused"
            role="status"
            aria-live="assertive"
            data-testid="shield-paused-banner"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="shield-banner relative z-30 shrink-0 overflow-hidden"
          >
            <div className="flex h-9 items-center gap-2.5 px-4 text-[13px]">
              <OctagonX
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="text-danger shrink-0"
              />
              <span className="text-text-primary font-medium">
                XR Shield is paused.
              </span>
              <span className="text-text-secondary">Agents cannot act.</span>
              <button
                type="button"
                onClick={() => navigate('/shield')}
                className="text-text-tertiary hover:text-text-primary ml-1 cursor-pointer text-[12px] underline-offset-2 hover:underline"
              >
                Open Shield
              </button>
              <button
                type="button"
                data-testid="banner-resume"
                onClick={() => useShieldStore.getState().openResumeDialog()}
                className="border-border-subtle bg-bg-ink text-text-primary hover:bg-bg-raised ml-auto h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
              >
                Resume
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ResumeDialogHost />
    </>
  );
}
