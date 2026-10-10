/**
 * Phase 23 — the coding agent's approval gate.
 *
 * Every write, delete and shell command reaches `decide()` through the engine's
 * `overrides.approve` hook. Order of checks (first match wins):
 *
 *   1. --diff (preview only)           → record the proposal, deny, never write.
 *   2. dangerous shell command         → ALWAYS a human prompt (even with --approve-all);
 *                                        never a session "always" grant.
 *   3. --approve-all                   → approve (audited).
 *   4. session grant for this kind     → approve (audited).
 *   5. no terminal to ask on           → deny (audited) with a clear message.
 *   6. human prompt                    → y / n / a / d / v / k, decided through the
 *                                        engine's durable approval plane (makeApprover),
 *                                        so the decision is audit-logged with a TTL.
 *
 * Enter alone is NOT consent: a prompt needs an explicit key (default-deny).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalRequest } from "../../core/types.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";
import { makeApprover } from "../../control/approval-store.ts";
import { classifyShellCommand } from "./dangerous.ts";
import { colorizeDiff, diffStat, lineDiff, unifiedDiff } from "./diff.ts";
import { editInEditor } from "./editor.ts";
import type { KeyInput } from "./key-input.ts";
import type { Sink } from "./sink.ts";

export type ApprovalKind = "edit" | "delete" | "shell" | "other";
export type DenialReason = "diff-only" | "non-interactive" | "user-declined";

export function kindOf(tool: string): ApprovalKind {
  if (tool === "write_file") return "edit";
  if (tool === "delete_file") return "delete";
  if (tool === "shell") return "shell";
  return "other";
}

export interface ProposedDiff {
  path: string;
  diff: string;
  added: number;
  removed: number;
}

export interface GateOptions {
  sink: Sink;
  /** The terminal, when there is one (raw keys for prompts). */
  keys: KeyInput | null;
  approveAll: boolean;
  diffOnly: boolean;
  cwd: string;
  /** Audit a decision into the engine's trail. Never throws. */
  audit: (event: string, detail: Record<string, unknown>) => void;
  /**
   * The engine's durable approval store. When present, every human decision is
   * recorded there (audit + TTL default-deny) and this gate supplies the prompt.
   * Without it (tests, degraded runs) the prompt is asked directly.
   */
  store?: WorkspaceStore;
  approvalTtl?: { defaultTtlMs?: number; perSurface?: Record<string, number> };
  /** Called on `k` (kill): the caller cancels the current turn. */
  onKill?: () => void;
  /** Cancels a pending prompt when the turn is aborted. */
  signal?: AbortSignal;
}

export class ApprovalGate {
  /** Kinds the user has granted for the rest of the session (`a`). */
  readonly sessionGrants = new Set<ApprovalKind>();
  /** Diff-mode proposals, in the order the model made them. */
  readonly proposals: Array<ProposedDiff | { shell: string }> = [];
  denied = 0;
  /**
   * Every refusal, in order, for the audit trail (`done` event in --json, and the
   * turn summary). `target` is what was asked for; `reason` says why it was refused.
   */
  readonly denials: Array<{ tool: string; kind: ApprovalKind; target: string; reason: DenialReason }> = [];
  approved = 0;
  /** Commands and writes the human actually approved (for the summary line). */
  readonly approvedWrites: string[] = [];
  readonly approvedShell: string[] = [];

  private readonly engine: ((req: ApprovalRequest) => Promise<boolean>) | null;
  private pending: { req: ApprovalRequest; kind: ApprovalKind; args: Record<string, unknown>; cmd: string; dangerReason?: string } | null = null;

  constructor(private readonly opts: GateOptions) {
    this.engine = opts.store
      ? makeApprover(opts.store, {
          surface: "cli",
          defaultTtlMs: opts.approvalTtl?.defaultTtlMs,
          perSurface: opts.approvalTtl?.perSurface,
          prompt: async (_record, decide) => {
            const pend = this.pending;
            // No pending request means the plane asked for something we did not raise: deny.
            if (!pend) return decide(false);
            decide(await this.promptHuman(pend.req, pend.kind, pend.args, pend.cmd, pend.dangerReason));
          },
        })
      : null;
  }

