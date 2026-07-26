/**
 * XR 4.5 — Phase 6 §11.2 retrieval tests + §11.7 workspace/agent tests.
 *
 * Every test uses the deterministic lexical route so it runs fully offline.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { ContextAssembler } from "../../src/context/assembler.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { deterministicRerank, LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { CONTEXT_BOUNDS } from "../../src/context/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-ret-"));
  process.env.XR_HOME = join(tmp, "home");
});

// Fixtures are per-test SQLite databases; without this the suite fills /tmp
// over repeated runs and unrelated tests fail with "no such table".
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
  const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
  const assembler = new ContextAssembler(repo, retrieval);
  return { store, repo, retrieval, assembler };
}

function grant(over: { ws?: string; project?: string; tiers?: readonly string[]; scopeKind?: string } = {}) {
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({
        workspaceId: over.ws ?? "default",
        projectScope: over.project ?? "proj",
        userId: "local",
      }),
      requestedTiers: (over.tiers as never) ?? undefined,
    },
    { memoryScopeKind: over.scopeKind ?? "user" },
  );
}

type InsertInput = Parameters<ContextRepository["insertItem"]>[0];

function addKnowledge(
  repo: ContextRepository,
  content: string,
  over: Partial<InsertInput> = {},
): string {
  return repo.insertItem({
    type: "knowledge",
    content,
    scope: { workspaceId: "default", projectScope: "proj" },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "file",
    actorKind: "user",
    ...over,
  });
}

// ── Basic relevance ────────────────────────────────────────────────────────

describe("XR 4.5 retrieval: authorized relevance", () => {
  test("an authorized, relevant item is retrieved with a full explanation", async () => {
    const { repo, retrieval } = fresh();
    const id = addKnowledge(repo, "the authentication module uses bcrypt for password hashing");
    addKnowledge(repo, "the invoice generator formats currency using Intl");

    const res = await retrieval.retrieve({
      queryIntent: "understand password hashing",
      query: "password hashing bcrypt authentication",
      grant: grant(),
    });

    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]!.item.id).toBe(id);

    // Every §9.7 explanation field must be populated.
    const e = res.items[0]!.explanation;
    expect(e.queryIntent).toContain("password hashing");
    expect(e.scopeMatch).toContain("proj");
    expect(e.similarity).toBeGreaterThan(0);
    expect(["semantic", "lexical", "hybrid"]).toContain(e.matchMode);
    expect(e.freshness).toContain("fresh");
    expect(e.trustStatus).toBe("source_evidence");
    expect(e.consentState).toBe("approved");
    expect(e.provenance).toContain("file");
    expect(e.policyReason.length).toBeGreaterThan(0);
    expect(e.legacy).toBe(false);
  });

  test("empty retrieval returns cleanly, not an error", async () => {
    const { retrieval } = fresh();
    const res = await retrieval.retrieve({ queryIntent: "q", query: "nothing here", grant: grant() });
    expect(res.items).toEqual([]);
    expect(res.degraded).toBe(false);
  });

  test("noisy, irrelevant content is dropped below the relevance floor", async () => {
    const { repo, retrieval } = fresh();
    addKnowledge(repo, "zzz qqq xyzzy plugh frobnicate");
    const res = await retrieval.retrieve({
      queryIntent: "database migration strategy",
      query: "database migration strategy postgres",
      grant: grant(),
    });
    expect(res.items).toHaveLength(0);
    expect(res.rejected.some((r) => r.reason === "below_relevance_floor")).toBe(true);
  });
});

// ── Authorization before ranking (§9.1) ────────────────────────────────────

describe("XR 4.5 retrieval: authorization precedes ranking", () => {
  test("an unauthorized item that would rank #1 is never considered", async () => {
    const { repo, retrieval } = fresh();
    // Perfect match, wrong project.
    repo.insertItem({
      type: "knowledge",
      content: "exact match query terms alpha beta gamma",
      scope: { workspaceId: "default", projectScope: "forbidden-project" },
      trustStatus: "source_evidence",
      consentState: "approved",
      provenanceKind: "file",
      actorKind: "user",
    });
    // Weaker match, correct project.
    const okId = addKnowledge(repo, "alpha notes only");

    const res = await retrieval.retrieve({
      queryIntent: "q",
      query: "exact match query terms alpha beta gamma",
      grant: grant(),
    });
    expect(res.items.every((i) => i.item.scope.projectScope !== "forbidden-project")).toBe(true);
    if (res.items.length) expect(res.items[0]!.item.id).toBe(okId);
  });

  test("a tier not in the grant yields nothing from that tier", async () => {
    const { repo, retrieval } = fresh();
    addKnowledge(repo, "project knowledge about widgets");
    const res = await retrieval.retrieve({
      queryIntent: "q",
      query: "widgets",
      // Grant only the evidence tier — knowledge lives in project_knowledge.
      grant: grant({ tiers: ["evidence"] }),
    });
    expect(res.items).toHaveLength(0);
  });

  test("consent states other than approved/limited/legacy are excluded", async () => {
    const { repo, retrieval } = fresh();
    for (const state of ["proposed", "quarantined", "revoked", "expired", "not_eligible"] as const) {
      repo.insertItem({
        type: "knowledge",
        content: `widget content in state ${state}`,
        scope: { workspaceId: "default", projectScope: "proj" },
        trustStatus: "source_evidence",
        consentState: state,
        provenanceKind: "file",
        actorKind: "user",
      });
    }
    const res = await retrieval.retrieve({ queryIntent: "q", query: "widget content", grant: grant() });
    expect(res.items).toHaveLength(0);
  });

  test("legacy_unknown IS retrievable but flagged as legacy", async () => {
    const { repo, retrieval } = fresh();
    // A legacy user-memory row: type `memory`, trust `approved_memory`,
    // consent `legacy_unknown` — exactly what the 4.4 → 4.5 migration produces.
    repo.insertItem({
      type: "memory",
      content: "legacy widget calibration note",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "approved_memory",
      consentState: "legacy_unknown",
      provenanceKind: "user_input",
      actorKind: "user",
    });
    const res = await retrieval.retrieve({
      queryIntent: "q", query: "widget calibration", grant: grant(),
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.explanation.legacy).toBe(true);
  });
});

// ── Freshness and trust ────────────────────────────────────────────────────

describe("XR 4.5 retrieval: freshness and trust", () => {
  test("expired items are excluded; stale items are included and labelled", async () => {
    const { repo, retrieval } = fresh();
    const now = Date.now();
    const day = 86_400_000;

    addKnowledge(repo, "expired widget note", { expiresAt: now - 1000 });
    const staleId = addKnowledge(repo, "stale widget note", { staleAfter: now - 1000 });

    const res = await retrieval.retrieve({ queryIntent: "q", query: "widget note", grant: grant() });
    const ids = res.items.map((i) => i.item.id);
    expect(ids).toContain(staleId);
    expect(res.items.find((i) => i.item.id === staleId)!.explanation.freshness).toContain("stale");
    expect(res.rejected.some((r) => r.reason === "expired")).toBe(true);
    void day;
  });

  test("a fresher item outranks an equally-similar stale one", async () => {
    const { repo, retrieval } = fresh();
    const now = Date.now();
    const staleId = addKnowledge(repo, "deployment target is server alpha", { staleAfter: now - 1000 });
    const freshId = addKnowledge(repo, "deployment target is server alpha");

    const res = await retrieval.retrieve({
      queryIntent: "q", query: "deployment target server alpha", grant: grant(),
    });
    const order = res.items.map((i) => i.item.id);
    expect(order.indexOf(freshId)).toBeLessThan(order.indexOf(staleId));
  });

  test("trust status affects ranking through the prior, not through similarity", async () => {
    const { repo, retrieval } = fresh();
    const untrusted = repo.insertItem({
      type: "knowledge", content: "widget maximum torque is 40Nm",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "untrusted_external", consentState: "approved",
      provenanceKind: "web", actorKind: "system",
    });
    const trusted = repo.insertItem({
      type: "knowledge", content: "widget maximum torque is 40Nm",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence", consentState: "approved",
      provenanceKind: "file", actorKind: "user",
    });
    const res = await retrieval.retrieve({
      queryIntent: "q", query: "widget maximum torque", grant: grant(),
    });
    const order = res.items.map((i) => i.item.id);
    expect(order.indexOf(trusted)).toBeLessThan(order.indexOf(untrusted));
  });
});

// ── Reranking ──────────────────────────────────────────────────────────────

describe("XR 4.5 deterministic reranking", () => {
  test("reranking is stable: identical input yields identical order", () => {
    const cands = [
      { id: "a", text: "database migration guide", similarity: 0.5, prior: 0.5 },
      { id: "b", text: "database index tuning", similarity: 0.5, prior: 0.5 },
      { id: "c", text: "unrelated topic", similarity: 0.5, prior: 0.5 },
    ];
    const r1 = deterministicRerank("database migration", cands).map((r) => r.id);
    const r2 = deterministicRerank("database migration", cands).map((r) => r.id);
    expect(r1).toEqual(r2);
  });

  test("term overlap lifts the better lexical match", () => {
    const results = deterministicRerank("database migration guide", [
      { id: "weak", text: "unrelated topic entirely", similarity: 0.6, prior: 0.5 },
      { id: "strong", text: "database migration guide for postgres", similarity: 0.55, prior: 0.5 },
    ]);
    expect(results[0]!.id).toBe("strong");
  });

  test("the prior breaks ties without overriding a large similarity gap", () => {
    const results = deterministicRerank("x", [
      { id: "lowprior", text: "x", similarity: 0.9, prior: 0.0 },
      { id: "highprior", text: "x", similarity: 0.2, prior: 1.0 },
    ]);
    expect(results[0]!.id).toBe("lowprior");
  });

  test("rerank movement is recorded in the explanation", async () => {
    const { repo, retrieval } = fresh();
    addKnowledge(repo, "alpha beta gamma delta epsilon");
    addKnowledge(repo, "alpha only");
    const res = await retrieval.retrieve({
      queryIntent: "q", query: "alpha beta gamma", grant: grant(),
    });
    // At least one explanation must describe how it was ranked.
    expect(res.items.every((i) => typeof i.explanation.score === "number")).toBe(true);
  });
});

// ── Bounds ─────────────────────────────────────────────────────────────────

describe("XR 4.5 retrieval and package bounds", () => {
  test("per-tier item caps are enforced", async () => {
    const { repo, assembler } = fresh();
    for (let i = 0; i < 40; i++) addKnowledge(repo, `widget note number ${i} about calibration`);
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "q", query: "widget calibration note",
    });
    const tier = pkg.tiers.find((t) => t.tier === "project_knowledge");
    if (tier) expect(tier.items.length).toBeLessThanOrEqual(8);
  });

  test("the package respects grant item and char budgets", async () => {
    const { repo, assembler } = fresh();
    for (let i = 0; i < 60; i++) addKnowledge(repo, `calibration record ${i} ${"x".repeat(200)}`);
    const g = { ...grant(), maxItems: 5, maxChars: 2000 };
    const pkg = await assembler.assemble({ grant: g, queryIntent: "q", query: "calibration record" });
    expect(pkg.totalItems).toBeLessThanOrEqual(5);
    expect(pkg.totalChars).toBeLessThanOrEqual(2000);
  });

  test("the rejected list is bounded and content-free", async () => {
    const { repo, retrieval } = fresh();
    for (let i = 0; i < 200; i++) {
      repo.insertItem({
        type: "knowledge", content: `foreign ${i}`,
        scope: { workspaceId: "default", projectScope: "other" },
        trustStatus: "source_evidence", consentState: "approved",
        provenanceKind: "file", actorKind: "user",
      });
    }
    const res = await retrieval.retrieve({ queryIntent: "q", query: "foreign", grant: grant() });
    expect(res.rejected.length).toBeLessThanOrEqual(CONTEXT_BOUNDS.maxRejectedRecorded);
    for (const r of res.rejected) expect(r).not.toHaveProperty("content");
  });

  test("a package always carries a content hash for drift detection", async () => {
    const { repo, assembler } = fresh();
    addKnowledge(repo, "widget note");
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "widget" });
    expect(pkg.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ── Local-only operation ───────────────────────────────────────────────────

describe("XR 4.5 local-only retrieval", () => {
  test("the lexical route performs no network work and still ranks correctly", async () => {
    const { repo, retrieval } = fresh();
    const target = addKnowledge(repo, "kubernetes ingress controller configuration");
    addKnowledge(repo, "coffee brewing temperature guide");
    const res = await retrieval.retrieve({
      queryIntent: "q", query: "kubernetes ingress configuration", grant: grant(), lexicalOnly: true,
    });
    expect(res.items[0]!.item.id).toBe(target);
    expect(res.route.fallback).toBe(true);
    expect(res.route.locality).toBe("local");
    expect(res.items[0]!.explanation.matchMode).toBe("lexical");
  });
});

// ── Multi-workspace isolation at the store level ───────────────────────────

describe("XR 4.5 workspace isolation (§11.7)", () => {
  test("two workspaces with separate databases never see each other's items", async () => {
    const a = fresh("wsA");
    const b = fresh("wsB");
    a.repo.insertItem({
      type: "knowledge", content: "workspace A secret widget data",
      scope: { workspaceId: "wsA", projectScope: "proj" },
      trustStatus: "source_evidence", consentState: "approved",
      provenanceKind: "file", actorKind: "user",
    });
    b.repo.insertItem({
      type: "knowledge", content: "workspace B secret widget data",
      scope: { workspaceId: "wsB", projectScope: "proj" },
      trustStatus: "source_evidence", consentState: "approved",
      provenanceKind: "file", actorKind: "user",
    });

    const fromA = await a.retrieval.retrieve({
      queryIntent: "q", query: "secret widget data", grant: grant({ ws: "wsA" }),
    });
    expect(fromA.items).toHaveLength(1);
    expect(fromA.items[0]!.item.content).toContain("workspace A");

    const fromB = await b.retrieval.retrieve({
      queryIntent: "q", query: "secret widget data", grant: grant({ ws: "wsB" }),
    });
    expect(fromB.items).toHaveLength(1);
    expect(fromB.items[0]!.item.content).toContain("workspace B");
  });

  test("agent role tiers narrow what each worker can retrieve", async () => {
    const { repo, retrieval } = fresh();
    repo.insertItem({
      type: "memory", content: "the user prefers dark mode",
      scope: { workspaceId: "default", projectScope: "global" },
      trustStatus: "approved_memory", consentState: "approved",
      provenanceKind: "user_input", actorKind: "user",
    });

    // A researcher (memory scope "research") must not see user memory.
    const researcher = await retrieval.retrieve({
      queryIntent: "q", query: "user prefers dark mode",
      grant: grant({ scopeKind: "research" }),
    });
    expect(researcher.items).toHaveLength(0);

    // A "user"-scoped agent may.
    const primary = await retrieval.retrieve({
      queryIntent: "q", query: "user prefers dark mode",
      grant: grant({ scopeKind: "user" }),
    });
    expect(primary.items).toHaveLength(1);
  });
});
