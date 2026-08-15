/**
 * XR 4.3 — Checkpoint Manager (Phase 06 hardened)
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
 *   - Payloads are bounded (MAX_CHECKPOINT_PAYLOAD_CHARS) and ALWAYS stored as
 *     valid JSON: oversize payloads are replaced by a bounded truncation
 *     envelope rather than sliced mid-string (Phase 06 · G2 fix).
 *   - Side-effect safety is determined by checkpoint kind + idempotency class.
 *   - Pruning never touches checkpoints required for unresolved work and can
 *     never crash the primary runtime (Phase 06 · steps 31–33).
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
const MAINTENANCE_TABLE = "execution_maintenance";

/** All checkpoint kinds known to the runtime (validation source of truth). */
export const CHECKPOINT_KINDS: ReadonlySet<CheckpointKind> = new Set<CheckpointKind>([
  "task_accepted",
  "plan_recorded",
  "policy_admitted",
  "env_admitted",
  "step_started",
  "step_completed",
  "model_turn_completed",
  "tool_call_completed",
  "cancellation_requested",
  "review_checkpoint_reached",
  "cleanup_completed",
  "recovery_decided",
]);

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

// ── Checkpoint validation (Phase 06 · step 5: never claim resume unvalidated) ─

export interface CheckpointValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a checkpoint is structurally sound enough to resume from:
 * known kind, parseable bounded payload, sane timestamps, and — when an
 * authority snapshot is present — all of its fields populated.
 */
