#!/usr/bin/env bun
/**
 * XR Phase 8 · T4 — first-task success-rate survey (automated instrument).
 *
 * Runs N independent "install → boot → first answer" attempts, each in a
 * fully fresh XR_HOME+HOME (a clean-room proxy for a brand-new user), and
 * reports the success rate with named failure steps, plus wall-clock
 * percentiles for time-to-first-value.
 *
 * Target (Phase 8 · T4): ≥ 95% of fresh first-task attempts succeed.
 *
 * ── HONEST SCOPE ────────────────────────────────────────────────────────────
 * This is an AUTOMATED ENVIRONMENT-RELIABILITY PROXY, not a human usability
 * study: it proves a fresh machine can complete the first task with zero
 * residual state, deterministically, N times in a row. It cannot measure
 * human comprehension, discoverability, or delight. The human first-task
 * study (moderated, ≥5 participants) uses docs/ux/FIRST-TASK.md as its
 * script and remains pending — claim-lint forbids quoting ≥95% anywhere as
 * a human-derived number until that study lands. What CI enforces here is
 * the machine-verifiable half of the requirement.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Usage:  bun run scripts/first-task-survey.ts [--runs=20] [--target=0.95] [--json]
 * Exit:   0 when rate ≥ target and every attempt booted, 1 otherwise.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

interface AttemptReport {
  ok: boolean;
  totalMs?: number;
  failedStep: string | null;
  detail?: string | null;
  steps?: Array<{ step: string; ok: boolean; ms: number }>;
}

function arg(name: string, dflt: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
}

const RUNS = Math.max(1, Number.parseInt(arg("runs", "20"), 10) || 20);
const TARGET = Number.parseFloat(arg("target", "0.95"));
const JSON_ONLY = process.argv.includes("--json");

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function main(): void {
  const packageRoot = join(import.meta.dir, "..");
  const reports: AttemptReport[] = [];

  for (let i = 0; i < RUNS; i++) {
    const sandbox = mkdtempSync(join(tmpdir(), "xr-first-task-"));
    const XR_HOME = join(sandbox, "xr-home");
    const HOME = join(sandbox, "home");
    const res = spawnSync(process.execPath, ["run", "scripts/ux/first-task-attempt.ts"], {
      cwd: packageRoot,
      env: { ...process.env, XR_HOME, HOME },
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let report: AttemptReport;
    const line = (res.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
    try {
      report = JSON.parse(line) as AttemptReport;
    } catch {
      report = {
        ok: false,
        failedStep: "spawn",
        detail: `exit=${String(res.status)} stderr=${(res.stderr ?? "").slice(-240)} stdout=${(res.stdout ?? "").slice(-240)}`,
      };
    }
    reports.push(report);
    if (!JSON_ONLY) {
      const mark = report.ok ? "ok  " : "FAIL";
      console.log(
        `attempt ${String(i + 1).padStart(2, "0")}/${RUNS}  ${mark}  ${String(report.totalMs ?? -1).padStart(6)}ms` +
          (report.failedStep ? `  failedStep=${report.failedStep}${report.detail ? ` (${report.detail.slice(0, 120)})` : ""}` : ""),
      );
    }
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // tmp cleanup is best-effort; the OS reaps tmpdirs.
    }
  }

  const successes = reports.filter((r) => r.ok).length;
  const rate = successes / RUNS;
  const times = reports.map((r) => r.totalMs ?? 0).sort((a, b) => a - b);
  const failures = reports
    .map((r, i) => ({ attempt: i + 1, step: r.failedStep, detail: r.detail ?? null }))
    .filter((f) => f.step);

  const summary = {
    ok: rate >= TARGET,
    instrument: "automated-first-task-proxy",
    runs: RUNS,
    successes,
    rate: Number(rate.toFixed(4)),
    target: TARGET,
    timeToFirstValueMs: { p50: percentile(times, 50), p95: percentile(times, 95), max: times[times.length - 1] ?? 0 },
    failures,
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    console.error(`FAIL first-task-survey: rate ${summary.rate} < target ${TARGET}`);
    process.exit(1);
  }
}

main();
