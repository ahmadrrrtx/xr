/*
 * Settings → Voice (Phase 8) — microphone pick + live level meter,
 * text-to-speech pick + rate, and voice-activation posture (PTT rebind,
 * wake word / always-listen land with the voice engine in Phase 15).
 * XR never listens passively: push-to-talk is the only live path today.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { LabeledSlider, Select, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { Globe } from 'lucide-react';
import { detectMics } from '@/lib/detect';
import { isTauri } from '@/lib/tauri';
import { eventToCombo, formatTauriChord, toTauriChord } from '@/lib/shortcuts';
import { pttSetShortcut, pttShortcutInfo } from '@/lib/settingsApi';
import { useSettingsStore } from '@/stores/settingsStore';

const METER_SECONDS = 5;

export function VoiceTab() {
  const voice = useSettingsStore((state) => state.settings.voice);
  const update = useSettingsStore((state) => state.update);

  /* ── microphone ── */
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [denied, setDenied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [countdown, setCountdown] = useState(METER_SECONDS);
  const [bars, setBars] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);

  const loadMics = (): void => {
    void detectMics(true).then((result) => {
      setDevices(result.devices);
      setDenied(result.permission === 'denied');
    });
  };

  useEffect(() => {
    loadMics();
  }, []);

  const stopMeter = (): void => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setTesting(false);
    setBars(0);
    setCountdown(METER_SECONDS);
  };

  const startMeter = (): void => {
    stopMeter();
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: voice.micDeviceId ? { exact: voice.micDeviceId } : undefined,
            noiseSuppression: true,
            echoCancellation: true,
          },
        });
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0.1, voice.inputVolume / 100); // input volume, applied live
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(gain);
        gain.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = (): void => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const value of buf) sum += value * value;
          const rms = Math.sqrt(sum / buf.length);
          setBars(Math.min(15, Math.max(0, Math.round(rms * 60))));
          rafRef.current = requestAnimationFrame(tick);
        };
        setTesting(true);
        rafRef.current = requestAnimationFrame(tick);
        timerRef.current = window.setInterval(() => {
          setCountdown((seconds) => {
            if (seconds <= 1) {
              stopMeter();
              return METER_SECONDS;
            }
            return seconds - 1;
          });
        }, 1000);
      } catch {
        setDenied(true);
        setTesting(false);
      }
    })();
  };

  useEffect(() => stopMeter, []);

  /* ── text to speech ── */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = (): void => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const testVoice = (): void => {
    if (!('speechSynthesis' in window)) {
      toast('Speech synthesis is not available here');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance('This is XR. How can I help?');
    const picked = voices.find((candidate) => candidate.voiceURI === voice.ttsVoiceUri);
    if (picked) utterance.voice = picked;
    utterance.rate = voice.rate;
    window.speechSynthesis.speak(utterance);
  };

  /* ── push-to-talk ── */
  const [pttChord, setPttChord] = useState<string | null>(null);
  const [pttRecording, setPttRecording] = useState(false);
  const [pttWarning, setPttWarning] = useState<'modifier' | 'system' | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void pttShortcutInfo().then((chord) => {
      if (chord) setPttChord(chord);
    });
  }, []);

  useEffect(() => {
    if (!pttRecording) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setPttRecording(false);
        setPttWarning(null);
        return;
      }
      const combo = eventToCombo(event);
      if (!combo) return;
      if (!combo.includes('+')) {
        setPttWarning('modifier');
        return;
      }
      void pttSetShortcut(toTauriChord(combo)).then((result) => {
        if (result === null || result.conflict) {
          setPttWarning('system');
          return;
        }
        setPttChord(result.shortcut);
        setPttRecording(false);
        setPttWarning(null);
        toast.success(`Push-to-talk: ${formatTauriChord(result.shortcut)}`);
      });
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [pttRecording]);

  return (
    <div>
      {/* ── Microphone ── */}
      <SettingsSection title="Microphone">
        {denied ? (
          <div className="border-border-subtle bg-bg-raised/40 px-3.5 py-3.5 rounded-lg border">
            <p className="text-text-primary text-[13px] font-medium">
              Microphone access was declined.
            </p>
            <p className="text-text-tertiary mt-1 text-xs leading-relaxed">
              XR works fully by text. Enable the microphone in your system settings, then
              check again here.
            </p>
          </div>
        ) : null}
        <SettingRow label="Input device" htmlFor="xr-mic-device">
          <div className="flex items-center gap-2">
            <Select
              ariaLabel="Microphone device"
              value={voice.micDeviceId ?? ''}
              placeholder="Default microphone"
              options={devices.map((device) => ({
                value: device.id,
                label: device.label || 'Microphone',
              }))}
              onChange={(value) => update('voice', { micDeviceId: value || null })}
            />
            <Button variant="ghost" size="sm" onClick={loadMics}>
              Refresh
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          label="Test microphone"
          description={
            testing
              ? `Listening for ${countdown}s — speak at your normal volume.`
              : 'Runs a 5-second level check on the selected device.'
          }
        >
          <Button size="sm" variant={testing ? 'outline' : 'default'} onClick={testing ? stopMeter : startMeter}>
            {testing ? 'Stop' : 'Start test'}
          </Button>
        </SettingRow>
        {testing || bars > 0 ? (
          <div className="border-border-subtle border-t px-3.5 py-3" aria-hidden>
            <div className="flex items-end gap-1" style={{ height: 20 }}>
              {Array.from({ length: 15 }, (_, index) => (
                <span
                  key={index}
                  className={`w-1.5 rounded-sm transition-[height] duration-75 ${
                    index < bars ? 'bg-accent' : 'bg-border-subtle'
                  }`}
                  style={{ height: index < bars ? 6 + index : 4 }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <SettingRow label="Input volume" htmlFor="xr-input-volume">
          <LabeledSlider
            label="Input volume"
            min={10}
            max={100}
            value={voice.inputVolume}
            onChange={(value) => update('voice', { inputVolume: value })}
            format={(value) => `${value}%`}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Text to speech ── */}
      <SettingsSection title="Text to speech">
        <SettingRow label="Voice" htmlFor="xr-tts-voice">
          <Select
            ariaLabel="Text to speech voice"
            value={voice.ttsVoiceUri ?? ''}
            placeholder="System default"
            options={voices.map((candidate) => ({
              value: candidate.voiceURI,
              label: `${candidate.name} (${candidate.lang})`,
            }))}
            onChange={(value) => update('voice', { ttsVoiceUri: value || null })}
          />
        </SettingRow>
        <SettingRow label="Speaking rate" htmlFor="xr-tts-rate">
          <LabeledSlider
            label="Speaking rate"
            min={0.5}
            max={2}
            step={0.1}
            value={voice.rate}
            onChange={(value) => update('voice', { rate: value })}
            format={(value) => `${value.toFixed(1)}×`}
          />
        </SettingRow>
        <SettingRow label="Preview" description="Speaks a short sample with the selected voice and rate.">
          <Button variant="ghost" size="sm" onClick={testVoice}>
            Play sample
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Voice activation ── */}
      <SettingsSection title="Voice activation">
        <SettingRow
          label={
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                <Globe size={9} className="mr-1" /> Global
              </Badge>
              <span className="text-text-primary text-[13px] font-medium">Push-to-talk key</span>
            </span>
          }
          description={
            pttRecording
              ? pttWarning === 'modifier'
                ? 'Add a modifier (⌘/Ctrl, Alt or Shift). Esc cancels.'
                : pttWarning === 'system'
                  ? 'The OS refused that chord — another app may own it. Try again.'
                  : 'Press keys now. Esc cancels.'
              : 'Hold to talk — works even when XR is not focused.'
          }
        >
          {pttRecording ? (
            <div className="flex items-center gap-2">
              <span className="border-accent/60 text-accent animate-pulse rounded-md border border-dashed px-2.5 py-1 text-xs">
                Recording…
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPttRecording(false);
                  setPttWarning(null);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Kbd>
                {formatTauriChord(pttChord ?? toTauriChord('mod+.'))}
              </Kbd>
              <Button variant="ghost" size="sm" onClick={() => setPttRecording(true)}>
                Rebind
              </Button>
            </div>
          )}
        </SettingRow>
        <SettingRow
          label="Wake word (“Hey XR”)"
          htmlFor="xr-wake-word"
          description={
            voice.wakeWord
              ? 'Saved — listening starts with the voice engine (Phase 15).'
              : 'Off. The voice engine arrives in Phase 15.'
          }
        >
          <Toggle
            id="xr-wake-word"
            checked={voice.wakeWord}
            onCheckedChange={(v) => update('voice', { wakeWord: v })}
          />
        </SettingRow>
        <SettingRow
          label="Always listen while Orb is visible"
          htmlFor="xr-always-listen"
          description={
            voice.alwaysListen
              ? 'Saved — active listening starts with the voice engine (Phase 15).'
              : 'Off. XR listens only while you hold the push-to-talk key.'
          }
        >
          <Toggle
            id="xr-always-listen"
            checked={voice.alwaysListen}
            onCheckedChange={(v) => update('voice', { alwaysListen: v })}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Sounds ── */}
      <SettingsSection title="Sounds">
        <SettingRow label="Mute all XR sounds" htmlFor="xr-sounds-muted">
          <Toggle
            id="xr-sounds-muted"
            checked={voice.muted}
            onCheckedChange={(v) => update('voice', { muted: v })}
          />
        </SettingRow>
        <SettingRow label="Sound volume" htmlFor="xr-sounds-volume">
          <LabeledSlider
            label="Sound volume"
            min={0}
            max={100}
            value={voice.soundsVolume}
            onChange={(value) => update('voice', { soundsVolume: value })}
            format={(value) => `${value}%`}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
