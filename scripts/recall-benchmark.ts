#!/usr/bin/env bun
/**
 * XR 4.6 — Phase 6 · T5: the measured-recall benchmark runner.
 *
 * WHY THIS SCRIPT EXISTS (Article VIII.5 — recall is MEASURED, never asserted)
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the offline/async benchmark driver. It is never on the agent hot
 * path: it owns scratch stores under the OS temp dir, loads the committed
 * fixtures, runs the REAL retrieval pipeline (scope fence → authorize → hybrid
 * channels → RRF fusion → rerank → conflict penalties) and reports measured
 * numbers. It does three things:
 *
 *   1. RECALL — MemoryAgentBench-style protocol: 4 domains × 4 competencies,
 *      inject-once/query-many, deterministic id assertions (no LLM judge).
 *   2. SCALE — measures retrieval latency at 100,000 stored items (the
 *      constitutional p95 < 100ms @100k budget, previously only asserted at
 *      ≤5,000 items — Phase-6 gap G6, now measured).
 *   3. REPORT — prints the measured matrix; with --write persists
 *      docs/phase6/measured-recall.json (the single evidence file the Phase-6
 *      docs cite). Exit code is non-zero when any declared target is missed,
 *      so the benchmark is a gate, not a decoration.
 *
 * Usage:
 *   bun scripts/recall-benchmark.ts [--write] [--skip-large]
 *                                   [--large-items N] [--large-queries N]
 *
 * Mandatory-offline: the default route is the lexical one. No network, no LLM,
 * no live workspace database is touched.
 */

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { ContextRepository, adaptStoreForContext } from "../src/context/repository.ts";
import { ContextRetrieval } from "../src/context/retrieval.ts";
import { buildGrant, makeScope } from "../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../src/context/embedding.ts";
import {
  runRecallBenchmark,
  evaluateTargets,
  RECALL_TARGETS,
  type BenchmarkReport,
  type DomainFixture,
} from "../src/context/eval/harness.ts";

// ── flags ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const flagValue = (name: string, dflt: number): number => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const WRITE = flag("write");
const SKIP_LARGE = flag("skip-large");
const LARGE_ITEMS = flagValue("large-items", 100_000);
const LARGE_QUERIES = flagValue("large-queries", 50);

const DOMAINS = ["code", "research", "personal", "business"] as const;
/** Constitutional retrieval budget (Article XII): p95 at 100k items. */
const P95_BUDGET_MS = 100;

// ── recall suite ────────────────────────────────────────────────────────────

function loadFixtures(): DomainFixture[] {
  return DOMAINS.map(
    (d) =>
      JSON.parse(
        readFileSync(join(process.cwd(), "benchmarks", "recall", `${d}.json`), "utf8"),
      ) as DomainFixture,
  );
}

function printMatrix(report: BenchmarkReport): void {
  console.log("\n── measured recall (MemoryAgentBench-style, lexical route) ──────────────");
  for (const domain of DOMAINS) {
    for (const [comp, m] of Object.entries(report.domains[domain])) {
      const fail = m.failures.length ? `  (FAIL: ${m.failures.map((f) => f.queryId).join(",")})` : "";
      console.log(
        `  ${domain.padEnd(9)} ${comp.padEnd(23)} R@5 ${m.recallAt5.toFixed(3)}  P@1 ${m.precisionAt1.toFixed(3)}  MRR ${m.mrr.toFixed(3)}  (${m.queries}q)${fail}`,
      );
    }
  }
  const s = report.summary;
  console.log(
    `  OVERALL   R@5 ${s.recallAt5.toFixed(3)}  R@1 ${s.recallAt1.toFixed(3)}  P@1 ${s.precisionAt1.toFixed(3)}  MRR ${s.mrr.toFixed(3)}  across ${s.queries} queries`,
  );
}

// ── @100k latency measurement (GAP G6: the budget is now MEASURED) ──────────

interface ScaleResult {
  items: number;
  p95Ms: number;
  avgMs: number;
  seedMs: number;
}

async function measureAtScale(items: number, queries: number): Promise<ScaleResult> {
  const home = mkdtempSync(join(tmpdir(), "xr-bench-scale-"));
  process.env.XR_HOME = home;
  try {
    return await measureAtScaleIn(home, items, queries);
  } finally {
    // The 100k db is ~90MB — scratch space must not leak on CI runners.
    rmSync(home, { recursive: true, force: true });
  }
}

