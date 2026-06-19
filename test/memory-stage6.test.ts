/**
 * XR Stage 6 — Memory Engine tests.
 *
 * Covers the new subsystem: retention/expiry + pruning, access tracking,
 * explainable recall (scores + reasons), live capture ("remember this?"),
 * session summaries, health diagnostics, import-with-expiry, and the
 * config migration to v11. All deterministic — no model or Ollama needed.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { MemoryStore, projectScopeFromCwd } from "../src/memory/store.ts";
import {
  RECALL_FLOOR,
  clampImportance,
  isExpired,
  ttlToExpiresAt,
} from "../src/memory/types.ts";
import { loadConfig, isMemoryEnabled } from "../src/config/config.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-s6-"));
  process.env.XR_HOME = join(tmp, "home");
});

function fresh(): { store: Store; mem: MemoryStore } {
  const store = new Store(join(tmp, `s6-${Math.random().toString(36).slice(2)}.db`));
  return { store, mem: new MemoryStore(store) };
}

// ── TTL / expiry helpers ──────────────────────────────────────────────────────

test("ttlToExpiresAt: null when no ttl, absolute ms when set", () => {
  expect(ttlToExpiresAt(undefined, 1000)).toBe(null);
  expect(ttlToExpiresAt(null, 1000)).toBe(null);
  expect(ttlToExpiresAt(0, 1000)).toBe(null);
  expect(ttlToExpiresAt(-5, 1000)).toBe(null);
  expect(ttlToExpiresAt(3600_000, 1000)).toBe(1000 + 3600_000);
});

test("isExpired: respects expiresAt boundary", () => {
  expect(isExpired({ expiresAt: null })).toBe(false);
  expect(isExpired({ expiresAt: undefined })).toBe(false);
  expect(isExpired({ expiresAt: 1000 }, 500)).toBe(false);
  expect(isExpired({ expiresAt: 1000 }, 1000)).toBe(true);
  expect(isExpired({ expiresAt: 1000 }, 1500)).toBe(true);
});

test("add with --ttl: stores an expiresAt and it shows in the entry", () => {
  const { store, mem } = fresh();
  const res = mem.add({ content: "temporary note", category: "fact", ttlMs: 60_000 });
  expect(res.ok).toBe(true);
  expect(res.entry!.expiresAt).toBeGreaterThan(Date.now());
  store.close();
});

test("recall/list EXCLUDE expired entries (they are effectively forgotten)", () => {
  const { store, mem } = fresh();
  const a = mem.add({ content: "active fact about typescript", category: "fact" });
  // Insert an already-expired entry directly via the store to control time.
  store.insertMemory({
    id: "mem_expired1",
    category: "fact",
    content: "expired fact about typescript",
    scope: "global",
    source: "user",
    tags: "",
    importance: 3,
    expiresAt: Date.now() - 1000,
  });
  // list excludes it:
  const listed = mem.list().map((e) => e.id);
  expect(listed).toContain(a.entry!.id);
  expect(listed).not.toContain("mem_expired1");
  // recall excludes it:
  const hits = mem.recall("typescript");
  expect(hits.map((h) => h.id)).not.toContain("mem_expired1");
  // but includeExpired reveals it (for inspection):
  expect(mem.list({ includeExpired: true }).map((e) => e.id)).toContain("mem_expired1");
  store.close();
});

test("prune: permanently deletes expired entries, leaves the rest", () => {
  const { store, mem } = fresh();
  mem.add({ content: "keep me", category: "fact" });
  store.insertMemory({
    id: "mem_gone",
    category: "fact",
    content: "gone",
    scope: "global",
    source: "user",
    tags: "",
    importance: 3,
    expiresAt: Date.now() - 1,
  });
  expect(mem.health().expired).toBe(1);
  const n = mem.pruneExpired();
  expect(n).toBe(1);
  expect(mem.health().expired).toBe(0);
  expect(mem.count()).toBe(1);
  store.close();
});

// ── access tracking + explainable recall ─────────────────────────────────────

test("recall is explainable: returns scores + human reasons", () => {
  const { store, mem } = fresh();
  mem.add({ content: "I prefer TypeScript and Bun for backend work", category: "preference" });
  const hits = mem.recallExplain("what runtime do I use");
  expect(hits.length).toBeGreaterThan(0);
  const top = hits[0]!;
  expect(top.entry.content).toContain("TypeScript");
  expect(typeof top.sim).toBe("number");
  expect(top.sim).toBeGreaterThanOrEqual(RECALL_FLOOR);
  expect(typeof top.reason).toBe("string");
  expect(top.reason).toContain("lexical");
  expect(top.reason).toMatch(/\d+%/);
  store.close();
});

test("recall records access: lastAccessedAt + accessCount increase", () => {
  const { store, mem } = fresh();
  const a = mem.add({ content: "prefers vim keybindings for editors", category: "preference" });
  expect(a.entry!.accessCount).toBe(0);
  expect(a.entry!.lastAccessedAt).toBeNull();
  mem.recall("which editor keybindings");
  const after = mem.get(a.entry!.id)!;
  expect(after.accessCount).toBe(1);
  expect(after.lastAccessedAt).not.toBeNull();
  store.close();
});

// ── live capture ("remember this?") ──────────────────────────────────────────

test("captureIntent: 'remember …' with consent stores a preference", async () => {
  const { store, mem } = fresh();
  const out = await mem.captureIntentAsync("remember I prefer dark mode", {
    autoSuggest: true,
    confirm: async () => true,
  });
  expect(out.handled).toBe(true);
  expect(out.kind).toBe("add");
  expect(out.ok).toBe(true);
  expect(out.entry!.category).toBe("preference");
  store.close();
});

test("captureIntent: 'remember …' declined → nothing stored", async () => {
  const { store, mem } = fresh();
  const out = await mem.captureIntentAsync("remember my favourite colour is blue", {
    autoSuggest: true,
    confirm: async () => false,
  });
  expect(out.handled).toBe(true);
  expect(out.ok).toBe(false);
  expect(out.declined).toBe(true);
  expect(mem.count()).toBe(0);
  store.close();
});

test("captureIntent: 'don't remember …' → exclusion stored WITHOUT prompting", async () => {
  const { store, mem } = fresh();
  let prompted = false;
  const out = await mem.captureIntentAsync("don't remember my email address", {
    autoSuggest: true,
    confirm: async () => { prompted = true; return true; },
  });
  expect(out.kind).toBe("exclusion");
  expect(out.ok).toBe(true);
  expect(prompted).toBe(false); // reducing stored data never asks
  store.close();
});

test("captureIntent: 'what do you remember' → recall (read-only)", async () => {
  const { store, mem } = fresh();
  // Use vocabulary that lexically overlaps the recall query (recall is
  // conservative: only surfaces entries above the relevance floor).
  mem.add({ content: "preferences: I prefer bun as the runtime", category: "preference" });
  const out = await mem.captureIntentAsync("what do you remember about my preferences?");
  expect(out.kind).toBe("recall");
  expect((out.entries ?? []).length).toBeGreaterThan(0);
  store.close();
});

test("captureIntent: 'forget …' → removes matching entries", async () => {
  const { store, mem } = fresh();
  mem.add({ content: "note about vim usage", category: "fact" });
  const out = await mem.captureIntentAsync("forget the note about vim");
  expect(out.kind).toBe("forget");
  expect((out.removed ?? 0)).toBe(1);
  expect(mem.count()).toBe(0);
  store.close();
});

test("captureIntent: plain text → not handled", () => {
  const { store, mem } = fresh();
  expect(mem.captureIntent("what is the capital of France").handled).toBe(false);
  store.close();
});

// ── session summaries ─────────────────────────────────────────────────────────

test("saveSessionSummary: folds a long-enough conversation, skips short ones", () => {
  const { store, mem } = fresh();
  const short = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ] as any;
  expect(mem.saveSessionSummary("global", short)).toBe(null);

  const long = [
    { role: "user", content: "help me with typescript" },
    { role: "assistant", content: "sure, what do you need" },
    { role: "user", content: "how do I type a function" },
    { role: "assistant", content: "you can use the function keyword with types" },
    { role: "user", content: "thanks" },
    { role: "assistant", content: "anytime" },
  ] as any;
  const id = mem.saveSessionSummary("global", long);
  expect(id).toBeTruthy();
  // Summaries are kept separate from long-term memory (not in user_memory).
  const stats = mem.stats().map((s) => s.category);
  expect(stats).not.toContain("summary");
  store.close();
});

// ── health ────────────────────────────────────────────────────────────────────

test("health: reports total, expired, neverAccessed, byCategory", () => {
  const { store, mem } = fresh();
  mem.add({ content: "pref a", category: "preference" });
  mem.add({ content: "fact b", category: "fact" });
  store.insertMemory({
    id: "mem_hexp",
    category: "fact",
    content: "expired",
    scope: "global",
    source: "user",
    tags: "",
    importance: 3,
    expiresAt: Date.now() - 1,
  });
  const h = mem.health();
  expect(h.ok).toBe(true);
  expect(h.total).toBe(3);
  expect(h.expired).toBe(1);
  expect(h.neverAccessed).toBe(3); // none recalled yet (exclusion excluded)
  expect(h.byCategory.length).toBeGreaterThan(0);
  store.close();
});

// ── import with expiry ────────────────────────────────────────────────────────

test("import: drops already-expired entries (no silent resurrection)", () => {
  const { store, mem } = fresh();
  const bundle = {
    format: "xr-memory",
    version: 1,
    exportedAt: Date.now(),
    entries: [
      { id: "x1", category: "fact", content: "fresh import", scope: "global", source: "user", tags: [], importance: 3, createdAt: 0, updatedAt: 0 },
      { id: "x2", category: "fact", content: "stale import", scope: "global", source: "user", tags: [], importance: 3, createdAt: 0, updatedAt: 0, expiresAt: Date.now() - 1000 },
    ],
  };
  const r = mem.import(bundle);
  expect(r.added).toBe(1);
  expect(r.skipped).toBe(1);
  store.close();
});

// ── config migration + memory toggle ──────────────────────────────────────────

test("config migrates to v11 and carries the new memory fields", () => {
  const { config } = loadConfig();
  expect(config.version).toBe(11);
  expect(config.memory).toBeDefined();
  expect(typeof config.memory.autoExpireDays).toBe("number");
  expect(typeof config.memory.saveSessionSummaries).toBe("boolean");
  expect(typeof config.memory.sessionSummaryMinTurns).toBe("number");
});

test("XR_MEMORY_DISABLED=1 forces memory off regardless of config", () => {
  process.env.XR_MEMORY_DISABLED = "1";
  expect(isMemoryEnabled()).toBe(false);
  delete process.env.XR_MEMORY_DISABLED;
  expect(isMemoryEnabled()).toBe(true);
});

// ── backward compat ───────────────────────────────────────────────────────────

test("clampImportance still clamps to 1..5", () => {
  expect(clampImportance(0)).toBe(1);
  expect(clampImportance(3)).toBe(3);
  expect(clampImportance(9)).toBe(5);
  expect(clampImportance("not a number")).toBe(3);
});

test("projectScopeFromCwd still derives a safe scope key", () => {
  expect(projectScopeFromCwd("/home/user/My Project")).toBe("my-project");
});
