/**
 * XR Phase 5 · T6 — routing SLO collection + reporting.
 *
 * Asserts EFFECTS: the SLO report aggregates selection latency (p50/p95 vs
 * the 20ms budget), fallback and degradation rates, cost-per-quality and CPR
 * — and the live router's selection latency measures WELL under budget.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutingSlo, SELECTION_BUDGET_MS } from "../../src/intelligence/slo.ts";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";

let xrHome: string;

beforeEach(() => {
  xrHome = mkdtempSync(join(tmpdir(), "xr-slo-"));
  process.env.XR_HOME = xrHome;
});

afterEach(() => {
  rmSync(xrHome, { recursive: true, force: true });
  delete process.env.XR_HOME;
});

describe("Phase 5 · routing SLO collector", () => {
  test("aggregates selections, fallbacks, degradations, cpq and CPR into one report", () => {
    const slo = new RoutingSlo({ file: null });
    const now = Date.now();
    for (const ms of [1.2, 2.1, 0.8, 3.3, 1.7, 2.9, 1.1, 4.2]) {
      slo.record({ kind: "selection", at: now, ms, mode: "automatic", manual: false, unavailable: false });
    }
    slo.record({ kind: "selection", at: now, ms: 1.0, mode: "manual", manual: true, unavailable: false });
    slo.record({ kind: "fallback", at: now, from: "ollama/m1", to: "lmstudio/m2", trigger: "transient", level: "L1_equivalent_fallback", cpr: 1 });
    slo.record({ kind: "fallback", at: now, from: "lmstudio/m2", to: "jan/m3", trigger: "semantic", level: "L2_reduced_fallback", cpr: 1 });
    slo.record({ kind: "degradation", at: now, level: "L1_equivalent_fallback", reason: "failover" });
    slo.record({ kind: "cpq", at: now, target: "openai/gpt-4o", costUsd: 0.01, fidelity: 0.92 });
    slo.record({ kind: "cpq", at: now, target: "ollama/qwen2.5:7b", costUsd: 0, fidelity: 0.8 });
    slo.record({ kind: "cpr", at: now, cpr: 1.0, source: "harness" });
    slo.record({ kind: "cpr", at: now, cpr: 0.98, source: "harness" });
    slo.record({ kind: "breaker", at: now, target: "groq/x", state: "open", reason: "error rate" });

    const r = slo.report();
    expect(r.selection.count).toBe(9);
    expect(r.selection.p50Ms).toBeGreaterThan(0);
    expect(r.selection.withinBudget).toBe(true);
    expect(r.selection.manualRate).toBeCloseTo(1 / 9, 2);
    expect(r.fallback.total).toBe(2);
    expect(r.fallback.ratePerSelection).toBeCloseTo(2 / 9, 2);
    expect(r.fallback.byTrigger["transient"]).toBe(1);
    expect(r.fallback.byTrigger["semantic"]).toBe(1);
    expect(r.degradation.total).toBe(1);
    expect(r.costPerQuality.samples).toBe(2);
    expect(r.costPerQuality.avgFidelity).toBeCloseTo(0.86, 2);
    expect(r.cpr.samples).toBe(2);
    expect(r.cpr.mean).toBeCloseTo(0.99, 2);
    expect(r.cpr.met).toBe(true);
    expect(r.breaker.trips).toBe(1);
  });

  test("empty window reports zeros and 'met' defaults (honest cold start)", () => {
    const slo = new RoutingSlo({ file: null });
    const r = slo.report(1_000);
    expect(r.selection.count).toBe(0);
    expect(r.fallback.total).toBe(0);
    expect(r.cpr.samples).toBe(0);
    expect(r.cpr.mean).toBe(1);
  });

  test("events persist to JSONL and are re-read by a fresh collector (no double count)", () => {
    const slo = new RoutingSlo();
    slo.record({ kind: "selection", at: Date.now(), ms: 2.5, mode: "automatic", manual: false, unavailable: false });
    slo.record({ kind: "fallback", at: Date.now(), from: "a/1", to: "b/2", trigger: "permanent", level: "L1_equivalent_fallback" });

    const reread = new RoutingSlo();
    const r = reread.report();
    expect(r.selection.count).toBe(1); // not 2 (no file+memory double count)
    expect(r.fallback.total).toBe(1);
  });

  test("old events fall outside the window", () => {
    const slo = new RoutingSlo({ file: null });
    const ancient = Date.now() - 48 * 60 * 60 * 1000;
    slo.record({ kind: "selection", at: ancient, ms: 5, mode: "automatic", manual: false, unavailable: false });
    const r = slo.report(60_000);
    expect(r.selection.count).toBe(0);
  });

  test("LIVE measurement: 300 real routing decisions measure p95 well under the 20ms budget", () => {
    const config = ConfigSchema.parse({ defaults: { provider: "ollama", model: "qwen2.5:7b" } }) as XRConfig;
    const catalog = buildCatalog(config);
    const router = new IntelligenceRouter({ catalog });
    const slo = new RoutingSlo({ file: null });
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      router.route(config, { requirements: { modelClass: "chat", require: { toolUse: true }, summary: `task ${i}` } });
      slo.record({
        kind: "selection",
        at: Date.now(),
        ms: performance.now() - t,
        mode: "automatic",
        manual: false,
        unavailable: false,
      });
    }
    const total = performance.now() - t0;
    const r = slo.report();
    expect(r.selection.count).toBe(300);
    expect(r.selection.p95Ms).toBeLessThan(SELECTION_BUDGET_MS);
    // sanity: decisions are sub-millisecond to low-single-digit ms typically
    expect(total / 300).toBeLessThan(5);
  });

  test("SELECTION_BUDGET_MS is the contracted 20ms", () => {
    expect(SELECTION_BUDGET_MS).toBe(20);
  });
});
