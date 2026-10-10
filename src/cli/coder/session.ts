/**
 * One coding session: runs turns through the engine's agent loop and answers
 * its approval requests with the coder policy.
 *
 * The engine owns the loop, tools, budget and audit. This module contributes
 * only: the coder tool allow-list, the approval policy (permissions.ts), the
 * UI (ui.ts), and per-turn bookkeeping for the summary line.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, isAbsolute } from "node:path";
import type { AgentResult } from "../../core/agent.ts";
import type { ApprovalRequest, ChatStreamEvent } from "../../core/types.ts";
import type { AgentRunOverrides } from "../../services/agent-service.ts";
import { unifiedDiff } from "./diff.ts";
import type { ApproveFn, ConsentWrap } from "./consent.ts";
import { classifyTool, decide, type ActionKind, type ApprovalMode, type PermissionRules } from "./permissions.ts";
import type { ApprovalInfo, CoderUI, TurnSummary } from "./ui.ts";

/** The slice of AgentService the session needs (keeps this module easy to test). */
export interface AgentPort {
  runTask(task: string, mode: "agent", overrides: AgentRunOverrides): Promise<AgentResult>;
}

export interface SessionOptions {
  cwd: string;
  systemPrompt: string;
  tools: string[];
  provider?: string;
  model?: string;
  mode: ApprovalMode;
  rules: PermissionRules;
  interactive: boolean;
  diffOnly: boolean;
  maxSteps: number;
  maxTokens?: number;
  /** Suspend/resume raw terminal mode around an external editor. */
  editorHooks?: { suspend(): void; resume(): void };
  onAbortTurn?: () => void;
  /** Routes the interactive approval through the durable approval store. */
  consent?: ConsentWrap;
}

const HISTORY_TURNS = 10;
const HISTORY_CHARS = 24_000;

/** Plain-text version of the engine's cost meter (no pictographs). */
export function plainMeter(meter: string): string {
  return meter
    .replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, "")
    .trim();
}

export function subjectOf(req: ApprovalRequest): string {
  const args = (req.args ?? {}) as Record<string, unknown>;
  switch (req.tool) {
    case "shell":
      return String(args.command ?? "");
    case "write_file":
    case "delete_file":
    case "patch_file":
      return String(args.path ?? "");
    case "fetch_url":
      return String(args.url ?? "");
    case "web_search":
      return String(args.query ?? "");
    default:
      return req.tool;
  }
}

export class CoderSession {
  private transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
  private grants = new Set<ActionKind>();
  private pendingEdits = new Map<string, string>();
  private toolCalls = new Map<string, { tool: string; args: Record<string, unknown> }>();
  private files = new Set<string>();
  private commands: string[] = [];
  private denied = 0;
  private autoDenied = 0;
  private diffs: Array<{ path: string; patch: string }> = [];

  constructor(
    private readonly agent: AgentPort,
    private readonly ui: CoderUI,
    private readonly opts: SessionOptions,
  ) {
    const ask: ApproveFn = (req) => this.approve(req);
    this.gate = opts.consent ? opts.consent(ask) : ask;
  }

  private readonly gate: ApproveFn;

  /** Diffs captured in --diff mode (empty otherwise). */
  get proposedDiffs(): ReadonlyArray<{ path: string; patch: string }> {
    return this.diffs;
  }

  get autoDeniedCount(): number {
    return this.autoDenied;
  }

  get grantedKinds(): ReadonlySet<ActionKind> {
    return this.grants;
  }

  async turn(prompt: string, signal: AbortSignal): Promise<AgentResult> {
    this.files = new Set();
    this.commands = [];
    this.denied = 0;
    this.autoDenied = 0;
    this.toolCalls.clear();
    this.ui.thinking();

    const overrides: AgentRunOverrides = {
      ...(this.opts.provider ? { provider: this.opts.provider } : {}),
      ...(this.opts.model ? { model: this.opts.model } : {}),
      systemPrompt: this.opts.systemPrompt,
      includeSkills: false,
      toolsAllow: this.opts.tools,
      history: this.history(),
      signal,
      maxSteps: this.opts.maxSteps,
      ...(this.opts.maxTokens ? { maxTokens: this.opts.maxTokens } : {}),
      say: () => {},
      onStreamEvent: (e) => this.onEvent(e),
      approve: this.gate,
    };

    const result = await this.agent.runTask(prompt, "agent", overrides);
    this.transcript.push({ role: "user", content: prompt });
    this.transcript.push({ role: "assistant", content: result.finalMessage ?? "" });
    this.ui.endTurn();

    for (const path of this.pendingEdits.keys()) {
      this.ui.notice(`your edit to ${path} was not applied (the write did not run)`, "warn");
    }
    this.pendingEdits.clear();

    const summary: TurnSummary = {
      stopped: result.stopped,
      steps: result.steps,
      filesChanged: [...this.files],
      commands: [...this.commands],
      denied: this.denied,
      autoDenied: this.autoDenied,
      ...(result.inputTokens != null ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens != null ? { outputTokens: result.outputTokens } : {}),
      // The engine meter carries pictographs, and says "local" when a model has
      // no price configured. The CLI prints plain text and says what it knows.
      ...(result.meter ? { meter: plainMeter(result.meter) } : {}),
    };
    this.ui.summary(summary);
    return result;
  }

  /** Forget the conversation (REPL /clear). */
  clear(): void {
    this.transcript = [];
  }

