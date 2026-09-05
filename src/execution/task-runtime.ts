/**
 * XR Phase 6 · Step 1 — the unified Task Runtime.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * XR had TWO task runtimes: durable workflow records mutated ad-hoc by
 * `MultiAgentService` (`WorkflowTask.status` strings), and plain `xr run`
 * sessions, which recorded steps but were NOT a task at all — nothing was
 * checkpointed, so a crash lost the run (F-28). `src/execution/state-machine.ts`
 * already proved the pattern for ACTION-level transitions; this module promotes
 * that machine to the TASK level and makes BOTH subsystems clients of it:
 *
 *   · a workflow worker task = one TaskRunLedger instance
 *   · a plain run = a 1-node task (created → planned → running → terminal)
 *
 * Every transition (1) validates against the explicit table below, (2) emits
 * an audit event through the caller's sink, and (3) is journaled as a
 * checkpoint row when a checkpoint sink is wired (hash-chained per task).
 * No component may record task progress by writing the persisted record
 * directly without firing the ledger's event — that is what makes the audit
 * trail and the resumable state the SAME fact, not two drift-prone copies.
 *
 * The ledger is deliberately transport-free: it does not know about SQLite.
 * `MultiAgentService`, `AgentService` and the checkpoint repo inject sinks.
 *
 * New states relative to §4.5: RECOVERING (crash-resume in progress),
 * AWAITING_BUDGET (partition ceiling reached, human raise possible), durable
 * AWAITING_APPROVAL (the approval itself lives in the P2 approval store;
 * this state marks the task as PARKED on it, so a restart resumes into the
 * right state rather than re-dispatching the task).
 */

/** Task-level states. Distinct from ExecutionState (action-level, fabric). */
export type TaskState =
  | "created"
  | "planned"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "awaiting_budget"
  | "verifying"
  | "recovering"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskEvent =
  | "plan"
  | "dispatch"
  | "start"
  | "require_approval"
  | "grant_approval"
  | "approval_denied"
  | "budget_block"
  | "budget_raised"
  | "verify"
  | "verdict_approved"
  | "verdict_rejected"
  | "succeed"
  | "fail"
  | "block"
  | "unblock"
  | "cancel"
  | "interrupt"
  | "recover"
  | "reconcile"
  | "retry";

/** Explicit allowed-set. Keep it small, total, and testable. */
const TRANSITIONS: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
  created: {
    plan: "planned",
    cancel: "cancelled",
    fail: "failed",
  },
  planned: {
    dispatch: "ready",
    start: "running", // a 1-node plain run goes planned → running
    cancel: "cancelled",
    fail: "failed",
    budget_block: "awaiting_budget",
    require_approval: "awaiting_approval",
  },
  ready: {
    start: "running",
    block: "blocked",
    cancel: "cancelled",
    fail: "failed",
    budget_block: "awaiting_budget",
    require_approval: "awaiting_approval",
  },
  running: {
    succeed: "completed",
    verify: "verifying",
    fail: "failed",
    cancel: "cancelled",
    require_approval: "awaiting_approval",
    budget_block: "awaiting_budget",
    interrupt: "recovering",
  },
  awaiting_approval: {
    grant_approval: "running",
    approval_denied: "failed",
    cancel: "cancelled",
    fail: "failed",
    interrupt: "recovering",
  },
  awaiting_budget: {
    budget_raised: "running",
    cancel: "cancelled",
    fail: "failed",
    interrupt: "recovering",
  },
  verifying: {
    verdict_approved: "completed",
    verdict_rejected: "failed",
    fail: "failed", // unparsable / absent verdict ⇒ failure (never approval)
    cancel: "cancelled",
    interrupt: "recovering",
  },
  blocked: {
    unblock: "ready",
    reconcile: "planned",
    cancel: "cancelled",
    fail: "failed",
  },
  recovering: {
    recover: "running", // resume from checkpoint into execution
    reconcile: "planned", // rebuild the plan instead of resuming mid-flight
    fail: "failed",
    cancel: "cancelled",
  },
  // Terminal states — the ONLY exit is an explicit, audited reconcile/retry
  // for retryable failures. Nothing silently reopens completed work.
  completed: {},
  failed: { retry: "ready", reconcile: "planned" },
  cancelled: { retry: "ready", reconcile: "planned" },
};

export class TaskTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: TaskState,
    public readonly event: TaskEvent,
    reason?: string,
  ) {
    super(`task ${taskId}: event "${event}" is not allowed from state "${from}"${reason ? ` (${reason})` : ""}`);
    this.name = "TaskTransitionError";
  }
}

const TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>(["completed", "failed", "cancelled"]);

export function isTerminalTaskState(s: TaskState): boolean {
  return TERMINAL.has(s);
}

/** States in which real work (side effects) may be in flight. */
export const IN_FLIGHT_TASK_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  "running",
  "verifying",
  "awaiting_approval",
  "awaiting_budget",
]);

