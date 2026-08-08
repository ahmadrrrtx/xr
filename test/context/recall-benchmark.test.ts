/**
 * XR 4.6 — Phase 6 · T5: the recall-quality benchmark gate.
 *
 * THE MEASUREMENT (Part 13.5 / Part 10)
 * ─────────────────────────────────────
 * Runs the MemoryAgentBench-style suite — 4 domains × 4 competencies,
 * inject-once/query-many-times — through the REAL retrieval pipeline and
 * asserts the measured scores meet the declared targets in RECALL_TARGETS.
 *
 * The numbers printed are the contract: docs/historical/phases/phase6/05-TEST-RESULTS.md cites
 * exactly this output. Nothing is asserted in prose that this suite does not
 * prove.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { adaptStoreForContext } from "../../src/context/repository.ts";
import {
  runRecallBenchmark,
  evaluateTargets,
  RECALL_TARGETS,
  type DomainFixture,
} from "../../src/context/eval/harness.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";

const domains = ["code", "research", "personal", "business"] as const;

function loadFixtures(): DomainFixture[] {
  return domains.map(
    (d) =>
      JSON.parse(
        readFileSync(join(process.cwd(), "benchmarks", "recall", `${d}.json`), "utf8"),
      ) as DomainFixture,
  );
}

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-bench-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterAll(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("recall benchmark (MemoryAgentBench-style, lexical/mandatory-offline route)", () => {
  test("coverage: all four domains × four competencies are exercised", async () => {
    const fixtures = loadFixtures();
    const store = new Store("bench", join(tmp, "cov.db"));
    const report = await runRecallBenchmark({
      fixtures,
      db: adaptStoreForContext(store),
      workspaceId: "bench",
      route: LEXICAL_ROUTE,
    });
    store.close();
    for (const d of domains) {
      for (const comp of ["accurate_retrieval", "test_time_learning", "long_range_consistency", "conflict_resolution"] as const) {
        expect(report.domains[d][comp].queries).toBeGreaterThan(0);
      }
    }
    expect(report.summary.queries).toBeGreaterThanOrEqual(24);
  });

  test("measured recall meets declared targets — and the numbers are printed, not implied", async () => {
    const fixtures = loadFixtures();
    const store = new Store("bench", join(tmp, "targets.db"));
    const report = await runRecallBenchmark({
      fixtures,
      db: adaptStoreForContext(store),
      workspaceId: "bench",
      route: LEXICAL_ROUTE,
      verbose: true,
    });
    store.close();

    // Print the measurement — this exact output is cited in the phase docs.
    console.log("    [recall] ── MemoryAgentBench-style measurement ──────────────");
    for (const [d, comps] of Object.entries(report.domains)) {
      for (const [c, m] of Object.entries(comps)) {
        console.log(
          `    [recall] ${d.padEnd(9)} ${c.padEnd(23)} R@5 ${m.recallAt5.toFixed(3)}  P@1 ${m.precisionAt1.toFixed(3)}  MRR ${m.mrr.toFixed(3)}  (${m.queries}q${m.failures.length ? `, FAIL: ${m.failures.map((f) => f.queryId).join(",")}` : ""})`,
        );
      }
    }
    console.log(
      `    [recall] OVERALL    R@5 ${report.summary.recallAt5.toFixed(3)}  R@1 ${report.summary.recallAt1.toFixed(3)}  P@1 ${report.summary.precisionAt1.toFixed(3)}  MRR ${report.summary.mrr.toFixed(3)}  across ${report.summary.queries} queries`,
    );

    const evaluation = evaluateTargets(report);
    expect({ violations: evaluation.violations }).toEqual({ violations: [] });
    expect(evaluation.ok).toBe(true);
  });

  test("conflict competency: the factual integrity guarantee — losers fall in every case or the run fails", async () => {
    const fixtures = loadFixtures();
    const store = new Store("bench", join(tmp, "conflict.db"));
    const report = await runRecallBenchmark({
      fixtures,
      db: adaptStoreForContext(store),
      workspaceId: "bench",
      route: LEXICAL_ROUTE,
    });
    store.close();

    const cr = report.overall.conflict_resolution;
    // The declared floor on conflict resolution: 90% measured Recall@5 with
    // ZERO unreconciled top-1 inversions in the fixture (no silent corruption).
    expect(cr.recallAt5).toBeGreaterThanOrEqual(RECALL_TARGETS.overall.conflict_resolution);
    expect(cr.failures).toHaveLength(0);
  });
});
