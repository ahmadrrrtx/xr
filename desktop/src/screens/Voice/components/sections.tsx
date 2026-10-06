/*
 * Voice settings sections (SCREEN 13, left column) — Phase 8 Settings
 * pattern: grouped cards, 44 px rows, cyan switches. Every control writes
 * through voiceStore.applySettings → engine (validated there) → mirror.
 */
import { AlertTriangle, Mic, Play, Square, Trash2, FolderOpen, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LabeledSlider, Segmented, Select, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { revealPath } from '@/lib/settingsApi';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { base64ToBytes, bytesToBase64, concatPcm16, dbfs, floatToPcm16, formatBytes, pitchToCents, resampleTo16k, engineModeFor } from '@/voice/audio';
import { probeMicrophones, voice } from '@/voice/session';
import { voiceApi, type VoiceSettingsPatch } from '@/voice/voiceApi';
import { useVoiceStore } from '@/voice/voiceStore';

import { PermissionCard } from './shared';

const METER_SECONDS = 5;

function useApply(): (patch: VoiceSettingsPatch) => void {
  const apply = useVoiceStore((s) => s.applySettings);
  return useCallback(
    (patch: VoiceSettingsPatch) => {
      void apply(patch).catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not save'));
    },
    [apply],
  );
}

/* ── Microphone ─────────────────────────────────────────────────────────── */

export function MicrophoneSection() {
  const settings = useVoiceStore((s) => s.settings);
  const devices = useVoiceStore((s) => s.devices);
  const permission = useVoiceStore((s) => s.micPermission);
  const apply = useApply();
  const [testing, setTesting] = useState(false);
  const [left, setLeft] = useState(METER_SECONDS);
  const [level, setLevel] = useState({ rms: 0, peak: 0, clipped: false });
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<number>(0);

  const stopMeter = useCallback((): void => {
    window.clearInterval(timerRef.current);
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTesting(false);
    setLeft(METER_SECONDS);
    setLevel({ rms: 0, peak: 0, clipped: false });
  }, []);

  useEffect(() => stopMeter, [stopMeter]);

  const startMeter = (): void => {
    stopMeter();
    const ctx = voice.ensureContext();
    void (async () => {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(settings?.desktop.micDeviceId ? { deviceId: { exact: settings.desktop.micDeviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: settings?.desktop.noiseSuppression ?? true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        useVoiceStore.getState().setMicPermission('granted');
        void probeMicrophones(false);
        const src = ctx.createMediaStreamSource(stream);
        const node = ctx.createScriptProcessor(2048, 1, 1);
        const sink = ctx.createGain();
        sink.gain.value = 0;
        let clipHold = 0;
        node.onaudioprocess = (ev) => {
          const g = (useVoiceStore.getState().settings?.desktop.inputGain ?? 100) / 100;
          const r = floatToPcm16(ev.inputBuffer.getChannelData(0), g);
          clipHold = r.clipped ? 6 : Math.max(0, clipHold - 1);
          setLevel({ rms: r.rms, peak: r.peak, clipped: clipHold > 0 });
        };
        src.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        nodeRef.current = node;
        setTesting(true);
        timerRef.current = window.setInterval(() => {
          setLeft((n) => {
            if (n <= 1) {
              stopMeter();
              return METER_SECONDS;
            }
            return n - 1;
          });
        }, 1000);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        useVoiceStore.getState().setMicPermission(name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'no-device' : 'prompt');
        stopMeter();
      }
    })();
  };

  const segments = 20;
  const lit = Math.min(segments, Math.round(Math.min(1, level.rms * 4) * segments));
  const db = dbfs(level.rms);

  return (
    <SettingsSection title="Microphone">
      {permission === 'denied' || permission === 'no-device' || permission === 'unsupported' ? (
        <div className="p-3">
          <PermissionCard onRetry={() => void probeMicrophones(true)} />
        </div>
      ) : null}
      <SettingRow label="Input device" htmlFor="xr-voice-mic" description={devices.length === 0 ? 'Grant access once to see device names.' : undefined}>
        <Select
          ariaLabel="Input device"
          value={settings?.desktop.micDeviceId ?? ''}
          placeholder="System default"
          options={[{ value: '', label: 'System default' }, ...devices.map((d) => ({ value: d.id, label: d.label }))]}
          onChange={(v) => {
            apply({ desktop: { micDeviceId: v || null } });
            void voice.switchDevice(v || null);
          }}
          className="w-[220px]"
        />
      </SettingRow>
      <SettingRow
        label="Test microphone"
        description={
          testing ? (
            <span>
              Speak normally · {left}s left ·{' '}
              <span className={cn('tabular-nums', level.clipped && 'text-danger')}>{Number.isFinite(db) ? `${db} dB` : 'silent'}</span>
              {level.clipped ? ' · clipping — lower the gain' : ''}
            </span>
          ) : (
            'Five seconds of live level. Red means clipping.'
          )
        }
      >
        <div className="flex items-center gap-3">
          <div className="flex h-5 items-end gap-[2px]" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, level.rms * 4) * 100)} aria-valuetext={Number.isFinite(db) ? `${db} decibels${level.clipped ? ', clipping' : ''}` : 'silent'}>
            {Array.from({ length: segments }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'w-[5px] rounded-sm transition-colors duration-75',
                  i < lit ? (level.clipped && i >= segments - 3 ? 'bg-danger' : i >= segments - 4 ? 'bg-warning' : 'bg-accent') : 'bg-border-default',
                )}
                style={{ height: `${6 + (i / segments) * 14}px` }}
              />
            ))}
          </div>
          <Button size="sm" variant={testing ? 'secondary' : 'default'} onClick={testing ? stopMeter : startMeter} data-testid="voice-test-mic">
            {testing ? <Square size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
            {testing ? 'Stop' : 'Test'}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label="Input gain" htmlFor="xr-voice-gain" description="Applied before the level meter and the engine.">
        <LabeledSlider
          label="Input gain"
          value={settings?.desktop.inputGain ?? 100}
          min={0}
          max={200}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => {
            voice.applyInputGain(v);
            apply({ desktop: { inputGain: v } });
          }}
          className="w-[220px]"
        />
      </SettingRow>
      <SettingRow
        label={
          <span className="flex items-center gap-2">
            Noise suppression
            <Badge variant="outline" className="text-[9px] tracking-wider uppercase">
              browser-enforced
            </Badge>
          </span>
        }
        htmlFor="xr-voice-noise"
        description="Handled by the audio stack, together with echo cancellation and automatic gain."
      >
        <Toggle id="xr-voice-noise" checked={settings?.desktop.noiseSuppression ?? true} onCheckedChange={(v) => apply({ desktop: { noiseSuppression: v } })} />
      </SettingRow>
    </SettingsSection>
  );
}

