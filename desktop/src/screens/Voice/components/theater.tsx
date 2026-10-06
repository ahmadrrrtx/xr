/*
 * The session views (Phase 15):
 *   MiniTheater  — right column of /voice (400 px): avatar 120 (state-driven),
 *                  waveform, live captions, state chip, big Start button.
 *   SessionHero  — the running session: cinematic void (#03070D) + cyan in
 *                  every theme, concentric rings, avatar 200, captions
 *                  aria-live, talk/mute/stop controls, approval bar.
 */
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Mic, MicOff, Minimize2, Square, X } from 'lucide-react';
import { useEffect } from 'react';

import { Avatar } from '@/components/brand/Avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { useApprovalStore } from '@/stores/approvalStore';
import { avatarStateFor, STATE_COPY, voice } from '@/voice/session';
import { useVoiceStore } from '@/voice/voiceStore';

import { CostChip, StateChip, Waveform } from './shared';

/* ── captions ───────────────────────────────────────────────────────────── */

export function Captions({ dark, limit = 4, className }: { dark?: boolean; limit?: number; className?: string }) {
  const captions = useVoiceStore((s) => s.captions);
  const show = useVoiceStore((s) => s.settings?.desktop.showTranscripts ?? true);
  const state = useVoiceStore((s) => s.sessionState);
  const items = captions.slice(-limit);
  return (
    <div className={cn('space-y-1.5 text-[14px] leading-snug', className)} aria-live="polite" aria-atomic="false" data-testid="voice-captions">
      {show
        ? items.map((c) => (
            <p
              key={c.id}
              className={cn(
                c.role === 'you' && (dark ? 'text-white/85' : 'text-text-primary'),
                c.role === 'xr' && (dark ? 'text-[#00E5FF]' : 'text-accent'),
                c.role === 'system' && (dark ? 'text-white/50 italic' : 'text-text-tertiary italic'),
              )}
            >
              <span className={cn('mr-1.5 text-[10px] font-medium tracking-wider uppercase', dark ? 'text-white/40' : 'text-text-tertiary')}>
                {c.role === 'you' ? 'You' : c.role === 'xr' ? 'XR' : '·'}
              </span>
              {c.text}
            </p>
          ))
        : null}
      {items.length === 0 ? (
        <p className={cn('text-[13px]', dark ? 'text-white/45' : 'text-text-tertiary')}>
          {state === 'listening' ? 'Say something — I’m listening.' : 'Transcripts show up here.'}
        </p>
      ) : null}
    </div>
  );
}

/* ── mini theater (idle, right column) ──────────────────────────────────── */

