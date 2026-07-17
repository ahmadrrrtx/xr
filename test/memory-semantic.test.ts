/**
 * XR v0.9 #4 — semantic recall tests.
 *
 * The test environment has no Ollama, so embed() transparently uses the
 * deterministic LEXICAL FALLBACK. That's exactly what we want to prove: the
 * semantic path ALWAYS works and degrades gracefully with no embedding model.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { MemoryStore } from "../src/memory/store.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-sem-"));
  process.env.XR_HOME = join(tmp, "home");
});

function freshMem(): { store: Store; mem: MemoryStore } {
  const store = new Store(join(tmp, `s-${Math.random().toString(36).slice(2)}.db`));
  return { store, mem: new MemoryStore(store) };
}

test("recallSemantic returns the relevant entry (fallback path)", async () => {
  const { store, mem } = freshMem();
  mem.add({ content: "I prefer TypeScript and Bun for backend work", category: "preference" });
  mem.add({ content: "favourite dessert is tiramisu", category: "fact" });
  const hits = await mem.recallSemantic("what typescript runtime do I use");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].content).toContain("TypeScript");
  store.close();
});

test("recallSemantic never returns exclusions", async () => {
  const { store, mem } = freshMem();
  mem.add({ content: "I prefer Bun", category: "preference" });
  mem.add({ content: "secret token value", category: "exclusion" });
  const hits = await mem.recallSemantic("secret token");
  expect(hits.every((h) => h.category !== "exclusion")).toBe(true);
  store.close();
});

test("recallSemantic is conservative for irrelevant queries", async () => {
  const { store, mem } = freshMem();
  mem.add({ content: "I prefer TypeScript and Bun", category: "preference" });
  const hits = await mem.recallSemantic("lattice gauge quantum chromodynamics");
  expect(hits.length).toBe(0);
  store.close();
});

test("recallSemantic respects the k limit", async () => {
  const { store, mem } = freshMem();
  for (let i = 0; i < 8; i++) mem.add({ content: `typescript tip number ${i}`, category: "preference" });
  const hits = await mem.recallSemantic("typescript tip", { k: 3 });
  expect(hits.length).toBeLessThanOrEqual(3);
  store.close();
});

test("recallSemantic caches embeddings (lazy) on first use", async () => {
  const { store, mem } = freshMem();
  const a = mem.add({ content: "I prefer Bun and Zod", category: "preference" });
  // before recall: no cached embedding
  expect(store.getMemory(a.entry!.id)!.embedding).toBeNull();
  await mem.recallSemantic("bun");
  // after recall: embedding is cached
  expect(store.getMemory(a.entry!.id)!.embedding).not.toBeNull();
  store.close();
});

test("reindexEmbeddings warms the cache for all entries (incl. exclusions)", async () => {
  const { store, mem } = freshMem();
  mem.add({ content: "prefers dark mode", category: "preference" });
  mem.add({ content: "project is XR", category: "project", scope: "xr" });
  mem.add({ content: "do not store my ssn", category: "exclusion" });
  const res = await mem.reindexEmbeddings();
  expect(res.total).toBe(3);
  expect(res.embedded).toBe(3);
  // every row now has a cached embedding
  for (const row of store.listMemory({ includeExclusions: true })) {
    expect(row.embedding).not.toBeNull();
  }
  store.close();
});

test("editing content clears the stale embedding (re-embeds next recall)", async () => {
  const { store, mem } = freshMem();
  const a = mem.add({ content: "use npm", category: "preference" });
  await mem.recallSemantic("npm"); // cache it
  expect(store.getMemory(a.entry!.id)!.embedding).not.toBeNull();
  mem.update(a.entry!.id, { content: "use bun, not npm" });
  // stale embedding cleared by the update
  expect(store.getMemory(a.entry!.id)!.embedding).toBeNull();
  store.close();
});

test("insertMemory persists a provided embedding round-trip", () => {
  const { store } = freshMem();
  store.insertMemory({
    id: "mem_test",
    category: "fact",
    content: "x",
    scope: "global",
    source: "user",
    tags: "",
    importance: 3,
    embedding: [0.1, 0.2, 0.3],
  });
  const row = store.getMemory("mem_test")!;
  expect(JSON.parse(row.embedding!)).toEqual([0.1, 0.2, 0.3]);
  store.close();
});

test("setMemoryEmbedding null clears the cache", () => {
  const { store } = freshMem();
  store.insertMemory({
    id: "mem_clr",
    category: "fact",
    content: "y",
    scope: "global",
    source: "user",
    tags: "",
    importance: 3,
    embedding: [1, 2, 3],
  });
  store.setMemoryEmbedding("mem_clr", null);
  expect(store.getMemory("mem_clr")!.embedding).toBeNull();
  store.close();
});
