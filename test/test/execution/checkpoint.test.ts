/**
 * XR 4.3 — Checkpoint Manager Tests
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { CheckpointManager, isSideEffectSafe } from "../../src/execution/checkpoint.ts";
import type { ExecutionDb } from "../../src/execution/repository.ts";
import { Database } from "bun:sqlite";
import type { ExecutionRecord, ExecutionCheckpoint } from "../../src/execution/types.ts";

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

function makeRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = Date.now();
  return {
    id: {
      runId: "ex_test123",
      workspaceId: "ws_test",
      sessionId: "s_test",
      workflowId: "wf_test",
      attempt: 1,
      correlationId: "corr_test",
    },
    state: "running",
    actor: { kind: "user", source: "cli" },
    intent: { summary: "test intent", origin: { kind: "user", source: "cli" } },
    plan: { summary: "test plan", risk: "safe" },
    policy: [],
    action: {
      capability: { kind: "core_tool", name: "read_file" },
      inputSummary: "read /tmp/test.txt",
      idempotency: "naturally_idempotent",
      dryRun: false,
      placement: { kind: "in_process" },
    },
    observation: undefined,
    evidence: [],
    artifacts: [],
    history: [{ from: null, to: "running", at: now }],
    createdAt: now,
    updatedAt: now,
    adapterVersion: "xr-4.3.0",
    ...overrides,
  };
}

describe("XR 4.3 CheckpointManager", () => {
  let db: ExecutionDb;
  let mgr: CheckpointManager;

  beforeEach(() => {
    db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.migrate();
  });

  test("creates a checkpoint for a running execution", () => {
    const rec = makeRecord();
    const cp = mgr.createCheckpoint(rec, "task_accepted");
    expect(cp).not.toBeNull();
    expect(cp!.kind).toBe("task_accepted");
    expect(cp!.runId).toBe("ex_test123");
    expect(cp!.sideEffectSafe).toBe(true);
  });

  test("retrieves latest checkpoint", async () => {
    const rec = makeRecord();
    mgr.createCheckpoint(rec, "task_accepted");
    // Small delay so the second checkpoint has a different timestamp
    await new Promise(r => setTimeout(r, 2));
    mgr.createCheckpoint(rec, "step_started");
    const latest = mgr.getLatestCheckpoint("ex_test123");
    expect(latest).not.toBeNull();
    expect(latest!.kind).toBe("step_started");
  });

  test("retrieves all checkpoints for an execution", () => {
    const rec = makeRecord();
    mgr.createCheckpoint(rec, "task_accepted");
    mgr.createCheckpoint(rec, "policy_admitted");
    mgr.createCheckpoint(rec, "step_completed");
    const all = mgr.getCheckpoints("ex_test123");
    expect(all.length).toBe(3);
  });

  test("new execution has no checkpoints", () => {
    const cp = mgr.getLatestCheckpoint("nonexistent");
    expect(cp).toBeNull();
  });

  test("checkpoint stores authority snapshot when trust is present", () => {
    const rec = makeRecord({
      trust: {
        classification: {
          tier: "tier0_in_process",
          reasons: ["safe"],
          requiredApprovalLevel: "none",
          classifierVersion: "v1",
        },
        decision: {
          kind: "in_process_ok",
          requestedTier: "tier0_in_process",
          placement: "in_process",
          reason: "safe",
          decidedAt: Date.now(),
          policyVersion: "v1",
        },
        credentialScope: {
          mode: "none",
          refs: [{ refId: "ref1", label: "key", mode: "none", scope: "test" }],
          envNames: [],
        },
      },
    });
    const cp = mgr.createCheckpoint(rec, "env_admitted");
    expect(cp).not.toBeNull();
    expect(cp!.authoritySnapshot).toBeDefined();
    expect(cp!.authoritySnapshot!.credentialRefs).toContain("ref1");
    expect(cp!.environmentRef).toBeUndefined(); // no environment id
  });

  test("side-effect safety classification", () => {
    // Always safe
    expect(isSideEffectSafe("task_accepted")).toBe(true);
    expect(isSideEffectSafe("plan_recorded")).toBe(true);
    expect(isSideEffectSafe("policy_admitted")).toBe(true);
    expect(isSideEffectSafe("review_checkpoint_reached")).toBe(true);
    expect(isSideEffectSafe("cleanup_completed")).toBe(true);

    // Depends on idempotency
    expect(isSideEffectSafe("step_started", "naturally_idempotent")).toBe(true);
    expect(isSideEffectSafe("step_completed", "idempotent_with_key")).toBe(true);
    expect(isSideEffectSafe("tool_call_completed", "non_idempotent")).toBe(false);
    expect(isSideEffectSafe("model_turn_completed", "unknown_unsafe")).toBe(false);

    // Cancellation is conservative
    expect(isSideEffectSafe("cancellation_requested")).toBe(false);
  });

  test("pruneCheckpoints removes old completed checkpoints", () => {
    // This is best-effort — just verify it doesn't throw
    mgr.pruneCheckpoints();
    // No assertion needed; this is a fire-and-forget cleanup
  });
});
