/**
 * Main-window reactions to orb events (Phase 6) — mounted once by AppShell.
 *
 * The orb's single click and the menu's voice item toggle a voice session
 * (Phase 15, see useVoiceIpc); the approvals item arrives here as a Rust
 * event and surfaces the oldest pending request.
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

      // Phase 15: `orb:clicked` and `orb:voice-requested` toggle the voice
      // session — handled by useVoiceIpc (src/voice/useVoice.ts).

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
