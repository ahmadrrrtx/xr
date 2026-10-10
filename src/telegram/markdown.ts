/**
 * XR — Telegram MarkdownV2 rendering and message splitting.
 *
 * Telegram rejects a whole message when one reserved character is unescaped,
 * so every model- or tool-controlled string goes through `escapeV2` before it
 * is sent with `parse_mode: "MarkdownV2"`. Code spans and fences only need
 * backtick and backslash escaped (Telegram's rule for `pre`/`code` entities).
 *
 * `splitForTelegram` splits RAW markdown first and keeps code fences balanced
 * across chunks, then renders each chunk. That way a long answer never ends
 * with a dangling ``` that would swallow the rest of the message.
 */

export const TELEGRAM_MAX_CHARS = 4096;

const PROSE_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const CODE_RESERVED = /[`\\]/g;

/** Escape arbitrary text for MarkdownV2 prose (no entities). */
export function escapeV2(text: string): string {
  return text.replace(PROSE_RESERVED, (c) => `\\${c}`);
}

/** Escape text placed inside a code span or fence. */
export function escapeCodeV2(text: string): string {
  return text.replace(CODE_RESERVED, (c) => `\\${c}`);
}

function renderProse(text: string): string {
  // **bold** becomes Telegram *bold*; everything else is escaped literally.
  const parts = text.split(/\*\*([^*\n]+?)\*\*/);
  return parts
    .map((part, i) => (i % 2 === 1 ? `*${escapeV2(part)}*` : escapeV2(part)))
    .join("");
}

/** Render model markdown into MarkdownV2 (fences, inline code, bold). */
export function renderMarkdownV2(raw: string): string {
  const out: string[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)(?:\n?```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) {
    out.push(renderInline(raw.slice(last, m.index)));
    const lang = m[1].trim().replace(/[^A-Za-z0-9_+-]/g, "");
    const body = m[2].replace(/\n$/, "");
    out.push("```" + lang + "\n" + escapeCodeV2(body) + "\n```");
    last = m.index + m[0].length;
  }
  out.push(renderInline(raw.slice(last)));
  return out.join("");
}

function renderInline(text: string): string {
  const parts = text.split(/`([^`\n]+)`/);
  return parts.map((p, i) => (i % 2 === 1 ? "`" + escapeCodeV2(p) + "`" : renderProse(p))).join("");
}

/**
 * Split raw markdown into chunks of at most `maxChars` raw characters.
 * A chunk that ends inside a ``` fence is closed, and the next chunk reopens
 * the fence with the same language tag.
 */
export function chunkMarkdown(raw: string, maxChars = 1500): string[] {
  const lines = raw.split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let fenceLang: string | null = null; // non-null while inside a fence
  const flush = () => {
    if (!cur.length) return;
    let body = cur.join("\n");
    if (fenceLang !== null) body += "\n```";
    chunks.push(body);
    cur = fenceLang !== null ? ["```" + fenceLang] : [];
    curLen = cur.length ? cur[0].length : 0;
  };
  for (let line of lines) {
    // Hard-split a single line that cannot fit on its own.
    while (line.length > maxChars) {
      if (curLen > 0) flush();
      cur.push(line.slice(0, maxChars));
      curLen += maxChars;
      line = line.slice(maxChars);
      flush();
    }
    if (curLen + line.length + 1 > maxChars && cur.length) flush();
    cur.push(line);
    curLen += line.length + 1;
    if (/^```/.test(line.trim())) {
      fenceLang = fenceLang === null ? line.trim().slice(3).trim() : null;
    }
  }
  if (cur.length) {
    let body = cur.join("\n");
    if (fenceLang !== null) body += "\n```";
    chunks.push(body);
  }
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Full pipeline: raw model text → MarkdownV2 chunks, each within Telegram's
 * 4096-character limit after escaping. A chunk that still renders too long
 * is halved and retried; a single line that cannot be rendered falls back to
 * unformatted text so nothing is dropped.
 */
export function splitForTelegram(raw: string, maxChars = 1500): string[] {
  const out: string[] = [];
  for (const chunk of chunkMarkdown(raw, maxChars)) {
    const rendered = renderMarkdownV2(chunk);
    if (rendered.length <= TELEGRAM_MAX_CHARS) {
      out.push(rendered);
      continue;
    }
    if (chunk.length <= 200) {
      out.push(escapeV2(chunk.slice(0, 3000)));
      continue;
    }
    out.push(...splitForTelegram(chunk, Math.floor(chunk.length / 2)));
  }
  return out;
}
