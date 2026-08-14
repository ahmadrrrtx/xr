#!/usr/bin/env bun
/**
 * XR Phase 8 · T2 — CPU profiling gate (Constitution Art. XII).
 *
 *   bun run scripts/profile-gate.ts [--scenario version|help|workspace-list|doctor]
 *                                   [--samples 5] [--write-baseline]
 *                                   [--max-regression 0.30] [--waiver <scenario-id>]
 *
 * Captures V8 CPU profiles (`bun --cpu-prof`) for the startup-hot scenarios
 * and gates on:
 *   1. ABSOLUTE CPU BUDGETS (bun-CPU-ms; below) — always blocking, never scaled.
 *   2. SAME-HOST REGRESSION BAND (default 30% over the host's min baseline,
 *      ~/.cache/xr/profile-baseline.json, ratchets DOWN only) — first run on a
 *      host WARNS and seeds; from run two it blocks. Mirrors perf-gate v3's
 *      philosophy (measured runner variance) so the gate is flake-proof yet
 *      catches ≥1.3x CPU regressions.
 *
 * The committed docs/perf/profile-baseline.json is the reference artifact
 * (regenerate with --write-baseline on a clean host).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const ARTIFACT = join(ROOT, "docs/perf/profile-baseline.json");
const CACHE = join(homedir(), ".cache/xr/profile-baseline.json");

/** Absolute CPU budgets (bun-CPU-ms) per scenario — Art. XII, never scaled. */
export const CPU_BUDGETS: Record<string, number> = {
  version: 800,
  help: 900,
  "workspace-list": 1500,
  doctor: 3500,
};

interface ScenarioDef {
  id: string;
  argv: string[];
}

const SCENARIOS: ScenarioDef[] = [
  { id: "version", argv: ["--version"] },
  { id: "help", argv: ["--help"] },
  { id: "workspace-list", argv: ["workspace", "list", "--json"] },
  { id: "doctor", argv: ["doctor", "--json"] },
];

export interface ProfileSummary {
  scenario: string;
  cpuMs: number;
  samples: number;
  top: Array<{ fn: string; url: string; selfMs: number }>;
}

export interface CpuProfile {
  nodes?: Array<{ id: number; callFrame?: { functionName?: string; url?: string } }>;
  samples?: number[];
  timeDeltas?: number[];
  startTime?: number;
  endTime?: number;
}

/** Summarize a V8 .cpuprofile: total CPU ms + top self-time functions. */
export function summarizeProfile(profile: CpuProfile, scenario: string): ProfileSummary {
  const cpuMs = (profile.timeDeltas ?? []).reduce((a, b) => a + Math.max(0, b), 0) / 1000;
  const byNode = new Map((profile.nodes ?? []).map((n) => [n.id, n]));
  const selfHits = new Map<number, number>();
  for (const s of profile.samples ?? []) selfHits.set(s, (selfHits.get(s) ?? 0) + 1);
  const totalSamples = profile.samples?.length ?? 0;
  const top = [...selfHits.entries()]
    .map(([id, hits]) => {
      const frame = byNode.get(id)?.callFrame ?? {};
      const url = String(frame.url ?? "");
      return {
        fn: String(frame.functionName ?? "(anonymous)") || "(anonymous)",
        url: url.split("/").slice(-2).join("/"),
        selfMs: totalSamples > 0 ? Math.round((hits / totalSamples) * cpuMs * 10) / 10 : 0,
      };
    })
    .filter((t) => t.selfMs > 0)
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 10);
  return { scenario, cpuMs: Math.round(cpuMs * 10) / 10, samples: totalSamples, top };
}

function runScenario(def: ScenarioDef): ProfileSummary {
  const dir = join(tmpdir(), `xr-prof-${def.id}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    XR_HOME: process.env.XR_HOME ?? join(tmpdir(), `xr-prof-home-${def.id}-${process.pid}`),
  };
  const proc = spawnSync(
    "bun",
    ["--cpu-prof", `--cpu-prof-dir=${dir}`, `--cpu-prof-name=${def.id}.cpuprofile`, "run", join(ROOT, "src/index.ts"), ...def.argv],
    { cwd: ROOT, env, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const file = join(dir, `${def.id}.cpuprofile`);
  if (!existsSync(file)) {
    // The profiler subprocess produced no .cpuprofile. This is an
    // INFRASTRUCTURE failure (bun/V8 writer died, runner OOM, sandbox denied
    // the profile dir), not a CPU-budget verdict — but it used to surface as
    // an uncaught throw, so the job exited 1 with no gate output at all and
    // nothing said which scenario or why. Fail with the evidence attached.
    const err = (proc.stderr?.toString() ?? "").trim();
    const out = (proc.stdout?.toString() ?? "").trim();
    const detail = [
      `profile not produced for "${def.id}"`,
      `exit=${proc.status}`,
      proc.signal ? `signal=${proc.signal}` : "",
      proc.error ? `spawnError=${proc.error.message}` : "",
      err ? `stderr=${err.slice(0, 500)}` : "",
      !err && out ? `stdout=${out.slice(0, 300)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    throw new Error(detail);
  }
  const summary = summarizeProfile(JSON.parse(readFileSync(file, "utf8")) as CpuProfile, def.id);
  rmSync(dir, { recursive: true, force: true });
  return summary;
}

interface BaselineDoc {
  version: string;
  capturedAt: string;
  host: string;
  scenarios: Record<string, { cpuMs: number; samples: number }>;
}

function loadBaseline(path: string): BaselineDoc | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BaselineDoc;
  } catch {
    return null;
  }
}

