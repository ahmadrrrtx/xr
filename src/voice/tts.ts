/**
 * XR Stage 8 — Text-to-Speech adapters.
 *
 * Local-first order: Piper/Kokoro command or HTTP endpoint, then OS speech.
 * Cloud TTS is intentionally not automatic in this file; users can point the
 * HTTP adapter at an explicitly configured provider if they choose.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { VoiceSettings, VoiceTtsBackend } from "./types.ts";

export type VoicePersona = "calm" | "fast" | "detailed";

export interface TtsOptions {
  engine?: VoiceTtsBackend;
  baseUrl?: string;
  voice?: string;
  systemVoice?: string;
  persona?: VoicePersona;
  fetchFn?: typeof fetch;
}

export interface TtsResult {
  ok: boolean;
  audio: Uint8Array | null;
  spokenText: string;
  engine: "http" | "piper" | "kokoro-cli" | "system" | "say" | "espeak" | "powershell" | "none";
  detail?: string;
}

function commandExists(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return r.status === 0;
}

function run(cmd: string, args: string[], input?: string, timeoutMs = 30000): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? null };
}

export function shapeForPersona(text: string, persona: VoicePersona): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (persona === "fast") {
    const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
    return first.slice(0, 220);
  }
  if (persona === "detailed") return t.slice(0, 1800);
  return t.length > 650 ? t.slice(0, 650) + "…" : t;
}

export function ttsFromSettings(settings: VoiceSettings, fetchFn?: typeof fetch): TextToSpeech {
  return new TextToSpeech({
    engine: settings.ttsBackend,
    baseUrl: settings.ttsUrl,
    voice: settings.ttsVoice,
    systemVoice: settings.ttsVoice === "default" ? undefined : settings.ttsVoice,
    persona: settings.ttsPersona,
    fetchFn,
  });
}

export class TextToSpeech {
  private engine: VoiceTtsBackend;
  private baseUrl: string;
  private voice: string;
  private systemVoice: string;
  private persona: VoicePersona;
  private injectedFetch?: typeof fetch;

  constructor(opts: TtsOptions = {}) {
    this.engine = opts.engine ?? "auto";
    this.baseUrl = (opts.baseUrl ?? process.env.XR_TTS_URL ?? "http://localhost:8081").replace(/\/$/, "");
    this.voice = opts.voice ?? process.env.XR_TTS_VOICE ?? "default";
    this.systemVoice = opts.systemVoice ?? (this.voice === "default" ? "" : this.voice);
    this.persona = opts.persona ?? "calm";
    this.injectedFetch = opts.fetchFn;
  }

  setPersona(p: VoicePersona): void {
    this.persona = p;
  }

  describe(): { engine: VoiceTtsBackend; available: boolean; detail: string } {
    const selected = this.selectEngine();
    return selected;
  }

  async speak(text: string): Promise<TtsResult> {
    const spokenText = shapeForPersona(text, this.persona);
    const selected = this.selectEngine();
    if (!selected.available) return { ok: false, audio: null, spokenText, engine: "none", detail: selected.detail };

    if (selected.engine === "http") return this.speakHttp(spokenText);
    if (selected.engine === "piper") return this.speakPiper(spokenText);
    if (selected.engine === "kokoro-cli") return this.speakKokoroCli(spokenText);
    if (selected.engine === "say" || selected.engine === "espeak" || selected.engine === "powershell" || selected.engine === "system") {
      return this.speakSystem(spokenText, selected.engine);
    }
    return { ok: false, audio: null, spokenText, engine: "none", detail: "TTS disabled" };
  }

  private selectEngine(): { engine: VoiceTtsBackend; available: boolean; detail: string } {
    if (this.engine === "disabled") return { engine: "disabled", available: false, detail: "TTS disabled" };
    if (this.injectedFetch) return { engine: this.engine === "auto" ? "http" : this.engine, available: true, detail: "test fetch injected" };
    if (this.engine === "http") return { engine: "http", available: true, detail: `HTTP TTS at ${this.baseUrl}` };
    if (this.engine === "piper") return { engine: "piper", available: commandExists("piper"), detail: commandExists("piper") ? "piper found" : "Install piper" };
    if (this.engine === "kokoro-cli") return { engine: "kokoro-cli", available: commandExists("kokoro"), detail: commandExists("kokoro") ? "kokoro CLI found" : "Install kokoro CLI or use HTTP" };
    if (this.engine === "say") return { engine: "say", available: commandExists("say"), detail: commandExists("say") ? "macOS say found" : "say not found" };
    if (this.engine === "espeak") return { engine: "espeak", available: commandExists("espeak"), detail: commandExists("espeak") ? "espeak found" : "espeak not found" };
    if (this.engine === "powershell") return { engine: "powershell", available: commandExists("powershell"), detail: commandExists("powershell") ? "PowerShell speech found" : "PowerShell not found" };
    if (this.engine === "system") return this.selectSystemEngine();

    if (process.env.XR_TTS_URL) return { engine: "http", available: true, detail: `HTTP TTS at ${this.baseUrl}` };
    if (commandExists("piper")) return { engine: "piper", available: true, detail: "piper found" };
    if (commandExists("kokoro")) return { engine: "kokoro-cli", available: true, detail: "kokoro CLI found" };
    return this.selectSystemEngine();
  }

  private selectSystemEngine(): { engine: VoiceTtsBackend; available: boolean; detail: string } {
    if (process.platform === "darwin" && commandExists("say")) return { engine: "say", available: true, detail: "macOS say" };
    if (process.platform === "linux" && commandExists("espeak")) return { engine: "espeak", available: true, detail: "Linux espeak" };
    if (process.platform === "win32" && commandExists("powershell")) return { engine: "powershell", available: true, detail: "Windows System.Speech" };
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

  private speakPiper(text: string): TtsResult {
    const dir = mkdtempSync(join(tmpdir(), "xr-tts-"));
    const out = join(dir, "speech.wav");
    try {
      const model = process.env.XR_PIPER_MODEL ?? (this.voice !== "default" ? this.voice : "");
      const args = model ? ["--model", model, "--output_file", out] : ["--output_file", out];
      const r = run("piper", args, text, 45000);
      if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "piper", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      return { ok: true, audio: new Uint8Array(readFileSync(out)), spokenText: text, engine: "piper" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "piper", detail: (e as Error).message };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private speakKokoroCli(text: string): TtsResult {
    const dir = mkdtempSync(join(tmpdir(), "xr-kokoro-"));
    const out = join(dir, "speech.wav");
    try {
      const args = ["--text", text, "--output", out];
      if (this.voice && this.voice !== "default") args.push("--voice", this.voice);
      const r = run("kokoro", args, undefined, 45000);
      if (!r.ok) return { ok: false, audio: null, spokenText: text, engine: "kokoro-cli", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      return { ok: true, audio: new Uint8Array(readFileSync(out)), spokenText: text, engine: "kokoro-cli" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "kokoro-cli", detail: (e as Error).message };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async speakSystem(text: string, preferred: VoiceTtsBackend): Promise<TtsResult> {
    try {
      if ((preferred === "say" || preferred === "system") && process.platform === "darwin" && commandExists("say")) {
        await spawnAndWait("say", [...(this.systemVoice ? ["-v", this.systemVoice] : []), text], 45000);
        return { ok: true, audio: null, spokenText: text, engine: "say" };
      }
      if ((preferred === "espeak" || preferred === "system") && process.platform === "linux" && commandExists("espeak")) {
        await spawnAndWait("espeak", [...(this.systemVoice ? ["-v", this.systemVoice] : []), text], 45000);
        return { ok: true, audio: null, spokenText: text, engine: "espeak" };
      }
      if ((preferred === "powershell" || preferred === "system") && process.platform === "win32" && commandExists("powershell")) {
        const safe = text.replace(/`/g, "``").replace(/"/g, '`"').replace(/\r?\n/g, " ");
        const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak("${safe}")`;
        await spawnAndWait("powershell", ["-NoProfile", "-Command", ps], 45000);
        return { ok: true, audio: null, spokenText: text, engine: "powershell" };
      }
      return { ok: false, audio: null, spokenText: text, engine: "none", detail: "no system TTS available" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "none", detail: (e as Error).message };
    }
  }
}

function spawnAndWait(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}
