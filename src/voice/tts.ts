/**
 * XR Stage 8 — Text-to-Speech adapters (async, non-blocking).
 *
 * Local-first order: Piper/Kokoro command or HTTP endpoint, then OS speech.
 * Cloud TTS is intentionally not automatic in this file; users can point the
 * HTTP adapter at an explicitly configured provider if they choose.
 *
 * All subprocess work uses Bun.spawn / node spawn via util/process — never
 * execSync / spawnSync — so the XR daemon stays responsive during TTS.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VoiceSettings, VoiceTtsBackend } from "./types.ts";
import { commandExists, runCommand, spawnAndWait } from "../util/process.ts";
import { loadNativeVoice } from "./native.ts";
import { mkdtempPath, readBytes, removePath } from "../util/fs-async.ts";
import { voiceIoLimit } from "../util/concurrency.ts";

export type VoicePersona = "calm" | "fast" | "detailed";

export interface TtsOptions {
  engine?: VoiceTtsBackend;
  baseUrl?: string;
  voice?: string;
  systemVoice?: string;
  persona?: VoicePersona;
  fetchFn?: typeof fetch;
  /** Phase 15 · 0.7–1.3 (Piper native speed; OpenAI `speed`). */
  speed?: number;
  /** Phase 15 · cloud TTS needs an explicit opt-in (settings.allowCloudTts). */
  allowCloud?: boolean;
}

export interface TtsResult {
  ok: boolean;
  audio: Uint8Array | null;
  spokenText: string;
  engine: "http" | "piper" | "kokoro-cli" | "system" | "say" | "espeak" | "powershell" | "sherpa" | "openai" | "none";
  detail?: string;
  sampleRate?: number;
  /** Phase 15 · cloud only: estimated USD for this utterance (local = absent). */
  estimatedUsd?: number;
}

export function shapeForPersona(text: string, persona: VoicePersona): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (persona === "fast") {
    const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
    return first.slice(0, 220);
  }
  if (persona === "detailed") return t.slice(0, 1800);
  return t.length > 600 ? t.slice(0, 600) + "…" : t;
}

export function ttsFromSettings(settings: VoiceSettings, fetchFn?: typeof fetch): TextToSpeech {
  return new TextToSpeech({
    engine: settings.ttsBackend,
    baseUrl: settings.ttsUrl,
    voice: settings.ttsVoice,
    systemVoice: settings.ttsVoice === "default" ? undefined : settings.ttsVoice,
    persona: settings.ttsPersona,
    fetchFn,
    speed: settings.ttsSpeed,
    allowCloud: settings.allowCloudTts,
  });
}

export class TextToSpeech {
  private engine: VoiceTtsBackend;
  private baseUrl: string;
  private voice: string;
  private systemVoice: string;
  private persona: VoicePersona;
  private injectedFetch?: typeof fetch;
  private speed: number;
  private allowCloud: boolean;
  private engineCache: { engine: VoiceTtsBackend; available: boolean; detail: string; at: number } | null = null;

  constructor(opts: TtsOptions = {}) {
    this.engine = opts.engine ?? "auto";
    this.baseUrl = (opts.baseUrl ?? process.env.XR_TTS_URL ?? "http://localhost:8081").replace(/\/$/, "");
    this.voice = opts.voice ?? process.env.XR_TTS_VOICE ?? "default";
    this.systemVoice = opts.systemVoice ?? (this.voice === "default" ? "" : this.voice);
    this.persona = opts.persona ?? "calm";
    this.injectedFetch = opts.fetchFn;
    this.speed = Math.min(1.3, Math.max(0.7, opts.speed ?? 1));
    this.allowCloud = opts.allowCloud ?? false;
  }

  /** Phase 15 · live speed changes from the settings screen (no re-probe). */
  setSpeed(speed: number): void {
    this.speed = Math.min(1.3, Math.max(0.7, speed || 1));
  }

  setPersona(p: VoicePersona): void {
    this.persona = p;
  }

  describe(): { engine: VoiceTtsBackend; available: boolean; detail: string } {
    // Sync describe for CLI status — uses last async selection or optimistic defaults.
    if (this.engineCache && Date.now() - this.engineCache.at < 30_000) {
      return { engine: this.engineCache.engine, available: this.engineCache.available, detail: this.engineCache.detail };
    }
    if (this.engine === "disabled") return { engine: "disabled", available: false, detail: "TTS disabled" };
    if (this.injectedFetch) return { engine: this.engine === "auto" ? "http" : this.engine, available: true, detail: "test fetch injected" };
    if (this.engine === "http" || process.env.XR_TTS_URL) return { engine: "http", available: true, detail: `HTTP TTS at ${this.baseUrl}` };
    return { engine: this.engine, available: true, detail: "run speak() / describeAsync() for live probe" };
  }

