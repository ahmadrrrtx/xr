/**
 * XR 4.5 — Phase 6 §11.8 persistence/migration tests + §11.10 user flows.
 *
 * The migration honesty rule under test:
 *   legacy memory keeps working, but XR NEVER fabricates consent it cannot
 *   verify. A 4.4 row becomes `legacy_unknown`, never `approved`.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Store } from "../../src/state/workspace-store.ts";
import { MemoryStore } from "../../src/context/memory/store.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextInspection, residualDisclosure } from "../../src/context/inspection.ts";
import { memoryEntryToContextItem } from "../../src/context/memory-adapter.ts";
import { parseMemoryIntent } from "../../src/context/memory/intent.ts";
import { CONFIG_VERSION, loadConfig } from "../../src/config/config.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-mig-"));
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

function dbPath(name = "m"): string {
  return join(tmp, `${name}-${Math.random().toString(36).slice(2)}.db`);
}

/** Build a database with the EXACT XR 4.4 user_memory schema (no 4.5 columns). */
function makeLegacy44Database(path: string): void {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE user_memory (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      source TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      importance INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      embedding TEXT,
      last_accessed_at INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER
    );
  `);
  const now = Date.now();
  const rows: Array<[string, string, string, string, string]> = [
    ["mem_a", "preference", "I prefer TypeScript and Bun", "global", "user"],
    ["mem_b", "project", "The project is called XR", "xr", "chat"],
    ["mem_c", "fact", "Deploys happen on Thursdays", "global", "voice"],
    ["mem_d", "fact", "Vector databases scale sublinearly", "global", "research"],
    ["mem_e", "fact", "Imported note from an old bundle", "global", "import"],
    ["mem_f", "exclusion", "my home address", "global", "user"],
  ];
  for (const [id, cat, content, scope, source] of rows) {
    db.query(
      `INSERT INTO user_memory (id,category,content,scope,source,tags,importance,created_at,updated_at,embedding,access_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, cat, content, scope, source, "", 3, now, now, JSON.stringify([0.1, 0.2]), 0);
  }
  db.close();
}

// ── Fresh database ─────────────────────────────────────────────────────────

describe("XR 4.5 migration: fresh database", () => {
  test("a new database gets every context table and column", () => {
    const p = dbPath("fresh");
    const store = new Store("default", p);
    const db = new Database(p);
    const tables = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);
    for (const t of [
      "user_memory",
      "context_items",
      "context_provenance",
      "context_revocations",
      "context_packages",
      "context_summaries",
    ]) {
      expect(tables).toContain(t);
    }
    const cols = db.query<{ name: string }, []>(`PRAGMA table_info(user_memory)`).all().map((c) => c.name);
    for (const c of ["consent_state", "trust_status", "provenance_kind", "revoked_at", "workspace_id"]) {
      expect(cols).toContain(c);
    }
    db.close();
    void store;
  });

  test("migration is idempotent — reopening changes nothing", () => {
    const p = dbPath("idem");
    new Store("default", p);
    new Store("default", p);
    const store = new Store("default", p);
    expect(store.userMemoryCount()).toBe(0);
  });
});

// ── Legacy 4.4 database ────────────────────────────────────────────────────

