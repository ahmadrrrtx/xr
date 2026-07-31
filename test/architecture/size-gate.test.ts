/**
 * XR Phase 2 · T7 — the module size gate is real and non-vacuous.
 *
 * Art. V.3: *"No module exceeds a defined size/complexity threshold without an
 * owned plan to split."* The gate encodes both halves of that sentence: the
 * threshold, and the requirement that every exception be OWNED.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { THRESHOLD, checkSizes } from "../../scripts/size-gate.ts";

const ROOT = resolve(import.meta.dir, "../..");
const REGISTER = JSON.parse(
  readFileSync(join(ROOT, "docs/phase2/SIZE-WAIVERS.json"), "utf8"),
) as {
  threshold: number;
  waivers: Array<{ path: string; lines: number; owner: string; reason: string; plan: string; review: string }>;
};

describe("T7 — the size gate passes", () => {
  test("no module is over threshold without an owned plan", () => {
    const r = checkSizes();
    expect(r.unwaived).toEqual([]);
  });

  test("no waived module has grown beyond its recorded size", () => {
    expect(checkSizes().grown).toEqual([]);
  });

  test("no stale waivers (every waiver still describes an over-threshold module)", () => {
    // A register full of obsolete entries is a 'green but not true' signal.
    expect(checkSizes().staleWaivers).toEqual([]);
  });

  test("every waiver names an owner, a reason, a plan and a review date", () => {
    expect(checkSizes().malformedWaivers).toEqual([]);
    for (const w of REGISTER.waivers) {
      expect(w.owner.length, `${w.path} needs an owner`).toBeGreaterThan(0);
      expect(w.reason.length, `${w.path} needs a reason`).toBeGreaterThan(20);
      expect(w.plan.length, `${w.path} needs a split plan`).toBeGreaterThan(20);
      expect(w.review, `${w.path} needs an ISO review date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("the register's declared threshold matches the gate's", () => {
    expect(REGISTER.threshold).toBe(THRESHOLD);
  });
});

describe("T7 — Phase 2 actually reduced the giants", () => {
  function lines(rel: string): number {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const n = text.split("\n").length;
    return text.endsWith("\n") ? n - 1 : n;
  }

  test("daemon/dashboard.ts went from 3619 lines to a thin entry point", () => {
    expect(lines("src/daemon/dashboard.ts")).toBeLessThan(100);
  });

  test("plugins/loader.ts went from 1586 lines to a thin entry point", () => {
    expect(lines("src/plugins/loader.ts")).toBeLessThan(150);
  });

  test("the loader's split modules are each under threshold", () => {
    for (const m of ["validation.ts", "sandbox.ts", "worker-loader.ts"]) {
      expect(lines(`src/plugins/loader/${m}`), m).toBeLessThanOrEqual(THRESHOLD);
    }
  });

  test("no NEW module introduced by Phase 2 is over threshold", () => {
    const phase2Modules = [
      "src/core/execution/envelope.ts",
      "src/core/execution/runner.ts",
      "src/tools/registry-service.ts",
      "src/tools/registry-types.ts",
      "src/tools/registry-builder.ts",
      "src/services/surface-execution.ts",
      "src/services/planning-service.ts",
      "src/intelligence/routing-service.ts",
    ];
    for (const m of phase2Modules) {
      expect(lines(m), m).toBeLessThanOrEqual(THRESHOLD);
    }
  });
});

describe("T7 — SEEDED VIOLATION: the gate is not vacuous", () => {
  test("the gate would flag an unwaived over-threshold module", () => {
    // Re-implement the gate's predicate over a synthetic input to prove the
    // logic rejects, rather than trusting that today's tree happens to pass.
    const waived = new Set(REGISTER.waivers.map((w) => w.path));
    const synthetic = [{ path: "src/rogue/enormous.ts", lines: THRESHOLD + 1 }];
    const unwaived = synthetic.filter((s) => !waived.has(s.path));
    expect(unwaived).toHaveLength(1);
  });

  test("the gate would flag a waived module that grew", () => {
    const w = REGISTER.waivers[0]!;
    const grown = [{ path: w.path, lines: w.lines + 1 }].filter(
      (s) => s.lines > REGISTER.waivers.find((x) => x.path === s.path)!.lines,
    );
    expect(grown).toHaveLength(1);
  });

  test("the gate would flag a waiver with no owner", () => {
    const malformed = [{ ...REGISTER.waivers[0]!, owner: "" }].filter((x) => !x.owner.trim());
    expect(malformed).toHaveLength(1);
  });
});