  async describeAsync(): Promise<{ engine: VoiceTtsBackend; available: boolean; detail: string }> {
    const selected = await this.selectEngine();
    return selected;
  }

  async speak(text: string): Promise<TtsResult> {
    const spokenText = shapeForPersona(text, this.persona);
    return voiceIoLimit.run(async () => {
      const selected = await this.selectEngine();
      if (!selected.available) return { ok: false, audio: null, spokenText, engine: "none", detail: selected.detail };

      if (selected.engine === "http") return this.speakHttp(spokenText);
      if (selected.engine === "sherpa") {
        const native = loadNativeVoice(false, this.voice === "default" ? undefined : this.voice);
        const out = native.handles?.speak(spokenText, this.speed) ?? null;
        if (!out) return { ok: false, audio: null, spokenText, engine: "none", detail: native.handles?.ttsDetail ?? "offline TTS unavailable" };
        return { ok: true, audio: out.wav, spokenText, engine: "sherpa", sampleRate: out.sampleRate };
      }
      if (selected.engine === "openai") return this.speakOpenAi(spokenText);
      if (selected.engine === "piper") return this.speakPiper(spokenText);
      if (selected.engine === "kokoro-cli") return this.speakKokoroCli(spokenText);
      if (selected.engine === "say" || selected.engine === "espeak" || selected.engine === "powershell" || selected.engine === "system") {
        return this.speakSystem(spokenText, selected.engine);
      }
      return { ok: false, audio: null, spokenText, engine: "none", detail: "TTS disabled" };
    });
  }

  private async selectEngine(): Promise<{ engine: VoiceTtsBackend; available: boolean; detail: string }> {
    if (this.engineCache && Date.now() - this.engineCache.at < 30_000 && this.engine === "auto") {
      return this.engineCache;
    }

    let selected: { engine: VoiceTtsBackend; available: boolean; detail: string };

    if (this.engine === "disabled") {
      selected = { engine: "disabled", available: false, detail: "TTS disabled" };
    } else if (this.injectedFetch) {
      selected = { engine: this.engine === "auto" ? "http" : this.engine, available: true, detail: "test fetch injected" };
    } else if (this.engine === "http") {
      selected = { engine: "http", available: true, detail: `HTTP TTS at ${this.baseUrl}` };
    } else if (this.engine === "sherpa") {
      const native = loadNativeVoice(false, this.voice === "default" ? undefined : this.voice);
      const ok = Boolean(native.ok && native.handles && native.handles.ttsDetail.startsWith("sherpa-onnx piper"));
      selected = { engine: "sherpa", available: ok, detail: ok ? (native.handles?.ttsDetail ?? "sherpa-onnx piper offline") : (native.handles?.ttsDetail ?? native.detail) };
    } else if (this.engine === "openai") {
      const key = process.env.OPENAI_API_KEY ?? "";
      selected = !this.allowCloud
        ? { engine: "openai", available: false, detail: "cloud TTS is not enabled; allow it in voice settings first" }
        : { engine: "openai", available: !!key, detail: key ? "OpenAI tts-1 (cloud, billed per character)" : "missing OPENAI_API_KEY" };
    } else if (this.engine === "auto" && loadNativeVoice(false, this.voice === "default" ? undefined : this.voice).handles?.ttsDetail.startsWith("sherpa-onnx piper")) {
      selected = { engine: "sherpa", available: true, detail: loadNativeVoice().handles?.ttsDetail ?? "sherpa-onnx piper offline" };
    } else if (this.engine === "piper") {
      const ok = await commandExists("piper");
      selected = { engine: "piper", available: ok, detail: ok ? "piper found" : "Install piper" };
    } else if (this.engine === "kokoro-cli") {
      const ok = await commandExists("kokoro");
      selected = { engine: "kokoro-cli", available: ok, detail: ok ? "kokoro CLI found" : "Install kokoro CLI or use HTTP" };
    } else if (this.engine === "say") {
      const ok = await commandExists("say");
      selected = { engine: "say", available: ok, detail: ok ? "macOS say found" : "say not found" };
    } else if (this.engine === "espeak") {
      const ok = await commandExists("espeak");
      selected = { engine: "espeak", available: ok, detail: ok ? "espeak found" : "espeak not found" };
    } else if (this.engine === "powershell") {
      const ok = await commandExists("powershell");
      selected = { engine: "powershell", available: ok, detail: ok ? "PowerShell speech found" : "PowerShell not found" };
    } else if (this.engine === "system") {
      selected = await this.selectSystemEngine();
    } else if (process.env.XR_TTS_URL) {
      selected = { engine: "http", available: true, detail: `HTTP TTS at ${this.baseUrl}` };
    } else if (await commandExists("piper")) {
      selected = { engine: "piper", available: true, detail: "piper found" };
    } else if (await commandExists("kokoro")) {
      selected = { engine: "kokoro-cli", available: true, detail: "kokoro CLI found" };
    } else {
      selected = await this.selectSystemEngine();
    }

    this.engineCache = { ...selected, at: Date.now() };
    return selected;
  }