/* ── Wake word ──────────────────────────────────────────────────────────── */

export function WakeWordSection() {
  const settings = useVoiceStore((s) => s.settings);
  const apply = useApply();
  const wakeOn = settings?.mode === 'wake-word';
  const activation = settings?.desktop.activation ?? 'tap';
  return (
    <SettingsSection title="Wake word">
      <SettingRow
        label="Enable “Hey XR”"
        htmlFor="xr-voice-wake"
        description="Keeps the microphone open while a session runs and listens for the phrase. Uses more battery; audio stays on this machine with the offline recogniser."
      >
        <Toggle
          id="xr-voice-wake"
          checked={wakeOn}
          onCheckedChange={(v) => apply({ mode: engineModeFor(v ? 'always' : activation, v), desktop: v ? { activation: 'always' } : {} })}
        />
      </SettingRow>
      <SettingRow label="Wake phrase" htmlFor="xr-voice-wake-phrase">
        <input
          id="xr-voice-wake-phrase"
          defaultValue={settings?.wakeWord ?? 'hey xr'}
          key={settings?.wakeWord}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim().toLowerCase();
            if (v && v !== settings?.wakeWord) apply({ wakeWord: v });
          }}
          className="border-border-default bg-bg-void text-text-primary focus-visible:ring-accent h-8 w-[220px] rounded-md border px-2.5 text-[13px] focus-visible:ring-2 focus-visible:outline-none"
          disabled={!wakeOn}
        />
      </SettingRow>
      <SettingRow
        label="Sensitivity"
        description={
          settings?.wakeSensitivity === 'high' ? (
            <span className="text-warning flex items-center gap-1">
              <AlertTriangle size={11} aria-hidden="true" /> High hears quieter speech and triggers more often by mistake.
            </span>
          ) : (
            'How much energy counts as speech.'
          )
        }
      >
        <Segmented
          ariaLabel="Wake sensitivity"
          value={settings?.wakeSensitivity ?? 'medium'}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Med' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(v) => apply({ wakeSensitivity: v })}
        />
      </SettingRow>
      <SettingRow label="Wake sound" htmlFor="xr-voice-wake-sound" description="A short chime when a session starts or XR wakes.">
        <Toggle id="xr-voice-wake-sound" checked={settings?.wakeSound ?? true} onCheckedChange={(v) => apply({ wakeSound: v })} />
      </SettingRow>
    </SettingsSection>
  );
}

