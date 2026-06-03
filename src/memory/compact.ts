/**
 * XR — smart context compaction.
 * When the running conversation grows past a threshold, fold the OLDEST turns
 * into a compact structured summary and drop the raw text. The model never sees
 * a bloated context → directly serves the spend-ceiling architecture.
 *
 * Deterministic (no model call): keeps the most recent N messages verbatim,
 * summarizes the rest into bullet notes. (Block 4 / TRD cost layer.)
 */
import type { Message } from "../core/types.ts";

export interface CompactOptions {
  /** Approx char budget before we compact. */
  maxChars?: number;
  /** How many of the most recent messages to always keep verbatim. */
  keepRecent?: number;
}

export function totalChars(messages: Message[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}

/**
 * Returns a possibly-compacted message list. If under budget, returns as-is.
 * Otherwise: [system?, summaryNote, ...recent].
 */
export function compact(messages: Message[], opts: CompactOptions = {}): Message[] {
  const maxChars = opts.maxChars ?? 16000;
  const keepRecent = opts.keepRecent ?? 6;

  if (totalChars(messages) <= maxChars || messages.length <= keepRecent + 1) {
    return messages;
  }

  // Preserve a leading system message if present.
  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? [messages[0]] : [];
  const rest = hasSystem ? messages.slice(1) : messages;

  const recent = rest.slice(-keepRecent);
  const older = rest.slice(0, -keepRecent);

  const summary = summarize(older);
  const note: Message = {
    role: "system",
    content: `[context summary of ${older.length} earlier messages]\n${summary}`,
  };

  return [...system, note, ...recent];
}

/** Deterministic bullet summary of older messages. */
function summarize(older: Message[]): string {
  const bullets: string[] = [];
  for (const m of older) {
    const oneLine = m.content.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!oneLine) continue;
    const tag =
      m.role === "tool" ? `tool(${m.name ?? "?"})` : m.role === "assistant" ? "agent" : m.role;
    bullets.push(`- ${tag}: ${oneLine}`);
  }
  // Cap the summary itself so it can't balloon.
  return bullets.slice(0, 30).join("\n");
}
