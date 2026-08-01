#!/usr/bin/env bun
/**
 * XR Phase 3 · T10 — Performance regression gate (CI).
 *
 *   bun run scripts/perf-gate.ts [--baseline docs/perf/baseline-<v>-<mode>.json]
 *                                [--samples 9] [--mode source|wrapper|binary]
 *                                [--binary path] [--max-regression 0.10]
 *                                [--waiver <budget-or-scenario-id>] ...
 *                                [--baseline-cache <path>]
 *
 * Two independent failure conditions (Article XII):
 *
 *   1. BUDGET GATE — current p95 exceeds the published absolute budget
 *      (scripts/perf/budgets.json; values are the Constitution Article XII
 *      ceilings: --version/--help <150ms warm / <300ms cold, doctor <1s,
 *      route <20ms, dashboard <1s, retrieval + workspace-list <1s).
 *      ALWAYS BLOCKS. Never scaled, never waived silently.
 *
 *   2. REGRESSION BAND — current p95 exceeds a same-host baseline p95 by more
 *      than `--max-regression` (default 10%) without a ratified waiver.
 *      BLOCKS only when the comparison baseline was measured ON THIS HOST
 *      (the baseline cache in ~/.cache/xr/perf-baseline-<mode>.json, persisted
 *      across CI runs via actions/cache). The very first run on any host has
 *      no same-host baseline, so the band WARNS instead of blocking and the
 *      run seeds the cache; from run 2 onward the band blocks on that host.
 *      This is what keeps a baseline measured on a developer sandbox from
 *      false-failing CI on GitHub's runners while still catching real
 *      regressions per host. The committed docs/perf/baseline-*.json remains
 *      the reference artifact and the seed for the first run's warning.
 *
 * Machine calibration: when the band is active, the `version` (cold)
 * reference scenario scales the band: factor = clamp(current ref p95 /
 * baseline ref p95, 1.0, 3.0). The budget gate is never scaled.
 *
 * The cache ratchets DOWN only (min p95 per scenario), so one noisy run can
 * never loosen the band for later runs.
 *
 * Exits non-zero on any blocking violation so CI fails. Waivers are recorded
 * in docs/perf/WAIVERS.md with owner + review date (Part 19).
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { freshIsolationRoot, runMatrix, type LaunchConfig, type LaunchMode, type ScenarioResult } from "./perf/harness.ts";

const MODES: LaunchMode[] = ["source", "wrapper", "binary"];
const ROOT = join(import.meta.dir, "..");
const DEFAULT_MAX_REGRESSION = 0.10;
/** Version marker printed on every run — confirm "XR PERF GATE v3" in CI logs. */
export const GATE_VERSION = "v3-same-host-cache";
/** The calibration reference scenario: spawn+exit, no kernel, hardware-bound. */
export const CALIBRATION_SCENARIO = "version";
export type BandMode = "block" | "warn";

export interface BudgetDef {
  id: string;
  scenario: string;
  warm: boolean;
  metric: string;
  ms: number;
}

export interface GateViolation {
  kind: "budget" | "regression";
  scenarioId: string;
  budgetId?: string;
  currentP95: number;
  limit: number;
  detail: string;
}

export interface GateResult {
  violations: GateViolation[];
  warnings: GateViolation[];
}

export function loadBudgets(): BudgetDef[] {
  const raw = JSON.parse(readFileSync(join(ROOT, "scripts", "perf", "budgets.json"), "utf8")) as {
    budgets: BudgetDef[];
  };
  return raw.budgets;
}

/**
 * Machine calibration factor: how much slower (or faster) the current host is
 * than the baseline host, measured on the `version` cold reference scenario.
 * Clamped to [1, 3]. Returns 1 when the reference pair is unavailable.
 */
export function calibrationFactor(
  scenarios: ScenarioResult[],
  baseline: ScenarioResult[] | null,
): number {
  if (!baseline) return 1;
  const cur = scenarios.find((s) => s.id === CALIBRATION_SCENARIO && !s.warm);
  const base = baseline.find((s) => s.id === CALIBRATION_SCENARIO && !s.warm);
  if (!cur || !base || base.p95Ms <= 0 || cur.samples <= 0) return 1;
  return Math.min(3, Math.max(1, cur.p95Ms / base.p95Ms));
}

/**
 * Pure gate evaluation — unit-testable without spawning processes.
 *
 * @param bandMode "block" (same-host baseline cache present) or "warn"
 *                 (first run on this host / no same-host baseline).
 * Returns { violations, warnings }; violations block CI, warnings do not.
 */
