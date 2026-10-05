/*
 * Compromised modal (Phase 12, SCREEN-BRIEFS §8). Fixed, non-dismissible:
 * no close button, Escape and backdrop do nothing. Lists the failing checks
 * and offers two ways out — quarantine every new skill and restart XR, or
 * save diagnostics first. Mounted at the App root so it rides above every
 * route; opens on the transition into `compromised` and stays until acted on.
 */
import { ShieldX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { restartApp } from '@/lib/settingsApi';
import { isTauri } from '@/lib/tauri';
import { shieldBackend } from '@/shield/api';
import { APP_VERSION } from '@/lib/appMeta';
import { useShieldStore } from '@/stores/shieldStore';

export function CompromisedModal() {
  const open = useShieldStore((s) => s.compromisedModalOpen);
  const checks = useShieldStore((s) => s.checks);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const failing = checks.filter((c) => c.status === 'fail');

  // Focus trap: the two buttons are the only tab stops; Escape is inert.
  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Tab') {
        const root = document.getElementById('shield-compromised');
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'button:not([disabled])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const quarantineAndRestart = async (): Promise<void> => {
    const st = useShieldStore.getState();
    await st.setPolicy({ quarantineNewSkills: true });
    await st.addAuditEntry({
      actor: 'user',
      skill: null,
      action: 'Quarantine all new skills and restart',
      resource: null,
      decision: 'blocked',
      ruleId: 'user.compromised-restart',
      risk: 'high',
      costUsd: null,
      detail: `Failing: ${failing.map((c) => c.label).join(', ') || 'none recorded'}`,
    });
    if (isTauri()) await restartApp();
    else window.location.reload();
  };

  const saveDiagnostics = async (): Promise<void> => {
    const st = useShieldStore.getState();
    const report = {
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      checks: st.checks,
      lastCheckedAt: st.lastCheckedAt,
      policy: st.policy,
      paused: st.paused,
      chain: st.chain,
      recentAudit: st.audit.slice(0, 50),
    };
    try {
      const res = await shieldBackend().saveExport(
        `xr-shield-diagnostics-${Date.now()}.json`,
        JSON.stringify(report, null, 2),
        'application/json'
      );
      if (res.saved)
        toast.success('Diagnostics saved', {
          description: res.path ?? undefined,
        });
    } catch (e) {
      toast.error('Could not save diagnostics', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      data-testid="compromised-backdrop"
      // Backdrop clicks are intentionally inert.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        id="shield-compromised"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shield-compromised-title"
        aria-describedby="shield-compromised-desc"
        data-testid="compromised-modal"
        className="bg-bg-ink w-full max-w-[520px] rounded-2xl border p-7 shadow-2xl"
        style={{
          borderColor: 'color-mix(in oklab, var(--danger) 55%, transparent)',
        }}
      >
        <div className="flex flex-col items-center text-center">
          <ShieldX
            size={96}
            strokeWidth={1}
            aria-hidden="true"
            className="text-danger"
          />
          <h2
            id="shield-compromised-title"
            className="text-text-primary mt-3 text-[20px] font-semibold tracking-tight"
          >
            XR Shield integrity check failed
          </h2>
          <p
            id="shield-compromised-desc"
            className="text-text-secondary mt-2 max-w-[420px] text-[13px] leading-relaxed"
          >
            A check that XR relies on to trust its own records did not pass.
            Agents keep running under your policy, but you should resolve this
            before approving anything else.
          </p>
        </div>

        <ul
          className="border-border-subtle bg-bg-raised/40 mt-5 divide-y divide-[var(--border-subtle)] rounded-lg border"
          data-testid="compromised-checks"
        >
          {failing.length === 0 ? (
            <li className="text-text-tertiary px-3 py-2 text-[12px]">
              No failing checks recorded.
            </li>
          ) : (
            failing.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <div className="text-text-primary flex items-center gap-2 text-[13px] font-medium">
                  <span
                    aria-hidden="true"
                    className="bg-danger size-1.5 rounded-full"
                  />
                  {c.label}
                </div>
                <p className="text-text-tertiary text-[12px] leading-relaxed">
                  {c.detail}
                </p>
              </li>
            ))
          )}
        </ul>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void saveDiagnostics()}
            data-testid="compromised-logs"
            className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised h-9 cursor-pointer rounded-lg border px-3.5 text-[13px] transition-colors"
          >
            Save diagnostics
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => void quarantineAndRestart()}
            data-testid="compromised-restart"
            className="bg-danger h-9 cursor-pointer rounded-lg px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 focus-visible:outline-none"
          >
            Quarantine all new skills and restart XR
          </button>
        </div>
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={() => {
              useShieldStore.getState().setForcedFailure(false);
              useShieldStore.getState().dismissCompromised();
            }}
            data-testid="compromised-dev-dismiss"
            className="text-text-tertiary mt-3 w-full cursor-pointer text-center font-mono text-[10px] hover:underline"
          >
            dev: dismiss simulated failure
          </button>
        )}
      </div>
    </div>
  );
}
