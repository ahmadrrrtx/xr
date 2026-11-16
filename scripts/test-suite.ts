/*
 * A test runner that finishes, and says why when it does not (S-5).
 *
 * The release gate ran `bun test` over the whole tree as ONE process. It did
 * not finish: killed at 900 s with no per-file progress in the tail, so a
 * failure was indistinguishable from a hang and the gate could not be trusted
 * on either verdict. Two separate problems were hiding in that:
 *
 *   1. SHAPE. A single process means every suite shares one module registry,
 *      one set of fixed ports and one event loop. Per-directory runs are fast
 *      and green; the merged run is where they interfere (see the fixed-port
 *      collisions between test/providers and test/desktop). Running each
 *      directory in its own process removes the interference instead of
 *      serialising around it.
 *
 *   2. SILENCE. No output per unit means no way to tell "slow" from "stuck".
 *      Every directory gets its own timeout and its own verdict line, so the
 *      report always states which unit failed and why.
 *
 * Usage (see package.json):
 *   bun run scripts/test-suite.ts                 # everything, one process per dir
 *   bun run scripts/test-suite.ts --lane unit     # only the fast lane
 *   bun run scripts/test-suite.ts --only test/api # one directory
 *   bun run scripts/test-suite.ts --list          # show the plan, run nothing
 *
 * Exit code is 0 only when every unit passed. A timeout is a FAILURE, not a
 * skip: a suite that cannot finish inside its budget cannot gate a release.
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TEST_ROOT = join(ROOT, "test");

/**
 * LANES. `unit` is bounded and belongs on every push; `integration` needs
 * child processes, sockets or a built artefact and gets its own job. The split
 * is by cost and by what the suite touches, not by how important it is — both
 * lanes are required for a release.
 */
const INTEGRATION_DIRS = new Set([
  "api",
  "e2e-blackbox",
  "journey",
  "perf",
  "daemon",
  "trust",
]);

export interface Unit {
  /** Directory under test/, e.g. "api". */
  name: string;
  /** Arguments for `bun test` — a directory, or explicit files (see note). */
  targets: string[];
  lane: "unit" | "integration";
  budgetMs: number;
  files: number;
}

/**
 * Per-unit budgets. Measured on a cold Linux runner, then given ~4× headroom:
 * a unit that exceeds this is stuck, not merely slow, and the report says so
 * with the number rather than hanging the job.
 */
const DEFAULT_BUDGET_MS = 240_000;
const BUDGET_OVERRIDES: Record<string, number> = {
  // Dependency-graph walks, Rust-free but I/O heavy.
  architecture: 300_000,
  security: 300_000,
  // Spawns real child processes and binds sockets.
  trust: 480_000,
  journey: 480_000,
  "e2e-blackbox": 600_000,
  api: 420_000,
  daemon: 420_000,
  perf: 300_000,
  desktop: 300_000,
  cli: 300_000,
};

/** Files directly in test/ (the suites that predate the directory layout). */
function rootTestFiles(): string[] {
  return readdirSync(TEST_ROOT).filter(
    (f) => f.endsWith(".test.ts") && statSync(join(TEST_ROOT, f)).isFile(),
  );
}

