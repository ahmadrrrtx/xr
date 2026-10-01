/**
 * Main-window reactions to orb events (Phase 6) — mounted once by AppShell.
 *
 * The orb's single click toasts here (real voice is Phase 15; the visual
 * states are live today), and the native context menu's voice/approvals
 * items arrive as Rust events (their real surfaces ship in Phase 15/7).
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
          toast('Push-to-talk arrives in Phase 15', {
            description:
              'Voice will listen right from the orb — the visual states are live today.',
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
