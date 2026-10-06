/*
 * Progressive envelope decoder (Phase 14).
 *
 * Local/weak model profiles speak the engine's JSON envelope protocol: the
 * model's content is `{"message": "...", "tool_calls": [...], "done": true}`
 * and the engine extracts `message` only when the turn is complete
 * (`done.fullText`). Streaming the raw tokens would show the user a JSON
 * document being typed. Native function-calling providers stream plain words.
 *
 * This decoder is deliberately conservative:
 *   · text that does not start with `{` is shown verbatim (native path);
 *   · once `{ … "message": "` has been seen, only the decoded string value is
 *     shown, escape by escape, stopping at the closing quote;
 *   · a `{` prefix whose `message` key has not appeared yet shows nothing —
 *     the status line ("Waiting for …") covers that moment;
 *   · if the text starts with `{` but does not look like JSON within a few
 *     characters (prose such as "{draft} …"), it is shown verbatim.
 *
 * `done.fullText` always replaces the streamed preview, so a wrong guess here
 * can only ever affect the in-flight preview, never the persisted message.
 */

const MESSAGE_KEY = /"message"\s*:\s*"/;

export function visibleText(raw: string): string {
  const lead = raw.length - raw.trimStart().length;
  const t = lead ? raw.slice(lead) : raw;
  if (!t.startsWith('{')) return raw;
  // Prose that merely begins with a brace: no quote in the first characters.
  const head = t.slice(1, 12);
  if (head.length >= 8 && !head.includes('"')) return raw;
  const m = MESSAGE_KEY.exec(t);
  if (!m) return '';
  return decodeJsonStringPrefix(t.slice(m.index + m[0].length));
}

/** Decode the body of a JSON string up to (not including) its closing quote. */
export function decodeJsonStringPrefix(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') break;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) break; // dangling backslash — wait for the next token
    switch (n) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case '"':
      case '\\':
      case '/':
        out += n;
        break;
      case 'u': {
        const hex = s.slice(i + 2, i + 6);
        if (hex.length < 4) return out; // incomplete escape — wait
        if (/^[0-9a-fA-F]{4}$/.test(hex)) out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += n; // lenient: unknown escape, keep the char
    }
    i += 1;
  }
  return out;
}

/** Stateful convenience for a streaming turn. */
export class EnvelopeDecoder {
  private raw = '';
  push(token: string): string {
    this.raw += token;
    return visibleText(this.raw);
  }
  get text(): string {
    return this.raw;
  }
  /** True when the stream is (so far) an envelope rather than plain text. */
  get isEnvelope(): boolean {
    const t = this.raw.trimStart();
    return t.startsWith('{') && visibleText(this.raw) !== this.raw;
  }
}
