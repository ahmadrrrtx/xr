/**
 * XR Stage 8 — Speech-to-Text adapters.
 *
 * Default policy is local-first.  Cloud STT only runs when the user explicitly
 * selects a cloud backend or enables allowCloudStt in config/environment.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { VoiceSettings, VoiceSttBackend } from "./types.ts";

export interface SttOptions {
  backend?: VoiceSttBackend | "local";
  baseUrl?: string;
  model?: string;
  language?: string;
  apiKeyEnv?: string;
  allowCloud?: boolean;
  fetchFn?: typeof fetch;
}

export interface SttResult {
  ok: boolean;
  text: string;
  detail?: string;
  backend: string;
  language?: string;
  confidence?: number;
}

function commandExists(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return r.status === 0;
}

function run(cmd: string, args: string[], timeoutMs: number): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? null };
}

function normalizeBackend(b?: VoiceSttBackend | "local"): VoiceSttBackend {
  if (b === "local") return "auto";
  return b ?? "auto";
}

export function sttFromSettings(settings: VoiceSettings, fetchFn?: typeof fetch): SpeechToText {
  return new SpeechToText({
    backend: settings.sttBackend,
    baseUrl: settings.sttUrl,
    model: settings.sttModel,
    language: settings.sttLanguage,
    allowCloud: settings.allowCloudStt,
    fetchFn,
  });
}

export class SpeechToText {
  private backend: VoiceSttBackend;
  private baseUrl: string;
  private model: string;
  private language?: string;
  private apiKeyEnv?: string;
  private allowCloud: boolean;
  private injectedFetch?: typeof fetch;

  constructor(opts: SttOptions = {}) {
    this.backend = normalizeBackend(opts.backend);
    this.baseUrl = (opts.baseUrl ?? process.env.XR_STT_URL ?? "http://localhost:8080").replace(/\/$/, "");
    this.model = opts.model ?? process.env.XR_STT_MODEL ?? "base.en";
    this.language = opts.language ?? process.env.XR_STT_LANGUAGE;
    this.apiKeyEnv = opts.apiKeyEnv;
    this.allowCloud = opts.allowCloud ?? process.env.XR_VOICE_ALLOW_CLOUD_STT === "1";
    this.injectedFetch = opts.fetchFn;
  }

  describe(): { backend: VoiceSttBackend; model: string; baseUrl?: string; available: boolean; detail: string } {
    const selected = this.selectBackend();
    return {
      backend: selected.backend,
      model: this.model,
      baseUrl: selected.backend === "http" ? this.baseUrl : undefined,
      available: selected.available,
      detail: selected.detail,
    };
  }

  async transcribe(audio: Uint8Array, mime = "audio/wav"): Promise<SttResult> {
    const selected = this.selectBackend();
    if (!selected.available) return { ok: false, text: "", backend: selected.backend, detail: selected.detail };

    if (selected.backend === "http" || selected.backend === "groq" || selected.backend === "openai") {
      return this.transcribeHttp(selected.backend, audio, mime);
    }
    if (selected.backend === "whisper-cli") return this.transcribeWhisperCli(audio);
    if (selected.backend === "whispercpp") return this.transcribeWhisperCpp(audio);
    return { ok: false, text: "", backend: selected.backend, detail: "STT disabled" };
  }

  private selectBackend(): { backend: VoiceSttBackend; available: boolean; detail: string } {
    if (this.injectedFetch) return { backend: this.backend === "auto" ? "http" : this.backend, available: true, detail: "test fetch injected" };
    if (this.backend === "disabled") return { backend: "disabled", available: false, detail: "STT disabled" };
    if (this.backend === "whisper-cli") return { backend: "whisper-cli", available: commandExists("whisper"), detail: commandExists("whisper") ? "whisper CLI found" : "Install openai-whisper CLI" };
    if (this.backend === "whispercpp") {
      const cmd = this.whisperCppCommand();
      return { backend: "whispercpp", available: !!cmd, detail: cmd ? `${cmd} found` : "Install whisper.cpp (whisper-cli/main)" };
    }
    if (this.backend === "groq" || this.backend === "openai") {
      if (!this.allowCloud) return { backend: this.backend, available: false, detail: "cloud STT is not enabled; run xr voice setup and explicitly allow it" };
      const key = this.apiKeyFor(this.backend);
      return { backend: this.backend, available: !!key, detail: key ? "cloud key present" : `missing ${this.backend === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY"}` };
    }
    if (this.backend === "http") return { backend: "http", available: true, detail: `HTTP STT at ${this.baseUrl}` };

    if (commandExists("whisper")) return { backend: "whisper-cli", available: true, detail: "whisper CLI found" };
    const cpp = this.whisperCppCommand();
    if (cpp) return { backend: "whispercpp", available: true, detail: `${cpp} found` };
    if (process.env.XR_STT_URL) return { backend: "http", available: true, detail: `HTTP STT at ${this.baseUrl}` };
    return { backend: "http", available: true, detail: `HTTP STT at ${this.baseUrl}` };
  }

  private async transcribeHttp(backend: VoiceSttBackend, audio: Uint8Array, mime: string): Promise<SttResult> {
    try {
      const fetcher = this.injectedFetch ?? fetch;
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), "audio.wav");
      form.append("model", backend === "http" ? (process.env.XR_STT_MODEL ?? this.model) : this.cloudModel(backend));
      if (this.language) form.append("language", this.language);

      let url = `${this.baseUrl}/v1/audio/transcriptions`;
      const headers: Record<string, string> = {};
      if (backend === "groq") {
        url = "https://api.groq.com/openai/v1/audio/transcriptions";
        headers.Authorization = `Bearer ${this.apiKeyFor("groq")}`;
      } else if (backend === "openai") {
        url = "https://api.openai.com/v1/audio/transcriptions";
        headers.Authorization = `Bearer ${this.apiKeyFor("openai")}`;
      }

      const res = await fetcher(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(45000) });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, text: "", backend, detail: `HTTP ${res.status}${txt ? ` ${txt.slice(0, 160)}` : ""}` };
      }
      const json: any = await res.json();
      return { ok: true, text: String(json.text ?? "").trim(), backend, language: json.language };
    } catch (e) {
      return { ok: false, text: "", backend, detail: (e as Error).message };
    }
  }

  private transcribeWhisperCli(audio: Uint8Array): SttResult {
    const dir = mkdtempSync(join(tmpdir(), "xr-stt-"));
    const wav = join(dir, "input.wav");
    writeFileSync(wav, audio);
    try {
      const args = [wav, "--model", this.model, "--output_format", "txt", "--output_dir", dir];
      if (this.language) args.push("--language", this.language);
      const r = run("whisper", args, 120000);
      if (!r.ok) return { ok: false, text: "", backend: "whisper-cli", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      const txtPath = join(dir, "input.txt");
      const text = readFileSync(txtPath, "utf8").trim();
      return { ok: !!text, text, backend: "whisper-cli", detail: text ? undefined : "empty transcript" };
    } catch (e) {
      return { ok: false, text: "", backend: "whisper-cli", detail: (e as Error).message };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private transcribeWhisperCpp(audio: Uint8Array): SttResult {
    const cmd = this.whisperCppCommand();
    if (!cmd) return { ok: false, text: "", backend: "whispercpp", detail: "whisper.cpp command not found" };
    const dir = mkdtempSync(join(tmpdir(), "xr-sttcpp-"));
    const wav = join(dir, "input.wav");
    writeFileSync(wav, audio);
    try {
      const modelPath = process.env.XR_WHISPERCPP_MODEL ?? this.model;
      const args = ["-m", modelPath, "-f", wav, "-otxt", "-of", join(dir, "out")];
      if (this.language) args.push("-l", this.language);
      const r = run(cmd, args, 120000);
      if (!r.ok) return { ok: false, text: "", backend: "whispercpp", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      const text = readFileSync(join(dir, "out.txt"), "utf8").trim();
      return { ok: !!text, text, backend: "whispercpp", detail: text ? undefined : "empty transcript" };
    } catch (e) {
      return { ok: false, text: "", backend: "whispercpp", detail: (e as Error).message };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private whisperCppCommand(): string | null {
    for (const cmd of [process.env.XR_WHISPERCPP_BIN, "whisper-cli", "main", "whisper-cpp"].filter(Boolean) as string[]) {
      if (commandExists(cmd)) return cmd;
    }
    return null;
  }

  private cloudModel(backend: VoiceSttBackend): string {
    if (backend === "groq") return process.env.XR_GROQ_STT_MODEL ?? "whisper-large-v3-turbo";
    if (backend === "openai") return process.env.XR_OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe";
    return this.model;
  }

  private apiKeyFor(backend: VoiceSttBackend): string {
    const env = this.apiKeyEnv ?? (backend === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY");
    return process.env[env] ?? "";
  }
}
