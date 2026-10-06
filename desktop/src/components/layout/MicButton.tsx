/*
 * Topbar mic (Phase 15) — toggles a voice session from anywhere. While a
 * session runs it pulses in the live state colour and reads the state for
 * screen readers; a click stops it.
 */
import { Mic } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { STATE_COPY, voice } from '@/voice/session';
import { useVoiceStore } from '@/voice/voiceStore';

export function MicButton() {
  const active = useVoiceStore((s) => s.active);
  const state = useVoiceStore((s) => s.sessionState);
  const approval = useVoiceStore((s) => s.approval);
  const navigate = useNavigate();
  const location = useLocation();
  const listening = active && (state === 'listening' || state === 'interrupted');
  const label = active ? `Stop voice session — ${STATE_COPY[state]}` : 'Start voice session';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={active ? `${STATE_COPY[state]} (⌘.)` : 'Voice (⌘.)'}
      data-testid="topbar-mic"
      onClick={() => {
        if (active) {
          void voice.stop('user');
          return;
        }
        if (!location.pathname.startsWith('/voice')) navigate('/voice');
        void voice.start('screen');
      }}
      className={cn(
        'text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-void relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        active && 'text-accent',
      )}
    >
      <Mic size={18} strokeWidth={1.5} aria-hidden="true" />
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1 right-1 size-2 rounded-full',
            approval ? 'bg-warning' : state === 'error' ? 'bg-danger' : 'bg-accent',
            listening && 'motion-safe:animate-pulse',
          )}
        />
      ) : null}
    </button>
  );
}
