import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { EngineHttpError } from '@/engine/transport';
import { useOnboardingStore } from '@/stores/onboarding';
import { voiceApi } from '@/voice/voiceApi';
import { OptionCard, Reveal, StepHeader } from './parts';

/*
 * Voice presets (2026-11-01 revision). The ids ARE the engine's TTS voice
 * ids (src/voice/models.ts TTS_VOICES) so the wizard's choice lands in the
 * engine settings verbatim. "Ahmad" is the youthful male Piper kusal voice
 * (the old default was the female lessac voice — wrong, and rejected).
 *
 * Audition honesty (S-1): what you hear here is the voice you get, because
 * playback is the engine's own /voice/test-tts render of the selected id. The
 * OS speech engine is only a STAND-IN for a build that has no TTS model on
 * disk yet, and the label says so — it must never pass for the shipped voice.
 */
const VOICES = [
  { id: 'piper-kusal', name: 'Ahmad', tag: 'Default · warm and direct', pitch: 1.12, rate: 1.0, gender: 'male' },
  { id: 'piper-kristin', name: 'Nova', tag: 'Bright, quick', pitch: 1.25, rate: 1.05, gender: 'female' },
  { id: 'piper-ryan', name: 'Atlas', tag: 'Deep, measured', pitch: 0.8, rate: 0.95, gender: 'male' },
  { id: 'piper-amy', name: 'Sage', tag: 'Calm, considered', pitch: 1.05, rate: 0.9, gender: 'female' },
] as const;

const SAMPLE: Record<string, string> = {
  'piper-kusal': "Hey. I'm XR — good to meet you.",
  'piper-kristin': "Hey! I'm XR — ready when you are.",
  'piper-ryan': 'Hello. I\'m XR. Let\'s begin.',
  'piper-amy': "Hi — I'm XR. Take your time.",
};

type PreviewMode = 'engine' | 'stand-in';

/** What `/voice/test-tts` 409s about, kept so the step can offer the fix. */
interface MissingVoice {
  id: string;
  bytes: number;
}

/**
 * Step 7 — pick XR's voice. Every card is auditioned with the engine's own
 * synthesis (`/voice/test-tts`), so the id saved in `ttsVoice` is the voice
 * the run actually speaks with. The OS voice is a labelled fallback.
 */