  private async selectSystemEngine(): Promise<{ engine: VoiceTtsBackend; available: boolean; detail: string }> {
    if (process.platform === "darwin" && (await commandExists("say"))) return { engine: "say", available: true, detail: "macOS say" };
    if (process.platform === "linux" && (await commandExists("espeak"))) return { engine: "espeak", available: true, detail: "Linux espeak" };
    if (process.platform === "win32" && (await commandExists("powershell"))) return { engine: "powershell", available: true, detail: "Windows System.Speech" };
    return { engine: "system", available: false, detail: "No local TTS found. Install Piper, Kokoro, espeak, or configure XR_TTS_URL." };
  }

  private async speakHttp(text: string): Promise<TtsResult> {
    try {
      const fetcher = this.injectedFetch ?? fetch;
      const res = await fetcher(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return { ok: false, audio: null, spokenText: text, engine: "http", detail: `HTTP ${res.status}` };
      return { ok: true, audio: new Uint8Array(await res.arrayBuffer()), spokenText: text, engine: "http" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "http", detail: (e as Error).message };
    }
  }

  /** Phase 15 · OpenAI speech endpoint → WAV bytes. Only reachable when the user allowed cloud TTS. */
  private async speakOpenAi(text: string): Promise<TtsResult> {
    try {
      const fetcher = this.injectedFetch ?? fetch;
      const voice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(this.voice) ? this.voice : "alloy";
      const res = await fetcher("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
        body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "wav", speed: this.speed }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return { ok: false, audio: null, spokenText: text, engine: "openai", detail: `HTTP ${res.status}` };
      const { estimateTtsUsd } = await import("./transcript.ts");
      return { ok: true, audio: new Uint8Array(await res.arrayBuffer()), spokenText: text, engine: "openai", estimatedUsd: estimateTtsUsd(text.length) };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "openai", detail: (e as Error).message };
    }
  }

  private async speakPiper(text: string): Promise<TtsResult> {
    const dir = await mkdtempPath(join(tmpdir(), "xr-tts-"));
    const out = join(dir, "speech.wav");
    try {
      const model = process.env.XR_PIPER_MODEL ?? (this.voice !== "default" ? this.voice : "");
      const args = model ? ["--model", model, "--output_file", out] : ["--output_file", out];
      const r = await runCommand("piper", args, { input: text, timeoutMs: 45000 });
      if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "piper", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      return { ok: true, audio: await readBytes(out), spokenText: text, engine: "piper" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "piper", detail: (e as Error).message };
    } finally {
      await removePath(dir, { recursive: true, force: true });
    }
  }

  private async speakKokoroCli(text: string): Promise<TtsResult> {
    const dir = await mkdtempPath(join(tmpdir(), "xr-kokoro-"));
    const out = join(dir, "speech.wav");
    try {
      const args = ["--text", text, "--output", out];
      if (this.voice && this.voice !== "default") args.push("--voice", this.voice);
      const r = await runCommand("kokoro", args, { timeoutMs: 45000 });
      if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "kokoro-cli", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      return { ok: true, audio: await readBytes(out), spokenText: text, engine: "kokoro-cli" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "kokoro-cli", detail: (e as Error).message };
    } finally {
      await removePath(dir, { recursive: true, force: true });
    }
  }

  private async speakSystem(text: string, preferred: VoiceTtsBackend): Promise<TtsResult> {
    try {
      if ((preferred === "say" || preferred === "system") && process.platform === "darwin" && (await commandExists("say"))) {
        const r = await spawnAndWait("say", [...(this.systemVoice ? ["-v", this.systemVoice] : []), text], 45000);
        if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "say", detail: r.error };
        return { ok: true, audio: null, spokenText: text, engine: "say" };
      }
      if ((preferred === "espeak" || preferred === "system") && process.platform === "linux" && (await commandExists("espeak"))) {
        const r = await spawnAndWait("espeak", [...(this.systemVoice ? ["-v", this.systemVoice] : []), text], 45000);
        if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "espeak", detail: r.error };
        return { ok: true, audio: null, spokenText: text, engine: "espeak" };
      }
      if ((preferred === "powershell" || preferred === "system") && process.platform === "win32" && (await commandExists("powershell"))) {
        const safe = text.replace(/`/g, "``").replace(/"/g, '`"').replace(/\r?\n/g, " ");
        const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak("${safe}")`;
        const r = await spawnAndWait("powershell", ["-NoProfile", "-Command", ps], 45000);
        if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "powershell", detail: r.error };
        return { ok: true, audio: null, spokenText: text, engine: "powershell" };
      }
      return { ok: false, audio: null, spokenText: text, engine: "none", detail: "no system TTS available" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "none", detail: (e as Error).message };
    }
  }
}
