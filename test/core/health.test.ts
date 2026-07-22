/**
 * XR 4.0 — Kernel Health Model Tests
 *
 * Tests the health snapshot builder, human formatting, and JSON formatting.
 */

import { describe, test, expect } from "bun:test";
import {
  buildHealthSnapshot,
  formatHealthHuman,
  formatHealthJson,
  type KernelHealth,
  type ServiceHealthEntry,
  type BackgroundJobHealthEntry,
} from "../../src/core/health.ts";

describe("Kernel Health Model", () => {
  const baseInput = {
    runtimeState: "RUNNING",
    bootstrapped: true,
    started: true,
    version: { version: "4.0.0", codename: "Runtime Kernel", display: "4.0.0 (Runtime Kernel)" },
    services: [] as ServiceHealthEntry[],
    backgroundJobs: [] as BackgroundJobHealthEntry[],
    workspace: { activeId: "default", storeOpen: true, connectionCount: 1 },
  };

  test("builds a healthy snapshot when all services are ready", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      services: [
        { id: "xr.config", readiness: "ready", scope: "process", lifecycle: true },
        { id: "xr.store", readiness: "ready", scope: "workspace", lifecycle: false },
      ],
      backgroundJobs: [
        { id: "job1", name: "Test Job", active: true, intervalMs: 10000 },
      ],
    });
    expect(health.status).toBe("healthy");
    expect(health.runtimeState).toBe("RUNNING");
    expect(health.bootstrapped).toBe(true);
    expect(health.started).toBe(true);
    expect(health.services.length).toBe(2);
    expect(health.backgroundJobs.length).toBe(1);
    expect(health.summary).toContain("2/2 ready");
  });

  test("reports degraded when optional services are degraded", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      services: [
        { id: "xr.config", readiness: "ready", scope: "process" },
        { id: "xr.voice", readiness: "degraded", scope: "process", detail: "no audio device" },
      ],
    });
    expect(health.status).toBe("degraded");
    expect(health.summary).toContain("1 degraded");
  });

  test("reports failed when a required service is failed", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      services: [
        { id: "xr.store", readiness: "failed", scope: "workspace", detail: "db locked" },
        { id: "xr.config", readiness: "ready", scope: "process" },
      ],
    });
    expect(health.status).toBe("failed");
    expect(health.summary).toContain("1 failed");
  });

  test("reports stopped when runtime is STOPPED", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      runtimeState: "STOPPED",
    });
    expect(health.status).toBe("stopped");
  });

  test("reports starting when runtime is BOOTSTRAPPING", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      runtimeState: "BOOTSTRAPPING",
    });
    expect(health.status).toBe("starting");
  });

  test("reports switching when runtime is SWITCHING_WORKSPACE", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      runtimeState: "SWITCHING_WORKSPACE",
    });
    expect(health.status).toBe("switching");
  });

  test("reports failed when runtime state is FAILED", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      runtimeState: "FAILED",
    });
    expect(health.status).toBe("failed");
  });

  test("formatHealthHuman produces readable output", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      services: [
        { id: "xr.config", readiness: "ready", scope: "process" },
      ],
      backgroundJobs: [
        { id: "job1", name: "Test", active: true, intervalMs: 10000, owner: "xr.kernel" },
      ],
    });
    const text = formatHealthHuman(health);
    expect(text).toContain("Runtime:");
    expect(text).toContain("running");
    expect(text).toContain("4.0.0");
    expect(text).toContain("xr.config");
    expect(text).toContain("job1");
    expect(text).toContain("Test");
    expect(text).toContain("xr.kernel");
  });

  test("formatHealthJson produces a safe JSON object", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      services: [
        { id: "xr.config", readiness: "ready", scope: "process", lifecycle: true },
      ],
      errors: [{ service: "xr.store", detail: "db locked" }],
    });
    const json = formatHealthJson(health);
    expect(json.status).toBe("healthy");
    expect(json.runtimeState).toBe("RUNNING");
    expect(json.bootstrapped).toBe(true);
    expect(json.version).toEqual({ version: "4.0.0", codename: "Runtime Kernel", display: "4.0.0 (Runtime Kernel)" });
    expect(Array.isArray(json.services)).toBe(true);
    expect(Array.isArray(json.errors)).toBe(true);
    // Should be JSON-serializable
    const str = JSON.stringify(json);
    expect(str.length).toBeGreaterThan(0);
    expect(JSON.parse(str)).toBeDefined();
  });

  test("formatHealthJson omits secrets and sensitive data", () => {
    const health = buildHealthSnapshot(baseInput);
    const json = formatHealthJson(health);
    const str = JSON.stringify(json);
    expect(str).not.toContain("password");
    expect(str).not.toContain("secret");
    expect(str).not.toContain("api_key");
    expect(str).not.toContain("token");
  });

  test("health includes background job failure counts", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      backgroundJobs: [
        { id: "failing", name: "Failing Job", active: false, intervalMs: 5000, failureCount: 3, owner: "test" },
      ],
    });
    expect(health.backgroundJobs[0]?.failureCount).toBe(3);
    expect(health.backgroundJobs[0]?.active).toBe(false);
  });

  test("health includes workspace state", () => {
    const health = buildHealthSnapshot({
      ...baseInput,
      workspace: { activeId: "qa", storeOpen: true, connectionCount: 1, dbPath: "/home/user/.xr/workspaces/qa/xr-qa.db" },
    });
    expect(health.workspace.activeId).toBe("qa");
    expect(health.workspace.storeOpen).toBe(true);
    expect(health.summary).toContain("qa");
  });

  test("health timestamp is recent", () => {
    const before = Date.now();
    const health = buildHealthSnapshot(baseInput);
    const after = Date.now();
    expect(health.timestamp).toBeGreaterThanOrEqual(before);
    expect(health.timestamp).toBeLessThanOrEqual(after);
  });
});
