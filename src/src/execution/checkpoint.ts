/**
 * XR 4.3 — Checkpoint Manager
 *
 * Creates, validates, and persists safe semantic checkpoints that allow
 * long-running work to survive process interruption.
 *
 * Checkpoints occur at safe semantic boundaries only:
 *   - task accepted, plan recorded, policy admitted
 *   - environment admitted, step started, step completed
 *   - model turn completed, tool call completed
 *   - cancellation requested, review reached, cleanup completed
 *
 * Rules:
 *   - A checkpoint must be written BEFORE the system claims it can resume.
 *   - Checkpoints never change execution state; they are metadata snapshots.
 *   - Payloads are bounded (MAX_CHECKPOINT_PAYLOAD_CHARS).
 *   - Side-effect safety is determined by checkpoint kind + idempotency class.
 */

import { randomUUID } from "node:crypto";
import type { ExecutionDb } from "./repository.ts";
import {
  DURABILITY_BOUNDS,
  type CheckpointKind,
  type ExecutionCheckpoint,
  type ExecutionRecord,
  type IdempotencyClass,
} from "./types.ts";

const TABLE = "execution_checkpoints";

// ── Side-effect safety by checkpoint kind ─────────────────────────────────

/** Checkpoint kinds where it is always safe to auto-resume. */
const ALWAYS_SAFE_KINDS: ReadonlySet<CheckpointKind> = new Set<CheckpointKind>([
  "task_accepted",
  "plan_recorded",
  "policy_admitted",
  "env_admitted",
  "review_checkpoint_reached",
  "cleanup_completed",
  "recovery_decided",
]);

/** Checkpoint kinds where safety depends on idempotency. */
const IDEMPOTENCY_DEPENDENT_KINDS: ReadonlySet<CheckpointKind> = new Set<CheckpointKind>([
  "step_started",
  "step_completed",
  "model_turn_completed",
  "tool_call_completed",
]);

/** Determine if resuming from a checkpoint is safe given the action's idempotency. */
export function isSideEffectSafe(kind: CheckpointKind, idempotency?: IdempotencyClass): boolean {
  if (ALWAYS_SAFE_KINDS.has(kind)) return true;
  if (IDEMPOTENCY_DEPENDENT_KINDS.has(kind)) {
    // Safe if naturally idempotent or has idempotency key
    return idempotency === "naturally_idempotent" || idempotency === "idempotent_with_key";
  }
  // cancellation_requested: we must honor the cancel, but side-effect safety
  // depends on whether the action had already started. This is determined by
  // the execution state at crash time, not the checkpoint kind alone.
  if (kind === "cancellation_requested") return false; // conservative
  return false;
}

// ── Checkpoint Manager ────────────────────────────────────────────────────

export class CheckpointManager {
  constructor(private readonly db: ExecutionDb) {}

