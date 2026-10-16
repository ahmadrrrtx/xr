/** A1 F03: persisted RAG chunks are re-authorized at retrieval time (not trusted from the index). */
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieve } from "../src/context/memory/rag.ts";
import type { Store } from "../src/state/workspace-store.ts";

test("F03 RAG retrieve: stale/secret/outside persisted chunks are not returned", async () => {
  const base = mkdtempSync(join(tmpdir(), "a1-rag-"));
  const root = join(base, "root");
  mkdirSync(root);
  writeFileSync(join(root, "ok.ts"), "password login handler");
  writeFileSync(join(root, ".env"), "SECRET_CANARY_RAG password");
  writeFileSync(join(base, "outside.ts"), "OUTSIDE_CANARY_RAG password");
  const rows = [
    { path: "ok.ts", text: "password login handler", embedding: null },
    { path: ".env", text: "SECRET_CANARY_RAG password", embedding: null },
    { path: "../outside.ts", text: "OUTSIDE_CANARY_RAG password", embedding: null },
    { path: "deleted.ts", text: "password stale chunk", embedding: null },
  ];
  const store = { allChunks: () => rows } as unknown as Store;
  const out = await retrieve(store, "proj", root, "password", 10);
  const paths = out.map((r) => r.path);
  expect(paths).toEqual(["ok.ts"]);
  expect(JSON.stringify(out)).not.toContain("CANARY");
});
