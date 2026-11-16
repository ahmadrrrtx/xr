/*
 * Voice settings sections (SCREEN 13, left column) — Phase 8 Settings
 * pattern: grouped cards, 44 px rows, cyan switches. Every control writes
 * through voiceStore.applySettings → engine (validated there) → mirror.
 */
import { AlertTriangle, Mic, Play, Square, Trash2, FolderOpen, Loader2, Clapperboard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LabeledSlider, Segmented, Select, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import { revealPath } from '@/lib/settingsApi';
import { isTauri } from '@/lib/tauri';
import { theaterOpen } from '@/lib/theater';
import { THEATER_KEYS } from '@/lib/theaterCore';
import { cn } from '@/lib/utils';
import { base64ToBytes, bytesToBase64, concatPcm16, dbfs, floatToPcm16, formatBytes, pitchToCents, resampleTo16k, engineModeFor } from '@/voice/audio';
import { probeMicrophones, voice } from '@/voice/session';
import { voiceApi, type VoiceSettingsPatch } from '@/voice/voiceApi';
import { useMediaOperation } from '@/voice/useMediaOperation';
import { useEngineStore } from '@/stores/engineStore';
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

  const nodesRef = useRef<AudioNode[]>([]);
  const generation = useEngineStore(s => s.generation);
  const { begin, cancel } = useMediaOperation(() => {
    window.clearInterval(timerRef.current);
    if (nodeRef.current) nodeRef.current.onaudioprocess = null;
    nodeRef.current = null;
    for (const node of nodesRef.current) { try { node.disconnect(); } catch { /* already detached */ } }
    nodesRef.current = [];
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
  }, () => useEngineStore.getState().generation === generation);
  const stopMeter = useCallback(() => { cancel(); setTesting(false); setLeft(METER_SECONDS); setLevel({ rms: 0, peak: 0, clipped: false }); }, [cancel]);
  useEffect(() => { stopMeter(); }, [generation, settings?.desktop.micDeviceId, settings?.noiseSuppression, stopMeter]);
  const startMeter = (): void => {
    const op = begin(); setTesting(true); setLeft(METER_SECONDS);
    void (async () => {
      try {
        const ctx = voice.ensureContext();
        if (ctx.state === 'suspended') await ctx.resume();
        if (!op.current()) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(settings?.desktop.micDeviceId ? { deviceId: { exact: settings.desktop.micDeviceId } } : {}),
          echoCancellation: true, noiseSuppression: settings?.noiseSuppression ?? true, autoGainControl: true,
        } });
        if (!op.current()) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        useVoiceStore.getState().setMicPermission('granted'); void probeMicrophones(false);
        const src = ctx.createMediaStreamSource(stream); nodesRef.current.push(src);
        const node = ctx.createScriptProcessor(2048, 1, 1); nodesRef.current.push(node); nodeRef.current = node;
        const sink = ctx.createGain(); nodesRef.current.push(sink); sink.gain.value = 0;
        let clipHold = 0;
        node.onaudioprocess = ev => {
          if (!op.current()) return;
          const r = floatToPcm16(ev.inputBuffer.getChannelData(0), (useVoiceStore.getState().settings?.desktop.inputGain ?? 100) / 100);
          clipHold = r.clipped ? 6 : Math.max(0, clipHold - 1); setLevel({ rms: r.rms, peak: r.peak, clipped: clipHold > 0 });
        };
        src.connect(node); node.connect(sink); sink.connect(ctx.destination);
        let remaining = METER_SECONDS;
        timerRef.current = window.setInterval(() => {
          if (!op.current()) return;
          remaining--; if (remaining <= 0) stopMeter(); else setLeft(remaining);
        }, 1000);
      } catch (e) {
        if (!op.current()) return;
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
            stopMeter();
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
        <Toggle id="xr-voice-noise" checked={settings?.noiseSuppression ?? true} onCheckedChange={(v) => apply({ noiseSuppression: v })} />
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
  const [testing, setTesting] = useState<'idle' | 'opening' | 'recording' | 'transcribing'>('idle');
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

  const streamRef = useRef<MediaStream | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const generation = useEngineStore(s => s.generation);
  const releaseCapture = useCallback(() => {
    for (const node of nodesRef.current) {
      if ('onaudioprocess' in node) (node as ScriptProcessorNode).onaudioprocess = null;
      try { node.disconnect(); } catch { /* already detached */ }
    }
    nodesRef.current = [];
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
  }, []);
  const { begin, cancel } = useMediaOperation(releaseCapture, () => useEngineStore.getState().generation === generation);
  useEffect(() => { cancel(); setTesting('idle'); }, [generation, settings?.desktop.micDeviceId, settings?.sttBackend, settings?.sttModel, cancel]);
  const testTranscription = (): void => {
    const op = begin(); setTesting('opening'); setHeard(null);
    void (async () => {
      try {
        const ctx = voice.ensureContext();
        if (ctx.state === 'suspended') await ctx.resume();
        if (!op.current()) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(settings?.desktop.micDeviceId ? { deviceId: { exact: settings.desktop.micDeviceId } } : {}),
          echoCancellation: true, noiseSuppression: settings?.noiseSuppression ?? true, autoGainControl: true,
        } });
        if (!op.current()) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const src = ctx.createMediaStreamSource(stream); nodesRef.current.push(src);
        const node = ctx.createScriptProcessor(4096, 1, 1); nodesRef.current.push(node);
        const sink = ctx.createGain(); nodesRef.current.push(sink); sink.gain.value = 0;
        const chunks: Int16Array[] = [];
        const gain = (settings?.desktop.inputGain ?? 100) / 100;
        node.onaudioprocess = ev => { if (op.current()) chunks.push(floatToPcm16(resampleTo16k(ev.inputBuffer.getChannelData(0), ctx.sampleRate), gain).pcm); };
        src.connect(node); node.connect(sink); sink.connect(ctx.destination); setTesting('recording');
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); op.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 3000); op.signal.addEventListener('abort', done, { once: true });
        });
        if (!op.current()) return;
        releaseCapture(); setTesting('transcribing');
        const res = await voiceApi.transcribe(bytesToBase64(concatPcm16(chunks)), { signal: op.signal });
        if (op.current()) setHeard(res.ok ? res.text || '(nothing recognised)' : res.detail || 'Transcription failed');
      } catch (e) { if (op.current()) setHeard(e instanceof Error ? e.message : 'Transcription failed'); }
      finally { if (op.current()) { releaseCapture(); setTesting('idle'); } }
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
          {testing === 'opening' ? 'Allow mic…' : testing === 'recording' ? 'Listening…' : testing === 'transcribing' ? 'Working…' : 'Test'}
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

  const generation = useEngineStore(s => s.generation);
  const { begin, cancel } = useMediaOperation(() => {
    window.clearTimeout(previewTimer.current);
    const node = srcRef.current; srcRef.current = null;
    if (node) { node.onended = null; try { node.stop(); } catch { /* not started */ } node.disconnect(); }
  }, () => useEngineStore.getState().generation === generation);
  const stopPreview = useCallback(() => { cancel(); setPreviewing(false); }, [cancel]);
  useEffect(() => { stopPreview(); }, [generation, settings?.ttsVoice, stopPreview]);
  const preview = useCallback((speed?: number, pitch?: number): void => {
    const op = begin(); setPreviewing(true);
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          if (!op.current()) return;
          const ctx = voice.ensureContext();
          if (ctx.state === 'suspended') await ctx.resume();
          if (!op.current()) return;
          const s = useVoiceStore.getState().settings;
          const res = await voiceApi.testTts(sample, s?.ttsVoice, speed ?? s?.ttsSpeed, { signal: op.signal });
          if (!op.current()) return;
          if (!res.wav) { stopPreview(); toast.info(res.detail ?? 'The engine host spoke this sample through its own system voice.'); return; }
          const bytes = base64ToBytes(res.wav); const copy = new ArrayBuffer(bytes.byteLength); new Uint8Array(copy).set(bytes);
          const buf = await ctx.decodeAudioData(copy);
          if (!op.current()) return;
          const node = ctx.createBufferSource(); node.buffer = buf;
          node.detune.value = pitchToCents(pitch ?? s?.desktop.ttsPitch ?? 0); node.connect(ctx.destination);
          node.onended = () => { if (op.current() && srcRef.current === node) { srcRef.current = null; node.disconnect(); setPreviewing(false); } };
          srcRef.current = node; node.start();
        } catch (e) { if (op.current()) { stopPreview(); toast.error(e instanceof Error ? e.message : 'Preview failed'); } }
      })();
    }, 350);
  }, [sample, begin, stopPreview]);

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
              stopPreview();
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

