/*
 * Mic button (Phase 1 brief §5.3) — starts a voice session when voice ships
 * (Phase 15). Until then it shows an honest placeholder toast; the cyan pulse
 * glow arrives with the real listening state.
 */
import { Mic } from 'lucide-react';
import { toast } from 'sonner';

export function MicButton() {
  return (
    <button
      type="button"
      aria-label="Start voice session"
      title="Voice (⌘.)"
      onClick={() =>
        toast('Voice coming in Phase 15', {
          description:
            'Voice sessions, wake word and the Theater arrive later.',
        })
      }
      className="text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-void flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Mic size={18} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
