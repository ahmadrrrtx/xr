/*
 * Docked voice pill (Phase 15) — bottom-centre glass pill while a session
 * runs outside the Voice screen: mini waveform, latest snippet, a cyan dot
 * while listening, rings while speaking, amber while an approval waits.
 * Click expands back to /voice; the × stops. Theme tokens throughout.
 */
import { Check, Mic, MicOff, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Waveform } from '@/screens/Voice/components/shared';
import { cn } from '@/lib/utils';
import { STATE_COPY, voice } from '@/voice/session';
import { useVoiceStore } from '@/voice/voiceStore';

export function DockedVoice() {
  const active = useVoiceStore((s) => s.active);
  const docked = useVoiceStore((s) => s.docked);
  const state = useVoiceStore((s) => s.sessionState);
  const muted = useVoiceStore((s) => s.muted);
  const approval = useVoiceStore((s) => s.approval);
  const captions = useVoiceStore((s) => s.captions);
  const setDocked = useVoiceStore((s) => s.setDocked);
  const navigate = useNavigate();
  const location = useLocation();

  const onVoiceScreen = location.pathname.startsWith('/voice');
  const shown = active && (docked || !onVoiceScreen);

  // Screens with a bottom bar (Chat's composer) mark it `data-voice-dock-anchor`;
  // the pill lifts above it instead of covering its controls.
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!shown) return;
    let ro: ResizeObserver | null = null;
    const timer = setTimeout(() => {
      const anchor = document.querySelector<HTMLElement>('[data-voice-dock-anchor]');
      if (!anchor) {
        setLift(0);
        return;
      }
      const measure = (): void => setLift(anchor.offsetHeight);
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measure);
        ro.observe(anchor);
      }
    }, 60);
    return () => {
      clearTimeout(timer);
      ro?.disconnect();
    };
  }, [shown, location.pathname]);

  if (!shown) return null;

  const last = captions[captions.length - 1];
  const listening = state === 'listening' || state === 'interrupted';
  const speaking = state === 'speaking';

  const expand = (): void => {
    setDocked(false);
    navigate('/voice');
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: lift > 0 ? lift + 4 : 20 }}
      data-testid="voice-docked"
    >
      <div
        role="group"
        aria-label={`Voice session — ${STATE_COPY[state]}`}
        className={cn(
          'bg-bg-glass border-border-subtle pointer-events-auto flex h-[44px] max-w-[min(560px,100%)] items-center gap-2 rounded-full border pl-2 pr-1 shadow-lg backdrop-blur-xl',
          approval && 'border-warning/60',
          speaking && 'border-accent/50',
        )}
      >
        <button
          type="button"
          onClick={expand}
          className="focus-visible:ring-accent flex min-w-0 items-center gap-2 rounded-full py-1 pr-1 pl-1 text-left focus-visible:ring-2 focus-visible:outline-none"
          aria-label="Expand voice session"
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
            {speaking ? (
              <>
                <span className="border-accent/60 motion-safe:animate-ping absolute inset-0 rounded-full border" />
                <span className="border-accent/40 absolute inset-[-4px] rounded-full border" />
              </>
            ) : null}
            <span
              className={cn(
                'size-2.5 rounded-full',
                approval ? 'bg-warning' : listening && !muted ? 'bg-accent motion-safe:animate-pulse' : speaking ? 'bg-accent' : 'bg-text-tertiary',
              )}
            />
          </span>
          <Waveform className="w-[64px]" bars={14} height={22} idleLevel={0.12} />
          <span className="text-text-primary flex min-w-0 flex-col leading-tight">
            <span className="text-text-tertiary text-[10px] font-medium tracking-wider uppercase">{approval ? 'Say confirm or cancel' : STATE_COPY[state]}</span>
            {last ? <span className="max-w-[280px] truncate text-[12px]">{last.text}</span> : null}
          </span>
        </button>
        {approval ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => voice.decideApproval(approval.id, false)} className="text-text-secondary hover:bg-bg-raised focus-visible:ring-accent flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none" aria-label="Deny">
              <X size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => voice.decideApproval(approval.id, true)} className="bg-accent text-accent-contrast focus-visible:ring-accent flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none" aria-label="Approve">
              <Check size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <button type="button" onClick={() => voice.toggleMuted()} aria-pressed={muted} className={cn('text-text-secondary hover:bg-bg-raised focus-visible:ring-accent flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none', muted && 'text-warning')} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void voice.stop('user')} className="text-text-secondary hover:bg-bg-raised hover:text-danger focus-visible:ring-accent flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none" aria-label="Stop voice session">
          <Square size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
