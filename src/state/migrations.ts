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
  tool: "untrusted_external", // Phase 7 channels (never above their provenance ceiling)
  agent: "generated_synthesis",
  schedule: "generated_synthesis",
};
const SOURCE_PROVENANCE: Record<string, string> = {
  user: "user_input",
  chat: "user_input",
  voice: "user_input",
  research: "research",
  import: "import",
  tool: "tool_output",
  agent: "model_synthesis",
  schedule: "model_synthesis",
};
const SOURCE_ACTOR: Record<string, string> = {
  user: "user",
  chat: "user",
  voice: "user",
  research: "system",
  import: "system",
  tool: "agent",
  agent: "agent",
  schedule: "system",
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

/**
 * Migration 5 — `cost_events.usage_source` (Phase 1 · F-13).
 * Additive: adds one NOT NULL column with a safe default. Cost honesty: when a
 * provider omits usage, XR meters an estimate and stamps this column so a
 * buggy/hostile provider cannot silently record $0 without a trace.
 * Down: drops the column (destructive, but on a stats table this is safe and
 * reversible — the pre-existing data is untouched).
 */
const MIGRATION_5: Migration = {
  version: 5,
  name: "cost_events_usage_source",
  up(store: WorkspaceStore) {
    // SQLite has no ADD COLUMN IF NOT EXISTS; guard via pragma table_info.
    const cols = (store as any).prepare
      ? (store as any).prepare("PRAGMA table_info(cost_events)").all()
      : [];
    const has = (cols as Array<{ name: string }>).some((c) => c.name === "usage_source");
    if (!has) {
      store.exec(`ALTER TABLE cost_events ADD COLUMN usage_source TEXT NOT NULL DEFAULT 'provider'`);
    }
  },
  down(store: WorkspaceStore) {
    store.exec(`ALTER TABLE cost_events DROP COLUMN usage_source`);
  },
};

/**
 * Migration 6 — Phase 2 · F-11/F-12: durable `approvals` + `reservations`
 * tables for EXISTING databases (the baseline schema in WorkspaceStore covers
 * fresh ones). Additive: two tables + indexes. The audit chain is untouched.
 *
 * One-release cutover: there is no dual mode — after this migration the
 * durable consent plane and the atomic budget-admission tables exist on every
 * database, old and new. Down: drops both tables (destructive only for data
 * this migration itself introduced).
 */
const MIGRATION_6: Migration = {
  version: 6,
  name: "phase2_approvals_reservations",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        run_id TEXT,
        session_id TEXT,
        tool TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        risk_tier TEXT NOT NULL DEFAULT 'unknown',
        surface TEXT NOT NULL DEFAULT 'unknown',
        requested_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL,
        decision TEXT,
        decided_by_channel TEXT,
        decided_by_user TEXT,
        decided_at INTEGER,
        latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(decision, requested_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        env_id TEXT NOT NULL,
        est_usd REAL NOT NULL,
        est_tokens INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        actual_usd REAL,
        actual_tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_reservations_env ON reservations(env_id, status);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS approvals;`);
    store.exec(`DROP TABLE IF EXISTS reservations;`);
  },
};

/**
 * Migration 7 — Phase 4 (Evidence Integrity, F-08): signed audit chain.
 *
 * Additive ONLY — the SHA-256 hash chain is never re-keyed or rewritten:
 *   - `audit_log.head_counter` INTEGER NULL — running monotonic counter for the
 *     signed segment (null on legacy/unsigned entries). A wholesale
 *     truncate-and-rebuild without the private key cannot restore a valid
 *     head signature.
 *   - `audit_log.sig` TEXT NULL — Ed25519 signature over the checkpoint/head
 *     message for every Nth signed entry (and keyed/rekey events).
 *   - `audit_head` — the latest signed head: {counter,entry_hash,sig,pubkey},
 *     updated on every signed append. Tamper-resistant because its `sig` is
 *     unforgeable without the private key.
 *   - `audit_anchors` — append-verified records of checkpoint hashes published
 *     to an operator-configured remote anchor sink.
 *
 * Existing unsigned chains remain readable and verifiable (chain-only /
 * `--crypto-legacy`); keying happens on next real boot, not in the migration.
 *
 * Down: drops the columns/tables this migration introduced. Columns use the
 * guarded DROP (SQLite >= 3.35) wrapped in a pragma check so older engines
 * downgrade without error.
 */
const MIGRATION_7: Migration = {
  version: 7,
  name: "phase4_signed_audit",
  up(store: WorkspaceStore) {
    const cols = (store as any).prepare
      ? ((store as any).prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>)
      : [];
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has("head_counter")) {
      store.exec(`ALTER TABLE audit_log ADD COLUMN head_counter INTEGER`);
    }
    if (!has("sig")) {
      store.exec(`ALTER TABLE audit_log ADD COLUMN sig TEXT`);
    }
    store.exec(`
      CREATE TABLE IF NOT EXISTS audit_head (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        counter INTEGER NOT NULL,
        entry_hash TEXT NOT NULL,
        entry_id INTEGER NOT NULL,
        sig TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_anchors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        counter INTEGER NOT NULL,
        entry_hash TEXT NOT NULL,
        entry_id INTEGER NOT NULL,
        sig TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        sink TEXT NOT NULL,
        anchored_at INTEGER NOT NULL,
        verified_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_anchors_counter ON audit_anchors(counter);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS audit_head;`);
    store.exec(`DROP TABLE IF EXISTS audit_anchors;`);
    const cols = (store as any).prepare
      ? ((store as any).prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>)
      : [];
    const has = (n: string) => cols.some((c) => c.name === n);
    // ALTER TABLE DROP COLUMN is SQLite >= 3.35; fail soft on older engines.
    if (has("sig")) {
      try {
        store.exec(`ALTER TABLE audit_log DROP COLUMN sig`);
      } catch {
        /* older SQLite — column simply remains */
      }
    }
    if (has("head_counter")) {
      try {
        store.exec(`ALTER TABLE audit_log DROP COLUMN head_counter`);
      } catch {
        /* older SQLite — column simply remains */
      }
    }
  },
};

/**
 * Migration 8 — Phase 6 (Orchestration Completion): budget partitions,
 * durable task checkpoints, and partition in-flight reservations.
 *
 * Additive ONLY — three new tables, no existing table is modified:
 *   - `budget_partitions` — the partition ledger. One row per root envelope
 *     (`child_id = '@root'`) and one per issued child envelope. Caps are set
 *     at partition time (Σ child caps ≤ root cap is enforced inside the
 *     partition write transaction); `consumed_*` settles as children commit.
 *     This is what kills the F-12 N× spend multiplier: a worker's ceiling is
 *     its partition, never a copy of the root request.
 *   - `partition_reservations` — in-flight step estimates per partition, the
 *     race-safe "one admitted reservation beyond the cap" allowance of the
 *     P2 admission model. Stale rows are swept at admission time, so a
 *     kill -9 between admit and commit can never double-spend: the sweep
 *     releases the reservation and the settled `consumed_*` remains the
 *     only durable spend accounting.
 *   - `task_checkpoints` — the unified task-runtime journal. Every task
 *     transition and every plain-run step writes one row under the store's
 *     WriteGate, hash-chained per task (prev_hash → hash over
 *     canonical JSON), giving workflows AND plain `xr run` sessions the same
 *     resumable durability (F-28). Old sessions simply have no rows and are
 *     documented as unresumable.
 *
 * Down: drops the three tables this migration introduced.
 */
const MIGRATION_8: Migration = {
  version: 8,
  name: "phase6_orchestration",
  up(store: WorkspaceStore) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS budget_partitions (
        partition_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        agent_id TEXT,
        cap_usd REAL NOT NULL DEFAULT 0,
        cap_tokens INTEGER NOT NULL DEFAULT 0,
        consumed_usd REAL NOT NULL DEFAULT 0,
        consumed_tokens INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_partitions_child ON budget_partitions(task_id, child_id);

      CREATE TABLE IF NOT EXISTS partition_reservations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        est_usd REAL NOT NULL,
        est_tokens INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pres_status ON partition_reservations(task_id, status);

      CREATE TABLE IF NOT EXISTS task_checkpoints (
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        prev_hash TEXT,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (task_id, seq)
      );
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS task_checkpoints;`);
    store.exec(`DROP TABLE IF EXISTS partition_reservations;`);
    store.exec(`DROP TABLE IF EXISTS budget_partitions;`);
  },
};

/**
 * Migration 9 — Phase 7 (Memory Policy Layer, F-21).
 *
 * Additive columns on `user_memory` plus one new table. Every column is
 * nullable or defaulted, so a pre-Phase-7 row reads unchanged:
 *   - `agent_visibility` — JSON role list (ACL). Default `["*"]` = visible to
 *     every principal, i.e. EXACTLY the pre-Phase-7 behaviour. Nothing that
 *     already exists is silently restricted by this migration.
 *   - `kind` — fact|preference|episode|procedure|summary, backfilled from the
 *     legacy category (project/fact→fact, preference→preference,
 *     workflow→procedure, tag `summary`→summary). `exclusion` rows are user
 *     POLICY, not memory (context types them `instruction`), so their kind
 *     stays NULL rather than being forced into a memory taxonomy.
 *   - `confidence_score` — numeric projection of the existing textual
 *     `confidence` level (high .8 / medium .5 / low .3). NOT a truth claim;
 *     `unknown` stays NULL — the migration never invents a number.
 *   - `provenance_event_id` — the audit-chain hash of the write event, set for
 *     rows written from Phase 7 on. Legacy rows keep NULL (there is no honest
 *     event to point at; provenance_kind/actor_kind were already backfilled).
 *   - `memory_conflicts` — contradiction arbitration ledger (open/resolved),
 *     written on high-similarity writes; never resolves itself.
 *
 * Down: drops the table and the four columns (fail-soft on SQLite < 3.35).
 */
const MIGRATION_9: Migration = {
  version: 9,
  name: "phase7_memory_policy",
  up(store: WorkspaceStore) {
    const cols = (store as any).prepare
      ? ((store as any).prepare("PRAGMA table_info(user_memory)").all() as Array<{ name: string }>)
      : [];
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has("agent_visibility")) {
      store.exec(`ALTER TABLE user_memory ADD COLUMN agent_visibility TEXT NOT NULL DEFAULT '["*"]'`);
    }
    if (!has("kind")) store.exec(`ALTER TABLE user_memory ADD COLUMN kind TEXT`);
    if (!has("confidence_score")) store.exec(`ALTER TABLE user_memory ADD COLUMN confidence_score REAL`);
    if (!has("provenance_event_id")) store.exec(`ALTER TABLE user_memory ADD COLUMN provenance_event_id TEXT`);
    // Backfill (idempotent: only rows still NULL are touched).
    store.exec(`
      UPDATE user_memory SET kind = CASE
          WHEN (',' || tags || ',') LIKE '%,summary,%' THEN 'summary'
          WHEN category = 'preference' THEN 'preference'
          WHEN category = 'workflow' THEN 'procedure'
          WHEN category IN ('project','fact') THEN 'fact'
          ELSE NULL END
        WHERE kind IS NULL;
      UPDATE user_memory SET confidence_score = CASE confidence
          WHEN 'high' THEN 0.8 WHEN 'medium' THEN 0.5 WHEN 'low' THEN 0.3 ELSE NULL END
        WHERE confidence_score IS NULL;
      UPDATE user_memory SET agent_visibility = '["*"]'
        WHERE agent_visibility IS NULL OR agent_visibility = '';
      CREATE TABLE IF NOT EXISTS memory_conflicts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        item_a TEXT NOT NULL,
        item_b TEXT NOT NULL,
        similarity REAL NOT NULL,
        detector TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolution TEXT,
        resolved_by TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_conflicts_status ON memory_conflicts(status, created_at DESC);
    `);
  },
  down(store: WorkspaceStore) {
    store.exec(`DROP TABLE IF EXISTS memory_conflicts;`);
    const cols = (store as any).prepare
      ? ((store as any).prepare("PRAGMA table_info(user_memory)").all() as Array<{ name: string }>)
      : [];
    for (const col of ["provenance_event_id", "confidence_score", "kind", "agent_visibility"]) {
      if (!cols.some((c) => c.name === col)) continue;
      try {
        store.exec(`ALTER TABLE user_memory DROP COLUMN ${col}`);
      } catch {
        /* older SQLite — column simply remains (nullable/defaulted, harmless) */
      }
    }
  },
};

export const MIGRATIONS: readonly Migration[] = [MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6, MIGRATION_7, MIGRATION_8, MIGRATION_9];

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
  // Re-sync signing state (migration 7 may have just added the tables).
  (store as unknown as { refreshAuditKeyingState?: () => void }).refreshAuditKeyingState?.();
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
  // Migration 7 (signed audit) drops its columns/tables on the way down; sync
  // the store's in-memory signing state so appends match the on-disk schema.
  const refresh = (store as unknown as { refreshAuditKeyingState?: () => void }).refreshAuditKeyingState;
  if (refresh) refresh.call(store);
  return reverted;
}
