#!/usr/bin/env bun
/** XR 3.1.6 Phase 0 baseline measurements.
 * Runs deterministic, local-only scenarios and writes JSON + Markdown reports.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { versionInfo } from "../src/core/version.ts";
import { runtimeEnvironment } from "../src/baseline/status.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "docs", "release", "3.1.6");
const samples = Number(process.env.XR_BASELINE_SAMPLES ?? 3);

type ScenarioResult = {
  id: string;
  command: string[];
  samples: number;
  successes: number;
  failures: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  peakRssBytes: number;
  exitCodes: number[];
  limitation?: string;
};

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function run(command: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; ms: number; rss: number }> {
  const start = performance.now();
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...extraEnv },
  });
  const [_stdout, _stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const ms = performance.now() - start;
  return { code, ms, rss: process.memoryUsage.rss() };
}

async function scenario(id: string, command: string[], extraEnv: Record<string, string> = {}, limitation?: string): Promise<ScenarioResult> {
  const times: number[] = [];
  const exitCodes: number[] = [];
  let peakRssBytes = 0;
  for (let i = 0; i < samples; i++) {
    const result = await run(command, extraEnv);
    times.push(result.ms);
    exitCodes.push(result.code);
    peakRssBytes = Math.max(peakRssBytes, result.rss);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    id,
    command,
    samples,
    successes: exitCodes.filter((c) => c === 0).length,
    failures: exitCodes.filter((c) => c !== 0).length,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    peakRssBytes,
    exitCodes,
    limitation,
  };
}

const isolatedHome = join(tmpdir(), `xr-baseline-${Date.now()}`);
const scenarios = [
  await scenario("cli-version", ["bun", "run", "src/index.ts", "--version"], { XR_HOME: isolatedHome }),
  await scenario("cli-help", ["bun", "run", "src/index.ts", "help"], { XR_HOME: isolatedHome }),
  await scenario("doctor-json", ["bun", "run", "src/index.ts", "doctor", "--json"], { XR_HOME: isolatedHome }, "Optional local runtimes/providers may warn when not installed; required failures are what gate release."),
  await scenario("workspace-list", ["bun", "run", "src/index.ts", "workspace", "list", "--json"], { XR_HOME: isolatedHome }),
  await scenario("doctor-perf", ["bun", "run", "src/index.ts", "doctor", "--perf", "--json"], { XR_HOME: isolatedHome }, "In-process CLI microbenchmarks; not full cold-start precision."),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version: versionInfo(),
  environment: runtimeEnvironment(),
  methodology: {
    samples,
    cwd: ROOT,
    isolatedHome,
    network: "not required; doctor runs without --network",
    precision: "wall-clock process duration on this host; not a hardware-independent benchmark",
  },
  scenarios,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "baseline-measurements.json"), JSON.stringify(report, null, 2));
writeFileSync(join(OUT_DIR, "BASELINE_MEASUREMENTS.md"), `# XR 3.1.6 Baseline Measurements\n\nGenerated: ${report.generatedAt}\n\nEnvironment: Bun ${report.environment.bun}, ${report.environment.os}/${report.environment.arch}, ${Math.round(report.environment.memory.totalBytes / 1024 / 1024)} MiB RAM.\n\nMethodology: ${report.methodology.samples} samples per deterministic local-only scenario using an isolated XR_HOME (\`${isolatedHome}\`). Values are wall-clock measurements for this host and are not claims of cross-hardware benchmark precision.\n\n| Scenario | Command | Success | Median ms | p95 ms | Peak RSS MiB | Notes |\n|---|---|---:|---:|---:|---:|---|\n${scenarios.map((s) => `| ${s.id} | \`${s.command.join(" ")}\` | ${s.successes}/${s.samples} | ${s.medianMs.toFixed(1)} | ${s.p95Ms.toFixed(1)} | ${(s.peakRssBytes / 1024 / 1024).toFixed(1)} | ${s.limitation ?? ""} |`).join("\n")}\n\nMachine-readable report: \`baseline-measurements.json\`.\n`);
console.log(`wrote ${relative(ROOT, OUT_DIR)}/baseline-measurements.json and BASELINE_MEASUREMENTS.md`);
if (scenarios.some((s) => s.failures > 0)) process.exit(1);