interface GateArgs {
  scenario?: string;
  samples: number;
  writeBaseline: boolean;
  maxRegression: number;
  waivers: Set<string>;
}

function parseArgs(): GateArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    scenario: get("--scenario"),
    samples: Number(get("--samples") ?? 5),
    writeBaseline: argv.includes("--write-baseline"),
    maxRegression: Number(get("--max-regression") ?? 0.30),
    waivers: new Set(argv.flatMap((a, i) => (a === "--waiver" ? [argv[i + 1]] : []))),
  };
}

export function gateViolations(
  results: ProfileSummary[],
  budget: Record<string, number>,
): string[] {
  const violations: string[] = [];
  for (const r of results) {
    const b = budget[r.scenario];
    if (b !== undefined && r.cpuMs > b) {
      violations.push(`${r.scenario}: CPU ${r.cpuMs}ms exceeds absolute budget ${b}ms`);
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const defs = args.scenario ? SCENARIOS.filter((s) => s.id === args.scenario) : SCENARIOS;
  if (defs.length === 0) {
    console.error(`[profile-gate] unknown scenario "${args.scenario}" (known: ${SCENARIOS.map((s) => s.id).join(", ")})`);
    process.exit(2);
  }

  const cache = loadBaseline(CACHE);
  const results: ProfileSummary[] = [];
  let failed = false;

  for (const def of defs) {
    // Median-of-N keeps one noisy sample from deciding (same philosophy as perf-gate).
    //
    // A sample that fails to PRODUCE a profile is an infrastructure failure,
    // not a measurement: retry it once with a fresh subprocess. This never
    // masks a budget violation — a produced profile is always measured and
    // always judged. Only the "no profile at all" case is retried, and if the
    // retry also fails the gate still errors with the captured diagnostics.
    const runs: ProfileSummary[] = [];
    for (let i = 0; i < Math.max(1, args.samples); i++) {
      try {
        runs.push(runScenario(def));
      } catch (e) {
        console.warn(`[profile-gate] ${def.id}: sample ${i + 1} produced no profile — retrying once`);
        console.warn(`[profile-gate]   cause: ${(e as Error).message}`);
        runs.push(runScenario(def));
      }
    }
    runs.sort((a, b) => a.cpuMs - b.cpuMs);
    const median = runs[Math.floor(runs.length / 2)];
    results.push(median);

    const budget = CPU_BUDGETS[def.id];
    const budgetOk = median.cpuMs <= budget;
    const cacheBaseline = cache?.scenarios?.[def.id]?.cpuMs;
    let bandLine = "band: unseeded (first run on this host — warning only)";
    let bandOk = true;
    if (cacheBaseline !== undefined) {
      const limit = cacheBaseline * (1 + args.maxRegression);
      bandOk = median.cpuMs <= limit || args.waivers.has(def.id);
      bandLine = `band: ${median.cpuMs}ms vs host-baseline ${cacheBaseline}ms (+${Math.round(args.maxRegression * 100)}% → ${Math.round(limit)}ms) ${bandOk ? "OK" : "FAIL"}`;
    }
    const absLine = `budget: ${median.cpuMs}ms / ${budget}ms ${budgetOk ? "OK" : "FAIL (absolute, never scaled)"}`;
    console.log(`[profile-gate] ${def.id}: ${absLine} · ${bandLine}`);
    console.log(`[profile-gate]   top self: ${median.top.slice(0, 3).map((t) => `${t.fn} (${t.selfMs}ms)`).join(", ")}`);
    if (!budgetOk || !bandOk) failed = true;
  }

  // Same-host baseline: ratchet DOWN only (min cpuMs per scenario).
  const ratcheted = Object.fromEntries(
    results.map((r) => {
      const prev = cache?.scenarios?.[r.scenario]?.cpuMs;
      const cpuMs = prev !== undefined ? Math.min(prev, r.cpuMs) : r.cpuMs;
      return [r.scenario, { cpuMs, samples: r.samples }];
    }),
  );
  const next: BaselineDoc = {
    version: "1",
    capturedAt: new Date().toISOString(),
    host: `${process.platform}-${process.arch}`,
    scenarios: { ...(cache?.scenarios ?? {}), ...ratcheted },
  };
  mkdirSync(join(CACHE, ".."), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(next, null, 2));

  if (args.writeBaseline) {
    mkdirSync(join(ARTIFACT, ".."), { recursive: true });
    writeFileSync(ARTIFACT, JSON.stringify({ ...next, scenarios: Object.fromEntries(results.map((r) => [r.scenario, { cpuMs: r.cpuMs, samples: r.samples }])) }, null, 2));
    console.log(`[profile-gate] wrote reference baseline ${ARTIFACT}`);
  }

  if (failed) {
    console.error("[profile-gate] FAIL — CPU budget/band violation (see lines above; waivers require docs/perf/WAIVERS.md)");
    process.exit(1);
  }
  console.log("[profile-gate] OK — CPU profiles within budgets and band");
}

if (import.meta.main) {
  await main();
}
