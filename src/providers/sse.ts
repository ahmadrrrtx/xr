/** Bounded by guardedRequest's total byte ceiling and deadline. Correct SSE
 * framing across arbitrary TCP chunks (including CRLF and multi-line data). */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [];
  const lineData = (line: string): string | undefined => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") {
      const out = data.length ? data.join("\n") : undefined;
      data = [];
      return out;
    }
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    return undefined;
  };
  try {
    for (;;) {
      const c = await reader.read();
      buffer += c.done
        ? decoder.decode()
        : decoder.decode(c.value, { stream: true });
      let n: number;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const out = lineData(buffer.slice(0, n));
        buffer = buffer.slice(n + 1);
        if (out !== undefined) yield out;
      }
      if (c.done) {
        if (buffer) {
          const out = lineData(buffer);
          if (out !== undefined) yield out;
        }
        if (data.length) yield data.join("\n");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
