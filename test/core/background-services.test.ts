/**
 * XR 4.0 — Background Service Manager Tests
 *
 * Tests the enhanced background service lifecycle: owner tracking, workspace
 * association, cancellation, failure counting, and health reporting.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { BackgroundServiceManager } from "../../src/core/services.ts";
import { EventBus } from "../../src/core/event-bus.ts";

describe("BackgroundServiceManager XR 4.0", () => {
  let events: EventBus;
  let bsm: BackgroundServiceManager;

  beforeEach(() => {
    events = new EventBus();
    bsm = new BackgroundServiceManager(events);
  });

  test("registerJob records owner and workspace metadata", () => {
    bsm.registerJob({
      id: "test-job",
      name: "Test Job",
      intervalMs: 60000,
      owner: "xr.kernel",
      workspaceId: "default",
      run: async () => {},
    });
    const status = bsm.getJobStatus("test-job");
    expect(status).toBeDefined();
    expect(status!.owner).toBe("xr.kernel");
    expect(status!.workspaceId).toBe("default");
    expect(status!.state).toBe("registered");
    expect(status!.active).toBe(false);
    expect(status!.failureCount).toBe(0);
  });

  test("listJobs returns all registered jobs with metadata", () => {
    bsm.registerJob({ id: "a", name: "Job A", intervalMs: 1000, owner: "owner-a", run: async () => {} });
    bsm.registerJob({ id: "b", name: "Job B", intervalMs: 2000, owner: "owner-b", run: async () => {} });
    const jobs = bsm.listJobs();
    expect(jobs.length).toBe(2);
    expect(jobs.map((j) => j.id).sort()).toEqual(["a", "b"]);
  });

  test("getJobsByOwner filters by owner", () => {
    bsm.registerJob({ id: "a", name: "A", intervalMs: 1000, owner: "kernel", run: async () => {} });
    bsm.registerJob({ id: "b", name: "B", intervalMs: 1000, owner: "other", run: async () => {} });
    const kernelJobs = bsm.getJobsByOwner("kernel");
    expect(kernelJobs.length).toBe(1);
    expect(kernelJobs[0]?.id).toBe("a");
  });

  test("cancelJob prevents the job from being restarted", async () => {
    bsm.registerJob({ id: "cancel-test", name: "Cancel", intervalMs: 100, run: async () => {} });
    bsm.cancelJob("cancel-test");
    const status = bsm.getJobStatus("cancel-test");
    expect(status).toBeDefined();
    expect(status!.state).toBe("cancelled");
    // startAll should not restart cancelled jobs
    bsm.startAll();
    const statusAfter = bsm.getJobStatus("cancel-test");
    expect(statusAfter!.active).toBe(false);
  });

  test("getHealth() returns aggregate counts", () => {
    bsm.registerJob({ id: "a", name: "A", intervalMs: 60000, run: async () => {} });
    bsm.registerJob({ id: "b", name: "B", intervalMs: 60000, run: async () => {} });
    bsm.cancelJob("b");
    const health = bsm.getHealth();
    expect(health.total).toBe(2);
    expect(health.cancelled).toBe(1);
  });

  test("replacing a job with the same ID is safe (new replaces old)", () => {
    bsm.registerJob({ id: "dup", name: "Old", intervalMs: 1000, owner: "old-owner", run: async () => {} });
    bsm.registerJob({ id: "dup", name: "New", intervalMs: 2000, owner: "new-owner", run: async () => {} });
    const status = bsm.getJobStatus("dup");
    expect(status!.name).toBe("New");
    expect(status!.owner).toBe("new-owner");
  });

  test("startAll and stopAll track running state", () => {
    bsm.registerJob({ id: "j", name: "J", intervalMs: 60000, run: async () => {} });
    bsm.startAll();
    expect(bsm.getJobStatus("j")!.active).toBe(true);
    bsm.stopAll();
    expect(bsm.getJobStatus("j")!.active).toBe(false);
  });

  test("failure count increments on job errors", async () => {
    let calls = 0;
    bsm.registerJob({
      id: "fail-job",
      name: "Failing",
      intervalMs: 50,
      run: async () => { calls++; throw new Error("boom"); },
    });
    bsm.startAll();
    // Wait for a few ticks
    await new Promise((r) => setTimeout(r, 300));
    bsm.stopAll();
    const status = bsm.getJobStatus("fail-job");
    expect(status!.failureCount).toBeGreaterThan(0);
    expect(status!.lastError).toBe("boom");
  });

  test("events are emitted on job registration", async () => {
    const emitted: string[] = [];
    events.on("services.job.registered", () => { emitted.push("registered"); });
    bsm.registerJob({ id: "e", name: "E", intervalMs: 60000, run: async () => {} });
    // EventBus.emit is async (microtask), so wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(emitted).toContain("registered");
  });

  test("setCurrentWorkspace tracks workspace context", () => {
    bsm.setCurrentWorkspace("qa");
    // No error — just sets context
  });

  test("getJobStatus returns undefined for unknown job", () => {
    expect(bsm.getJobStatus("nonexistent")).toBeUndefined();
  });

  test("unregisterJob removes the job completely", () => {
    bsm.registerJob({ id: "rem", name: "Rem", intervalMs: 60000, run: async () => {} });
    bsm.unregisterJob("rem");
    expect(bsm.getJobStatus("rem")).toBeUndefined();
    expect(bsm.listJobs().length).toBe(0);
  });
});
