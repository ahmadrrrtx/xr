/**
 * Main-window reactions to orb events (Phase 6) — mounted once by AppShell.
 *
 * The orb's single click focuses the Chat composer and toasts (real voice
 * is Phase 15; the visual states are live today), and the native context
 * menu's voice/approvals items arrive as Rust events.
 */
import { useEffect } from 'react';
import { toast } from 'sonner';

import { isTauri } from '@/lib/tauri';
import { useApprovalStore } from '@/stores/approvalStore';

export function useOrbIpc(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    /** Registration can resolve after unmount — detach immediately then. */
    const track = (un: () => void): void => {
      if (disposed) un();
      else unlisten.push(un);
    };

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');

      track(
        await listen('orb:clicked', () => {
          // Phase 14: a click is "talk to XR" — until voice lands (Phase 15)
          // that means the Chat composer. Bring Chat up and focus it; the
          // orb window itself stays where it is.
          if (!window.location.hash.startsWith('#/chat')) window.location.hash = '#/chat';
          let tries = 0;
          const focus = (): void => {
            const el = document.getElementById('xr-composer');
            if (el) {
              el.focus();
              return;
            }
            if (tries++ < 10) window.setTimeout(focus, 100);
          };
          focus();
          toast('Voice coming in Phase 15', {
            description: 'Type to XR for now — the composer is ready.',
          });
        })
      );

      track(
        await listen('orb:voice-requested', () => {
          toast('Voice sessions ship in Phase 15', {
            description: 'The orb will open the Voice Theater from this command.',
          });
        })
      );

      track(
        await listen('orb:approvals-requested', () => {
          // Phase 7: surface the oldest pending approval (or say all-clear).
          const { pending, activate } = useApprovalStore.getState();
          if (pending.length > 0) {
            activate(pending[0]?.id ?? '');
            toast('Approval needed', {
              description: `${pending.length} request${pending.length === 1 ? '' : 's'} waiting — the oldest is up front now.`,
            });
          } else {
            toast('No pending approvals', {
              description: "You're all caught up — nothing is waiting on you.",
            });
          }
        })
      );
    })();

    return () => {
      disposed = true;
      unlisten.forEach((un) => un());
    };
  }, []);
}
