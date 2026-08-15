/**
 * XR 4.3 — Recovery Manager
 *
 * Discovers unfinished work at startup, classifies recoverability, and
 * coordinates safe resumption or blocking of interrupted executions.
 *
 * Guiding rule:
 *   XR may resume known-safe work automatically, but it must never repeat
 *   an unknown external side effect merely because a process restarted.
 *
 * Recovery workflow:
 *   1. Discovery — query for active/in-flight execution records
 *   2. Lease acquisition — prevent duplicate recovery
 *   3. Classification — determine recovery action per record
 *   4. Decision persistence — record what was decided
 *   5. Resume only safe work; block the rest
 *   6. Notify user — expose recovery status
 */

import { randomUUID } from "node:crypto";
import type { ExecutionDb } from "./repository.ts";
import { wasInFlight, sideEffectPossible } from "./state-machine.ts";
import { verifyCheckpoint, isSideEffectSafe, type CheckpointManager } from "./checkpoint.ts";
import type { LeaseManager } from "./lease.ts";
import {
  DURABILITY_BOUNDS,
  type DurableCancellation,
  type EnvironmentAttachment,
  type ExecutionCheckpoint,
  type ExecutionRecord,
  type ExecutionState,
  type IdempotencyClass,
  type RecoveryAction,
  type RecoveryClassification,
  type RecoveryDecision,
  type RecoveryState,
  type RecoveryStatus,
} from "./types.ts";

const RECOVERY_TABLE = "execution_recoveries";
const CANCEL_TABLE = "execution_cancellations";
const ENV_TABLE = "environment_attachments";

// ── Phase 06 — verification hooks (honesty gates) ─────────────────────────

/**
 * Optional integrity gates consulted during classification/resume. Recovery
 * must never resume from corrupted state or on a broken audit chain, and must
 * not continue under authority that is no longer valid. Hooks are optional so
 * pre-Phase-06 wiring keeps identical behavior; when present they are BINDING.
 */
export interface RecoveryVerificationHooks {
  /**
   * Audit-chain integrity. Returning `{ valid: false }` BLOCKS recovery for
   * every in-flight execution — audit integrity is a hard security boundary.
   */
  auditChain?: () => { valid: boolean; reason?: string };
  /**
   * Authority revalidation (spec step 24/49): is the checkpoint's authority
   * snapshot still acceptable under CURRENT policy/credential state?
   */
  authority?: (
    snapshot: NonNullable<import("./types.ts").ExecutionCheckpoint["authoritySnapshot"]>,
    record: ExecutionRecord,
  ) => { ok: boolean; reason?: string };
}

/** Result of verifying that a resume claim has a real basis (spec step 5). */
export interface RecoveryBasis {
  ok: boolean;
  reason: string;
  checkpoint: import("./types.ts").ExecutionCheckpoint | null;
}

// ── Recovery Manager ──────────────────────────────────────────────────────

export class RecoveryManager {
  constructor(
    private readonly db: ExecutionDb,
    private readonly checkpoints: CheckpointManager,
    private readonly leases: LeaseManager,
    private readonly hooks: RecoveryVerificationHooks = {},
  ) {}

