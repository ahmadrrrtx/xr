/*
 * Theater link (Phase 16) — the main window's half of the Voice Theater.
 *
 * The theater is a render target: this module mirrors the Phase 15 voice
 * state onto the bus and turns `theater:*` intents back into controller
 * calls. Nothing here touches audio or the engine.
 *
 *   voiceStore ──► voice:transcript / approval / error / mute-changed
 *   session.ts ──► voice:state-changed (broadcastState) · voice:tts-word
 *   levels     ──► voice:level at 30 fps, only while a theater is open
 *   theater:*  ──► voice.toggle / toggleMuted / decideApproval / navigate
 *
 * "Open in immersive theater": a session that starts while the preference
 * is on opens the theater (whatever surface started it). Closing the theater
 * never stops voice unless `xr.theater.closeStopsVoice` is set.
 */
import { readSettingJSON } from '@/lib/persistent-store';
import { emitTheater, listenTheater, theaterIsOpen, theaterOpen } from '@/lib/theater';
import { LEVEL_FPS, THEATER_IN, THEATER_KEYS, THEATER_OUT, wordTimeline } from '@/lib/theaterCore';

import { voice } from './session';
import { useVoiceStore, type VoiceCaption } from './voiceStore';

const captionsFor = (captions: readonly VoiceCaption[]) => captions.map((c) => ({ id: c.id, role: c.role, text: c.text }));

const idOf = (payload: unknown): string | null => {
  const id = (payload as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
};

export interface TheaterLinkOptions {
  navigate: (to: string) => void;
}

/** Mount once in the main window (useVoiceIpc). Returns the teardown. */
export function initTheaterLink({ navigate }: TheaterLinkOptions): () => void {
  const offs: Array<() => void> = [];
  let open = false;
  let pump: number | null = null;
  let sweep: number[] = [];
  let utterance = 0;

  const snapshot = (): void => {
    const s = useVoiceStore.getState();
    emitTheater(THEATER_IN.snapshot, {
      state: s.sessionState,
      active: s.active,
      muted: s.muted,
      captions: captionsFor(s.captions),
      approval: s.approval ? { id: s.approval.id, tool: s.approval.tool, reason: s.approval.reason } : null,
    });
  };

  const startPump = (): void => {
    if (pump !== null) return;
    pump = window.setInterval(() => {
      emitTheater(THEATER_IN.level, { mic: voice.levels.mic, out: voice.levels.out });
    }, 1000 / LEVEL_FPS);
  };
  const stopPump = (): void => {
    if (pump !== null) window.clearInterval(pump);
    pump = null;
  };
  const clearSweep = (): void => {
    sweep.forEach((t) => window.clearTimeout(t));
    sweep = [];
  };

  /* theater → main */
  offs.push(
    listenTheater(THEATER_OUT.ready, () => {
      open = true;
      snapshot();
      startPump();
    }),
    listenTheater(THEATER_OUT.close, () => {
      open = false;
      stopPump();
      void readSettingJSON<boolean>(THEATER_KEYS.closeStopsVoice).then((stops) => {
        const s = useVoiceStore.getState();
        if (!s.active) return;
        if (stops === true) void voice.stop('user');
        // Voice continues: give it a visible home (the docked pill) unless
        // the Voice screen is already showing the session.
        else if (!window.location.hash.startsWith('#/voice')) s.setDocked(true);
      });
    }),
    listenTheater(THEATER_OUT.toggleMute, () => voice.toggleMuted()),
    listenTheater(THEATER_OUT.toggleListen, () => void voice.toggle('theater')),
    listenTheater(THEATER_OUT.approve, (p) => {
      const id = idOf(p);
      if (id) voice.decideApproval(id, true);
    }),
    listenTheater(THEATER_OUT.deny, (p) => {
      const id = idOf(p);
      if (id) voice.decideApproval(id, false);
    }),
    listenTheater(THEATER_OUT.openSettings, () => navigate('/voice')),
  );

  /* main → theater */
  offs.push(
    useVoiceStore.subscribe((s, prev) => {
      if (s.captions !== prev.captions) emitTheater(THEATER_IN.transcript, { captions: captionsFor(s.captions) });
      if (s.approval !== prev.approval) {
        emitTheater(THEATER_IN.approval, s.approval ? { id: s.approval.id, tool: s.approval.tool, reason: s.approval.reason } : null);
      }
      if (s.error !== prev.error && s.error) emitTheater(THEATER_IN.error, { message: s.error.message });
      if (s.muted !== prev.muted) emitTheater(THEATER_IN.mute, { muted: s.muted });
      if (s.active && !prev.active && s.settings?.desktop.theaterImmersive) void theaterOpen();
    }),
  );

  // Karaoke: Piper has no word alignment, so the sweep is scheduled from the
  // decoded duration (theaterCore.wordTimeline) and cancelled on barge-in.
  offs.push(
    voice.onTts((ev) => {
      clearSweep();
      if (ev.kind === 'stop') {
        emitTheater(THEATER_IN.ttsWord, { id: String(utterance), index: 0, total: 0, text: '' });
        return;
      }
      utterance += 1;
      const id = String(utterance);
      const timings = wordTimeline(ev.text, ev.durationMs);
      const total = timings.length;
      if (total === 0) return;
      emitTheater(THEATER_IN.ttsWord, { id, index: 0, total, text: ev.text });
      sweep = timings.map((t) =>
        window.setTimeout(() => {
          emitTheater(THEATER_IN.ttsWord, { id, index: t.index + 1, total, text: ev.text });
        }, t.end),
      );
    }),
  );

  // A theater that outlived a main-window reload still deserves its feed.
  void theaterIsOpen().then((isOpen) => {
    if (isOpen && !open) {
      open = true;
      snapshot();
      startPump();
    }
  });

  return () => {
    offs.forEach((off) => off());
    stopPump();
    clearSweep();
  };
}
