/**
 * Phase 1 · S0 boot splash honesty probe (D-V3-5, `desktop/src/boot.ts`).
 *
 * The plan's DoD: a warm boot shows NO splash; a cold boot shows only real
 * facts; a failure explains itself immediately with the engine's own words.
 * The decision logic is pure, so these are deterministic.
 */
import { describe, expect, test } from "bun:test";
import {
  BOOT_LABEL,
  INITIAL_FACTS,
  SPLASH_GRACE_MS,
  allOk,
  anyFailed,
  formatBootLine,
  settle,
  shouldShowSplash,
  type BootFact,
} from "../../desktop/src/boot.ts";

const warm = (): BootFact[] =>
  settle(
    settle(settle(INITIAL_FACTS, "link", { state: "ok", atMs: 41, detail: "sidecar :52341" }), "health", {
      state: "ok",
      atMs: 88,
      detail: "engine 1.0.0",
    }),
    "setup",
    { state: "ok", atMs: 120, detail: "configured" },
  );

describe("boot splash · honesty rules", () => {
  test("a warm boot never shows the splash — regardless of elapsed time", () => {
    const facts = warm();
    expect(allOk(facts)).toBe(true);
    for (const t of [0, 100, SPLASH_GRACE_MS - 1, SPLASH_GRACE_MS, 5_000]) {
      expect(shouldShowSplash(facts, t)).toBe(false);
    }
  });

  test("inside the grace window a still-booting engine paints nothing", () => {
    expect(shouldShowSplash(INITIAL_FACTS, 0)).toBe(false);
    expect(shouldShowSplash(INITIAL_FACTS, SPLASH_GRACE_MS - 1)).toBe(false);
    const partial = settle(INITIAL_FACTS, "link", { state: "ok", atMs: 12, detail: "sidecar :52341" });
    expect(shouldShowSplash(partial, SPLASH_GRACE_MS - 1)).toBe(false);
  });

  test("past the grace window, pending facts show the splash with those facts pending", () => {
    const partial = settle(INITIAL_FACTS, "link", { state: "ok", atMs: 12, detail: "sidecar :52341" });
    expect(shouldShowSplash(partial, SPLASH_GRACE_MS)).toBe(true);
    const lines = partial.map(formatBootLine);
    expect(lines.map((l) => l.state)).toEqual(["ok", "pending", "pending"]);
    expect(lines[1].timing).toBe("…"); // no invented timing for a fact that has not landed
  });

  test("a failure shows the splash IMMEDIATELY, with the engine's own reason and stderr", () => {
    const failed = settle(INITIAL_FACTS, "link", {
      state: "fail",
      atMs: 20_000,
      detail: "sidecar exited (stdout closed)",
      stderr: ["Error: EADDRINUSE 127.0.0.1:3141", "    at listen"],
    });
    expect(anyFailed(failed)).toBe(true);
    expect(shouldShowSplash(failed, 0)).toBe(true); // not gated by the grace window
    const line = formatBootLine(failed[0]);
    expect(line.state).toBe("fail");
    expect(line.detail).toBe("sidecar exited (stdout closed)");
    expect(failed[0].stderr).toHaveLength(2);
  });

  test("lines carry only what the engine said — a settled fact without detail renders empty, not a placeholder", () => {
    const f = formatBootLine({ key: "health", state: "ok", atMs: 33 });
    expect(f.label).toBe(BOOT_LABEL.health);
    expect(f.timing).toBe("33ms");
    expect(f.detail).toBe("");
  });

  test("settle() is per-key and immutable (a retry can reset to INITIAL_FACTS safely)", () => {
    const next = settle(INITIAL_FACTS, "setup", { state: "ok", atMs: 5, detail: "configured" });
    expect(INITIAL_FACTS.every((f) => f.state === "pending")).toBe(true);
    expect(next.filter((f) => f.state === "ok").map((f) => f.key)).toEqual(["setup"]);
  });

  test("the grace window is the HIG-scale number the design doc commits to", () => {
    expect(SPLASH_GRACE_MS).toBe(300);
  });
});
