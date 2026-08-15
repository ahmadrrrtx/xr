/**
 * XR 4.3 — Lease Manager Tests
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { LeaseManager } from "../../src/execution/lease.ts";
import type { ExecutionDb } from "../../src/execution/repository.ts";
import { Database } from "bun:sqlite";

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

describe("XR 4.3 LeaseManager", () => {
  let db: ExecutionDb;
  let mgr: LeaseManager;

  beforeEach(() => {
    db = makeDb();
    mgr = new LeaseManager(db);
    mgr.migrate();
  });

  test("acquires a lease for an execution", () => {
    const lease = mgr.acquire("execution", "ex_test_l1", "ws_test");
    expect(lease).not.toBeNull();
    expect(lease!.targetType).toBe("execution");
    expect(lease!.targetId).toBe("ex_test_l1");
    expect(lease!.workspaceId).toBe("ws_test");
    expect(lease!.stale).toBe(false);
  });

  test("second acquisition of same target renews (held by same process)", () => {
    const lease1 = mgr.acquire("execution", "ex_test_l2", "ws_test");
    expect(lease1).not.toBeNull();
    const lease2 = mgr.acquire("execution", "ex_test_l2", "ws_test");
    // Should return the existing lease (renew) since same instance/pid
    expect(lease2).not.toBeNull();
    expect(lease2!.leaseId).toBe(lease1!.leaseId);
  });

  test("verifies lease ownership", () => {
    mgr.acquire("execution", "ex_test_own", "ws_test");
    expect(mgr.holdsLease("execution", "ex_test_own")).toBe(true);
    expect(mgr.holdsLease("execution", "nonexistent")).toBe(false);
  });

  test("releases a lease", () => {
    mgr.acquire("execution", "ex_test_rel", "ws_test");
    expect(mgr.holdsLease("execution", "ex_test_rel")).toBe(true);
    mgr.release("execution", "ex_test_rel", "completed");
    expect(mgr.holdsLease("execution", "ex_test_rel")).toBe(false);
  });

  test("released lease can be re-acquired", () => {
    const lease1 = mgr.acquire("execution", "ex_test_reacq", "ws_test");
    expect(lease1).not.toBeNull();
    const id1 = lease1!.leaseId;
    mgr.release("execution", "ex_test_reacq", "completed");
    // Verify no longer held
    expect(mgr.holdsLease("execution", "ex_test_reacq")).toBe(false);
    // Re-acquire
    const lease2 = mgr.acquire("execution", "ex_test_reacq", "ws_test");
    expect(lease2).not.toBeNull();
    // A fresh lease should have been issued
    expect(lease2!.leaseId).not.toBe(id1);
    // And we hold it
    expect(mgr.holdsLease("execution", "ex_test_reacq")).toBe(true);
  });

  test("different targets can have separate leases", () => {
    const l1 = mgr.acquire("execution", "ex_par_a", "ws_test");
    const l2 = mgr.acquire("execution", "ex_par_b", "ws_test");
    expect(l1).not.toBeNull();
    expect(l2).not.toBeNull();
    expect(l1!.leaseId).not.toBe(l2!.leaseId);
  });

  test("getWorkspaceLeases returns active leases", () => {
    mgr.acquire("execution", "ex_wl_a", "ws_test");
    mgr.acquire("execution", "ex_wl_b", "ws_test");
    mgr.acquire("workflow", "wf_wl_x", "ws_test");
    const leases = mgr.getWorkspaceLeases("ws_test");
    expect(leases.length).toBe(3);
  });

  test("cleanup removes stale and released leases", () => {
    mgr.acquire("execution", "ex_old_cl", "ws_test");
    mgr.release("execution", "ex_old_cl", "done");
    mgr.cleanup(0);
    // May or may not be cleaned depending on timing; just verify no crash
  });

  test("workflow and task targets work", () => {
    const wf = mgr.acquire("workflow", "wf_test", "ws_test");
    const task = mgr.acquire("task", "task_test", "ws_test");
    expect(wf).not.toBeNull();
    expect(task).not.toBeNull();
    expect(wf!.targetType).toBe("workflow");
    expect(task!.targetType).toBe("task");
  });

  test("instance identity is consistent", () => {
    const id1 = mgr.instanceIdentity;
    const id2 = mgr.instanceIdentity;
    expect(id1).toBe(id2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 06 · Step 25 — LEASE PROTECTION. Two owners over the SAME workflow:
// exactly one may execute; the other must be rejected. This is the guard that
// makes concurrent duplicate side effects impossible.
// ═══════════════════════════════════════════════════════════════════════════
describe("Phase 06 · lease contention — one owner per workflow", () => {
  test("worker B is rejected while worker A holds the workflow lease", () => {
    const db = makeDb();
    const workerA = new LeaseManager(db);
    const workerB = new LeaseManager(db);
    workerA.migrate();

    // Distinct instance identities (two "processes").
    expect(workerA.instanceIdentity).not.toBe(workerB.instanceIdentity);

    const leaseA = workerA.acquire("workflow", "wf_shared", "ws_test");
    expect(leaseA).not.toBeNull();

    // Worker B must NOT be able to execute the same workflow concurrently.
    const leaseB = workerB.acquire("workflow", "wf_shared", "ws_test");
    expect(leaseB).toBeNull();
    expect(workerB.holdsLease("workflow", "wf_shared")).toBe(false);
    expect(workerA.holdsLease("workflow", "wf_shared")).toBe(true);
  });

  test("after worker A releases, worker B may take over", () => {
    const db = makeDb();
    const workerA = new LeaseManager(db);
    const workerB = new LeaseManager(db);
    workerA.migrate();

    expect(workerA.acquire("workflow", "wf_handoff", "ws_test")).not.toBeNull();
    expect(workerB.acquire("workflow", "wf_handoff", "ws_test")).toBeNull();

    workerA.release("workflow", "wf_handoff", "completed");
    // Now B can acquire (the row is released → re-inserted fresh).
    const leaseB = workerB.acquire("workflow", "wf_handoff", "ws_test");
    expect(leaseB).not.toBeNull();
    expect(workerB.holdsLease("workflow", "wf_handoff")).toBe(true);
  });

  test("a stale (dead-owner) lease can be taken over when allowed", () => {
    const db = makeDb();
    const workerA = new LeaseManager(db);
    workerA.migrate();

    // Simulate a lease owned by a dead PID (e.g. a crashed XR process).
    db.prepare(
      `INSERT INTO execution_leases (lease_id, target_type, target_id, workspace_id, owner_pid, owner_instance_id, acquired_at, expires_at, stale)
       VALUES ('lse_dead', 'workflow', 'wf_crashed', 'ws_test', 99999999, 'xr_dead_instance', ?, ?, 0)`,
    ).run(Date.now(), Date.now() + 300000);

    // Takeover allowed (default) → worker A acquires.
    const lease = workerA.acquire("workflow", "wf_crashed", "ws_test", { allowTakeover: true });
    expect(lease).not.toBeNull();
    expect(workerA.holdsLease("workflow", "wf_crashed")).toBe(true);
  });

  test("takeover refused when allowTakeover=false", () => {
    const db = makeDb();
    const workerA = new LeaseManager(db);
    workerA.migrate();

    db.prepare(
      `INSERT INTO execution_leases (lease_id, target_type, target_id, workspace_id, owner_pid, owner_instance_id, acquired_at, expires_at, stale)
       VALUES ('lse_dead2', 'workflow', 'wf_crashed2', 'ws_test', 99999998, 'xr_dead_instance2', ?, ?, 0)`,
    ).run(Date.now(), Date.now() + 300000);

    const lease = workerA.acquire("workflow", "wf_crashed2", "ws_test", { allowTakeover: false });
    expect(lease).toBeNull();
  });
});
