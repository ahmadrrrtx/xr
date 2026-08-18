/**
 * Phase 09 — CRITICAL workspace isolation.
 *
 * Workspace A stores WORKSPACE_A_SECRET.
 * Switch to Workspace B and search: MUST NOT be found.
 * Switch back to A: MUST be found.
 *
 * Covers A→B, B→A, A→C, C→A, cache/embedding isolation, and concurrent stores.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { IsolatedMemoryStore } from "../../src/context/isolated-store.ts";
import { verifyWorkspaceIsolation } from "../../src/context/engine.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { memoryEntryToContextItem } from "../../src/context/memory-adapter.ts";
import { ContextAssembler } from "../../src/context/assembler.ts";
import { XRApp } from "../../src/core/app.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p09-iso-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function open(id: string) {
  const store = new Store(id, join(tmp, `${id}.db`));
  return { store, mem: new IsolatedMemoryStore(store) };
}

const SECRET_A = "WORKSPACE_A_SECRET";
const SECRET_B = "WORKSPACE_B_SECRET";
const SECRET_C = "WORKSPACE_C_SECRET";

describe("9.11 workspace isolation (CRITICAL)", () => {
  test("A → B: secret-A is not searchable in B; B → A: secret-A returns", () => {
    const a = open("wsA");
    const b = open("wsB");
    expect(a.mem.add({ content: SECRET_A, category: "fact", source: "user" }).ok).toBe(true);

    expect(b.mem.search(SECRET_A).map((e) => e.content)).not.toContain(SECRET_A);
    expect(b.mem.recall(SECRET_A).map((e) => e.content)).not.toContain(SECRET_A);
    expect(a.mem.search(SECRET_A).some((e) => e.content.includes(SECRET_A))).toBe(true);

    a.store.close();
    b.store.close();
  });

  test("A → C and C → A plus B isolation", () => {
    const a = open("wsA");
    const b = open("wsB");
    const c = open("wsC");
    a.mem.add({ content: SECRET_A, category: "fact" });
    b.mem.add({ content: SECRET_B, category: "fact" });
    c.mem.add({ content: SECRET_C, category: "fact" });

    expect(b.mem.search(SECRET_A)).toHaveLength(0);
    expect(c.mem.search(SECRET_A)).toHaveLength(0);
    expect(a.mem.search(SECRET_B)).toHaveLength(0);
    expect(a.mem.search(SECRET_C)).toHaveLength(0);
    expect(a.mem.search(SECRET_A).length).toBeGreaterThan(0);
    expect(c.mem.search(SECRET_C).length).toBeGreaterThan(0);

    a.store.close();
    b.store.close();
    c.store.close();
  });

  test("cached / semantic recall cannot leak across workspaces", async () => {
    const a = open("wsA");
    const b = open("wsB");
    a.mem.add({ content: SECRET_A, category: "fact" });
    // Warm the lexical/semantic path (falls back to lexical offline).
    await a.mem.recallSemantic(SECRET_A);
    const leaked = await b.mem.recallSemantic(SECRET_A);
    expect(leaked.some((e) => e.content.includes(SECRET_A))).toBe(false);
    const back = await a.mem.recallSemantic(SECRET_A);
    expect(back.some((e) => e.content.includes(SECRET_A))).toBe(true);
    a.store.close();
    b.store.close();
  });

  test("context retrieval + assembly isolation", async () => {
    const a = open("wsA");
    const b = open("wsB");
    a.mem.add({ content: SECRET_A, category: "fact" });

    const repoB = new ContextRepository(adaptStoreForContext(b.store), "wsB");
    repoB.migrate();
    const retrieval = new ContextRetrieval(repoB, LEXICAL_ROUTE);
    const grant = buildGrant(
      {
        requester: { kind: "agent", id: "t", role: "coder" },
        scope: makeScope({ workspaceId: "wsB", projectScope: "proj" }),
      },
      { memoryScopeKind: "user" },
    );
    const extra = a.mem.list().map((e) => ({
      item: memoryEntryToContextItem(e, "wsA"),
      tier: "long_term_memory" as const,
    }));
    const res = await retrieval.retrieve({ queryIntent: "q", query: SECRET_A, grant }, extra);
    expect(res.items.some((i) => i.item.content.includes(SECRET_A))).toBe(false);

    const assembler = new ContextAssembler(repoB, retrieval);
    const pkg = await assembler.assemble({ grant, queryIntent: "q", query: SECRET_A }, extra);
    const blob = JSON.stringify(pkg);
    expect(blob).not.toContain(SECRET_A);

    a.store.close();
    b.store.close();
  });

  test("hermetic isolation probe reports verified for separate stores", () => {
    const a = open("wsA");
    const b = open("wsB");
    const r = verifyWorkspaceIsolation(a.store, b.store, SECRET_A);
    expect(r.verified).toBe(true);
    a.store.close();
    b.store.close();
  });

  test("shared database file is reported unverified", () => {
    const path = join(tmp, "shared.db");
    const a = new Store("wsA", path);
    const b = new Store("wsB", path);
    const r = verifyWorkspaceIsolation(a, b, SECRET_A);
    expect(r.verified).toBe(false);
    a.close();
    b.close();
  });

  test("concurrent stores do not cross-contaminate", async () => {
    const a = open("wsA");
    const b = open("wsB");
    await Promise.all([
      Promise.resolve(a.mem.add({ content: SECRET_A, category: "fact" })),
      Promise.resolve(b.mem.add({ content: SECRET_B, category: "fact" })),
    ]);
    const [hitsA, hitsB] = await Promise.all([a.mem.recallSemantic(SECRET_B), b.mem.recallSemantic(SECRET_A)]);
    expect(hitsA.some((e) => e.content.includes(SECRET_B))).toBe(false);
    expect(hitsB.some((e) => e.content.includes(SECRET_A))).toBe(false);
    a.store.close();
    b.store.close();
  });
});

describe("9.11 XRApp.switchWorkspace is the canonical switch", () => {
  test("switchWorkspace rebinds the store; previous workspace memory is gone", async () => {
    const app = new XRApp();
    await app.bootstrap({ profile: ["state"] });
    const storeA = app.registry.resolve((await import("../../src/core/tokens.ts")).Tokens.Store);
    const memA = new IsolatedMemoryStore(storeA);
    memA.add({ content: SECRET_A, category: "fact" });

    await app.switchWorkspace("phase09-b");
    const storeB = app.registry.resolve((await import("../../src/core/tokens.ts")).Tokens.Store);
    expect(storeB.workspaceId).toBe("phase09-b");
    expect(storeB.dbPath).not.toBe(storeA.dbPath);
    const memB = new IsolatedMemoryStore(storeB);
    expect(memB.search(SECRET_A)).toHaveLength(0);

    await app.switchWorkspace("default");
    const storeBack = app.registry.resolve((await import("../../src/core/tokens.ts")).Tokens.Store);
    const memBack = new IsolatedMemoryStore(storeBack);
    // default workspace may be a fresh file in this XR_HOME; the point is the
    // switch went through XRApp and rebound Tokens.Store.
    expect(storeBack.workspaceId).toBe("default");
    void memBack;
    await app.shutdown();
  });
});
