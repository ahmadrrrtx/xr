import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";

export type VoiceState = "idle" | "listening" | "thinking" | "working" | "speaking" | "interrupted";

export interface VoiceContextValue {
  state: VoiceState;
  muted: boolean;
  transcript: string;
  lastReply: string;
  approval: { id: string; tool?: string; reason?: string } | null;
  error: string | null;
  micLevel: React.MutableRefObject<number>;
  outLevel: React.MutableRefObject<number>;
  start: () => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
  bargeIn: () => void;
}

const Ctx = createContext<VoiceContextValue | null>(null);

export function useVoice(): VoiceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoice outside VoiceProvider");
  return v;
}

const TARGET_RATE = 16000;

/**
 * Desktop voice transport. The shell ONLY captures bytes, plays bytes and
 * renders engine-reported state (SEC-07): endpointing, STT, intents, TTS and
 * approvals all live in the daemon (src/daemon/routes/voice.routes.ts).
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [approval, setApproval] = useState<{ id: string; tool?: string; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const micLevel = useRef(0);
  const outLevel = useRef(0);

  const esRef = useRef<EventSource | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<{ stream: MediaStream; node: ScriptProcessorNode; analyser: AnalyserNode } | null>(null);
  const pcmBufRef = useRef<number[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  const speakSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speakAnalyserRef = useRef<AnalyserNode | null>(null);
  stateRef.current = state;
  mutedRef.current = muted;

  /* ── SSE downlink ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const es = new EventSource("/api/voice/events");
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as {
          type: string; state?: VoiceState; text?: string; wav?: string; id?: string; tool?: string; reason?: string; detail?: string;
        };
        if (e.type === "state" && e.state) setState(e.state);
        if (e.type === "final" && e.text) setTranscript(e.text);
        if (e.type === "status" && e.text) setLastReply(e.text);
        if (e.type === "approval") setApproval({ id: e.id ?? "", tool: e.tool, reason: e.reason });
        if (e.type === "error") setError(e.detail ?? "voice error");
        if (e.type === "tts_stop") stopSpeak();
        if (e.type === "tts" && e.wav) void playWav(e.wav);
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => setError("voice event stream disconnected");
    return () => { es.close(); esRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSpeak = useCallback(() => {
    try { speakSourceRef.current?.stop(); } catch { /* already stopped */ }
    speakSourceRef.current = null;
    outLevel.current = 0;
  }, []);

  const playWav = useCallback(async (b64: string) => {
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
      stopSpeak();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      speakSourceRef.current = src;
      speakAnalyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (speakSourceRef.current !== src) return;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
        outLevel.current = peak;
        requestAnimationFrame(tick);
      };
      tick();
      src.onended = () => {
        if (speakSourceRef.current === src) {
          speakSourceRef.current = null;
          outLevel.current = 0;
          void api.voicePlayed().catch(() => undefined);
        }
      };
      src.start();
    } catch (e) {
      setError(`tts playback: ${(e as Error).message.slice(0, 80)}`);
    }
  }, [stopSpeak]);

  /* ── mic uplink ───────────────────────────────────────────────────────── */
  const openMic = useCallback(async () => {
    if (micRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const srcNode = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    srcNode.connect(analyser);
    srcNode.connect(node);
    node.connect(ctx.destination); // silent path (processor needs output)
    const ratio = ctx.sampleRate / TARGET_RATE;
    const time = new Uint8Array(analyser.frequencyBinCount);
    node.onaudioprocess = (ev) => {
      analyser.getByteTimeDomainData(time);
      let peak = 0;
      for (let i = 0; i < time.length; i++) peak = Math.max(peak, Math.abs(time[i] - 128) / 128);
      micLevel.current = peak;
      // barge-in: user speaks over the assistant
      if (stateRef.current === "speaking" && peak > 0.09) {
        void api.voiceBargeIn().catch(() => undefined);
        stopSpeak();
        return;
      }
      if (mutedRef.current || stateRef.current !== "listening") return;
      const input = ev.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i += ratio) {
        const s = Math.max(-1, Math.min(1, input[Math.floor(i)]));
        pcmBufRef.current.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    };
    micRef.current = { stream, node, analyser };
    flushTimer.current = setInterval(() => {
      const buf = pcmBufRef.current;
      if (!buf.length) return;
      pcmBufRef.current = [];
      const bytes = new Uint8Array(buf.length * 2);
      const dv = new DataView(bytes.buffer);
      for (let i = 0; i < buf.length; i++) dv.setInt16(i * 2, buf[i], true);
      let b64 = "";
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      void api.voiceAudio(btoa(b64)).catch(() => undefined);
    }, 250);
  }, [stopSpeak]);

  const closeMic = useCallback(() => {
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = null;
    micRef.current?.node.disconnect();
    micRef.current?.stream.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    micLevel.current = 0;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      await openMic();
      await api.voiceSession("start");
    } catch (e) {
      setError(`mic: ${(e as Error).message.slice(0, 100)}`);
    }
  }, [openMic]);

  const stop = useCallback(() => {
    stopSpeak();
    closeMic();
    void api.voiceSession("stop").catch(() => undefined);
    setState("idle");
  }, [closeMic, stopSpeak]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const bargeIn = useCallback(() => { stopSpeak(); void api.voiceBargeIn().catch(() => undefined); }, [stopSpeak]);

  useEffect(() => () => { closeMic(); esRef.current?.close(); }, [closeMic]);

  const value = useMemo<VoiceContextValue>(
    () => ({ state, muted, transcript, lastReply, approval, error, micLevel, outLevel, start, stop, toggleMute, bargeIn }),
    [state, muted, transcript, lastReply, approval, error, start, stop, toggleMute, bargeIn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
