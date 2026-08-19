/**
 * XR Phase 10 — offline research micro-benchmarks.
 *
 * Measures the DETERMINISTIC layers that do not require Firecrawl / SearXNG /
 * internet: URL guard, canonicalization/dedupe, citation generation, source
 * normalization, budget accounting, and an end-to-end runner pass against a
 * mock provider. Reports p50 / p95 per operation.
 *
 * Live provider benchmarks (search/scrape/crawl against real backends) are
 * intentionally absent — they require API keys / network and would be
 * non-deterministic in CI. See docs/research/OPERATIONS.md.
 *
 * Run:  bun run benchmarks/research/offline-bench.ts
 */

import { assertResearchUrlShallow, assertResearchSafeUrl, canonicalizeUrl, dedupeCanonical, filterSourcesByDomainPolicy } from "../../src/research/url-guard.ts";
import { buildCitations, contentHash } from "../../src/research/citations.ts";
import { defaultResearchLimits, ResearchJobRegistry } from "../../src/research/jobs.ts";
import { runResearchOperation } from "../../src/research/runner.ts";
import { createProviderPool } from "../../src/research/providers/pool.ts";
import type { ResearchProvider, ResearchProviderContext } from "../../src/research/providers/types.ts";
import type { ResearchCapabilityId, ResearchSource } from "../../src/research/provider-types.ts";

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[Math.max(0, idx)];
}

function bench<T>(label: string, n: number, fn: () => T): { label: string; p50: number; p95: number } {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { label, p50: pct(sorted, 50), p95: pct(sorted, 95) };
}

const N = 2000;
const resolver = async () => ["93.184.216.34"];

const rows = [
  bench("url-guard shallow validate", N, () => assertResearchUrlShallow("https://example.com/docs#x?utm_source=a")),
  bench("url-guard full validate (inject resolver)", N, () => assertResearchSafeUrl("https://example.com/docs", { allowedDomains: [], blockedDomains: [], resolve: resolver })),
  bench("canonicalize + dedupe (20 urls)", N, () => dedupeCanonical(Array.from({ length: 20 }, (_, i) => `https://example.com/p${i % 7}?utm_source=${i}`))),
  bench("citation generation (10 sources)", N, () => {
    const sources: ResearchSource[] = Array.from({ length: 10 }, (_, i) => ({ sourceId: `s${i}`, url: `https://example.com/${i}`, domain: "example.com", retrievedAt: Date.now(), provider: "mock", verification: "retrieved", contentHash: contentHash(`body ${i}`) }));
    return buildCitations(sources);
  }),
  bench("source normalization + domain policy (50 sources)", N, () =>
    filterSourcesByDomainPolicy(
      Array.from({ length: 50 }, (_, i) => ({ url: `https://${i % 2 ? "example.com" : "evil.com"}/${i}`, domain: `${i % 2 ? "example.com" : "evil.com"}` })),
      { allowedDomains: ["example.com"], blockedDomains: ["evil.com"], sameDomainOnly: false, includeSubdomains: true },
    ),
  ),
  bench("default limits + budget state", N, () => defaultResearchLimits({ maxPages: 5 })),
];

const mockProvider: ResearchProvider = {
  id: "mock",
  label: "Mock",
  capabilities: () => ["search"] as ResearchCapabilityId[],
  health: async () => ({ ok: true }),
  search: async () => ({ query: "q", provider: "mock", sources: [{ sourceId: "", url: "https://example.com/a", domain: "example.com", title: "A", retrievedAt: Date.now(), provider: "mock", verification: "unverified" }] }),
  scrape: async () => { throw new Error("unsupported"); },
  map: async () => { throw new Error("unsupported"); },
  crawl: async () => { throw new Error("unsupported"); },
  getJob: async () => { throw new Error("unsupported"); },
  cancelJob: async () => {},
  extract: async () => { throw new Error("unsupported"); },
};

// End-to-end runner (mock): 100 runs.
const e2e: number[] = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  const registry = new ResearchJobRegistry(null, "ws");
  await runResearchOperation(
    { pool: createProviderPool([mockProvider]), registry, egressAllowlist: [], resolve: resolver },
    { intent: "search", query: "benchmark", source: "cli" },
  );
  e2e.push(performance.now() - t0);
}
const sortedE2e = [...e2e].sort((a, b) => a - b);

console.log("XR research — offline micro-benchmarks (bun, ms)");
console.log("─".repeat(64));
for (const r of rows) {
  console.log(`${r.label.padEnd(46)} p50 ${r.p50.toFixed(3).padStart(8)}  p95 ${r.p95.toFixed(3).padStart(8)}`);
}
console.log(`${"end-to-end runner (mock search)".padEnd(46)} p50 ${pct(sortedE2e, 50).toFixed(3).padStart(8)}  p95 ${pct(sortedE2e, 95).toFixed(3).padStart(8)}`);
console.log("─".repeat(64));
console.log("Live provider benchmarks are not measured here (require Firecrawl/SearXNG keys).");
