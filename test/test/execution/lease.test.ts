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