/** States a crashed run must be explicitly recovered FROM (checkpoint resume). */
export function isRecoverableState(s: TaskState): boolean {
  return IN_FLIGHT_TASK_STATES.has(s) || s === "recovering";
}

/** Pure next-state function. Throws `TaskTransitionError` on invalid edges. */
export function nextTaskState(current: TaskState | null, event: TaskEvent, taskId = "<new>", reason?: string): TaskState {
  const from: TaskState = current ?? "created";
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new TaskTransitionError(taskId, from, event, reason);
  return next;
}

/** Full edge table for contract tests (the suite asserts this table, not prose). */
export const TASK_TRANSITION_TABLE: Readonly<Record<TaskState, Partial<Record<TaskEvent, TaskState>>>> = TRANSITIONS;

// ── Mapping to the workflow record's persisted vocabulary ──────────────────
//
// `WorkflowTask.status` predates the runtime. The mapping keeps both readable:
// the record stays the persistence format, the ledger owns the transition law.

export function statusToTaskState(
  status: string,
  extra?: { awaitingApproval?: boolean; awaitingBudget?: boolean; verifying?: boolean },
): TaskState {
  switch (status) {
    case "pending":
      return "created";
    case "ready":
      return "ready";
    case "running":
      return extra?.awaitingApproval ? "awaiting_approval" : extra?.awaitingBudget ? "awaiting_budget" : extra?.verifying ? "verifying" : "running";
    case "awaiting_review":
      return "verifying";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused":
      return "recovering";
    default:
      return "created";
  }
}

export function taskStateToStatus(state: TaskState): "pending" | "ready" | "running" | "awaiting_review" | "blocked" | "completed" | "failed" | "cancelled" | "paused" {
  switch (state) {
    case "created":
    case "planned":
      return "pending";
    case "ready":
      return "ready";
    case "running":
      return "running";
    case "verifying":
    case "awaiting_approval":
    case "awaiting_budget":
      return "awaiting_review";
    case "blocked":
      return "blocked";
    case "recovering":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

// ── The ledger ──────────────────────────────────────────────────────────────

export interface TaskTransitionRecord {
  readonly taskId: string;
  readonly from: TaskState;
  readonly to: TaskState;
  readonly event: TaskEvent;
  readonly at: number;
  readonly detail?: Record<string, unknown>;
}

export interface TaskLedgerHooks {
  /** Audit sink — invoked for EVERY transition, before the checkpoint write. */
  onTransition?: (rec: TaskTransitionRecord) => void;
  /** Checkpoint sink — durable journal (task_checkpoints row via CheckpointRepo). */
  onCheckpoint?: (kind: string, payload: Record<string, unknown>) => void;
  /** Read the current state when hydrating from persisted records. */
}

/**
 * One ledger instance per task run (workflow worker or plain run). The ledger
 * owns the state; the service owns the persistence. `fire()` is the only
 * mutator, which is what makes "every transition = audit event" an
 * implementation fact rather than a convention.
 */
export class TaskRunLedger {
  private _state: TaskState;
  private _history: TaskTransitionRecord[] = [];

  constructor(
    public readonly taskId: string,
    initial: TaskState | null = null,
    private hooks: TaskLedgerHooks = {},
  ) {
    this._state = initial ?? "created";
  }

  get state(): TaskState {
    return this._state;
  }

  get history(): readonly TaskTransitionRecord[] {
    return this._history;
  }

  /** True when no further work is legal for this task. */
  get terminal(): boolean {
    return isTerminalTaskState(this._state);
  }

  /**
   * Apply `event`, emit audit + checkpoint. An invalid event THROWS — callers
   * must not paper over a transition violation by persisting anyway; the throw
   * is what turns a state-machine bug into a failed task instead of a corrupt
   * record (fail closed).
   */
  fire(event: TaskEvent, detail?: Record<string, unknown>): TaskTransitionRecord {
    const from = this._state;
    const to = nextTaskState(from, event, this.taskId, detail ? undefined : undefined);
    const rec: TaskTransitionRecord = {
      taskId: this.taskId,
      from,
      to,
      event,
      at: Date.now(),
      detail,
    };
    this._state = to;
    this._history.push(rec);
    try {
      this.hooks.onTransition?.(rec);
      this.hooks.onCheckpoint?.(`task.${event}`, { from, to, detail });
    } catch {
      // Audit/checkpoint sinks are observational: a sink failure must not
      // corrupt the in-memory truth of the transition (the transition already
      // happened). Durability of the checkpoint itself is asserted by the
      // WriteGate contract, not by re-throwing here.
    }
    return rec;
  }

  /** Hydrate a ledger from a persisted record without re-auditing. */
  static hydrate(taskId: string, state: TaskState, hooks: TaskLedgerHooks = {}): TaskRunLedger {
    return new TaskRunLedger(taskId, state, hooks);
  }
}