  /** Idempotent schema migration. */
  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workflow_id TEXT,
        task_id TEXT,
        kind TEXT NOT NULL,
        side_effect_safe INTEGER NOT NULL DEFAULT 0,
        authority_snapshot TEXT,
        environment_ref TEXT,
        execution_state TEXT NOT NULL,
        progress_summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cp_run ON ${TABLE}(run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cp_workflow ON ${TABLE}(workflow_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cp_kind ON ${TABLE}(kind, created_at DESC);
    `);
  }

  /**
   * Create a checkpoint at a safe semantic boundary.
   * Returns the checkpoint id, or null if the checkpoint could not be created
   * (e.g. persistence failure — caller should not treat this as fatal).
   */
  createCheckpoint(
    record: ExecutionRecord,
    kind: CheckpointKind,
    extra?: { progressSummary?: string; payload?: Record<string, unknown> },
  ): ExecutionCheckpoint | null {
    const now = Date.now();
    const idempotency = record.action?.idempotency;
    const safe = isSideEffectSafe(kind, idempotency);
    const progressSummary = extra?.progressSummary ??
      `${kind} — ${record.action?.capability.kind ?? "unknown"}:${record.action?.capability.name ?? "unknown"}`;

    const checkpoint: ExecutionCheckpoint = {
      checkpointId: `cp_${randomUUID().slice(0, 10)}`,
      runId: record.id.runId,
      workflowId: record.id.workflowId,
      taskId: record.id.taskId,
      kind,
      sideEffectSafe: safe,
      authoritySnapshot: record.trust
        ? {
            policyVersion: record.trust.classification.classifierVersion,
            placement: record.trust.decision.placement,
            credentialRefs: record.trust.credentialScope?.refs.map((r) => r.refId) ?? [],
            checkedAt: now,
          }
        : undefined,
      environmentRef: record.trust?.decision.environmentId,
      executionState: record.state,
      progressSummary,
      payload: {
        state: record.state,
        outcome: record.outcome?.kind,
        attempt: record.id.attempt,
        stepCount: record.id.attempt,
        ...(extra?.payload ?? {}),
      },
      attempt: record.id.attempt,
      createdAt: now,
    };

    try {
      this.persist(checkpoint);
      return checkpoint;
    } catch {
      // Persistence failure does not crash the execution — checkpoint is best-effort.
      return null;
    }
  }

  /** Retrieve the latest checkpoint for an execution. */
  getLatestCheckpoint(runId: string): ExecutionCheckpoint | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM ${TABLE} WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get<CheckpointRow>(runId);
      return row ? rowToCheckpoint(row) : null;
    } catch {
      return null;
    }
  }

  /** Retrieve all checkpoints for an execution (bounded). */
  getCheckpoints(runId: string, limit = 50): ExecutionCheckpoint[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM ${TABLE} WHERE run_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all<CheckpointRow>(runId, limit);
      return rows.map(rowToCheckpoint);
    } catch {
      return [];
    }
  }

  /** Retrieve the latest checkpoint for each workflow (for startup discovery). */
  getLatestWorkflowCheckpoints(workflowId: string): ExecutionCheckpoint[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${TABLE} WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all<CheckpointRow>(workflowId, 100);
      return rows.map(rowToCheckpoint);
    } catch {
      return [];
    }
  }

  /** Clean up old checkpoints for terminated executions. */
  pruneCheckpoints(): number {
    const cutoff = Date.now() - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS;
    try {
      this.db.prepare(
        `DELETE FROM ${TABLE} WHERE run_id IN (
          SELECT DISTINCT cp.run_id FROM ${TABLE} cp
          LEFT JOIN execution_records er ON cp.run_id = er.run_id
          WHERE er.state IN ('succeeded','failed','cancelled','timed_out','denied','budget_blocked','reconciliation_required')
            AND cp.created_at < ?
          LIMIT 1000
        )`,
      ).run(cutoff);
      return 0; // SQLite doesn't report affected rows via bun in all cases
    } catch {
      return 0;
    }
  }

  private persist(cp: ExecutionCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO ${TABLE} (checkpoint_id, run_id, workflow_id, task_id, kind,
          side_effect_safe, authority_snapshot, environment_ref, execution_state,
          progress_summary, payload_json, attempt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cp.checkpointId,
        cp.runId,
        cp.workflowId ?? null,
        cp.taskId ?? null,
        cp.kind,
        cp.sideEffectSafe ? 1 : 0,
        cp.authoritySnapshot ? JSON.stringify(cp.authoritySnapshot) : null,
        cp.environmentRef ?? null,
        cp.executionState,
        cp.progressSummary.slice(0, 2000),
        JSON.stringify(cp.payload).slice(0, DURABILITY_BOUNDS.MAX_CHECKPOINT_PAYLOAD_CHARS),
        cp.attempt,
        cp.createdAt,
      );
  }
}

// ── Internal row type ─────────────────────────────────────────────────────

interface CheckpointRow {
  checkpoint_id: string;
  run_id: string;
  workflow_id: string | null;
  task_id: string | null;
  kind: string;
  side_effect_safe: number;
  authority_snapshot: string | null;
  environment_ref: string | null;
  execution_state: string;
  progress_summary: string;
  payload_json: string;
  attempt: number;
  created_at: number;
}

function rowToCheckpoint(row: CheckpointRow): ExecutionCheckpoint {
  return {
    checkpointId: row.checkpoint_id,
    runId: row.run_id,
    workflowId: row.workflow_id ?? undefined,
    taskId: row.task_id ?? undefined,
    kind: row.kind as ExecutionCheckpoint["kind"],
    sideEffectSafe: row.side_effect_safe === 1,
    authoritySnapshot: row.authority_snapshot ? JSON.parse(row.authority_snapshot) : undefined,
    environmentRef: row.environment_ref ?? undefined,
    executionState: row.execution_state as ExecutionCheckpoint["executionState"],
    progressSummary: row.progress_summary,
    payload: JSON.parse(row.payload_json),
    attempt: row.attempt,
    createdAt: row.created_at,
  };
}
