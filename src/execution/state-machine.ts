/**
 * XR 4.1 — Execution State Machine
 *
 * Deterministic, unit-testable state transitions for the Unified Execution
 * Fabric. Every transition validates against an explicit allowed-set.
 */
import { InvalidExecutionTransitionError } from "./errors.ts";
import type { ExecutionState, ExecutionTransition } from "./types.ts";

/**
 * The (state, event) → next-state mapping. "event" is the logical transition
 * trigger — not a generic event bus event. Keep this table explicit and small.
 */
type Event =
  | "plan"
  | "submit_policy"
  | "require_approval"
  | "grant_approval"
  | "deny"
  | "budget_block"
  | "authorize"
  | "queue"
  | "start"
  | "observe"
  | "succeed"
  | "partial"
  | "fail"
  | "cancel"
  | "timeout"
  | "mark_unavailable"
  | "reconcile"
  | "retry"
  | "mark_dry_run";

const TRANSITIONS: Record<ExecutionState, Partial<Record<Event, ExecutionState>>> = {
  created: {
    plan: "planned",
    submit_policy: "awaiting_policy",
    // A direct authorization (e.g. read-only tool, no policy needed) is allowed.
    authorize: "authorized",
    queue: "queued",
    cancel: "cancelled",
    mark_unavailable: "unavailable",
  },
  planned: {
    submit_policy: "awaiting_policy",
    authorize: "authorized",
    queue: "queued",
    cancel: "cancelled",
    deny: "denied",
    budget_block: "budget_blocked",
    mark_unavailable: "unavailable",
  },
  awaiting_policy: {
    require_approval: "awaiting_approval",
    authorize: "authorized",
    deny: "denied",
    budget_block: "budget_blocked",
    mark_unavailable: "unavailable",
    cancel: "cancelled",
    timeout: "timed_out",
  },
  awaiting_approval: {
    grant_approval: "authorized",
    deny: "denied",
    cancel: "cancelled",
    timeout: "timed_out",
  },
  authorized: {
    queue: "queued",
    start: "running",
    deny: "denied",
    budget_block: "budget_blocked",
    cancel: "cancelled",
  },
  queued: {
    start: "running",
    cancel: "cancelled",
    timeout: "timed_out",
    budget_block: "budget_blocked",
    deny: "denied",
  },
  running: {
    observe: "observing",
    succeed: "succeeded",
    partial: "partially_completed",
    fail: "failed",
    cancel: "cancelled",
    timeout: "timed_out",
    mark_dry_run: "succeeded", // dry-run: side effect free; transitions to succeeded via outcome override
  },
  observing: {
    succeed: "succeeded",
    partial: "partially_completed",
    fail: "failed",
    reconcile: "reconciliation_required",
    cancel: "cancelled",
    timeout: "timed_out",
  },
  // Terminal states — reconcile for post-hoc fix-up. Retry transitions to
  // queued but is ONLY permitted for pre-side-effect failures (service layer
  // enforces the side-effect safety check before firing `retry`).
  succeeded: { reconcile: "reconciliation_required" },
  partially_completed: { reconcile: "reconciliation_required" },
  failed: { reconcile: "reconciliation_required", retry: "queued" },
  cancelled: { reconcile: "reconciliation_required" },
  timed_out: { reconcile: "reconciliation_required", retry: "queued" },
  denied: {},
  budget_blocked: {},
  unavailable: {},
  reconciliation_required: {},
};

/** Set of terminal states. No action may run once in a terminal state. */
export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set<ExecutionState>([
  "succeeded",
  "partially_completed",
  "failed",
  "cancelled",
  "timed_out",
  "denied",
  "budget_blocked",
  "unavailable",
  "reconciliation_required",
]);

/** States that mean the action is allowed to begin doing work. */
export const RUNNABLE_STATES: ReadonlySet<ExecutionState> = new Set<ExecutionState>([
  "authorized",
  "queued",
  "running",
]);

/** True if `s` is terminal. */
export function isTerminal(s: ExecutionState): boolean {
  return TERMINAL_STATES.has(s);
}

/** True if an action may begin executing (i.e. side effects allowed). */
export function canRun(s: ExecutionState): boolean {
  return s === "authorized" || s === "queued";
}

/**
 * Apply a transition, returning the new state. Throws InvalidExecutionTransitionError
 * if the transition is not permitted.
 */
export function transition(
  runId: string,
  current: ExecutionState | null,
  event: Event,
  reason?: string,
  now: number = Date.now(),
): { next: ExecutionState; entry: ExecutionTransition } {
  const from: ExecutionState = current ?? "created";
  const next = TRANSITIONS[from]?.[event];
  if (!next) {
    throw new InvalidExecutionTransitionError(runId, from, event, reason);
  }
  return {
    next,
    entry: { from: current, to: next, at: now, reason },
  };
}

/** Validate that an initial record starts in "created". */
export function assertInitialState(state: ExecutionState): void {
  if (state !== "created") {
    throw new InvalidExecutionTransitionError("<new>", null, state, "new execution must start in 'created'");
  }
}

/** Terminal-state classification helpers. */
export const STATE_CLASS: Record<ExecutionState, "active" | "waiting" | "terminal"> = {
  created: "active",
  planned: "active",
  awaiting_policy: "waiting",
  awaiting_approval: "waiting",
  authorized: "active",
  queued: "waiting",
  running: "active",
  observing: "active",
  succeeded: "terminal",
  partially_completed: "terminal",
  failed: "terminal",
  cancelled: "terminal",
  timed_out: "terminal",
  denied: "terminal",
  budget_blocked: "terminal",
  unavailable: "terminal",
  reconciliation_required: "terminal",
};
