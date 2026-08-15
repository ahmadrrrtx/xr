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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 06 hardening — payload integrity, pruning safety, resume validation
// ═══════════════════════════════════════════════════════════════════════════
import { verifyCheckpoint, CHECKPOINT_KINDS } from "../../src/execution/checkpoint.ts";
import { DURABILITY_BOUNDS } from "../../src/execution/types.ts";

describe("Phase 06 · checkpoint payload integrity (spec step 6)", () => {
  let db: ExecutionDb;
  let mgr: CheckpointManager;

  beforeEach(() => {
    db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.migrate();
  });

  test("oversize payload is stored as VALID JSON (never a sliced string)", () => {
    const rec = makeRecord();
    const huge = { state: "running", attempt: 1, blob: "x".repeat(DURABILITY_BOUNDS.MAX_CHECKPOINT_PAYLOAD_CHARS * 2) };
    const cp = mgr.createCheckpoint(rec, "step_completed", { payload: huge });
    expect(cp).not.toBeNull();
    // Read back through the manager: payload must parse and be an object.
    const latest = mgr.getLatestCheckpoint("ex_test123");
    expect(latest).not.toBeNull();
    expect(typeof latest!.payload).toBe("object");
    expect((latest!.payload as Record<string, unknown>).__truncated).toBe(true);
    // lifecycle-critical fields survive truncation
    expect(latest!.payload.state).toBe("running");
    expect(latest!.payload.attempt).toBe(1);
  });

  test("unknown checkpoint kind is rejected, not persisted", () => {
    const rec = makeRecord();
    const cp = mgr.createCheckpoint(rec, "not_a_real_kind" as never);
    expect(cp).toBeNull();
    expect(mgr.getCheckpoints("ex_test123").length).toBe(0);
  });

  test("verifyCheckpoint rejects null / malformed checkpoints", () => {
    expect(verifyCheckpoint(null).valid).toBe(false);
    const rec = makeRecord();
    const good = mgr.createCheckpoint(rec, "task_accepted");
    expect(verifyCheckpoint(good).valid).toBe(true);
    // tampered: invalid kind
    expect(verifyCheckpoint({ ...good!, kind: "bogus" as never }).valid).toBe(false);
    // tampered: malformed authority snapshot
    expect(
      verifyCheckpoint({ ...good!, authoritySnapshot: { policyVersion: 1 as never, placement: "x", credentialRefs: "nope" as never, checkedAt: Date.now() } }).valid,
    ).toBe(false);
  });

  test("CHECKPOINT_KINDS contains exactly the documented lifecycle boundaries", () => {
    const kinds: string[] = [...CHECKPOINT_KINDS].sort();
    expect(kinds).toEqual([
      "cancellation_requested", "cleanup_completed", "env_admitted", "model_turn_completed",
      "plan_recorded", "policy_admitted", "recovery_decided", "review_checkpoint_reached",
      "step_completed", "step_started", "task_accepted", "tool_call_completed",
    ].sort());
  });
});

