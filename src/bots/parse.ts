/**
 * XR — command-line parsing shared by chat surfaces (Phase 26 shared layer).
 *
 * The three surfaces accept the same sentence ("refactor the auth module, keep
 * it under $0.50") and several prefixes (`/xr`, `xr`, `!`). This module owns
 * the parts that are identical everywhere; each surface keeps its own command
 * vocabulary and its own help text.
 *
 * Extracted from `telegram/commands.ts` in PR 2; that file re-exports
 * `extractBudget` so its importers are unchanged.
 */

/** Extract an inline budget like "under $0.50" / "$2 budget" / "max $1.5". */
export function extractBudget(text: string): number | undefined {
  const m = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

export interface PrefixCommand {
  /** Lower-cased command word, without the prefix and without "@botname". */
  command: string;
  /** Everything after the command word, trimmed. */
  arg: string;
}

/**
 * Parse a prefixed command line such as "/xr budget $2" or "xr stop".
 * Returns null when no prefix matches (the caller then treats the text as a
 * plain task). An empty command word ("/xr") parses to `{ command: "", arg }`.
 */
export function parsePrefixedCommand(text: string, prefixes: readonly string[]): PrefixCommand | null {
  const trimmed = (text ?? "").trim();
  for (const prefix of prefixes) {
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rest = trimmed.slice(prefix.length).trim();
    if (!rest) return { command: "", arg: "" };
    const [head, ...tail] = rest.split(/\s+/);
    // Telegram appends @botname in groups; harmless everywhere else.
    return { command: head.split("@")[0].toLowerCase(), arg: tail.join(" ").trim() };
  }
  return null;
}
