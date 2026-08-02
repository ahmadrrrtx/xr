/**
 * XR 4.5 — Phase 6 §11.9 performance benchmarks.
 *
 * Thresholds are deliberately generous (CI machines vary wildly); the point is
 * to catch an ORDER-OF-MAGNITUDE regression, not to micro-benchmark. Measured
 * numbers are printed so the validation report can cite real figures.
 */
import { describe, test, expect, beforeEach, afterEach, setDefaultTimeout } from "bun:test";

setDefaultTimeout(60_000);
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { MemoryStore } from "../../src/context/memory/store.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { ContextAssembler } from "../../src/context/assembler.ts";
import { buildInjectionPackage } from "../../src/context/injection.ts";
import { compressItems } from "../../src/context/compression.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { computeFreshness, emptyUncertainty, type ContextItem } from "../../src/context/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-perf-"));
  process.env.XR_HOME = join(tmp, "home");
});

// Fixtures are per-test SQLite databases; without this the suite fills /tmp
// over repeated runs and unrelated tests fail with "no such table".
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const results: Array<{ metric: string; value: string }> = [];
function record(metric: string, value: string): void {
  results.push({ metric, value });
  console.log(`    [perf] ${metric.padEnd(44)} ${value}`);
}

function seed(n: number): { store: Store; repo: ContextRepository; path: string } {
  const path = join(tmp, `perf-${Math.random().toString(36).slice(2)}.db`);
  const store = new Store("default", path);
  const repo = new ContextRepository(adaptStoreForContext(store), "default");
  repo.migrate();
  const topics = ["authentication", "deployment", "database", "caching", "logging", "billing"];
  for (let i = 0; i < n; i++) {
    repo.insertItem({
      type: "knowledge",
      content: `${topics[i % topics.length]} note ${i}: configuration detail about the ${topics[i % topics.length]} subsystem with supporting explanation text.`,
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
    });
  }
  return { store, repo, path };
}

function grant() {
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({ workspaceId: "default", projectScope: "proj", userId: "local" }),
    },
    { memoryScopeKind: "user" },
  );
}

