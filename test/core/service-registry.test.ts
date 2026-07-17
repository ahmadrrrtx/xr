/**
 * XR — ServiceRegistry (0.6 Runtime/DI cleanup) tests.
 *
 * The registry is the typed DI container that replaced the stringly-typed
 * Container. These tests pin the behavior the kernel relies on:
 *  - instance registration & typed resolution
 *  - lazy factory registration with memoization
 *  - re-registration semantics (kernel switchWorkspace depends on overwrite)
 *  - precise failure for unknown services (no silent undefined)
 *  - unregister / clear lifecycle
 */

import { describe, test, expect } from "bun:test";
import { ServiceRegistryImpl } from "../../src/core/service-registry.ts";

describe("ServiceRegistry", () => {
  test("resolves a registered instance by id with identity", () => {
    const registry = new ServiceRegistryImpl();
    const svc = { name: "config", value: 42 };
    registry.register("config", svc);
    const resolved = registry.resolve<{ name: string; value: number }>("config");
    expect(resolved).toBe(svc);
    expect(resolved.value).toBe(42);
  });

  test("throws a precise error for unknown services (fail fast)", () => {
    const registry = new ServiceRegistryImpl();
    expect(() => registry.resolve("nope")).toThrow("Service nope not found in registry.");
  });

  test("factories are lazy — not invoked until first resolve", () => {
    const registry = new ServiceRegistryImpl();
    let calls = 0;
    registry.registerFactory("expensive", () => {
      calls++;
      return { made: true };
    });
    expect(calls).toBe(0);
    registry.resolve("expensive");
    expect(calls).toBe(1);
  });

  test("factories are memoized — single construction, shared instance", () => {
    const registry = new ServiceRegistryImpl();
    let calls = 0;
    registry.registerFactory("singleton", () => {
      calls++;
      return { id: calls };
    });
    const first = registry.resolve<{ id: number }>("singleton");
    const second = registry.resolve<{ id: number }>("singleton");
    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(first.id).toBe(1);
  });

  test("re-registering an id overwrites the previous instance", () => {
    const registry = new ServiceRegistryImpl();
    // This is the exact semantic kernel.switchWorkspace() relies on when it
    // closes the old store and registers a fresh one under the same id.
    registry.register("store", { epoch: 1 });
    registry.register("store", { epoch: 2 });
    expect(registry.resolve<{ epoch: number }>("store").epoch).toBe(2);
  });

  test("a direct instance shadows a previously registered factory", () => {
    const registry = new ServiceRegistryImpl();
    registry.registerFactory("svc", () => ({ source: "factory" }));
    registry.register("svc", { source: "instance" });
    expect(registry.resolve<{ source: string }>("svc").source).toBe("instance");
  });

  test("unregister removes both instances and factories", () => {
    const registry = new ServiceRegistryImpl();
    registry.register("a", 1);
    registry.registerFactory("b", () => 2);
    registry.resolve("b"); // memoize
    registry.unregister("a");
    registry.unregister("b");
    expect(() => registry.resolve("a")).toThrow("Service a not found in registry.");
    expect(() => registry.resolve("b")).toThrow("Service b not found in registry.");
  });

  test("clear() empties the whole registry", () => {
    const registry = new ServiceRegistryImpl();
    registry.register("kernel", {});
    registry.registerFactory("store", () => ({}));
    registry.resolve("store");
    registry.clear();
    expect(() => registry.resolve("kernel")).toThrow();
    expect(() => registry.resolve("store")).toThrow();
  });

  test("a throwing factory does not poison the registry — next resolve retries", () => {
    const registry = new ServiceRegistryImpl();
    let attempts = 0;
    registry.registerFactory("flaky", () => {
      attempts++;
      if (attempts === 1) throw new Error("boot failure");
      return { ok: true };
    });
    expect(() => registry.resolve("flaky")).toThrow("boot failure");
    // Failure is not cached: the retry succeeds.
    expect(registry.resolve<{ ok: boolean }>("flaky").ok).toBe(true);
    expect(attempts).toBe(2);
  });

  test("supports the kernel's core service id set end-to-end", () => {
    // Mirrors kernel.bootstrapContainer(): the ids every XR module can rely on.
    const registry = new ServiceRegistryImpl();
    const kernel = { version: "test" };
    registry.register("kernel", kernel);
    registry.register("container", registry);
    registry.register("events", { emit: () => {}, on: () => {} });
    registry.register("store", { dbPath: ":memory:" });

    expect(registry.resolve<ServiceRegistryImpl>("container")).toBe(registry);
    expect(registry.resolve<{ version: string }>("kernel")).toBe(kernel);
    expect(registry.resolve<{ dbPath: string }>("store").dbPath).toBe(":memory:");
  });
});
