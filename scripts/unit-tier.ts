#!/usr/bin/env bun
/**
 * XR Phase 8 · T5 — the unit tier (contributor inner loop < 5 s).
 *
 * A curated subset of the suite that covers the gates a first-PR contributor
 * can actually break — architecture boundaries, phase gates, API contract,
 * a11y/UX statics — fast enough to run on every save. Full suite remains
 * `bun test`; this exists so nobody skips testing because the loop is slow.
 *
 * Curation rules (enforced by test/architecture/unit-tier.test.ts):
 *   - No browser (Playwright), no installers, no golden-path subprocesses,
 *     no perf loops, no network. If it can't run on a laptop on a plane, it
 *     is not a unit-tier test.
 *   - Every manifest file must exist (stale entries fail the guard test).
 *   - The tier must complete inside the budget (default 5000 ms; measured
 *     ~1300 ms on a 2026 dev laptop — 2.5× CI headroom is deliberate).
 *
 * Usage: bun run scripts/unit-tier.ts [--budget=5000] [--json]
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The tier manifest. Grouped by the contributor mistake each group catches.
 * Keep runtime the primary filter: add a file here ONLY if you measured it.
 */
export const UNIT_TIER: readonly string[] = [
  // Architecture invariants — wrong layer wiring, second writer, module bloat
  "test/architecture/boundaries.test.ts",
  "test/architecture/one-store.test.ts",
  "test/architecture/size-gate.test.ts",
  // Public API contract — schema/client drift, versioning, compat surface
  "test/api/client.test.ts",
  "test/api/compat.test.ts",
  "test/api/openapi.test.ts",
  "test/api/v1-versioning.test.ts",
  // Trust gates — fail-closed regressions a reviewer MUST see immediately
  "test/phase0/policy-gate-adversarial.test.ts",
  "test/phase0/workflow-effects.test.ts",
  // Core value semantics — envelope/error shapes everything depends on
  "test/core/envelope.test.ts",
  "test/core/errors.test.ts",
  // Dashboard composition + static a11y/UX contracts (no browser needed)
  "test/daemon/dashboard-split.test.ts",
  "test/a11y/static.test.ts",
  "test/a11y/contrast.test.ts",
  "test/a11y/auth-server.test.ts",
  // Phase-8 UX surfaces — disclosure, readiness, undo, mode colour, SUS math
  "test/ux/disclosure.test.ts",
  "test/ux/mode-color.test.ts",
  "test/ux/sus.test.ts",
  "test/ux/undo.test.ts",
] as const;

function arg(name: string, dflt: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
}

function main(): void {
  const budget = Number.parseInt(arg("budget", "5000"), 10) || 5000;
  const root = join(import.meta.dir, "..");

  const missing = UNIT_TIER.filter((f) => !existsSync(join(root, f)));
  if (missing.length > 0) {
    console.error(`FAIL unit-tier: manifest entries do not exist: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Hermetic HOME/XR_HOME: the tier must never touch a developer's real data.
  const sandbox = mkdtempSync(join(tmpdir(), "xr-unit-tier-"));
  const t0 = Date.now();
  const res = spawnSync(process.execPath, ["test", ...UNIT_TIER], {
    cwd: root,
    env: { ...process.env, XR_HOME: join(sandbox, "xr"), HOME: join(sandbox, "home") },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsed = Date.now() - t0;
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  process.stdout.write(res.stdout ?? "");
  if (res.stderr?.trim()) process.stderr.write(res.stderr);

  const summary = { files: UNIT_TIER.length, elapsedMs: elapsed, budgetMs: budget, withinBudget: elapsed <= budget, exitCode: res.status ?? 1 };
  console.log(`[unit-tier] ${summary.files} files · ${summary.elapsedMs}ms (budget ${summary.budgetMs}ms) ${summary.withinBudget ? "✓" : "✗ OVER BUDGET"}`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(summary));

  if (res.status !== 0) process.exit(res.status ?? 1);
  if (!summary.withinBudget) {
    console.error("FAIL unit-tier: tier exceeds its budget — move slow tests back to the full suite instead of raising the budget");
    process.exit(1);
  }
}

main();
