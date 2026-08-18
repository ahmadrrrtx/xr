#!/usr/bin/env bun
/**
 * Phase 09 — memory recall + context assembly benchmark.
 *
 * Measures real hardware. Does not invent numbers.
 *
 *   bun run scripts/memory-recall-bench.ts
 *
 * Writes:
 *   benchmarks/memory-recall/latest.json
 *   benchmarks/context/latest.json
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, cpus, totalmem, platform, arch } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { IsolatedMemoryStore } from "../src/context/isolated-store.ts";
import { ContextRepository, adaptStoreForContext } from "../src/context/repository.ts";
import { ContextRetrieval } from "../src/context/retrieval.ts";
import { ContextAssembler } from "../src/context/assembler.ts";
import { buildGrant, makeScope } from "../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../src/context/embedding.ts";
import { microCompact } from "../src/context/microcompact.ts";
import { contentHash } from "../src/context/memory/store.ts";

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

function envInfo() {
  return {
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    ramGiB: Math.round((totalmem() / 1024 / 1024 / 1024) * 10) / 10,
    bun: Bun.version,
    measuredAt: new Date().toISOString(),
  };
}

const tmp = mkdtempSync(join(tmpdir(), "xr-p09-bench-"));
const store = new Store("bench", join(tmp, "bench.db"));
const mem = new IsolatedMemoryStore(store);
const repo = new ContextRepository(adaptStoreForContext(store), "bench");
repo.migrate();

const FACTS = [
  "User prefers TypeScript and Bun for backend work",
  "The API listens on port 8080 after the 2026 migration",
  "Project migrated from provider X to provider Y",
  "Deployments run on Fridays after the review meeting",
  "The canonical store is SQLite via WorkspaceStore",
];

for (let i = 0; i < 50; i++) {
  mem.add({
    content: i < FACTS.length ? FACTS[i]! : `filler fact ${i} about topic-${i % 7}`,
    category: "fact",
    source: "user",
  });
}

const queries = [
  "what runtime do I prefer",
  "which port does the API listen on",
  "which provider does the project use",
  "when do we deploy",
  "what database does XR use",
];

// Warm
mem.recall(queries[0]!);

const cold: number[] = [];
const warm: number[] = [];
let hits = 0;
let asked = 0;

for (const q of queries) {
  const t0 = performance.now();
  const r = mem.recall(q, { k: 3 });
  cold.push(performance.now() - t0);
  asked++;
  if (r.length) hits++;
}
for (let i = 0; i < 40; i++) {
  const q = queries[i % queries.length]!;
  const t0 = performance.now();
  mem.recall(q, { k: 3 });
  warm.push(performance.now() - t0);
}

const grant = buildGrant(
  {
    requester: { kind: "agent", id: "bench", role: "agent" },
    scope: makeScope({ workspaceId: "bench", projectScope: "global" }),
    maxItems: 48,
    maxChars: 24_000,
  },
  { memoryScopeKind: "user" },
);
const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
const assembler = new ContextAssembler(repo, retrieval);

const assembleMs: number[] = [];
for (let i = 0; i < 12; i++) {
  const t0 = performance.now();
  await assembler.assemble({ grant, queryIntent: "bench", query: queries[i % queries.length]! });
  assembleMs.push(performance.now() - t0);
}

const compactMs: number[] = [];
const longConvo = Array.from({ length: 40 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  content: `turn ${i} ${"context ".repeat(40)}`,
}));
for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  microCompact(longConvo, { maxChars: 2_000, keepRecent: 6 });
  compactMs.push(performance.now() - t0);
}

// Indexing amplification: two list()+reindex passes; second should skip unchanged.
const first = await mem.reindexEmbeddings();
const second = await mem.reindexEmbeddings();

const recallReport = {
  environment: envInfo(),
  n: { seeded: 50, coldQueries: cold.length, warmQueries: warm.length },
  cold: { p50: percentile(cold, 50), p95: percentile(cold, 95), p99: percentile(cold, 99), samples: cold },
  warm: { p50: percentile(warm, 50), p95: percentile(warm, 95), p99: percentile(warm, 99), samples: warm },
  hitRate: asked ? hits / asked : 0,
  targetP95Ms: 250,
  meetsTarget: percentile(warm, 95) < 250 && percentile(cold, 95) < 250,
  indexing: {
    firstEmbedded: first.embedded,
    firstSkipped: first.skipped,
    secondEmbedded: second.embedded,
    secondSkipped: second.skipped,
    amplificationRegressed: second.embedded > 0 && second.skipped === 0 && first.embedded > 0,
  },
};

const contextReport = {
  environment: envInfo(),
  assemble: {
    p50: percentile(assembleMs, 50),
    p95: percentile(assembleMs, 95),
    p99: percentile(assembleMs, 99),
    samples: assembleMs,
  },
  compact: {
    p50: percentile(compactMs, 50),
    p95: percentile(compactMs, 95),
    p99: percentile(compactMs, 99),
    samples: compactMs,
  },
};

mkdirSync(join(process.cwd(), "benchmarks/memory-recall"), { recursive: true });
mkdirSync(join(process.cwd(), "benchmarks/context"), { recursive: true });
writeFileSync(join(process.cwd(), "benchmarks/memory-recall/latest.json"), JSON.stringify(recallReport, null, 2));
writeFileSync(join(process.cwd(), "benchmarks/context/latest.json"), JSON.stringify(contextReport, null, 2));

console.log(JSON.stringify({ recall: recallReport, context: contextReport, contentHashDemo: contentHash("x").slice(0, 8) }, null, 2));

store.close();
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* best-effort */
}
