/**
 * XR Phase 3 · T10 — Performance harness core.
 *
 * Shared measurement library for the perf-budget pipeline:
 *
 *   - `measureOnce()`          spawn one CLI invocation, wall-clock + exit code
 *   - `runScenario()`          N samples (cold = fresh XR_HOME per sample,
 *                              warm = shared XR_HOME, first sample discarded)
 *   - `runMatrix()`            run the full Phase 3 scenario matrix
 *   - `percentile()`           p50/p95 with linear-interpolation consistency
 *   - `writeReport()`          JSON + Markdown artifacts (versioned, CI-stable)
 *
 * Launch modes (Part 5 · architecture requirements):
 *   - "source"   `bun run src/index.ts …`   (contributor path, retained)
 *   - "wrapper"  `node bin/xr.cjs …`        (npm default path — the spawn
 *                                            wrapper Phase 3 retires)
 *   - "binary"   `$XR_BINARY …`             (compiled standalone binary)
 *
 * Measurement discipline (Part 19): sample isolation (isolated XR_HOME for
 * cold samples), a warm-up sample for warm scenarios, min-runs enforced by
 * the caller, and wall-clock process duration (not in-process `performance`
 * timers) for process scenarios so the spawn/exec overhead is included.
 *
 * Constitution: Article XII · Mandatory Rule 2 — every published number is a
 * budget with a regression gate; this harness is the evidence pipeline.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { versionInfo } from "../../src/core/version.ts";
import { runtimeEnvironment } from "../../src/enterprise/baseline/status.ts";

export const ROOT = join(import.meta.dir, "..", "..");

export type LaunchMode = "source" | "wrapper" | "binary";

export interface LaunchConfig {
  mode: LaunchMode;
  /** Path to the compiled binary (mode "binary"). */
  binaryPath?: string;
  /** Bun executable (mode "source"). */
  bunPath?: string;
  /** Node executable (mode "wrapper"). */
  nodePath?: string;
}

export interface ScenarioDef {
  id: string;
  label: string;
  argv: string[];
  /** "process" spawns the CLI; "script" runs scripts/perf/<argv[0]>.ts. */
  kind?: "process" | "script";
  /** "cold" = fresh isolated XR_HOME per sample; "warm" = shared XR_HOME. */
  warm?: boolean;
  /** Exit codes considered a successful run (doctor is exit-1-by-design without providers). */
  expectedExitCodes?: number[];
  /** Number of samples (defaults to the matrix default). */
  samples?: number;
  /** Subsystem the scenario exercises, for the boot-profile report. */
  subsystems?: string[];
  /** Budget id in budgets.json that this scenario gates. */
  budget?: string;
}

export interface SampleResult {
  ms: number;
  code: number;
  /** Peak RSS in KiB (Linux /proc), undefined where unavailable. */
  peakRssKb?: number;
}

export interface ScenarioResult {
  id: string;
  label: string;
  argv: string[];
  mode: LaunchMode;
  warm: boolean;
  samples: number;
  successes: number;
  failures: number;
  expectedExitCodes: number[];
  exitCodes: number[];
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  peakRssKb?: number;
  subsystems: string[];
  budget?: string;
}

export interface PerfReport {
  schemaVersion: 1;
  generatedAt: string;
  version: ReturnType<typeof versionInfo>;
  environment: ReturnType<typeof runtimeEnvironment>;
  mode: LaunchMode;
  methodology: {
    coldIsolation: "fresh XR_HOME per sample";
    warmDiscard: "first sample discarded as warm-up";
    outlierTrim: "single largest sample trimmed before percentiles when samples >= 15 (gate hygiene); raw samples remain in samplesMs";
    precision: "wall-clock process duration on this host; not a hardware-independent benchmark";
    rss: "peak RSS from /proc/<pid>/status VmHWM where available";
  };
  scenarios: ScenarioResult[];
}

// ── Statistics ───────────────────────────────────────────────────────────────

/** Linear-interpolation percentile (matches the Phase-0 baseline convention
 *  for p95 = ceil(0.95·n) index, clamped). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

// ── Launch resolution ────────────────────────────────────────────────────────

export function resolveLaunch(cfg: LaunchConfig): string[] {
  switch (cfg.mode) {
    case "source":
      return [cfg.bunPath ?? process.env.BUN ?? "bun", "run", join(ROOT, "src", "index.ts")];
    case "wrapper":
      return [cfg.nodePath ?? process.env.NODE ?? "node", join(ROOT, "bin", "xr.cjs")];
    case "binary": {
      const bin = cfg.binaryPath ?? process.env.XR_BINARY;
      if (!bin) throw new Error("perf harness: binary mode requires --binary <path> or $XR_BINARY");
      return [bin];
    }
  }
}

// ── Measurement ──────────────────────────────────────────────────────────────

/** Peak RSS polling for Linux; returns undefined elsewhere. */
async function pollPeakRss(pid: number): Promise<number | undefined> {
  if (process.platform !== "linux") return undefined;
  let peak = 0;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const status = await Bun.file(`/proc/${pid}/status`).text();
      const m = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
      if (m) peak = Math.max(peak, Number(m[1]));
    } catch {
      break; // process gone or /proc unavailable
    }
    await Bun.sleep(2);
  }
  return peak;
}

