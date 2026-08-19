/**
 * XR Phase 1 — Reversible migrations (T12).
 *
 * The workspace store's schema has a stable **baseline** (version 0): the
 * idempotent `CREATE TABLE IF NOT EXISTS` set in `WorkspaceStore.migrate()`.
 * Incremental schema changes are registered here as numbered, reversible
 * migrations, each with `up()` and `down()`, recorded in `schema_migrations`.
 *
 * Guarantees (Constitution Art. XXIII):
 *   - Every migration is reversible; `runMigrationsDown(target)` restores the
 *     exact previous structure.
 *   - Forward + backward round-trips are covered by fixtures in
 *     `test/reliability/migrations.test.ts`.
 *   - Audit-format changes are ADDITIVE — the hash chain continues across
 *     versions (the chain is never re-keyed by a migration).
 *   - A downgraded database is readable by code that does not know the
 *     migration (it simply no longer has the tables/columns).
 */

import type { WorkspaceStore } from "./workspace-store.ts";

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Apply the migration (may assume version-1 state exists). */
  up(store: WorkspaceStore): void;
  /** Reverse the migration exactly. */
  down(store: WorkspaceStore): void;
}

const MIGRATIONS_TABLE = "schema_migrations";

export class MigrationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MigrationError";
  }
}

/**
 * Migration 1 — `idempotency_slots` (claim-first idempotency, T5).
 * Additive: adds one new table. Down: drops it. The audit chain is untouched.
 */
const MIGRATION_1: Migration = {
  version: 1,
  name: "idempotency_slots",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_slots (
        slot_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        effect_ref TEXT,
        result_json TEXT,
        run_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idem_state ON idempotency_slots(state, updated_at);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS idempotency_slots;`);
  },
};

/**
 * Migration 2 — Phase 2 · T5: project `user_memory` into the canonical
 * `context_items` store, so `src/context/memory/` can be retired.
 *
 * ── Why a migration and not a copy ──────────────────────────────────────────
 *
 * `context/` is the canonical durable-context authority (Constitution Art. V
 * names this exact consolidation: *"A `context/` module that owns all durable
 * context, with `memory/` retired on a dated schedule."*). The legacy rows must
 * become first-class context items, or the retirement would lose user data.
 *
 * ── Reversibility (Art. XXIII) ──────────────────────────────────────────────
 *
 * `up()` is ADDITIVE: it inserts projections and never mutates or deletes a
 * `user_memory` row. The legacy table survives the migration untouched, which
 * is what makes `down()` exact: it deletes only the rows this migration
 * created, identified by the `legacy:user_memory` tag marker. A downgraded
 * database is byte-identical in `user_memory` and has no orphan context rows.
 *
 * Both directions run inside the Phase-1 `WriteGate` (a single serialized
 * `BEGIN IMMEDIATE` transaction per migration), so a concurrent XR process can
 * never observe a half-migrated store.
 *
 * ── Migration honesty (Art. IV.5, Inviolable P5) ────────────────────────────
 *
 * XR cannot reconstruct how consent was given for a legacy row, so
 * `consent_state` is `legacy_unknown` — NEVER `approved`. The item stays
 * retrievable and every explanation flags it for re-affirmation. This mirrors
 * the rule already implemented in `src/context/memory-adapter.ts`.
 */
const LEGACY_TAG = "legacy:user_memory";

const MIGRATION_2: Migration = {
  version: 2,
  name: "memory_to_context_projection",
  up(store: WorkspaceStore) {
    // The context tables are created by ContextRepository.migrate() during the
    // baseline. If they are absent (a store opened without the context layer),
    // there is nothing to project into and the migration is a no-op — it must
    // never block startup.
    const hasContext = store
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_items'`)
      .get();
    const hasMemory = store
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_memory'`)
      .get();
    if (!hasContext || !hasMemory) return;

    const rows = store
      .prepare(
        `SELECT id, category, content, scope, source, tags, importance,
                created_at, updated_at, last_accessed_at, access_count, expires_at
         FROM user_memory`,
      )
      .all() as Array<{
      id: string;
      category: string;
      content: string;
      scope: string;
      source: string;
      tags: string;
      importance: number;
      created_at: number;
      updated_at: number;
      last_accessed_at: number | null;
      access_count: number;
      expires_at: number | null;
    }>;

    const insert = store.prepare(
      `INSERT OR IGNORE INTO context_items
         (id, version, type, title, content, workspace_id, project_scope, user_id,
          trust_status, consent_state, provenance_kind, actor_kind,
          expires_at, confidence, sensitivity, retention, links_json, index_state,
          tags, created_at, updated_at, last_accessed_at, access_count)
       VALUES (?, 1, ?, ?, ?, ?, ?, 'local', ?, 'legacy_unknown', ?, ?, ?, ?, ?, ?, '{}', 'none', ?, ?, ?, ?, ?)`,
    );

    for (const r of rows) {
      // An `exclusion` is a user policy directive, not a memory — the taxonomy
      // fix the context model already encodes.
      const isExclusion = r.category === "exclusion";
      const type = isExclusion ? "instruction" : "memory";
      const trust = isExclusion
        ? "trusted_instruction"
        : SOURCE_TRUST[r.source] ?? "unknown";
      const provenance = SOURCE_PROVENANCE[r.source] ?? "unknown";
      const actor = SOURCE_ACTOR[r.source] ?? "unknown";
      const confidence = r.importance >= 4 ? "high" : r.importance <= 2 ? "low" : "medium";
      const title = r.content.length > 72 ? `${r.content.slice(0, 71)}…` : r.content;
      const tags = [...r.tags.split(",").map((t) => t.trim()).filter(Boolean), LEGACY_TAG].join(",");

      insert.run(
        // The context item REUSES the legacy id, so the projection is stable
        // across re-runs and `down()` can identify it exactly.
        r.id,
        type,
        title,
        r.content,
        store.workspaceId,
        r.scope,
        trust,
        provenance,
        actor,
        r.expires_at,
        confidence,
        inferSensitivity(`${r.content} ${r.tags}`),
        r.expires_at ? "ttl" : "durable",
        tags,
        r.created_at,
        r.updated_at,
        r.last_accessed_at,
        r.access_count,
      );
    }
  },
  down(store: WorkspaceStore) {
    const hasContext = store
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_items'`)
      .get();
    if (!hasContext) return;
    // Delete ONLY what this migration created. Rows authored natively in the
    // context store (no legacy marker) are untouched, and `user_memory` was
    // never modified, so the pre-migration state is restored exactly.
    store
      .prepare(`DELETE FROM context_items WHERE tags LIKE ?`)
      .run(`%${LEGACY_TAG}%`);
  },
};

