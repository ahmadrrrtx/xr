/**
 * XR Phase 3 · T6 — model-switch state machine tests.
 *
 * Injected deps drive the whole machine without network:
 *   - happy path: preflight → warm → canary → swap → verify → done;
 *   - preflight failure refuses the switch (no phases after preflight);
 *   - canary failure rolls back (refuses) with the previous config kept;
 *   - --force bypasses a failed canary;
 *   - swap failure triggers rollback (previous config re-applied);
 *   - verify failure (config read-back mismatch) triggers rollback;
 *   - timeouts: a slow warm probe is bounded (no unexplained waits).
 */

import { describe, test, expect } from "bun:test";
import {
  ModelSwitchStateMachine,
  type ModelSwitchDeps,
  type SwitchTarget,
} from "../../src/providers/model-switch.ts";

function makeDeps(overrides: Partial<ModelSwitchDeps> = {}): ModelSwitchDeps & { applied: SwitchTarget[] } {
  let active: SwitchTarget = { providerId: "openai", model: "gpt-4o-mini" };
  const applied: SwitchTarget[] = [];
  return {
    preflight: (t) =>
      t.providerId === "unknown"
        ? { ok: false, detail: `unknown provider: ${t.providerId}` }
        : { ok: true, detail: "known" },
    warm: async (t) => ({ ok: true, detail: `warm ${t.providerId}` }),
    canary: async (t) => ({ ok: true, detail: `canary ${t.providerId}` }),
    apply: async (t) => {
      applied.push({ ...t });
      active = { ...t };
    },
    readActive: () => ({ ...active }),
    ...overrides,
    applied,
  };
}

describe("Phase 3 · T6 — model-switch state machine", () => {
  test("happy path: preflight → warm → canary → swap → verify → done", async () => {
    const deps = makeDeps();
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "anthropic", model: "claude-3-5-sonnet" });
    expect(result.ok).toBe(true);
    const phases = result.phases.map((p) => p.phase);
    expect(phases).toEqual(["preflight", "warm", "canary", "swap", "verify", "done"]);
    expect(deps.applied).toEqual([{ providerId: "anthropic", model: "claude-3-5-sonnet" }]);
  });

  test("preflight failure refuses the switch", async () => {
    const deps = makeDeps();
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "unknown" });
    expect(result.ok).toBe(false);
    expect(result.phases.map((p) => p.phase)).toEqual(["preflight"]);
    expect(deps.applied).toEqual([]);
  });

  test("canary failure refuses the switch and keeps previous (rollback)", async () => {
    const deps = makeDeps({
      canary: async () => ({ ok: false, detail: "API key not set" }),
    });
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "anthropic", model: "claude-3-5-sonnet" });
    expect(result.ok).toBe(false);
    expect(deps.applied).toEqual([]); // nothing swapped
    expect(result.previous).toEqual({ providerId: "openai", model: "gpt-4o-mini" });
    expect(result.phases.some((p) => p.phase === "rolled-back")).toBe(true);
  });

  test("--force bypasses a failed canary and still verifies", async () => {
    const deps = makeDeps({
      canary: async () => ({ ok: false, detail: "API key not set" }),
    });
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "anthropic", model: "claude-3-5-sonnet" }, { force: true });
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(true);
    expect(deps.applied).toEqual([{ providerId: "anthropic", model: "claude-3-5-sonnet" }]);
  });

  test("swap failure triggers rollback (previous config re-applied)", async () => {
    const deps = makeDeps({
      apply: async (t) => {
        if (t.providerId === "broken") throw new Error("config write failed");
        deps.applied.push({ ...t });
      },
    });
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "broken" });
    expect(result.ok).toBe(false);
    expect(result.phases.some((p) => p.phase === "rolled-back")).toBe(true);
  });

  test("verify read-back mismatch triggers rollback", async () => {
    const deps = makeDeps({
      readActive: () => ({ providerId: "openai", model: "gpt-4o-mini" }), // never changes
    });
    const machine = new ModelSwitchStateMachine(deps);
    const result = await machine.run({ providerId: "anthropic", model: "claude-3-5-sonnet" });
    expect(result.ok).toBe(false);
    expect(result.phases.some((p) => p.phase === "rolled-back")).toBe(true);
  });

  test("slow warm probe is bounded by its timeout (no unexplained waits)", async () => {
    const deps = makeDeps({
      warm: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, detail: "late" }), 2_000)),
    });
    const machine = new ModelSwitchStateMachine({
      ...deps,
      timeouts: { warm: 100 },
    });
    const started = performance.now();
    const result = await machine.run({ providerId: "anthropic" });
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(false);
    expect(elapsed).toBeLessThan(1_500); // bounded far below the 2s probe
  }, 10_000);
});