describe("XR 4.5 performance (§11.9)", () => {
  test("retrieval latency over 1,000 items stays well under 250ms", async () => {
    const { repo } = seed(1000);
    const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
    const g = grant();

    // Warm.
    await retrieval.retrieve({ queryIntent: "warm", query: "authentication", grant: g });

    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      await retrieval.retrieve({
        queryIntent: "find configuration",
        query: "deployment configuration subsystem",
        grant: g,
      });
    }
    const avg = (performance.now() - t0) / runs;
    record("retrieval avg (1,000 items, lexical)", `${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(250);
  });

  test("scope filtering scales: 5,000 items still resolves quickly", async () => {
    const { repo } = seed(5000);
    const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
    const t0 = performance.now();
    const res = await retrieval.retrieve({
      queryIntent: "q", query: "caching subsystem configuration", grant: grant(),
    });
    const ms = performance.now() - t0;
    record("retrieval single pass (5,000 items)", `${ms.toFixed(2)} ms`);
    // Candidate scanning is bounded, so this must not blow up.
    expect(ms).toBeLessThan(1500);
    expect(res.items.length).toBeGreaterThan(0);
  });

  test("authorization filtering is O(n) and cheap", () => {
    const { repo } = seed(2000);
    const items = repo.listCandidates({ workspaceId: "default", projectScope: "proj", limit: 2000 });
    const g = grant();
    const t0 = performance.now();
    let allowed = 0;
    for (const item of items) {
      // The policy gate is the hot path that runs before ranking.
      const { authorize } = require("../../src/context/policy.ts") as typeof import("../../src/context/policy.ts");
      if (authorize(item, g).allowed) allowed++;
    }
    const ms = performance.now() - t0;
    record("authorize() over 2,000 items", `${ms.toFixed(2)} ms`);
    expect(allowed).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });

  test("package assembly stays under 300ms", async () => {
    const { repo } = seed(1000);
    const assembler = new ContextAssembler(repo, new ContextRetrieval(repo, LEXICAL_ROUTE));
    const t0 = performance.now();
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "assemble context", query: "billing subsystem configuration",
    });
    const ms = performance.now() - t0;
    record("package assembly (1,000 items)", `${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(300);
    expect(pkg.totalItems).toBeGreaterThan(0);
  });

  test("injection construction is sub-millisecond per package", async () => {
    const { repo } = seed(500);
    const assembler = new ContextAssembler(repo, new ContextRetrieval(repo, LEXICAL_ROUTE));
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "q", query: "logging subsystem",
    });
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) buildInjectionPackage(pkg);
    const avg = (performance.now() - t0) / runs;
    record("injection build avg", `${avg.toFixed(3)} ms`);
    expect(avg).toBeLessThan(20);
  });

  test("compression of 100 items completes quickly", () => {
    const now = Date.now();
    const items: ContextItem[] = Array.from({ length: 100 }, (_, i) => ({
      id: `ctx_${i}`,
      version: 1,
      type: "task_context",
      content: `We decided approach ${i} after review. Source: https://example.com/doc-${i}. Possibly needs revisiting.`,
      title: `note ${i}`,
      scope: { workspaceId: "default", projectScope: "proj", userId: "local" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
      freshness: computeFreshness({ createdAt: now, updatedAt: now }, now),
      uncertainty: emptyUncertainty(),
      sensitivity: "unknown",
      retention: "durable",
      links: {},
      indexState: "none",
      tags: [],
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    }));
    const t0 = performance.now();
    const res = compressItems({ items, taskIdentity: "perf task", maxChars: 8000 });
    const ms = performance.now() - t0;
    record("compression (100 items)", `${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(500);
    if (res.ok) {
      const ratio = res.compressedChars / res.originalChars;
      record("compression ratio", `${(ratio * 100).toFixed(1)}% of original`);
      expect(ratio).toBeLessThan(1);
    }
  });

  test("storage growth per item is bounded and modest", () => {
    const empty = seed(0);
    const emptySize = statSync(empty.path).size;
    const filled = seed(1000);
    const filledSize = statSync(filled.path).size;
    const perItem = (filledSize - emptySize) / 1000;
    record("db growth per context item", `${perItem.toFixed(0)} bytes`);
    record("db size (1,000 items)", `${(filledSize / 1024).toFixed(0)} KiB`);
    // Content is ~130 chars; anything above 4 KiB/item means duplication.
    expect(perItem).toBeLessThan(4096);
  });

  test("XR 4.4 legacy recall path is not slowed by the 4.5 columns", () => {
    const path = join(tmp, "legacy-perf.db");
    const store = new Store("default", path);
    const mem = new MemoryStore(store);
    for (let i = 0; i < 500; i++) {
      mem.add({ content: `preference number ${i} about tooling and workflow`, category: "preference" });
    }
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) mem.recall("tooling workflow preference");
    const avg = (performance.now() - t0) / runs;
    record("legacy MemoryStore.recall avg (500 entries)", `${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(200);
  });

  test("package persistence overhead is small", async () => {
    const { repo } = seed(200);
    const assembler = new ContextAssembler(repo, new ContextRetrieval(repo, LEXICAL_ROUTE));
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      await assembler.assemble({
        grant: grant(), queryIntent: "q", query: "database subsystem", runId: `run_${i}`,
      });
    }
    const avg = (performance.now() - t0) / runs;
    record("assemble + persist avg", `${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(300);
  });

  test("revalidation on resume is fast", async () => {
    const { repo } = seed(500);
    const assembler = new ContextAssembler(repo, new ContextRetrieval(repo, LEXICAL_ROUTE));
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "q", query: "authentication subsystem",
    });
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) assembler.revalidate(pkg);
    const avg = (performance.now() - t0) / runs;
    record("package revalidation avg", `${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(100);
  });

  test("Phase 6 · G6: retrieval p95 < 100ms is MEASURED at 100,000 stored items", async () => {
    // The constitutional budget (Art. XII) previously rested on seeds ≤5,000;
    // Phase 6 proves it at the declared 100k scale. Seeding is ~4s since the
    // repository compiles each SQL statement once (see the prepared-statement
    // cache in repository.ts — before it, the WriteGate retained every
    // per-call statement and bulk seeding stalled at ~53k items).
    const { repo } = seed(100_000);
    const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
    const g = grant();
    const topics = ["authentication", "deployment", "database", "caching", "logging", "billing"];

    // Warm, then measure a representative query mix.
    await retrieval.retrieve({ queryIntent: "warm", query: "authentication", grant: g });
    const lat: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const out = await retrieval.retrieve({
        queryIntent: `scale-${i}`,
        query: `${topics[i % topics.length]} configuration subsystem`,
        grant: g,
      });
      lat.push(performance.now() - t0);
      expect(out.items.length).toBeGreaterThan(0);
    }
    lat.sort((a, b) => a - b);
    const p95 = lat[Math.floor(lat.length * 0.95)]!;
    const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
    record("retrieval avg (100,000 items, lexical)", `${avg.toFixed(2)} ms`);
    record("retrieval p95 (100,000 items, lexical)", `${p95.toFixed(2)} ms`);
    // THE budget, measured (local runs land ≈25ms — 4× headroom for CI).
    expect(p95).toBeLessThan(100);
  }, 120_000);

  test("summary: print the collected benchmark table", () => {
    console.log("\n    ── XR 4.5 benchmark summary ──");
    for (const r of results) console.log(`    ${r.metric.padEnd(44)} ${r.value}`);
    expect(results.length).toBeGreaterThan(0);
  });
});
