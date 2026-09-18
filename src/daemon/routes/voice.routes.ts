/**
 * XR Phase 4 — Voice daemon surface (the missing transport for src/voice).
 *
 * The pipeline (src/voice/pipeline.ts) was dependency-injected but had NO
 * daemon route: nothing a desktop could talk to. This module is that surface,
 * and it is deliberately THIN:
 *
 *   - audio UP:   POST /api/voice/audio   (pcm16-le 16 kHz chunks, base64)
 *   - events DOWN: GET  /api/voice/events  (SSE: state/final/tts/tts_stop/approval)
 *   - control:    POST /api/voice/session {start|stop}, /barge-in, /played, /say
 *   - facts:      GET  /api/voice/status  (backend probes, session state)
 *
 * Everything smart lives in the engine: endpointing uses the existing VAD
 * primitives, transcripts go through SpeechToText (offline sherpa-onnx first,
 * whisper CLI next, cloud only if explicitly allowed), replies through
 * VoicePipeline.processText (wake word, meta-commands, deterministic intents,
 * agent fallback) and TextToSpeech (offline Piper first, espeak next).
 * The shell renders states and forwards bytes; it computes nothing (SEC-07).
 *
 * Approvals-in-voice: while a session is live, pending approvals are announced
 * on the event stream; saying confirm/cancel decides them through the SAME
 * durable approval store every other surface uses (channel "voice").
 */
import { route, sseResponse, type DaemonRoute } from "./router.ts";
import { VoicePipeline } from "../../voice/pipeline.ts";
import { SpeechToText, sttFromSettings } from "../../voice/stt.ts";
import { TextToSpeech, ttsFromSettings } from "../../voice/tts.ts";
import { defaultVoiceSettings, type VoiceSettings } from "../../voice/types.ts";
import { pcm16Rms } from "../../voice/audio.ts";
import { parseConfirmation } from "../../voice/wake.ts";
import { loadNativeVoice } from "../../voice/native.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import type { Store } from "../../state/workspace-store.ts";

export type VoiceSessionState = "idle" | "listening" | "thinking" | "working" | "speaking" | "interrupted";

export interface VoiceEvent {
  type: "state" | "final" | "tts" | "tts_stop" | "approval" | "status" | "error";
  state?: VoiceSessionState;
  text?: string;
  wav?: string; // base64 wav bytes for the shell to play
  sampleRate?: number;
  id?: string;
  tool?: string;
  reason?: string;
  detail?: string;
}

/** Encode pcm16-le mono as a WAV container (STT adapters expect wav bytes). */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array {
  const n = Math.floor(pcm.length / 2);
  const buf = new Uint8Array(44 + n * 2);
  const dv = new DataView(buf.buffer);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  buf.set(pcm.subarray(0, n * 2), 44);
  return buf;
}

const SPEECH_RMS = 0.02;      // ~-34 dBFS — tuned for laptop mics, not studios
const MIN_SPEECH_MS = 250;    // utterance floor (rejects clicks)
const SILENCE_TAIL_MS = 700;  // endpointing tail after last speech frame

