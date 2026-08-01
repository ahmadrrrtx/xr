/**
 * XR Phase 3 · T1 — startup-latency budget tests.
 *
 * Measures the CLI fast path end-to-end (spawn → exit) in an isolated
 * XR_HOME with minimum runs, and asserts the budget with a guard margin
 * (budget × 1.25; the exact budget gate runs as the CI perf job with more
 * samples — this test is the fast local guard).
 *
 * Budgets come from the single source of truth (scripts/perf/budgets.json,
 * Constitution Article XII ceilings): --version/--help p95 <150ms warm /
 * <300ms cold.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, readFileSync } from "node:fs";
import { describe, test, expect, beforeAll } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const BUN = process.env.BUN ?? "bun";
const ENTRY = join(ROOT, "src", "index.ts");

interface BudgetDef {
  id: string;
  ms: number;
}

function loadBudget(id: string): number {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "scripts", "perf", "budgets.json"), "utf8"),
  ) as { budgets: BudgetDef[] };
  const b = raw.budgets.find((x) => x.id === id);
  if (!b) throw new Error(`budget ${id} not found in budgets.json`);
  return b.ms;
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)]!;
}

async function measureOnce(args: string[], xrHome: string): Promise<number> {
  const start = performance.now();
  const proc = Bun.spawn([BUN, "run", ENTRY, ...args], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, XR_HOME: xrHome, XR_NONINTERACTIVE: "1", NO_COLOR: "1" },
  });
  const code = await proc.exited;
  return performance.now() - start;
}

describe("Phase 3 · T1 — startup latency budgets (source path)", () => {
  const coldHome = join(tmpdir(), `xr-startup-cold-${process.pid}`);
  const warmHome = join(tmpdir(), `xr-startup-warm-${process.pid}`);
  const guard = 1.25;
  const versionWarm = loadBudget("version-warm") * guard;
  const versionCold = loadBudget("version-cold") * guard;
  const helpWarm = loadBudget("help-warm") * guard;
  const helpCold = loadBudget("help-cold") * guard;

  beforeAll(() => {
    mkdirSync(coldHome, { recursive: true });
    mkdirSync(warmHome, { recursive: true });
  });

  test(`--version cold p95 within budget ${loadBudget("version-cold")}ms (guard ×1.25)`, async () => {
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const home = join(coldHome, `s${i}`);
      mkdirSync(home, { recursive: true });
      times.push(await measureOnce(["--version"], home));
    }
    const p95 = percentile([...times].sort((a, b) => a - b), 95);
    expect(p95).toBeLessThan(versionCold);
  }, 120_000);

  test(`--version warm p95 within budget ${loadBudget("version-warm")}ms (guard ×1.25)`, async () => {
    const times: number[] = [];
    // First sample is the warm-up (module cache + XR_HOME provisioning).
    await measureOnce(["--version"], warmHome);
    for (let i = 0; i < 9; i++) times.push(await measureOnce(["--version"], warmHome));
    const p95 = percentile([...times].sort((a, b) => a - b), 95);
    expect(p95).toBeLessThan(versionWarm);
  }, 120_000);

  test(`--help cold p95 within budget ${loadBudget("help-cold")}ms (guard ×1.25)`, async () => {
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const home = join(coldHome, `h${i}`);
      mkdirSync(home, { recursive: true });
      times.push(await measureOnce(["--help"], home));
    }
    const p95 = percentile([...times].sort((a, b) => a - b), 95);
    expect(p95).toBeLessThan(helpCold);
  }, 120_000);

  test(`--help warm p95 within budget ${loadBudget("help-warm")}ms (guard ×1.25)`, async () => {
    const times: number[] = [];
    await measureOnce(["--help"], warmHome);
    for (let i = 0; i < 9; i++) times.push(await measureOnce(["--help"], warmHome));
    const p95 = percentile([...times].sort((a, b) => a - b), 95);
    expect(p95).toBeLessThan(helpWarm);
  }, 120_000);
});
