/**
 * XR 5.0 — Workflow Inspection
 *
 * Safe, bounded views for CLI/daemon/dashboard consumption.
 */

import type {
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowRunState,
  WorkflowNodeState,
  WorkflowInspection,
  HumanDecision,
} from "./types.ts";

/** User-facing state labels. */
export const RUN_STATE_LABELS: Record<WorkflowRunState, string> = {
  draft: "Draft",
  published: "Published",
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  awaiting_approval: "Awaiting Approval",
  awaiting_review: "Awaiting Review",
  paused: "Paused",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  partially_completed: "Partially Completed",
  failed: "Failed",
  completed: "Completed",
  compensation_required: "Compensation Required",
  blocked: "Blocked",
  expired: "Expired",
};

export const NODE_STATE_LABELS: Record<WorkflowNodeState, string> = {
  pending: "Pending",
  ready: "Ready",
  running: "Running",
  waiting_approval: "Waiting Approval",
  waiting_review: "Waiting Review",
  waiting_timer: "Waiting",
  waiting_event: "Waiting",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  compensating: "Compensating",
  compensated: "Compensated",
  blocked: "Blocked",
  timed_out: "Timed Out",
  expired: "Expired",
};

/** ANSI color codes. */
export const STATE_COLORS: Record<WorkflowRunState, string> = {
  draft: "\x1b[2m",
  published: "\x1b[2m",
  queued: "\x1b[2m",
  running: "\x1b[36m",
  waiting: "\x1b[33m",
  awaiting_approval: "\x1b[33m",
  awaiting_review: "\x1b[33m",
  paused: "\x1b[33m",
  cancelling: "\x1b[33m",
  cancelled: "\x1b[31m",
  partially_completed: "\x1b[33m",
  failed: "\x1b[31m",
  completed: "\x1b[32m",
  compensation_required: "\x1b[33m",
  blocked: "\x1b[31m",
  expired: "\x1b[31m",
};

/** Format a run summary as a single line for CLI. */
export function formatRunLine(summary: WorkflowRunSummary, opts: { color?: boolean } = {}): string {
  const c = opts.color ? STATE_COLORS[summary.state] : "";
  const r = opts.color ? "\x1b[0m" : "";
  const state = c + RUN_STATE_LABELS[summary.state] + r;
  const progress = `${summary.nodesCompleted}/${summary.nodeCount}`;
  const dur = summary.endedAt && summary.startedAt
    ? ` ${((summary.endedAt - summary.startedAt) / 1000).toFixed(0)}s`
    : "";
  return `${summary.runId.slice(0, 12)}  ${state.padEnd(24)} ${progress.padEnd(7)} ${summary.name.slice(0, 40)}${dur}`;
}

/** Format a human decision for display. */
export function formatDecision(d: HumanDecision): string {
  const outcome = "approval" in d.decision
    ? (d.decision.approval === "approved" ? "APPROVED" : "DENIED")
    : "review" in d.decision
    ? (d.decision.review === "approved" ? "APPROVED" : d.decision.review === "changes_requested" ? "CHANGES REQUESTED" : "REJECTED")
    : "EXPIRED";
  const who = d.decidedBy.name ?? d.decidedBy.userId;
  const when = new Date(d.decidedAt).toISOString();
  return `${outcome} by ${who} at ${when}${d.comment ? ` — ${d.comment}` : ""}`;
}

/** Format a workflow inspection as readable text. */
export function renderInspection(inspection: WorkflowInspection): string {
  const lines: string[] = [];
  const s = inspection.run;
  lines.push(`Workflow: ${s.name} (${s.runId})`);
  lines.push(`Definition: ${s.definitionId} v${s.definitionVersion}`);
  lines.push(`State: ${RUN_STATE_LABELS[s.state]}`);
  lines.push(`Progress: ${s.nodesCompleted}/${s.nodeCount} nodes completed`);
  if (s.nodesFailed > 0) lines.push(`Failed: ${s.nodesFailed} nodes`);
  if (s.nodesBlocked > 0) lines.push(`Blocked: ${s.nodesBlocked} nodes`);
  if (s.nodesAwaitingHuman > 0) lines.push(`Awaiting Human: ${s.nodesAwaitingHuman} nodes`);
  if (s.error) lines.push(`Error: ${s.error}`);

  lines.push("\nNodes:");
  for (const ns of inspection.nodeStates) {
    const stateLabel = NODE_STATE_LABELS[ns.state] ?? ns.state;
    lines.push(`  ${ns.nodeId}  ${stateLabel.padEnd(18)} ${ns.kind}`);
    if (ns.error) lines.push(`    Error: ${ns.error}`);
    if (ns.attempt > 1) lines.push(`    Attempt: ${ns.attempt}`);
  }

  if (inspection.humanDecisions.length > 0) {
    lines.push("\nHuman Decisions:");
    for (const d of inspection.humanDecisions) {
      lines.push(`  ${d.decisionId}  ${d.kind}  ${formatDecision(d)}`);
    }
  }

  if (inspection.artifacts.length > 0) {
    lines.push("\nArtifacts:");
    for (const a of inspection.artifacts) {
      lines.push(`  ${a.artifactId}  ${a.contract.type}  ${a.location}`);
    }
  }

  if (inspection.errorChain.length > 0) {
    lines.push("\nError Chain:");
    for (const e of inspection.errorChain) {
      lines.push(`  ${e.nodeId}: ${e.error} (${new Date(e.timestamp).toISOString()})`);
    }
  }

  return lines.join("\n");
}
