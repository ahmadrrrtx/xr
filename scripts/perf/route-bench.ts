/**
 * XR Phase 3 · T10 — Route-decision microbenchmark.
 *
 * Measures the pure route decision (`decideRoute` + alias resolution) for a
 * representative command mix, excluding kernel boot and provider probes.
 * This is the <20 ms p95 budget from Part 5.
 *
 * Prints a single JSON line: { ms, samples, extra } where ms is the p95
 * per-decision time in milliseconds.
 */

import { decideRoute } from "../../src/cli/route-decision.ts";
import { parseGlobalFlags } from "../../src/cli/flags.ts";

const MIX: string[][] = [
  ["workspace", "list", "--json"],
  ["doctor", "--json"],
  ["config", "get", "provider"],
  ["plugins", "list"],
  ["--version"],
  ["--help"],
  ["help", "workspace"],
  ["serve", "--port", "4141"],
  ["sum 2 plus 2"],
  ["skills", "search", "web"],
  ["audit", "verify"],
];

const RUNS = Number(process.env.XR_BENCH_ROUTE_RUNS ?? 2000);

function bench(): { p50: number; p95: number; p99: number } {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const argv = MIX[i % MIX.length]!;
    const start = performance.now();
    const flags = parseGlobalFlags(argv);
    const head = flags.args[0];
    const rest = flags.args.slice(1);
    decideRoute({
      head,
      flagsVersion: flags.version,
      flagsHelp: flags.help,
      wantsCommandHelp: !!head && (rest.includes("--help") || rest.includes("-h")),
    });
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)]!;
  return { p50: p(50), p95: p(95), p99: p(99) };
}

const warm = bench(); // warm-up (module load excluded from report)
const measured = bench();

console.log(
  JSON.stringify({
    ms: measured.p95,
    samples: RUNS,
    extra: { p50: measured.p50, p99: measured.p99, warmP95: warm.p95, runs: RUNS },
  }),
);
