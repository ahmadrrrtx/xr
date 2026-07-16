/**
 * XR Stage 8 — Speech-to-Text adapters (async, non-blocking).
 *
 * Default policy is local-first. Cloud STT only runs when the user explicitly
 * selects a cloud backend or enables allowCloudStt in config/environment.
 *
 * Whisper CLI / whisper.cpp invocations use async spawn so the daemon never
 * freezes during multi-minute transcriptions.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VoiceSettings, VoiceSttBackend } from "./types.ts";
import { commandExists, runCommand } from "../util/process.ts";
import { mkdtempPath, readText, removePath, writeBytes } from "../util/fs-async.ts";
import { voiceIoLimit } from "../util/concurrency.ts";

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
  private backendCache: { backend: VoiceSttBackend; available: boolean; detail: string; at: number } | null = null;

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
    if (this.backendCache && Date.now() - this.backendCache.at < 30_000) {
      return {
        backend: this.backendCache.backend,
        model: this.model,
        baseUrl: this.backendCache.backend === "http" ? this.baseUrl : undefined,
        available: this.backendCache.available,
        detail: this.backendCache.detail,
      };
    }
    if (this.injectedFetch) {
      return {
        backend: this.backend === "auto" ? "http" : this.backend,
        model: this.model,
        baseUrl: this.baseUrl,
        available: true,
        detail: "test fetch injected",
      };
    }
    return {
      backend: this.backend,
      model: this.model,
      baseUrl: this.backend === "http" ? this.baseUrl : undefined,
      available: true,
      detail: "run transcribe() / describeAsync() for live probe",
    };
  }

  async describeAsync(): Promise<{ backend: VoiceSttBackend; model: string; baseUrl?: string; available: boolean; detail: string }> {
    const selected = await this.selectBackend();
    return {
      backend: selected.backend,
      model: this.model,
      baseUrl: selected.backend === "http" ? this.baseUrl : undefined,
      available: selected.available,
      detail: selected.detail,
    };
  }

  async transcribe(audio: Uint8Array, mime = "audio/wav"): Promise<SttResult> {
    return voiceIoLimit.run(async () => {
      const selected = await this.selectBackend();
      if (!selected.available) return { ok: false, text: "", backend: selected.backend, detail: selected.detail };

      if (selected.backend === "http" || selected.backend === "groq" || selected.backend === "openai") {
        return this.transcribeHttp(selected.backend, audio, mime);
      }
      if (selected.backend === "whisper-cli") return this.transcribeWhisperCli(audio);
      if (selected.backend === "whispercpp") return this.transcribeWhisperCpp(audio);
      return { ok: false, text: "", backend: selected.backend, detail: "STT disabled" };
    });
  }

  private async selectBackend(): Promise<{ backend: VoiceSttBackend; available: boolean; detail: string }> {
    if (this.backendCache && Date.now() - this.backendCache.at < 30_000 && this.backend === "auto") {
      return this.backendCache;
    }

    let selected: { backend: VoiceSttBackend; available: boolean; detail: string };

    if (this.injectedFetch) {
      selected = { backend: this.backend === "auto" ? "http" : this.backend, available: true, detail: "test fetch injected" };
    } else if (this.backend === "disabled") {
      selected = { backend: "disabled", available: false, detail: "STT disabled" };
    } else if (this.backend === "whisper-cli") {
      const ok = await commandExists("whisper");
      selected = { backend: "whisper-cli", available: ok, detail: ok ? "whisper CLI found" : "Install openai-whisper CLI" };
    } else if (this.backend === "whispercpp") {
      const cmd = await this.whisperCppCommand();
      selected = { backend: "whispercpp", available: !!cmd, detail: cmd ? `${cmd} found` : "Install whisper.cpp (whisper-cli/main)" };
    } else if (this.backend === "groq" || this.backend === "openai") {
      if (!this.allowCloud) {
        selected = { backend: this.backend, available: false, detail: "cloud STT is not enabled; run xr voice setup and explicitly allow it" };
      } else {
        const key = this.apiKeyFor(this.backend);
        selected = { backend: this.backend, available: !!key, detail: key ? "cloud key present" : `missing ${this.backend === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY"}` };
      }
    } else if (this.backend === "http") {
      selected = { backend: "http", available: true, detail: `HTTP STT at ${this.baseUrl}` };
    } else if (await commandExists("whisper")) {
      selected = { backend: "whisper-cli", available: true, detail: "whisper CLI found" };
    } else {
      const cpp = await this.whisperCppCommand();
      if (cpp) selected = { backend: "whispercpp", available: true, detail: `${cpp} found` };
      else if (process.env.XR_STT_URL) selected = { backend: "http", available: true, detail: `HTTP STT at ${this.baseUrl}` };
      else {
        selected = {
          backend: "auto",
          available: false,
          detail: "No local STT found. Install whisper CLI / whisper.cpp, or configure XR_STT_URL for a local STT endpoint.",
        };
      }
    }

    this.backendCache = { ...selected, at: Date.now() };
    return selected;
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

  private async transcribeWhisperCli(audio: Uint8Array): Promise<SttResult> {
    const dir = await mkdtempPath(join(tmpdir(), "xr-stt-"));
    const wav = join(dir, "input.wav");
    await writeBytes(wav, audio);
    try {
      const args = [wav, "--model", this.model, "--output_format", "txt", "--output_dir", dir];
      if (this.language) args.push("--language", this.language);
      const r = await runCommand("whisper", args, { timeoutMs: 120000 });
      if (!r.ok) return { ok: false, text: "", backend: "whisper-cli", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      const txtPath = join(dir, "input.txt");
      const text = (await readText(txtPath)).trim();
      return { ok: !!text, text, backend: "whisper-cli", detail: text ? undefined : "empty transcript" };
    } catch (e) {
      return { ok: false, text: "", backend: "whisper-cli", detail: (e as Error).message };
    } finally {
      await removePath(dir, { recursive: true, force: true });
    }
  }

  private async transcribeWhisperCpp(audio: Uint8Array): Promise<SttResult> {
    const cmd = await this.whisperCppCommand();
    if (!cmd) return { ok: false, text: "", backend: "whispercpp", detail: "whisper.cpp command not found" };
    const dir = await mkdtempPath(join(tmpdir(), "xr-sttcpp-"));
    const wav = join(dir, "input.wav");
    await writeBytes(wav, audio);
    try {
      const modelPath = process.env.XR_WHISPERCPP_MODEL ?? this.model;
      const args = ["-m", modelPath, "-f", wav, "-otxt", "-of", join(dir, "out")];
      if (this.language) args.push("-l", this.language);
      const r = await runCommand(cmd, args, { timeoutMs: 120000 });
      if (!r.ok) return { ok: false, text: "", backend: "whispercpp", detail: r.stderr.slice(0, 300) || `exit ${r.status}` };
      const text = (await readText(join(dir, "out.txt"))).trim();
      return { ok: !!text, text, backend: "whispercpp", detail: text ? undefined : "empty transcript" };
    } catch (e) {
      return { ok: false, text: "", backend: "whispercpp", detail: (e as Error).message };
    } finally {
      await removePath(dir, { recursive: true, force: true });
    }
  }

  private async whisperCppCommand(): Promise<string | null> {
    for (const cmd of [process.env.XR_WHISPERCPP_BIN, "whisper-cli", "main", "whisper-cpp"].filter(Boolean) as string[]) {
      if (await commandExists(cmd)) return cmd;
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