export function StepVoice() {
  const { ttsVoice, setVoicePrefs } = useOnboardingStore();
  const [playing, setPlaying] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingVoice | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const aliveRef = useRef(true);
  const [speed, setSpeed] = useState(1);
  // Feature-detect once — the speech engine can't appear mid-session.
  const speechOk = typeof speechSynthesis !== 'undefined';
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const load = () => {
      voicesRef.current = speechSynthesis.getVoices();
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      aliveRef.current = false;
      speechSynthesis.removeEventListener('voiceschanged', load);
      speechSynthesis.cancel();
      audioRef.current?.pause();
    };
  }, []);

  /**
   * Start the engine download for the missing voice and audition it the moment
   * the model lands. Progress is the engine's own byte count — the desktop does
   * not invent a percentage.
   */
  const downloadVoice = async (id: string) => {
    setNote(null);
    setDownloading(0);
    try {
      await voiceApi.download({ id, firstRun: true });
      for (let i = 0; i < 600 && aliveRef.current; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await voiceApi.status().catch(() => null);
        if (!st) break;
        if (!st.download) break;
        const total = st.download.bundleTotal ?? 0;
        setDownloading(
          total > 0 ? Math.round(((st.download.bundleReceived ?? st.download.received) / total) * 100) : st.download.percent,
        );
      }
      if (!aliveRef.current) return;
      setDownloading(null);
      setMissing(null);
      void previewWithEngine(id);
    } catch {
      if (aliveRef.current) {
        setDownloading(null);
        setNote('The download could not start — retry from Settings → Voice.');
      }
    }
  };

  const stop = () => {
    audioRef.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setPlaying(null);
  };

  /** The labelled stand-in: OS speech, pitched toward the preset's character. */
  const previewWithOsVoice = (id: string) => {
    if (typeof speechSynthesis === 'undefined') return;
    const v = VOICES.find((x) => x.id === id)!;
    const u = new SpeechSynthesisUtterance(SAMPLE[id] ?? SAMPLE['piper-kusal']!);
    const pool = voicesRef.current.filter((x) => x.lang.startsWith('en'));
    const match =
      v.gender === 'female'
        ? pool.find((x) => /female|samantha|victoria|zira|aria/i.test(x.name))
        : pool.find((x) => /male|daniel|alex|david|guy/i.test(x.name));
    if (match) u.voice = match;
    u.pitch = v.pitch;
    u.rate = v.rate * speed;
    u.onend = () => setPlaying(null);
    u.onerror = () => setPlaying(null);
    setMode('stand-in');
    setPlaying(id);
    speechSynthesis.speak(u);
  };

  /** The audited path: the engine renders the exact voice the user is choosing. */
  const previewWithEngine = async (id: string) => {
    setNote(null);
    setPlaying(id);
    try {
      const out = await voiceApi.testTts(SAMPLE[id] ?? SAMPLE['piper-kusal']!, id, speed);
      if (!out.wav) {
        // The engine spoke it host-side (system voice) — it cannot hand us bytes.
        setNote(out.detail ?? 'The engine host spoke this sample through its own system voice.');
        setMode('engine');
        setPlaying(null);
        return;
      }
      const audio = new Audio(`data:audio/wav;base64,${out.wav}`);
      audioRef.current = audio;
      audio.onended = () => setPlaying(null);
      audio.onerror = () => {
        setNote('This browser could not play the engine audio; use the OS preview.');
        setPlaying(null);
      };
      setMode('engine');
      await audio.play();
    } catch (err) {
      const body = err instanceof EngineHttpError ? err.body : null;
      if (body?.error === 'voice-not-installed') {
        // S-2: a missing model is a state with a fix, not a dead button.
        setMissing({ id, bytes: Number(body.bytes ?? 0) });
        setNote('This voice is not downloaded yet — below is your system voice, not XR.');
        previewWithOsVoice(id);
        return;
      }
      setNote('The engine is not reachable, so this preview is your system voice, not XR.');
      previewWithOsVoice(id);
    }
  };

  const preview = (id: string) => {
    if (playing === id) {
      stop();
      return;
    }
    stop();
    void previewWithEngine(id);
  };

  const sub =
    mode === 'engine'
      ? 'That is the engine voice itself — the one your runs will use.'
      : mode === 'stand-in'
        ? 'Stand-in: your system voice, not XR. Download the voice in Settings → Voice to audition the real one.'
        : speechOk
          ? 'Tap play to hear each one, rendered by the engine.'
          : 'Your system has no speech engine — the engine preview needs a reachable daemon.';

  return (
    <div>
      <StepHeader title="Choose a voice." sub={sub} />

      <div role="radiogroup" aria-label="XR voice" className="grid grid-cols-2 gap-3">
        {VOICES.map((v, i) => (
          <Reveal key={v.id} delay={0.05 * i}>
            <OptionCard
              role="radio"
              selected={ttsVoice === v.id}
              onClick={() => setVoicePrefs({ ttsVoice: v.id })}
              title={v.name}
              desc={v.tag}
              ariaLabel={`Voice ${v.name}`}
              right={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    preview(v.id);
                  }}
                  aria-label={`Preview ${v.name} voice`}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    playing === v.id ? 'bg-accent text-accent-contrast' : 'bg-bg-raised text-text-secondary hover:text-accent border border-border-subtle'
                  }`}
                >
                  {playing === v.id ? (
                    <Pause aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                  ) : (
                    <Play aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                  )}
                </button>
              }
            />
          </Reveal>
        ))}
      </div>

      {note || missing || downloading !== null ? (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-3">
          {note ? <p className="text-text-tertiary text-[12px]">{note}</p> : null}
          {missing && downloading === null ? (
            <button
              type="button"
              onClick={() => void downloadVoice(missing.id)}
              className="border-border-subtle bg-bg-raised text-text-secondary hover:text-accent rounded-full border px-3 py-1 text-[12px] font-medium"
            >
              Download voice ({(missing.bytes / 1e6).toFixed(0)} MB)
            </button>
          ) : null}
          {downloading !== null ? (
            <span className="text-text-tertiary font-mono text-[12px]">Downloading… {downloading}%</span>
          ) : null}
        </div>
      ) : null}

      <Reveal delay={0.25}>
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="voice-speed" className="text-text-tertiary text-[11px] font-semibold tracking-wide uppercase">
              Speaking speed
            </label>
            <span className="text-text-secondary font-mono text-[12px]">{speed.toFixed(2)}×</span>
          </div>
          <input
            id="voice-speed"
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="accent-accent w-full"
          />
        </div>
      </Reveal>
    </div>
  );
}
