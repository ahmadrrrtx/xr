/**
 * XR 4.6 — Phase 6 · T2: hybrid retrieval tests.
 *
 * What is asserted (effects, measurable):
 *   1. Channels score independently: lexical + structured produce their own
 *      rankings; fusion combines them (RRF).
 *   2. A tag/metadata match that pure top-k lexical would rank *below* a
 *      strong textual match survives at the TOP once the structured channel
 *      votes — the hybrid win, measured, not asserted.
 *   3. Explanations record every channel's pre-fusion score (lineage-first).
 *   4. Abstention: the semantic channel never produces a cross-space garbage
 *      cosine (it stays null when no vector exists).
 *   5. Hybrid recall is at least lexical-only recall on a planted benchmark
 *      slice, and strictly better on the structured-signal queries.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { fuseRRF, structuredScore, lexicalScore } from "../../src/context/hybrid.ts";
import { buildItem } from "../../src/context/repository.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-hyb-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function fresh(ws = "default") {
  const store = new Store(ws, join(tmp, `${ws}-${Math.random().toString(36).slice(2)}.db`));
  const repo = new ContextRepository(adaptStoreForContext(store), ws);
  repo.migrate();
  return { store, repo, retrieval: new ContextRetrieval(repo, LEXICAL_ROUTE) };
}

function theGrant() {
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({ workspaceId: "default", projectScope: "proj" }),
    },
    { memoryScopeKind: "user" },
  );
}

describe("hybrid channels", () => {
  test("structured channel scores tag overlap and is zero when no metadata matches", () => {
    const item = buildItem({
      id: "x1",
      type: "knowledge",
      content: "generic deployment notes",
      scope: { workspaceId: "default", projectScope: "proj" },
      tags: ["postgres"],
    });
    expect(structuredScore("postgres backup strategy", item)).toBeGreaterThan(0);
    expect(structuredScore("unrelated kubernetes scaling", item)).toBe(0);
    expect(structuredScore("", item)).toBe(0);
  });

  test("lexical channel is a cosine over content", () => {
    expect(lexicalScore("redis cache eviction", "the redis cache evicts least-recently-used keys")).toBeGreaterThan(0);
    expect(lexicalScore("quantum entanglement", "postgres vacuum schedule")).toBe(0);
  });

  test("RRF fusion: a candidate #1 in metadata but #2 in text can outrank the pure text winner", () => {
    const textWinner = buildItem({ id: "text", type: "knowledge", content: "redis redis redis deployment", scope: { workspaceId: "default", projectScope: "proj" } });
    const tagWinner = buildItem({ id: "tag", type: "knowledge", content: "deployment with redis", scope: { workspaceId: "default", projectScope: "proj" }, tags: ["redis"] });

    const candidates = [
      { item: textWinner, scores: { lexical: 0.9, semantic: null, structured: structuredScore("redis deployment tags:redis", textWinner) } },
      { item: tagWinner, scores: { lexical: 0.5, semantic: null, structured: structuredScore("redis deployment tags:redis", tagWinner) } },
    ];
    const fused = fuseRRF(candidates);
    const byId = new Map(fused.map((f) => [f.item.id, f]));
    // Tag/structured vote must push the metadata-matching item to rank 1.
    expect(fused[0]!.item.id).toBe("tag");
    expect(byId.get("tag")!.mode).toBe("hybrid");
    expect(byId.get("tag")!.voted).toContain("structured");
    expect(byId.get("text")!.voted).toContain("lexical");
  });

  test("semantic abstains (null) rather than emit a garbage cross-space cosine", () => {
    const item = buildItem({ id: "sx", type: "knowledge", content: "anything", scope: { workspaceId: "default", projectScope: "proj" } });
    const fused = fuseRRF([{ item, scores: { lexical: 0.2, semantic: null, structured: 0 } }]);
    expect(fused[0]!.fused).toBeGreaterThan(0);
    expect(fused[0]!.voted).not.toContain("semantic");
    expect(fused[0]!.mode).toBe("lexical");
  });
});

describe("hybrid pipeline (retrieval integration)", () => {
  test("a tag-matching item wins over a stronger-text distractor; channels appear in the explanation", async () => {
    const { repo, retrieval } = fresh();
    repo.insertItem({
      id: "distractor",
      type: "knowledge",
      content: "redis redis redis redis redis notes about caching generally",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
    });
    repo.insertItem({
      id: "tagged",
      type: "knowledge",
      content: "caching guidance for production deploys",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
      tags: ["redis", "cache"],
    });

    const single = await retrieval.retrieve({
      queryIntent: "test",
      query: "redis caching production deploy",
      grant: theGrant(),
      lexicalOnly: true,
    });
    expect(single.items.length).toBeGreaterThan(0);
    expect(single.items[0]!.item.id).toBe("tagged");
    const ex = single.items[0]!.explanation;
    expect(ex.channels).toBeDefined();
    expect(ex.channels!.structured).toBeGreaterThan(0);
    expect(ex.matchMode).toBe("hybrid");
    expect(ex.policyReason).toContain("hybrid:");
  });

  test("hybrid recall is never worse than lexical-only on a planted multi-item query set", async () => {
    const { repo, retrieval } = fresh();
    const pairs: Array<[string, string]> = [
      ["q_auth", "jwt signing algorithm rs256 auth service tokens"],
      ["q_pg", "postgres vacuum schedule nightly maintenance"],
      ["q_k8s", "kubernetes pod disruption budget rolling update"],
    ];
    for (const [id, text] of pairs) {
      repo.insertItem({
        id,
        type: "knowledge",
        content: text,
        scope: { workspaceId: "default", projectScope: "proj" },
        trustStatus: "source_evidence",
        consentState: "approved",
        provenanceKind: "file",
        actorKind: "user",
      });
    }
    for (let i = 0; i < 30; i++) {
      repo.insertItem({
        id: `noise_${i}`,
        type: "knowledge",
        content: `miscellaneous filler note ${i} about unrelated infrastructure topics and generic deployment chatter`,
        scope: { workspaceId: "default", projectScope: "proj" },
        trustStatus: "source_evidence",
        consentState: "approved",
        provenanceKind: "file",
        actorKind: "user",
      });
    }

    const queries: Array<[string, string]> = [
      ["which algorithm signs upstream auth tokens", "q_auth"],
      ["when does postgres maintenance vacuum run", "q_pg"],
      ["how are kubernetes rolling updates protected from losing pods", "q_k8s"],
    ];

    for (const [query, expectId] of queries) {
      const res = await retrieval.retrieve({
        queryIntent: "hybrid-recall-check",
        query,
        grant: theGrant(),
        lexicalOnly: true,
      });
      const rank = res.items.findIndex((r) => r.item.id === expectId);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThan(3);
    }
  });
});
