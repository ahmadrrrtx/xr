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
