/**
 * XR Phase 3 · T9 — incremental content-addressed indexing tests.
 *
 * `memory reindex` must:
 *   - embed everything on the first pass;
 *   - skip ~100% of rows on an unchanged second pass (the 90%+ warm
 *     re-index reduction target);
 *   - re-embed exactly the changed rows after an edit;
 *   - keep content_hash columns consistent on the workspace store.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { MemoryStore } from "../../src/context/memory/store.ts";

async function fresh(): Promise<{ store: WorkspaceStore; mem: MemoryStore }> {
  const home = join(tmpdir(), `xr-incr-${process.pid}-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  process.env.XR_HOME = home;
  const store = new WorkspaceStore("default", join(home, "xr.db"));
  const mem = new MemoryStore(store);
  for (let i = 0; i < 50; i++) {
    mem.add({ category: "fact", content: `fact number ${i} about the ${i % 3 === 0 ? "network" : "budget"}`, scope: "global", source: "user", tags: [`t${i}`] });
  }
  return { store, mem };
}

describe("Phase 3 · T9 — incremental content-addressed reindex", () => {
  test("first pass embeds everything; second pass skips ≥90% (unchanged store)", async () => {
    const { store, mem } = await fresh();
    try {
      const first = await mem.reindexEmbeddings();
      expect(first.total).toBe(50);
      expect(first.embedded).toBe(50);
      expect(first.skipped).toBe(0);

      const second = await mem.reindexEmbeddings();
      expect(second.skipped).toBe(50);
      // The 90%+ warm re-index reduction target: unchanged rows are skipped.
      expect(second.embedded / second.total).toBeLessThanOrEqual(0.1);
    } finally {
      store.close();
    }
  }, 60_000);

  test("changed rows are the only ones re-embedded", async () => {
    const { store, mem } = await fresh();
    try {
      await mem.reindexEmbeddings();
      const rows = store.listMemory({ includeExclusions: true, includeExpired: true });
      const target = rows[0]!;
      store.updateMemory(target.id, { content: "completely different fact" });

      const third = await mem.reindexEmbeddings();
      expect(third.embedded).toBe(1);
      expect(third.skipped).toBe(49);
    } finally {
      store.close();
    }
  }, 60_000);

  test("content hash is stored and matches the embedded text", async () => {
    const { store, mem } = await fresh();
    try {
      await mem.reindexEmbeddings();
      const rows = store.listMemory({ includeExclusions: true, includeExpired: true });
      for (const row of rows.slice(0, 5)) {
        expect(row.content_hash).toBeTruthy();
        expect(row.embedding).toBeTruthy();
        const { contentHash } = await import("../../src/context/memory/store.ts");
        const text = `${row.content} ${(row.tags || "").split(",").join(" ")}`.trim();
        expect(row.content_hash).toBe(contentHash(text));
      }
    } finally {
      store.close();
    }
  }, 60_000);
});
