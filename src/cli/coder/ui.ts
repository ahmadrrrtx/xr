/**
 * Output for the coder CLI. Two renderers share one interface:
 *
 *   TtyUI   — human output: streamed markdown, inline tool status lines,
 *             colored diffs, one-line approval prompts, a quiet summary.
 *   JsonUI  — JSON Lines (one event object per line) for `--json`, so editor
 *             integrations and scripts can drive the same agent.
 *
 * The session never writes to stdout itself; it only calls this interface.
 */

import { colorizeDiff, diffStats } from "./diff.ts";
import { MarkdownStream } from "./markdown.ts";
import { err, out, style, termWidth } from "./style.ts";
import { readChoice, type Terminal } from "./tty.ts";
import type { ActionKind, Decision } from "./permissions.ts";

export interface ApprovalInfo {
  kind: ActionKind;
  tool: string;
  /** The command, path, or URL the action targets. */
  subject: string;
  /** Unified diff for edits; empty otherwise. */
  preview: string;
  decision: Decision;
}

export interface TurnSummary {
  stopped: string;
  steps: number;
  filesChanged: string[];
  commands: string[];
  denied: number;
  autoDenied: number;
  inputTokens?: number;
  outputTokens?: number;
  meter?: string;
}

export interface CoderUI {
  readonly canPrompt: boolean;
  banner(lines: string[]): void;
  notice(message: string, level?: "info" | "warn" | "error"): void;
  thinking(): void;
  token(text: string): void;
  toolCall(id: string, tool: string, args: Record<string, unknown>): void;
  toolResult(id: string, tool: string, ok: boolean, text: string): void;
  approvalRequest(info: ApprovalInfo): void;
  promptApproval(info: ApprovalInfo, allowDiff: boolean): Promise<string>;
  diff(path: string, patch: string): void;
  summary(s: TurnSummary): void;
  endTurn(): void;
  /** Flush anything held back until the run ends (JSON summary). */
  finish?(): void;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

function statusLine(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case "read_file":
      return `read ${str(args.path)}`;
    case "list_dir":
      return `ls ${str(args.path) || "."}`;
    case "search_code":
      return `search "${str(args.pattern)}"${args.path ? ` ${str(args.path)}` : ""}`;
    case "fetch_url":
      return `↓ fetch ${str(args.url)}`;
    case "web_search":
      return `⌕ search "${str(args.query)}"`;
    default:
      return null; // edits and shell commands show their own approval block
  }
}

export class TtyUI implements CoderUI {
  private md: MarkdownStream;
  private spinner: NodeJS.Timeout | null = null;
  private frame = 0;
  private midLine = false;
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  /**
   * `statusToStderr`: when stdout is a pipe, answer text stays on stdout while
   * status lines, notices and tool activity go to stderr (so `xr -p … | cat`
   * prints only the answer).
   */
  constructor(
    private readonly term: Terminal | null,
    private readonly statusToStderr: boolean = false,
  ) {
    this.md = new MarkdownStream((text) => this.write(text, "answer"));
  }

  get canPrompt(): boolean {
    return this.term !== null && this.term.isTTY;
  }

  /** Stream text to stdout, or to stderr when stdout is reserved for a pipe. */
  private write(text: string, channel: "answer" | "status" = "status"): void {
    this.stopSpinner();
    if (channel === "status" && this.statusToStderr) process.stderr.write(text);
    else out(text);
    this.midLine = !text.endsWith("\n");
  }

  private line(text: string): void {
    if (this.midLine) this.write("\n");
    this.write(`${text}\n`);
  }

  banner(lines: string[]): void {
    for (const l of lines) this.line(style.dim(l));
  }

  notice(message: string, level: "info" | "warn" | "error" = "info"): void {
    if (level === "error") this.line(style.red(`✕ ${message}`));
    else if (level === "warn") this.line(style.yellow(`⚠ ${message}`));
    else this.line(style.dim(`› ${message}`));
  }

  thinking(): void {
    if (this.spinner || !process.stdout.isTTY || this.statusToStderr) return;
    this.spinner = setInterval(() => {
      this.frame = (this.frame + 1) % this.frames.length;
      process.stdout.write(`\r\x1b[2K${style.cyan(this.frames[this.frame]!)} ${style.dim("Thinking…")}`);
    }, 80);
  }

  private stopSpinner(): void {
    if (!this.spinner) return;
    clearInterval(this.spinner);
    this.spinner = null;
    process.stdout.write("\r\x1b[2K");
  }

  token(text: string): void {
    this.md.push(text);
  }

  toolCall(_id: string, tool: string, args: Record<string, unknown>): void {
    this.md.finish();
    const status = statusLine(tool, args);
    if (status) this.line(style.dim(status));
  }

  toolResult(_id: string, tool: string, ok: boolean, text: string): void {
    if (!ok) {
      this.line(style.red(`  ✕ ${tool}: ${text.split("\n")[0]?.slice(0, termWidth() - 6) ?? "failed"}`));
      return;
    }
    if (tool === "shell") {
      const lines = text.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
      const shown = lines.slice(-40);
      if (lines.length > shown.length) this.line(style.dim(`  … ${lines.length - shown.length} earlier lines hidden`));
      for (const l of shown) this.line(style.dim(`  ${l}`));
    }
  }

