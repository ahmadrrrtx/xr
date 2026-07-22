/**
 * XR 4.1 — Execution Inspection
 *
 * Safe, bounded summaries for CLI/daemon/dashboard consumption. Never
 * exposes secrets or full payloads.
 */
import type {
  ExecutionRecord,
  ExecutionSummary,
  ExecutionOutcomeKind,
  ExecutionState,
} from "./types.ts";
import { EXECUTION_BOUNDS } from "./types.ts";

/** Map execution state to a short, user-facing label. */
export const STATE_LABEL: Record<ExecutionState, string> = {
  created: "created",
  planned: "planned",
  awaiting_policy: "evaluating policy",
  awaiting_approval: "awaiting approval",
  authorized: "authorized",
  queued: "queued",
  running: "running",
  observing: "observing",
  succeeded: "succeeded",
  partially_completed: "partial",
  failed: "failed",
  cancelled: "cancelled",
  timed_out: "timed out",
  denied: "denied",
  budget_blocked: "budget blocked",
  unavailable: "unavailable",
  reconciliation_required: "reconciliation required",
};

/** Map outcome kind to a user-facing label. */
export const OUTCOME_LABEL: Record<ExecutionOutcomeKind, string> = {
  succeeded: "succeeded",
  failed: "failed",
  partially_completed: "partially completed",
  cancelled: "cancelled",
  timed_out: "timed out",
  denied: "denied",
  budget_stopped: "stopped by budget",
  unavailable: "unavailable",
  awaiting_approval: "awaiting approval",
  reconciliation_required: "reconciliation required",
  dry_run_simulated: "dry-run (no side effects)",
};

/** ANSI color hints for CLI (safe for non-TTY because consumers opt-in). */
export const STATE_COLOR: Record<ExecutionState, string> = {
  created: "\x1b[2m",
  planned: "\x1b[2m",
  awaiting_policy: "\x1b[33m",
  awaiting_approval: "\x1b[33m",
  authorized: "\x1b[36m",
  queued: "\x1b[2m",
  running: "\x1b[36m",
  observing: "\x1b[36m",
  succeeded: "\x1b[32m",
  partially_completed: "\x1b[33m",
  failed: "\x1b[31m",
  cancelled: "\x1b[33m",
  timed_out: "\x1b[31m",
  denied: "\x1b[31m",
  budget_blocked: "\x1b[33m",
  unavailable: "\x1b[31m",
  reconciliation_required: "\x1b[33m",
};

export function summarize(rec: ExecutionRecord): ExecutionSummary {
  return {
    runId: rec.id.runId,
    correlationId: rec.id.correlationId,
    state: rec.state,
    outcome: rec.outcome?.kind,
    capability: rec.action
      ? `${rec.action.capability.kind}:${rec.action.capability.name}`
      : `${rec.intent.summary.slice(0, 40)}`,
    actor: actorString(rec.actor),
    sessionId: rec.id.sessionId,
    workflowId: rec.id.workflowId,
    taskId: rec.id.taskId,
    attempt: rec.id.attempt,
    placement: rec.action?.placement.kind ?? "in_process",
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    durationMs: rec.durationMs,
    costUsd: rec.cost?.actualUsd ?? rec.cost?.estimatedUsd,
    message: rec.outcome?.message?.slice(0, EXECUTION_BOUNDS.MAX_MESSAGE_CHARS),
    dryRun: rec.action?.dryRun,
  };
}

export function actorString(a: ExecutionRecord["actor"]): string {
  switch (a.kind) {
    case "user":
      return `user:${a.source}`;
    case "agent":
      return `agent:${a.agentId}`;
    case "system":
      return `system:${a.component}`;
    case "workflow":
      return `workflow:${a.workflowId}`;
    case "plugin":
      return `plugin:${a.pluginId}`;
    case "skill":
      return `skill:${a.skillId}`;
    case "mcp":
      return `mcp:${a.serverId}`;
    case "research":
      return `research:${a.sessionId}`;
    case "business":
      return `business:${a.module}`;
    default:
      return "unknown";
  }
}

/** Single-line pretty-print for CLI/TUI. Non-color when stream is not a TTY. */
export function formatLine(s: ExecutionSummary, opts: { color?: boolean } = {}): string {
  const c = opts.color ? STATE_COLOR[s.state] : "";
  const r = opts.color ? "\x1b[0m" : "";
  const state = (opts.color ? STATE_COLOR[s.state] : "") + STATE_LABEL[s.state] + r;
  const cap = s.capability;
  const dur = s.durationMs != null ? ` ${s.durationMs}ms` : "";
  const cost = s.costUsd != null ? ` $${s.costUsd.toFixed(5)}` : "";
  const attempt = s.attempt > 1 ? ` (attempt ${s.attempt})` : "";
  const dry = s.dryRun ? " [dry-run]" : "";
  const msg = s.message ? ` — ${s.message.slice(0, 80)}` : "";
  return `${c}▸${r} ${s.runId} ${state} ${cap}${dur}${cost}${attempt}${dry}${msg}`;
}
