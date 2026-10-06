/**
 * XR Phase 4 / 15 — Voice daemon surface (the transport for src/voice).
 *
 * The pipeline (src/voice/pipeline.ts) is dependency-injected; this module is
 * the daemon surface a desktop talks to, and it is deliberately THIN:
 *
 *   - audio UP:    POST /api/voice/audio   (pcm16-le 16 kHz chunks, base64)
 *   - events DOWN: GET  /api/voice/events  (SSE: state/final/tts/tts_stop/
 *                  approval/status/error/download/cost)
 *   - control:     POST /api/voice/session {start|stop}, /barge-in, /played, /say
 *   - facts:       GET  /api/voice/status · /models · /voices · /settings
 *   - Phase 15:    POST /settings · /download · /cancel-download · /clear-models
 *                  · /test-tts · /transcribe
 *
 * Everything smart lives in the engine: endpointing uses the existing VAD
 * primitives, transcripts go through SpeechToText (offline sherpa-onnx first,
 * whisper CLI next, cloud only if explicitly allowed), replies through
 * VoicePipeline.processText (wake word, meta-commands, deterministic intents,
 * agent fallback) and TextToSpeech (offline Piper first, espeak next).
 * The shell renders states and forwards bytes; it computes nothing (SEC-07).
 *
 * Approvals-in-voice: a voice run's approvals are DURABLE records (surface
 * "voice") announced on the event stream; saying confirm/cancel, pressing the
 * desktop buttons, or the TTL decides them through the SAME store every other
 * surface uses (channel "voice").
 */
import { looksIncomplete, SILENCE_TAIL_EXTENDED_MS } from "../../voice/endpointing.ts";
import { route, sseResponse, type DaemonRoute } from "./router.ts";
import { VoicePipeline } from "../../voice/pipeline.ts";
import { SpeechToText, sttFromSettings } from "../../voice/stt.ts";
import { TextToSpeech, ttsFromSettings } from "../../voice/tts.ts";
import { defaultVoiceSettings, type VoiceSettings, type VoiceWakeSensitivity } from "../../voice/types.ts";
import { getVoiceSettings, patchVoiceSettings, sanitizeVoicePatch } from "../../voice/settings.ts";
import { pcm16Rms } from "../../voice/audio.ts";
import { parseConfirmation } from "../../voice/wake.ts";
import { loadNativeVoice, resetNativeVoice } from "../../voice/native.ts";
import { shapeTranscript } from "../../voice/transcript.ts";
import {
  DEFAULT_TTS_VOICE,
  ESPEAK_ENTRY,
  RUNTIME_ENTRY,
  STT_ENTRIES,
  TTS_VOICES,
  VoiceDownloader,
  clearVoiceModels,
  entryBytes,
  entryInstalled,
  findEntry,
  firstRunPlan,
  nativeModuleDir,
  voiceModelDir,
  type DownloadProgress,
  type VoiceComponent,
} from "../../voice/models.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { commandExists } from "../../util/process.ts";
import type { ApprovalRequest } from "../../core/types.ts";
import type { Store } from "../../state/workspace-store.ts";

export type VoiceSessionState = "idle" | "listening" | "thinking" | "planning" | "working" | "tool" | "speaking" | "interrupted" | "success";

