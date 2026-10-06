/**
 * Phase 14 — replayed chat history bounds (split out of agent.ts, which is
 * under the size waiver; see test/architecture/size-gate.test.ts).
 */
import type { Message } from "./types.ts";

/** Phase 14 — bounds for replayed chat history (newest turns win). */
const HISTORY_MAX_TURNS = 24;
const HISTORY_MAX_CHARS = 24_000;

/**
 * Keep the most recent prior turns that fit the bounds, dropping oldest
 * first; empty/non-chat roles are ignored. Never includes the current task.
 */
export function boundedHistory(
  history: ReadonlyArray<{ role: string; content: string }> | undefined,
): Message[] {
  if (!history?.length) return [];
  const out: Message[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && out.length < HISTORY_MAX_TURNS; i--) {
    const h = history[i]!;
    if (h.role !== "user" && h.role !== "assistant") continue;
    const content = typeof h.content === "string" ? h.content : "";
    if (!content.trim()) continue;
    if (chars + content.length > HISTORY_MAX_CHARS) break;
    chars += content.length;
    out.push({ role: h.role, content });
  }
  return out.reverse();
}
