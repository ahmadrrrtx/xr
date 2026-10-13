import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Info, Loader2 } from 'lucide-react';
import { Screen } from '../components/Screen';
import { Orb, type OrbState } from '../components/Orb';
import { Sheet } from '../components/Sheet';
import { Segmented } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { api, isOfflineError } from '../api/client';
import { useChats } from '../stores/chats';
import { useSettings } from '../stores/settings';
import { useToasts } from '../stores/toasts';
import { useConnection } from '../stores/connection';
import { haptic } from '../lib/haptics';
import { pushVoiceLog, readVoiceLog, type VoiceLogEntry } from '../lib/idb';
import { relativeTime, uid } from '../lib/format';
import { readChats } from '../lib/idb';

type Phase = 'idle' | 'recording' | 'transcribing' | 'streaming';
type MicPermission = 'unknown' | 'granted' | 'denied';

const VOICE_CHAT_TITLE = 'Voice notes';

/** Pick the MediaRecorder mime the platform can actually produce. */
function pickMime(): string {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'audio/webm';
}

export function VoiceScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [explain, setExplain] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const [log, setLog] = useState<VoiceLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef<number | null>(null);
  const interim = useRef<string>('');

  const load = useChats((s) => s.load);
  const send = useChats((s) => s.send);
  const models = useSettings((s) => s.models);
  const model = useSettings((s) => s.model);
  const setModel = useSettings((s) => s.setModel);
  const show = useToasts((s) => s.show);
  const status = useConnection((s) => s.status);

  const currentModel = models.find((m) => m.id === model)?.label ?? model ?? 'Default model';

  useEffect(() => {
    void load();
    void readVoiceLog().then(setLog);
  }, [load]);

  /* ------------------------------------------------------- mic + analyser --- */

  const teardown = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    analyser.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  const watchLevel = useCallback(() => {
    const node = analyser.current;
    if (!node) return;
    const buffer = new Uint8Array(node.fftSize);
    const tick = (): void => {
      node.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centred = (value - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / buffer.length);
      setLevel(Math.min(1, rms * 3.2));
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript('');
    setResponse('');

    if (status === 'offline') {
      setError('XR needs your desktop on the same WiFi before it can listen.');
      haptic('error');
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = media;
      setPermission('granted');

      const context = new AudioContext();
      audioCtx.current = context;
      const source = context.createMediaStreamSource(media);
      const node = context.createAnalyser();
      node.fftSize = 1024;
      source.connect(node);
      analyser.current = node;
      watchLevel();

      const mime = pickMime();
      const rec = new MediaRecorder(media, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.start(250);
      recorder.current = rec;
      setPhase('recording');
      haptic('medium');

      media.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    } catch {
      setPermission('denied');
      setError('Microphone blocked. Enable it for XR in your phone settings.');
      haptic('error');
      teardown();
    }
  }, [muted, status, teardown, watchLevel]);

  const stopRecording = useCallback(async () => {
    const rec = recorder.current;
    if (!rec) return;
    setPhase('transcribing');
    haptic('light');

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    });
    recorder.current = null;
    teardown();

    if (blob.size < 1200) {
      setPhase('idle');
      show('That was too short to hear', 'info');
      return;
    }

    try {
      const { transcript: text } = await api.transcribe(blob, blob.type);
      const finalText = (interim.current && text.length < interim.current.length ? interim.current : text).trim();
      setTranscript(finalText);
      if (finalText.length === 0) {
        setPhase('idle');
        show("Couldn't hear that clearly", 'info');
        return;
      }

      setPhase('streaming');
      const chatId = await ensureVoiceChat();
      if (!chatId) {
        setPhase('idle');
        show('Could not open the voice chat', 'error');
        return;
      }

      // The streamed reply lands in the chat store; mirror the last assistant
      // message here so the Voice tab reads as one continuous exchange.
      const before = useChats.getState().messages[chatId]?.length ?? 0;
      await send(chatId, finalText, { viaVoice: true });
      const after = useChats.getState().messages[chatId] ?? [];
      const reply = [...after.slice(before)].reverse().find((m) => m.role === 'assistant');
      setResponse(reply?.content ?? '');

      await pushVoiceLog({ id: uid('v'), transcript: finalText, response: reply?.content, createdAt: Date.now() });
      setLog(await readVoiceLog());
      setPhase('idle');
    } catch (cause) {
      setPhase('idle');
      setError(
        isOfflineError(cause)
          ? 'XR is offline. Connect to your home WiFi and try again.'
          : "Transcription failed. Your audio never left your devices.",
      );
      haptic('error');
    }
  }, [send, show, teardown]);

  async function ensureVoiceChat(): Promise<string | null> {
    const existing = (await readChats()).find((c) => c.title === VOICE_CHAT_TITLE);
    if (existing) return existing.id;
    return useChats.getState().newChat();
  }

  const onOrbTap = (): void => {
    if (phase === 'recording') {
      void stopRecording();
      return;
    }
    if (phase !== 'idle') return;
    if (permission === 'unknown') {
      setExplain(true);
      return;
    }
    void startRecording();
  };

  /* --------------------------------- interruptions: call, background, unmount --- */

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && recorder.current?.state === 'recording') {
        void stopRecording();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      teardown();
    };
  }, [stopRecording, teardown]);

  useEffect(() => {
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [muted]);

  const orbState: OrbState =
    phase === 'recording' ? 'listening' : phase === 'streaming' ? 'speaking' : phase === 'transcribing' ? 'thinking' : 'idle';

  return (
    <Screen title="Voice">
      <div className="flex h-full min-h-0 flex-col">
        {/* Orb is the hero: centred, with room to breathe above and below */}
        <div className="flex flex-1 flex-col items-center justify-center px-6" style={{ minHeight: 300 }}>
          <div
            className="flex items-center justify-center"
            style={{ width: 220, height: 220 }}
          >
            <Orb
              size={180}
              state={orbState}
              level={level}
              onClick={onOrbTap}
              label={
                phase === 'recording' ? 'Stop recording' : phase === 'idle' ? 'Start recording' : 'Busy'
              }
            />
          </div>

          <p
            className="mt-5 text-[15px] font-medium"
            style={{ color: phase === 'recording' ? 'var(--accent)' : 'var(--text-secondary)' }}
            aria-live="polite"
          >
            {phase === 'recording'
              ? 'Listening… tap to stop'
              : phase === 'transcribing'
                ? 'Transcribing…'
                : phase === 'streaming'
                  ? 'XR is replying…'
                  : 'Tap to talk'}
          </p>

          {phase === 'idle' && !error ? (
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--text-tertiary)' }}>
              Audio is transcribed by your own XR daemon.
            </p>
          ) : null}

          {error ? (
            <p
              className="mt-2 max-w-[300px] text-center text-[13px] leading-[1.45]"
              style={{ color: 'var(--danger)' }}
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* Transcript + response */}
        {transcript || response ? (
          <div className="px-4 pb-2" style={{ maxHeight: '38dvh' }}>
            <div
              className="scroll-quiet rounded-[14px] px-3.5 py-3"
              style={{
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in srgb, var(--bg-ink) 88%, transparent)',
                maxHeight: '38dvh',
              }}
            >
              {transcript ? (
                <p className="text-[15px] leading-[1.5]" style={{ color: 'var(--text-primary)' }}>
                  <span aria-hidden>🎤 </span>
                  {transcript}
                </p>
              ) : null}
              {response ? (
                <div className="mt-2 text-[15px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
                  <Markdown>{response}</Markdown>
                </div>
              ) : (
                phase === 'streaming' ? (
                  <p className="mt-2 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                    <Loader2 size={13} strokeWidth={1.8} className="spinner" aria-hidden />
                    Streaming reply…
                  </p>
                ) : null
              )}
            </div>
          </div>
        ) : null}

        {/* Controls */}
        <div className="px-4 pb-3">
          <Segmented
            ariaLabel="Microphone"
            value={muted ? 'muted' : 'live'}
            onChange={(next) => {
              setMuted(next === 'muted');
              haptic('light');
            }}
            options={[
              { value: 'live', label: 'Mic on' },
              { value: 'muted', label: 'Muted' },
            ]}
          />
          <button
            type="button"
            onClick={() => setModelSheet(true)}
            aria-label={`Model: ${currentModel}`}
            className="tap mt-2 flex w-full items-center justify-between rounded-[12px] px-3.5"
            style={{ border: '1px solid var(--border-default)', minHeight: 44 }}
          >
            <span className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              Model
            </span>
            <span className="truncate text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {currentModel}
            </span>
          </button>
        </div>

        {/* Recent voice interactions */}
        {log.length > 0 ? (
          <div className="pb-4">
            <p
              className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Recent
            </p>
            <div className="scroll-quiet" style={{ maxHeight: 148 }}>
              {log.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 px-4 py-[9px]"
                  style={{ borderTop: '1px solid var(--border-subtle)' }}
                >
                  {muted ? (
                    <MicOff size={14} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)', marginTop: 3 }} aria-hidden />
                  ) : (
                    <Mic size={14} strokeWidth={1.5} style={{ color: 'var(--accent)', marginTop: 3 }} aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px]" style={{ color: 'var(--text-primary)' }}>
                      {entry.transcript}
                    </p>
                    {entry.response ? (
                      <p className="mt-0.5 line-clamp-1 text-[12.5px]" style={{ color: 'var(--text-tertiary)' }}>
                        {entry.response}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {relativeTime(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* First-tap explainer */}
      <Sheet open={explain} onClose={() => setExplain(false)} compact title="XR needs the microphone">
        <div className="px-4 pb-4">
          <p className="text-[15px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            Voice notes are recorded on this phone and transcribed by{' '}
            <strong style={{ color: 'var(--text-primary)' }}>your own XR daemon</strong> on your
            computer. Nothing is sent to a third-party speech service.
          </p>
          <p className="mt-2 text-[13px] leading-[1.45]" style={{ color: 'var(--text-tertiary)' }}>
            You can revoke this any time in your phone’s settings.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setExplain(false)}
              className="tap flex-1 rounded-[12px] text-[15px] font-medium"
              style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setExplain(false);
                void startRecording();
              }}
              className="tap flex-1 rounded-[12px] text-[15px] font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Info size={15} strokeWidth={1.8} aria-hidden />
                Continue
              </span>
            </button>
          </div>
        </div>
      </Sheet>

      {/* Model quick pick */}
      <Sheet open={modelSheet} onClose={() => setModelSheet(false)} compact title="Model">
        <div className="px-3 pb-4">
          {models.length === 0 ? (
            <p className="px-1 py-2 text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
              No models available — XR desktop isn’t reachable.
            </p>
          ) : (
            models.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setModel(entry.id);
                  haptic('light');
                  setModelSheet(false);
                }}
                className="flex w-full items-center justify-between rounded-[11px] px-3 py-[11px] text-left"
                style={{
                  minHeight: 44,
                  background: entry.id === model ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  color: entry.id === model ? 'var(--accent)' : 'var(--text-primary)',
                }}
              >
                <span className="text-[15px]">{entry.label}</span>
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                  {entry.provider}
                </span>
              </button>
            ))
          )}
        </div>
      </Sheet>
    </Screen>
  );
}