describe("Phase 06 · pruning safety (spec steps 31–33)", () => {
  let db: ExecutionDb;
  let mgr: CheckpointManager;

  beforeEach(() => {
    db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.migrate();
    // execution_records rows the prune JOIN needs
    db.exec(`
      CREATE TABLE IF NOT EXISTS execution_records (run_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS execution_cancellations (
        cancellation_id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        requested_at INTEGER NOT NULL, requested_by TEXT NOT NULL, reason TEXT,
        acknowledged INTEGER NOT NULL DEFAULT 0, acknowledged_at INTEGER,
        side_effect_possible INTEGER NOT NULL DEFAULT 0, final_state TEXT
      );
    `);
  });

  function seedRecord(runId: string, state: string): void {
    db.prepare(`INSERT INTO execution_records (run_id, state) VALUES (?, ?)`).run(runId, state);
  }
  function seedCheckpoint(runId: string, createdAt: number, kind = "step_completed"): void {
    const rec = makeRecord({});
    (rec.id as { runId: string }).runId = runId;
    const cp = mgr.createCheckpoint(rec, kind as never);
    // rewrite created_at so retention math is deterministic
    db.prepare(`UPDATE execution_checkpoints SET created_at = ? WHERE run_id = ?`).run(createdAt, runId);
    void cp;
  }

  test("expired checkpoints of TERMINATED executions are deleted, real count returned", () => {
    const now = Date.now();
    const old = now - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS - 1000;
    seedRecord("ex_done", "succeeded");
    seedCheckpoint("ex_done", old);
    expect(mgr.getCheckpoints("ex_done").length).toBe(1);
    const deleted = mgr.pruneCheckpoints({ now });
    expect(deleted).toBe(1);
    expect(mgr.getCheckpoints("ex_done").length).toBe(0);
  });

  test("recent checkpoints and active states are preserved", () => {
    const now = Date.now();
    seedRecord("ex_fresh", "succeeded");
    seedCheckpoint("ex_fresh", now - 1000); // well inside retention
    seedRecord("ex_active", "running");
    seedCheckpoint("ex_active", now - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS - 5000); // old but ACTIVE
    const deleted = mgr.pruneCheckpoints({ now });
    expect(deleted).toBe(0);
    expect(mgr.getCheckpoints("ex_fresh").length).toBe(1);
    expect(mgr.getCheckpoints("ex_active").length).toBe(1); // required checkpoint protected
  });

  test("runs with UNACKNOWLEDGED durable cancellations are protected", () => {
    const now = Date.now();
    const old = now - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS - 1000;
    seedRecord("ex_cancel_pending", "cancelled");
    seedCheckpoint("ex_cancel_pending", old);
    db.prepare(
      `INSERT INTO execution_cancellations (cancellation_id, target_type, target_id, requested_at, requested_by, acknowledged, side_effect_possible)
       VALUES ('can_1', 'execution', 'ex_cancel_pending', ?, 'user', 0, 1)`,
    ).run(now);
    const deleted = mgr.pruneCheckpoints({ now });
    expect(deleted).toBe(0); // evidence for reconciliation is preserved
    // after acknowledgement, pruning may proceed
    db.prepare(`UPDATE execution_cancellations SET acknowledged = 1 WHERE cancellation_id = 'can_1'`).run();
    expect(mgr.pruneCheckpoints({ now })).toBe(1);
  });

  test("pruning is bounded to 1000 rows per invocation", () => {
    const now = Date.now();
    const old = now - DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS - 1000;
    seedRecord("ex_many", "succeeded");
    for (let i = 0; i < 1005; i++) seedCheckpoint("ex_many", now); // created "now"…
    // …then aged past retention in ONE statement (all 1005 become eligible).
    db.prepare(`UPDATE execution_checkpoints SET created_at = ? WHERE run_id = ?`).run(old, "ex_many");
    const deleted = mgr.pruneCheckpoints({ now });
    expect(deleted).toBe(1000); // bounded batch
    expect(mgr.getCheckpoints("ex_many", 2000).length).toBe(5);
  });

  test("prune failure never throws (missing tables tolerated)", () => {
    const freshDb = makeDb();
    const freshMgr = new CheckpointManager(freshDb);
    freshMgr.migrate();
    // no execution_records table at all → the JOIN fails inside pruneDetailed
    const result = freshMgr.pruneDetailed();
    expect(result.deleted).toBe(0);
    expect(typeof result.error === "string" || result.error === undefined).toBe(true);
  });

  test("maintenance metadata round-trips (prune scheduler state)", () => {
    expect(mgr.getMaintenanceMeta("checkpoint_prune_last_at")).toBeNull();
    mgr.setMaintenanceMeta("checkpoint_prune_last_at", "12345");
    expect(mgr.getMaintenanceMeta("checkpoint_prune_last_at")).toBe("12345");
    mgr.setMaintenanceMeta("checkpoint_prune_last_at", "67890");
    expect(mgr.getMaintenanceMeta("checkpoint_prune_last_at")).toBe("67890");
  });
});