  approvalRequest(_info: ApprovalInfo): void {
    // The TTY prompt itself is the request; nothing to emit separately.
  }

  async promptApproval(info: ApprovalInfo, allowDiff: boolean): Promise<string> {
    this.md.finish();
    const options = info.kind === "edit" ? ["y", "n", "a", "d", "v"] : info.kind === "shell" ? ["y", "n", "a", "d", "k"] : ["y", "n", "a", "d"];
    const fallback = info.kind === "edit" ? "y" : info.kind === "shell" ? "n" : "n";
    const choices = `[${options.join("/")}]`;
    if (info.kind === "edit") {
      const s = stats(info.preview);
      this.line(`${style.yellow("•")} ${style.bold(`Edit ${info.subject}`)} ${style.green(`(+${s.added})`)} ${style.red(`(-${s.removed})`)}? ${choices} `);
    } else if (info.kind === "shell") {
      this.line(`${style.yellow("›")} ${style.bold(`Run: ${info.subject}`)}`);
      if (info.decision.dangerous) this.line(style.red(`  ! dangerous: ${info.decision.dangerous}`));
      this.line(style.dim(`  ${choices} `));
    } else {
      this.line(`${style.yellow("?")} ${style.bold(`${info.tool}: ${info.subject}`)}? ${choices} `);
    }
    if (!this.term) return "n";
    const answer = await readChoice(this.term, allowDiff ? options : options.filter((o) => o !== "d"), fallback);
    if (answer === "interrupt") return "k";
    this.midLine = false;
    return answer;
  }

  diff(path: string, patch: string): void {
    this.line(style.bold(`diff ${path}`));
    this.line(colorizeDiff(patch));
  }

  summary(s: TurnSummary): void {
    const parts: string[] = [];
    if (s.filesChanged.length) parts.push(`edited ${s.filesChanged.join(", ")}`);
    parts.push(`${s.filesChanged.length} file${s.filesChanged.length === 1 ? "" : "s"} changed`);
    parts.push(`${s.commands.length} command${s.commands.length === 1 ? "" : "s"} run`);
    if (s.denied) parts.push(`${s.denied} denied`);
    const tokens = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    // The meter already includes the token count and cost against the cap.
    if (s.meter) parts.push(s.meter);
    else if (tokens > 0) parts.push(`${(tokens / 1000).toFixed(1)}k tokens`);
    const mark = s.stopped === "done" ? style.green("✓") : style.yellow("!");
    this.line(`${mark} ${style.dim(parts.join(" · "))}`);
    if (s.stopped !== "done") this.line(style.yellow(`  ended: ${s.stopped}`));
  }

  endTurn(): void {
    this.md.finish();
    this.stopSpinner();
    if (this.midLine) this.write("\n");
  }
}

function stats(patch: string): { added: number; removed: number } {
  return diffStats(patch);
}

/** One-line JSON event writer (JSON Lines). Keys are stable; see docs in cli/README.md. */
export class JsonUI implements CoderUI {
  readonly canPrompt = false;

  constructor(private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)) {}

  private emit(event: Record<string, unknown>): void {
    this.write(JSON.stringify(event));
  }

  banner(lines: string[]): void {
    this.emit({ type: "init", lines });
  }

  notice(message: string, level: "info" | "warn" | "error" = "info"): void {
    this.emit({ type: "notice", level, message });
  }

  /** The summary is held until finish() so it is always the last JSONL line. */
  private pendingSummary: Record<string, unknown> | null = null;

  finish(): void {
    if (this.pendingSummary) this.emit(this.pendingSummary);
    this.pendingSummary = null;
  }

  thinking(): void {
    this.emit({ type: "thinking" });
  }

  token(text: string): void {
    this.emit({ type: "token", content: text });
  }

  toolCall(id: string, tool: string, args: Record<string, unknown>): void {
    this.emit({ type: "tool", id, tool, args, status: "running" });
  }

  toolResult(id: string, tool: string, ok: boolean, text: string): void {
    this.emit({ type: "tool", id, tool, status: ok ? "ok" : "error", output: text.slice(0, 4000) });
  }

  approvalRequest(info: ApprovalInfo): void {
    this.emit({
      type: "approval_request",
      kind: info.kind === "edit" ? "edit" : info.kind === "shell" ? "shell" : info.kind,
      tool: info.tool,
      target: info.subject,
      ...(info.preview ? { diff: info.preview } : {}),
      decision: info.decision.action,
      reason: info.decision.reason,
    });
  }

  async promptApproval(): Promise<string> {
    return "n";
  }

  diff(path: string, patch: string): void {
    this.emit({ type: "diff", path, patch });
  }

  summary(s: TurnSummary): void {
    this.pendingSummary = {
      type: "summary",
      stopped: s.stopped,
      steps: s.steps,
      files_changed: s.filesChanged,
      commands_run: s.commands,
      denied: s.denied,
      auto_denied: s.autoDenied,
      ...(s.inputTokens != null ? { input_tokens: s.inputTokens } : {}),
      ...(s.outputTokens != null ? { output_tokens: s.outputTokens } : {}),
      ...(s.meter ? { meter: s.meter } : {}),
    };
  }

  endTurn(): void {
    /* events are already flushed line by line */
  }
}

/** Plain error to stderr, used before a UI exists (startup failures). */
export function fatal(message: string): void {
  err(`${style.red("✕")} ${message}`);
}
