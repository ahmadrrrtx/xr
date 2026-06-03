/**
 * XR — Text-to-Speech (local, free).
 *
 * Primary: Kokoro / Piper exposed over a small HTTP endpoint returning audio
 * bytes. If no TTS server is reachable, falls back to "silent mode" (returns
 * the text only) so voice never hard-crashes the agent. ("Never Breaks".)
 *
 * Voice personalities: calm / fast / detailed — control verbosity + rate.
 */
export type VoicePersona = "calm" | "fast" | "detailed";

export interface TtsOptions {
  baseUrl?: string;
  voice?: string;
  persona?: VoicePersona;
  fetchFn?: typeof fetch;
}

export interface TtsResult {
  ok: boolean;
  /** Audio bytes if synthesized, else null (silent fallback). */
  audio: Uint8Array | null;
  /** The (possibly persona-shaped) text that was spoken. */
  spokenText: string;
  detail?: string;
}

/** Shape text for the chosen persona before speaking. */
export function shapeForPersona(text: string, persona: VoicePersona): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (persona === "fast") {
    // Quick confirmations: first sentence only, capped.
    const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
    return first.slice(0, 160);
  }
  if (persona === "detailed") return t; // full text
  // calm (default): trim very long output to a digestible summary length.
  return t.length > 600 ? t.slice(0, 600) + "…" : t;
}

export class TextToSpeech {
  private baseUrl: string;
  private voice: string;
  private persona: VoicePersona;
  private f: typeof fetch;

  constructor(opts: TtsOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.XR_TTS_URL ?? "http://localhost:8081").replace(/\/$/, "");
    this.voice = opts.voice ?? process.env.XR_TTS_VOICE ?? "kokoro";
    this.persona = opts.persona ?? "calm";
    this.f = opts.fetchFn ?? fetch;
  }

  setPersona(p: VoicePersona): void {
    this.persona = p;
  }

  async speak(text: string): Promise<TtsResult> {
    const spokenText = shapeForPersona(text, this.persona);
    try {
      const res = await this.f(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: spokenText, voice: this.voice }),
      });
      if (!res.ok) return { ok: false, audio: null, spokenText, detail: `TTS HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, audio: buf, spokenText };
    } catch (e) {
      // Silent fallback — caller can still show/log the text.
      return { ok: false, audio: null, spokenText, detail: (e as Error).message };
    }
  }
}
