/**
 * XR 4.3 — Recovery Manager Tests
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { RecoveryManager } from "../../src/execution/recovery.ts";
import { CheckpointManager } from "../../src/execution/checkpoint.ts";
import { LeaseManager } from "../../src/execution/lease.ts";
import type { ExecutionDb } from "../../src/execution/repository.ts";
import { Database } from "bun:sqlite";
import type { ExecutionRecord } from "../../src/execution/types.ts";

function makeDb(): ExecutionDb {
  const db = new Database(":memory:");
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => (stmt.run as any)(...params),
        get: <T = unknown>(...params: unknown[]) => (stmt.get as any)(...params) as T | null | undefined,
        all: <T = unknown>(...params: unknown[]) => (stmt.all as any)(...params) as T[],
      };
    },
  };
}

function makeRecord(state: string = "running", idempotency: string = "naturally_idempotent"): ExecutionRecord {
  const now = Date.now();
  return {
    id: { runId: "ex_rec_test", workspaceId: "ws_test", attempt: 1, correlationId: "corr_rec" },
    state: state as any,
    actor: { kind: "user", source: "cli" },
    intent: { summary: "test", origin: { kind: "user", source: "cli" } },
    policy: [],
    action: {
      capability: { kind: "core_tool", name: "read_file" },
      inputSummary: "read file",
      idempotency: idempotency as any,
      dryRun: false,
      placement: { kind: "in_process" },
    },
    evidence: [],
    artifacts: [],
    history: [{ from: null, to: "running" as any, at: now }],
    createdAt: now,
    updatedAt: now,
    adapterVersion: "xr-4.3.0",
  };
}

describe("XR 4.3 RecoveryManager", () => {
  let db: ExecutionDb;
  let checkpoints: CheckpointManager;
  let leases: LeaseManager;
  let recovery: RecoveryManager;

  beforeEach(() => {
    db = makeDb();
    checkpoints = new CheckpointManager(db);
    leases = new LeaseManager(db);
    recovery = new RecoveryManager(db, checkpoints, leases);
    recovery.migrate();
    checkpoints.migrate();
    leases.migrate();
  });

  test("classifies pre-action state as safe", () => {
    const rec = makeRecord("authorized");
    const result = recovery.classify(rec);
    expect(result.action).toBe("auto_resume");
    expect(result.classification).toBe("safe");
    expect(result.reason).toContain("authorized");
  });

  test("classifies running state with naturally_idempotent as safe", () => {
    const rec = makeRecord("running", "naturally_idempotent");
    const result = recovery.classify(rec);
    expect(result.action).toBe("auto_resume");
  });

  test("classifies running state with non_idempotent as requires_approval", () => {
    const rec = makeRecord("running", "non_idempotent");
    const result = recovery.classify(rec);
    expect(result.action).toBe("requires_approval");
    expect(result.classification).toBe("unknown_side_effect");
  });

  test("classifies observing state with unknown_unsafe as requires_approval", () => {
    const rec = makeRecord("observing", "unknown_unsafe");
    const result = recovery.classify(rec);
    expect(result.action).toBe("requires_approval");
  });

  test("classifies with safe checkpoint as auto_resume even with non_idempotent", () => {
    const rec = makeRecord("observing", "non_idempotent");
    // Add a safe checkpoint
    checkpoints.createCheckpoint(rec, "task_accepted"); // always safe
    const result = recovery.classify(rec);
    expect(result.action).toBe("auto_resume");
    expect(result.classification).toBe("safe");
  });

  test("records a recovery decision", () => {
    const decision = recovery.recordDecision(
      "execution", "ex_test",
      "auto_resume", "safe",
      "test reason", "system",
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("auto_resume");
    expect(decision!.decidedBy).toBe("system");
  });

  test("creates and retrieves durable cancellation", () => {
    const cancel = recovery.requestCancellation("execution", "ex_test", "user", "testing");
    expect(cancel).not.toBeNull();
    expect(cancel!.targetType).toBe("execution");
    expect(cancel!.acknowledged).toBe(false);

    const retrieved = recovery.getDurableCancellation("execution", "ex_test");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.cancellationId).toBe(cancel!.cancellationId);
  });

  test("classifies cancelled execution as blocked", () => {
    const rec = makeRecord("running", "non_idempotent");
    recovery.requestCancellation("execution", "ex_rec_test", "user", "stop");
    const result = recovery.classify(rec);
    expect(result.action).toBe("blocked");
    expect(result.classification).toBe("cancellation_pending");
  });

  test("acknowledges cancellation with side effect", () => {
    recovery.requestCancellation("execution", "ex_test", "user", "stop");
    recovery.acknowledgeCancellation("execution", "ex_test", true);
    const cancel = recovery.getDurableCancellation("execution", "ex_test");
    expect(cancel!.acknowledged).toBe(true);
    expect(cancel!.sideEffectPossible).toBe(true);
  });

  test("records environment attachment", () => {
    const env = {
      attachmentId: "att_1",
      environmentId: "env_1",
      executionId: "ex_test",
      workspaceId: "ws_test",
      backendId: "bwrap",
      placement: "namespace_sandbox",
      tier: "tier2_isolated",
      lifecycleState: "ready" as const,
      pid: 12345,
      createdAt: Date.now(),
      lastKnownAt: Date.now(),
      quarantined: false,
    };
    recovery.recordEnvironment(env);
    const envs = recovery.getEnvironments("ex_test");
    expect(envs.length).toBe(1);
    expect(envs[0].environmentId).toBe("env_1");
  });

  test("detects dirty environments", () => {
    const env = {
      attachmentId: "att_2",
      environmentId: "env_dirty",
      executionId: "ex_test",
      workspaceId: "ws_test",
      backendId: "bwrap",
      placement: "namespace_sandbox",
      tier: "tier2_isolated",
      lifecycleState: "running" as const,
      pid: 12345,
      createdAt: Date.now(),
      lastKnownAt: Date.now(),
      quarantined: false,
    };
    recovery.recordEnvironment(env);
    const dirty = recovery.getDirtyEnvironments("ws_test");
    expect(dirty.length).toBe(1);
    expect(dirty[0].lifecycleState).toBe("running");
  });

  test("updates environment state to quarantined", () => {
    const env = {
      attachmentId: "att_3",
      environmentId: "env_q",
      executionId: "ex_test",
      workspaceId: "ws_test",
      backendId: "bwrap",
      placement: "namespace_sandbox",
      tier: "tier2_isolated",
      lifecycleState: "running" as const,
      createdAt: Date.now(),
      lastKnownAt: Date.now(),
      quarantined: false,
    };
    recovery.recordEnvironment(env);
    recovery.updateEnvironmentState("env_q", "quarantined", {
      quarantined: true,
      quarantineReason: "process crash",
      cleanupState: "failed",
    });
    const envs = recovery.getEnvironments("ex_test");
    expect(envs[0].quarantined).toBe(true);
    expect(envs[0].lifecycleState).toBe("quarantined");
  });

  test("builds recovery status for UX display", () => {
    const rec = makeRecord("observing", "unknown_unsafe");
    const status = recovery.buildStatus(rec);
    expect(status.runId).toBe("ex_rec_test");
    expect(status.sideEffectUnknown).toBe(true);
    expect(status.safeToResume).toBe(false);
    expect(status.action).toBe("requires_approval");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 06 — honesty gates: corrupted checkpoints, broken audit chain,
// authority revalidation, and the verify-before-resume invariant.
// ═══════════════════════════════════════════════════════════════════════════
describe("Phase 06 · recovery honesty gates", () => {
  let db: ExecutionDb;
  let checkpoints: CheckpointManager;
  let leases: LeaseManager;
  let recovery: RecoveryManager;

  beforeEach(() => {
    db = makeDb();
    checkpoints = new CheckpointManager(db);
    leases = new LeaseManager(db);
    recovery = new RecoveryManager(db, checkpoints, leases);
    checkpoints.migrate();
    leases.migrate();
    recovery.migrate();
  });

  test("BROKEN AUDIT CHAIN blocks recovery even with a safe checkpoint (step 23/47)", () => {
    const guarded = new RecoveryManager(db, checkpoints, leases, {
      auditChain: () => ({ valid: false, reason: "hash mismatch at entry 42" }),
    });
    guarded.migrate();
    const rec = makeRecord("authorized"); // would otherwise auto-resume
    checkpoints.createCheckpoint(rec, "task_accepted"); // always-safe kind
    const c = guarded.classify(rec);
    expect(c.action).toBe("blocked");
    expect(c.classification).toBe("audit_chain_broken");
    expect(c.reason).toContain("hash mismatch");
  });

  test("intact audit chain permits normal classification", () => {
    const guarded = new RecoveryManager(db, checkpoints, leases, {
      auditChain: () => ({ valid: true }),
    });
    guarded.migrate();
    const rec = makeRecord("authorized");
    checkpoints.createCheckpoint(rec, "task_accepted");
    const c = guarded.classify(rec);
    expect(c.action).toBe("auto_resume");
    expect(c.classification).toBe("safe");
  });

  test("CORRUPTED checkpoint blocks resume (step 22) — never resume garbage", () => {
    const rec = makeRecord("running", "non_idempotent");
    checkpoints.createCheckpoint(rec, "step_started");
    // Corrupt the stored payload so it fails structural validation
    db.prepare(`UPDATE execution_checkpoints SET kind = 'not_a_kind' WHERE run_id = ?`).run(rec.id.runId);
    const c = recovery.classify(rec);
    expect(c.action).toBe("blocked");
    expect(c.classification).toBe("checkpoint_invalid");
  });

  test("AUTHORITY MISMATCH blocks resume (step 24/49) — no privilege escalation", () => {
    let rec = makeRecord("authorized");
    rec = {
      ...rec,
      trust: {
        classification: { tier: "tier0_in_process", reasons: ["safe"], requiredApprovalLevel: "none", classifierVersion: "policy-v1" },
        decision: { kind: "in_process_ok", requestedTier: "tier0_in_process", placement: "in_process", reason: "safe", decidedAt: Date.now(), policyVersion: "policy-v1" },
        credentialScope: { mode: "none", refs: [], envNames: [] },
      },
    } as ExecutionRecord;
    checkpoints.createCheckpoint(rec, "policy_admitted"); // carries authority snapshot (policy-v1)

    // Environment changed: current authority now rejects that snapshot.
    const guarded = new RecoveryManager(db, checkpoints, leases, {
      authority: (snap) =>
        snap.policyVersion === "policy-v1"
          ? { ok: false, reason: "policy version rotated to policy-v2" }
          : { ok: true },
    });
    guarded.migrate();
    const c = guarded.classify(rec);
    expect(c.action).toBe("blocked");
    expect(c.classification).toBe("authority_expired");
    expect(c.reason).toContain("policy-v2");
  });

  test("verifyRecoveryBasis requires a valid checkpoint BEFORE any resume claim (step 5)", () => {
    const rec = makeRecord("authorized");
    // No checkpoint at all → basis fails honestly
    let basis = recovery.verifyRecoveryBasis(rec);
    expect(basis.ok).toBe(false);
    expect(basis.reason).toContain("no checkpoint");

    // Valid safe checkpoint → basis passes
    checkpoints.createCheckpoint(rec, "task_accepted");
    basis = recovery.verifyRecoveryBasis(rec);
    expect(basis.ok).toBe(true);
    expect(basis.checkpoint?.kind).toBe("task_accepted");
  });

  test("verifyRecoveryBasis refuses unsafe resume boundaries (step 5 + 11)", () => {
    // running record, non-idempotent action, checkpoint that is NOT side-effect safe
    const rec = makeRecord("running", "non_idempotent");
    checkpoints.createCheckpoint(rec, "step_started"); // idempotency-dependent, unsafe here
    const basis = recovery.verifyRecoveryBasis(rec);
    expect(basis.ok).toBe(false);
    expect(basis.reason).toContain("not side-effect-safe");
  });

  test("verifyRecoveryBasis enforces audit + authority gates", () => {
    let rec = makeRecord("authorized");
    rec = {
      ...rec,
      trust: {
        classification: { tier: "tier0_in_process", reasons: ["safe"], requiredApprovalLevel: "none", classifierVersion: "vA" },
        decision: { kind: "in_process_ok", requestedTier: "tier0_in_process", placement: "in_process", reason: "safe", decidedAt: Date.now(), policyVersion: "vA" },
        credentialScope: { mode: "none", refs: [], envNames: [] },
      },
    } as ExecutionRecord;
    checkpoints.createCheckpoint(rec, "task_accepted");

    const brokenAudit = new RecoveryManager(db, checkpoints, leases, {
      auditChain: () => ({ valid: false, reason: "chain gap" }),
    });
    brokenAudit.migrate();
    expect(brokenAudit.verifyRecoveryBasis(rec).ok).toBe(false);
    expect(brokenAudit.verifyRecoveryBasis(rec).reason).toContain("audit chain broken");

    const rotated = new RecoveryManager(db, checkpoints, leases, {
      authority: () => ({ ok: false, reason: "credentials revoked" }),
    });
    rotated.migrate();
    expect(rotated.verifyRecoveryBasis(rec).ok).toBe(false);
    expect(rotated.verifyRecoveryBasis(rec).reason).toContain("credentials revoked");
  });
});