  /** Entry point wired into the engine as `overrides.approve`. */
  decide = async (req: ApprovalRequest): Promise<boolean> => {
    const kind = kindOf(req.tool);
    const args = (req.args ?? {}) as Record<string, unknown>;
    const cmd = kind === "shell" ? String(args.cmd ?? req.preview ?? "") : "";
    const danger = kind === "shell" ? classifyShellCommand(cmd) : { dangerous: false as const, reason: undefined };

    // 1. Diff preview: record what would change, never write.
    if (this.opts.diffOnly) {
      if (kind === "edit") this.recordProposal(String(args.path ?? ""), String(args.content ?? ""));
      if (kind === "shell") this.proposals.push({ shell: cmd });
      if (kind === "delete") this.proposals.push({ shell: `delete ${String(args.path ?? "")}` });
      this.refuse(req, kind, args, "diff-only");
      this.opts.audit("cli.approval.preview", { tool: req.tool, kind });
      return false;
    }

    // 2–4. Automatic decisions.
    if (!danger.dangerous) {
      if (this.opts.approveAll || this.sessionGrants.has(kind)) {
        this.approved++;
        this.noteApproved(kind, req, args);
        this.opts.audit("cli.approval.auto", { tool: req.tool, kind, via: this.opts.approveAll ? "approve-all" : "session" });
        return true;
      }
    }

    // 5. Nobody to ask.
    if (!this.opts.keys || !this.opts.keys.available) {
      this.refuse(req, kind, args, "non-interactive");
      const why = danger.dangerous
        ? `${danger.reason} — needs an interactive terminal to approve`
        : "non-interactive run — approve with a terminal, or pass --approve-all";
      this.opts.sink.warn(`denied: ${this.describe(kind, req, args)} (${why})`);
      this.opts.audit("cli.approval.denied", { tool: req.tool, kind, reason: "non-interactive", dangerous: danger.dangerous });
      return false;
    }

    // 6. Human prompt. With a store, the engine records the decision (its prompt
    //    callback calls promptHuman); without one, prompt directly.
    const dangerReason = danger.dangerous ? danger.reason : undefined;
    let ok: boolean;
    if (this.engine) {
      this.pending = { req, kind, args, cmd, dangerReason };
      try {
        ok = await this.engine({ ...req, args });
      } finally {
        this.pending = null;
      }
    } else {
      ok = await this.promptHuman(req, kind, args, cmd, dangerReason);
    }
    if (ok) {
      this.approved++;
      this.noteApproved(kind, req, args);
    } else {
      this.refuse(req, kind, args, "user-declined");
    }
    return ok;
  };

  private refuse(req: ApprovalRequest, kind: ApprovalKind, args: Record<string, unknown>, reason: DenialReason): void {
    this.denied++;
    const target = kind === "shell" ? String(args.cmd ?? req.preview ?? "") : String(args.path ?? req.preview ?? "");
    this.denials.push({ tool: req.tool, kind, target: target.slice(0, 500), reason });
  }

  private noteApproved(kind: ApprovalKind, req: ApprovalRequest, args: Record<string, unknown>): void {
    if (kind === "edit") this.approvedWrites.push(String(args.path ?? ""));
    if (kind === "shell") this.approvedShell.push(String((args as { cmd?: unknown }).cmd ?? req.preview ?? ""));
  }

  private recordProposal(path: string, content: string): void {
    const abs = join(this.opts.cwd, path);
    const old = existsSync(abs) ? safeRead(abs) : "";
    const ops = lineDiff(old, content);
    const { added, removed } = diffStat(ops);
    this.proposals.push({ path, diff: unifiedDiff(path, ops) || "(no textual change)", added, removed });
  }

  private describe(kind: ApprovalKind, req: ApprovalRequest, args: Record<string, unknown>): string {
    if (kind === "edit") return `edit ${String(args.path ?? "")}`;
    if (kind === "delete") return `delete ${String(args.path ?? "")}`;
    if (kind === "shell") return `run ${String((args as { cmd?: unknown }).cmd ?? req.preview ?? "")}`;
    return req.tool;
  }

