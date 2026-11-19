/** Engine-owned voice session. Routes and surfaces share this one lifetime. */
import { VoiceDownloads, type VoiceDownloadStart } from "../voice/downloads.ts";
import { describeThrown } from "../util/thrown.ts";
import { looksIncomplete, SILENCE_TAIL_EXTENDED_MS } from "../voice/endpointing.ts";
import { VoicePipeline } from "../voice/pipeline.ts";
import { SpeechToText, sttFromSettings } from "../voice/stt.ts";
import { TextToSpeech, ttsFromSettings } from "../voice/tts.ts";
import { defaultVoiceSettings, type VoiceSettings, type VoiceWakeSensitivity } from "../voice/types.ts";
import { getVoiceSettings } from "../voice/settings.ts";
import { pcm16Rms } from "../voice/audio.ts";
import { parseConfirmation } from "../voice/wake.ts";
import { loadNativeVoice, resetNativeVoice } from "../voice/native.ts";
import { shapeTranscript } from "../voice/transcript.ts";
import { DEFAULT_TTS_VOICE, STT_ENTRIES, entryBytes, findEntry, firstRunPlan, nativeModuleDir, voiceModelDir, type DownloadProgress, type VoiceComponent, type VoiceModelEntry } from "../voice/models.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import type { ApprovalRequest } from "../core/types.ts";
import type { Store } from "../state/workspace-store.ts";

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
  /** approval: the engine has decided it (by voice or another surface). */
  resolved?: "approved" | "denied";
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
/** A session with no event subscriber for this long is stopped (client gone). */
const ORPHAN_GRACE_MS = 10_000;
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
  private busy: symbol | null = null;
  private generation = 0;
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private speakDeadline = 0;
  private lastSayText = "";
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  private announced = new Set<string>();
  /** Approval ids that already got one spoken "I didn't catch that". */
  private unclearOnce = new Set<string>();
  private approvalTimer: ReturnType<typeof setInterval> | null = null;
  pipeline!: VoicePipeline;
  private stt!: SpeechToText;
  private tts!: TextToSpeech;
  private settings: VoiceSettings;
  readonly downloader = new VoiceDownloads((p) => this.emit({ type: "download", ...p }));

  constructor(private readonly store: Store, settings?: VoiceSettings) {
    this.settings = settings ?? safeVoiceSettings();
    this.build();
  }

  /** (Re)build STT/TTS/pipeline from the current settings. Safe while live. */
  private build(): void {
    const generation = this.generation, current = () => generation === this.generation;
    this.stt = sttFromSettings(this.settings);
    this.tts = ttsFromSettings(this.settings);
    this.pipeline = new VoicePipeline({
      store: this.store,
      stt: this.stt,
      tts: this.tts,
      // Phase 4 · avatar state machine: the engine reports planning/tool
      // phases from the real execution envelope; the shell only renders them.
      onPhase: (p) => { if (current()) this.setState(p); },
      play: (audio) => {
        if (!current()) return { stop() {} };
        // The SHELL plays audio; the pipeline only needs stop semantics for
        // barge-in, which arrives as /api/voice/barge-in → tts_stop event.
        this.emit({ type: "tts", wav: Buffer.from(audio).toString("base64"), text: this.lastSayText });
        this.setState("speaking");
        this.speakDeadline = Date.now() + Math.min(60_000, audio.length / 44 + 2_000);
        return { stop: () => { if (current()) this.emit({ type: "tts_stop" }); } };
      },
      onText: (entry) => {
        if (current() && entry.role === "assistant") {
          this.lastSayText = entry.text;
          this.emit({ type: "status", text: entry.text });
        }
      },
      onTtsResult: (r) => {
        // Work already billed remains recorded even when its audio is discarded.
        if (r.estimatedUsd) this.recordCost("openai", "tts-1", r.estimatedUsd);
        if (r.discarded || !current()) return;
        if (!r.ok) {
          this.emit({ type: "error", detail: missingCode(r.detail, "tts"), component: "tts", message: r.detail ?? "text-to-speech failed" });
        } else if (!r.hasAudio) {
          // System voices (say/espeak/PowerShell) play on the engine host.
          this.emit({ type: "status", detail: "tts-no-audio", message: `Spoken through the system voice (${r.engine}); no audio reaches this window.` });
        }
      },
      approve: (req) => current() ? this.durableApprove(req) : Promise.resolve(false),
      settings: this.settings,
    });
  }

  /** Phase 15 · apply a settings patch live (speed/voice/wake/…). */
  reconfigure(next: VoiceSettings): void {
    const voiceChanged = next.ttsVoice !== this.settings.ttsVoice, active = this.state !== "idle";
    this.invalidate();
    this.settings = next;
    if (voiceChanged) resetNativeVoice();
    this.build();
    if (active) this.setState("listening");
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
    const generation = this.generation;
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
      if (generation !== this.generation) return false;
      this.unclearOnce.delete(handle.id);
      this.emit({ type: "approval", id: handle.id, resolved: outcome.approved ? "approved" : "denied" });
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
    if (this.orphanTimer) { clearTimeout(this.orphanTimer); this.orphanTimer = null; }
    this.deliver(fn, { type: "state", state: this.state });
    return () => {
      this.subs.delete(fn);
      // No client left to hear the reply: a session whose window vanished
      // (crash, closed tab) must not stay "listening" forever.
      if (this.subs.size === 0 && this.state !== "idle" && !this.orphanTimer) {
        this.orphanTimer = setTimeout(() => {
          this.orphanTimer = null;
          if (this.subs.size === 0 && this.state !== "idle") {
            this.store.audit("voice.session.orphaned", {});
            this.stop();
          }
        }, ORPHAN_GRACE_MS);
      }
    };
  }

  /** Subscribers already audited for throwing (one record per faulty subscriber). */
  private faultySubs = new WeakSet<(e: VoiceEvent) => void>();

  /**
   * B1 — fan-out is isolated per subscriber: one throwing subscriber (a closed
   * SSE controller, a test spy) is audited once and never aborts delivery to
   * the others or escapes into a detached promise chain.
   */
  emit(e: VoiceEvent): void {
    for (const fn of [...this.subs]) this.deliver(fn, e);
  }

  private deliver(fn: (e: VoiceEvent) => void, e: VoiceEvent): void {
    try { fn(e); } catch (err) {
      if (this.faultySubs.has(fn)) return;
      this.faultySubs.add(fn);
      this.safeAudit("voice.subscriber.error", { event: e.type, error: describeThrown(err) });
    }
  }

  private safeAudit(action: string, details: Record<string, unknown>): void {
    try { this.store.audit(action, details); } catch { /* audit sink may be absent in minimal contexts */ }
  }

  /**
   * B1/B15 — start a model download. Admission is synchronous and typed (a
   * running bundle answers `{ started: false, reason: "busy" }`), and the
   * detached completion chain can never reject: a failed bundle is audited as
   * `voice.download.failed`, and the native re-probe + reconfigure that follows
   * every bundle is isolated so its failure surfaces as an error event.
   */
  startDownload(entries: VoiceModelEntry[]): VoiceDownloadStart {
    const run = this.downloader.start(entries);
    if (run.started) void run.done.then(() => this.afterDownload(), (e: unknown) => this.afterDownload(e)).catch(() => { /* afterDownload is total */ });
    return run;
  }

  private afterDownload(thrown?: unknown): void {
    const p = this.downloader.current();
    if (thrown !== undefined || p?.status === "error") {
      this.safeAudit("voice.download.failed", { id: p?.id ?? null, detail: thrown !== undefined ? describeThrown(thrown) : (p?.detail ?? null) });
    }
    try {
      resetNativeVoice();
      this.reconfigure(this.currentSettings());
    } catch (err) {
      this.safeAudit("voice.download.reconfigure_failed", { error: describeThrown(err) });
      this.emit({ type: "error", detail: "voice-reconfigure-failed", message: describeThrown(err) });
    }
  }

  setState(s: VoiceSessionState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit({ type: "state", state: s });
  }

  start(): void {
    if (this.state !== "idle") return;
    this.invalidate(); this.build();
    this.buf = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.setState("listening");
    this.store.audit("voice.session.start", {});
    this.announced = new Set(getApprovalStore(this.store).listPending().map((a) => a.id));
    this.approvalTimer = setInterval(() => this.announceApprovals(), 1_500);
  }

  private invalidate(): void {
    this.pipeline.cancel(); this.generation++; this.busy = null; this.semantic = null;
    this.buf = []; this.speechMs = 0; this.silenceMs = 0; this.speakDeadline = 0;
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = null;
  }

  stop(): void {
    const active = this.state !== "idle";
    this.invalidate(); this.setState("idle");
    if (this.approvalTimer) clearInterval(this.approvalTimer);
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.approvalTimer = null; this.orphanTimer = null;
    if (active) this.store.audit("voice.session.stop", {});
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
      if (this.settings.bargeInCancelsRun) this.busy = null;
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
    const semantic = { startedAt: Date.now(), verdict: undefined as "incomplete" | "complete" | undefined };
    this.semantic = semantic;
    const snapshot = new Uint8Array(this.buf);
    let wav: Uint8Array;
    try {
      wav = pcm16ToWav(snapshot);
    } catch {
      if (this.semantic === semantic) semantic.verdict = "complete";
      return;
    }
    void this.stt
      .transcribe(wav)
      .then((r) => {
        if (this.semantic !== semantic) return;
        const v = looksIncomplete(String(r?.text ?? ""));
        semantic.verdict = v.incomplete ? "incomplete" : "complete";
      })
      .catch(() => {
        if (this.semantic === semantic) semantic.verdict = "complete";
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
    if (this.busy || this.state === "idle") return;
    const owner = Symbol("utterance"), generation = this.generation, pipeline = this.pipeline;
    const current = () => this.busy === owner && this.generation === generation && this.state !== "idle";
    this.busy = owner;
    if (this.successTimer) clearTimeout(this.successTimer);
    try {
      this.setState("thinking");
      const r = await this.transcribe(pcm);
      if (!current()) return;
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
      const store = getApprovalStore(this.store);
      const pending = store.listPending();
      const newest = pending[pending.length - 1];
      if (newest) {
        if (decision === "unclear") {
          // Once by voice, then the buttons take over — never loop on the user.
          if (!this.unclearOnce.has(newest.id)) {
            this.unclearOnce.add(newest.id);
            await pipeline.say("I didn't catch that. Say confirm or cancel, or use the buttons.");
          } else {
            this.emit({ type: "status", text: "Use the buttons to decide." });
            this.setState("listening");
          }
          return;
        }
        const approved = decision === "confirm";
        const ok = store.decide(newest.id, approved, { channel: "voice", userId: null });
        this.store.audit("voice.approval.decided", { id: newest.id, approved, ok });
        this.emit({ type: "approval", id: newest.id, resolved: approved ? "approved" : "denied" });
        await pipeline.say(ok ? (approved ? "Approved." : "Cancelled.") : "That approval already expired.");
        return;
      }

      this.setState("working");
      const out = await pipeline.processText(text);
      if (!current()) return;
      if (!out.handled && !out.reply) {
        await pipeline.say("I didn't catch a command in that.");
      }
      if (!current()) return;
      if (out.handled && this.state !== "speaking") {
        this.setState("success");
        this.successTimer = setTimeout(() => { if (generation === this.generation && this.state === "success") this.setState("listening"); }, 1800);
      }
      if (this.state !== "speaking" && this.state !== "success") this.setState("listening");
    } catch (e) {
      if (!current()) return;
      this.emit({ type: "error", detail: "run-failed", message: String((e as Error)?.message ?? e).slice(0, 200) });
      this.setState("listening");
    } finally {
      if (this.busy === owner) {
        this.busy = null;
        if (generation === this.generation && (this.state === "thinking" || this.state === "working")) this.setState("listening");
      }
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

const sessions = new WeakMap<Store, VoiceSession>();
export function voiceSessionFor(store: Store): VoiceSession {
  let session = sessions.get(store);
  const settings = safeVoiceSettings();
  if (!session) { session = new VoiceSession(store, settings); sessions.set(store, session); }
  else if (session.currentSettings().revision !== settings.revision) session.reconfigure(settings);
  return session;
}