export function evaluateGate(
  scenarios: ScenarioResult[],
  baseline: ScenarioResult[] | null,
  budgets: BudgetDef[],
  maxRegression: number,
  waivers: ReadonlySet<string>,
  factorOverride?: number,
  bandMode: BandMode = "block",
): GateResult {
  const violations: GateViolation[] = [];
  const warnings: GateViolation[] = [];
  const factor = factorOverride ?? calibrationFactor(scenarios, baseline);

  for (const sc of scenarios) {
    // Budget gate: absolute published ceiling (never scaled, always blocks).
    for (const b of budgets) {
      if (b.scenario !== sc.id || b.warm !== sc.warm) continue;
      if (sc.p95Ms > b.ms && !waivers.has(b.id) && !waivers.has(sc.id)) {
        violations.push({
          kind: "budget",
          scenarioId: sc.id,
          budgetId: b.id,
          currentP95: sc.p95Ms,
          limit: b.ms,
          detail: `${b.id}: p95 ${sc.p95Ms.toFixed(1)} ms exceeds published budget ${b.ms} ms`,
        });
      }
    }

    // Regression band: vs. same-host baseline (block) or committed baseline (warn).
    const base = baseline?.find((b) => b.id === sc.id && b.warm === sc.warm);
    if (base && sc.samples > 0) {
      // Sub-millisecond baselines (micro-benches) use an absolute +1 ms floor.
      const raw = base.p95Ms < 1 ? base.p95Ms + 1 : base.p95Ms * (1 + maxRegression);
      const limit = raw * factor;
      if (sc.p95Ms > limit && !waivers.has(sc.id)) {
        const v: GateViolation = {
          kind: "regression",
          scenarioId: sc.id,
          currentP95: sc.p95Ms,
          limit,
          detail: `${sc.id}: p95 ${sc.p95Ms.toFixed(1)} ms exceeds calibrated baseline ${base.p95Ms.toFixed(1)} ms x ${factor.toFixed(2)} by ${(((sc.p95Ms - base.p95Ms * factor) / (base.p95Ms * factor)) * 100).toFixed(1)}% (max ${(maxRegression * 100).toFixed(0)}%)`,
        };
        if (bandMode === "block") violations.push(v);
        else warnings.push(v);
      }
    }
  }
  return { violations, warnings };
}

// ── Same-host baseline cache ────────────────────────────────────────────────

export interface BaselineCacheFile {
  host: { os: string; arch: string; bun: string };
  updatedAt: string;
  scenarios: ScenarioResult[];
}

export function defaultCachePath(mode: LaunchMode): string {
  return join(process.env.XR_PERF_BASELINE_CACHE ?? join(homedir(), ".cache", "xr"), `perf-baseline-${mode}.json`);
}

function hostFingerprint(): { os: string; arch: string; bun: string } {
  return { os: process.platform, arch: process.arch, bun: process.env.BUN_VERSION ?? "unknown" };
}

/** Read the same-host baseline cache; null when missing or host-mismatched. */
export function readBaselineCache(path: string): ScenarioResult[] | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as BaselineCacheFile;
    const h = hostFingerprint();
    if (raw.host.os !== h.os || raw.host.arch !== h.arch) return null;
    if (h.bun !== "unknown" && raw.host.bun !== "unknown" && raw.host.bun !== h.bun) return null;
    return raw.scenarios ?? null;
  } catch {
    return null; // corrupt cache → treat as absent (warn mode)
  }
}

/** Merge current measurements into the cache (ratchets DOWN only). */
export function writeBaselineCache(path: string, scenarios: ScenarioResult[]): void {
  try {
    const prev = readBaselineCache(path);
    const merged: ScenarioResult[] = [];
    const byKey = new Map<string, ScenarioResult>();
    for (const s of scenarios) byKey.set(`${s.id}|${s.warm}`, s);
    for (const s of prev ?? []) {
      const cur = byKey.get(`${s.id}|${s.warm}`);
      if (cur) {
        const keep = cur.p95Ms < s.p95Ms ? cur : s;
        merged.push(keep);
        byKey.delete(`${s.id}|${s.warm}`);
      } else {
        merged.push(s);
      }
    }
    for (const s of byKey.values()) merged.push(s);
    mkdirSync(join(path, ".."), { recursive: true });
    const file: BaselineCacheFile = {
      host: hostFingerprint(),
      updatedAt: new Date().toISOString(),
      scenarios: merged,
    };
    writeFileSync(path, JSON.stringify(file, null, 2));
  } catch {
    /* cache write is best-effort — never fail the gate on it */
  }
}

