/**
 * Phase 23 — pure text for the coding agent: the banner, the per-turn summary and
 * the REPL help. No I/O here, so every line is unit-testable.
 */
import { homedir } from "node:os";
import type { Painter } from "./ansi.ts";
import type { TurnSummary } from "./turn.ts";

/** Home-relative display path (`~/src/app`). */
export function displayPath(cwd: string, home = homedir()): string {
  return home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
}

/** The startup banner: at most three lines, no logo, no jokes. */
export function bannerLines(modelLabel: string, cwd: string, p: Painter): string[] {
  return [
    `${p.bold("XR coding agent")} ${p.dim("·")} ${modelLabel} ${p.dim("·")} ${displayPath(cwd)}`,
    p.dim("Describe a task. /help for commands · Ctrl+C cancels a turn · Ctrl+D exits"),
  ];
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** One summary line after each turn: outcome, steps, edits and commands that ran, tokens. */
export function summaryLine(s: TurnSummary, p: Painter): string {
  const parts: string[] = [];
  parts.push(`${s.steps} step${s.steps === 1 ? "" : "s"}`);
  const edits = s.filesWritten.length;
  const commands = s.shellRuns;
  if (edits) parts.push(`${edits} edit${edits === 1 ? "" : "s"}`);
  if (commands) parts.push(`${commands} command${commands === 1 ? "" : "s"}`);
  if (s.inputTokens || s.outputTokens) {
    parts.push(`${compactNumber(s.inputTokens)} in / ${compactNumber(s.outputTokens)} out tokens`);
  }
  const detail = parts.join(" · ");
  switch (s.stopped) {
    case "done":
      return `${p.green("✓")} ${p.dim(detail)}`;
    case "cancelled":
      return `${p.yellow("!")} cancelled ${p.dim(`· ${detail}`)}`;
    case "approval":
      return `${p.yellow("!")} stopped: an approval was denied before the task finished ${p.dim(`· ${detail}`)}`;
    case "budget":
      return `${p.yellow("!")} stopped: budget reached ${p.dim(`· ${detail}`)}`;
    case "max_steps":
      return `${p.yellow("!")} stopped: step limit reached ${p.dim(`· ${detail}`)}`;
    default:
      return `${p.red("✗")} stopped: ${s.error ?? "error"} ${p.dim(`· ${detail}`)}`;
  }
}

/** Lines for `/help` inside the REPL. */
export const REPL_HELP: readonly string[] = [
  "/help           show this list",
  "/clear          forget this conversation",
  "/setup          run the first-run setup again",
  "/exit           leave (Ctrl+D also works)",
  "",
  "Mention files with @path, a folder with @dir/, or a range with @path:10-40.",
  "Approvals: edits y/n/a/d/v · shell y/n/a/d/k · a = allow this kind for the session.",
];