export interface VoiceEvent {
  type: "state" | "final" | "tts" | "tts_stop" | "approval" | "status" | "error" | "download" | "cost";
  state?: VoiceSessionState;
  text?: string;
  wav?: string; // base64 wav bytes for the shell to play
  sampleRate?: number;
  id?: string;
  tool?: string;
  reason?: string;
  /** error/status: machine-readable code (stt-model-missing, tts-model-missing, tts-no-audio, stt-failed, tts-failed, run-failed). */
  detail?: string;
  message?: string;
  component?: VoiceComponent;
  /** download */
  status?: DownloadProgress["status"];
  percent?: number;
  received?: number;
  total?: number;
  /** download: progress across the whole requested bundle (first run = several entries). */
  bundleReceived?: number;
  bundleTotal?: number;
  file?: string;
  /** cost (cloud voice only, estimates) */
  usd?: number;
  provider?: string;
  model?: string;
  seconds?: number;
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

/** Speech energy floor per sensitivity (RMS of pcm16 scaled to [-1,1]). */
export function speechRmsFor(sensitivity: VoiceWakeSensitivity | undefined): number {
  if (sensitivity === "low") return 0.035;   // needs a clear, close voice
  if (sensitivity === "high") return 0.012;  // quiet speech counts (more false starts)
  return 0.02;                               // ~-34 dBFS — tuned for laptop mics
}

const MIN_SPEECH_MS = 250;    // utterance floor (rejects clicks)
const SILENCE_TAIL_MS = 700;  // acoustic endpointing tail (stage 1)
// Stage 2 (semantic): provisional-transcript probe fires this far into the
// tail; the verdict may extend the tail once to maxSilenceMs. Fail-open.
const SEM_PROBE_AT_MS = 450;
const SEM_PROBE_GRACE_MS = 350;

function missingCode(detail: string | undefined, component: "stt" | "tts"): string {
  const d = detail ?? "";
  if (/models missing|No local STT|No local TTS|not installed|no models installed|not enabled|missing [A-Z_]+_API_KEY|Install /i.test(d)) return `${component}-model-missing`;
  return `${component}-failed`;
}

export class VoiceSession {
  state: VoiceSessionState = "idle";
  private subs = new Set<(e: VoiceEvent) => void>();
  private buf: number[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private semantic: { startedAt: number; verdict?: "incomplete" | "complete" } | null = null;
  private busy = false;
  private speakDeadline = 0;
  private lastSayText = "";
  private announced = new Set<string>();
  private approvalTimer: ReturnType<typeof setInterval> | null = null;
  pipeline!: VoicePipeline;
  private stt!: SpeechToText;
  private tts!: TextToSpeech;
  private settings: VoiceSettings;
  readonly downloader = new VoiceDownloader();

  constructor(private readonly store: Store, settings?: VoiceSettings) {
    this.settings = settings ?? safeVoiceSettings();
    this.build();
  }

  /** (Re)build STT/TTS/pipeline from the current settings. Safe while live. */
  private build(): void {
    this.stt = sttFromSettings(this.settings);
    this.tts = ttsFromSettings(this.settings);
    this.pipeline = new VoicePipeline({
      store: this.store,
      stt: this.stt,
      tts: this.tts,
      // Phase 4 · avatar state machine: the engine reports planning/tool
      // phases from the real execution envelope; the shell only renders them.
      onPhase: (p) => this.setState(p),
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
      onTtsResult: (r) => {
        if (!r.ok) {
          this.emit({ type: "error", detail: missingCode(r.detail, "tts"), component: "tts", message: r.detail ?? "text-to-speech failed" });
        } else if (!r.hasAudio) {
          // System voices (say/espeak/PowerShell) play on the engine host.
          this.emit({ type: "status", detail: "tts-no-audio", message: `Spoken through the system voice (${r.engine}); no audio reaches this window.` });
        }
        if (r.estimatedUsd) this.recordCost("openai", "tts-1", r.estimatedUsd);
      },
      approve: (req) => this.durableApprove(req),
      settings: this.settings,
    });
  }

  /** Phase 15 · apply a settings patch live (speed/voice/wake/…). */
  reconfigure(next: VoiceSettings): void {
    const voiceChanged = next.ttsVoice !== this.settings.ttsVoice;
    this.settings = next;
    if (voiceChanged) resetNativeVoice();
    this.build();
  }

  currentSettings(): VoiceSettings {
    return this.settings;
  }

  private recordCost(provider: string, model: string, usd: number, seconds?: number): void {
    try {
      this.store.recordCost("voice", provider, model, 0, 0, usd, "estimated");
    } catch {
      /* stub stores in tests */
    }
    this.emit({ type: "cost", usd, provider, model, seconds });
  }

  /**
   * Phase 15 · durable approval for voice runs: the record lands in the same
   * store the desktop modal / Bell / Shield read (surface "voice"), is
   * announced + spoken immediately, and resolves through a spoken confirm,
   * the desktop buttons (REST decision) or the TTL default-deny.
   */
  private async durableApprove(req: ApprovalRequest): Promise<boolean> {
    try {
      const handle = getApprovalStore(this.store).request({
        tool: req.tool,
        reason: req.reason,
        args: req.args,
        preview: req.structuredPreview,
        riskTier: req.riskTier,
        surface: "voice",
        taskId: req.taskId ?? null,
        runId: req.runId ?? null,
        sessionId: req.sessionId ?? null,
      });
      this.announced.add(handle.id);
      this.emit({ type: "approval", id: handle.id, tool: req.tool, reason: req.reason });
      this.store.audit("voice.confirm.request", { tool: req.tool, id: handle.id });
      void this.pipeline.say(`I'm about to ${req.reason}. Say confirm or cancel.`);
      const outcome = await handle.outcome;
      return outcome.approved;
    } catch (err) {
      // Fail closed: a consent-plane fault can never become a silent approval.
      try {
        this.store.audit("voice.confirm.error", { tool: req.tool, error: String(err) });
      } catch {
        /* audit sink may be absent in minimal contexts */
      }
      return false;
    }
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
    this.pipeline.bargeIn(true);
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
    if (rms > speechRmsFor(this.settings.wakeSensitivity)) {
      this.speechMs += frameMs;
      if (this.silenceMs > 0) this.semantic = null; // speech resumed → stale probe
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }
    const semEnabled = this.settings.endpointing?.semantic !== false;
    if (semEnabled && !this.semantic && this.speechMs >= MIN_SPEECH_MS && this.silenceMs >= SEM_PROBE_AT_MS) {
      this.probeSemantic();
    }
    const extended = this.semantic?.verdict === "incomplete";
    const baseTail = Number(this.settings.endpointing?.minSilenceMs) > 0
      ? Math.max(SILENCE_TAIL_MS, Number(this.settings.endpointing?.minSilenceMs))
      : SILENCE_TAIL_MS;
    const tail = extended
      ? Math.max(baseTail, Number(this.settings.endpointing?.maxSilenceMs) || SILENCE_TAIL_EXTENDED_MS)
      : baseTail;
    const probing = semEnabled && this.semantic?.verdict === undefined;
    const probeTimedOut = probing === true && Date.now() - (this.semantic?.startedAt ?? Date.now()) > SEM_PROBE_GRACE_MS + 250;
    const grace = probing === true && !probeTimedOut ? SEM_PROBE_GRACE_MS : 0;
    if (this.speechMs >= MIN_SPEECH_MS && (this.silenceMs >= tail + grace || (this.silenceMs >= tail && probeTimedOut))) {
      const utterance = new Uint8Array(this.buf);
      this.buf = [];
      this.speechMs = 0;
      this.silenceMs = 0;
      this.semantic = null;
      void this.process(utterance);
    }
  }

  /**
   * Stage-2 semantic probe: transcribe the buffer SO FAR (provisional) and
   * classify it. "incomplete" extends the silence tail once; anything else
   * (including errors — fail-open) keeps the acoustic tail.
   */
  private probeSemantic(): void {
    this.semantic = { startedAt: Date.now() };
    const snapshot = new Uint8Array(this.buf);
    let wav: Uint8Array;
    try {
      wav = pcm16ToWav(snapshot);
    } catch {
      if (this.semantic) this.semantic.verdict = "complete";
      return;
    }
    void this.stt
      .transcribe(wav)
      .then((r) => {
        if (!this.semantic) return;
        const v = looksIncomplete(String(r?.text ?? ""));
        this.semantic.verdict = v.incomplete ? "incomplete" : "complete";
      })
      .catch(() => {
        if (this.semantic) this.semantic.verdict = "complete";
      });
  }

  /** Transcribe one utterance (also used by POST /voice/transcribe). */
  async transcribe(pcm: Uint8Array): Promise<{ ok: boolean; text: string; backend: string; detail?: string; ms: number }> {
    const t0 = Date.now();
    const r = await this.stt.transcribe(pcm16ToWav(pcm));
    if (r.estimatedUsd && (r.backend === "groq" || r.backend === "openai")) {
      this.recordCost(r.backend, r.backend === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe", r.estimatedUsd, r.audioSeconds);
    }
    const text = shapeTranscript(r.text ?? "", { profanityFilter: this.settings.profanityFilter });
    return { ok: r.ok, text, backend: r.backend, detail: r.detail, ms: Date.now() - t0 };
  }

  private async process(pcm: Uint8Array): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.setState("thinking");
      const r = await this.transcribe(pcm);
      if (!r.ok && r.detail) {
        // Honest, machine-readable: the desktop shows the download card for
        // missing models and a plain error line for anything else.
        this.emit({ type: "error", detail: missingCode(r.detail, "stt"), component: "stt", message: r.detail });
      }
      const text = r.text.trim();
      if (!text) {
        this.setState("listening");
        return;
      }
      this.emit({ type: "final", text });

      // Approvals-in-voice: confirm/cancel decides the newest pending item
      // through the same durable store every surface uses.
      const decision = parseConfirmation(text);
      if (decision !== "unclear") {
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
      if (out.handled && this.state !== "speaking") {
        this.setState("success");
        setTimeout(() => { if (this.state === "success") this.setState("listening"); }, 1800);
      }
      if (this.state !== "speaking" && this.state !== "success") this.setState("listening");
    } catch (e) {
      this.emit({ type: "error", detail: "run-failed", message: String((e as Error)?.message ?? e).slice(0, 200) });
      this.setState("listening");
    } finally {
      this.busy = false;
      if (this.state === "thinking" || this.state === "working") this.setState("listening");
    }
  }

  async say(text: string): Promise<void> {
    await this.pipeline.say(text);
  }

  /** Phase 15 · synthesize without touching session state (samples, previews). */
  async preview(text: string, voice?: string, speed?: number): Promise<{ ok: boolean; wav?: string; sampleRate?: number; engine: string; detail?: string }> {
    const tts = voice || speed !== undefined
      ? ttsFromSettings({ ...this.settings, ttsVoice: voice ?? this.settings.ttsVoice, ttsSpeed: speed ?? this.settings.ttsSpeed })
      : this.tts;
    const r = await tts.speak(text);
    if (r.estimatedUsd) this.recordCost("openai", "tts-1", r.estimatedUsd);
    if (!r.ok) return { ok: false, engine: r.engine, detail: r.detail };
    if (!r.audio) return { ok: true, engine: r.engine, detail: "spoken through the system voice on the engine host" };
    return { ok: true, wav: Buffer.from(r.audio).toString("base64"), sampleRate: r.sampleRate, engine: r.engine };
  }

  /** Phase 15 · what the desktop gates on. */
  async status(): Promise<Record<string, unknown>> {
    const sttProbe = await this.stt.describeAsync();
    const ttsProbe = await this.tts.describeAsync();
    const native = loadNativeVoice(false, this.settings.ttsVoice === "default" ? undefined : this.settings.ttsVoice);
    const voiceId = native.handles?.ttsVoice ?? (this.settings.ttsVoice === "default" ? DEFAULT_TTS_VOICE : this.settings.ttsVoice);
    const voice = findEntry("tts", voiceId);
    const download = this.downloader.current();
    const plan = firstRunPlan(voiceId);
    const settings = { ...this.settings };
    delete (settings as Partial<VoiceSettings>).lastTestResult;
    return {
      state: this.state,
      available: sttProbe.available,
      stt: {
        loaded: sttProbe.available,
        backend: sttProbe.backend,
        name: sttProbe.detail,
        model: sttProbe.backend === "sherpa" ? STT_ENTRIES[0].id : sttProbe.model,
        missing: native.missing.stt,
        ...(download?.component === "stt" ? { downloadProgress: download } : {}),
      },
      tts: {
        loaded: ttsProbe.available,
        backend: ttsProbe.engine,
        name: ttsProbe.detail,
        voice: voiceId,
        label: voice?.label ?? voiceId,
        hasAudio: ttsProbe.engine === "sherpa" || ttsProbe.engine === "http" || ttsProbe.engine === "piper" || ttsProbe.engine === "kokoro-cli" || ttsProbe.engine === "openai",
        missing: native.missing.tts,
        ...(download?.component === "tts" ? { downloadProgress: download } : {}),
      },
      runtime: { installed: native.missing.runtime.length === 0, detail: native.detail, ...(download?.component === "runtime" ? { downloadProgress: download } : {}) },
      wakeEnabled: this.settings.mode === "wake-word",
      modelDir: voiceModelDir(),
      nativeDir: nativeModuleDir(),
      firstRun: { pending: plan.map((e) => ({ id: e.id, component: e.component, name: e.name, bytes: entryBytes(e) })), bytes: plan.reduce((n, e) => n + entryBytes(e), 0) },
      download,
      settings,
    };
  }
}

/** Settings from config, falling back to defaults when config is unreadable (tests, fresh homes). */
function safeVoiceSettings(): VoiceSettings {
  try {
    return getVoiceSettings();
  } catch {
    return defaultVoiceSettings();
  }
}

let session: VoiceSession | null = null;
export function voiceSessionFor(store: Store): VoiceSession {
  if (!session) session = new VoiceSession(store);
  return session;
}

async function modelCatalogue(): Promise<Record<string, unknown>> {
  const [whisperCli, whisperCpp] = await Promise.all([commandExists("whisper"), commandExists("whisper-cli")]);
  const hasKey = (env: string) => Boolean(process.env[env]);
  return {
    runtime: { ...RUNTIME_ENTRY, bytes: entryBytes(RUNTIME_ENTRY), installed: entryInstalled(RUNTIME_ENTRY), files: undefined },
    stt: [
      ...STT_ENTRIES.map((e) => ({ id: e.id, kind: "offline", name: e.name, detail: e.detail, bytes: entryBytes(e), installed: entryInstalled(e), downloadable: true })),
      { id: "whispercpp", kind: "local-binary", name: "Whisper (whisper.cpp)", detail: whisperCpp ? "whisper-cli found on PATH" : "Install whisper.cpp (whisper-cli) and set XR_WHISPERCPP_MODEL", available: whisperCpp, downloadable: false },
      { id: "whisper-cli", kind: "local-binary", name: "Whisper (openai-whisper CLI)", detail: whisperCli ? "whisper found on PATH" : "Install the openai-whisper CLI", available: whisperCli, downloadable: false },
      { id: "groq", kind: "cloud", name: "Cloud · Groq whisper-large-v3-turbo", detail: hasKey("GROQ_API_KEY") ? "key configured · ≈$0.04 per audio hour (estimate)" : "Add a Groq key in Settings → Models", available: hasKey("GROQ_API_KEY"), downloadable: false },
      { id: "openai", kind: "cloud", name: "Cloud · OpenAI gpt-4o-mini-transcribe", detail: hasKey("OPENAI_API_KEY") ? "key configured · ≈$0.18 per audio hour (estimate)" : "Add an OpenAI key in Settings → Models", available: hasKey("OPENAI_API_KEY"), downloadable: false },
    ],
    espeak: { id: ESPEAK_ENTRY.id, bytes: entryBytes(ESPEAK_ENTRY), installed: entryInstalled(ESPEAK_ENTRY) },
  };
}

function voiceCatalogue(): Record<string, unknown>[] {
  const openai = Boolean(process.env.OPENAI_API_KEY);
  return [
    ...TTS_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      name: v.name,
      gender: v.gender,
      accent: v.accent,
      detail: v.detail,
      kind: "offline",
      bytes: entryBytes(v) + (entryInstalled(ESPEAK_ENTRY) ? 0 : entryBytes(ESPEAK_ENTRY)),
      installed: entryInstalled(v) && entryInstalled(ESPEAK_ENTRY),
      downloadable: true,
    })),
    ...["alloy", "nova", "onyx", "shimmer"].map((id) => ({
      id,
      label: `OpenAI ${id}`,
      name: "OpenAI tts-1",
      kind: "cloud",
      detail: openai ? "cloud · ≈$15 per million characters (estimate)" : "Add an OpenAI key in Settings → Models",
      available: openai,
      installed: false,
      downloadable: false,
    })),
  ];
}

