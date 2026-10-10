/**
 * Phase 23 — the coding agent's system prompt. Short on purpose: the model should
 * spend its budget on the task, not on policy prose (approvals are enforced by the
 * engine and the terminal, not by the prompt).
 */
import type { ProjectContext } from "./context.ts";

export const CODER_BASE_PROMPT = [
  "You are xr, a coding agent running in the user's terminal. You edit files and run commands to achieve the user's task.",
  "You prefer reading before editing: locate code with search_code, read the relevant files, then change them.",
  "write_file replaces a whole file, so send the complete new content and keep unrelated lines unchanged.",
  "Every write and every shell command needs the user's approval; if an action is denied, do not retry it unchanged, adapt or explain.",
  "You are concise. When done, summarize what you changed and what you verified, in a few short sentences.",
].join("\n");

export interface PromptParts {
  readonly base: string;
  readonly projectRules?: string;
  readonly projectContext?: string;
}

/** Assemble the system prompt for a session from the project context. */
export function buildSystemPrompt(ctx: ProjectContext | null, extraRules?: string): string {
  const sections: string[] = [CODER_BASE_PROMPT];
  const rules = ctx?.rules;
  if (rules) {
    sections.push(`## Project rules (from ${rules.source})\n${rules.text.trim()}`);
  }
  if (extraRules?.trim()) sections.push(`## Session rules\n${extraRules.trim()}`);

  if (ctx) {
    const lines: string[] = [];
    lines.push(`Working directory: ${ctx.cwd}`);
    if (ctx.project.kinds.length) lines.push(`Project type: ${ctx.project.kinds.join(", ")}${ctx.project.name ? ` (${ctx.project.name})` : ""}`);
    if (ctx.project.scripts.length) lines.push(`Scripts: ${ctx.project.scripts.join(" · ")}`);
    if (ctx.git) {
      lines.push(`Git branch: ${ctx.git.branch}`);
      if (ctx.git.status.length) lines.push(`Uncommitted changes:\n${ctx.git.status.join("\n")}`);
    }
    if (ctx.repo) {
      const label = ctx.repo.mode === "tree" ? `Files (${ctx.repo.total}):` : `Top-level layout (${ctx.repo.total} files, use list_dir for detail):`;
      lines.push(`${label}\n${ctx.repo.text}`);
      if (ctx.repo.languages.length) {
        lines.push(`Languages: ${ctx.repo.languages.map((l) => `${l.ext} ${l.count}`).join(", ")}`);
      }
    }
    sections.push(`## Project context\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
