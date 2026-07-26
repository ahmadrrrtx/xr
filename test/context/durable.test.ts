/**
 * XR 4.5 — Phase 6 §11.5 durable integration + §11.6 intelligence-plane tests.
 *
 * The governing rule: a resumed task must NEVER silently use revoked context.
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
import { LEXICAL_ROUTE, routeModelClass, deterministicRerank } from "../../src/context/embedding.ts";
import { CONTEXT_SCHEMA_VERSION } from "../../src/context/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-dur-"));
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

function grant(ws = "default") {
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({ workspaceId: ws, projectScope: "proj", userId: "local" }),
    },
    { memoryScopeKind: "user" },
  );
}

function add(repo: ContextRepository, content: string, ws = "default"): string {
  return repo.insertItem({
    type: "knowledge",
    content,
    scope: { workspaceId: ws, projectScope: "proj" },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "file",
    actorKind: "user",
  });
}

// ── Package identity and checkpointing ─────────────────────────────────────

describe("XR 4.5 context package durability (§8.4)", () => {
  test("a package persists with identity, version, and content hash", async () => {
    const { repo, assembler } = fresh();
    add(repo, "widget calibration procedure v2");
    const pkg = await assembler.assemble({
      grant: grant(),
      queryIntent: "calibrate widget",
      query: "widget calibration",
      runId: "run_abc",
    });

    expect(pkg.packageId).toMatch(/^pkg_/);
    expect(pkg.version).toBe(1);
    expect(pkg.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(pkg.contentHash).toMatch(/^[0-9a-f]{8}$/);

    const stored = repo.getPackage(pkg.packageId);
    expect(stored).not.toBeNull();
    expect(stored!.row.run_id).toBe("run_abc");
    expect(stored!.row.content_hash).toBe(pkg.contentHash);
  });

  test("the stored package holds IDS and metadata, never item bodies", async () => {
    const { repo, assembler } = fresh();
    add(repo, "SENSITIVE_BODY_CANARY inside the item content");
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "q", query: "SENSITIVE_BODY_CANARY", runId: "run_1",
    });
    const stored = repo.getPackage(pkg.packageId)!;
    // Bounded payload: the body must not be duplicated into the package row.
    expect(stored.row.package_json).not.toContain("SENSITIVE_BODY_CANARY");
    expect(JSON.stringify(stored.slim)).toContain("itemIds");
  });

  test("packages are retrievable by run for resume", async () => {
    const { repo, assembler } = fresh();
    add(repo, "note one");
    await assembler.assemble({ grant: grant(), queryIntent: "q", query: "note", runId: "run_x" });
    const found = repo.getPackagesForRun("run_x");
    expect(found.length).toBe(1);
  });
});

// ── Revalidation on resume ─────────────────────────────────────────────────

describe("XR 4.5 resume revalidation (§8.4, §11.5)", () => {
  test("an unchanged package revalidates cleanly", async () => {
    const { repo, assembler } = fresh();
    add(repo, "deployment runbook step one");
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "deploy", query: "deployment runbook",
    });
    expect(pkg.totalItems).toBeGreaterThan(0);

    const revalidated = assembler.revalidate(pkg);
    expect(revalidated.revalidation!.stillValid).toBe(true);
    expect(revalidated.revalidation!.droppedItemIds).toEqual([]);
    expect(revalidated.totalItems).toBe(pkg.totalItems);
    expect(revalidated.version).toBe(pkg.version + 1);
  });

  test("REVOKED context is dropped on resume, never silently reused", async () => {
    const { repo, assembler } = fresh();
    const id = add(repo, "deployment runbook step one");
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "deploy", query: "deployment runbook",
    });
    expect(pkg.tiers.flatMap((t) => t.items.map((i) => i.item.id))).toContain(id);

    // The user revokes consent between checkpoint and resume.
    repo.revokeItem(id, "user_revoked", { actor: "user" });

    const resumed = assembler.revalidate(pkg);
    expect(resumed.revalidation!.stillValid).toBe(false);
    expect(resumed.revalidation!.droppedItemIds).toContain(id);
    expect(resumed.revalidation!.reasons).toContain("revoked");
    // And the item is genuinely gone from the resumed package.
    expect(resumed.tiers.flatMap((t) => t.items.map((i) => i.item.id))).not.toContain(id);
    // The degradation is stated, not hidden.
    expect(resumed.degraded).toBe(true);
    expect(resumed.degradedReasons.join(" ")).toContain("removed on resume");
  });

  test("a DELETED source is dropped on resume", async () => {
    const { repo, assembler } = fresh();
    const id = add(repo, "temporary calibration note");
    const pkg = await assembler.assemble({
      grant: grant(), queryIntent: "q", query: "calibration note",
    });
    repo.deleteItem(id, { actor: "user" });

    const resumed = assembler.revalidate(pkg);
    expect(resumed.revalidation!.droppedItemIds).toContain(id);
    expect(resumed.tiers.flatMap((t) => t.items.map((i) => i.item.id))).not.toContain(id);
  });

  test("consent withdrawal (without revocation) also drops the item", async () => {
    const { repo, assembler } = fresh();
    const id = add(repo, "widget torque specification");
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "widget torque" });

    repo.setConsent(id, "proposed", { actor: "user" });
    const resumed = assembler.revalidate(pkg);
    expect(resumed.revalidation!.droppedItemIds).toContain(id);
    expect(resumed.revalidation!.reasons).toContain("consent_not_granted");
  });

  test("content drift is detected and the newer version is used", async () => {
    const { repo, assembler } = fresh();
    const id = add(repo, "the retry limit is 3");
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "retry limit" });
    const originalVersion = pkg.tiers[0]!.items[0]!.item.version;

    repo.updateItemContent(id, "the retry limit is 5");
    const resumed = assembler.revalidate(pkg);

    const item = resumed.tiers.flatMap((t) => t.items).find((i) => i.item.id === id)!;
    expect(item.item.content).toContain("5");
    expect(item.item.version).toBeGreaterThan(originalVersion);
    expect(item.explanation.policyReason).toContain("content changed");
  });

  test("the content hash changes when membership changes", async () => {
    const { repo, assembler } = fresh();
    const id = add(repo, "alpha note");
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "alpha note" });
    repo.revokeItem(id, "revoked");
    const resumed = assembler.revalidate(pkg);
    expect(resumed.contentHash).not.toBe(pkg.contentHash);
  });

  test("a grant expiring between checkpoint and resume drops everything", async () => {
    const { repo, assembler } = fresh();
    add(repo, "alpha note");
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "alpha note" });
    const expired = { ...pkg, grant: { ...pkg.grant, expiresAt: Date.now() - 1 } };
    const resumed = assembler.revalidate(expired);
    expect(resumed.totalItems).toBe(0);
    expect(resumed.revalidation!.stillValid).toBe(false);
  });
});

// ── Degradation is stated, not silent ──────────────────────────────────────

describe("XR 4.5 retrieval failure is represented safely", () => {
  test("a repository failure degrades the package with a stated reason", async () => {
    const { repo, assembler } = fresh();
    // Break candidate listing to simulate a storage failure mid-run.
    const broken = Object.create(repo) as ContextRepository;
    (broken as unknown as { listCandidates: () => never }).listCandidates = () => {
      throw new Error("database is locked");
    };
    const retrieval = new ContextRetrieval(broken, LEXICAL_ROUTE);
    const failingAssembler = new ContextAssembler(broken, retrieval);

    const pkg = await failingAssembler.assemble({
      grant: grant(), queryIntent: "q", query: "anything",
    });
    expect(pkg.degraded).toBe(true);
    expect(pkg.degradedReasons.join(" ")).toContain("database is locked");
    // Degraded means fewer items, never wrong items.
    expect(pkg.totalItems).toBe(0);
    void assembler;
  });

  test("a package that cannot be persisted still returns to the caller", async () => {
    const { repo, assembler } = fresh();
    add(repo, "note");
    (repo as unknown as { savePackage: () => never }).savePackage = () => {
      throw new Error("disk full");
    };
    const pkg = await assembler.assemble({ grant: grant(), queryIntent: "q", query: "note" });
    expect(pkg.packageId).toBeTruthy();
  });
});

// ── Intelligence plane integration (§11.6) ─────────────────────────────────

describe("XR 4.5 intelligence-plane integration (§8.3)", () => {
  test("with no registry, routing degrades to the deterministic lexical route", () => {
    const route = routeModelClass(undefined, "embeddings");
    expect(route.fallback).toBe(true);
    expect(route.model).toBe("lexical");
    expect(route.locality).toBe("local");
    expect(route.reason).toContain("no service registry");
  });

  test("with no intelligence service registered, it degrades cleanly", () => {
    const stubRegistry = { tryResolve: () => undefined } as never;
    const route = routeModelClass(stubRegistry, "embeddings");
    expect(route.fallback).toBe(true);
    expect(route.reason).toContain("not registered");
  });

  test("an unavailable routing decision does NOT silently escalate to cloud", () => {
    const stubRegistry = {
      tryResolve: () => ({
        route: () => ({
          decision: {
            unavailable: true,
            selected: undefined,
            explanation: "no local embedding model and cloud fallback is disabled",
            decisionId: "d1",
          },
        }),
      }),
    } as never;
    const route = routeModelClass(stubRegistry, "embeddings", { localOnly: true });
    expect(route.fallback).toBe(true);
    expect(route.locality).toBe("local");
    expect(route.reason).toContain("cloud fallback is disabled");
  });

  test("a successful route reports the selected provider/model and locality", () => {
    const stubRegistry = {
      tryResolve: () => ({
        route: () => ({
          decision: {
            unavailable: false,
            selected: { providerId: "ollama", modelId: "nomic-embed-text" },
            explanation: "local model preferred by policy",
            decisionId: "d2",
          },
        }),
        getModel: () => ({ locality: { locality: "local" } }),
      }),
    } as never;
    const route = routeModelClass(stubRegistry, "embeddings");
    expect(route.fallback).toBe(false);
    expect(route.providerId).toBe("ollama");
    expect(route.modelId).toBe("nomic-embed-text");
    expect(route.locality).toBe("local");
    expect(route.decisionId).toBe("d2");
  });

  test("a throwing intelligence service never breaks retrieval", () => {
    const stubRegistry = {
      tryResolve: () => ({
        route: () => {
          throw new Error("router exploded");
        },
      }),
    } as never;
    const route = routeModelClass(stubRegistry, "embeddings");
    expect(route.fallback).toBe(true);
    expect(route.reason).toContain("deterministic fallback");
  });

  test("reranking is requested through the same plane, not a second router", () => {
    // The reranker uses the identical entry point with a different model class,
    // proving there is exactly one selection path.
    const route = routeModelClass(undefined, "reranking");
    expect(route.fallback).toBe(true);
    // And the deterministic reranker is always available as the floor.
    const ranked = deterministicRerank("alpha", [
      { id: "a", text: "alpha match", similarity: 0.8, prior: 0.5 },
      { id: "b", text: "no match", similarity: 0.2, prior: 0.5 },
    ]);
    expect(ranked[0]!.id).toBe("a");
  });

  test("an embedding space mismatch falls back to lexical for that pair", async () => {
    const { repo, retrieval } = fresh();
    const id = add(repo, "vector space mismatch check for widgets");
    // Cache a vector recorded under a DIFFERENT model than the active route.
    repo.setEmbedding(id, [0.1, 0.2, 0.3], "some-other-model:v1", 3);

    const res = await retrieval.retrieve({
      queryIntent: "q", query: "vector space mismatch widgets", grant: grant(),
    });
    expect(res.items).toHaveLength(1);
    // Scored lexically rather than with a meaningless cross-space cosine.
    expect(res.items[0]!.explanation.matchMode).toBe("lexical");
  });

  test("invalidating the index clears cached vectors workspace-wide", () => {
    const { repo } = fresh();
    const a = add(repo, "one");
    const b = add(repo, "two");
    repo.setEmbedding(a, [1, 2, 3], "m", 3);
    repo.setEmbedding(b, [4, 5, 6], "m", 3);
    const n = repo.invalidateIndex("default");
    expect(n).toBe(2);
    expect(repo.getEmbedding(a)).toBeNull();
    expect(repo.getEmbedding(b)).toBeNull();
  });
});