/* ── Speech to text ─────────────────────────────────────────────────────── */

export function SttSection() {
  const settings = useVoiceStore((s) => s.settings);
  const models = useVoiceStore((s) => s.models);
  const status = useVoiceStore((s) => s.status);
  const download = useVoiceStore((s) => s.download);
  const startDownload = useVoiceStore((s) => s.startDownload);
  const apply = useApply();
  const [testing, setTesting] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [heard, setHeard] = useState<string | null>(null);

  const sttOptions = [
    ...(models?.stt ?? []).map((m) => ({
      value: m.kind === 'offline' ? `sherpa:${m.id}` : m.id,
      label: `${m.name}${m.kind === 'offline' ? (m.installed ? '' : ` · ${formatBytes(m.bytes)}`) : m.kind === 'cloud' ? ' · cloud' : ' · local app'}`,
    })),
  ];
  const current = settings ? (settings.sttBackend === 'sherpa' || settings.sttBackend === 'auto' ? `sherpa:${settings.sttModel}` : settings.sttBackend) : '';
  const selected = (models?.stt ?? []).find((m) => (m.kind === 'offline' ? `sherpa:${m.id}` : m.id) === current);
  const sttDownloading = download && download.component === 'stt' && (download.status === 'downloading' || download.status === 'extracting');

  const testTranscription = (): void => {
    const ctx = voice.ensureContext();
    void (async () => {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const src = ctx.createMediaStreamSource(stream);
        const node = ctx.createScriptProcessor(4096, 1, 1);
        const sink = ctx.createGain();
        sink.gain.value = 0;
        const chunks: Int16Array[] = [];
        const g = (settings?.desktop.inputGain ?? 100) / 100;
        node.onaudioprocess = (ev) => chunks.push(floatToPcm16(resampleTo16k(ev.inputBuffer.getChannelData(0), ctx.sampleRate), g).pcm);
        src.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        setTesting('recording');
        setHeard(null);
        await new Promise((r) => setTimeout(r, 3000));
        node.disconnect();
        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        setTesting('transcribing');
        const res = await voiceApi.transcribe(bytesToBase64(concatPcm16(chunks)));
        setHeard(res.ok ? res.text || '(nothing recognised)' : res.detail || 'Transcription failed');
      } catch (e) {
        setHeard(e instanceof Error ? e.message : 'Transcription failed');
      } finally {
        setTesting('idle');
      }
    })();
  };

  return (
    <SettingsSection title="Speech to text">
      <SettingRow
        label="Recogniser"
        htmlFor="xr-voice-stt"
        description={
          selected?.kind === 'cloud'
            ? 'Audio leaves this machine. Metered — see the cost chip.'
            : selected && !selected.installed && selected.kind === 'offline'
              ? `Needs a ${formatBytes(selected.bytes)} download.`
              : selected?.kind === 'local-binary'
                ? selected.detail
                : 'Runs offline on this machine.'
        }
      >
        <div className="flex items-center gap-2">
          <Select
            ariaLabel="Speech recogniser"
            value={current}
            options={sttOptions}
            onChange={(v) => {
              if (v.startsWith('sherpa:')) apply({ sttBackend: 'sherpa', sttModel: v.slice(7) });
              else apply({ sttBackend: v });
            }}
            className="w-[220px]"
          />
          {selected && selected.kind === 'offline' && !selected.installed ? (
            <Button size="sm" variant="secondary" disabled={!!sttDownloading} onClick={() => void startDownload({ component: 'stt', id: selected.id })}>
              {sttDownloading ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              {sttDownloading ? `${download?.percent ?? 0}%` : 'Download'}
            </Button>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow label="Language" description="English only in this phase. Other languages are out of scope for now.">
        <Select ariaLabel="Language" value="auto" options={[{ value: 'auto', label: 'Auto (English)' }]} onChange={() => undefined} className="w-[220px]" />
      </SettingRow>
      <SettingRow label="Profanity filter" htmlFor="xr-voice-profanity" description="Masks strong language in transcripts (s***). The model still hears it.">
        <Toggle id="xr-voice-profanity" checked={settings?.profanityFilter ?? false} onCheckedChange={(v) => apply({ profanityFilter: v })} />
      </SettingRow>
      <SettingRow
        label="Test transcription"
        description={
          heard !== null ? (
            <span>
              Heard: <span className="text-text-primary">“{heard}”</span>
            </span>
          ) : status?.stt.loaded ? (
            'Records three seconds and shows what the recogniser heard.'
          ) : (
            'Install a recogniser first.'
          )
        }
      >
        <Button size="sm" variant="secondary" disabled={testing !== 'idle' || !status?.stt.loaded} onClick={testTranscription} data-testid="voice-test-stt">
          {testing === 'recording' ? <Mic size={13} className="text-danger" aria-hidden="true" /> : testing === 'transcribing' ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
          {testing === 'recording' ? 'Listening…' : testing === 'transcribing' ? 'Working…' : 'Test'}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

/* ── Text to speech ─────────────────────────────────────────────────────── */

export function TtsSection() {
  const settings = useVoiceStore((s) => s.settings);
  const voices = useVoiceStore((s) => s.voices);
  const sample = useVoiceStore((s) => s.sampleText);
  const download = useVoiceStore((s) => s.download);
  const startDownload = useVoiceStore((s) => s.startDownload);
  const apply = useApply();
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<number>(0);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);

  const selected = voices.find((v) => v.id === settings?.ttsVoice) ?? voices[0];
  const ttsDownloading = download && download.component === 'tts' && (download.status === 'downloading' || download.status === 'extracting');

  const stopPreview = useCallback((): void => {
    try {
      srcRef.current?.stop();
    } catch {
      /* not started */
    }
    srcRef.current = null;
    setPreviewing(false);
  }, []);
  useEffect(() => () => stopPreview(), [stopPreview]);

  const preview = useCallback(
    (speed?: number, pitch?: number): void => {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = window.setTimeout(() => {
        const ctx = voice.ensureContext();
        void (async () => {
          try {
            if (ctx.state === 'suspended') await ctx.resume();
            setPreviewing(true);
            const s = useVoiceStore.getState().settings;
            const res = await voiceApi.testTts(sample, s?.ttsVoice, speed ?? s?.ttsSpeed);
            const bytes = base64ToBytes(res.wav);
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            const buf = await ctx.decodeAudioData(copy);
            stopPreview();
            const node = ctx.createBufferSource();
            node.buffer = buf;
            node.detune.value = pitchToCents(pitch ?? s?.desktop.ttsPitch ?? 0);
            node.connect(ctx.destination);
            node.onended = () => {
              if (srcRef.current === node) {
                srcRef.current = null;
                setPreviewing(false);
              }
            };
            srcRef.current = node;
            setPreviewing(true);
            node.start();
          } catch (e) {
            setPreviewing(false);
            toast.error(e instanceof Error ? e.message : 'Preview failed');
          }
        })();
      }, 350);
    },
    [sample, stopPreview],
  );

  return (
    <SettingsSection title="Text to speech">
      <SettingRow
        label="Voice"
        htmlFor="xr-voice-tts"
        description={
          selected ? (
            <span>
              {selected.gender} · {selected.accent}
              {selected.kind === 'cloud' ? ' · cloud, metered' : selected.installed ? ' · offline' : ` · ${formatBytes(selected.bytes)} download`}
              {selected.detail ? ` — ${selected.detail}` : ''}
            </span>
          ) : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Select
            ariaLabel="Voice"
            value={settings?.ttsVoice ?? ''}
            options={voices.map((v) => ({ value: v.id, label: `${v.label} · ${v.gender}, ${v.accent}${v.kind === 'cloud' ? ' · cloud' : ''}` }))}
            onChange={(v) => {
              const pick = voices.find((x) => x.id === v);
              apply(pick?.kind === 'cloud' ? { ttsVoice: v, ttsBackend: 'openai' } : { ttsVoice: v, ttsBackend: 'sherpa' });
            }}
            className="w-[220px]"
          />
          {selected && selected.kind === 'offline' && !selected.installed ? (
            <Button size="sm" variant="secondary" disabled={!!ttsDownloading} onClick={() => void startDownload({ component: 'tts', id: selected.id })}>
              {ttsDownloading ? <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              {ttsDownloading ? `${download?.percent ?? 0}%` : 'Download'}
            </Button>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow label="Sample" description={`“${sample}”`}>
        <Button size="sm" variant="secondary" onClick={() => (previewing ? stopPreview() : preview())} disabled={!selected || (selected.kind === 'offline' && !selected.installed)} data-testid="voice-tts-preview">
          {previewing ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
          {previewing ? 'Stop' : 'Play'}
        </Button>
      </SettingRow>
      <SettingRow label="Speed" htmlFor="xr-voice-speed">
        <LabeledSlider
          label="Speed"
          value={settings?.ttsSpeed ?? 1}
          min={0.7}
          max={1.3}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => {
            apply({ ttsSpeed: Math.round(v * 100) / 100 });
            preview(v);
          }}
          className="w-[220px]"
        />
      </SettingRow>
      <SettingRow label="Pitch" htmlFor="xr-voice-pitch" description="Applied on playback here (the offline voices have no native pitch control).">
        <LabeledSlider
          label="Pitch"
          value={settings?.desktop.ttsPitch ?? 0}
          min={-5}
          max={5}
          step={1}
          format={(v) => (v > 0 ? `+${v}` : `${v}`)}
          onChange={(v) => {
            apply({ desktop: { ttsPitch: v } });
            preview(undefined, v);
          }}
          className="w-[220px]"
        />
      </SettingRow>
    </SettingsSection>
  );
}

/* ── Activation + theater + storage ─────────────────────────────────────── */

export function ActivationSection() {
  const settings = useVoiceStore((s) => s.settings);
  const apply = useApply();
  const activation = settings?.desktop.activation ?? 'tap';
  const wakeOn = settings?.mode === 'wake-word';
  return (
    <SettingsSection title="Activation">
      <SettingRow label="Talk mode" description={activation === 'hold' ? 'Hold Space, the talk button or the global key while you speak.' : activation === 'tap' ? 'Tap once; XR listens until you stop the session or it goes quiet.' : 'Stays on until you stop it. Pair it with the wake word to avoid accidental commands.'}>
        <Segmented
          ariaLabel="Talk mode"
          value={activation}
          options={[
            { value: 'hold', label: 'Hold' },
            { value: 'tap', label: 'Tap' },
            { value: 'always', label: 'Always on' },
          ]}
          onChange={(v) => apply({ desktop: { activation: v }, mode: engineModeFor(v, wakeOn) })}
        />
      </SettingRow>
      <SettingRow label="Hold global hotkey to talk" htmlFor="xr-voice-hold-hotkey" description={isTauri() ? 'Off: the global key toggles a session. On: it works like push-to-talk.' : 'Needs the desktop app — the global key lives in the native shell.'}>
        <Toggle id="xr-voice-hold-hotkey" checked={settings?.desktop.holdGlobalHotkey ?? false} onCheckedChange={(v) => apply({ desktop: { holdGlobalHotkey: v } })} disabled={!isTauri()} />
      </SettingRow>
      <SettingRow label="When I press mic in Chat">
        <Segmented
          ariaLabel="Chat mic target"
          value={settings?.desktop.chatMicTarget ?? 'screen'}
          options={[
            { value: 'screen', label: 'Open Voice' },
            { value: 'docked', label: 'Docked' },
          ]}
          onChange={(v) => apply({ desktop: { chatMicTarget: v } })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

export function TheaterSection() {
  const settings = useVoiceStore((s) => s.settings);
  const apply = useApply();
  return (
    <SettingsSection title="Voice Theater">
      <SettingRow
        label="Immersive mode"
        htmlFor="xr-voice-theater"
        description="A full-screen companion window. Not built yet — Phase 16. The toggle is remembered."
      >
        <Toggle
          id="xr-voice-theater"
          checked={settings?.desktop.theaterImmersive ?? false}
          onCheckedChange={(v) => {
            apply({ desktop: { theaterImmersive: v } });
            if (v) toast('Voice Theater arrives in Phase 16', { description: 'Saved. Sessions use the in-app view until then.' });
          }}
        />
      </SettingRow>
      <SettingRow label="Auto-exit on silence" htmlFor="xr-voice-autoexit" description="Hold and tap modes end the session after this much quiet.">
        <LabeledSlider
          label="Auto-exit after"
          value={settings?.desktop.autoExitSilenceSec ?? 30}
          min={10}
          max={300}
          step={10}
          format={(v) => (v >= 60 ? `${Math.round(v / 60)} min${v % 60 ? ` ${v % 60}s` : ''}` : `${v}s`)}
          onChange={(v) => apply({ desktop: { autoExitSilenceSec: v } })}
          className="w-[220px]"
        />
      </SettingRow>
      <SettingRow label="Always show transcripts" htmlFor="xr-voice-transcripts" description="Captions for what you said and what XR said, also for screen readers.">
        <Toggle id="xr-voice-transcripts" checked={settings?.desktop.showTranscripts ?? true} onCheckedChange={(v) => apply({ desktop: { showTranscripts: v } })} />
      </SettingRow>
    </SettingsSection>
  );
}

export function StorageSection() {
  const status = useVoiceStore((s) => s.status);
  const models = useVoiceStore((s) => s.models);
  const voices = useVoiceStore((s) => s.voices);
  const clearModels = useVoiceStore((s) => s.clearModels);
  const [confirm, setConfirm] = useState(false);
  const installedBytes =
    (models?.stt ?? []).filter((m) => m.installed && m.kind === 'offline').reduce((n, m) => n + m.bytes, 0) +
    voices.filter((v) => v.installed && v.kind === 'offline').reduce((n, v) => n + v.bytes, 0) +
    (models?.espeak.installed ? models.espeak.bytes : 0) +
    (models?.runtime.installed ? models.runtime.bytes : 0);
  return (
    <SettingsSection title="Downloaded models">
      <SettingRow label="On this machine" description={status?.modelDir ?? ''}>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-[12px] tabular-nums">{formatBytes(installedBytes)}</span>
          {isTauri() && status?.modelDir ? (
            <Button size="sm" variant="ghost" onClick={() => void revealPath(status.modelDir)}>
              <FolderOpen size={13} aria-hidden="true" /> Reveal
            </Button>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow label="Clear downloaded models" danger description={confirm ? 'Removes every voice model and the runtime. They can be downloaded again.' : 'Frees the space; voice will ask to download again.'}>
        {confirm ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                void clearModels().then(() => toast('Voice models removed')).catch(() => toast.error('Could not remove the models'));
              }}
            >
              <Trash2 size={13} aria-hidden="true" /> Remove
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm(true)} disabled={installedBytes === 0}>
            <Trash2 size={13} aria-hidden="true" /> Clear
          </Button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}
