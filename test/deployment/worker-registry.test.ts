/**
 * XR 6.0 — Phase 11 Tests: Worker Registry
 */
import { describe, expect, test } from "bun:test";
import {
  WorkerRegistry,
  WorkerNotFoundError,
  WorkerRegistrationError,
  WorkerLifecycleError,
} from "../../src/enterprise/deployment/workers/registry.ts";
import type { WorkerRegistration, WorkerHeartbeat } from "../../src/enterprise/deployment/types.ts";
import { DEPLOYMENT_BOUNDS } from "../../src/enterprise/deployment/types.ts";

function makeRegistration(id: string, overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    workerId: id,
    profile: "team_private",
    endpoint: { protocol: "https", host: "worker.example.com", port: 443 },
    capabilities: ["model_call", "core_tool", "workflow_task"],
    hardware: { cpuCores: 4, memoryMb: 8192, gpuAvailable: false },
    attestation: {
      method: "self_signed",
      publicKeyFingerprint: "fp_" + id,
      attestedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      verified: true,
    },
    workspaceIds: ["ws_1"],
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe("Worker Registry", () => {
  test("registers a worker successfully", async () => {
    const registry = new WorkerRegistry();
    const reg = makeRegistration("w1");
    const worker = await registry.register(reg);

    expect(worker.workerId).toBe("w1");
    expect(worker.state).toBe("attesting");
    expect(worker.capabilities).toEqual(["model_call", "core_tool", "workflow_task"]);
  });

  test("rejects duplicate worker ID", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    expect(async () => {
      await registry.register(makeRegistration("w1"));
    }).toBeDefined();

    try {
      await registry.register(makeRegistration("w1"));
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerRegistrationError);
    }
  });

  test("rejects expired attestation", async () => {
    const registry = new WorkerRegistry();
    const reg = makeRegistration("w1", {
      attestation: {
        method: "self_signed",
        publicKeyFingerprint: "fp_w1",
        attestedAt: Date.now() - 200000000,
        expiresAt: Date.now() - 1000, // Expired
        verified: true,
      },
    });

    try {
      await registry.register(reg);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerRegistrationError);
      expect((err as Error).message).toContain("expired");
    }
  });

  test("admits a worker after registration", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    const admitted = registry.admit("w1");
    expect(admitted.state).toBe("active");
  });

  test("cannot admit from wrong state", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");
    // Already active — cannot re-admit
    expect(() => registry.admit("w1")).toThrow(WorkerLifecycleError);
  });

  test("processes heartbeat correctly", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    const admitted = registry.admit("w1");

    const hb: WorkerHeartbeat = {
      workerId: "w1",
      instanceId: admitted.instanceId,
      at: Date.now(),
      state: "active",
      activeTaskCount: 2,
      activeTaskIds: ["t1", "t2"],
      health: { ok: true, checks: [], uptimeMs: 60000 },
    };

    const updated = registry.heartbeat(hb);
    expect(updated.lastSeenAt).toBe(hb.at);
    expect(updated.state).toBe("active");
  });

  test("rejects heartbeat with wrong instance ID", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");

    const hb: WorkerHeartbeat = {
      workerId: "w1",
      instanceId: "wrong_instance",
      at: Date.now(),
      state: "active",
      activeTaskCount: 0,
      activeTaskIds: [],
      health: { ok: true, checks: [], uptimeMs: 0 },
    };

    expect(() => registry.heartbeat(hb)).toThrow(WorkerLifecycleError);
  });

  test("drains a worker", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");
    const drained = registry.drain("w1", "Maintenance");
    expect(drained.state).toBe("draining");
  });

  test("marks worker as fully drained", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");
    registry.drain("w1", "Maintenance");
    const fullyDrained = registry.markDrained("w1");
    expect(fullyDrained.state).toBe("drained");
  });

  test("revokes a worker", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");
    const revoked = registry.revoke("w1", "Security incident");
    expect(revoked.state).toBe("revoked");
    expect(revoked.revokedAt).toBeGreaterThan(0);
    expect(revoked.revokeReason).toBe("Security incident");
  });

  test("quarantines a worker", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    registry.admit("w1");
    const quarantined = registry.quarantine("w1", "Suspicious activity");
    expect(quarantined.state).toBe("quarantined");
  });

  test("getActiveWorkers returns only active", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    await registry.register(makeRegistration("w2"));
    registry.admit("w1");
    registry.admit("w2");
    registry.drain("w2", "Done");

    const active = registry.getActiveWorkers();
    expect(active.length).toBe(1);
    expect(active[0].workerId).toBe("w1");
  });

  test("getAvailableWorkers excludes quarantined and revoked", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    await registry.register(makeRegistration("w2"));
    await registry.register(makeRegistration("w3"));
    registry.admit("w1");
    registry.admit("w2");
    registry.admit("w3");
    registry.quarantine("w2", "Suspicious");
    registry.revoke("w3", "Decommissioned");

    const available = registry.getAvailableWorkers();
    expect(available.length).toBe(1);
    expect(available[0].workerId).toBe("w1");
  });

  test("getWorker throws for unknown worker", () => {
    const registry = new WorkerRegistry();
    expect(() => registry.getWorker("unknown")).toThrow(WorkerNotFoundError);
  });

  test("respects max workers per profile", async () => {
    const registry = new WorkerRegistry({ maxWorkersPerProfile: 2 });
    await registry.register(makeRegistration("w1"));
    await registry.register(makeRegistration("w2"));

    try {
      await registry.register(makeRegistration("w3"));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerRegistrationError);
      expect((err as Error).message).toContain("Maximum workers");
    }
  });

  test("cleanup removes old drained/revoked workers", async () => {
    const registry = new WorkerRegistry();
    await registry.register(makeRegistration("w1"));
    await registry.register(makeRegistration("w2"));
    registry.admit("w1");
    registry.admit("w2");
    registry.drain("w1", "Done");
    registry.markDrained("w1");
    registry.revoke("w2", "Done");

    // Cleanup with very old threshold removes nothing
    const removed1 = registry.cleanup(100000000);
    expect(removed1).toBe(0);

    // Cleanup with -1 threshold removes all drained/revoked (lastSeenAt < now + 1ms)
    const removed2 = registry.cleanup(-1);
    expect(removed2).toBe(2);
    expect(registry.getWorkerCount()).toBe(0);
  });

  test("audit callback is called on lifecycle events", async () => {
    const events: string[] = [];
    const registry = new WorkerRegistry({
      audit: (event) => events.push(event),
    });

    await registry.register(makeRegistration("w1"));
    expect(events).toContain("worker.registered");

    registry.admit("w1");
    expect(events).toContain("worker.admitted");

    registry.drain("w1", "test");
    expect(events).toContain("worker.drain_started");

    registry.revoke("w1", "test");
    expect(events).toContain("worker.revoked");
  });
});
