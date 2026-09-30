import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useOnboardingStore } from '@/stores/onboarding';
import { OptionCard, Reveal, StepHeader } from './parts';

const VOICES = [
  { id: 'ahmad', name: 'Ahmad', tag: 'Default · warm, direct', pitch: 1.0, rate: 1.0, gender: 'male' },
  { id: 'nova', name: 'Nova', tag: 'Bright, quick', pitch: 1.25, rate: 1.05, gender: 'female' },
  { id: 'atlas', name: 'Atlas', tag: 'Deep, measured', pitch: 0.8, rate: 0.95, gender: 'male' },
  { id: 'sage', name: 'Sage', tag: 'Calm, considered', pitch: 1.05, rate: 0.9, gender: 'female' },
] as const;

const SAMPLE: Record<string, string> = {
  ahmad: "Hey. I'm XR — good to meet you.",
  nova: "Hey! I'm XR — ready when you are.",
  atlas: "Hello. I'm XR. Let's begin.",
  sage: "Hi — I'm XR. Take your time.",
};

/**
 * Step 7 — pick XR's voice. Previews use the OS speech engine (Web Speech)
 * as a stand-in; the traced XR voices arrive with the TTS phase (15).
 */
export function StepVoice() {
  const { ttsVoice, setVoicePrefs } = useOnboardingStore();
  const [playing, setPlaying] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  // Feature-detect once — the speech engine can't appear mid-session.
  const speechOk = typeof speechSynthesis !== 'undefined';
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const load = () => {
      voicesRef.current = speechSynthesis.getVoices();
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load);
      speechSynthesis.cancel();
    };
  }, []);

  const preview = (id: string) => {
    if (playing === id) {
      speechSynthesis.cancel();
      setPlaying(null);
      return;
    }
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const v = VOICES.find((x) => x.id === id)!;
    const u = new SpeechSynthesisUtterance(SAMPLE[id] ?? SAMPLE.ahmad!);
    // Best-effort OS voice match; pitch/rate carry the character either way.
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
    setPlaying(id);
    speechSynthesis.speak(u);
  };

  return (
    <div>
      <StepHeader
        title="Choose a voice."
        sub={speechOk ? 'Tap play to hear each one — the OS engine previews the tone.' : 'Your system has no speech engine — pick by feel for now.'}
      />

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
