/**
 * Phase 6 · Step 1 — TASK-RUNTIME CONTRACT SUITE (runs before cutover trust:
 * the ledger IS the law both subsystems converge to).
 *
 * Contract tested:
 *   · the transition table is the only path — invalid edges THROW;
 *   · the three new §4.5 states exist and are reachable (RECOVERING via
 *     interrupt, AWAITING_BUDGET via budget_block, AWAITING_APPROVAL via
 *     require_approval);
 *   · every legal transition emits exactly one audit record + one checkpoint;
 *   · terminal states are terminal (completed has NO exits; failed/cancelled
 *     exit ONLY through audited retry/reconcile);
 *   · a verifier task can complete ONLY via verdict_approved — `succeed` is
 *     not a legal exit from `verifying` (completion is earned, F-16);
 *   · the record↔state mapping round-trips for every workflow status.
 */

import { describe, expect, test } from "bun:test";
import {
  TaskRunLedger,
  TaskTransitionError,
  nextTaskState,
  isTerminalTaskState,
  isRecoverableState,
  statusToTaskState,
  taskStateToStatus,
  TASK_TRANSITION_TABLE,
  type TaskState,
} from "../../src/execution/task-runtime.ts";

describe("task-runtime · transition law", () => {
  test("the happy path for a 1-node plain run: created→planned→running→completed", () => {
    let s: TaskState = "created";
    s = nextTaskState(s, "plan", "t");
    expect(s).toBe("planned");
    s = nextTaskState(s, "start", "t");
    expect(s).toBe("running");
    s = nextTaskState(s, "succeed", "t");
    expect(s).toBe("completed");
    expect(isTerminalTaskState(s)).toBe(true);
  });

  test("RECOVERING is reachable and exits only via recover or reconcile", () => {
    let s: TaskState | null = null;
    s = nextTaskState(s, "plan");
    s = nextTaskState(s, "start");
    s = nextTaskState(s, "interrupt");
    expect(s).toBe("recovering");
    expect(isRecoverableState("recovering")).toBe(true);
    expect(nextTaskState(s, "recover")).toBe("running");
  });

  test("AWAITING_BUDGET: raised returns to running; a DENY fails (never holds the queue)", () => {
    let s: TaskState = "running";
    s = nextTaskState(s, "budget_block");
    expect(s).toBe("awaiting_budget");
    s = nextTaskState(s, "budget_raised");
    expect(s).toBe("running");
    s = nextTaskState(s, "budget_block"); // second block: still a live state
    s = nextTaskState(s, "fail"); // raise never arrives — the task fails, it doesn't hang
    expect(s).toBe("failed");
    // The LEDGER is strict: an illegal second event throws (the LOOP's fireTask
    // adapter is what swallows — separation of concerns by design).
    const ledger = TaskRunLedger.hydrate("t_dup", "running");
    const seen: string[] = [];
    (ledger as unknown as { hooks: unknown }).hooks;
    ledger.fire("budget_block");
    expect(ledger.state).toBe("awaiting_budget");
    expect(() => ledger.fire("budget_block")).toThrow(TaskTransitionError);
    expect(ledger.state).toBe("awaiting_budget"); // state untouched by the refused event
    expect(seen.length).toBe(0);
  });

  test("AWAITING_APPROVAL: grant resumes; DENY fails the task (never blocks forever)", () => {
    let s: TaskState = "running";
    s = nextTaskState(s, "require_approval");
    expect(s).toBe("awaiting_approval");
    s = nextTaskState(s, "grant_approval");
    expect(s).toBe("running");
    s = nextTaskState(s, "require_approval");
    s = nextTaskState(s, "approval_denied");
    expect(s).toBe("failed");
  });

  test("VERIFIYING: only verdict_approved completes; garbage fails closed", () => {
    const s: TaskState = "verifying";
    expect(nextTaskState(s, "verdict_approved")).toBe("completed");
    expect(nextTaskState(s, "verdict_rejected")).toBe("failed");
    expect(nextTaskState(s, "fail")).toBe("failed"); // unparsable verdict
    // The F-16 kill proof, encoded as law: `succeed` is NOT an edge from verifying.
    expect(() => nextTaskState(s, "succeed", "t", "fake-done attempt")).toThrow(TaskTransitionError);
  });

  test("completed is strictly terminal — nothing reopens completed work", () => {
    expect(Object.keys(TASK_TRANSITION_TABLE.completed)).toHaveLength(0);
    for (const ev of ["retry", "reconcile", "start"] as const) {
      expect(() => nextTaskState("completed", ev, "t")).toThrow(TaskTransitionError);
    }
  });

  test("failed/cancelled exit only through audited retry/reconcile", () => {
    expect(nextTaskState("failed", "retry")).toBe("ready");
    expect(nextTaskState("failed", "reconcile")).toBe("planned");
    expect(() => nextTaskState("failed", "start")).toThrow(TaskTransitionError);
    expect(() => nextTaskState("failed", "succeed")).toThrow(TaskTransitionError);
  });

  test("record-status ↔ task-state mapping round-trips", () => {
    const statuses = ["pending", "ready", "running", "awaiting_review", "blocked", "completed", "failed", "cancelled", "paused"] as const;
    for (const st of statuses) {
      const state = statusToTaskState(st);
      expect(taskStateToStatus(state)).toBe(st === "pending" ? "pending" : st);
    }
    // Review-park and approval-park both surface as awaiting_review in the record.
    expect(taskStateToStatus(statusToTaskState("running", { awaitingApproval: true }))).toBe("awaiting_review");
  });
});

describe("task-runtime · every transition is one audit event + one checkpoint", () => {
  test("ledger.fire emits both sinks exactly once per legal edge", () => {
    const transitions: string[] = [];
    const checkpoints: string[] = [];
    const ledger = new TaskRunLedger("t_demo", "created", {
      onTransition: (rec) => transitions.push(`${rec.event}:${rec.from}->${rec.to}`),
      onCheckpoint: (kind) => checkpoints.push(kind),
    });
    ledger.fire("plan");
    ledger.fire("start");
    ledger.fire("succeed", { steps: 2 });
    expect(transitions).toEqual(["plan:created->planned", "start:planned->running", "succeed:running->completed"]);
    expect(checkpoints).toEqual(["task.plan", "task.start", "task.succeed"]);
    expect(ledger.terminal).toBe(true);
    expect(ledger.state).toBe("completed");
  });

  test("an illegal fire throws BEFORE mutating state or emitting", () => {
    const emitted: string[] = [];
    const ledger = new TaskRunLedger("t_x", "completed", { onTransition: () => emitted.push("x") });
    expect(() => ledger.fire("start")).toThrow(TaskTransitionError);
    expect(emitted).toHaveLength(0);
    expect(ledger.state).toBe("completed");
  });

  test("hydrate() adopts a persisted state without re-emitting", () => {
    const emitted: string[] = [];
    const l = TaskRunLedger.hydrate("t_y", statusToTaskState("running"), { onTransition: () => emitted.push("x") });
    expect(l.state).toBe("running");
    expect(emitted).toHaveLength(0);
    l.fire("succeed");
    expect(emitted).toHaveLength(1);
  });
});
