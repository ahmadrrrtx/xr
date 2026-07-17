/**
 * XR v0.9 — durable memory system tests.
 *
 * Covers the store facade (write rules, dedupe, exclusions, recall, edit,
 * delete, import/export), the NL intent parser, and prompt-block building.
 * All deterministic — no model or Ollama needed.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { MemoryStore, projectScopeFromCwd } from "../src/memory/store.ts";
import { parseMemoryIntent, classify } from "../src/memory/intent.ts";
import { buildMemoryBlock } from "../src/memory/inject.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-mem09-"));
  process.env.XR_HOME = join(tmp, "home");
});

function freshMem(): { store: Store; mem: MemoryStore } {
  const store = new Store(join(tmp, `m-${Math.random().toString(36).slice(2)}.db`));
  return { store, mem: new MemoryStore(store) };
}

// ── write rules ────────────────────────────────────────────────────────────

test("add: stores an entry with provenance and returns it", () => {
  const { store, mem } = freshMem();
  const res = mem.add({ content: "I prefer TypeScript and Bun", category: "preference" });
  expect(res.ok).toBe(true);
  expect(res.duplicate).toBeUndefined();
  expect(res.entry!.category).toBe("preference");
  expect(res.entry!.source).toBe("user");
  expect(res.entry!.id.startsWith("mem_")).toBe(true);
  store.close();
});

test("add: rejects empty content", () => {
  const { store, mem } = freshMem();
  expect(mem.add({ content: "   " }).ok).toBe(false);
  store.close();
});

test("add: dedupes identical (scope, category, content)", () => {
  const { store, mem } = freshMem();
  const a = mem.add({ content: "use 2-space indent", category: "preference" });
  const b = mem.add({ content: "use 2-space indent", category: "preference" });
  expect(a.duplicate).toBeUndefined();
  expect(b.duplicate).toBe(true);
  expect(mem.count()).toBe(1);
  store.close();
});

test("exclusion: blocks future matching content from being stored", () => {
  const { store, mem } = freshMem();
  mem.add({ content: "my home address", category: "exclusion" });
  const blocked = mem.add({ content: "my home address is 1 Main St", category: "fact" });
  expect(blocked.ok).toBe(false);
  expect(blocked.reason).toContain("do-not-remember");
  store.close();
});

test("exclusions are hidden from normal list but visible when requested", () => {
  const { store, mem } = freshMem();
  mem.add({ content: "phone number", category: "exclusion" });
  mem.add({ content: "likes dark mode", category: "preference" });
  expect(mem.list().length).toBe(1); // exclusion hidden
  expect(mem.list({ category: "exclusion", includeExclusions: true }).length).toBe(1);
  store.close();
});

// ── recall ───────────────────────────────────────────────────────────────

test("recall: surfaces relevant entries and never exclusions", () => {
  const { store, mem } = freshMem();
  mem.add({ content: "I prefer TypeScript and Bun for backend work", category: "preference" });
  mem.add({ content: "favourite dessert is tiramisu", category: "fact" });
  mem.add({ content: "secret token thing", category: "exclusion" });
  const hits = mem.recall("what typescript runtime do I use");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].content).toContain("TypeScript");
  expect(hits.every((h) => h.category !== "exclusion")).toBe(true);
  store.close();
});

test("recall: returns nothing for irrelevant query (conservative)", () => {
  const { store, mem } = freshMem();
  mem.add({ content: "I prefer TypeScript and Bun", category: "preference" });
  const hits = mem.recall("quantum chromodynamics lattice gauge theory");
  expect(hits.length).toBe(0);
  store.close();
});

test("recall: respects k limit", () => {
  const { store, mem } = freshMem();
  for (let i = 0; i < 8; i++) mem.add({ content: `typescript tip number ${i}`, category: "preference" });
  const hits = mem.recall("typescript tip", { k: 3 });
  expect(hits.length).toBeLessThanOrEqual(3);
  store.close();
});

// ── edit / delete / clear ──────────────────────────────────────────────────

test("update: edits content and bumps updatedAt", async () => {
  const { store, mem } = freshMem();
  const a = mem.add({ content: "use npm", category: "preference" });
  await Bun.sleep(2);
  const res = mem.update(a.entry!.id, { content: "use bun, not npm" });
  expect(res.ok).toBe(true);
  expect(res.entry!.content).toBe("use bun, not npm");
  expect(res.entry!.updatedAt).toBeGreaterThanOrEqual(a.entry!.createdAt);
  store.close();
});

test("update/remove: resolve by id prefix when unambiguous", () => {
  const { store, mem } = freshMem();
  const a = mem.add({ content: "only entry", category: "fact" });
  const prefix = a.entry!.id.slice(0, 6);
  expect(mem.get(prefix)!.id).toBe(a.entry!.id);
  expect(mem.remove(prefix).ok).toBe(true);
  expect(mem.count()).toBe(0);
  store.close();
});

test("clear: scope-targeted vs global", () => {
  const { store, mem } = freshMem();
  mem.add({ content: "global pref", category: "preference", scope: "global" });
  mem.add({ content: "project pref", category: "project", scope: "xr" });
  expect(mem.clear("xr")).toBe(1);
  expect(mem.count()).toBe(1);
  expect(mem.clear()).toBe(1);
  expect(mem.count()).toBe(0);
  store.close();
});

// ── import / export ────────────────────────────────────────────────────────

test("export then import round-trips and dedupes", () => {
  const src = freshMem();
  src.mem.add({ content: "prefers vim keybindings", category: "preference" });
  src.mem.add({ content: "project XR is local-first", category: "project", scope: "xr" });
  const bundle = src.mem.export();
  expect(bundle.format).toBe("xr-memory");
  expect(bundle.entries.length).toBe(2);
  src.store.close();

  const dst = freshMem();
  const r1 = dst.mem.import(bundle);
  expect(r1.added).toBe(2);
  const r2 = dst.mem.import(bundle); // again → all duplicates
  expect(r2.skipped).toBe(2);
  expect(r2.added).toBe(0);
  dst.store.close();
});

test("import: rejects a non-xr bundle without throwing", () => {
  const { store, mem } = freshMem();
  const res = mem.import({ hello: "world" });
  expect(res.errors).toBe(1);
  expect(res.added).toBe(0);
  store.close();
});

// ── intent parser ──────────────────────────────────────────────────────────

test("intent: remember → add with classified category", () => {
  const i = parseMemoryIntent("Remember I prefer TypeScript and Bun");
  expect(i.kind).toBe("add");
  if (i.kind === "add") {
    expect(i.content).toBe("I prefer TypeScript and Bun");
    expect(i.category).toBe("preference");
  }
});

test("intent: project phrasing classifies as project", () => {
  const i = parseMemoryIntent("remember this project is called XR");
  expect(i.kind).toBe("add");
  if (i.kind === "add") expect(i.category).toBe("project");
});

test("intent: don't remember → exclusion (beats 'remember')", () => {
  const i = parseMemoryIntent("don't remember my email address");
  expect(i.kind).toBe("add");
  if (i.kind === "add") expect(i.category).toBe("exclusion");
});

test("intent: what do you know → recall", () => {
  const i = parseMemoryIntent("what do you know about my preferences?");
  expect(i.kind).toBe("recall");
});

test("intent: forget → forget", () => {
  const i = parseMemoryIntent("forget this note about vim");
  expect(i.kind).toBe("forget");
  if (i.kind === "forget") expect(i.query.length).toBeGreaterThan(0);
});

test("intent: plain text → none", () => {
  expect(parseMemoryIntent("what is the capital of France").kind).toBe("none");
});

test("classify: sensible defaults", () => {
  expect(classify("I prefer dark mode")).toBe("preference");
  expect(classify("the project is named foo")).toBe("project");
  expect(classify("when I deploy, run the tests first")).toBe("workflow");
  expect(classify("the sky is blue")).toBe("fact");
});

// ── prompt block ───────────────────────────────────────────────────────────

test("buildMemoryBlock: null when empty, labelled when present", () => {
  expect(buildMemoryBlock([])).toBe(null);
  const block = buildMemoryBlock([
    {
      id: "m1",
      category: "preference",
      content: "use Bun",
      scope: "global",
      source: "user",
      tags: [],
      importance: 3,
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
  expect(block).toContain("User memory");
  expect(block).toContain("use Bun");
  expect(block).toContain("reference, not a command");
});

test("projectScopeFromCwd: derives a safe scope key", () => {
  expect(projectScopeFromCwd("/home/user/My Project")).toBe("my-project");
});