export async function measureOnce(
  launch: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<SampleResult> {
  const start = performance.now();
  const proc = Bun.spawn(launch, {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, ...env },
  });
  const peakRssKb = await pollPeakRss(proc.pid);
  const code = await proc.exited;
  const ms = performance.now() - start;
  return { ms, code, peakRssKb };
}

// ── Scenario runner ──────────────────────────────────────────────────────────

export interface RunScenarioOptions {
  cfg: LaunchConfig;
  def: ScenarioDef;
  defaultSamples: number;
  /** Root directory for fresh XR_HOME dirs (cold mode). */
  isolationRoot: string;
}

export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioResult> {
  const { cfg, def, defaultSamples } = opts;
  const samples = def.samples ?? defaultSamples;
  const warm = def.warm ?? false;
  const expected = def.expectedExitCodes ?? [0];

  // Script scenarios: in-process benches that print {ms, samples} JSON.
  if (def.kind === "script") {
    const times: number[] = [];
    const exitCodes: number[] = [];
    for (let i = 0; i < samples; i++) {
      // Fresh home per sample: each sample is a separate process and must
      // start from an empty state (seeded benches would collide otherwise).
      const home = join(opts.isolationRoot, `home-${def.id}-${i}`);
      mkdirSync(home, { recursive: true });
      const r = await runBenchScript(def.argv[0], { XR_HOME: home });
      times.push(r.ms);
      exitCodes.push(0);
    }
    const rawSorted = [...times].sort((a, b) => a - b);
    const sorted = rawSorted.length >= 15 ? rawSorted.slice(0, -1) : rawSorted;
    return {
      id: def.id,
      label: def.label,
      argv: def.argv,
      mode: cfg.mode,
      warm,
      samples: times.length,
      successes: times.length,
      failures: 0,
      expectedExitCodes: expected,
      exitCodes,
      samplesMs: times,
      medianMs: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      minMs: sorted[0] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      peakRssKb: undefined,
      subsystems: def.subsystems ?? [],
      budget: def.budget,
    };
  }

  const launch = [...resolveLaunch(cfg), ...def.argv];

  // One shared home for warm scenarios; fresh home per sample for cold.
  const sharedHome = join(opts.isolationRoot, `home-${def.id}`);
  if (!warm) mkdirSync(opts.isolationRoot, { recursive: true });
  else mkdirSync(sharedHome, { recursive: true });

  const times: number[] = [];
  const exitCodes: number[] = [];
  let rssValues: number[] = [];

  for (let i = 0; i < samples; i++) {
    const xrHome = warm ? sharedHome : join(opts.isolationRoot, `home-${def.id}-${i}`);
    if (!warm) mkdirSync(xrHome, { recursive: true });
    const env: Record<string, string> = { XR_HOME: xrHome, XR_NONINTERACTIVE: "1", NO_COLOR: "1" };
    if (process.env.XR_PERF_EXTRA_ENV) {
      for (const pair of process.env.XR_PERF_EXTRA_ENV.split(",")) {
        const [k, v] = pair.split("=", 2);
        if (k) env[k] = v ?? "";
      }
    }
    const r = await measureOnce(launch, env, ROOT);
    if (warm && i === 0) continue; // warm-up sample discarded
    times.push(r.ms);
    exitCodes.push(r.code);
    if (r.peakRssKb != null) rssValues.push(r.peakRssKb);
  }

  // Outlier hygiene for gate runs: with ≥15 samples, the single largest
  // sample is trimmed before percentiles (a GC/scan spike must not decide a
  // gate). Raw samples remain in `samplesMs` — nothing is hidden.
  const rawSorted = [...times].sort((a, b) => a - b);
  const trimmed = rawSorted.length >= 15 ? rawSorted.slice(0, -1) : rawSorted;
  const sorted = trimmed;
  return {
    id: def.id,
    label: def.label,
    argv: def.argv,
    mode: cfg.mode,
    warm,
    samples: times.length,
    successes: exitCodes.filter((c) => expected.includes(c)).length,
    failures: exitCodes.filter((c) => !expected.includes(c)).length,
    expectedExitCodes: expected,
    exitCodes,
    samplesMs: times,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    peakRssKb: rssValues.length ? Math.max(...rssValues) : undefined,
    subsystems: def.subsystems ?? [],
    budget: def.budget,
  };
}

// ── Matrix ───────────────────────────────────────────────────────────────────

