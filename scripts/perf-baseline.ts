#!/usr/bin/env bun
/**
 * XR Phase 3 · T10 — Perf baseline capture.
 *
 *   bun run scripts/perf-baseline.ts [--samples 21] [--mode source|wrapper|binary]
 *                                    [--binary path] [--out docs/perf]
 *
 * Measures the full Phase 3 scenario matrix and writes a VERSIONED baseline
 * artifact (docs/perf/baseline-<version>-<mode>.json + Markdown). Baseline
 * artifacts are inputs to the regression gate (scripts/perf-gate.ts) and are
 * committed so CI can compare current vs. baseline.
 *
 * Constitution Article XII · Rule 2: the baseline is the evidence behind every
 * published budget.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { freshIsolationRoot, runMatrix, writeReport, type LaunchConfig, type LaunchMode } from "./perf/harness.ts";
import { versionInfo } from "../src/core/version.ts";

const MODES: LaunchMode[] = ["source", "wrapper", "binary"];

function parseArgs(): { samples: number; mode: LaunchMode; binary?: string; out: string } {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const samples = Number(get("--samples") ?? process.env.XR_BASELINE_SAMPLES ?? 21);
  const mode = (get("--mode") ?? "source") as LaunchMode;
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}; expected ${MODES.join("|")}`);
  return {
    samples,
    mode,
    binary: get("--binary"),
    out: get("--out") ?? join(import.meta.dir, "..", "docs", "perf"),
  };
}

async function main(): Promise<void> {
  const { samples, mode, binary, out } = parseArgs();
  if (mode === "binary" && !binary) throw new Error("--binary <path> required for binary mode");
  const cfg: LaunchConfig = { mode, binaryPath: binary };
  const isolationRoot = freshIsolationRoot("baseline");
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

  const version = versionInfo();
  const artifact = join(out, `baseline-${version.version}-${mode}.json`);
  mkdirSync(out, { recursive: true });
  writeFileSync(artifact, JSON.stringify(report, null, 2));

  const md = join(out, `baseline-${version.version}-${mode}.md`);
  writeFileSync(
    md,
    `# XR Perf Baseline — v${version.version} (${mode})

Generated: ${report.generatedAt} · samples per scenario: ${samples}
Environment: ${report.environment.os}/${report.environment.arch} · Bun ${report.environment.bun}

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
${report.scenarios
  .map(
    (s) =>
      `| ${s.label} | ${s.warm ? "warm" : "cold"} | ${s.samples} | ${s.medianMs.toFixed(1)} | ${s.p95Ms.toFixed(1)} | ${s.minMs.toFixed(1)} | ${s.maxMs.toFixed(1)} | ${s.successes}/${s.samples} |`,
  )
  .join("\n")}

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> \`bun run scripts/perf-baseline.ts --mode ${mode}\`.
`,
  );

  // Budget table for the console.
  const budgets = JSON.parse(readFileSync(join(import.meta.dir, "perf", "budgets.json"), "utf8")) as {
    budgets: Array<{ id: string; scenario: string; warm: boolean; metric: string; ms: number }>;
  };
  console.log(`baseline artifact: ${artifact}`);
  console.log(`\n${"Scenario".padEnd(22)} ${"mode".padEnd(6)} ${"p95".padStart(8)} ${"budget".padStart(8)} ${"status".padEnd(10)}`);
  for (const b of budgets.budgets) {
    const sc = report.scenarios.find((s) => s.id === b.scenario && s.warm === b.warm);
    if (!sc) continue;
    const ok = sc.p95Ms <= b.ms;
    console.log(
      `${b.scenario.padEnd(22)} ${(b.warm ? "warm" : "cold").padEnd(6)} ${sc.p95Ms.toFixed(1).padStart(8)} ${String(b.ms).padStart(8)} ${(ok ? "PASS" : "EXCEEDED").padEnd(10)}`,
    );
  }
  if (existsSync(join(out, "MEASUREMENTS.md"))) writeReport(report, out);
}

if (import.meta.main) {
  await main();
}
