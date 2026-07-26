/**
 * XR 5.0 — Workflow State Machine
 *
 * Deterministic, testable state transitions for workflow runs AND individual
 * nodes. Every transition is validated against explicit allowed-sets.
 */

import type {
  WorkflowNodeState,
  WorkflowRunState,
} from "./types.ts";
import { isValidWorkflowTransition } from "./types.ts";

// ── Run-level transitions ──────────────────────────────────────────────────

/** Events that drive run-level state transitions. */
export type RunEvent =
  | "publish"
  | "queue"
  | "start"
  | "enter_waiting"
  | "enter_approval"
  | "enter_review"
  | "resume"
  | "request_cancel"
  | "cancel"
  | "complete"
  | "partial_complete"
  | "fail"
  | "block"
  | "pause"
  | "expire"
  | "require_compensation"
  | "compensation_complete";

/**
 * Apply a run-level event, returning the new state.
 * Throws on invalid transition.
 */
export function applyRunEvent(
  current: WorkflowRunState,
  event: RunEvent,
): WorkflowRunState {
  const target = RUN_EVENT_MAP[current]?.[event];
  if (!target) {
    throw new WorkflowStateError(
      `Invalid workflow run transition: ${current} -> ${event}`,
      current,
      event,
    );
  }
  if (!isValidWorkflowTransition(current, target)) {
    throw new WorkflowStateError(
      `Disallowed workflow run transition: ${current} -> ${target}`,
      current,
      event,
    );
  }
  return target;
}

const RUN_EVENT_MAP: Record<WorkflowRunState, Partial<Record<RunEvent, WorkflowRunState>>> = {
  draft: { publish: "published" },
  published: { queue: "queued" },
  queued: { start: "running", cancel: "cancelled", request_cancel: "cancelling", expire: "expired" },
  running: {
    enter_waiting: "waiting",
    enter_approval: "awaiting_approval",
    enter_review: "awaiting_review",
    pause: "paused",
    request_cancel: "cancelling",
    complete: "completed",
    partial_complete: "partially_completed",
    fail: "failed",
    block: "blocked",
  },
  waiting: { resume: "running", request_cancel: "cancelling", expire: "expired" },
  awaiting_approval: { resume: "running", request_cancel: "cancelling", fail: "failed", expire: "expired" },
  awaiting_review: { resume: "running", request_cancel: "cancelling", fail: "failed", expire: "expired" },
  paused: { resume: "running", request_cancel: "cancelling", expire: "expired" },
  cancelling: { cancel: "cancelled", fail: "failed" },
  cancelled: {},
  partially_completed: {
    require_compensation: "compensation_required",
    complete: "completed",
    fail: "failed",
  },
  failed: { require_compensation: "compensation_required" },
  completed: {},
  compensation_required: {
    // Placeholder for compensation resolution.
    // In practice, compensation either succeeds (-> completed) or the run
    // stays in this state for manual intervention.
  } as any,
  blocked: { resume: "running", cancel: "cancelled", expire: "expired" },
  expired: {},
};

// ── Node-level transitions ─────────────────────────────────────────────────

export type NodeEvent =
  | "mark_ready"
  | "start"
  | "wait_approval"
  | "wait_review"
  | "wait_timer"
  | "wait_event"
  | "complete"
  | "fail"
  | "cancel"
  | "skip"
  | "timeout"
  | "block"
  | "expire"
  | "begin_compensate"
  | "compensated";

const NODE_EVENT_MAP: Record<WorkflowNodeState, Partial<Record<NodeEvent, WorkflowNodeState>>> = {
  pending: { mark_ready: "ready", block: "blocked", skip: "skipped", cancel: "cancelled", expire: "expired" },
  ready: { start: "running", skip: "skipped", cancel: "cancelled", expire: "expired" },
  running: {
    wait_approval: "waiting_approval",
    wait_review: "waiting_review",
    wait_timer: "waiting_timer",
    wait_event: "waiting_event",
    complete: "completed",
    fail: "failed",
    timeout: "timed_out",
    cancel: "cancelled",
  },
  waiting_approval: { start: "running", fail: "failed", cancel: "cancelled", timeout: "timed_out", expire: "expired" },
  waiting_review: { start: "running", fail: "failed", cancel: "cancelled", timeout: "timed_out", expire: "expired" },
  waiting_timer: { start: "running", timeout: "timed_out", cancel: "cancelled" },
  waiting_event: { start: "running", timeout: "timed_out", cancel: "cancelled" },
  completed: {},
  failed: { mark_ready: "ready", skip: "skipped", begin_compensate: "compensating" },
  cancelled: {},
  skipped: {},
  compensating: { compensated: "compensated", fail: "failed" },
  compensated: {},
  blocked: { mark_ready: "ready", skip: "skipped", expire: "expired" },
  timed_out: { mark_ready: "ready", skip: "skipped" },
  expired: {},
};

/** Terminal node states. */
export const TERMINAL_NODE_STATES: ReadonlySet<WorkflowNodeState> = new Set([
  "completed",
  "cancelled",
  "skipped",
  "compensated",
  "expired",
]);

export function isNodeTerminal(state: WorkflowNodeState): boolean {
  return TERMINAL_NODE_STATES.has(state);
}

export function isNodeActive(state: WorkflowNodeState): boolean {
  return !isNodeTerminal(state) && state !== "failed" && state !== "blocked" && state !== "timed_out";
}

export function applyNodeEvent(
  current: WorkflowNodeState,
  event: NodeEvent,
  nodeId: string,
): WorkflowNodeState {
  const target = NODE_EVENT_MAP[current]?.[event];
  if (!target) {
    throw new WorkflowStateError(
      `Invalid node transition: ${current} -> ${event} (node ${nodeId})`,
      current,
      event,
      nodeId,
    );
  }
  return target;
}

// ── Error ──────────────────────────────────────────────────────────────────

export class WorkflowStateError extends Error {
  constructor(
    message: string,
    public readonly fromState: string,
    public readonly event: string,
    public readonly nodeId?: string,
  ) {
    super(message);
    this.name = "WorkflowStateError";
  }
}

// ── Convenience predicates ─────────────────────────────────────────────────

/** True when a run can accept new work (nodes can be started). */
export function canAdvanceNodes(state: WorkflowRunState): boolean {
  return state === "running";
}

/** True when human input can change the run state. */
export function canAcceptHumanInput(state: WorkflowRunState): boolean {
  return state === "awaiting_approval" || state === "awaiting_review";
}

/** True when the run can be paused. */
export function canPause(state: WorkflowRunState): boolean {
  return state === "running" || state === "waiting";
}

/** True when the run can be cancelled. */
export function canCancel(state: WorkflowRunState): boolean {
  return (
    state === "queued" ||
    state === "running" ||
    state === "waiting" ||
    state === "awaiting_approval" ||
    state === "awaiting_review" ||
    state === "paused" ||
    state === "blocked"
  );
}