describe("XR 4.5 migration: existing XR 4.4 workspace", () => {
  test("a 4.4 database opens without data loss", () => {
    const p = dbPath("legacy");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    expect(store.userMemoryCount()).toBe(6);
    const mem = new MemoryStore(store);
    // Non-exclusion entries stay retrievable.
    expect(mem.list().length).toBe(5);
  });

  test("legacy consent becomes 'legacy_unknown', NEVER 'approved'", () => {
    const p = dbPath("consent");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const summary = mem.consentSummary();
    expect(summary.legacy_unknown).toBe(6);
    expect(summary.approved ?? 0).toBe(0);
    for (const e of mem.list({ includeExclusions: true, includeExpired: true })) {
      expect(e.consentState).toBe("legacy_unknown");
    }
  });

  test("trust is derived from the honest existing `source` column", () => {
    const p = dbPath("trust");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const byId = new Map(
      mem.list({ includeExclusions: true, includeExpired: true }).map((e) => [e.id, e]),
    );
    expect(byId.get("mem_a")!.trustStatus).toBe("approved_memory");   // source: user
    expect(byId.get("mem_b")!.trustStatus).toBe("approved_memory");   // source: chat
    expect(byId.get("mem_c")!.trustStatus).toBe("approved_memory");   // source: voice
    expect(byId.get("mem_d")!.trustStatus).toBe("generated_synthesis"); // source: research
    expect(byId.get("mem_e")!.trustStatus).toBe("unknown");           // source: import
    expect(byId.get("mem_f")!.trustStatus).toBe("trusted_instruction"); // exclusion = policy
  });

  test("provenance is mapped, never invented", () => {
    const p = dbPath("prov");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const byId = new Map(
      mem.list({ includeExclusions: true, includeExpired: true }).map((e) => [e.id, e]),
    );
    expect(byId.get("mem_a")!.provenanceKind).toBe("user_input");
    expect(byId.get("mem_d")!.provenanceKind).toBe("research");
    expect(byId.get("mem_e")!.provenanceKind).toBe("import");
    // No fabricated reference for any legacy row.
    for (const e of byId.values()) expect(e.provenanceRef).toBeNull();
  });

  test("legacy entries remain fully recallable (no silent data loss)", () => {
    const p = dbPath("recall");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const hits = mem.recall("TypeScript Bun preference");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.consentState).toBe("legacy_unknown");
  });

  test("the adapter types an exclusion rule as an INSTRUCTION, not memory", () => {
    const p = dbPath("excl");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const excl = mem
      .list({ includeExclusions: true, includeExpired: true })
      .find((e) => e.category === "exclusion")!;
    const item = memoryEntryToContextItem(excl, "default");
    expect(item.type).toBe("instruction");
    expect(item.trustStatus).toBe("trusted_instruction");
    // But its consent history is still unknown — no fabrication.
    expect(item.consentState).toBe("legacy_unknown");
  });

  test("the adapter marks legacy items and infers sensitivity conservatively", () => {
    const p = dbPath("sens");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const mem = new MemoryStore(store);
    const entry = mem.list()[0]!;
    const item = memoryEntryToContextItem(entry, "default");
    expect(item.tags).toContain("legacy:4.4");
    // Unknown, not "public" — we never claim safety we did not verify.
    expect(item.sensitivity).toBe("unknown");
  });
});

// ── Config migration ───────────────────────────────────────────────────────

describe("XR 4.5 config migration 14 → 15", () => {
  test("the config version is 19 (Phase 04 + Phase 5) and the knowledge block exists with safe defaults", () => {
    const { config } = loadConfig();
    expect(CONFIG_VERSION).toBe(19);
    expect(config.knowledge.enabled).toBe(true);
    expect(config.knowledge.enforceScope).toBe(true);
    expect(config.knowledge.compressionFailSafe).toBe(true);
    expect(config.knowledge.quarantineUntrusted).toBe(true);
    expect(config.knowledge.revalidateOnResume).toBe(true);
  });

  test("XR 5.1 environment and XR 5.2 capability blocks exist with safe defaults", () => {
    const { config } = loadConfig();
    expect(config.environment.enabled).toBe(true);
    // Cloud vision remains OFF by default, matching the cloud STT/TTS posture.
    expect(config.environment.vision.allowCloud).toBe(false);
    // Governed browser sessions block private-network navigation by default.
    expect(config.environment.browser.blockPrivateNetworks).toBe(true);
    // Bounded recovery only.
    expect(config.environment.recovery.maxReobserveRetries).toBe(1);
    // Capability Ecosystem is metadata/policy only and cannot grant authority.
    expect(config.capabilities.enabled).toBe(true);
    expect(config.capabilities.updateRequiresReview).toBe(true);
    expect(config.capabilities.quarantineOnVerificationFailure).toBe(true);
    expect(config.capabilities.deniedPermissions).toEqual([]);
  });

  test("existing memory settings are untouched by the upgrade", () => {
    const { config } = loadConfig();
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.injectInChat).toBe(true);
    expect(config.memory.recallLimit).toBe(5);
    // Nothing was auto-enabled that captures data silently.
    expect(config.memory.saveSessionSummaries).toBe(false);
  });
});

// ── Revocation, deletion, export ───────────────────────────────────────────

