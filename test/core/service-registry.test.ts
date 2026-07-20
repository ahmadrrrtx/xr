/**
 * XR — ServiceRegistry (typed DI) tests.
 *
 * The registry is the strongly-typed, token-based DI container that sits at the
 * foundation of the XR runtime. These tests pin the behavior the kernel relies
 * on — now exercised through typed tokens instead of magic strings:
 *  - typed instance registration & resolution with identity
 *  - lazy singleton factories with memoization
 *  - transient factories (fresh instance per resolve)
 *  - re-registration / overwrite semantics (switchWorkspace depends on this)
 *  - precise, fail-fast failure for unknown tokens (no silent undefined)
 *  - unregister / clear lifecycle
 *  - fail-safe singleton: a throwing factory is not memoized (retry succeeds)
 *  - lifecycle participant discovery + dependency ordering
 */

import { describe, test, expect } from "bun:test";
import { ServiceRegistry, token } from "../../src/core/service-registry.ts";

interface ConfigLike {
  name: string;
  value: number;
}

const Config = token<ConfigLike>("test.config", "config");
const Expensive = token<{ made: boolean }>("test.expensive");
const Singleton = token<{ id: number }>("test.singleton");
const Transient = token<{ n: number }>("test.transient");
const Store = token<{ epoch: number }>("test.store");
const Shadowed = token<{ source: string }>("test.shadowed");
const Flaky = token<{ ok: boolean }>("test.flaky");
const Unknown = token<unknown>("test.unknown");

describe("ServiceRegistry", () => {
  test("resolves a registered instance by token with identity", () => {
    const registry = new ServiceRegistry();
    const svc: ConfigLike = { name: "config", value: 42 };
    registry.registerValue(Config, svc);
    const resolved = registry.resolve(Config);
    expect(resolved).toBe(svc);
    expect(resolved.value).toBe(42);
  });

  test("register() is a value-scope alias of registerValue()", () => {
    const registry = new ServiceRegistry();
    const svc = { name: "config", value: 7 };
    registry.register(Config, svc);
    expect(registry.resolve(Config)).toBe(svc);
  });

  test("throws a precise error for unknown tokens (fail fast)", () => {
    const registry = new ServiceRegistry();
    expect(() => registry.resolve(Unknown)).toThrow(
      "Service test.unknown not found in registry.",
    );
  });

  test("tryResolve returns undefined for unknown tokens without throwing", () => {
    const registry = new ServiceRegistry();
    expect(registry.tryResolve(Unknown)).toBeUndefined();
    registry.registerValue(Config, { name: "c", value: 1 });
    expect(registry.tryResolve(Config)?.value).toBe(1);
  });

  test("has() reports registration", () => {
    const registry = new ServiceRegistry();
    expect(registry.has(Config)).toBe(false);
    registry.registerValue(Config, { name: "c", value: 1 });
    expect(registry.has(Config)).toBe(true);
  });

  test("singletons are lazy — factory not invoked until first resolve", () => {
    const registry = new ServiceRegistry();
    let calls = 0;
    registry.registerSingleton(Expensive, () => {
      calls++;
      return { made: true };
    });
    expect(calls).toBe(0);
    registry.resolve(Expensive);
    expect(calls).toBe(1);
  });

  test("singletons are memoized — single construction, shared instance", () => {
    const registry = new ServiceRegistry();
    let calls = 0;
    registry.registerSingleton(Singleton, () => {
      calls++;
      return { id: calls };
    });
    const first = registry.resolve(Singleton);
    const second = registry.resolve(Singleton);
    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(first.id).toBe(1);
  });

  test("transients produce a fresh instance on every resolve", () => {
    const registry = new ServiceRegistry();
    let calls = 0;
    registry.registerTransient(Transient, () => ({ n: ++calls }));
    const a = registry.resolve(Transient);
    const b = registry.resolve(Transient);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
  });

  test("re-registering a token overwrites the previous instance", () => {
    const registry = new ServiceRegistry();
    // kernel.switchWorkspace() relies on this when it rebinds the store.
    registry.registerValue(Store, { epoch: 1 });
    registry.registerValue(Store, { epoch: 2 });
    expect(registry.resolve(Store).epoch).toBe(2);
  });

  test("a value registration shadows a previously registered singleton", () => {
    const registry = new ServiceRegistry();
    registry.registerSingleton(Shadowed, () => ({ source: "factory" }));
    registry.registerValue(Shadowed, { source: "instance" });
    expect(registry.resolve(Shadowed).source).toBe("instance");
  });

  test("unregister removes the service", () => {
    const registry = new ServiceRegistry();
    registry.registerValue(Config, { name: "c", value: 1 });
    registry.registerSingleton(Expensive, () => ({ made: true }));
    registry.resolve(Expensive); // memoize
    registry.unregister(Config);
    registry.unregister(Expensive);
    expect(() => registry.resolve(Config)).toThrow();
    expect(() => registry.resolve(Expensive)).toThrow();
  });

  test("clear() empties the whole registry", () => {
    const registry = new ServiceRegistry();
    registry.registerValue(Config, { name: "c", value: 1 });
    registry.registerSingleton(Expensive, () => ({ made: true }));
    registry.resolve(Expensive);
    registry.clear();
    expect(() => registry.resolve(Config)).toThrow();
    expect(() => registry.resolve(Expensive)).toThrow();
    expect(registry.size).toBe(0);
  });

  test("a throwing singleton factory does not poison the registry — next resolve retries", () => {
    const registry = new ServiceRegistry();
    let attempts = 0;
    registry.registerSingleton(Flaky, () => {
      attempts++;
      if (attempts === 1) throw new Error("boot failure");
      return { ok: true };
    });
    expect(() => registry.resolve(Flaky)).toThrow("boot failure");
    // Failure is not cached: the retry succeeds.
    expect(registry.resolve(Flaky).ok).toBe(true);
    expect(attempts).toBe(2);
  });

  test("returns lifecycle participants in dependency order", () => {
    const registry = new ServiceRegistry();
    const A = token<{ id: string }>("a");
    const B = token<{ id: string }>("b");
    const C = token<{ id: string }>("c");
    // C depends on B, B depends on A — order must be A, B, C even though
    // registered as A, B, C (and would also correct a different registration order).
    registry.registerValue(A, { id: "A" }, { lifecycle: true });
    registry.registerValue(B, { id: "B" }, { lifecycle: true, dependsOn: [A] });
    registry.registerValue(C, { id: "C" }, { lifecycle: true, dependsOn: [B] });

    const ordered = registry.lifecycleTokens().map((t) => t.id);
    expect(ordered).toEqual(["a", "b", "c"]);

    const resolved = ordered.map((id) => registry.resolve(token(id)));
    expect(resolved.map((r: any) => r.id)).toEqual(["A", "B", "C"]);
  });

  test("entries() exposes an introspection snapshot", () => {
    const registry = new ServiceRegistry();
    registry.registerValue(Config, { name: "c", value: 1 }, { lifecycle: true });
    registry.registerSingleton(Expensive, () => ({ made: true }));
    const snapshot = registry.entries();
    expect(snapshot.map((e) => e.id).sort()).toEqual(["test.config", "test.expensive"]);
    const cfg = snapshot.find((e) => e.id === "test.config")!;
    expect(cfg.scope).toBe("value");
    expect(cfg.lifecycle).toBe(true);
  });
});
