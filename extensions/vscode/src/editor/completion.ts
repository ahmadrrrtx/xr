/**
 * Pure helpers for inline completions: the prompt and the output cleanup.
 * No VS Code imports, so they are unit tested directly.
 */

export const MAX_COMPLETION_CHARS = 600;
const MAX_COMPLETION_LINES = 8;

export function buildPrompt(languageId: string, file: string, before: string, after: string): string {
  return [
    "Complete the code at the cursor, marked <CURSOR>.",
    "Reply with only the text to insert at <CURSOR>. No prose, no code fences, no explanation.",
    "",
    `File: ${file} (${languageId})`,
    "```",
    `${before}<CURSOR>${after}`,
    "```",
  ].join("\n");
}

/** Strip code fences and cap the length, so a long answer never becomes ghost text. */
export function cleanCompletion(raw: string): string | null {
  let text = raw.replace(/^\s*```[a-zA-Z0-9+#.-]*\n?/, "").replace(/\n?```\s*$/, "");
  text = text.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (!text.trim()) return null;
  const lines = text.split("\n");
  if (lines.length > MAX_COMPLETION_LINES) text = lines.slice(0, MAX_COMPLETION_LINES).join("\n");
  return text.slice(0, MAX_COMPLETION_CHARS);
}