/** Theater window prefs live in the settings store (Rust reads them too). */
function useTheaterPref(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    let alive = true;
    void readSettingJSON<boolean>(key).then((v) => {
      if (alive && typeof v === 'boolean') setValue(v);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      writeSettingJSON(key, v);
    },
    [key],
  );
  return [value, set];
}

export function TheaterSection() {
  const settings = useVoiceStore((s) => s.settings);
  const apply = useApply();
  const [secondMonitor, setSecondMonitor] = useTheaterPref(THEATER_KEYS.secondMonitor, false);
  const [closeStops, setCloseStops] = useTheaterPref(THEATER_KEYS.closeStopsVoice, false);
  const mac = navigator.userAgent.toLowerCase().includes('mac');
  return (
    <SettingsSection title="Voice Theater">
      <SettingRow label="Theater window" htmlFor="xr-voice-theater-open" description={`A frameless companion window for the running session. ${mac ? '⌥⌘V' : 'Alt+Ctrl+V'} toggles it from anywhere.`}>
        <Button id="xr-voice-theater-open" variant="outline" size="sm" onClick={() => void theaterOpen()} data-testid="voice-theater-open">
          <Clapperboard size={14} aria-hidden="true" /> Open theater
        </Button>
      </SettingRow>
      <SettingRow label="Open in immersive theater" htmlFor="xr-voice-theater" description="Starting a session opens the theater instead of this screen's session view.">
        <Toggle id="xr-voice-theater" checked={settings?.desktop.theaterImmersive ?? false} onCheckedChange={(v) => apply({ desktop: { theaterImmersive: v } })} />
      </SettingRow>
      <SettingRow label="Open on second display when available" htmlFor="xr-voice-theater-display" description="Falls back to the primary display when there is only one.">
        <Toggle id="xr-voice-theater-display" checked={secondMonitor} onCheckedChange={setSecondMonitor} />
      </SettingRow>
      <SettingRow label="Closing the theater stops voice" htmlFor="xr-voice-theater-close" description="Off: the session keeps running docked when the theater closes.">
        <Toggle id="xr-voice-theater-close" checked={closeStops} onCheckedChange={setCloseStops} />
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
