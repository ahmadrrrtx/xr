/**
 * XR 4.6 — Phase 6 · T8: invariants that must stay true FOREVER.
 *
 * Two constitutional guarantees are enforced here as executable checks
 * (Article VIII — one context store; Article VIII.5 — recall is measured):
 *
 *  1. ONE STORE. The context store is the single memory/knowledge store:
 *       • the retired `src/memory/` engine directory must never reappear;
 *       • the canonical context tables are created by exactly ONE module
 *         (`src/context/repository.ts`) — no competitor schema;
 *       • every `new ContextRepository(...)` in src binds to the workspace
 *         store (via adaptStoreForContext) or to a deliberately hermetic
 *         benchmark scratch db — never to a private raw `new Database(...)`.
 *     (The legacy `user_memory` table is retained by design, ADR-0006, and is
 *      ADAPTED into the context store — it is a table, not a second store.)
 *
 *  2. NO UNSOURCED RECALL NUMBERS (G9 drift check). Any percentage-level
 *     recall/precision/accuracy claim anywhere in src/, README.md or docs/
 *     must be traceable: the same file must anchor the number to the
 *     measuring harness (runRecallBenchmark / recall-benchmark script /
 *     measured-recall.json / benchmark fixtures) or to an external citation
 *     (a URL — published research, e.g. the MemoryAgentBench paper). A bare
 *     "our recall is N%" with no anchor fails this test.
 */
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Path comparisons must be separator-agnostic (win32 yields backslashes). */
const rel = (p: string): string => relative(ROOT, p).replaceAll("\\", "/");

function* walk(dir: string, exts: readonly string[]): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", "out"].includes(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, exts);
    else if (exts.some((e) => entry.endsWith(e))) yield full;
  }
}

describe("T8 — one context store, forever", () => {
  test("the retired src/memory/ engine directory never reappears", () => {
    expect(existsSync(join(ROOT, "src/memory"))).toBe(false);
  });

  test("the canonical context tables are created by exactly ONE module", () => {
    const creators: string[] = [];
    for (const file of walk(join(ROOT, "src"), [".ts"])) {
      const text = readFileSync(file, "utf8");
      // The canonical items table is const ITEMS = "context_items" and the
      // CREATE TABLE for it; both must be unique to the repository.
      if (/const\s+ITEMS\s*=\s*"context_items"/.test(text)) creators.push(rel(file));
      if (/CREATE TABLE[\s\S]{0,80}context_items/.test(text)) creators.push(rel(file));
    }
    expect([...new Set(creators)].sort()).toEqual(["src/context/repository.ts"]);
  });

  test("no ContextRepository is bound to a private raw Database connection", () => {
    for (const file of walk(join(ROOT, "src"), [".ts"])) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("new ContextRepository(")) continue;
      // A second, privately-connected store would need its own Database.
      expect({ file: rel(file), hasRawDb: /new Database\(/.test(text) }).toEqual({
        file: rel(file),
        hasRawDb: false,
      });
    }
  });
});

describe("T8 — recall numbers are measured or cited, never bare-asserted", () => {
  /** An anchor makes a numeric claim traceable (harness artifact or citation). */
  const ANCHORS = [
    /runRecallBenchmark/,
    /recall-benchmark/,
    /measured-recall/,
    /benchmarks\/recall/,
    /MemoryAgentBench/,
    /benchmarks\/poisoning-corpus/,
    /https?:\/\//, // external citation (e.g. published benchmark papers)
  ];
  const CLAIM =
    /\b(recall|precision|accuracy|retrieval quality|recall@?[15k]|r@[15])\b[^\n]{0,120}?\b\d{1,3}(\.\d+)?\s*%|\b\d{1,3}(\.\d+)?\s*%[^\n]{0,120}?\b(recall|precision|accuracy)\b/i;

  test("no percentage-level recall claim without a harness or citation anchor", () => {
    const offenders: string[] = [];
    const scanDirs = [join(ROOT, "src"), join(ROOT, "docs")];
    const files: string[] = [join(ROOT, "README.md")];
    for (const d of scanDirs) files.push(...walk(d, [".ts", ".md"]));
    for (const file of files) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      if (!CLAIM.test(text)) continue;
      const anchored = ANCHORS.some((a) => a.test(text));
      if (!anchored) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });
});