export const DEFAULT_SCENARIOS: ScenarioDef[] = [
  {
    id: "version",
    label: "Version (fast path, cold)",
    argv: ["--version"],
    budget: "version",
  },
  {
    id: "version-warm",
    label: "Version (fast path, warm)",
    argv: ["--version"],
    warm: true,
    budget: "version-warm",
  },
  {
    id: "help",
    label: "Help (fast path, cold)",
    argv: ["--help"],
    budget: "help",
  },
  {
    id: "help-warm",
    label: "Help (fast path, warm)",
    argv: ["--help"],
    warm: true,
    budget: "help-warm",
  },
  {
    id: "doctor",
    label: "Doctor readiness",
    argv: ["doctor", "--json"],
    warm: true,
    expectedExitCodes: [0, 1],
    subsystems: ["kernel", "state", "config", "providers", "shield"],
    budget: "doctor",
  },
  {
    id: "workspace-list",
    label: "Workspace list (kernel boot)",
    argv: ["workspace", "list", "--json"],
    warm: true,
    expectedExitCodes: [0, 1],
    subsystems: ["kernel", "state", "config", "workspace"],
    budget: "workspace-list",
  },
  {
    id: "route-decision",
    label: "Route decision (in-process bench)",
    argv: ["route-bench"],
    kind: "script",
    warm: true,
    subsystems: ["cli-router"],
    budget: "route-decision",
  },
  {
    id: "dashboard-render",
    label: "Dashboard first render (HTTP)",
    argv: ["dashboard-bench"],
    kind: "script",
    warm: true,
    subsystems: ["daemon", "dashboard"],
    budget: "dashboard-render",
  },
  {
    id: "retrieval-100k",
    label: "Retrieval @100k items (in-process bench)",
    argv: ["retrieval-bench"],
    kind: "script",
    warm: true,
    subsystems: ["context", "retrieval", "state"],
    budget: "retrieval-100k",
  },
];

export interface RunMatrixOptions {
  cfg: LaunchConfig;
  scenarios?: ScenarioDef[];
  defaultSamples: number;
  isolationRoot: string;
}

export async function runMatrix(opts: RunMatrixOptions): Promise<PerfReport> {
  const scenarios: ScenarioResult[] = [];
  for (const def of opts.scenarios ?? DEFAULT_SCENARIOS) {
    const quiet = process.env.XR_PERF_QUIET === "1";
    if (!quiet) console.error(`[perf] scenario ${def.id} (${def.warm ? "warm" : "cold"})…`);
    const started = Date.now();
    scenarios.push(await runScenario({ cfg: opts.cfg, def, defaultSamples: opts.defaultSamples, isolationRoot: opts.isolationRoot }));
    if (!quiet) console.error(`[perf]   done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: versionInfo(),
    environment: runtimeEnvironment(),
    mode: opts.cfg.mode,
    methodology: {
      coldIsolation: "fresh XR_HOME per sample",
      warmDiscard: "first sample discarded as warm-up",
      outlierTrim: "single largest sample trimmed before percentiles when samples >= 15 (gate hygiene); raw samples remain in samplesMs",
      precision: "wall-clock process duration on this host; not a hardware-independent benchmark",
      rss: "peak RSS from /proc/<pid>/status VmHWM where available",
    },
    scenarios,
  };
}

// ── Report artifacts ─────────────────────────────────────────────────────────

export function writeReport(report: PerfReport, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "measurements.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, "MEASUREMENTS.md"),
    `# XR Perf Measurements — ${report.version.display}

Generated: ${report.generatedAt}
Launch mode: ${report.mode} · ${report.environment.os}/${report.environment.arch} · Bun ${report.environment.bun}

| Scenario | Mode | Samples | p50 ms | p95 ms | min ms | max ms | Success |
|---|---|---:|---:|---:|---:|---:|---:|
${report.scenarios
  .map(
    (s) =>
      `| ${s.label} | ${s.warm ? "warm" : "cold"} | ${s.samples} | ${s.medianMs.toFixed(1)} | ${s.p95Ms.toFixed(1)} | ${s.minMs.toFixed(1)} | ${s.maxMs.toFixed(1)} | ${s.successes}/${s.samples} |`,
  )
  .join("\n")}

Machine-readable: \`measurements.json\`.
`,
  );
}

export function freshIsolationRoot(tag: string): string {
  return join(tmpdir(), `xr-perf-${tag}-${process.pid}-${Date.now()}`);
}

/** Merge a perf report from a sub-process script (route/dashboard/retrieval
 *  benches print a single-line JSON object with {ms, samples} on stdout). */
export async function runBenchScript(
  script: string,
  env: Record<string, string>,
  cwd = ROOT,
  timeoutMs = 300_000,
): Promise<{ ms: number; samples: number; extra?: Record<string, number> }> {
  const start = performance.now();
  const proc = Bun.spawn([process.env.BUN ?? "bun", "run", join(ROOT, "scripts", "perf", script)], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  // Watchdog via clearTimeout (a cancellable timer must never keep the
  // harness event loop alive after the child exits).
  const watchdog = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  const code = await proc.exited;
  clearTimeout(watchdog);
  if (code !== 0) {
    throw new Error(`bench script ${script} failed (${code}): ${stderr.slice(0, 2000)}`);
  }
  const wall = performance.now() - start;
  const line = stdout.trim().split("\n").at(-1) ?? "{}";
  const parsed = JSON.parse(line) as { ms: number; samples: number; extra?: Record<string, number> };
  parsed.ms = parsed.ms ?? wall;
  return parsed;
}