export function plan(): Unit[] {
  const units: Unit[] = [];
  for (const entry of readdirSync(TEST_ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(TEST_ROOT, entry.name);
    const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts")).length;
    // Nothing to run (fixtures, helpers) — not a unit, not a failure.
    if (files === 0) continue;
    units.push({
      name: entry.name,
      targets: [dir],
      lane: INTEGRATION_DIRS.has(entry.name) ? "integration" : "unit",
      budgetMs: BUDGET_OVERRIDES[entry.name] ?? DEFAULT_BUDGET_MS,
      files,
    });
  }
  const roots = rootTestFiles();
  if (roots.length > 0) {
    units.push({
      name: "(root files)",
      // NOT [TEST_ROOT]: `bun test <dir>` recurses, so passing the test root
      // here runs every suite in the tree — 520 files instead of these 36, and
      // the unit blows any sane budget while looking like a hang. Name the
      // files.
      targets: roots.map((f) => join(TEST_ROOT, f)),
      lane: "unit",
      budgetMs: 300_000,
      files: roots.length,
    });
  }
  return units;
}

interface Verdict {
  unit: Unit;
  ok: boolean;
  ms: number;
  pass: number;
  fail: number;
  /** Set when the unit timed out or the runner could not start. */
  note?: string;
}

/** Pull bun's own counters out of a finished run. */
export function summarize(output: string): { pass: number; fail: number; note?: string } {
  const pass = /^\s*(\d+)\s+pass\s*$/m.exec(output);
  const fail = /^\s*(\d+)\s+fail\s*$/m.exec(output);
  const passN = pass ? Number(pass[1]) : 0;
  const failN = fail ? Number(fail[1]) : 0;
  // A run that printed no counters never executed a test — that is a failure
  // of the unit, not a pass with zero tests.
  const note = pass || fail ? undefined : "no test counters in output (unit did not run)";
  return { pass: passN, fail: failN, note };
}

async function runUnit(unit: Unit): Promise<Verdict> {
  const started = Date.now();
  const proc = Bun.spawn(["bun", "test", ...unit.targets], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XR_TEST_UNIT: unit.name },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), unit.budgetMs);
  });
  const finished = (async () => {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return `${out}\n${err}`;
  })();

  const outcome = await Promise.race([finished, timeout]);
  if (outcome === "timeout") {
    // The budget is the point: kill it and report the unit, never the tree.
    proc.kill();
    if (timer) clearTimeout(timer);
    return {
      unit,
      ok: false,
      ms: Date.now() - started,
      pass: 0,
      fail: 0,
      note: `exceeded its ${Math.round(unit.budgetMs / 1000)} s budget — a suite that cannot finish cannot gate a release`,
    };
  }
  if (timer) clearTimeout(timer);
  const { pass, fail, note } = summarize(outcome);
  return {
    unit,
    ok: proc.exitCode === 0 && fail === 0 && note === undefined,
    ms: Date.now() - started,
    pass,
    fail,
    note,
  };
}

/** Bounded parallelism: these units bind fixed ports, so do not stampede. */
async function runAll(units: Unit[], concurrency: number): Promise<Verdict[]> {
  const queue = [...units];
  const verdicts: Verdict[] = [];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, units.length)) }, async () => {
    for (;;) {
      const unit = queue.shift();
      if (!unit) return;
      const v = await runUnit(unit);
      verdicts.push(v);
      const status = v.ok ? "ok  " : "FAIL";
      const detail = v.ok
        ? `${v.pass} passed`
        : (v.note ?? `${v.fail} failed`);
      console.log(`[test-suite] ${status} ${unit.name.padEnd(16)} ${(v.ms / 1000).toFixed(1)}s  ${detail}`);
    }
  });
  await Promise.all(workers);
  return verdicts;
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? "") : null;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const only = flag(argv, "--only");
  const lane = flag(argv, "--lane");
  const concurrency = Number(flag(argv, "--concurrency") ?? (process.env.XR_TEST_CONCURRENCY ?? 3));

  let units = plan();
  if (lane) units = units.filter((u) => u.lane === lane);
  if (only) units = units.filter((u) => u.name === only.replace(/^test\//, ""));
  if (units.length === 0) {
    console.error(`[test-suite] no units matched${lane ? ` lane=${lane}` : ""}${only ? ` only=${only}` : ""}`);
    process.exit(2);
  }

  const totalFiles = units.reduce((n, u) => n + u.files, 0);
  console.log(
    `[test-suite] ${units.length} unit(s), ${totalFiles} test file(s), concurrency ${concurrency}` +
      `${lane ? `, lane ${lane}` : ""}`,
  );
  if (argv.includes("--list")) {
    for (const u of units) {
      console.log(`  ${u.name.padEnd(16)} ${u.lane.padEnd(12)} ${u.files} file(s)  budget ${Math.round(u.budgetMs / 1000)}s`);
    }
    return;
  }

  const started = Date.now();
  const verdicts = await runAll(units, concurrency);
  const failed = verdicts.filter((v) => !v.ok);
  const pass = verdicts.reduce((n, v) => n + v.pass, 0);
  const fail = verdicts.reduce((n, v) => n + v.fail, 0);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `[test-suite] ${verdicts.length - failed.length}/${verdicts.length} unit(s) green · ` +
      `${pass} passed, ${fail} failed · ${secs}s`,
  );
  if (failed.length > 0) {
    console.error(`[test-suite] FAILED: ${failed.map((v) => `${v.unit.name} (${v.note ?? `${v.fail} failing`})`).join(", ")}`);
    process.exit(1);
  }
}

if (import.meta.main) await main();