  /** The interactive prompt. Returns the decision; `d` and `v` loop back to the prompt. */
  async promptHuman(
    req: ApprovalRequest,
    kind: ApprovalKind,
    args: Record<string, unknown>,
    cmd: string,
    dangerReason: string | undefined,
  ): Promise<boolean> {
    const { sink } = this.opts;
    const p = sink.p;
    const keys = this.opts.keys!;
    const path = String(args.path ?? "");

    // Show the summary once; `d` re-shows the full view.
    const show = (full: boolean) => {
      if (kind === "edit") {
        const newText = String(args.content ?? "");
        const oldText = existsSync(join(this.opts.cwd, path)) ? safeRead(join(this.opts.cwd, path)) : "";
        const isNew = !existsSync(join(this.opts.cwd, path));
        const ops = lineDiff(oldText, newText);
        const stat = diffStat(ops);
        sink.line(`  ${p.cyan("✏")} ${p.bold(`${isNew ? "create" : "edit"} ${path}`)} ${p.green(`+${stat.added}`)} ${p.red(`-${stat.removed}`)}${isNew ? "" : ""}`);
        if (req.reason && req.reason.includes("TRUST-HANDOFF")) sink.line(`  ${p.yellow("!")} ${req.reason}`);
        const text = unifiedDiff(path, ops, 3);
        if (text) {
          const lines = text.split("\n");
          const limit = full ? lines.length : 60;
          sink.line(colorizeDiff(lines.slice(0, limit).join("\n"), p));
          if (!full && lines.length > limit) sink.line(p.dim(`  … ${lines.length - limit} more lines (d = full diff)`));
        }
        sink.out(`  ${p.bold("allow?")} ${p.dim("[y/n/a/d/v]")} `);
        return;
      }
      if (kind === "shell") {
        sink.line(`  ${p.cyan("▶")} ${p.bold("run:")} ${cmd}`);
        sink.line(`    ${p.dim(`cwd: ${this.opts.cwd}`)}`);
        if (full) sink.line(`    ${p.dim(`tool: ${req.tool} · args: ${JSON.stringify(args)}`)}`);
        if (dangerReason) sink.line(`  ${p.yellow("!")} ${p.yellow(`flagged: ${dangerReason} — explicit answer required`)}`);
        const keysHint = dangerReason ? "[y/n/d/k]" : "[y/n/a/d/k]";
        sink.out(`  ${p.bold("allow?")} ${p.dim(keysHint)} `);
        return;
      }
      if (kind === "delete") {
        sink.line(`  ${p.red("✗")} ${p.bold(`delete ${path}`)}`);
        sink.out(`  ${p.bold("allow?")} ${p.dim("[y/n/a/d]")} `);
        return;
      }
      sink.line(`  ${p.cyan("›")} ${p.bold(req.tool)}${req.reason ? ` — ${req.reason}` : ""}`);
      sink.out(`  ${p.bold("allow?")} ${p.dim("[y/n/a/d]")} `);
    };

    const allowed = (): string[] => {
      const base = ["y", "n", "d"];
      if (!dangerReason) base.push("a");
      if (kind === "edit") base.push("v");
      if (kind === "shell") base.push("k");
      return base;
    };

    let full = false;
    let decided: boolean | null = null;
    while (decided === null) {
      show(full);
      full = false;
      let key: string;
      try {
        key = await keys.readKey(allowed(), this.opts.signal);
      } catch {
        // Turn aborted while waiting: deny, and say so.
        sink.line(p.dim("  (cancelled)"));
        return false;
      }
      sink.line(p.dim(key));
      switch (key) {
        case "y":
          decided = true;
          break;
        case "n":
          decided = false;
          break;
        case "a":
          if (kind === "shell" || kind === "edit" || kind === "delete" || kind === "other") {
            this.sessionGrants.add(kind);
            sink.line(p.yellow(`  ${kind === "shell" ? "Auto-approving shell commands for this session." : `Auto-approving ${kind} actions for this session.`}`));
          }
          decided = true;
          break;
        case "d":
          full = true;
          break;
        case "v": {
          const current = String(args.content ?? "");
          const edited = await this.editContent(path, current);
          if (edited !== null && edited !== current) {
            args.content = edited;
            sink.line(p.dim("  edited — review the change again"));
          }
          full = false;
          break;
        }
        case "k":
          this.opts.onKill?.();
          decided = false;
          break;
        default:
          break;
      }
    }

    return decided;
  }

  private async editContent(path: string, current: string): Promise<string | null> {
    try {
      return await editInEditor(current, path, this.opts.keys!);
    } catch (err) {
      this.opts.sink.warn(`editor failed: ${(err as Error).message}`);
      return null;
    }
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** The approval prompt's keys, for tests and docs. */
export const APPROVAL_KEYS = { edit: ["y", "n", "a", "d", "v"], shell: ["y", "n", "a", "d", "k"], dangerous: ["y", "n", "d", "k"] } as const;