function parseArgs(): {
  baselinePath?: string;
  samples: number;
  mode: LaunchMode;
  binary?: string;
  maxRegression: number;
  waivers: string[];
  cachePath?: string;
} {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = (get("--mode") ?? process.env.XR_PERF_MODE ?? "source") as LaunchMode;
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}; expected ${MODES.join("|")}`);
  const waivers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--waiver") waivers.push(argv[i + 1] ?? "");
  }
  return {
    baselinePath: get("--baseline"),
    samples: Number(get("--samples") ?? process.env.XR_PERF_SAMPLES ?? 9),
    mode,
    binary: get("--binary"),
    maxRegression: Number(get("--max-regression") ?? process.env.XR_PERF_MAX_REGRESSION ?? DEFAULT_MAX_REGRESSION),
    waivers,
    cachePath: get("--baseline-cache") ?? defaultCachePath(mode),
  };
}

async function main(): Promise<void> {
  const { baselinePath, samples, mode, binary, maxRegression, waivers, cachePath: cachePathArg } = parseArgs();
  if (mode === "binary" && !binary) throw new Error("--binary <path> required for binary mode");
  const cachePath = cachePathArg ?? defaultCachePath(mode);
  const cfg: LaunchConfig = { mode, binaryPath: binary };

  const committedBaseline: ScenarioResult[] | null = baselinePath
    ? (JSON.parse(readFileSync(baselinePath, "utf8")).scenarios as ScenarioResult[])
    : null;

  const isolationRoot = freshIsolationRoot("gate");
  let report;
  try {
    report = await runMatrix({ cfg, defaultSamples: samples, isolationRoot });
  } finally {
    try {
      rmSync(isolationRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  // Same-host baseline cache decides the band mode.
  const cached = readBaselineCache(cachePath);
  const bandMode: BandMode = cached ? "block" : "warn";
  const baseline = cached ?? committedBaseline;

  const factor = calibrationFactor(report.scenarios, baseline);
  const budgets = loadBudgets();
  const { violations, warnings } = evaluateGate(
    report.scenarios,
    baseline,
    budgets,
    maxRegression,
    new Set(waivers),
    factor,
    bandMode,
  );

  // Seed/refresh the same-host cache (ratchet down only).
  writeBaselineCache(cachePath, report.scenarios);

  console.log("XR PERF GATE " + GATE_VERSION + " - budgets are Constitution Article XII ceilings; regression band is same-host-only (warn on first run, block from run 2).");
  const header = [
    "Scenario".padEnd(24),
    "mode".padEnd(6),
    "p50".padStart(8),
    "p95".padStart(8),
    "baseline".padStart(9),
    "budget".padStart(8),
    "verdict".padEnd(10),
  ].join(" ");
  console.log("\n" + header);
  console.log(
    "regression band: " +
      (bandMode === "block" ? "BLOCKING (same-host baseline cache)" : "WARN-ONLY (first run on this host; budget gate still blocks)") +
      " · calibration factor " +
      factor.toFixed(2) +
      " · cache " +
      cachePath,
  );
  for (const sc of report.scenarios) {
    const base = baseline?.find((b) => b.id === sc.id && b.warm === sc.warm)?.p95Ms;
    const bud = budgets.find((b) => b.scenario === sc.id && b.warm === sc.warm)?.ms;
    const v = violations.find((x) => x.scenarioId === sc.id);
    const w = !v ? warnings.find((x) => x.scenarioId === sc.id) : undefined;
    console.log(
      sc.label.padEnd(24) +
        " " +
        (sc.warm ? "warm" : "cold").padEnd(6) +
        " " +
        sc.medianMs.toFixed(1).padStart(8) +
        " " +
        sc.p95Ms.toFixed(1).padStart(8) +
        " " +
        (base != null ? base.toFixed(1) : "-").padStart(9) +
        " " +
        (bud != null ? String(bud) : "-").padStart(8) +
        " " +
        (v ? v.kind.toUpperCase() : w ? "WARN" : "PASS").padEnd(10),
    );
  }

  if (warnings.length > 0) {
    console.log("\nWARNINGS (regression band, non-blocking on first host run):");
    for (const w of warnings) console.log("  ! [" + w.kind + "] " + w.detail);
  }
  if (violations.length > 0) {
    console.error("\nPERF GATE FAILED:");
    for (const v of violations) console.error("  - [" + v.kind + "] " + v.detail);
    console.error(
      waivers.length
        ? "\nwaivers applied: " + waivers.join(", ")
        : "\nno waivers applied - a ratified waiver (docs/perf/WAIVERS.md) is required to merge.",
    );
    process.exit(1);
  }
  console.log("\nPERF GATE PASSED - all budgets met; regression band " + (bandMode === "block" ? "clean" : "warn-only (seeded for next run)") + ".");
}

if (import.meta.main) {
  await main();
}
