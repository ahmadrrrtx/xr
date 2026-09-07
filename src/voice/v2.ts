/**
 * XR Phase 9 — Voice v2 helpers (behind config flags).
 *
 * Streaming STT partials, server-side VAD turn-taking, sentence-cadence TTS,
 * spoken status from the existing onStreamEvent vocabulary, barge-in that
 * cancels the RUN via A-19 AbortController.
 *
 * Wake remains transcript-regex; openWakeWord stays an external option.
 */
import type { ChatStreamEvent } from "../core/types.ts";
import { runStatusLabel, isRunStatus } from "../core/ux-status.ts";
import { analyzeVad, type TurnDetectionResult } from "./audio.ts";

export interface SttPartial {
  text: string;
  final: boolean;
}

/** Split assistant text into speakable sentences (cadence streaming). */
export function splitSentences(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [t];
}

/** Map a canonical stream event to a short spoken status line. */
export function spokenStatusLine(event: ChatStreamEvent): string | null {
  if (event.type !== "status") return null;
  const status = event.status;
  if (!isRunStatus(status)) return runStatusLabel(String(status), event.message);
  if (status === "generating" || status === "provider_ready" || status === "preparing") return null;
  return runStatusLabel(status, event.message);
}

/**
 * Server-side VAD over successive PCM/WAV frames. Replaces energy-only
 * endpointing when `voice.serverVad` is on.
 */
export class ServerVad {
  private speechMs = 0;
  private silenceMs = 0;
  private last: TurnDetectionResult | null = null;

  constructor(private readonly threshold = 0.012) {}

  push(frame: Uint8Array, frameMs = 30): { speech: boolean; turnComplete: boolean; analysis: TurnDetectionResult } {
    const analysis = analyzeVad(frame, { threshold: this.threshold, frameMs });
    this.last = analysis;
    if (analysis.hasSpeech) {
      this.speechMs += analysis.speechMs || frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }
    const turnComplete = this.speechMs >= 180 && this.silenceMs >= 650;
    return { speech: analysis.hasSpeech || this.speechMs > 0, turnComplete, analysis };
  }

  reset(): void {
    this.speechMs = 0;
    this.silenceMs = 0;
    this.last = null;
  }
}

/**
 * Adapter-shaped streaming STT: an HTTP endpoint that yields partials
 * (`{text, final}`) from a JSONL / SSE body. Batch `transcribe()` remains
 * the default when `voice.streamingStt` is off.
 */
export async function* transcribeStreaming(
  audio: Uint8Array,
  opts: { url: string; fetchFn?: typeof fetch; signal?: AbortSignal } = { url: "" },
): AsyncGenerator<SttPartial> {
  const fetcher = opts.fetchFn ?? fetch;
  const url = `${opts.url.replace(/\/$/, "")}/v1/audio/transcriptions/stream`;
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
  const res = await fetcher(url, { method: "POST", body: form, signal: opts.signal });
  if (!res.ok || !res.body) {
    yield { text: "", final: true };
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as { text?: string; final?: boolean };
        yield { text: String(json.text ?? "").trim(), final: Boolean(json.final) };
      } catch {
        /* ignore keep-alives */
      }
    }
  }
  if (buf.trim()) {
    try {
      const json = JSON.parse(buf) as { text?: string; final?: boolean };
      yield { text: String(json.text ?? "").trim(), final: true };
    } catch {
      yield { text: buf.trim(), final: true };
    }
  }
}
