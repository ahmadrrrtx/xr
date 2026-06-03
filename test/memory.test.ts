/**
 * XR — Block 4 tests: memory, RAG, fingerprint, compaction.
 * RAG tests use the deterministic lexical fallback (no Ollama needed).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { lexicalVector, cosine, sameSpace } from "../src/memory/embed.ts";
import { fingerprint, indexProject, retrieve } from "../src/memory/rag.ts";
import { compact, totalChars } from "../src/memory/compact.ts";
import type { Message } from "../src/core/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-mem-"));
  process.env.XR_HOME = join(tmp, "home");
});

// ---- embeddings ----
test("lexicalVector: similar text scores higher than dissimilar", () => {
  const a = lexicalVector("the cat sat on the mat");
  const b = lexicalVector("a cat sat on a mat");
  const c = lexicalVector("quantum chromodynamics field theory");
  expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
});

test("cosine of identical vectors is ~1", () => {
  const v = lexicalVector("hello world");
  expect(cosine(v, v)).toBeCloseTo(1, 5);
});

test("sameSpace detects dimension match", () => {
  expect(sameSpace([1, 2], [3, 4])).toBe(true);
  expect(sameSpace([1, 2], [3, 4, 5])).toBe(false);
});

// ---- fingerprint ----
test("fingerprint detects files and languages", () => {
  writeFileSync(join(tmp, "a.ts"), "export const x = 1;");
  writeFileSync(join(tmp, "b.py"), "x = 1");
  mkdirSync(join(tmp, "node_modules")); // must be skipped
  writeFileSync(join(tmp, "node_modules", "junk.js"), "ignore me");
  const fp = fingerprint(tmp);
  expect(fp.files).toBe(2); // node_modules skipped
  expect(fp.languages[".ts"]).toBe(1);
  expect(fp.languages[".py"]).toBe(1);
});

// ---- RAG index + retrieve (lexical fallback path) ----
test("index + retrieve finds the relevant file", async () => {
  writeFileSync(join(tmp, "auth.ts"), "function login(user, password) { return checkPassword(user, password); }");
  writeFileSync(join(tmp, "math.ts"), "function add(a, b) { return a + b; }");
  const store = new Store(join(tmp, "r.db"));
  const n = await indexProject(store, tmp, "proj");
  expect(n).toBeGreaterThanOrEqual(2);
  const results = await retrieve(store, "proj", "how does password login work", 2);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].path).toBe("auth.ts"); // most relevant
  store.close();
});

// ---- project memory ----
test("remember dedupes identical entries", () => {
  const store = new Store(join(tmp, "m.db"));
  store.remember("m1", "proj", "preference", "use camelCase");
  store.remember("m2", "proj", "preference", "use camelCase"); // dup
  expect(store.memoryCount("proj")).toBe(1);
  store.remember("m3", "proj", "fact", "uses Bun");
  expect(store.memoryCount("proj")).toBe(2);
  store.close();
});

test("recall filters by kind and forget removes", () => {
  const store = new Store(join(tmp, "m2.db"));
  store.remember("a", "proj", "fact", "fact one");
  store.remember("b", "proj", "preference", "pref one");
  expect(store.recall("proj", "fact").length).toBe(1);
  store.forget("a");
  expect(store.recall("proj", "fact").length).toBe(0);
  store.close();
});

// ---- compaction ----
test("compact leaves small contexts unchanged", () => {
  const msgs: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ];
  expect(compact(msgs)).toEqual(msgs);
});

test("compact folds old messages into a summary when over budget", () => {
  const big = "x".repeat(3000);
  const msgs: Message[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < 12; i++) msgs.push({ role: "user", content: big + i });
  const out = compact(msgs, { maxChars: 8000, keepRecent: 4 });
  // Must be smaller and contain a summary note.
  expect(out.length).toBeLessThan(msgs.length);
  expect(out.some((m) => m.content.includes("context summary"))).toBe(true);
  // Most recent messages preserved verbatim.
  expect(out[out.length - 1].content).toBe(big + "11");
});
