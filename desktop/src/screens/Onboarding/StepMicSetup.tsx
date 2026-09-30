import { Mic, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { detectMics } from '@/lib/detect';
import { useOnboardingStore } from '@/stores/onboarding';
import { Reveal, StepHeader, Toggle } from './parts';

/**
 * Step 6 — microphone. Permission + device list (labels appear only after
 * getUserMedia), live volume meter (Web Audio AnalyserNode RMS → 1–15 bars),
 * noise-suppression + wake-word toggles (wake word is visual-only until 15).
 */
export function StepMicSetup() {
  const { mics, micSelected, noiseSuppression, wakeWordEnabled, setDetections, setMic, setVoicePrefs } =
    useOnboardingStore();
  const [testing, setTesting] = useState(false);
  const [bars, setBars] = useState(0);
  const [denied, setDenied] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (mics) return;
    let cancelled = false;
    void (async () => {
      const m = await detectMics(true);
      if (cancelled) return;
      setDetections({ mics: m });
      setDenied(m.permission === 'denied');
      if (m.devices.length > 0) {
        setMic(micSelected ?? m.devices[0]?.id ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setTesting(false);
    setBars(0);
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: noiseSuppression,
          echoCancellation: true,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        // RMS → 1..15 bars (log-ish mapping, floor noise gated off).
        const level = Math.min(15, Math.max(0, Math.round(rms * 60)));
        setBars(level);
        rafRef.current = requestAnimationFrame(tick);
      };
      setTesting(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setDenied(true);
      setTesting(false);
    }
  }, [noiseSuppression]);

  useEffect(() => stopMeter, [stopMeter]);

  const devices = mics?.devices ?? [];

  return (
    <div>
      <StepHeader
        title="Set your microphone."
        sub="XR listens only while you hold the key or tap the orb — never passively."
      />

      {denied ? (
        <Reveal>
          <div className="border-border-subtle bg-bg-raised/40 rounded-xl border p-4">
            <p className="text-text-primary text-[14px] font-medium">Microphone access was declined.</p>
            <p className="text-text-tertiary mt-1 text-[13px] leading-relaxed">
              That's fine — XR works fully by text. You can enable the mic later in your system
              settings, and re-run this test from Settings → Voice.
            </p>
          </div>
        </Reveal>
      ) : (
        <>
          <Reveal>
            <label className="text-text-tertiary mb-1.5 block text-[11px] font-semibold tracking-wide uppercase">
              Input device
            </label>
            <select
              value={micSelected ?? devices[0]?.id ?? ''}
              onChange={(e) => setMic(e.target.value)}
              className="border-border-default bg-bg-void text-text-primary w-full rounded-lg border px-3 py-2 text-[13.5px] outline-none focus:border-accent"
            >
              {devices.length === 0 && <option value="">Default microphone</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || 'Microphone'}
                </option>
              ))}
            </select>
          </Reveal>

          {/* Volume meter — 1–15 bars */}
          <Reveal delay={0.08}>
            <div className="border-border-subtle bg-bg-raised/40 mt-4 rounded-xl border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-text-secondary text-[13px] font-medium">Test your mic</span>
                <button
                  type="button"
                  onClick={() => (testing ? stopMeter() : void startMeter())}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${
                    testing ? 'bg-danger/15 text-danger' : 'bg-accent text-accent-contrast hover:bg-accent-hover'
                  }`}
                >
                  {testing ? (
                    <>
                      <Square aria-hidden="true" className="size-3" strokeWidth={1.5} /> Stop
                    </>
                  ) : (
                    <>
                      <Mic aria-hidden="true" className="size-3" strokeWidth={1.5} /> Test
                    </>
                  )}
                </button>
              </div>
              <div
                className="flex h-8 items-end gap-1"
                role="meter"
                aria-label="Microphone volume"
                aria-valuenow={bars}
                aria-valuemin={0}
                aria-valuemax={15}
              >
                {Array.from({ length: 15 }, (_, i) => (
                  <span
                    key={i}
                    className="w-full rounded-sm transition-[background-color] duration-75"
                    style={{
                      height: `${25 + i * 5}%`,
                      backgroundColor:
                        testing && i < bars ? 'var(--accent)' : 'color-mix(in oklab, var(--text-tertiary) 25%, transparent)',
                    }}
                  />
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="mt-4 space-y-1">
              <Toggle
                checked={noiseSuppression}
                onChange={(v) => setVoicePrefs({ noiseSuppression: v })}
                label="Noise suppression"
                desc="Cleans up typing and fan noise while you speak."
              />
              <Toggle
                checked={wakeWordEnabled}
                onChange={(v) => setVoicePrefs({ wakeWordEnabled: v })}
                label='Wake word ("Hey XR")'
                desc="Visual toggle for now — wake-word listening arrives in Phase 15."
              />
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}