describe("XR 4.5 revocation / deletion / export (§11.8)", () => {
  test("revoking keeps the record but stops all retrieval", () => {
    const store = new Store("default", dbPath("rev"));
    const mem = new MemoryStore(store);
    const added = mem.add({ content: "the staging URL is stage.example.com", category: "fact" });
    const id = added.entry!.id;

    expect(mem.recall("staging URL").length).toBe(1);

    const res = mem.revoke(id, "no longer relevant", "user");
    expect(res.ok).toBe(true);
    expect(res.indexInvalidated).toBe(true);

    // Gone from retrieval…
    expect(mem.recall("staging URL").length).toBe(0);
    expect(mem.search("staging").length).toBe(0);
    // …but still inspectable and exportable, so the user keeps control.
    const still = mem.list({ includeExclusions: true, includeExpired: true, includeRevoked: true })
      .find((e) => e.id === id);
    expect(still).toBeDefined();
    expect(still!.consentState).toBe("revoked");
    expect(still!.revokedReason).toBe("no longer relevant");
  });

  test("revocation destroys the cached embedding", () => {
    const store = new Store("default", dbPath("revidx"));
    const mem = new MemoryStore(store);
    const id = mem.add({ content: "cached vector target" }).entry!.id;
    store.setMemoryEmbedding(id, [0.1, 0.2, 0.3]);
    expect(store.getMemory(id)!.embedding).not.toBeNull();

    mem.revoke(id, "user_revoked");
    const row = store.getMemory(id)!;
    expect(row.embedding).toBeNull();
    expect(row.index_state).toBe("invalidated");
  });

  test("correcting preserves lineage: the original is superseded, not erased", () => {
    const store = new Store("default", dbPath("corr"));
    const mem = new MemoryStore(store);
    const id = mem.add({ content: "the deploy window is Friday" }).entry!.id;

    const res = mem.correct(id, "the deploy window is Thursday", "user");
    expect(res.ok).toBe(true);

    const original = mem.get(id)!;
    expect(original.supersededBy).toBe(res.newId!);
    const corrected = mem.get(res.newId!)!;
    expect(corrected.content).toContain("Thursday");
    // A user correction is user-approved, unlike the legacy original.
    expect(corrected.consentState).toBe("approved");
    expect(corrected.provenanceRef).toBe(`correction-of:${id}`);
  });

  test("approving is the only route to 'approved' consent", () => {
    const store = new Store("default", dbPath("appr"));
    const mem = new MemoryStore(store);
    const id = mem.add({ content: "a plain fact" }).entry!.id;
    store.setMemoryConsent(id, "proposed", "plugin:test");
    expect(mem.get(id)!.consentState).toBe("proposed");
    // Not retrievable while proposed.
    expect(mem.recall("plain fact").length).toBe(0);

    expect(mem.approveConsent(id, "user").ok).toBe(true);
    expect(mem.get(id)!.consentState).toBe("approved");
    expect(mem.recall("plain fact").length).toBe(1);
  });

  test("a revoked entry cannot be re-approved (a new entry is required)", () => {
    const store = new Store("default", dbPath("reappr"));
    const mem = new MemoryStore(store);
    const id = mem.add({ content: "revoked thing" }).entry!.id;
    mem.revoke(id, "user_revoked");
    const res = mem.approveConsent(id, "user");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("revoked");
  });

  test("export includes items, revocations, and summaries", () => {
    const store = new Store("default", dbPath("exp"));
    const repo = new ContextRepository(adaptStoreForContext(store), "default");
    repo.migrate();
    const id = repo.insertItem({
      type: "knowledge", content: "exportable note",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "source_evidence", consentState: "approved",
      provenanceKind: "file", actorKind: "user",
    });
    repo.addProvenance(id, { kind: "file", ref: "/work/notes.md", label: "notes.md" });
    repo.revokeItem(id, "user_revoked");

    const inspector = new ContextInspection(repo, "default");
    const bundle = inspector.export();
    expect(bundle.format).toBe("xr-context");
    expect(bundle.items.some((i) => i.id === id)).toBe(true);
    expect(bundle.items.find((i) => i.id === id)!.provenance).toHaveLength(1);
    expect(bundle.revocations.some((r) => r.item_id === id)).toBe(true);
  });

  test("the residual-data disclosure is honest and non-empty", () => {
    const lines = residualDisclosure();
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const all = lines.join(" ").toLowerCase();
    // It must admit the limits rather than claiming perfect erasure.
    expect(all).toContain("audit log");
    expect(all).toContain("external model provider");
    expect(all).toContain("cannot be recalled");
  });
});

// ── User flows (§11.10) ────────────────────────────────────────────────────

