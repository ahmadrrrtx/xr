/*
 * SSE reader for the engine's `data:` framing (Phase 14).
 *
 * The chat route emits `data: {json}` frames separated by blank lines, a
 * `: keepalive` comment every 5 s while a slow model warms up, and a final
 * `data: [DONE]`. Comments and blank lines are protocol noise and never reach
 * the consumer; anything else is handed over as the raw payload string.
 *
 * `parseSseLines` is pure (tested); `readSse` drives a fetch body through it.
 */

export interface SseParser {
  /** Feed a decoded chunk; returns the payloads completed by it. */
  push(chunk: string): string[];
  /** Flush a trailing line without a newline (stream ended). */
  end(): string[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      const payload = parseSseLine(line);
      if (payload !== null) out.push(payload);
    }
    if (final && buffer.length > 0) {
      const payload = parseSseLine(buffer.replace(/\r$/, ''));
      buffer = '';
      if (payload !== null) out.push(payload);
    }
    return out;
  };
  return {
    push: (chunk) => {
      buffer += chunk;
      return drain(false);
    },
    end: () => drain(true),
  };
}

/** One line → its `data:` payload, or null for comments/blank/other fields. */
export function parseSseLine(line: string): string | null {
  if (!line) return null;
  if (line.startsWith(':')) return null; // comment / keepalive
  if (!line.startsWith('data:')) return null; // event:/id:/retry: unused by the engine
  const payload = line.slice(5);
  return payload.startsWith(' ') ? payload.slice(1) : payload;
}

/** Convenience for tests and buffered bodies. */
export function parseSseLines(text: string): string[] {
  const p = createSseParser();
  return [...p.push(text), ...p.end()];
}

/**
 * Pump a streaming response. Resolves when the body ends; `onPayload` gets
 * every `data:` payload including the literal `[DONE]`. Aborting `signal`
 * cancels the reader (which is what cancels the run on the engine side).
 */
export async function readSse(
  res: Response,
  onPayload: (payload: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const p of parser.push(decoder.decode(value, { stream: true }))) onPayload(p);
    }
    for (const p of parser.end()) onPayload(p);
  } finally {
    signal?.removeEventListener('abort', cancel);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