/** Honest mapping from the legacy `source` enum (mirrors context/memory-adapter.ts). */
const SOURCE_TRUST: Record<string, string> = {
  user: "approved_memory",
  chat: "approved_memory",
  voice: "approved_memory",
  research: "generated_synthesis",
  import: "unknown",
};
const SOURCE_PROVENANCE: Record<string, string> = {
  user: "user_input",
  chat: "user_input",
  voice: "user_input",
  research: "research",
  import: "import",
};
const SOURCE_ACTOR: Record<string, string> = {
  user: "user",
  chat: "user",
  voice: "user",
  research: "system",
  import: "system",
};

/** Conservative: never claim an item is "public" without evidence. */
function inferSensitivity(text: string): string {
  const t = text.toLowerCase();
  if (/\b(password|secret|api[_ -]?key|token|credential|private key|ssn|passport)\b/.test(t)) {
    return "secret";
  }
  if (/\b(personal|private|home address|phone number|medical|salary|bank)\b/.test(t)) {
    return "private";
  }
  return "unknown";
}

/**
 * Migration 3 — Phase 7 · T8 — Business OS thin L0 contract tables.
 * The kernel holds ONLY this record/artifact contract; business domain
 * schema lives in the extensions/business-os package. Additive; down drops
 * the two L0 tables (business data in biz_* tables is untouched).
 */