export function MiniTheater({ onStart }: { onStart: () => void }) {
  const state = useVoiceStore((s) => s.sessionState);
  const status = useVoiceStore((s) => s.status);
  const statusError = useVoiceStore((s) => s.statusError);
  const permission = useVoiceStore((s) => s.micPermission);
  const activation = useVoiceStore((s) => s.settings?.desktop.activation ?? 'tap');
  const ready = !!status?.stt.loaded && statusError === null && permission !== 'denied' && permission !== 'no-device' && permission !== 'unsupported';
  const reason = statusError === 'engine-down' ? 'Engine offline' : !status?.stt.loaded ? 'Download the models first' : permission === 'denied' ? 'Microphone access is off' : permission === 'no-device' ? 'No microphone detected' : null;
  return (
    <section
      aria-label="Voice session"
      data-testid="voice-mini-theater"
      className="border-border-subtle bg-bg-ink relative flex h-full min-h-[520px] flex-col items-center justify-between overflow-hidden rounded-2xl border p-6"
    >
      <div className="flex w-full items-center justify-between">
        <StateChip state={status ? state : 'offline'} />
        <CostChip />
      </div>
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex size-[160px] items-center justify-center">
          <span className="border-accent/15 absolute inset-0 rounded-full border" aria-hidden="true" />
          <span className="border-accent/10 absolute inset-[-18px] rounded-full border" aria-hidden="true" />
          <Avatar size="xl" state={avatarStateFor(state)} className="scale-[0.6]" />
        </div>
        <Waveform className="w-[280px]" bars={40} height={44} />
        <div className="min-h-[64px] w-full max-w-[320px] text-center">
          <Captions limit={2} className="text-center" />
        </div>
      </div>
      <div className="flex w-full flex-col items-center gap-2">
        <Button
          size="lg"
          onClick={onStart}
          disabled={!ready}
          data-testid="voice-start"
          className="h-12 w-full max-w-[320px] text-[15px] font-medium shadow-[0_0_24px_-8px_var(--accent-glow)]"
        >
          {activation === 'hold' ? 'Hold to talk' : 'Start voice session'} <ArrowRight size={16} aria-hidden="true" />
        </Button>
        <p className="text-text-tertiary text-[12px]">
          {reason ?? (
            <>
              <Kbd>Space</Kbd> toggles · <Kbd>M</Kbd> mute · <Kbd>Esc</Kbd> back
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/* ── approval bar ───────────────────────────────────────────────────────── */

export function VoiceApprovalBar({ dark, className }: { dark?: boolean; className?: string }) {
  const approval = useVoiceStore((s) => s.approval);
  if (!approval) return null;
  return (
    <div
      role="alert"
      data-testid="voice-approval-bar"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        dark ? 'border-[#F59E0B]/50 bg-[#F59E0B]/10 text-white' : 'border-warning/50 bg-warning/10 text-text-primary',
        className,
      )}
    >
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <p className="font-medium">
          Say <span className="text-[#F59E0B]">confirm</span> or <span className="text-[#F59E0B]">cancel</span>
          {approval.riskTier ? <span className={cn('ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase', dark ? 'bg-white/10' : 'bg-bg-raised')}>{approval.riskTier}</span> : null}
        </p>
        <p className={dark ? 'text-white/70' : 'text-text-secondary'}>
          {approval.tool}: {approval.reason}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={() => voice.decideApproval(approval.id, false)} data-testid="voice-approval-deny">
          <X size={13} aria-hidden="true" /> Deny
        </Button>
        <Button size="sm" onClick={() => voice.decideApproval(approval.id, true)} data-testid="voice-approval-approve">
          <Check size={13} aria-hidden="true" /> Approve
        </Button>
      </div>
    </div>
  );
}

/* ── cinematic session hero ─────────────────────────────────────────────── */

export function SessionHero({ onDock, onStop }: { onDock: () => void; onStop: () => void }) {
  const state = useVoiceStore((s) => s.sessionState);
  const muted = useVoiceStore((s) => s.muted);
  const pressed = useVoiceStore((s) => s.pressed);
  const activation = useVoiceStore((s) => s.settings?.desktop.activation ?? 'tap');
  const error = useVoiceStore((s) => s.error);
  const reduceMotion = useReducedMotion();
  const setInlineSurface = useApprovalStore((s) => s.setInlineSurface);

  // The voice bar is the approval surface while the hero is up (the modal
  // would cover the same request twice). Restored on unmount.
  useEffect(() => {
    setInlineSurface(true);
    return () => setInlineSurface(false);
  }, [setInlineSurface]);

  const speaking = state === 'speaking';
  const listening = state === 'listening' || state === 'interrupted';
  const hold = activation === 'hold';

  return (
    <section
      aria-label="Voice session"
      data-testid="voice-session-hero"
      data-state={state}
      className="relative flex h-full min-h-[560px] flex-col overflow-hidden rounded-2xl text-white"
      style={{ backgroundColor: '#03070D' }}
    >
      {/* concentric rings — breathe while listening, ripple while speaking */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn('absolute rounded-full border', !reduceMotion && listening && 'xr-voice-breathe', !reduceMotion && speaking && 'xr-voice-ripple')}
            style={{
              width: `${220 + i * 120}px`,
              height: `${220 + i * 120}px`,
              borderColor: `rgba(0,229,255,${0.16 - i * 0.03})`,
              animationDelay: `${i * 0.35}s`,
            }}
          />
        ))}
        <span className="absolute size-[520px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,229,255,0.10) 0%, rgba(0,229,255,0) 60%)' }} />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 pt-4">
        <StateChip state={state} dark />
        <div className="flex items-center gap-2">
          <CostChip dark />
          <Button size="sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={onDock} title="Dock (Esc) — keeps listening">
            <Minimize2 size={14} aria-hidden="true" /> Dock
          </Button>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className={cn('relative flex items-center justify-center', !reduceMotion && state === 'idle' && 'xr-voice-breathe')}>
          <Avatar size="xl" state={avatarStateFor(state)} />
        </div>
        <Waveform className="w-[min(520px,80%)]" bars={56} height={64} color="#00E5FF" />
        <div className="w-full max-w-[640px] rounded-xl px-5 py-4" style={{ backgroundColor: 'rgba(3,7,13,0.85)', backdropFilter: 'blur(12px)' }}>
          <Captions dark limit={4} />
        </div>
        <VoiceApprovalBar dark className="w-full max-w-[640px]" />
        {error && state !== 'listening' ? (
          <p className="text-[13px] text-[#F59E0B]" role="status">
            {error.message}
          </p>
        ) : null}
      </div>

      <footer className="relative z-10 flex items-center justify-center gap-4 px-6 pb-6">
        <Button size="icon-lg" variant="ghost" className={cn('rounded-full text-white/80 hover:bg-white/10 hover:text-white', muted && 'bg-white/10')} onClick={() => voice.toggleMuted()} aria-pressed={muted} aria-label={muted ? 'Unmute microphone (M)' : 'Mute microphone (M)'} title={muted ? 'Unmute (M)' : 'Mute (M)'} data-testid="voice-mute">
          {muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        </Button>
        <button
          type="button"
          data-testid="voice-talk"
          aria-label={hold ? 'Hold to talk' : speaking ? 'Interrupt' : 'Listening'}
          aria-pressed={hold ? pressed : undefined}
          onPointerDown={hold ? () => void voice.pressStart('screen') : undefined}
          onPointerUp={hold ? () => voice.pressEnd() : undefined}
          onPointerCancel={hold ? () => voice.pressEnd() : undefined}
          onPointerLeave={hold && pressed ? () => voice.pressEnd() : undefined}
          onClick={!hold ? () => (speaking ? voice.bargeIn() : voice.setMuted(false)) : undefined}
          className={cn(
            'flex size-[72px] items-center justify-center rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-[#00E5FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#03070D] focus-visible:outline-none',
            listening && !muted ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF] shadow-[0_0_32px_-4px_rgba(0,229,255,0.6)]' : 'border-white/25 bg-white/5 text-white/80',
            pressed && 'scale-95',
            speaking && 'border-[#00E5FF]/60',
          )}
        >
          <Mic size={28} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <Button size="icon-lg" variant="ghost" className="rounded-full text-white/80 hover:bg-white/10 hover:text-white" onClick={onStop} aria-label="Stop voice session" title="Stop" data-testid="voice-stop">
          <Square size={18} aria-hidden="true" />
        </Button>
      </footer>
      <p className="relative z-10 pb-3 text-center text-[11px] text-white/40">
        {hold ? 'Hold Space or the button while you speak' : 'Speak any time — talking over XR interrupts it'} · <span className="text-white/55">M</span> mute · <span className="text-white/55">Esc</span> dock
      </p>
      <p className="sr-only" aria-live="polite">
        {STATE_COPY[state]}
      </p>
    </section>
  );
}
