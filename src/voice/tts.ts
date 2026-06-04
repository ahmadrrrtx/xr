/**
 * XR — Text-to-Speech (local, free).
 * 
 * Multi-tier approach:
 *   Tier 1: Kokoro/Piper HTTP server — high quality, audio bytes
 *   Tier 2: System TTS (say/espeak/PowerShell) — no setup needed
 *   Tier 3: Cloud TTS — fallback with user API key
 * 
 * Voice personalities: calm / fast / detailed — control verbosity + rate.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type VoicePersona = "calm" | "fast" | "detailed";

export interface TtsOptions {
  /** TTS engine: "http" (Kokoro) | "system" | "auto" */
  engine?: "http" | "system" | "auto";
  /** Base URL for Kokoro/Piper HTTP server */
  baseUrl?: string;
  /** Kokoro voice name */
  voice?: string;
  /** System voice name (platform-specific) */
  systemVoice?: string;
  persona?: VoicePersona;
  /** Injected fetch for tests */
  fetchFn?: typeof fetch;
}

export interface TtsResult {
  ok: boolean;
  /** Audio bytes if synthesized, else null. */
  audio: Uint8Array | null;
  /** The (possibly persona-shaped) text that was spoken. */
  spokenText: string;
  /** Which engine was used */
  engine: "http" | "system" | "none";
  detail?: string;
}

/** Shape text for the chosen persona before speaking. */
export function shapeForPersona(text: string, persona: VoicePersona): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (persona === "fast") {
    const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
    return first.slice(0, 160);
  }
  if (persona === "detailed") return t;
  return t.length > 600 ? t.slice(0, 600) + "…" : t;
}

export class TextToSpeech {
  private engine: "http" | "system" | "auto";
  private baseUrl: string;
  private voice: string;
  private systemVoice: string;
  private persona: VoicePersona;
  private injectedFetch?: typeof fetch;

  constructor(opts: TtsOptions = {}) {
    this.engine = opts.engine ?? "auto";
    this.baseUrl = (opts.baseUrl ?? process.env.XR_TTS_URL ?? "http://localhost:8081").replace(/\/$/, "");
    this.voice = opts.voice ?? process.env.XR_TTS_VOICE ?? "kokoro";
    this.systemVoice = opts.systemVoice ?? process.env.XR_TTS_VOICE ?? "";
    this.persona = opts.persona ?? "calm";
    this.injectedFetch = opts.fetchFn; // Allow test injection
  }

  setPersona(p: VoicePersona): void {
    this.persona = p;
  }

  async speak(text: string): Promise<TtsResult> {
    const spokenText = shapeForPersona(text, this.persona);

    // Try HTTP TTS first (if fetchFn available or URL is configured)
    if (this.engine === "http" || this.engine === "auto") {
      if (this.injectedFetch || process.env.XR_TTS_URL) {
        const httpResult = await this.speakHttp(spokenText);
        if (httpResult.ok) return httpResult;
      }
    }

    // Try system TTS
    if (this.engine === "system" || this.engine === "auto") {
      const sysResult = await this.speakSystem(spokenText);
      if (sysResult.ok) return sysResult;
    }

    // No TTS available
    return { ok: false, audio: null, spokenText, engine: "none", detail: "no TTS available" };
  }

  /** Use Kokoro/Piper HTTP server (or any TTS server with /tts endpoint) */
  private async speakHttp(text: string): Promise<TtsResult> {
    try {
      const fetcher = this.injectedFetch ?? fetch;
      const res = await fetcher(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { ok: false, audio: null, spokenText: text, engine: "http", detail: `HTTP ${res.status}` };
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, audio: buf, spokenText: text, engine: "http" };
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "http", detail: (e as Error).message };
    }
  }

  /** Use system TTS: say (macOS), espeak (Linux), PowerShell (Windows) */
  private async speakSystem(text: string): Promise<TtsResult> {
    const platform = process.platform;

    try {
      if (platform === "darwin") {
        const voice = this.systemVoice ? `-v ${this.systemVoice}` : "";
        await execAsync(`say ${voice} "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 });
        return { ok: true, audio: null, spokenText: text, engine: "system" };

      } else if (platform === "linux") {
        try {
          await execAsync("which espeak", { timeout: 3000 });
          const voice = this.systemVoice ? `-v ${this.systemVoice}` : "";
          await execAsync(`espeak ${voice} -w /tmp/xr_tts.wav "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 });
          return { ok: true, audio: null, spokenText: text, engine: "system" };
        } catch {
          try {
            await execAsync("which festival", { timeout: 3000 });
            await execAsync(`echo "${text.replace(/"/g, '\\"')}" | festival --tts`, { timeout: 30000 });
            return { ok: true, audio: null, spokenText: text, engine: "system" };
          } catch {
            return { ok: false, audio: null, spokenText: text, engine: "system", detail: "no system TTS" };
          }
        }

      } else if (platform === "win32") {
        const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("${text.replace(/"/g, '`"').replace(/\n/g, ' ')}")`;
        await execAsync(`powershell -ExecutionPolicy Bypass -Command "${ps}"`, { timeout: 30000 });
        return { ok: true, audio: null, spokenText: text, engine: "system" };
      }
    } catch (e) {
      return { ok: false, audio: null, spokenText: text, engine: "system", detail: (e as Error).message };
    }

    return { ok: false, audio: null, spokenText: text, engine: "system", detail: "unsupported platform" };
  }
}
