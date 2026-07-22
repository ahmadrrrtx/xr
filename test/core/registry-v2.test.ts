/**
 * XR 4.0 — Enhanced Service Registry Tests
 *
 * Tests the new kernel scope, duplicate detection, workspace rebinding,
 * stale service handling, and inspection features.
 */

import { describe, test, expect } from "bun:test";
import { ServiceRegistry, token } from "../../src/core/service-registry.ts";

describe("ServiceRegistry XR 4.0 Enhancements", () => {
  test("kernelScope metadata is recorded in entries()", () => {
    const registry = new ServiceRegistry();
    const T = token<{ id: string }>("test.svc");
    registry.registerValue(T, { id: "1" }, { kernelScope: "process" });
    const entries = registry.entries();
    expect(entries[0]?.kernelScope).toBe("process");
  });

  test("owner metadata is recorded in entries()", () => {
    const registry = new ServiceRegistry();
    const T = token<{ id: string }>("test.svc");
    registry.registerValue(T, { id: "1" }, { owner: "my-provider" });
    const entries = registry.entries();
    expect(entries[0]?.owner).toBe("my-provider");
  });

  test("workspace-scoped services are tracked in getWorkspaceScopedIds()", () => {
    const registry = new ServiceRegistry();
    const A = token<{ id: string }>("ws.svc");
    const B = token<{ id: string }>("global.svc");
    registry.registerValue(A, { id: "a" }, { kernelScope: "workspace" });
    registry.registerValue(B, { id: "b" }, { kernelScope: "process" });
    expect(registry.getWorkspaceScopedIds()).toContain("ws.svc");
    expect(registry.getWorkspaceScopedIds()).not.toContain("global.svc");
  });

  test("markWorkspaceScopedStale() marks workspace services as stale", () => {
    const registry = new ServiceRegistry();
    const T = token<{ id: string }>("ws.svc");
    registry.registerValue(T, { id: "1" }, { kernelScope: "workspace" });
    expect(registry.resolve(T).id).toBe("1"); // works
    registry.markWorkspaceScopedStale();
    // Now tryResolve returns undefined for stale services
    expect(registry.tryResolve(T)).toBeUndefined();
    // And resolve throws
    expect(() => registry.resolve(T)).toThrow("stale");
  });

  test("stale services are replaced during rebinding", () => {
    const registry = new ServiceRegistry();
    const T = token<{ id: string }>("ws.svc");
    registry.registerValue(T, { id: "old" }, { kernelScope: "workspace" });
    registry.markWorkspaceScopedStale();
    // Begin rebinding — allows override of workspace-scoped
    registry.beginRebinding();
    registry.registerValue(T, { id: "new" }, { kernelScope: "workspace" });
    registry.endRebinding();
    expect(registry.resolve(T).id).toBe("new");
  });

  test("inspectionSnapshot() returns non-side-effectful inspection", () => {
    const registry = new ServiceRegistry();
    const T = token<{ id: string }>("test.svc");
    registry.registerSingleton(T, () => ({ id: "lazy" }), {
      lifecycle: true,
      kernelScope: "process",
      owner: "test",
      description: "test service",
    });
    const snapshot = registry.inspectionSnapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0]?.id).toBe("test.svc");
    expect(snapshot[0]?.lifecycle).toBe(true);
    expect(snapshot[0]?.kernelScope).toBe("process");
    expect(snapshot[0]?.owner).toBe("test");
    expect(snapshot[0]?.resolved).toBe(false); // not resolved yet (singleton)
    expect(snapshot[0]?.stale).toBe(false);
    // The singleton should NOT have been instantiated by the snapshot
    expect(snapshot[0]?.dependsOn).toEqual([]);
  });

  test("detectDependencyCycles() returns null for a valid graph", () => {
    const registry = new ServiceRegistry();
    const A = token<{ id: string }>("a");
    const B = token<{ id: string }>("b");
    const C = token<{ id: string }>("c");
    registry.registerValue(A, { id: "A" }, { dependsOn: [] });
    registry.registerValue(B, { id: "B" }, { dependsOn: [A] });
    registry.registerValue(C, { id: "C" }, { dependsOn: [B] });
    expect(registry.detectDependencyCycles()).toBeNull();
  });

  test("detectDependencyCycles() detects a cycle", () => {
    const registry = new ServiceRegistry();
    const A = token<{ id: string }>("a");
    const B = token<{ id: string }>("b");
    // Create a circular dependency
    registry.registerValue(A, { id: "A" }, { dependsOn: [B] });
    registry.registerValue(B, { id: "B" }, { dependsOn: [A] });
    const cycle = registry.detectDependencyCycles();
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBe(2);
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
  });

  test("allowOverride suppresses duplicate detection", () => {
    const registry = new ServiceRegistry();
    const T = token<{ v: number }>("test.dup");
    registry.registerValue(T, { v: 1 });
    // Without allowOverride, this silently overrides (backward compat)
    registry.registerValue(T, { v: 2 });
    expect(registry.resolve(T).v).toBe(2);
    // With allowOverride, it also works
    registry.registerValue(T, { v: 3 }, { allowOverride: true });
    expect(registry.resolve(T).v).toBe(3);
  });

  test("rebinding flag is tracked correctly", () => {
    const registry = new ServiceRegistry();
    expect(registry.isRebinding).toBe(false);
    registry.beginRebinding();
    expect(registry.isRebinding).toBe(true);
    registry.endRebinding();
    expect(registry.isRebinding).toBe(false);
  });
});
