/*
 * "Engine not running" banner (Phase 14). Sits under the Topbar while the
 * health poll fails. Steady (no animation beyond the mount fade): a down
 * engine is a state, not an alarm. Actions are all real:
 *   Retry        → one more health probe now
 *   Start engine → dev: the Vite plugin launches `bun run engine`;
 *                  packaged: the Rust shell respawns the sidecar
 *   Diagnostics  → Settings → Diagnostics (Engine card: last error, logs)
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useEngineStore } from '@/stores/engineStore';

export function EngineDownBanner() {
  const status = useEngineStore((s) => s.status);
  const failures = useEngineStore((s) => s.failures);
  const lastError = useEngineStore((s) => s.lastError);
  const restarting = useEngineStore((s) => s.restarting);
  const endpoint = useEngineStore((s) => s.endpoint);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);

  // Keep the health poll alive for as long as the shell is mounted.
  useEffect(() => useEngineStore.getState().startPolling(), []);

  // One failed probe during boot is normal (the sidecar pairs ~1–3 s in);
  // the banner waits for a second miss so it does not flash on launch.
  const show = (status === 'down' && failures >= 2) || status === 'unauthorized';
  const canStart = import.meta.env.DEV || endpoint?.via === 'sidecar';

  const retry = async (): Promise<void> => {
    setRetrying(true);
    const ok = await useEngineStore.getState().refresh();
    setRetrying(false);
    if (!ok) toast('Still no engine', { description: lastError ?? undefined });
  };

  const start = async (): Promise<void> => {
    const r = await useEngineStore.getState().startOrRestart();
    toast(r.ok ? 'Engine is up' : 'Engine did not start', { description: r.message });
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="engine-down"
          role="status"
          aria-live="polite"
          data-testid="engine-down-banner"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="border-warning/40 bg-warning/10 relative z-30 shrink-0 overflow-hidden border-b"
        >
          <div className="flex h-9 items-center gap-2.5 px-4 text-[13px]">
            <Unplug size={14} strokeWidth={2} aria-hidden="true" className="text-warning shrink-0" />
            <span className="text-text-primary font-medium">
              {status === 'unauthorized' ? 'Engine rejected the session.' : 'Engine not running.'}
            </span>
            <span className="text-text-secondary truncate">
              {status === 'unauthorized'
                ? 'Restart the engine to issue a new token.'
                : 'Chat, tools and runs need the XR engine.'}
              {lastError && status !== 'unauthorized' ? ` ${lastError}` : ''}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void retry()}
                disabled={retrying}
                className="text-text-tertiary hover:text-text-primary h-7 cursor-pointer rounded-md px-2 text-[12px] font-medium disabled:opacity-60"
              >
                {retrying ? 'Checking…' : 'Retry'}
              </button>
              {canStart && (
                <button
                  type="button"
                  data-testid="engine-start"
                  onClick={() => void start()}
                  disabled={restarting}
                  className="border-border-subtle bg-bg-ink text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60"
                >
                  {restarting
                    ? 'Starting…'
                    : endpoint?.via === 'sidecar'
                      ? 'Restart engine'
                      : 'Start engine'}
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/settings#diagnostics')}
                className="text-text-tertiary hover:text-text-primary h-7 cursor-pointer rounded-md px-2 text-[12px] underline-offset-2 hover:underline"
              >
                Diagnostics
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