export class VoiceSession {
  state: VoiceSessionState = "idle";
  private subs = new Set<(e: VoiceEvent) => void>();
  private buf: number[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private busy = false;
  private speakDeadline = 0;
  private lastSayText = "";
  private announced = new Set<string>();
  private approvalTimer: ReturnType<typeof setInterval> | null = null;
  readonly pipeline: VoicePipeline;
  private readonly stt: SpeechToText;
  private readonly tts: TextToSpeech;
  private readonly settings: VoiceSettings;

  constructor(private readonly store: Store, settings?: VoiceSettings) {
    this.settings = settings ?? defaultVoiceSettings();
    this.stt = sttFromSettings(this.settings);
    this.tts = ttsFromSettings(this.settings);
    this.pipeline = new VoicePipeline({
      store: this.store,
      stt: this.stt,
      tts: this.tts,
      play: (audio) => {
        // The SHELL plays audio; the pipeline only needs stop semantics for
        // barge-in, which arrives as /api/voice/barge-in → tts_stop event.
        this.emit({ type: "tts", wav: Buffer.from(audio).toString("base64"), text: this.lastSayText });
        this.setState("speaking");
        this.speakDeadline = Date.now() + Math.min(60_000, audio.length / 44 + 2_000);
        return { stop: () => this.emit({ type: "tts_stop" }) };
      },
      onText: (entry) => {
        if (entry.role === "assistant") {
          this.lastSayText = entry.text;
          this.emit({ type: "status", text: entry.text });
        }
      },
      settings: this.settings,
    });
  }

  subscribe(fn: (e: VoiceEvent) => void): () => void {
    this.subs.add(fn);
    fn({ type: "state", state: this.state });
    return () => this.subs.delete(fn);
  }

  emit(e: VoiceEvent): void {
    for (const fn of this.subs) fn(e);
  }

  setState(s: VoiceSessionState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: "state", state: s });
  }

  start(): void {
    if (this.state !== "idle") return;
    this.buf = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.setState("listening");
    this.store.audit("voice.session.start", {});
    this.announced = new Set(getApprovalStore(this.store).listPending().map((a) => a.id));
    this.approvalTimer = setInterval(() => this.announceApprovals(), 1_500);
  }

  stop(): void {
    if (this.state === "idle") return;
    this.setState("idle");
    this.buf = [];
    if (this.approvalTimer) clearInterval(this.approvalTimer);
    this.approvalTimer = null;
    this.store.audit("voice.session.stop", {});
  }

  private announceApprovals(): void {
    try {
      for (const a of getApprovalStore(this.store).listPending()) {
        if (this.announced.has(a.id)) continue;
        this.announced.add(a.id);
        this.emit({ type: "approval", id: a.id, tool: a.tool, reason: a.reason });
      }
    } catch {
      /* store not ready */
    }
  }

  bargeIn(): void {
    if (this.state === "speaking") {
      this.emit({ type: "tts_stop" });
      this.pipeline.bargeIn(true);
      this.setState("interrupted");
      this.store.audit("voice.bargein", {});
      this.setState("listening");
      this.buf = [];
      this.speechMs = 0;
      this.silenceMs = 0;
    }
  }

  played(): void {
    if (this.state === "speaking") this.setState("listening");
  }

  /** Desktop mic chunks (pcm16-le 16k). Endpointing happens here. */
  feedAudio(pcm: Uint8Array): void {
    if (this.state !== "listening") return;
    if (this.state === "listening" && Date.now() < this.speakDeadline) return; // echo guard window
    const rms = pcm16Rms(pcm);
    const frameMs = Math.floor(pcm.length / 2 / 16); // 16 kHz
    for (let i = 0; i < pcm.length; i++) this.buf.push(pcm[i]);
    if (rms > SPEECH_RMS) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }
    if (this.speechMs >= MIN_SPEECH_MS && this.silenceMs >= SILENCE_TAIL_MS) {
      const utterance = new Uint8Array(this.buf);
      this.buf = [];
      this.speechMs = 0;
      this.silenceMs = 0;
      void this.process(utterance);
    }
  }

  private async process(pcm: Uint8Array): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.setState("thinking");
      const wav = pcm16ToWav(pcm);
      const r = await this.stt.transcribe(wav);
      const text = (r.text ?? "").trim();
      if (!text) {
        this.setState("listening");
        return;
      }
      this.emit({ type: "final", text });

      // Approvals-in-voice: confirm/cancel decides the newest pending item
      // through the same durable store every surface uses.
      const decision = parseConfirmation(text);
      if (decision) {
        const store = getApprovalStore(this.store);
        const pending = store.listPending();
        const newest = pending[pending.length - 1];
        if (newest) {
          const ok = store.decide(newest.id, decision === "confirm", { channel: "voice", userId: null });
          this.store.audit("voice.approval.decided", { id: newest.id, approved: decision === "confirm", ok });
          await this.pipeline.say(ok ? (decision === "confirm" ? "Approved." : "Cancelled.") : "That approval already expired.");
          this.busy = false;
          return;
        }
      }

      this.setState("working");
      const out = await this.pipeline.processText(text);
      if (!out.handled && !out.reply) {
        await this.pipeline.say("I didn't catch a command in that.");
      }
      if (this.state !== "speaking") this.setState("listening");
    } catch (e) {
      this.emit({ type: "error", detail: String((e as Error)?.message ?? e).slice(0, 200) });
      this.setState("listening");
    } finally {
      this.busy = false;
      if (this.state === "thinking" || this.state === "working") this.setState("listening");
    }
  }

  async say(text: string): Promise<void> {
    await this.pipeline.say(text);
  }
}

let session: VoiceSession | null = null;
export function voiceSessionFor(store: Store): VoiceSession {
  if (!session) session = new VoiceSession(store);
  return session;
}

export function voiceRoutes(): DaemonRoute[] {
  return [
    route({
      id: "voice.status",
      path: "/api/voice/status",
      method: "GET",
      handle: async ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        const sttProbe = await new SpeechToText({ backend: defaultVoiceSettings().sttBackend }).describeAsync();
        const ttsProbe = await new TextToSpeech({ engine: defaultVoiceSettings().ttsBackend }).describeAsync();
        const native = loadNativeVoice();
        return json({ state: s.state, stt: sttProbe, tts: ttsProbe, native: { ok: native.ok, detail: native.detail } });
      },
    }),
    route({
      id: "voice.session",
      path: "/api/voice/session",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { action?: string };
        const s = voiceSessionFor(state.store);
        if (body.action === "start") s.start();
        else if (body.action === "stop") s.stop();
        else return json({ error: "expected { action: start|stop }" }, 400);
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.audio",
      path: "/api/voice/audio",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { pcm?: string };
        if (!body.pcm) return json({ error: "expected { pcm: base64 }" }, 400);
        const s = voiceSessionFor(state.store);
        s.feedAudio(new Uint8Array(Buffer.from(body.pcm, "base64")));
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.events",
      path: "/api/voice/events",
      method: "GET",
      handle: ({ state }) => {
        const s = voiceSessionFor(state.store);
        let cleanup: (() => void) | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            const push = (e: VoiceEvent) => {
              try {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
              } catch {
                /* client gone */
              }
            };
            const off = s.subscribe(push);
            push({ type: "state", state: s.state });
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(": keepalive\n\n"));
              } catch {
                /* ignore */
              }
            }, 20_000);
            cleanup = () => { off(); clearInterval(keepalive); };
          },
          cancel() {
            cleanup?.();
          },
        });
        return sseResponse(stream);
      },
    }),
    route({
      id: "voice.barge",
      path: "/api/voice/barge-in",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        s.bargeIn();
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.played",
      path: "/api/voice/played",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        s.played();
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.say",
      path: "/api/voice/say",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { text?: string };
        if (!body.text) return json({ error: "expected { text }" }, 400);
        const s = voiceSessionFor(state.store);
        await s.say(body.text);
        return json({ state: s.state });
      },
    }),
  ];
}