  private history(): Array<{ role: "user" | "assistant"; content: string }> {
    const recent = this.transcript.slice(-HISTORY_TURNS * 2);
    let total = 0;
    const kept: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i]!;
      total += m.content.length;
      if (total > HISTORY_CHARS) break;
      kept.unshift(m);
    }
    return kept;
  }

  private onEvent(e: ChatStreamEvent): void {
    switch (e.type) {
      case "token":
        this.ui.token(e.text);
        return;
      case "tool_call": {
        const args = (typeof e.args === "object" && e.args !== null ? e.args : {}) as Record<string, unknown>;
        this.toolCalls.set(e.id, { tool: e.tool, args });
        const kind = classifyTool(e.tool);
        if (kind !== "edit" && kind !== "shell") this.ui.toolCall(e.id, e.tool, args);
        return;
      }
      case "tool_result": {
        const call = this.toolCalls.get(e.id);
        const tool = e.tool;
        if (tool === "write_file" && e.ok && call) {
          const path = String(call.args.path ?? "");
          this.files.add(path);
          this.applyPendingEdit(path);
        }
        if (tool === "shell" && call) this.commands.push(String(call.args.command ?? ""));
        if (e.ok) this.ui.toolResult(e.id, tool, true, e.result ?? "");
        else this.ui.toolResult(e.id, tool, false, e.error ?? "failed");
        return;
      }
      default:
        return;
    }
  }

  private safeAbs(path: string): string | null {
    const abs = isAbsolute(path) ? path : resolve(this.opts.cwd, path);
    const rel = relative(this.opts.cwd, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    return abs;
  }

  private editPreview(path: string, proposed: string): string {
    const abs = this.safeAbs(path);
    if (!abs) return "";
    const old = existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : "";
    // Labels are project-relative (a/src/x.ts), never absolute (a//tmp/x.ts).
    return unifiedDiff(old, proposed, relative(this.opts.cwd, abs));
  }

  private applyPendingEdit(path: string): void {
    const edited = this.pendingEdits.get(path);
    if (edited === undefined) return;
    this.pendingEdits.delete(path);
    const abs = this.safeAbs(path);
    if (!abs) return;
    writeFileSync(abs, edited);
    this.ui.notice(`applied your edited version of ${path}`);
  }

  private async approve(req: ApprovalRequest): Promise<boolean> {
    const kind = classifyTool(req.tool);
    const subject = subjectOf(req);
    const args = (req.args ?? {}) as Record<string, unknown>;
    const preview = kind === "edit" && req.tool === "write_file" ? this.editPreview(subject, String(args.content ?? "")) : "";

    const decision = decide({
      kind,
      tool: req.tool,
      subject,
      mode: this.opts.mode,
      rules: this.opts.rules,
      sessionGrants: this.grants,
      interactive: this.ui.canPrompt && this.opts.interactive,
    });
    const info: ApprovalInfo = { kind, tool: req.tool, subject, preview, decision };
    this.ui.approvalRequest(info);

    if (this.opts.diffOnly) {
      if (kind === "edit") {
        this.diffs.push({ path: subject, patch: preview });
        this.ui.notice(`--diff: proposed change to ${subject} not written`);
      } else {
        this.ui.notice(`--diff: ${req.tool} not run (${subject})`);
      }
      this.denied++;
      return false;
    }

    if (decision.action === "allow") return true;
    if (decision.action === "deny") {
      this.denied++;
      if (decision.reason.includes("non-interactive")) this.autoDenied++;
      this.ui.notice(`denied ${subject || req.tool}: ${decision.reason}`, "warn");
      return false;
    }

    if (!this.ui.canPrompt) {
      this.denied++;
      this.autoDenied++;
      this.ui.notice(`${subject || req.tool} needs approval and there is no terminal to ask on; skipped`, "warn");
      return false;
    }

    for (;;) {
      const choice = await this.ui.promptApproval(info, Boolean(preview));
      switch (choice) {
        case "y":
          return true;
        case "a":
          if (kind === "shell" && !decision.dangerous) {
            this.ui.notice("Auto-approving shell commands for this session.", "warn");
          }
          this.grants.add(kind);
          return true;
        case "d":
          if (kind === "edit") this.ui.diff(subject, preview || "(no textual change)");
          else this.ui.notice(`command: ${subject}\ncwd: ${this.opts.cwd}`);
          continue;
        case "v": {
          if (kind !== "edit") {
            this.ui.notice("edit in $EDITOR is only available for file edits");
            continue;
          }
          const edited = this.openInEditor(subject, String(args.content ?? ""));
          if (edited === null) {
            this.ui.notice("editor exited without a change; approval unchanged");
            continue;
          }
          this.pendingEdits.set(subject, edited);
          this.ui.notice(`using your edited version of ${subject}`);
          return true;
        }
        case "k":
          this.denied++;
          this.ui.notice("stopping this turn");
          this.opts.onAbortTurn?.();
          return false;
        default:
          this.denied++;
          return false;
      }
    }
  }

  /** Open the proposed content in $VISUAL/$EDITOR. Returns the edited text, or null if unchanged. */
  private openInEditor(path: string, proposed: string): string | null {
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const tmp = join(tmpdir(), `xr-edit-${process.pid}-${Date.now()}${extname(path)}`);
    writeFileSync(tmp, proposed, { mode: 0o600 });
    this.opts.editorHooks?.suspend();
    try {
      const res = spawnSync(editor, [tmp], { stdio: "inherit", shell: true });
      if (res.status !== 0) return null;
      const edited = readFileSync(tmp, "utf8");
      return edited === proposed ? null : edited;
    } finally {
      this.opts.editorHooks?.resume();
      try {
        unlinkSync(tmp);
      } catch {
        // Temp file already gone; nothing to clean.
      }
    }
  }
}