export function voiceRoutes(): DaemonRoute[] {
  return [
    route({
      id: "voice.status",
      path: "/api/voice/status",
      method: "GET",
      handle: async ({ json, state }) => json(await voiceSessionFor(state.store).status()),
    }),
    route({
      id: "voice.session",
      path: "/api/voice/session",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { action?: string };
        const s = voiceSessionFor(state.store);
        if (body.action === "start") {
          const st = await s.status();
          if (!(st.stt as { loaded: boolean }).loaded) {
            return json({ error: "stt-model-missing", detail: (st.stt as { name: string }).name, firstRun: st.firstRun }, 409);
          }
          s.start();
        } else if (body.action === "stop") s.stop();
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
    // ── Phase 15 ──────────────────────────────────────────────────────────
    route({
      id: "voice.models",
      path: "/api/voice/models",
      method: "GET",
      handle: async ({ json }) => json(await modelCatalogue()),
    }),
    route({
      id: "voice.voices",
      path: "/api/voice/voices",
      method: "GET",
      handle: ({ json }) => json({ voices: voiceCatalogue(), sample: "Ready when you are." }),
    }),
    route({
      id: "voice.settings.get",
      path: "/api/voice/settings",
      method: "GET",
      handle: ({ json, state }) => {
        const settings = { ...voiceSessionFor(state.store).currentSettings() };
        delete (settings as Partial<VoiceSettings>).lastTestResult;
        return json({ settings });
      },
    }),
    route({
      id: "voice.settings.set",
      path: "/api/voice/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") return json({ error: "expected a settings patch" }, 400);
        const patch = sanitizeVoicePatch(body);
        const next = patchVoiceSettings(patch);
        const s = voiceSessionFor(state.store);
        s.reconfigure(next);
        state.store.audit("voice.settings.update", { keys: Object.keys(patch) });
        const settings = { ...next };
        delete (settings as Partial<VoiceSettings>).lastTestResult;
        return json({ settings });
      },
    }),
    route({
      id: "voice.download",
      path: "/api/voice/download",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { component?: string; id?: string; firstRun?: boolean };
        const s = voiceSessionFor(state.store);
        if (s.downloader.current()) return json({ error: "download-busy", download: s.downloader.current() }, 409);
        const entries = body.firstRun
          ? firstRunPlan(body.id ?? (s.currentSettings().ttsVoice === "default" ? DEFAULT_TTS_VOICE : s.currentSettings().ttsVoice))
          : (() => {
              const e = body.component && body.id ? findEntry(body.component as VoiceComponent, body.id) : null;
              return e ? [e] : null;
            })();
        if (!entries) return json({ error: "unknown component/id" }, 400);
        state.store.audit("voice.models.download", { items: entries.map((e) => e.id) });
        // Sequential, detached: progress streams over /events; the shell polls /status too.
        const bundleTotal = entries.reduce((n, e) => n + entryBytes(e), 0);
        void (async () => {
          let doneBytes = 0;
          for (const e of entries) {
            const out = await s.downloader.download(e, (p) => s.emit({ type: "download", ...p, bundleReceived: doneBytes + p.received, bundleTotal }));
            if (out.status !== "done") break;
            doneBytes += entryBytes(e);
          }
          resetNativeVoice();
          s.reconfigure(s.currentSettings());
        })();
        return json({ started: entries.map((e) => ({ id: e.id, component: e.component, bytes: entryBytes(e) })), bytes: entries.reduce((n, e) => n + entryBytes(e), 0) });
      },
    }),
    route({
      id: "voice.download.cancel",
      path: "/api/voice/cancel-download",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        const was = s.downloader.current();
        s.downloader.cancel();
        return json({ cancelled: Boolean(was), download: was });
      },
    }),
    route({
      id: "voice.models.clear",
      path: "/api/voice/clear-models",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        if (s.state !== "idle") s.stop();
        s.downloader.cancel();
        const out = clearVoiceModels();
        resetNativeVoice();
        s.reconfigure(s.currentSettings());
        state.store.audit("voice.models.clear", { removed: out.removed.length });
        return json(out);
      },
    }),
    route({
      id: "voice.test_tts",
      path: "/api/voice/test-tts",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string; speed?: number };
        const text = (body.text ?? "Ready when you are.").slice(0, 300);
        const s = voiceSessionFor(state.store);
        if (body.voice) {
          const entry = findEntry("tts", body.voice);
          if (entry && !(entryInstalled(entry) && entryInstalled(ESPEAK_ENTRY))) return json({ error: "voice-not-installed", id: body.voice, bytes: entryBytes(entry) }, 409);
        }
        const out = await s.preview(text, body.voice, typeof body.speed === "number" ? body.speed : undefined);
        return json(out, out.ok ? 200 : 409);
      },
    }),
    route({
      id: "voice.transcribe",
      path: "/api/voice/transcribe",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { pcm?: string };
        if (!body.pcm) return json({ error: "expected { pcm: base64 }" }, 400);
        const s = voiceSessionFor(state.store);
        const out = await s.transcribe(new Uint8Array(Buffer.from(body.pcm, "base64")));
        return json(out, out.ok || !out.detail ? 200 : 409);
      },
    }),
  ];
}
