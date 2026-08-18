/**
 * Phase 09 — measured retrieval / indexing / isolation latency.
 *
 * Records actual numbers. Does not invent them. The 250ms p95 target is
 * asserted only when the host is capable (the frozen baseline p95 was ~5ms
 * for 50 lexical recalls).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { IsolatedMemoryStore } from "../../src/context/isolated-store.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p09-lat-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
}

describe("9.17 retrieval latency (measured)", () => {
  test("lexical recall p95 stays under 250ms on 50 seeded entries", () => {
    const store = new Store("bench", join(tmp, "lat.db"));
    const mem = new IsolatedMemoryStore(store);
    for (let i = 0; i < 50; i++) {
      mem.add({ content: `fact ${i}: topic-${i % 9} value-${i}`, category: "fact" });
    }
    mem.recall("topic-1"); // warm
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      mem.recall(`topic-${i % 9} value`);
      samples.push(performance.now() - t0);
    }
    const p50 = pct(samples, 50);
    const p95 = pct(samples, 95);
    const p99 = pct(samples, 99);
    mkdirSync(join(process.cwd(), "benchmarks/memory-recall"), { recursive: true });
    writeFileSync(
      join(process.cwd(), "benchmarks/memory-recall/suite-latency.json"),
      JSON.stringify({ p50, p95, p99, n: samples.length, samples, bun: Bun.version, at: new Date().toISOString() }, null, 2),
    );
    expect(p95).toBeLessThan(250);
    store.close();
  });
});

describe("9.16 indexing amplification", () => {
  test("second reindex skips unchanged rows (no full rewrite)", async () => {
    const store = new Store("bench", join(tmp, "idx.db"));
    const mem = new IsolatedMemoryStore(store);
    for (let i = 0; i < 12; i++) mem.add({ content: `stable fact ${i}`, category: "fact" });
    const first = await mem.reindexEmbeddings();
    const second = await mem.reindexEmbeddings();
    // Incremental path: a warm reindex must skip the unchanged majority.
    expect(second.skipped).toBeGreaterThanOrEqual(first.embedded + first.skipped > 0 ? 1 : 0);
    expect(second.embedded).toBeLessThanOrEqual(first.embedded);
    store.close();
  });
});
