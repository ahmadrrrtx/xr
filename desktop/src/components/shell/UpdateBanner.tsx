/*
 * The pending-update strip (Phase 27).
 *
 * 36 px, full width, one line: "XR v0.3.0 is ready — Restart to update".
 *
 * Design rules from the brief, and why they are what they are:
 *
 *   · **A thin accent strip, not a dialog.** The update is already downloaded
 *     and verified; the user's next action is a restart, which is not urgent
 *     enough to interrupt anything. So the banner never blocks, never animates
 *     for attention, and never steals focus.
 *   · **It appears only when the update is downloaded** (`readyToInstall`).
 *     "An update exists" belongs in Settings, not above everyone's work.
 *   · **Restart is the primary action; Later is a real, remembered "not now"**
 *     (it hides the strip for the session — the update stays downloaded).
 *   · **It carries its own z-index** and sits above the app shell but below
 *     modals, so an approval dialog is never covered by a version nag.
 */
import { X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useUpdateStore, usePendingRestart } from '@/stores/updateStore';

export function UpdateBanner() {
  const pending = usePendingRestart();
  const version = useUpdateStore((state) => state.state.available?.version ?? null);
  const install = useUpdateStore((state) => state.install);
  const openModal = useUpdateStore((state) => state.openModal);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!pending || dismissed || !version) return null;

  return (
    <div
      role="status"
      className="border-accent/40 bg-accent/10 flex h-9 shrink-0 items-center gap-3 border-b px-3"
    >
      <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
      <span className="text-text-primary min-w-0 flex-1 truncate text-xs">
        XR {version} is downloaded and verified.
      </span>
      <button
        type="button"
        onClick={openModal}
        className="text-text-secondary hover:text-text-primary shrink-0 text-xs underline-offset-2 hover:underline"
      >
        Release notes
      </button>
      <Button
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        disabled={installing}
        onClick={() => {
          setInstalling(true);
          void install();
        }}
      >
        {installing ? 'Restarting…' : 'Restart to update'}
      </Button>
      <button
        type="button"
        aria-label="Not now"
        title="Not now — XR keeps running"
        onClick={() => setDismissed(true)}
        className="text-text-tertiary hover:text-text-primary shrink-0"
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