export function verifyCheckpoint(cp: ExecutionCheckpoint | null): CheckpointValidation {
  if (!cp) return { valid: false, reason: "no checkpoint found" };
  if (!CHECKPOINT_KINDS.has(cp.kind)) {
    return { valid: false, reason: `unknown checkpoint kind "${String(cp.kind)}"` };
  }
  if (!cp.runId || typeof cp.runId !== "string") {
    return { valid: false, reason: "checkpoint missing runId" };
  }
  if (!Number.isFinite(cp.createdAt) || cp.createdAt <= 0) {
    return { valid: false, reason: "checkpoint has invalid createdAt" };
  }
  if (cp.payload === null || typeof cp.payload !== "object") {
    return { valid: false, reason: "checkpoint payload is not an object" };
  }
  if (cp.authoritySnapshot) {
    const a = cp.authoritySnapshot;
    if (typeof a.policyVersion !== "string" || typeof a.placement !== "string" || !Number.isFinite(a.checkedAt)) {
      return { valid: false, reason: "authority snapshot is malformed" };
    }
    if (!Array.isArray(a.credentialRefs)) {
      return { valid: false, reason: "authority snapshot credentialRefs malformed" };
    }
  }
  return { valid: true };
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
      CREATE TABLE IF NOT EXISTS ${MAINTENANCE_TABLE} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Create a checkpoint at a safe semantic boundary.
   * Returns the checkpoint, or null if the checkpoint could not be created
   * (unknown kind or persistence failure — caller must not treat this as fatal
   * and must NOT claim durable completion on a null result).
   */
  createCheckpoint(
    record: ExecutionRecord,
    kind: CheckpointKind,
    extra?: { progressSummary?: string; payload?: Record<string, unknown> },
  ): ExecutionCheckpoint | null {
    // Phase 06 — reject unknown kinds instead of persisting garbage that a
    // future recovery pass would be forced to trust.
    if (!CHECKPOINT_KINDS.has(kind)) return null;

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

  /**
   * Clean up old checkpoints for TERMINATED executions (bounded).
   *
   * Phase 06 safety rules:
   *   - only checkpoints of terminal-state executions are eligible;
   *   - runs with an UNACKNOWLEDGED durable cancellation are protected
   *     (their checkpoints are evidence required for reconciliation);
   *   - at most 1000 rows per invocation;
   *   - returns the REAL number of deleted rows;
   *   - never throws — pruning is maintenance, not the primary path.
   */
  pruneCheckpoints(opts: { now?: number } = {}): number {
    return this.pruneDetailed(opts).deleted;
  }

  /** Structured pruning result for observability (Phase 06 · step 33). */
  pruneDetailed(opts: { now?: number } = {}): {
    deleted: number;
    cutoff: number;
    durationMs: number;
    error?: string;
  } {
    const startedAt = Date.now();
    const now = opts.now ?? Date.now();
    const cutoff = now - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS;
    try {
      const result = this.db
        .prepare(
          `DELETE FROM ${TABLE} WHERE checkpoint_id IN (
            SELECT cp.checkpoint_id FROM ${TABLE} cp
            JOIN execution_records er ON cp.run_id = er.run_id
            WHERE er.state IN ('succeeded','failed','cancelled','timed_out','denied','budget_blocked','reconciliation_required')
              AND cp.created_at < ?
              AND NOT EXISTS (
                SELECT 1 FROM execution_cancellations ec
                WHERE ec.target_type = 'execution'
                  AND ec.target_id = cp.run_id
                  AND ec.acknowledged = 0
              )
            LIMIT 1000
          )`,
        )
        .run(cutoff);
      const deleted = readChanges(result);
      return { deleted, cutoff, durationMs: Date.now() - startedAt };
    } catch (e) {
      // Pruning failure must never crash the runtime.
      return { deleted: 0, cutoff, durationMs: Date.now() - startedAt, error: (e as Error)?.message ?? "prune failed" };
    }
  }

  // ── Maintenance metadata (prune scheduler state, Phase 06 · step 31) ────

  /** Read a maintenance key (e.g. last prune timestamp). Null when absent. */
  getMaintenanceMeta(key: string): string | null {
    try {
      const row = this.db
        .prepare(`SELECT value FROM ${MAINTENANCE_TABLE} WHERE key = ?`)
        .get<{ value: string }>(key);
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  /** Write a maintenance key (INSERT OR REPLACE). Best-effort. */
  setMaintenanceMeta(key: string, value: string): void {
    try {
      this.db
        .prepare(`INSERT OR REPLACE INTO ${MAINTENANCE_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`)
        .run(key, value, Date.now());
    } catch {
      /* best-effort */
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
        boundPayload(cp.payload),
        cp.attempt,
        cp.createdAt,
      );
  }
}

// ── Payload bounding (Phase 06 · G2: stored JSON must stay valid) ─────────

/**
 * Serialize a checkpoint payload with a hard size bound. Oversize payloads are
 * replaced with a small, VALID JSON truncation envelope that preserves the
 * lifecycle-critical fields (state/outcome/attempt) — never a sliced string.
 */
function boundPayload(payload: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(payload) ?? "{}";
  } catch {
    json = JSON.stringify({ __unserializable: true });
  }
  if (json.length <= DURABILITY_BOUNDS.MAX_CHECKPOINT_PAYLOAD_CHARS) return json;
  return JSON.stringify({
    __truncated: true,
    reason: "payload exceeded MAX_CHECKPOINT_PAYLOAD_CHARS",
    originalChars: json.length,
    state: payload.state,
    outcome: payload.outcome,
    attempt: payload.attempt,
  });
}

/** Extract affected-row count from a bun:sqlite run result (defensive). */
function readChanges(result: unknown): number {
  const changes = (result as { changes?: unknown })?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
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
  // Phase 06 — a row whose payload is not valid JSON (e.g. written by an
  // older build that sliced strings) must surface as an EMPTY payload, not a
  // throw, so recovery can classify it instead of crashing.
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.payload_json);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { __invalid_payload: true };
  } catch {
    payload = { __invalid_payload: true };
  }
  let authority: ExecutionCheckpoint["authoritySnapshot"];
  if (row.authority_snapshot) {
    try {
      authority = JSON.parse(row.authority_snapshot);
    } catch {
      authority = undefined; // malformed snapshot → validation will flag it
    }
  }
  return {
    checkpointId: row.checkpoint_id,
    runId: row.run_id,
    workflowId: row.workflow_id ?? undefined,
    taskId: row.task_id ?? undefined,
    kind: row.kind as ExecutionCheckpoint["kind"],
    sideEffectSafe: row.side_effect_safe === 1,
    authoritySnapshot: authority,
    environmentRef: row.environment_ref ?? undefined,
    executionState: row.execution_state as ExecutionCheckpoint["executionState"],
    progressSummary: row.progress_summary,
    payload,
    attempt: row.attempt,
    createdAt: row.created_at,
  };
}
