/*
 * Engine readiness banner (Phase 14; taxonomy XR-P01). Sits under the
 * Topbar whenever the readiness state is not silently fine. Copy and
 * actions follow the five-state vocabulary exactly, so the user can
 * distinguish — and act on — each situation:
 *   degraded            → reachable legacy engine, contract unverified
 *   disconnected        → engine not answering (shown after 2 probes)
 *   failed(unauthorized)→ session rejected; restart re-pairs the token
 *   failed(incompatible)→ contract mismatch; update engine or desktop
 *   failed(crashed)     → the spawn itself failed; stderr tail captured
 *   failed(timeout)     → no answer inside the boot deadline
 *   failed(unreachable)→ engine cannot be reached at all
 * `starting` shows no banner (bounded by the store's boot deadline) and
 * `ready` needs none. Actions are all real:
 *   Retry            → one more probe now
 *   Start/Restart    → dev: Vite plugin; packaged: Rust sidecar respawn
 *   Copy diagnostics → XR-P01 allow-listed, redacted bundle (no token)
 *   Diagnostics      → Settings → Diagnostics (state, versions, logs)
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { copyEngineDiagnostics } from '@/engine/diagnostics';
import {
  ENGINE_BOOT_DEADLINE_MS,
  useEngineStore,
  type EngineFailureReason,
  type EngineStatus,
} from '@/stores/engineStore';

function bannerCopy(
  status: EngineStatus,
  reason: EngineFailureReason | null,
  lastError: string | null,
): { title: string; detail: string } {
  if (status === 'degraded') {
    return {
      title: 'Engine connected — contract unverified.',
      detail:
        lastError ??
        'This engine does not report a contract version, so the desktop cannot verify it matches. Restart with the bundled engine, or run `xr serve` from a current install.',
    };
  }
  if (status === 'failed') {
    switch (reason) {
      case 'unauthorized':
        return {
          title: 'Engine rejected the session.',
          detail: 'Restart the engine to issue a new token and re-pair.',
        };
      case 'incompatible':
        return {
          title: 'Engine version is incompatible.',
          detail: lastError ?? 'Update the engine or the desktop app so their contracts match.',
        };
      case 'crashed':
        return {
          title: 'Engine crashed.',
          detail: lastError ?? 'The engine process failed to start. Its last output is in Diagnostics.',
        };
      case 'timeout':
        return {
          title: 'Engine did not answer in time.',
          detail: `No answer within ${Math.round(ENGINE_BOOT_DEADLINE_MS / 1000)} s. Its last output is in Diagnostics.`,
        };
      default:
        return {
          title: 'Engine unreachable.',
          detail: lastError ?? 'Chat, tools and runs need the XR engine.',
        };
    }
  }
  return {
    title: 'Engine not running.',
    detail: `Chat, tools and runs need the XR engine.${lastError ? ` ${lastError}` : ''}`,
  };
}

export function EngineDownBanner() {
  const status = useEngineStore((s) => s.status);
  const failureReason = useEngineStore((s) => s.failureReason);
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
  // `disconnected` waits for a second miss so it does not flash on launch.
  // `degraded` and `failed(reason)` are observed facts — shown immediately.
  const show =
    status === 'degraded' ||
    status === 'failed' ||
    (status === 'disconnected' && failures >= 2);
  const canStart = import.meta.env.DEV || endpoint?.via === 'sidecar';
  const copy = bannerCopy(status, failureReason, lastError);

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

  const copyDiagnostics = async (): Promise<void> => {
    const r = await copyEngineDiagnostics();
    if (r.ok) toast('Diagnostics copied', { description: r.message });
    else {
      navigate('/settings#diagnostics');
      toast('Copy from Diagnostics', { description: r.message });
    }
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="engine-down"
          role="status"
          aria-live="polite"
          data-testid="engine-down-banner"
          data-status={status}
          data-reason={failureReason ?? undefined}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="border-warning/40 bg-warning/10 relative z-30 shrink-0 overflow-hidden border-b"
        >
          <div className="flex h-9 items-center gap-2.5 px-4 text-[13px]">
            <Unplug size={14} strokeWidth={2} aria-hidden="true" className="text-warning shrink-0" />
            <span className="text-text-primary font-medium">{copy.title}</span>
            <span className="text-text-secondary truncate">{copy.detail}</span>
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
                data-testid="engine-copy-diagnostics"
                onClick={() => void copyDiagnostics()}
                className="text-text-tertiary hover:text-text-primary h-7 cursor-pointer rounded-md px-2 text-[12px] underline-offset-2 hover:underline"
              >
                Copy diagnostics
              </button>
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