  /** Idempotent schema migration for all recovery tables. */
  migrate(): void {
    // Recovery decisions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${RECOVERY_TABLE} (
        recovery_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        recovery_action TEXT NOT NULL,
        classification TEXT NOT NULL,
        reason TEXT NOT NULL,
        decided_by TEXT NOT NULL,
        decided_at INTEGER NOT NULL,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_recovery_target ON ${RECOVERY_TABLE}(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_recovery_decided ON ${RECOVERY_TABLE}(decided_at DESC);
    `);

    // Durable cancellations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${CANCEL_TABLE} (
        cancellation_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        requested_by TEXT NOT NULL,
        reason TEXT,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_at INTEGER,
        side_effect_possible INTEGER NOT NULL DEFAULT 0,
        final_state TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cancel_target ON ${CANCEL_TABLE}(target_type, target_id);
    `);

    // Environment attachments
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${ENV_TABLE} (
        attachment_id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        backend_id TEXT NOT NULL,
        placement TEXT NOT NULL,
        tier TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        pid INTEGER,
        created_at INTEGER NOT NULL,
        last_known_at INTEGER NOT NULL,
        cleanup_state TEXT,
        quarantined INTEGER NOT NULL DEFAULT 0,
        quarantine_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_env_exec ON ${ENV_TABLE}(execution_id);
      CREATE INDEX IF NOT EXISTS idx_env_ws ON ${ENV_TABLE}(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_env_state ON ${ENV_TABLE}(lifecycle_state);
    `);
  }

  /**
   * Discover all executions that were in-flight and must be recovered.
   * Called at startup. Returns records sorted by priority (running > queued > awaiting_approval).
   */
  discoverUnfinished(workspaceId: string): ExecutionRecord[] {
    const states: ExecutionState[] = [
      "queued",
      "running",
      "observing",
      "awaiting_approval",
      "awaiting_policy",
      "authorized",
    ];

    const rows = this.db
      .prepare(
        `SELECT record_json FROM execution_records
         WHERE workspace_id = ? AND state IN (${states.map(() => "?").join(",")})
         ORDER BY
           CASE state
             WHEN 'running' THEN 0
             WHEN 'observing' THEN 0
             WHEN 'awaiting_approval' THEN 1
             WHEN 'awaiting_policy' THEN 2
             WHEN 'authorized' THEN 3
             WHEN 'queued' THEN 4
             ELSE 5 END,
           created_at DESC
         LIMIT ?`,
      )
      .all<{ record_json: string }>(workspaceId, ...states, 200);

    return rows
      .map((r) => {
        try {
          return JSON.parse(r.record_json) as ExecutionRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is ExecutionRecord => r !== null);
  }

  /**
   * Classify a single interrupted execution and determine the recovery action.
   */
  classify(
    record: ExecutionRecord,
  ): { action: RecoveryAction; classification: RecoveryClassification; reason: string } {
    const state = record.state;
    const lastCheckpoint = this.checkpoints.getLatestCheckpoint(record.id.runId);
    const durableCancel = this.getDurableCancellation("execution", record.id.runId);

    // 1. Honor durable cancellation FIRST
    if (durableCancel && !durableCancel.acknowledged) {
      if (durableCancel.sideEffectPossible) {
        return {
          action: "blocked",
          classification: "cancellation_pending",
          reason: `Cancellation was requested before crash but side effect may have occurred. Manual reconciliation required.`,
        };
      }
      return {
        action: "blocked",
        classification: "cancellation_pending",
        reason: `Cancellation was requested before crash. Execution must not resume.`,
      };
    }

    // 1b. Phase 06 — audit-chain integrity is a HARD boundary. When a
    // verifier is wired and reports the chain broken, nothing may resume
    // silently, regardless of checkpoints or idempotency (spec step 23/47).
    if (this.hooks.auditChain) {
      let chain: { valid: boolean; reason?: string };
      try {
        chain = this.hooks.auditChain();
      } catch (e) {
        chain = { valid: false, reason: `audit verification failed: ${(e as Error)?.message ?? "unknown"}` };
      }
      if (!chain.valid) {
        return {
          action: "blocked",
          classification: "audit_chain_broken",
          reason: `Audit chain integrity check failed — recovery blocked: ${chain.reason ?? "chain invalid"}`,
        };
      }
    }

    // 1c. Phase 06 — a checkpoint that will serve as a resume basis must be
    // structurally valid. Corrupted checkpoints block, never resume (step 22).
    if (lastCheckpoint) {
      const check = verifyCheckpoint(lastCheckpoint);
      if (!check.valid) {
        return {
          action: "blocked",
          classification: "checkpoint_invalid",
          reason: `Latest checkpoint is invalid (${check.reason ?? "unknown"}) — refusing to resume from corrupted state.`,
        };
      }
      // Authority revalidation (spec step 24/49): a checkpoint recorded under
      // authority X does not grant authority Y after restart.
      if (lastCheckpoint.authoritySnapshot && this.hooks.authority) {
        let verdict: { ok: boolean; reason?: string };
        try {
          verdict = this.hooks.authority(lastCheckpoint.authoritySnapshot, record);
        } catch (e) {
          verdict = { ok: false, reason: `authority validation failed: ${(e as Error)?.message ?? "unknown"}` };
        }
        if (!verdict.ok) {
          return {
            action: "blocked",
            classification: "authority_expired",
            reason: `Authority snapshot no longer valid — ${verdict.reason ?? "authority mismatch"}. Re-admission required.`,
          };
        }
      }
    }

    // 2. Check if action was pre-flight (safe)
    if (!wasInFlight(state) || state === "awaiting_approval") {
      return {
        action: "auto_resume",
        classification: "safe",
        reason: `Execution was in state "${state}" — no side effects possible. Safe to retry from last checkpoint.`,
      };
    }

    // 3. If we have a checkpoint and the checkpoint says safe, auto-resume
    if (lastCheckpoint && lastCheckpoint.sideEffectSafe) {
      return {
        action: "auto_resume",
        classification: "safe",
        reason: `Last checkpoint "${lastCheckpoint.kind}" indicates safe resume.`,
      };
    }

    // 4. Check idempotency + state at crash
    const idempotency: IdempotencyClass = record.action?.idempotency ?? "unknown_unsafe";

    if (sideEffectPossible(state)) {
      if (idempotency === "naturally_idempotent") {
        return {
          action: "auto_resume",
          classification: "safe",
          reason: `Action is naturally idempotent — safe to retry even though execution was in "${state}".`,
        };
      }

      if (idempotency === "idempotent_with_key" && record.action?.idempotencyKey) {
        return {
          action: "auto_resume",
          classification: "safe",
          reason: `Action has idempotency key — safe to retry with same key.`,
        };
      }

      // Non-idempotent or unknown — side effect may have occurred
      return {
        action: "requires_approval",
        classification: "unknown_side_effect",
        reason: `Action was in state "${state}" with idempotency "${idempotency}". Side effect may have occurred. User approval required.`,
      };
    }

    // 5. Check authority/environment
    if (record.trust?.quarantined) {
      return {
        action: "blocked",
        classification: "environment_lost",
        reason: "Environment was quarantined. Cannot resume without explicit cleanup.",
      };
    }

    if (!lastCheckpoint) {
      return {
        action: "requires_approval",
        classification: "unknown_side_effect",
        reason: "No checkpoint found for active execution. Side-effect status unknown.",
      };
    }

    // Default: safe to resume from checkpoint
    return {
      action: "auto_resume",
      classification: "safe",
      reason: `Execution in "${state}" with known checkpoint — safe to resume.`,
    };
  }

  /**
   * Phase 06 · Step 5 — "checkpoint BEFORE claiming resume."
   *
   * XR must NEVER report "resumed" until a valid recovery checkpoint has been
   * loaded AND verified. This is the gate the resume path must cross. It runs
   * the full verification sequence:
   *
   *   locate latest checkpoint → validate checkpoint structure → validate
   *   execution state → validate authority snapshot → validate audit chain.
   *
   * Returns ok:false with a reason if ANY gate fails; callers must treat a
   * failed basis as "did not resume," never as success.
   */
  verifyRecoveryBasis(record: ExecutionRecord): RecoveryBasis {
    const checkpoint = this.checkpoints.getLatestCheckpoint(record.id.runId);

    // Gate 1 — a checkpoint must exist.
    if (!checkpoint) {
      return { ok: false, reason: "no checkpoint found to resume from", checkpoint: null };
    }

    // Gate 2 — checkpoint structure must be valid.
    const structural = verifyCheckpoint(checkpoint);
    if (!structural.valid) {
      return { ok: false, reason: `checkpoint invalid: ${structural.reason ?? "unknown"}`, checkpoint };
    }

    // Gate 3 — audit chain integrity (hard boundary when a verifier is wired).
    if (this.hooks.auditChain) {
      try {
        const chain = this.hooks.auditChain();
        if (!chain.valid) {
          return { ok: false, reason: `audit chain broken: ${chain.reason ?? "invalid"}`, checkpoint };
        }
      } catch (e) {
        return { ok: false, reason: `audit verification error: ${(e as Error)?.message ?? "unknown"}`, checkpoint };
      }
    }

    // Gate 4 — authority snapshot revalidation (no privilege escalation).
    if (checkpoint.authoritySnapshot && this.hooks.authority) {
      try {
        const verdict = this.hooks.authority(checkpoint.authoritySnapshot, record);
        if (!verdict.ok) {
          return { ok: false, reason: `authority no longer valid: ${verdict.reason ?? "mismatch"}`, checkpoint };
        }
      } catch (e) {
        return { ok: false, reason: `authority validation error: ${(e as Error)?.message ?? "unknown"}`, checkpoint };
      }
    }

    // Gate 5 — side-effect safety of the resume boundary itself. Recomputed
    // from the CURRENT record idempotency (not just the stored flag) so a
    // later-reclassified action cannot sneak past an old safe flag.
    const idempotency = record.action?.idempotency;
    if (!checkpoint.sideEffectSafe && !isSideEffectSafe(checkpoint.kind, idempotency)) {
      return {
        ok: false,
        reason: `resume boundary "${checkpoint.kind}" is not side-effect-safe for idempotency "${idempotency ?? "unknown"}"`,
        checkpoint,
      };
    }

    return { ok: true, reason: "checkpoint loaded and verified", checkpoint };
  }

  /**
   * Record a recovery decision durably.
   */
  recordDecision(
    targetType: RecoveryDecision["targetType"],
    targetId: string,
    action: RecoveryAction,
    classification: RecoveryClassification,
    reason: string,
    decidedBy: "system" | "user",
    metadata?: Record<string, unknown>,
  ): RecoveryDecision | null {
    const now = Date.now();
    const decision: RecoveryDecision = {
      recoveryId: `rec_${randomUUID().slice(0, 10)}`,
      targetType,
      targetId,
      action,
      classification,
      reason,
      decidedBy,
      decidedAt: now,
      metadata,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO ${RECOVERY_TABLE} (recovery_id, target_type, target_id, recovery_action,
            classification, reason, decided_by, decided_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          decision.recoveryId,
          decision.targetType,
          decision.targetId,
          decision.action,
          decision.classification,
          decision.reason,
          decision.decidedBy,
          decision.decidedAt,
          decision.metadata ? JSON.stringify(decision.metadata) : null,
        );
      return decision;
    } catch {
      return null;
    }
  }

  /**
   * Create a durable cancellation request that survives process restart.
   */
  requestCancellation(
    targetType: DurableCancellation["targetType"],
    targetId: string,
    requestedBy: string,
    reason?: string,
  ): DurableCancellation | null {
    const now = Date.now();
    const cancellation: DurableCancellation = {
      cancellationId: `can_${randomUUID().slice(0, 10)}`,
      targetType,
      targetId,
      requestedAt: now,
      requestedBy,
      reason,
      acknowledged: false,
      sideEffectPossible: false,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO ${CANCEL_TABLE} (cancellation_id, target_type, target_id, requested_at,
            requested_by, reason, acknowledged, side_effect_possible)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        )
        .run(
          cancellation.cancellationId,
          cancellation.targetType,
          cancellation.targetId,
          cancellation.requestedAt,
          cancellation.requestedBy,
          cancellation.reason ?? null,
        );
      return cancellation;
    } catch {
      return null;
    }
  }

  /** Acknowledge a durable cancellation. */
  acknowledgeCancellation(targetType: string, targetId: string, sideEffectPossible: boolean): void {
    const now = Date.now();
    try {
      this.db
        .prepare(
          `UPDATE ${CANCEL_TABLE} SET acknowledged = 1, acknowledged_at = ?,
            side_effect_possible = ? WHERE target_type = ? AND target_id = ? AND acknowledged = 0`,
        )
        .run(now, sideEffectPossible ? 1 : 0, targetType, targetId);
    } catch {
      // best-effort
    }
  }

  /** Get a durable cancellation for a target. */
  getDurableCancellation(targetType: string, targetId: string): DurableCancellation | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM ${CANCEL_TABLE} WHERE target_type = ? AND target_id = ? ORDER BY requested_at DESC LIMIT 1`)
        .get<CancelRow>(targetType, targetId);
      return row ? rowToCancellation(row) : null;
    } catch {
      return null;
    }
  }

