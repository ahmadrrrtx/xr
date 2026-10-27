#!/usr/bin/env bun
/** Pin the process home BEFORE importing any production module. Several
 * legacy runtime paths are resolved at module load, not on each env change. */
import {
  existsSync,
  lstatSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const args = process.argv.slice(2),
  outIndex = args.indexOf("--out");
if (args.includes("--help")) {
  console.log(
    "bun scripts/agent-benchmark.ts [--smoke] [--out report.json]\nDeterministic fixtures only. Bounded live/competitor protocol: benchmarks/agent/README.md.",
  );
  process.exit(0);
}
if (
  args.some(
    (a, i) =>
      !["--smoke", "--out"].includes(a) &&
      !(outIndex >= 0 && i === outIndex + 1),
  ) ||
  (outIndex >= 0 &&
    (!args[outIndex + 1] || args[outIndex + 1]!.startsWith("--")))
) {
  console.error(
    "Unknown/invalid argument; use --help. This runner never enables live traffic.",
  );
  process.exit(2);
}
const saved = { ...process.env };
const bootstrap = mkdtempSync(join(tmpdir(), "xr-agent-benchmark-bootstrap-"));
// No owner provider keys, proxy overrides or ambient opt-outs are inputs to a
// deterministic benchmark. Preserve only OS/runtime process necessities.
const allowed = new Set([
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "CI",
  "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
]);
for (const key of Object.keys(process.env))
  if (!allowed.has(key)) delete process.env[key];
process.env.XR_HOME = bootstrap;
process.env.HOME = bootstrap;
process.env.XR_AGENT_BENCHMARK_BOOTSTRAP = bootstrap;
process.env.XR_NETWORK_PROBES = "off";
process.env.XR_SECRET_BACKEND = "file";
process.env.XR_SECRET_NAMESPACE = "cli";
try {
  const { runAgentBenchmark } = await import("./agent-benchmark-runner");
  const report = await runAgentBenchmark({ smoke: args.includes("--smoke") });
  const text = JSON.stringify(report, null, 2) + "\n";
  if (outIndex >= 0) {
    const path = resolve(args[outIndex + 1]!);
    if (existsSync(path)) {
      let previous: { benchmarkId?: string } = {};
      if (lstatSync(path).isSymbolicLink())
        throw new Error("Refusing a symlink report destination");
      try {
        previous = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        /* reject unrelated content */
      }
      if (previous.benchmarkId !== report.benchmarkId)
        throw new Error(
          "Refusing to overwrite an unrelated report destination",
        );
    }
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    try {
      writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  console.log(text);
  process.exitCode =
    report.summary.failed ||
    report.summary.blocked ||
    report.summary.unauthorizedSideEffects !== 0 ||
    report.summary.unexpectedNetworkAttempts
      ? 1
      : 0;
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  rmSync(bootstrap, { recursive: true, force: true });
}
