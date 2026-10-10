/**
 * Server-Sent Events parser for the daemon's chat stream.
 *
 * The daemon writes `data: {json}` frames separated by blank lines, sends
 * `: keepalive` comments while a model warms up, and ends with `data: [DONE]`.
 * Comments and other fields never reach the caller.
 */

export interface SseParser {
  /** Feed a decoded chunk. Returns the `data:` payloads it completed. */
  push(chunk: string): string[];
  /** Flush a trailing line that had no newline (end of stream). */
  end(): string[];
}

/** One line → its `data:` payload, or null for comments, blanks and other fields. */
export function parseSseLine(line: string): string | null {
  if (!line) return null;
  if (line.startsWith(":")) return null;
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5);
  return payload.startsWith(" ") ? payload.slice(1) : payload;
}

export function createSseParser(): SseParser {
  let buffer = "";

  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      const payload = parseSseLine(line);
      if (payload !== null) out.push(payload);
    }
    if (final && buffer.length > 0) {
      const payload = parseSseLine(buffer.replace(/\r$/, ""));
      buffer = "";
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