  /** Record an environment attachment. */
  recordEnvironment(env: EnvironmentAttachment): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO ${ENV_TABLE} (attachment_id, environment_id, execution_id,
            workspace_id, backend_id, placement, tier, lifecycle_state, pid,
            created_at, last_known_at, cleanup_state, quarantined, quarantine_reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          env.attachmentId,
          env.environmentId,
          env.executionId,
          env.workspaceId,
          env.backendId,
          env.placement,
          env.tier,
          env.lifecycleState,
          env.pid ?? null,
          env.createdAt,
          env.lastKnownAt,
          env.cleanupState ?? null,
          env.quarantined ? 1 : 0,
          env.quarantineReason ?? null,
        );
    } catch {
      // best-effort
    }
  }

  /** Update environment lifecycle state. */
  updateEnvironmentState(
    environmentId: string,
    state: EnvironmentAttachment["lifecycleState"],
    opts?: { cleanupState?: string; quarantined?: boolean; quarantineReason?: string },
  ): void {
    const now = Date.now();
    try {
      const parts = [`lifecycle_state = '${state}'`, `last_known_at = ${now}`];
      if (opts?.cleanupState) parts.push(`cleanup_state = '${opts.cleanupState}'`);
      if (opts?.quarantined !== undefined) parts.push(`quarantined = ${opts.quarantined ? 1 : 0}`);
      if (opts?.quarantineReason) parts.push(`quarantine_reason = '${opts.quarantineReason}'`);
      this.db.exec(`UPDATE ${ENV_TABLE} SET ${parts.join(", ")} WHERE environment_id = '${environmentId}'`);
    } catch {
      // best-effort
    }
  }

  /** Get environments associated with an execution. */
  getEnvironments(executionId: string): EnvironmentAttachment[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM ${ENV_TABLE} WHERE execution_id = ? ORDER BY created_at DESC`)
        .all<EnvRow>(executionId);
      return rows.map(rowToEnv);
    } catch {
      return [];
    }
  }

  /** Get all environments that were not cleanly shut down. */
  getDirtyEnvironments(workspaceId: string): EnvironmentAttachment[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${ENV_TABLE} WHERE workspace_id = ?
            AND lifecycle_state IN ('created','starting','ready','running')
            AND cleanup_state IS NULL
            ORDER BY created_at DESC`,
        )
        .all<EnvRow>(workspaceId);
      return rows.map(rowToEnv);
    } catch {
      return [];
    }
  }

  /** Build a RecoveryStatus for UX display. */
  buildStatus(
    record: ExecutionRecord,
  ): RecoveryStatus {
    const classification = this.classify(record);
    const lastCheckpoint = this.checkpoints.getLatestCheckpoint(record.id.runId);
    const durableCancel = this.getDurableCancellation("execution", record.id.runId);
    const envs = this.getEnvironments(record.id.runId);

    return {
      runId: record.id.runId,
      targetType: "execution",
      targetId: record.id.runId,
      recoveryState: this.recoveryStateForClassification(classification),
      lastCheckpoint: lastCheckpoint?.kind,
      lastCheckpointAt: lastCheckpoint?.createdAt,
      checkpointProgress: lastCheckpoint?.progressSummary,
      classification: classification.classification,
      action: classification.action,
      sideEffectUnknown: classification.classification === "unknown_side_effect",
      safeToResume: classification.action === "auto_resume",
      blockedReason: classification.action === "blocked" ? classification.reason : undefined,
      environmentState: envs[0]?.lifecycleState,
      createdAt: record.createdAt,
      interruptedAt: record.endedAt,
    };
  }

  private recoveryStateForClassification(c: {
    action: RecoveryAction;
    classification: RecoveryClassification;
  }): RecoveryState {
    switch (c.action) {
      case "auto_resume":
        return "recoverable";
      case "requires_approval":
        return "startup_recovery_pending";
      case "blocked":
        return "recovery_blocked";
      case "quarantined":
        return "recovery_blocked";
      default:
        return "startup_recovery_pending";
    }
  }
}