async function measureAtScaleIn(home: string, items: number, queries: number): Promise<ScaleResult> {
  const store = new Store("bench", join(home, "scale.db"));
  const repo = new ContextRepository(adaptStoreForContext(store), "bench");
  repo.migrate();

  const topics = [
    "authentication",
    "deployment",
    "database",
    "caching",
    "logging",
    "billing",
    "scheduler",
    "observability",
  ];
  const t0 = performance.now();
  for (let i = 0; i < items; i++) {
    repo.insertItem({
      type: "knowledge",
      content: `${topics[i % topics.length]} note ${i}: configuration detail about the ${topics[i % topics.length]} subsystem with supporting explanation text.`,
      scope: { workspaceId: "bench", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
      tags: [topics[i % topics.length]!],
    });
  }
  const seedMs = performance.now() - t0;

  const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
  const grant = buildGrant(
    {
      requester: { kind: "agent", id: "bench", role: "coder" },
      scope: makeScope({ workspaceId: "bench", projectScope: "proj" }),
    },
    { memoryScopeKind: "user" },
  );

  // Warm the query caches, then time realistic mixed-term queries.
  await retrieval.retrieve({ queryIntent: "warm", query: "authentication", grant });

  const lat: number[] = [];
  for (let i = 0; i < queries; i++) {
    const q = `${topics[i % topics.length]} configuration subsystem`;
    const s = performance.now();
    const out = await retrieval.retrieve({ queryIntent: `scale-${i}`, query: q, grant });
    lat.push(performance.now() - s);
    if (out.items.length === 0) {
      throw new Error(`@scale sanity: query "${q}" returned no items — measurement invalid`);
    }
  }
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]!;
  const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
  return { items, p95Ms: p95, avgMs: avg, seedMs };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "xr-bench-"));
  process.env.XR_HOME = home;
  try {
    await runLanes(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function runLanes(home: string): Promise<void> {
  const store = new Store("bench", join(home, "recall.db"));
  const report = await runRecallBenchmark({
    fixtures: loadFixtures(),
    db: adaptStoreForContext(store),
    workspaceId: "bench",
    route: LEXICAL_ROUTE,
    verbose: true,
  });
  printMatrix(report);

  if (!SKIP_LARGE) {
    console.log(`\n── scale measurement: seeding ${LARGE_ITEMS.toLocaleString()} items …`);
    const scale = await measureAtScale(LARGE_ITEMS, LARGE_QUERIES);
    report.largeScale = { items: scale.items, p95Ms: scale.p95Ms, avgMs: scale.avgMs };
    console.log(
      `  seeded ${scale.items.toLocaleString()} items in ${(scale.seedMs / 1000).toFixed(1)}s; ` +
        `retrieval avg ${scale.avgMs.toFixed(2)}ms, p95 ${scale.p95Ms.toFixed(2)}ms ` +
        `(budget p95 < ${P95_BUDGET_MS}ms @100k)`,
    );
  }

  const evaluation = evaluateTargets(report);
  const violations = [...evaluation.violations];
  if (report.largeScale && report.largeScale.p95Ms >= P95_BUDGET_MS) {
    violations.push(
      `scale: p95 ${report.largeScale.p95Ms.toFixed(2)}ms >= budget ${P95_BUDGET_MS}ms at ${report.largeScale.items} items`,
    );
  }

  if (WRITE) {
    const out = join(process.cwd(), "docs", "phase6", "measured-recall.json");
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n  wrote ${out}`);
  }

  console.log("\n── declared targets ─────────────────────────────────────────────────────");
  console.log(
    `  per-domain R@5 floor: ${RECALL_TARGETS.perDomain} — overall: AR ${RECALL_TARGETS.overall.accurate_retrieval}, TTL ${RECALL_TARGETS.overall.test_time_learning}, LRC ${RECALL_TARGETS.overall.long_range_consistency}, CR ${RECALL_TARGETS.overall.conflict_resolution}; scale p95 < ${P95_BUDGET_MS}ms @100k`,
  );
  if (violations.length) {
    console.error(`\n  BENCHMARK FAILED — ${violations.length} violation(s):`);
    for (const v of violations) console.error(`    • ${v}`);
    process.exit(1);
  }
  console.log("  all declared targets met (measured, not asserted) ✓");
  // Explicit exit: scratch stores hold open SQLite handles that would keep the
  // event loop alive after the work is done (offline tool, never a daemon).
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
