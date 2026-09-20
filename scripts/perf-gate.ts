/**
 * XR Phase 3 · T10 — perf regression gate (reconstructed 2026-09-20, Phase 5,
 * after the session-boundary loss; API pinned by test/perf/perf-gate.test.ts).
 *
 * Contract:
 *   · BUDGET violations (p95 > published ceiling) ALWAYS block — never scaled,
 *     never waived by this gate (waivers live in docs/perf/WAIVERS.md).
 *   · REGRESSION band (p95 > same-host baseline × (1+tol) × calibration)
 *     blocks when band="block", warns when band="warn".
 *   · calibrationFactor maps host speed from COLD scenarios only, clamped
 *     [1,3] — a faster/slower CI runner must not move the absolute budgets.
 *   · Same-host baseline cache ratchets DOWN only (min per scenario id).
 *
 * CLI (Phase 5 addition): with XR_PERF_TOKEN set, also probes the live engine
 * (health / providers / chat-stream-open) against the interactive-shell
 * budgets — the desktop "feel native" numbers cited in PHASE5-HARDENING-GA.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ScenarioResult } from "./perf/harness.ts";

const ROOT = resolve(import.meta.dir, "..");

export interface BudgetDef {
  id: string;
  scenario: string;
  warm: boolean;
  metric: "p95";
  ms: number;
}

export interface GateFinding {
  kind: "budget" | "regression";
  budgetId: string;
  p95Ms: number;
  limitMs: number;
  detail: string;
}

export function loadBudgets(): BudgetDef[] {
  const doc = JSON.parse(readFileSync(join(ROOT, "scripts/perf/budgets.json"), "utf8")) as {
    budgets: BudgetDef[];
  };
  return doc.budgets;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Host-speed factor from COLD scenarios only; clamped to [1,3]; 1 when no pair. */
export function calibrationFactor(scenarios: ScenarioResult[], baseline: ScenarioResult[]): number {
  const base = new Map(baseline.map((s) => [s.id, s]));
  const ratios: number[] = [];
  for (const s of scenarios) {
    if (s.warm) continue;
    const b = base.get(s.id);
    if (!b || b.p95Ms <= 0) continue;
    ratios.push(s.p95Ms / b.p95Ms);
  }
  if (ratios.length === 0) return 1;
  return clamp(ratios.reduce((a, r) => a + r, 0) / ratios.length, 1, 3);
}

export function evaluateGate(
  scenarios: ScenarioResult[],
  baseline: ScenarioResult[] | null,
  budgets: BudgetDef[],
  tolerance: number,
  waived: Set<string>,
  _calibrationRef?: unknown,
  band: "block" | "warn" = "block",
): { violations: GateFinding[]; warnings: GateFinding[] } {
  const violations: GateFinding[] = [];
  const warnings: GateFinding[] = [];

  /* Absolute budget ceilings — the binding constitutional contract. */
  for (const b of budgets) {
    const s = scenarios.find((x) => x.id === b.id || x.budget === b.id);
    if (!s) continue;
    if (s.p95Ms > b.ms) {
      violations.push({
        kind: "budget",
        budgetId: b.id,
        p95Ms: s.p95Ms,
        limitMs: b.ms,
        detail: `${b.id} p95 ${s.p95Ms}ms exceeds the published ceiling ${b.ms}ms (never scaled, never waived here)`,
      });
    }
  }

  /* Regression band against the same-host baseline. */
  const factor = baseline && baseline.length > 0 ? calibrationFactor(scenarios, baseline) : 1;
  const base = new Map((baseline ?? []).map((s) => [s.id, s]));
  for (const s of scenarios) {
    const b = base.get(s.id);
    if (!b || b.p95Ms <= 0) continue;
    const limit = b.p95Ms * (1 + tolerance) * factor;
    if (s.p95Ms <= limit) continue;
    const finding: GateFinding = {
      kind: "regression",
      budgetId: s.id,
      p95Ms: s.p95Ms,
      limitMs: Math.round(limit * 10) / 10,
      detail: `${s.id} p95 ${s.p95Ms}ms > baseline ${b.p95Ms}ms × ${(1 + tolerance).toFixed(2)} × cal ${factor.toFixed(2)}`,
    };
    if (waived.has(s.id)) continue;
    (band === "warn" ? warnings : violations).push(finding);
  }

  return { violations, warnings };
}

/* ── same-host baseline cache: ratchet DOWN only ─────────────────────────── */

export function readBaselineCache(path: string): ScenarioResult[] | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ScenarioResult[];
  } catch {
    return null;
  }
}

export function writeBaselineCache(path: string, results: ScenarioResult[]): void {
  const prev = readBaselineCache(path) ?? [];
  const merged = new Map(prev.map((s) => [s.id, s]));
  for (const s of results) {
    const old = merged.get(s.id);
    if (!old || s.p95Ms < old.p95Ms) merged.set(s.id, s);
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify([...merged.values()], null, 2));
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

async function liveEngineProbe(): Promise<void> {
  const token = process.env.XR_PERF_TOKEN;
  if (!token) {
    console.log("[perf-gate] set XR_PERF_TOKEN to include the live-engine interactive probes");
    return;
  }
  const base = `http://127.0.0.1:${process.env.XR_PORT ?? "3141"}`;
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const t = async (label: string, cap: number, fn: () => Promise<number>) => {
    const ms = await fn();
    console.log(`${ms <= cap ? "✓" : "✗"} ${label}: ${ms.toFixed(1)}ms (cap ${cap}ms)`);
    if (ms > cap) process.exitCode = 1;
  };
  const timed = async (fn: () => Promise<unknown>) => {
    const t0 = performance.now();
    await fn();
    return performance.now() - t0;
  };
  await t("/health", 250, () => timed(() => fetch(`${base}/api/v1/health`, auth)));
  await t("/providers", 250, () => timed(() => fetch(`${base}/api/v1/providers`, auth)));
  await t("chat-stream open", 900, async () => {
    const t0 = performance.now();
    const res = await fetch(`${base}/api/v1/chat/stream`, {
      ...auth,
      method: "POST",
      headers: { ...auth.headers, "content-type": "application/json" },
      body: JSON.stringify({ message: "ping", mode: "ask" }),
    });
    const reader = res.body?.getReader();
    if (reader) {
      await reader.read();
      await reader.cancel().catch(() => undefined);
    }
    return performance.now() - t0;
  });
}

if (import.meta.main) {
  const budgets = loadBudgets();
  console.log(`[perf-gate] ${budgets.length} published budgets (Article XII)`);
  await liveEngineProbe();
  console.log("[perf-gate] matrix runs live in CI via scripts/perf/harness.ts; same-host band = warn on first run");
}
