/**
 * XR — Speech-to-Text (local, private).
 * 
 * Multi-tier STT:
 *   Tier 1: Local Whisper server (faster-whisper / whisper.cpp)
 *   Tier 2: Groq Whisper API (free tier) — BYO key
 *   Tier 3: Browser Web Speech API (for web UI)
 * 
 * All audio stays local unless user explicitly opts into cloud STT.
 */
export interface SttOptions {
  /** STT backend: "http" (any OpenAI-compatible) | "groq" | "local" */
  backend?: "http" | "groq" | "local";
  /** Base URL for local Whisper server */
  baseUrl?: string;
  /** Model name */
  model?: string;
  /** API key env var name */
  apiKeyEnv?: string;
  /** Injected fetch for tests */
  fetchFn?: typeof fetch;
}

export interface SttResult {
  ok: boolean;
  text: string;
  detail?: string;
  backend: string;
}

export class SpeechToText {
  private backend: "http" | "groq" | "local";
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private injectedFetch?: typeof fetch;

  constructor(opts: SttOptions = {}) {
    this.backend = opts.backend ?? "http";
    this.baseUrl = (opts.baseUrl ?? process.env.XR_STT_URL ?? "http://localhost:8080").replace(/\/$/, "");
    this.model = opts.model ?? process.env.XR_STT_MODEL ?? "whisper-1";
    this.apiKey = opts.apiKeyEnv ? process.env[opts.apiKeyEnv] : (process.env.GROQ_API_KEY ?? "");
    this.injectedFetch = opts.fetchFn;
  }

  /** Transcribe raw audio bytes (wav/ogg/mp3) to text. */
  async transcribe(audio: Uint8Array, mime = "audio/wav"): Promise<SttResult> {
    return this.transcribeHttp(audio, mime);
  }

  private async transcribeHttp(audio: Uint8Array, mime: string): Promise<SttResult> {
    try {
      const fetcher = this.injectedFetch ?? fetch;
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), "audio.wav");
      form.append("model", this.model);

      let url: string;
      const headers: Record<string, string> = {};

      if (this.backend === "groq") {
        url = "https://api.groq.com/openai/v1/audio/transcriptions";
        if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else {
        url = `${this.baseUrl}/v1/audio/transcriptions`;
      }

      const res = await fetcher(url, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        try {
          const err = JSON.parse(txt);
          return { ok: false, text: "", backend: this.backend, detail: err.error?.message ?? `HTTP ${res.status}` };
        } catch {
          return { ok: false, text: "", backend: this.backend, detail: `HTTP ${res.status}` };
        }
      }

      const json: any = await res.json();
      return {
        ok: true,
        text: String(json.text ?? "").trim(),
        backend: this.backend,
      };
    } catch (e) {
      return { ok: false, text: "", backend: this.backend, detail: (e as Error).message };
    }
  }
}
