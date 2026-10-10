/**
 * Prompt templates for the editor actions (explain, fix, improve, add tests,
 * refactor). Pure: no VS Code imports, so the wording and the size caps are
 * covered by tests.
 */

export type ActionKind = "explain" | "fix" | "improve" | "addTests" | "refactor";

export interface CodeTarget {
  /** Workspace-relative file path. */
  file: string;
  languageId: string;
  startLine: number;
  endLine: number;
  code: string;
  /** Function, class or method name when the target is a symbol. */
  symbolName?: string;
}

export const MAX_CODE_CHARS = 12000;

const INSTRUCTIONS: Record<Exclude<ActionKind, "refactor">, string> = {
  explain:
    "Explain what this does. Keep it short: purpose, inputs and outputs, and anything risky. Refer to lines as path:line.",
  fix:
    "Find the bugs in this code and fix them. Show the corrected code in one fenced block, then list each change in one line.",
  improve:
    "Suggest concrete improvements for readability, correctness and performance. Show the improved code in one fenced block.",
  addTests:
    "Write unit tests for this code. Match the test style of this workspace if you can see it. Put the tests in one fenced block and name the file they belong in.",
};

export function buildActionPrompt(kind: ActionKind, target: CodeTarget, instruction?: string): string {
  const where = `${target.file}:${target.startLine}-${target.endLine}`;
  const subject = target.symbolName ? `\`${target.symbolName}\` (${where})` : `the selected code (${where})`;
  const task =
    kind === "refactor"
      ? `Refactor ${subject} as follows: ${(instruction ?? "").trim() || "improve its structure"}. Show the refactored code in one fenced block.`
      : `${capitalize(kind === "addTests" ? "Add tests for" : kind)} ${subject}. ${INSTRUCTIONS[kind]}`;
  return `${task}\n\n${codeFence(target)}`;
}

export function codeFence(target: CodeTarget): string {
  const code =
    target.code.length > MAX_CODE_CHARS ? target.code.slice(0, MAX_CODE_CHARS) + "\n// …truncated" : target.code;
  const lang = /^[a-z0-9+#.-]*$/i.test(target.languageId) ? target.languageId : "";
  return "```" + lang + "\n" + code + "\n```";
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