// ── Internal row types ────────────────────────────────────────────────────

interface CancelRow {
  cancellation_id: string;
  target_type: string;
  target_id: string;
  requested_at: number;
  requested_by: string;
  reason: string | null;
  acknowledged: number;
  acknowledged_at: number | null;
  side_effect_possible: number;
  final_state: string | null;
}

function rowToCancellation(row: CancelRow): DurableCancellation {
  return {
    cancellationId: row.cancellation_id,
    targetType: row.target_type as DurableCancellation["targetType"],
    targetId: row.target_id,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    reason: row.reason ?? undefined,
    acknowledged: row.acknowledged === 1,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    sideEffectPossible: row.side_effect_possible === 1,
    finalState: row.final_state as DurableCancellation["finalState"],
  };
}

interface EnvRow {
  attachment_id: string;
  environment_id: string;
  execution_id: string;
  workspace_id: string;
  backend_id: string;
  placement: string;
  tier: string;
  lifecycle_state: string;
  pid: number | null;
  created_at: number;
  last_known_at: number;
  cleanup_state: string | null;
  quarantined: number;
  quarantine_reason: string | null;
}

function rowToEnv(row: EnvRow): EnvironmentAttachment {
  return {
    attachmentId: row.attachment_id,
    environmentId: row.environment_id,
    executionId: row.execution_id,
    workspaceId: row.workspace_id,
    backendId: row.backend_id,
    placement: row.placement,
    tier: row.tier,
    lifecycleState: row.lifecycle_state as EnvironmentAttachment["lifecycleState"],
    pid: row.pid ?? undefined,
    createdAt: row.created_at,
    lastKnownAt: row.last_known_at,
    cleanupState: row.cleanup_state as EnvironmentAttachment["cleanupState"],
    quarantined: row.quarantined === 1,
    quarantineReason: row.quarantine_reason ?? undefined,
  };
}