const MIGRATION_3: Migration = {
  version: 3,
  name: "business_l0_contract",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS xr_l0_records (
        module TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        reason TEXT,
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (module, entity, entity_id, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_l0_records_ws ON xr_l0_records(workspace_id, updated_at);
      CREATE TABLE IF NOT EXISTS xr_l0_artifacts (
        artifact_id TEXT PRIMARY KEY,
        module TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_l0_artifacts_ref ON xr_l0_artifacts(module, entity, entity_id);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS xr_l0_records; DROP TABLE IF EXISTS xr_l0_artifacts;`);
  },
};

/**
 * Migration 4 — Phase 11 · Repository Intelligence tables.
 * Additive: repo_files / repo_symbols / repo_edges / repo_index_meta /
 * repo_parse_cache. Down drops them. Audit chain untouched.
 */
const MIGRATION_4: Migration = {
  version: 4,
  name: "repo_intelligence",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS repo_index_meta (
        workspace_id TEXT NOT NULL,
        root TEXT NOT NULL,
        git_root TEXT,
        state TEXT NOT NULL,
        index_version INTEGER NOT NULL,
        parser_version INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        error TEXT,
        stats_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (workspace_id)
      );
      CREATE TABLE IF NOT EXISTS repo_files (
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        language TEXT,
        git_status TEXT NOT NULL DEFAULT 'unknown',
        indexed_at INTEGER NOT NULL,
        parser_confidence TEXT NOT NULL DEFAULT 'none',
        PRIMARY KEY (workspace_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_repo_files_hash ON repo_files(workspace_id, content_hash);
      CREATE TABLE IF NOT EXISTS repo_symbols (
        workspace_id TEXT NOT NULL,
        symbol_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT,
        exported INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, symbol_id)
      );
      CREATE INDEX IF NOT EXISTS idx_repo_symbols_name ON repo_symbols(workspace_id, name);
      CREATE INDEX IF NOT EXISTS idx_repo_symbols_file ON repo_symbols(workspace_id, file_path);
      CREATE TABLE IF NOT EXISTS repo_edges (
        workspace_id TEXT NOT NULL,
        from_file TEXT NOT NULL,
        to_file TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        symbol TEXT,
        kind TEXT NOT NULL,
        specifier TEXT NOT NULL,
        PRIMARY KEY (workspace_id, from_file, to_file, edge_type, specifier)
      );
      CREATE INDEX IF NOT EXISTS idx_repo_edges_to ON repo_edges(workspace_id, to_file);
      CREATE TABLE IF NOT EXISTS repo_parse_cache (
        workspace_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        parser_version INTEGER NOT NULL,
        language TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (workspace_id, content_hash, parser_version)
      );
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`
      DROP TABLE IF EXISTS repo_parse_cache;
      DROP TABLE IF EXISTS repo_edges;
      DROP TABLE IF EXISTS repo_symbols;
      DROP TABLE IF EXISTS repo_files;
      DROP TABLE IF EXISTS repo_index_meta;
    `);
  },
};

export const MIGRATIONS: readonly Migration[] = [MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4];

/** Latest known schema version. */
export const LATEST_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

/** Ensure the version bookkeeping table exists. */
export function ensureMigrationTable(store: WorkspaceStore): void {
  store.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Current applied schema version (0 = baseline only). */
export function currentSchemaVersion(store: WorkspaceStore): number {
  ensureMigrationTable(store);
  const row = store
    .prepare(`SELECT MAX(version) AS v FROM ${MIGRATIONS_TABLE}`)
    .get() as { v: number | null } | null;
  return row?.v ?? 0;
}

/**
 * Apply pending migrations up to `target` (default: latest). Idempotent AND
 * race-safe across processes: the applied-check runs INSIDE the serialized
 * write transaction (`BEGIN IMMEDIATE` serializes writers), and the
 * bookkeeping insert is `INSERT OR IGNORE`, so two processes racing to apply
 * migration N on a fresh database cannot produce a UNIQUE violation (the
 * loser's transaction sees the winner's committed row and no-ops).
 */
export function runMigrationsUp(store: WorkspaceStore, target: number = LATEST_SCHEMA_VERSION): string[] {
  ensureMigrationTable(store);
  const ran: string[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version > target) break;
    store.write(() => {
      // Re-check inside the transaction: IMMEDIATE serializes writers, so the
      // check-then-record below is atomic with respect to other processes.
      const already = store
        .prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE version = ?`)
        .get(m.version);
      if (already) return;
      m.up(store); // idempotent DDL (CREATE ... IF NOT EXISTS)
      store
        .prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
        .run(m.version, m.name, Date.now());
      ran.push(m.name);
    });
  }
  return ran;
}

/**
 * Reverse migrations down to `target` (default: 0 = baseline). Idempotent and
 * race-safe across processes: the presence check runs inside the write
 * transaction and the reversal DDL is idempotent (DROP TABLE IF EXISTS).
 */
export function runMigrationsDown(store: WorkspaceStore, target: number = 0): string[] {
  ensureMigrationTable(store);
  const reverted: string[] = [];
  for (let v = LATEST_SCHEMA_VERSION; v > target; v--) {
    const m = MIGRATIONS.find((x) => x.version === v);
    if (!m) throw new MigrationError(`no migration registered for version ${v}`);
    store.write(() => {
      const present = store
        .prepare(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE version = ?`)
        .get(v);
      if (!present) return; // another process already reverted it
      m.down(store);
      store.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(v);
      reverted.push(m.name);
    });
  }
  return reverted;
}
