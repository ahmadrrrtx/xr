/**
 * XR — Speech-to-Text (local, private).
 *
 * Primary: a local Whisper server (whisper.cpp / faster-whisper) exposing an
 * OpenAI-compatible /audio/transcriptions endpoint. Optional: Groq's free
 * Whisper (BYO key) for zero-setup. All audio stays local unless the user
 * explicitly configures a cloud STT.
 *
 * Endpoints are configurable; the transport is dependency-free (fetch + FormData).
 */
export interface SttOptions {
  /** Base URL of an OpenAI-compatible transcription server. */
  baseUrl?: string;
  /** Model name (server-defined). */
  model?: string;
  /** Optional bearer key (for cloud STT like Groq). */
  apiKeyEnv?: string;
  /** Injected fetch for tests. */
  fetchFn?: typeof fetch;
}

export interface SttResult {
  ok: boolean;
  text: string;
  detail?: string;
}

export class SpeechToText {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private f: typeof fetch;

  constructor(opts: SttOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.XR_STT_URL ?? "http://localhost:8080").replace(/\/$/, "");
    this.model = opts.model ?? process.env.XR_STT_MODEL ?? "whisper-1";
    this.apiKey = opts.apiKeyEnv ? process.env[opts.apiKeyEnv] : process.env.XR_STT_KEY;
    this.f = opts.fetchFn ?? fetch;
  }

  /** Transcribe raw audio bytes (wav/ogg/mp3) to text. */
  async transcribe(audio: Uint8Array, mime = "audio/wav"): Promise<SttResult> {
    try {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), "audio.wav");
      form.append("model", this.model);
      const headers: Record<string, string> = {};
      if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
      const res = await this.f(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!res.ok) return { ok: false, text: "", detail: `STT HTTP ${res.status}` };
      const json: any = await res.json();
      return { ok: true, text: String(json.text ?? "").trim() };
    } catch (e) {
      return { ok: false, text: "", detail: (e as Error).message };
    }
  }
}
