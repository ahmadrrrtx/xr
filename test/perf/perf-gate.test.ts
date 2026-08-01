/**
 * XR Phase 3 · T10 — perf-gate regression tests.
 *
 * The gate must:
 *   - pass when budgets + baseline are met;
 *   - fail on a BUDGET violation (current p95 > published budget) — ALWAYS;
 *   - fail on a REGRESSION (current p95 > calibrated baseline × 1.1) when the
 *     band is BLOCKING (same-host baseline cache present);
 *   - only WARN on regression when the band is WARN-ONLY (first run on a
 *     host / no same-host baseline) — a cross-machine baseline must not
 *     false-fail CI;
 *   - pass when a seeded regression is covered by a ratified waiver;
 *   - MACHINE-CALIBRATE the regression band (calibrationFactor, clamp [1,3]);
 *   - never scale the absolute BUDGET gate;
 *   - persist a same-host baseline cache that ratchets DOWN only;
 *   - be non-vacuous: `evaluateGate` is pure and unit-testable, and the CI
 *     job runs the real matrix against the committed baseline.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import {
  evaluateGate,
  loadBudgets,
  calibrationFactor,
  readBaselineCache,
  writeBaselineCache,
  type BudgetDef,
} from "../../scripts/perf-gate.ts";
import type { ScenarioResult } from "../../scripts/perf/harness.ts";

function scenario(id: string, p95: number, warm = true): ScenarioResult {
  return {
    id,
    label: id,
    argv: [],
    mode: "source",
    warm,
    samples: 9,
    successes: 9,
    failures: 0,
    expectedExitCodes: [0],
    exitCodes: [0],
    samplesMs: [p95],
    medianMs: p95,
    p95Ms: p95,
    minMs: p95,
    maxMs: p95,
    peakRssKb: undefined,
    subsystems: [],
    budget: id,
  };
}

const BUDGETS: BudgetDef[] = [
  { id: "version-warm", scenario: "version-warm", warm: true, metric: "p95", ms: 150 },
  { id: "version-cold", scenario: "version", warm: false, metric: "p95", ms: 300 },
  { id: "help-warm", scenario: "help-warm", warm: true, metric: "p95", ms: 150 },
  { id: "doctor", scenario: "doctor", warm: true, metric: "p95", ms: 1000 },
];

describe("Phase 3 · T10 — perf regression gate", () => {
  test("passes when budgets and baseline are met", () => {
    const { violations, warnings } = evaluateGate(
      [scenario("version-warm", 80), scenario("doctor", 200)],
      [scenario("version-warm", 75)],
      BUDGETS,
      0.1,
      new Set(),
    );
    expect(violations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("fails on a BUDGET violation (always blocks)", () => {
    const { violations } = evaluateGate(
      [scenario("version-warm", 200)],
      null,
      BUDGETS,
      0.1,
      new Set(),
    );
    expect(violations.length).toBe(1);
    expect(violations[0]!.kind).toBe("budget");
    expect(violations[0]!.budgetId).toBe("version-warm");
  });

  test("BLOCKING band fails on a REGRESSION beyond 10% of the baseline", () => {
    const { violations } = evaluateGate(
      [scenario("version-warm", 90)],
      [scenario("version-warm", 75)],
      BUDGETS,
      0.1,
      new Set(),
      undefined,
      "block",
    );
    // No calibration reference present → factor 1 → 90 > 75 × 1.1 = 82.5
    expect(violations.some((v) => v.kind === "regression")).toBe(true);
  });

  test("WARN band reports the regression as a warning, never blocks", () => {
    const { violations, warnings } = evaluateGate(
      [scenario("version-warm", 90)],
      [scenario("version-warm", 75)],
      BUDGETS,
      0.1,
      new Set(),
      undefined,
      "warn",
    );
    expect(violations).toEqual([]);
    expect(warnings.some((w) => w.kind === "regression")).toBe(true);
  });

  test("a ratified waiver silences the seeded regression", () => {
    const { violations } = evaluateGate(
      [scenario("version-warm", 90)],
      [scenario("version-warm", 75)],
      BUDGETS,
      0.1,
      new Set(["version-warm"]),
      undefined,
      "block",
    );
    expect(violations).toEqual([]);
  });

  test("machine calibration scales the regression band to the current host", () => {
    // Reference: version cold is 80ms now vs 50ms in the baseline → factor 1.6.
    const scenarios = [
      scenario("version", 80, false),
      scenario("version-warm", 100), // 100 > 75×1.1=82.5, but < 75×1.6×1.1=132
    ];
    const baseline = [
      scenario("version", 50, false),
      scenario("version-warm", 75),
    ];
    expect(calibrationFactor(scenarios, baseline)).toBeCloseTo(1.6, 5);
    const { violations } = evaluateGate(scenarios, baseline, BUDGETS, 0.1, new Set());
    expect(violations).toEqual([]);
  });

  test("calibration is clamped to [1,3] and never tightens below the raw baseline", () => {
    expect(calibrationFactor([scenario("version", 40, false)], [scenario("version", 80, false)])).toBe(1);
    expect(calibrationFactor([scenario("version", 800, false)], [scenario("version", 80, false)])).toBe(3);
    expect(calibrationFactor([scenario("version-warm", 90)], [scenario("version-warm", 75)])).toBe(1);
  });

  test("the budget gate is never scaled by calibration", () => {
    // Even with factor 1.6, a real budget violation (200 > 150) still fails.
    const scenarios = [
      scenario("version", 80, false),
      scenario("version-warm", 200),
    ];
    const baseline = [
      scenario("version", 50, false),
      scenario("version-warm", 75),
    ];
    const { violations } = evaluateGate(scenarios, baseline, BUDGETS, 0.1, new Set());
    expect(violations.some((v) => v.kind === "budget")).toBe(true);
  });

  test("the published budget set is complete for the scenario matrix", () => {
    const budgets = loadBudgets();
    const ids = budgets.map((b) => b.id);
    for (const required of ["version-warm", "version-cold", "help-warm", "help-cold", "doctor", "route-decision", "dashboard-render", "retrieval-100k", "workspace-list"]) {
      expect(ids).toContain(required);
    }
  });

  test("published budgets match the Constitution Article XII ceilings", () => {
    const budgets = loadBudgets();
    const byId = new Map(budgets.map((b) => [b.id, b.ms]));
    expect(byId.get("version-warm")).toBe(150);
    expect(byId.get("version-cold")).toBe(300);
    expect(byId.get("help-warm")).toBe(150);
    expect(byId.get("help-cold")).toBe(300);
  });

  test("same-host baseline cache round-trips and ratchets DOWN only", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-gate-cache-"));
    try {
      const path = join(dir, "perf-baseline-test.json");
      writeBaselineCache(path, [scenario("version-warm", 100), scenario("doctor", 500)]);
      const first = readBaselineCache(path);
      expect(first).not.toBeNull();
      expect(first!.find((s) => s.id === "version-warm")!.p95Ms).toBe(100);

      // Slower run → merged keeps the MIN (100).
      writeBaselineCache(path, [scenario("version-warm", 130), scenario("doctor", 600)]);
      const merged = readBaselineCache(path)!;
      expect(merged.find((s) => s.id === "version-warm")!.p95Ms).toBe(100);
      expect(merged.find((s) => s.id === "doctor")!.p95Ms).toBe(500);

      // Faster run → merged ratchets down to the faster value.
      writeBaselineCache(path, [scenario("version-warm", 60), scenario("doctor", 400)]);
      const faster = readBaselineCache(path)!;
      expect(faster.find((s) => s.id === "version-warm")!.p95Ms).toBe(60);
      expect(faster.find((s) => s.id === "doctor")!.p95Ms).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