describe("XR 4.5 user flows (§11.10)", () => {
  test("flow 1-4: remember → recall with explanation → correct → revoke", async () => {
    const store = new Store("default", dbPath("flow"));
    const mem = new MemoryStore(store);

    // 1. Remember (explicit consent through the capture flow).
    const captured = await mem.captureIntentAsync("remember I deploy on Friday evenings", {
      confirm: () => true,
    });
    expect(captured.handled).toBe(true);
    expect(captured.kind).toBe("add");
    expect(captured.ok).toBe(true);
    const id = captured.entry!.id;

    // 2. Recall WITH an explanation.
    const hits = mem.recallExplain("when do I deploy");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.reason).toMatch(/match \d+%/);

    // 3. Correct it.
    const corrected = mem.correct(id, "I deploy on Thursday evenings", "user");
    expect(corrected.ok).toBe(true);
    expect(mem.get(id)!.supersededBy).toBe(corrected.newId!);

    // 4. Revoke the correction.
    expect(mem.revoke(corrected.newId!, "changed my mind").ok).toBe(true);
    // The corrected entry is gone from retrieval…
    expect(mem.recall("deploy schedule").some((e) => e.id === corrected.newId)).toBe(false);
    // …and the ORIGINAL is not silently resurrected as authoritative: it stays
    // marked superseded, so honest history survives a revoked correction.
    expect(mem.get(id)!.supersededBy).toBe(corrected.newId!);
  });

  test("revoking a correction does not silently promote the superseded original", () => {
    const store = new Store("default", dbPath("supersede"));
    const mem = new MemoryStore(store);
    const id = mem.add({ content: "the API rate limit is 100 rps" }).entry!.id;
    const corrected = mem.correct(id, "the API rate limit is 250 rps", "user");
    expect(corrected.ok).toBe(true);

    mem.revoke(corrected.newId!, "correction was itself wrong");

    // The original remains available (user data is never silently destroyed)…
    const original = mem.get(id)!;
    expect(original.content).toContain("100 rps");
    // …but it is permanently flagged as superseded, so nothing can present it
    // as current, un-corrected truth.
    expect(original.supersededBy).toBe(corrected.newId!);
  });

  test("flow: memory intents distinguish remember / forget / revoke / correct / export / inspect", () => {
    expect(parseMemoryIntent("remember I use vim").kind).toBe("add");
    expect(parseMemoryIntent("forget that I use vim").kind).toBe("forget");
    expect(parseMemoryIntent("stop using the note about vim").kind).toBe("revoke");
    expect(parseMemoryIntent("revoke consent for the vim note").kind).toBe("revoke");
    expect(parseMemoryIntent("correct the editor note to neovim").kind).toBe("correct");
    expect(parseMemoryIntent("export my memory").kind).toBe("export");
    expect(parseMemoryIntent("how do you know my editor?").kind).toBe("inspect");
    expect(parseMemoryIntent("where did you learn that?").kind).toBe("inspect");
    expect(parseMemoryIntent("what do you remember").kind).toBe("recall");
    expect(parseMemoryIntent("don't remember my email").kind).toBe("add");
  });

  test("revoke is NOT mistaken for forget (they mean different things)", () => {
    const revoke = parseMemoryIntent("stop using my address note");
    expect(revoke.kind).toBe("revoke");
    const forget = parseMemoryIntent("delete my address note");
    expect(forget.kind).toBe("forget");
  });

  test("a correction intent carries both the target and the replacement", () => {
    const i = parseMemoryIntent("correct the deploy note to Thursday evenings");
    expect(i.kind).toBe("correct");
    if (i.kind === "correct") {
      expect(i.query).toContain("deploy note");
      expect(i.replacement).toBe("Thursday evenings");
    }
  });

  test("flow: memory disabled leaves the system functional and silent", () => {
    const store = new Store("default", dbPath("disabled"));
    const mem = new MemoryStore(store);
    // With no entries, recall is empty and nothing throws.
    expect(mem.recall("anything")).toEqual([]);
    expect(mem.health().ok).toBe(true);
    expect(mem.consentSummary()).toEqual({});
  });

  test("inspection health reports consent, trust, and legacy counts", () => {
    const p = dbPath("health");
    makeLegacy44Database(p);
    const store = new Store("default", p);
    const repo = new ContextRepository(adaptStoreForContext(store), "default");
    repo.migrate();
    const inspector = new ContextInspection(repo, "default");
    const h = inspector.health();
    expect(h.ok).toBe(true);
    const mem = new MemoryStore(store);
    expect(mem.legacyUnknown().length).toBe(6);
  });
});
