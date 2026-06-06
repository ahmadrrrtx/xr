/**
 * XR v0.9 Tier 3 — memory summarization tests.
 *
 * Deterministic, no model needed. Verifies the two-phase contract:
 *   • planSummarization() is READ-ONLY (changes nothing)
 *   • applySummarization() folds approved groups (adds summary, deletes folds)
 *   • exclusions are never folded
 *   • selection respects age + importance + minGroup thresholds
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { planSummarization, applySummarization } from "../src/memory/summarize.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-sum-"));
  process.env.XR_HOME = join(tmp, "home");
});

function freshMem(): { store: Store; mem: MemoryStore } {
  const store = new Store(join(tmp, `s-${Math.random().toString(36).slice(2)}.db`));
  return { store, mem: new MemoryStore(store) };
}

const DAY = 24 * 60 * 60 * 1000;

/** Add an entry, then back-date its updated_at to `ageDays` ago. */
function addAged(store: Store, mem: MemoryStore, content: string, opts: { category?: any; importance?: number; ageDays: number }) {
  const r = mem.add({ content, category: opts.category ?? "fact", importance: opts.importance ?? 1 });
  const id = r.entry!.id;
  const ts = Date.now() - opts.ageDays * DAY;
  // direct back-date for deterministic age (bypasses the facade on purpose)
  (store as any)["db"].query(`UPDATE user_memory SET updated_at=?, created_at=? WHERE id=?`).run(ts, ts, id);
  return id;
}

test("planSummarization is read-only and groups eligible entries", () => {
  const { store, mem } = freshMem();
  for (let i = 0; i < 4; i++) addAged(store, mem, `old note ${i}`, { category: "fact", importance: 1, ageDays: 60 });
  const before = mem.count();
  const plan = planSummarization(mem, { now: Date.now() });
  expect(mem.count()).toBe(before); // nothing changed
  expect(plan.totalSummaries).toBe(1);
  expect(plan.totalFolded).toBe(4);
  expect(plan.groups[0].category).toBe("fact");
  expect(plan.groups[0].summary).toContain("summary of 4");
  store.close();
});

test("recent or high-importance entries are NOT eligible", () => {
  const { store, mem } = freshMem();
  // 3 old + low → eligible
  for (let i = 0; i < 3; i++) addAged(store, mem, `old ${i}`, { importance: 1, ageDays: 60 });
  // recent (not old enough)
  addAged(store, mem, "recent", { importance: 1, ageDays: 1 });
  // old but important
  addAged(store, mem, "important", { importance: 5, ageDays: 60 });
  const plan = planSummarization(mem, { olderThanDays: 30, maxImportance: 2 });
  expect(plan.totalFolded).toBe(3); // only the 3 old+low
  store.close();
});

test("groups below minGroup are not folded", () => {
  const { store, mem } = freshMem();
  addAged(store, mem, "only one old note", { importance: 1, ageDays: 90 });
  const plan = planSummarization(mem, { minGroup: 3 });
  expect(plan.totalSummaries).toBe(0);
  store.close();
});

test("exclusions are never folded", () => {
  const { store, mem } = freshMem();
  for (let i = 0; i < 3; i++) addAged(store, mem, `secret thing ${i}`, { category: "exclusion", importance: 1, ageDays: 90 });
  const plan = planSummarization(mem);
  expect(plan.totalSummaries).toBe(0); // exclusions excluded by list()
  store.close();
});

test("applySummarization folds: adds summary, removes originals", () => {
  const { store, mem } = freshMem();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(addAged(store, mem, `pref ${i}`, { category: "preference", importance: 1, ageDays: 60 }));
  const plan = planSummarization(mem);
  const res = applySummarization(mem, plan);
  expect(res.created).toBe(1);
  expect(res.removed).toBe(4);
  // originals gone
  for (const id of ids) expect(mem.get(id)).toBeNull();
  // one summary entry remains, tagged "summary"
  const remaining = mem.list();
  expect(remaining.length).toBe(1);
  expect(remaining[0].tags).toContain("summary");
  expect(remaining[0].category).toBe("preference");
  store.close();
});

test("different categories fold into separate summaries", () => {
  const { store, mem } = freshMem();
  for (let i = 0; i < 3; i++) addAged(store, mem, `fact ${i}`, { category: "fact", importance: 1, ageDays: 60 });
  for (let i = 0; i < 3; i++) addAged(store, mem, `pref ${i}`, { category: "preference", importance: 1, ageDays: 60 });
  const plan = planSummarization(mem);
  expect(plan.totalSummaries).toBe(2);
  const res = applySummarization(mem, plan);
  expect(res.created).toBe(2);
  expect(res.removed).toBe(6);
  expect(mem.count()).toBe(2);
  store.close();
});

test("empty memory yields an empty plan", () => {
  const { store, mem } = freshMem();
  const plan = planSummarization(mem);
  expect(plan.totalSummaries).toBe(0);
  expect(plan.totalFolded).toBe(0);
  store.close();
});
