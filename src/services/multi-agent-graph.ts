/**
 * XR Phase 6 · Step 1 — the workflow DAG state law, extracted as PURE
 * functions from MultiAgentService (the service keeps the loop; this keeps
 * the LAW, so the contract suite can hammer state semantics without a
 * registry, a store, or a model).
 *
 * Invariants enforced here:
 *   · a task becomes `ready` ONLY when every dependency is `completed` AND
 *     positively approved (`reviewState` not changes_requested/rejected);
 *   · a failed review gate BLOCKS downstream work (fail closed — the blocked
 *     task records WHY);
 *   · `completed` requires EVERY task to be completed or cancelled — with the
 *     Phase 6 verifier slot in the template, an unsatisfied verifier keeps a
 *     workflow OUT of `completed` (F-16: completion must be earned);
 *   · `failed` propagates from any failed task; cancellation flips the whole
 *     tree cooperatively.
 */

import type { WorkflowRecord, WorkflowTask } from "../agents/types.ts";

export interface GraphEvents {
  onReady?: (task: WorkflowTask, deps: WorkflowTask[]) => void;
  onBlocked?: (task: WorkflowTask, gate: WorkflowTask | undefined) => void;
}

export function dependencyById(record: WorkflowRecord, taskId: string): WorkflowTask | undefined {
  return record.tasks.find((task) => task.taskId === taskId);
}

export function dependencyApproved(task: WorkflowTask): boolean {
  return (
    task.status === "completed" &&
    task.reviewState !== "changes_requested" &&
    task.reviewState !== "rejected"
  );
}

export function dependenciesReady(task: WorkflowTask, record: WorkflowRecord): boolean {
  return task.dependencies.every((depId) => {
    const dep = dependencyById(record, depId);
    return !!dep && dependencyApproved(dep);
  });
}

/** Flip pending tasks to ready/blocked as dependencies resolve. */
export function refreshReadyTasks(record: WorkflowRecord, events: GraphEvents = {}): void {
  for (const task of record.tasks) {
    if (task.status !== "pending") continue;
    const deps = task.dependencies
      .map((depId) => dependencyById(record, depId))
      .filter(Boolean) as WorkflowTask[];
    const failedGate = deps.find((dep) => dep.reviewState === "changes_requested" || dep.reviewState === "rejected");
    if (failedGate) {
      task.status = "blocked";
      task.blockedReason = `blocked by ${failedGate.taskId} (${failedGate.reviewState})`;
      task.updatedAt = Date.now();
      events.onBlocked?.(task, failedGate);
      continue;
    }
    if (deps.every((dep) => dep.status === "completed")) {
      task.status = deps.every((dep) => dependencyApproved(dep)) ? "ready" : "blocked";
      task.updatedAt = Date.now();
      if (task.status === "ready") events.onReady?.(task, deps);
      else events.onBlocked?.(task, undefined);
    }
  }
}

/**
 * Recompute the workflow-level state from task states (pure over the record).
 * Cancellation outranks completion; failure outranks review waits; an
 * unapproved verifier/review keeps the record `running`/`awaiting_review`,
 * never `completed`.
 */
export function recomputeWorkflowStatusCore(record: WorkflowRecord): void {
  const reviewTasks = record.tasks.filter(
    (task) => task.role === "reviewer" || task.role === "security_checker" || task.role === "verifier",
  );
  if (reviewTasks.some((task) => task.reviewState === "rejected")) record.reviewState = "rejected";
  else if (reviewTasks.some((task) => task.reviewState === "changes_requested")) record.reviewState = "changes_requested";
  else if (reviewTasks.length && reviewTasks.every((task) => task.reviewState === "approved" || task.reviewState === "not_required"))
    record.reviewState = "approved";
  else record.reviewState = "pending";

  if (record.cancellationState === "requested") {
    record.status = "paused";
    return;
  }
  if (record.tasks.some((task) => task.status === "failed")) {
    record.status = "failed";
    return;
  }
  if (record.tasks.some((task) => task.status === "blocked")) {
    record.status = "blocked";
    return;
  }
  if (record.tasks.some((task) => task.status === "awaiting_review")) {
    record.status = "awaiting_review";
    return;
  }
  if (record.tasks.every((task) => task.status === "completed" || task.status === "cancelled")) {
    record.status = "completed";
    record.currentAgentId = undefined;
    record.endedAt = record.endedAt ?? Date.now();
    return;
  }
  record.status = "running";
}
