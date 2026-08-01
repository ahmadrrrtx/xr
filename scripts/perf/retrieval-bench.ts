/**
 * XR Phase 3 · T10 — Retrieval @100k-items benchmark.
 *
 * Seeds a real WorkspaceStore (isolated XR_HOME) with 100,000 context items
 * and measures the full scope-first retrieval pipeline
 * (`ContextRetrieval.retrieve`, lexical route — deterministic, no embedding
 * provider) across a query mix. This is the "<100 ms @100k items" budget.
 *
 * Prints a single JSON line: { ms, samples, extra } where ms is the p95
 * retrieval latency in milliseconds.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import "./isolation.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { adaptStoreForContext, ContextRepository } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { defaultRedaction, type ContextGrant } from "../../src/context/types.ts";

const N = Number(process.env.XR_BENCH_RETRIEVAL_N ?? 100_000);
const QUERIES = Number(process.env.XR_BENCH_RETRIEVAL_QUERIES ?? 30);

const QUERY_WORDS = [
  "authentication", "database", "network", "deploy", "kubernetes",
  "budget", "audit", "compliance", "backup", "recovery",
  "memory", "context", "session", "workspace", "provider",
  "plugin", "skill", "workflow", "agent", "execution",
];

const grant: ContextGrant = {
  requester: { kind: "user", id: "bench" },
  scope: { workspaceId: "default", projectScope: "global", userId: "local" },
  allowedTiers: ["long_term_memory"],
  allowMemoryWrite: false,
  maxItems: 12,
  maxChars: 24_000,
  redact: defaultRedaction(),
  expiresAt: Date.now() + 3_600_000,
  auditRef: "perf-bench",
};

async function main(): Promise<void> {
  const home = process.env.XR_HOME ?? join(tmpdir(), `xr-retrieval-bench-${process.pid}-${Date.now()}`);
  mkdirSync(home, { recursive: true });

  const store = new WorkspaceStore("default", join(home, "xr.db"));
  const repo = new ContextRepository(adaptStoreForContext(store), "default");

  // Seed N rows in one transaction via the repository's own insert path.
  const seedStart = performance.now();
  const insert = store.prepare(
    `INSERT INTO context_items (
       id, version, type, title, content, workspace_id, project_scope,
       trust_status, consent_state, provenance_kind, actor_kind,
       confidence, sensitivity, retention, index_state,
       tags, created_at, updated_at
     ) VALUES (?, 1, 'memory', ?, ?, 'default', 'global',
       'verified', 'granted', 'user', 'user',
       'high', 'public', 'durable', 'lexical',
       'bench', ?, ?)`,
  );
  store.write(() => {
    for (let i = 0; i < N; i++) {
      const w = QUERY_WORDS[i % QUERY_WORDS.length]!;
      const w2 = QUERY_WORDS[(i + 7) % QUERY_WORDS.length]!;
      insert.run(
        `item-${i}`,
        `Project note about ${w} and ${w2} — entry number ${i}`,
        `content for ${w} entry ${i}: the ${w2} subsystem handles routing, retries and ${w}.`,
        Date.now() - i,
        Date.now() - i,
      );
    }
  });
  const seedMs = performance.now() - seedStart;

  const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
  const times: number[] = [];
  for (let q = 0; q < QUERIES; q++) {
    const query = `how does the ${QUERY_WORDS[q % QUERY_WORDS.length]} subsystem handle failures`;
    const start = performance.now();
    const result = await retrieval.retrieve(
      { queryIntent: query, query, grant, lexicalOnly: true },
    );
    times.push(performance.now() - start);
    if (result.items.length === 0) throw new Error("retrieval returned no items — bench invalid");
  }

  store.close();
  // Self-clean: this bench writes ~tens of MB per run; each sample is a
  // separate process, so the home is disposable after the JSON is printed.
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)]!;
  console.log(
    JSON.stringify({
      ms: p(95),
      samples: QUERIES,
      extra: {
        p50: p(50),
        p99: p(99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        items: N,
        seedMs: Math.round(seedMs),
      },
    }),
  );
}

await main();
