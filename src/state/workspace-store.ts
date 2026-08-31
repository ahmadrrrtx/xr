/**
 * XR — state store (SQLite via Bun's built-in driver).
 * Sessions + steps + the tamper-evident, hash-chained audit log.
 * (TRD §1 / schema doc 05. This is our "blockchain-grade" tamper evidence — free & offline.)
 *
 * Phase 1 (Reliability & Persistence Core):
 *   - SQLite configured for safe local concurrency: WAL, synchronous=NORMAL,
 *     busy_timeout≥3000, foreign_keys=ON, wal_autocheckpoint set.
 *   - Exactly ONE read-write connection per database file per process
 *     (shared through a per-file registry); reads use the same connection
 *     (WAL readers never block the writer) and dedicated read-only helpers
 *     are available for long-lived readers.
 *   - Every mutating statement through this connection is executed inside a
 *     serialized `BEGIN IMMEDIATE … COMMIT` transaction (the WriteGate) — the
 *     connection itself is the single writer. Multi-statement trust-critical
 *     writes (audit append, workflow save, dedup check-then-insert) wrap
 *     their whole read-modify-write in one transaction.
 *   - The audit hash-chain append is atomic (lastHash→compute→insert in one
 *     IMMEDIATE transaction) and appends FAIL CLOSED on a broken chain until
 *     an explicit `repairChain()` re-seeds it.
 *   - Periodic `wal_checkpoint(RESTART)` (fallback TRUNCATE) bounds WAL
 *     growth; a checkpoint runs on close.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { XR_HOME } from "../config/config.ts";
// XR 4.5 — context schema. `context/repository.ts` imports only `context/types.ts`
// (dependency-free), so this static import introduces no cycle.
import { ContextRepository, adaptStoreForContext } from "../context/repository.ts";
import {
  AuditChainCorruptedError,
  WriteGate,
  gateConnection,
  openDatabase,
} from "./write-gate.ts";
import { runMigrationsUp } from "./migrations.ts";

const GENESIS = "xr-genesis";

/** A process-shared read-write connection for one database file (max 1 RW per file). */
interface SharedConnection {
  db: Database;
  gate: WriteGate;
  refs: number;
}

/** v0.9: a row in the durable user-memory table. */
export interface MemoryRow {
  id: string;
  category: string;
  content: string;
  scope: string;
  source: string;
  tags: string;
  importance: number;
  created_at: number;
  updated_at: number;
  /** v0.9: cached embedding (JSON number[]) or NULL when not yet embedded. */
  embedding: string | null;
  /** Phase 3 · T9 — content hash (sha256 of content+tags); NULL = never indexed. */
  content_hash: string | null;
  /** Stage 6: access tracking + retention. */
  last_accessed_at: number | null;
  access_count: number;
  expires_at: number | null;
  /**
   * XR 4.5 (Knowledge and Context OS) — additive context metadata.
   * All are nullable/defaulted so pre-4.5 databases read unchanged.
   * `consent_state` defaults to 'legacy_unknown' and is NEVER backfilled to
   * 'approved' — XR cannot reconstruct historical consent (see MIGRATION).
   */
  consent_state: string | null;
  consent_actor: string | null;
  consent_at: number | null;
  trust_status: string | null;
  confidence: string | null;
  sensitivity: string | null;
  provenance_kind: string | null;
  provenance_ref: string | null;
  actor_kind: string | null;
  actor_name: string | null;
  source_observed_at: number | null;
  stale_after: number | null;
  revoked_at: number | null;
  revoked_reason: string | null;
  superseded_by: string | null;
  retention_policy: string | null;
  index_state: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  workspace_id: string | null;
}

/** v0.9: a session summary row (kept separate from long-term memory). */
export interface SummaryRow {
  id: string;
  scope: string;
  summary: string;
  created_at: number;
}

export class WorkspaceStore {
  /** Phase 1: one shared read-write connection per database file per process. */
  private static readonly shared = new Map<string, SharedConnection>();
  /** 0.2 Storage Unification: Track the last-opened instance for singleton access. */
  private static _lastOpened: WorkspaceStore | null = null;
  private db: Database;
  private gate: WriteGate;
  private readonly openedPath: string;
  private readonly sharedKey: string;
  private closed = false;
  /** Phase 1: first broken audit index detected (null = chain intact). */
  private chainBrokenAt: number | null = null;

  public readonly workspaceId: string;

  constructor(workspaceIdOrPath: string = "default", path?: string) {
    const legacyPath = path === undefined && (workspaceIdOrPath.includes("/") || workspaceIdOrPath.includes("\\") || workspaceIdOrPath.endsWith(".db"));
    this.workspaceId = legacyPath ? "default" : workspaceIdOrPath;
    path = legacyPath ? workspaceIdOrPath : (path ?? join(XR_HOME, "xr.db"));
    // Ensure the home dir exists before opening the DB ("never breaks" rule).
    if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
    const parent = dirname(path);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    this.openedPath = path;
    this.sharedKey = resolve(path);

    // Phase 1 (T2): enforce max-1 read-write connection per DB file per
    // process. A second open of the same file shares the existing connection
    // (and its WriteGate), so two store instances can never become two
    // concurrent writers within one process.
    let shared = WorkspaceStore.shared.get(this.sharedKey);
    if (!shared) {
      const db = openDatabase(path);
      const gate = new WriteGate(db);
      shared = { db, gate, refs: 0 };
      WorkspaceStore.shared.set(this.sharedKey, shared);
    }
    shared.refs += 1;
    this.gate = shared.gate;
    // The gated connection is the single writer: every mutation through it is
    // serialized + transactional by construction (T3).
    this.db = gateConnection(shared.db, shared.gate);
    WorkspaceStore._lastOpened = this;
    this.migrate();
    runMigrationsUp(this);
    // Phase 1 (T1): fail-closed detection of a pre-existing broken chain.
    this.chainBrokenAt = this.verifyChain().valid ? null : (this.verifyChain().brokenAt ?? null);
  }

  /** Execute a mutating block inside the serialized write gate (single writer). */
  write<T>(fn: () => T): T {
    return this.gate.run(fn);
  }

  /** True when the audit chain is corrupted and appends are refused. */
  get auditChainCorrupted(): boolean {
    return this.chainBrokenAt !== null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        phase TEXT NOT NULL,
        tool TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Phase 3: non-regressive skills.
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT NOT NULL,          -- preloaded | learned
        why TEXT,                      -- "why I learned this"
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, version)
      );
      -- Immutable, verified-good action sequences. Never mutated.
      CREATE TABLE IF NOT EXISTS frozen_baselines (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        skill_version INTEGER NOT NULL,
        steps_json TEXT NOT NULL,
        verifier_json TEXT NOT NULL,
        frozen_at INTEGER NOT NULL
      );
      -- Regression suite: re-run after any skill update to catch forgetting.
      CREATE TABLE IF NOT EXISTS regression_cases (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        baseline_id TEXT NOT NULL,
        verifier_json TEXT NOT NULL,
        last_status TEXT,
        last_run_at INTEGER
      );
      -- Block 4: persistent project memory (cross-session facts/preferences).
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        kind TEXT NOT NULL,            -- fact | preference | note | fingerprint
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Block 4: local RAG index — chunk text + embedding (JSON float array).
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        path TEXT NOT NULL,
        chunk_idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT,                -- JSON number[] or NULL (lexical fallback)
        created_at INTEGER NOT NULL
      );
      -- Block 5: cost events (powers the Cost Cockpit + history).
      CREATE TABLE IF NOT EXISTS cost_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        provider TEXT,
        model TEXT NOT NULL,
        in_tokens INTEGER NOT NULL,
        out_tokens INTEGER NOT NULL,
        usd REAL NOT NULL,
        created_at INTEGER NOT NULL,
        usage_source TEXT NOT NULL DEFAULT 'provider'
      );
      CREATE TABLE IF NOT EXISTS budget_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        monthly_cap REAL NOT NULL,
        daily_cap REAL,
        warnings_enabled INTEGER NOT NULL DEFAULT 1,
        auto_fallback INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      -- Block 8: scheduled tasks (cron).
      CREATE TABLE IF NOT EXISTS agent_workflows (
        workflow_id TEXT PRIMARY KEY, kind TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL,
        review_state TEXT NOT NULL, approval_state TEXT NOT NULL, cancellation_state TEXT NOT NULL,
        current_agent_id TEXT, plan_summary TEXT NOT NULL, final_output TEXT, data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_tasks (
        task_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, parent_task_id TEXT, agent_id TEXT NOT NULL,
        role TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, review_state TEXT NOT NULL,
        approval_state TEXT NOT NULL, phase TEXT, parallel_key TEXT, dependencies_json TEXT NOT NULL,
        data_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        spec TEXT NOT NULL,            -- JSON Schedule
        created_at INTEGER NOT NULL
      );
      -- v0.7: research sessions (full ResearchSession persisted as JSON).
      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        depth TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,            -- JSON ResearchSession
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      -- Phase 10: durable research jobs (search/scrape/crawl/map/extract).
      -- Separate from research_sessions so a long-running crawl job never
      -- masquerades as a finished research session (and vice versa).
      CREATE TABLE IF NOT EXISTS research_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,            -- search|scrape|crawl|map|extract
        status TEXT NOT NULL,          -- truthful ResearchJobState
        request TEXT NOT NULL,         -- JSON ResearchRequest
        data TEXT NOT NULL,            -- JSON ResearchJob
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      -- v0.9: durable, user-controlled memory (long-term facts, preferences,
      -- project & workflow memory, do-not-remember rules). Distinct from the
      -- RAG-coupled \`memory\` table above: every row here is EXPLICITLY created,
      -- editable and deletable by the user, with full provenance.
      CREATE TABLE IF NOT EXISTS user_memory (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,        -- preference|project|workflow|fact|exclusion
        content TEXT NOT NULL,
        scope TEXT NOT NULL,           -- "global" or a project key
        source TEXT NOT NULL,          -- user|chat|voice|research|import
        tags TEXT NOT NULL DEFAULT '', -- comma-separated
        importance INTEGER NOT NULL DEFAULT 3,  -- 1..5
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        embedding TEXT,                -- v0.9: JSON number[] or NULL (semantic recall cache)
        -- Stage 6: access tracking + retention/expiry.
        last_accessed_at INTEGER,      -- last time recall surfaced this (NULL = never)
        access_count INTEGER NOT NULL DEFAULT 0,  -- how many times recalled
        expires_at INTEGER             -- epoch-ms after which eligible to prune / excluded from recall (NULL = never)
      );
      CREATE INDEX IF NOT EXISTS idx_user_memory_scope ON user_memory(scope);
      CREATE INDEX IF NOT EXISTS idx_user_memory_category ON user_memory(category);
      -- v0.9: session summaries — kept SEPARATE from long-term memory so the
      -- agent never confuses ephemeral conversation recaps with durable facts.
      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- XR 4.1: Unified Execution Fabric records (one row per execution).
      -- Additive migration — no existing table is modified.
      CREATE TABLE IF NOT EXISTS execution_records (
        run_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        parent_run_id TEXT,
        retry_of TEXT,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        workflow_id TEXT,
        task_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL,
        outcome_kind TEXT,
        actor_kind TEXT NOT NULL,
        actor_name TEXT,
        capability_kind TEXT NOT NULL,
        capability_name TEXT NOT NULL,
        placement TEXT NOT NULL DEFAULT 'in_process',
        is_dry_run INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        cost_usd REAL,
        message TEXT,
        adapter_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exec_workspace ON execution_records(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exec_session ON execution_records(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exec_workflow ON execution_records(workflow_id, task_id);
      CREATE INDEX IF NOT EXISTS idx_exec_correlation ON execution_records(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_exec_state ON execution_records(workspace_id, state);
      CREATE INDEX IF NOT EXISTS idx_exec_capability ON execution_records(workspace_id, capability_kind, created_at DESC);
    `);

    // v0.9 semantic recall: ensure the embedding column exists on DBs created
    // before this version (CREATE TABLE IF NOT EXISTS won't add it). Idempotent
    // and fail-soft — an older SQLite or an already-present column is fine.
    try {
      const cols = this.db
        .query<{ name: string }, []>(`PRAGMA table_info(user_memory)`)
        .all();
      const have = new Set(cols.map((c) => c.name));
      if (!have.has("embedding")) {
        this.db.exec(`ALTER TABLE user_memory ADD COLUMN embedding TEXT`);
      }
      // Phase 3 · T9 — incremental content-addressed indexing.
      if (!have.has("content_hash")) {
        this.db.exec(`ALTER TABLE user_memory ADD COLUMN content_hash TEXT`);
      }
      // Stage 6: access tracking + retention columns (idempotent, fail-soft).
      if (!have.has("last_accessed_at")) {
        this.db.exec(`ALTER TABLE user_memory ADD COLUMN last_accessed_at INTEGER`);
      }
      if (!have.has("access_count")) {
        this.db.exec(`ALTER TABLE user_memory ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!have.has("expires_at")) {
        this.db.exec(`ALTER TABLE user_memory ADD COLUMN expires_at INTEGER`);
      }

      // ── XR 4.5 Knowledge and Context OS — additive context metadata ────
      // Every column is nullable or has a default, so an existing 4.4 database
      // opens unchanged. `consent_state` seeds to 'legacy_unknown' rather than
      // 'approved': XR must not fabricate consent it cannot verify.
      const ADDITIVE_45: Array<[string, string]> = [
        ["consent_state", "TEXT NOT NULL DEFAULT 'legacy_unknown'"],
        ["consent_actor", "TEXT"],
        ["consent_at", "INTEGER"],
        ["trust_status", "TEXT"],
        ["confidence", "TEXT NOT NULL DEFAULT 'unknown'"],
        ["sensitivity", "TEXT NOT NULL DEFAULT 'unknown'"],
        ["provenance_kind", "TEXT"],
        ["provenance_ref", "TEXT"],
        ["actor_kind", "TEXT"],
        ["actor_name", "TEXT"],
        ["source_observed_at", "INTEGER"],
        ["stale_after", "INTEGER"],
        ["revoked_at", "INTEGER"],
        ["revoked_reason", "TEXT"],
        ["superseded_by", "TEXT"],
        ["retention_policy", "TEXT NOT NULL DEFAULT 'durable'"],
        ["index_state", "TEXT NOT NULL DEFAULT 'none'"],
        ["embedding_model", "TEXT"],
        ["embedding_dim", "INTEGER"],
        ["workspace_id", "TEXT"],
      ];
      for (const [col, decl] of ADDITIVE_45) {
        if (!have.has(col)) {
          this.db.exec(`ALTER TABLE user_memory ADD COLUMN ${col} ${decl}`);
        }
      }

      // Derive trust/provenance from the EXISTING, honest `source` column.
      // Only fills rows where the value is still NULL, so it is idempotent and
      // never overwrites a user decision.
      this.db.exec(`
        UPDATE user_memory SET
          trust_status = CASE
            WHEN category = 'exclusion' THEN 'trusted_instruction'
            WHEN source IN ('user','chat','voice') THEN 'approved_memory'
            WHEN source = 'research' THEN 'generated_synthesis'
            ELSE 'unknown' END
        WHERE trust_status IS NULL;
        UPDATE user_memory SET
          provenance_kind = CASE
            WHEN source IN ('user','chat','voice') THEN 'user_input'
            WHEN source = 'research' THEN 'research'
            WHEN source = 'import' THEN 'import'
            ELSE 'unknown' END
        WHERE provenance_kind IS NULL;
        UPDATE user_memory SET
          actor_kind = CASE
            WHEN source IN ('user','chat','voice') THEN 'user'
            WHEN source IN ('research','import') THEN 'system'
            ELSE 'unknown' END
        WHERE actor_kind IS NULL;
        UPDATE user_memory SET
          index_state = CASE WHEN embedding IS NOT NULL THEN 'indexed' ELSE 'none' END
        WHERE index_state = 'none' AND embedding IS NOT NULL;
      `);
      this.db.exec(
        `UPDATE user_memory SET workspace_id = '${this.workspaceId.replace(/'/g, "''")}' WHERE workspace_id IS NULL`,
      );

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_user_memory_consent ON user_memory(consent_state);
        CREATE INDEX IF NOT EXISTS idx_user_memory_workspace ON user_memory(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_user_memory_revoked ON user_memory(revoked_at);
      `);
    } catch {
      /* never block startup on a migration probe */
    }

    // XR 4.5 — context subsystem tables (additive, idempotent, fail-soft).
    try {
      new ContextRepository(adaptStoreForContext(this), this.workspaceId).migrate();
    } catch {
      /* context tables are created lazily by ContextService when unavailable here */
    }
  }

  // ---- v0.9: durable user memory ----

  insertMemory(row: {
    id: string;
    category: string;
    content: string;
    scope: string;
    source: string;
    tags: string;
    importance: number;
    /** v0.9: optional precomputed embedding (number[]); stored as JSON. */
    embedding?: number[] | null;
    /** Stage 6: absolute expiry epoch-ms (null/omitted = never expires). */
    expiresAt?: number | null;
  }): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO user_memory (id,category,content,scope,source,tags,importance,created_at,updated_at,embedding,last_accessed_at,access_count,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.category,
        row.content,
        row.scope,
        row.source,
        row.tags,
        row.importance,
        now,
        now,
        row.embedding && row.embedding.length ? JSON.stringify(row.embedding) : null,
        null,
        0,
        Number.isFinite(row.expiresAt as number) ? (row.expiresAt as number) : null,
      );
  }

  /**
   * Stage 6 — record that a set of entries was surfaced by recall: bump
   * `access_count` and set `last_accessed_at` to now. Best-effort; never throws.
   * Done in one statement per id for simplicity.
   */
  touchMemoryAccess(ids: string[], now: number = Date.now()): void {
    if (!ids.length) return;
    const stmt = this.db.query(
      `UPDATE user_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
    );
    for (const id of ids) {
      try {
        stmt.run(now, id);
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Stage 6 — permanently delete every entry whose `expires_at` has passed.
   * Returns the number removed. Exclusions with expiry are pruned too.
   */
  pruneExpiredMemory(now: number = Date.now()): number {
    const r = this.db
      .query(`DELETE FROM user_memory WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(now);
    return (r as any).changes ?? 0;
  }

  /** Stage 6 — count entries that are currently expired (not yet pruned). */
  expiredMemoryCount(now: number = Date.now()): number {
    return (
      this.db
        .query<{ c: number }, [number]>(
          `SELECT COUNT(*) c FROM user_memory WHERE expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .get(now)?.c ?? 0
    );
  }

  /** v0.9: cache/refresh the embedding for a memory entry. */
  setMemoryEmbedding(id: string, embedding: number[] | null): void {
    this.db
      .query(`UPDATE user_memory SET embedding=? WHERE id=?`)
      .run(embedding && embedding.length ? JSON.stringify(embedding) : null, id);
  }

  /** Phase 3 · T9 — record the content hash a cached embedding was built from. */
  setMemoryContentHash(id: string, hash: string | null): void {
    this.db.query(`UPDATE user_memory SET content_hash=? WHERE id=?`).run(hash, id);
  }

  /** Find an existing entry with identical (scope, category, content). */
  findMemoryByContent(
    scope: string,
    category: string,
    content: string,
  ): MemoryRow | null {
    return (
      this.db
        .query<MemoryRow, [string, string, string]>(
          `SELECT * FROM user_memory WHERE scope=? AND category=? AND content=? LIMIT 1`,
        )
        .get(scope, category, content) ?? null
    );
  }

  getMemory(id: string): MemoryRow | null {
    return (
      this.db
        .query<MemoryRow, [string]>(`SELECT * FROM user_memory WHERE id=?`)
        .get(id) ?? null
    );
  }

  /** Resolve a partial id prefix to entries (CLI convenience). */
  findMemoryByPrefix(prefix: string): MemoryRow[] {
    return this.db
      .query<MemoryRow, [string]>(
        `SELECT * FROM user_memory WHERE id LIKE ? ORDER BY updated_at DESC`,
      )
      .all(prefix + "%");
  }

  /**
   * List memory. With a scope, returns global + that scope. Excludes the
   * \`exclusion\` category unless explicitly requested.
   */
  listMemory(
    opts: {
      scope?: string;
      category?: string;
      includeExclusions?: boolean;
      includeExpired?: boolean;
      /** XR 4.5 — include revoked/quarantined/proposed rows (inspection only). */
      includeRevoked?: boolean;
    } = {},
  ): MemoryRow[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (opts.scope) {
      clauses.push(`(scope='global' OR scope=?)`);
      params.push(opts.scope);
    }
    if (opts.category) {
      clauses.push(`category=?`);
      params.push(opts.category);
    } else if (!opts.includeExclusions) {
      clauses.push(`category!='exclusion'`);
    }
    if (!opts.includeExpired) {
      clauses.push(`(expires_at IS NULL OR expires_at > ?)`);
      params.push(String(Date.now()));
    }
    // XR 4.5 — a revoked or quarantined entry is NEVER a retrieval candidate.
    // `includeRevoked` exists only for inspection/export surfaces.
    if (!opts.includeRevoked) {
      clauses.push(`revoked_at IS NULL`);
      clauses.push(`(consent_state IS NULL OR consent_state NOT IN ('revoked','deleted','quarantined','proposed','not_eligible'))`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .query<MemoryRow, string[]>(
        `SELECT * FROM user_memory ${where} ORDER BY importance DESC, updated_at DESC`,
      )
      .all(...params);
  }

  updateMemory(
    id: string,
    patch: Partial<{
      content: string;
      category: string;
      scope: string;
      tags: string;
      importance: number;
      expiresAt: number | null;
    }>,
  ): boolean {
    const cur = this.getMemory(id);
    if (!cur) return false;
    // If content or tags change, the cached embedding is stale → clear it so
    // semantic recall re-embeds lazily on next use. (Keeps recall accurate.)
    const textChanged =
      (patch.content !== undefined && patch.content !== cur.content) ||
      (patch.tags !== undefined && patch.tags !== cur.tags);
    // Stage 6: explicit expiry update (null = clear expiry / never expire).
    let nextExpires = cur.expires_at;
    if (patch.expiresAt !== undefined) {
      nextExpires = patch.expiresAt === null || !Number.isFinite(patch.expiresAt as number)
        ? null
        : (patch.expiresAt as number);
    }
    this.db
      .query(
        `UPDATE user_memory SET content=?, category=?, scope=?, tags=?, importance=?, updated_at=?, embedding=?, expires_at=? WHERE id=?`,
      )
      .run(
        patch.content ?? cur.content,
        patch.category ?? cur.category,
        patch.scope ?? cur.scope,
        patch.tags ?? cur.tags,
        patch.importance ?? cur.importance,
        Date.now(),
        textChanged ? null : cur.embedding,
        nextExpires,
        id,
      );
    return true;
  }

  deleteMemory(id: string): boolean {
    const r = this.db.query(`DELETE FROM user_memory WHERE id=?`).run(id);
    return ((r as any).changes ?? 0) > 0;
  }

  /** Clear memory. With a scope, only that scope; otherwise everything. */
  clearMemory(scope?: string): number {
    if (scope) {
      const r = this.db.query(`DELETE FROM user_memory WHERE scope=?`).run(scope);
      return (r as any).changes ?? 0;
    }
    const r = this.db.query(`DELETE FROM user_memory`).run();
    return (r as any).changes ?? 0;
  }

  userMemoryCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM user_memory`)
        .get()?.c ?? 0
    );
  }

  userMemoryStats(): Array<{ category: string; c: number }> {
    return this.db
      .query<{ category: string; c: number }, []>(
        `SELECT category, COUNT(*) c FROM user_memory GROUP BY category ORDER BY c DESC`,
      )
      .all();
  }

  // ---- XR 4.5: consent / revocation / provenance on user memory ----

  /** Set the consent state (and who set it). Idempotent. */
  setMemoryConsent(id: string, state: string, actor: string | null = null): boolean {
    const now = Date.now();
    const r = this.db
      .query(
        `UPDATE user_memory SET consent_state=?, consent_actor=?, consent_at=?, updated_at=? WHERE id=?`,
      )
      .run(state, actor, now, now, id);
    return ((r as any).changes ?? 0) > 0;
  }

  /**
   * Revoke an entry: excluded from retrieval AND its cached vector destroyed,
   * so no index path can resurrect it (§9.8 cache/index invalidation).
   * The row survives so the user can still inspect and export it.
   */
  revokeMemory(id: string, reason: string, actor: string | null = null): boolean {
    const now = Date.now();
    const r = this.db
      .query(
        `UPDATE user_memory SET revoked_at=?, revoked_reason=?, consent_state='revoked',
         embedding=NULL, embedding_model=NULL, embedding_dim=NULL, index_state='invalidated',
         consent_actor=?, updated_at=? WHERE id=?`,
      )
      .run(now, reason.slice(0, 256), actor, now, id);
    return ((r as any).changes ?? 0) > 0;
  }

  /** Record a correction pointer from the old entry to its replacement. */
  supersedeMemory(oldId: string, newId: string): boolean {
    const r = this.db
      .query(`UPDATE user_memory SET superseded_by=?, updated_at=? WHERE id=?`)
      .run(newId, Date.now(), oldId);
    return ((r as any).changes ?? 0) > 0;
  }

  /** Soft staleness boundary — the entry is labelled stale, never hidden. */
  setMemoryStaleAfter(id: string, at: number | null): boolean {
    const r = this.db
      .query(`UPDATE user_memory SET stale_after=?, updated_at=? WHERE id=?`)
      .run(at, Date.now(), id);
    return ((r as any).changes ?? 0) > 0;
  }

  /** Attach typed provenance to a memory row. Never invents a reference. */
  setMemoryProvenance(
    id: string,
    p: {
      provenanceKind?: string;
      provenanceRef?: string | null;
      actorKind?: string;
      actorName?: string | null;
      sourceObservedAt?: number | null;
      trustStatus?: string;
      confidence?: string;
      sensitivity?: string;
    },
  ): boolean {
    const cur = this.getMemory(id);
    if (!cur) return false;
    const r = this.db
      .query(
        `UPDATE user_memory SET provenance_kind=?, provenance_ref=?, actor_kind=?, actor_name=?,
         source_observed_at=?, trust_status=?, confidence=?, sensitivity=?, updated_at=? WHERE id=?`,
      )
      .run(
        p.provenanceKind ?? cur.provenance_kind,
        p.provenanceRef !== undefined ? p.provenanceRef : cur.provenance_ref,
        p.actorKind ?? cur.actor_kind,
        p.actorName !== undefined ? p.actorName : cur.actor_name,
        p.sourceObservedAt !== undefined ? p.sourceObservedAt : cur.source_observed_at,
        p.trustStatus ?? cur.trust_status,
        p.confidence ?? cur.confidence,
        p.sensitivity ?? cur.sensitivity,
        Date.now(),
        id,
      );
    return ((r as any).changes ?? 0) > 0;
  }

  /** Consent-state breakdown (for status/doctor/dashboard). */
  memoryConsentStats(): Array<{ consent_state: string; c: number }> {
    return this.db
      .query<{ consent_state: string; c: number }, []>(
        `SELECT COALESCE(consent_state,'legacy_unknown') consent_state, COUNT(*) c
         FROM user_memory GROUP BY consent_state ORDER BY c DESC`,
      )
      .all();
  }

  /** Invalidate every cached memory vector (e.g. after an embedding change). */
  invalidateMemoryIndex(): number {
    const r = this.db
      .query(
        `UPDATE user_memory SET embedding=NULL, index_state='invalidated' WHERE embedding IS NOT NULL`,
      )
      .run();
    return (r as any).changes ?? 0;
  }

  // ---- v0.9: session summaries (separate from long-term memory) ----

  insertSessionSummary(id: string, scope: string, summary: string): void {
    this.db
      .query(
        `INSERT INTO session_summaries (id,scope,summary,created_at) VALUES (?,?,?,?)`,
      )
      .run(id, scope, summary, Date.now());
  }

  listSessionSummaries(scope?: string, limit = 20): SummaryRow[] {
    if (scope) {
      return this.db
        .query<SummaryRow, [string, number]>(
          `SELECT * FROM session_summaries WHERE scope=? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(scope, limit);
    }
    return this.db
      .query<SummaryRow, [number]>(
        `SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  deleteSessionSummary(id: string): boolean {
    const r = this.db.query(`DELETE FROM session_summaries WHERE id=?`).run(id);
    return ((r as any).changes ?? 0) > 0;
  }

  clearSessionSummaries(scope?: string): number {
    if (scope) {
      const r = this.db
        .query(`DELETE FROM session_summaries WHERE scope=?`)
        .run(scope);
      return (r as any).changes ?? 0;
    }
    const r = this.db.query(`DELETE FROM session_summaries`).run();
    return (r as any).changes ?? 0;
  }

  // ---- sessions ----
  createSession(id: string, title: string, mode: string): void {
    this.db
      .query(
        `INSERT INTO sessions (id,title,mode,status,created_at) VALUES (?,?,?,?,?)`,
      )
      .run(id, title, mode, "running", Date.now());
  }

  endSession(id: string, status: "done" | "error" | "stopped"): void {
    this.db.query(`UPDATE sessions SET status=? WHERE id=?`).run(status, id);
  }

  // ---- steps ----
  addStep(
    id: string,
    sessionId: string,
    idx: number,
    phase: string,
    tool: string | null,
    detail: unknown,
  ): void {
    this.db
      .query(
        `INSERT INTO steps (id,session_id,idx,phase,tool,detail,created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, sessionId, idx, phase, tool, JSON.stringify(detail), Date.now());
  }

  // ---- tamper-evident audit log (hash chain) ----
  private lastHash(): string {
    const row = this.db
      .query<{ hash: string }, []>(
        `SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`,
      )
      .get();
    return row?.hash ?? GENESIS;
  }

  /** Redact obvious secrets before persisting. */
  private redact(detail: Record<string, unknown>): Record<string, unknown> {
    const json = JSON.stringify(detail).replace(
      /(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g,
      "«redacted»",
    );
    return JSON.parse(json);
  }

  /**
   * Append one audit entry. The chain append (read last hash → compute →
   * insert) is ONE atomic `IMMEDIATE` transaction (T1): concurrent writers —
   * in-process through the gate, or cross-process through SQLite's
   * IMMEDIATE lock + busy_timeout — can never fork the chain.
   *
   * Fails CLOSED with `AuditChainCorruptedError` while the chain is broken;
   * run `xr audit repair --yes` (or `repairChain()`) to truncate suspect
   * entries and re-seed.
   */
  audit(
    event: string,
    detail: Record<string, unknown>,
    sessionId: string | null = null,
  ): string {
    if (this.chainBrokenAt !== null) {
      throw new AuditChainCorruptedError(this.chainBrokenAt);
    }
    const safe = this.redact(detail);
    let hash = "";
    this.write(() => {
      const prev = this.lastHash();
      const ts = Date.now();
      const payload = JSON.stringify({ event, detail: safe, prev, ts });
      hash = createHash("sha256").update(payload).digest("hex");
      this.db
        .query(
          `INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?)`,
        )
        .run(sessionId, event, JSON.stringify(safe), prev, hash, ts);
    });
    return hash;
  }

  /** Recompute the whole chain; return first broken index or null if intact. */
  verifyChain(): { valid: boolean; brokenAt?: number } {
    const rows = this.db
      .query<
        {
          id: number;
          event: string;
          detail: string;
          prev_hash: string;
          hash: string;
          created_at: number;
        },
        []
      >(`SELECT * FROM audit_log ORDER BY id ASC`)
      .all();
    let prev = GENESIS;
    for (const r of rows) {
      const payload = JSON.stringify({
        event: r.event,
        detail: JSON.parse(r.detail),
        prev,
        ts: r.created_at,
      });
      const expected = createHash("sha256").update(payload).digest("hex");
      if (expected !== r.hash || r.prev_hash !== prev) {
        this.chainBrokenAt = r.id;
        return { valid: false, brokenAt: r.id };
      }
      prev = r.hash;
    }
    this.chainBrokenAt = null;
    return { valid: true };
  }

  /** Chain metadata for status/operator tooling. */
  chainStatus(): {
    valid: boolean;
    count: number;
    brokenAt?: number;
    headHash: string;
    genesis: string;
  } {
    const status = this.verifyChain();
    const count = this.auditCount();
    const head = this.db
      .query<{ hash: string }, []>(`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`)
      .get();
    return {
      valid: status.valid,
      count,
      brokenAt: status.brokenAt,
      headHash: head?.hash ?? GENESIS,
      genesis: GENESIS,
    };
  }

  /**
   * Explicit chain repair: truncate suspect entries from the first broken
   * index onward, then append a re-seeding `audit.repair` event (which is
   * itself chained). Destructive — callers must require explicit user
   * confirmation (CLI `xr audit repair --yes`). Nothing is ever rewritten:
   * intact history is preserved verbatim.
   */
  repairChain(actor = "xr"): { repaired: boolean; brokenAt?: number; removed: number; hash?: string } {
    const status = this.verifyChain();
    if (status.valid) return { repaired: false, removed: 0 };
    const brokenAt = status.brokenAt!;
    let removed = 0;
    this.write(() => {
      const r = this.db.query(`DELETE FROM audit_log WHERE id >= ?`).run(brokenAt);
      removed = (r as { changes?: number }).changes ?? 0;
    });
    // Refresh the fail-closed flag (chain is now intact), then re-seed.
    this.verifyChain();
    const hash = this.audit("audit.repair", { brokenAt, removed, actor });
    return { repaired: true, brokenAt, removed, hash };
  }

  auditCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM audit_log`)
        .get()?.c ?? 0
    );
  }

  // ---- Phase 3: skills, frozen baselines, regression ----

  /** Latest active version of a skill (0 if none). */
  latestSkillVersion(skillId: string): number {
    return (
      this.db
        .query<{ v: number }, [string]>(
          `SELECT COALESCE(MAX(version),0) v FROM skills WHERE id=?`,
        )
        .get(skillId)?.v ?? 0
    );
  }

  insertSkill(
    id: string,
    version: number,
    source: "preloaded" | "learned",
    why: string | null,
  ): void {
    this.db
      .query(
        `INSERT INTO skills (id,version,source,why,active,created_at) VALUES (?,?,?,?,1,?)`,
      )
      .run(id, version, source, why, Date.now());
  }

  /** Deactivate all versions except the given one (used on rollback). */
  setActiveSkillVersion(id: string, version: number): void {
    this.write(() => {
      this.db.query(`UPDATE skills SET active=0 WHERE id=?`).run(id);
      this.db.query(`UPDATE skills SET active=1 WHERE id=? AND version=?`).run(id, version);
    });
  }

  freezeBaseline(
    baselineId: string,
    skillId: string,
    skillVersion: number,
    stepsJson: string,
    verifierJson: string,
  ): void {
    this.db
      .query(
        `INSERT INTO frozen_baselines (id,skill_id,skill_version,steps_json,verifier_json,frozen_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(baselineId, skillId, skillVersion, stepsJson, verifierJson, Date.now());
  }

  addRegressionCase(
    id: string,
    skillId: string,
    baselineId: string,
    verifierJson: string,
  ): void {
    this.db
      .query(
        `INSERT INTO regression_cases (id,skill_id,baseline_id,verifier_json) VALUES (?,?,?,?)`,
      )
      .run(id, skillId, baselineId, verifierJson);
  }

  regressionCasesFor(
    skillId: string,
  ): Array<{ id: string; baseline_id: string; verifier_json: string }> {
    return this.db
      .query<{ id: string; baseline_id: string; verifier_json: string }, [string]>(
        `SELECT id,baseline_id,verifier_json FROM regression_cases WHERE skill_id=?`,
      )
      .all(skillId);
  }

  markRegression(id: string, status: "pass" | "fail"): void {
    this.db
      .query(`UPDATE regression_cases SET last_status=?, last_run_at=? WHERE id=?`)
      .run(status, Date.now(), id);
  }

  frozenBaseline(id: string): { steps_json: string; verifier_json: string } | null {
    return (
      this.db
        .query<{ steps_json: string; verifier_json: string }, [string]>(
          `SELECT steps_json,verifier_json FROM frozen_baselines WHERE id=?`,
        )
        .get(id) ?? null
    );
  }

  skillCount(): number {
    return (
      this.db.query<{ c: number }, []>(`SELECT COUNT(*) c FROM skills`).get()?.c ?? 0
    );
  }

  frozenCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM frozen_baselines`)
        .get()?.c ?? 0
    );
  }

  // ---- Block 4: project memory ----

  /** Upsert a memory entry. Same (project,kind,content) is deduped. */
  remember(id: string, project: string, kind: string, content: string): void {
    this.write(() => {
      const exists = this.db
        .query<{ c: number }, [string, string, string]>(
          `SELECT COUNT(*) c FROM memory WHERE project=? AND kind=? AND content=?`,
        )
        .get(project, kind, content);
      if (exists && exists.c > 0) return;
      this.db
        .query(`INSERT INTO memory (id,project,kind,content,created_at) VALUES (?,?,?,?,?)`)
        .run(id, project, kind, content, Date.now());
    });
  }

  recall(project: string, kind?: string): Array<{ id: string; kind: string; content: string }> {
    if (kind) {
      return this.db
        .query<{ id: string; kind: string; content: string }, [string, string]>(
          `SELECT id,kind,content FROM memory WHERE project=? AND kind=? ORDER BY created_at DESC`,
        )
        .all(project, kind);
    }
    return this.db
      .query<{ id: string; kind: string; content: string }, [string]>(
        `SELECT id,kind,content FROM memory WHERE project=? ORDER BY created_at DESC`,
      )
      .all(project);
  }

  forget(id: string): void {
    this.db.query(`DELETE FROM memory WHERE id=?`).run(id);
  }

  memoryCount(project: string): number {
    return (
      this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM memory WHERE project=?`)
        .get(project)?.c ?? 0
    );
  }

  // ---- Block 4: RAG chunks ----

  clearRag(project: string): void {
    this.db.query(`DELETE FROM rag_chunks WHERE project=?`).run(project);
  }

  insertChunk(
    id: string,
    project: string,
    path: string,
    chunkIdx: number,
    text: string,
    embedding: number[] | null,
  ): void {
    this.db
      .query(
        `INSERT INTO rag_chunks (id,project,path,chunk_idx,text,embedding,created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, project, path, chunkIdx, text, embedding ? JSON.stringify(embedding) : null, Date.now());
  }

  allChunks(
    project: string,
  ): Array<{ id: string; path: string; text: string; embedding: string | null }> {
    return this.db
      .query<{ id: string; path: string; text: string; embedding: string | null }, [string]>(
        `SELECT id,path,text,embedding FROM rag_chunks WHERE project=?`,
      )
      .all(project);
  }

  ragCount(project: string): number {
    return (
      this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM rag_chunks WHERE project=?`)
        .get(project)?.c ?? 0
    );
  }

  recordCost(
    sessionId: string,
    provider: string,
    model: string,
    inTokens: number,
    outTokens: number,
    usd: number,
    usageSource: string = "provider",
  ): void {
    this.db
      .query(
        `INSERT INTO cost_events (session_id,provider,model,in_tokens,out_tokens,usd,created_at,usage_source) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(sessionId, provider, model, inTokens, outTokens, usd, Date.now(), usageSource);
  }

  clearCosts(): void {
    this.db.query(`DELETE FROM cost_events`).run();
  }

  // ---- Budget Management ----

  getBudgetConfig(): { monthly_cap: number; daily_cap: number | null; warnings_enabled: boolean; auto_fallback: boolean } | null {
    const row = this.db.query<{ monthly_cap: number; daily_cap: number | null; warnings_enabled: number; auto_fallback: number }, []>(
      `SELECT * FROM budget_config WHERE id = 1`,
    ).get();
    if (!row) return null;
    return {
      monthly_cap: row.monthly_cap,
      daily_cap: row.daily_cap,
      warnings_enabled: Boolean(row.warnings_enabled),
      auto_fallback: Boolean(row.auto_fallback),
    };
  }

  setBudgetConfig(config: { monthly_cap: number; daily_cap?: number | null; warnings_enabled?: boolean; auto_fallback?: boolean }): void {
    this.write(() => {
      const current = this.getBudgetConfig();
      if (!current) {
        this.db.query(
          `INSERT INTO budget_config (id, monthly_cap, daily_cap, warnings_enabled, auto_fallback, created_at) VALUES (1, ?, ?, ?, ?, ?)`,
        ).run(
          config.monthly_cap,
          config.daily_cap ?? null,
          config.warnings_enabled ?? 1,
          config.auto_fallback ?? 1,
          Date.now()
        );
      } else {
        this.db.query(
          `UPDATE budget_config SET monthly_cap=?, daily_cap=?, warnings_enabled=?, auto_fallback=?, created_at=? WHERE id=1`,
        ).run(
          config.monthly_cap,
          config.daily_cap ?? current.daily_cap,
          config.warnings_enabled !== undefined ? (config.warnings_enabled ? 1 : 0) : current.warnings_enabled ? 1 : 0,
          config.auto_fallback !== undefined ? (config.auto_fallback ? 1 : 0) : current.auto_fallback ? 1 : 0,
          Date.now()
        );
      }
    });
  }

  getSpendForPeriod(startMs: number): number {
    const row = this.db.query<{ total: number }, [number]>(
      `SELECT COALESCE(SUM(usd), 0) total FROM cost_events WHERE created_at >= ?`,
    ).get(startMs);
    return row?.total ?? 0;
  }

  // ---- v0.7: research sessions ----

  /** Insert or update a research session (stored as a JSON blob + columns). */
  saveResearch(id: string, topic: string, depth: string, status: string, dataJson: string): void {
    const now = Date.now();
    this.write(() => {
      const exists = this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM research_sessions WHERE id=?`)
        .get(id);
      if (exists && exists.c > 0) {
        this.db
          .query(`UPDATE research_sessions SET topic=?, depth=?, status=?, data=?, updated_at=? WHERE id=?`)
          .run(topic, depth, status, dataJson, now, id);
      } else {
        this.db
          .query(
            `INSERT INTO research_sessions (id,topic,depth,status,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
          )
          .run(id, topic, depth, status, dataJson, now, now);
      }
    });
  }

  getResearch(id: string): { id: string; data: string } | null {
    return (
      this.db
        .query<{ id: string; data: string }, [string]>(`SELECT id,data FROM research_sessions WHERE id=?`)
        .get(id) ?? null
    );
  }

  /** Most recently updated research session (the "current" one for status/sources). */
  latestResearch(): { id: string; data: string } | null {
    return (
      this.db
        .query<{ id: string; data: string }, []>(
          `SELECT id,data FROM research_sessions ORDER BY updated_at DESC LIMIT 1`,
        )
        .get() ?? null
    );
  }

  listResearch(limit = 20): Array<{ id: string; topic: string; depth: string; status: string; updated_at: number }> {
    return this.db
      .query<{ id: string; topic: string; depth: string; status: string; updated_at: number }, [number]>(
        `SELECT id,topic,depth,status,updated_at FROM research_sessions ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  researchCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM research_sessions`)
        .get()?.c ?? 0
    );
  }

  // ---- Phase 10: research jobs ----

  /** Insert or update a durable research job (JSON blob + indexed columns). */
  saveResearchJob(id: string, workspaceId: string, kind: string, status: string, requestJson: string, dataJson: string): void {
    const now = Date.now();
    this.write(() => {
      const exists = this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM research_jobs WHERE id=?`)
        .get(id);
      if (exists && exists.c > 0) {
        this.db
          .query(`UPDATE research_jobs SET workspace_id=?, kind=?, status=?, request=?, data=?, updated_at=? WHERE id=?`)
          .run(workspaceId, kind, status, requestJson, dataJson, now, id);
      } else {
        this.db
          .query(`INSERT INTO research_jobs (id,workspace_id,kind,status,request,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, workspaceId, kind, status, requestJson, dataJson, now, now);
      }
    });
  }

  getResearchJob(id: string): { id: string; data: string } | null {
    return (
      this.db
        .query<{ id: string; data: string }, [string]>(`SELECT id,data FROM research_jobs WHERE id=?`)
        .get(id) ?? null
    );
  }

  listResearchJobs(limit = 50): Array<{ id: string; kind: string; status: string; updated_at: number }> {
    return this.db
      .query<{ id: string; kind: string; status: string; updated_at: number }, [number]>(
        `SELECT id,kind,status,updated_at FROM research_jobs ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  researchJobCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM research_jobs`)
        .get()?.c ?? 0
    );
  }

  deleteResearchJob(id: string): void {
    this.write(() => {
      this.db.query(`DELETE FROM research_jobs WHERE id=?`).run(id);
    });
  }

  // ---- Block 8: schedules ----
  saveSchedule(id: string, specJson: string): void {
    this.db
      .query(`INSERT OR REPLACE INTO schedules (id,spec,created_at) VALUES (?,?,?)`)
      .run(id, specJson, Date.now());
  }
  listSchedules(): Array<{ id: string; spec: string }> {
    return this.db
      .query<{ id: string; spec: string }, []>(`SELECT id,spec FROM schedules ORDER BY created_at`)
      .all();
  }
  deleteSchedule(id: string): void {
    this.db.query(`DELETE FROM schedules WHERE id=?`).run(id);
  }

  // ---- Block 5: daemon read APIs ----

  /** Recent audit entries (newest first), for the dashboard. */
  recentAudit(limit = 50): Array<{ id: number; session_id?: string | null; event: string; detail: string; hash: string; created_at: number }> {
    return this.db
      .query<{ id: number; session_id?: string | null; event: string; detail: string; hash: string; created_at: number }, [number]>(
        `SELECT id,session_id,event,detail,hash,created_at FROM audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }

  /**
   * Audit entries in ASCENDING id order, including `prev_hash`.
   *
   * XR 6.1: the enterprise audit export needs the full chain link to verify
   * contiguity. `recentAudit` omits `prev_hash` and reverses order for the
   * dashboard, which would make a legitimate export look like a chain break.
   */
  auditChainRange(
    opts: { fromId?: number; limit?: number } = {},
  ): Array<{ id: number; session_id: string | null; event: string; detail: string; prev_hash: string; hash: string; created_at: number }> {
    const fromId = opts.fromId ?? 0;
    const limit = opts.limit ?? 10_000;
    return this.db
      .query<
        { id: number; session_id: string | null; event: string; detail: string; prev_hash: string; hash: string; created_at: number },
        [number, number]
      >(
        `SELECT id,session_id,event,detail,prev_hash,hash,created_at FROM audit_log WHERE id > ? ORDER BY id ASC LIMIT ?`,
      )
      .all(fromId, limit);
  }

  recentSessions(limit = 50): Array<{ id: string; title: string; mode: string; status: string; created_at: number }> {
    return this.db
      .query<{ id: string; title: string; mode: string; status: string; created_at: number }, [number]>(
        `SELECT id,title,mode,status,created_at FROM sessions ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  getSession(id: string): { id: string; title: string; mode: string; status: string; created_at: number } | null {
    return (
      this.db
        .query<{ id: string; title: string; mode: string; status: string; created_at: number }, [string]>(
          `SELECT id,title,mode,status,created_at FROM sessions WHERE id=? LIMIT 1`,
        )
        .get(id) ?? null
    );
  }

  sessionSteps(sessionId: string): Array<{ id: string; idx: number; phase: string; tool: string | null; detail: string; created_at: number }> {
    return this.db
      .query<{ id: string; idx: number; phase: string; tool: string | null; detail: string; created_at: number }, [string]>(
        `SELECT id,idx,phase,tool,detail,created_at FROM steps WHERE session_id=? ORDER BY idx ASC, created_at ASC`,
      )
      .all(sessionId);
  }

  sessionStatusCounts(): Array<{ status: string; c: number }> {
    return this.db
      .query<{ status: string; c: number }, []>(
        `SELECT status, COUNT(*) c FROM sessions GROUP BY status ORDER BY c DESC`,
      )
      .all();
  }

  providerCostSummary(): Array<{ provider: string; usd: number; tokens: number }> {
    return this.db
      .query<{ provider: string; usd: number; tokens: number }, []>(
        `SELECT provider, COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens+out_tokens),0) tokens FROM cost_events GROUP BY provider ORDER BY usd DESC`,
      )
      .all();
  }

  /** Aggregate cost data for the Cost Cockpit. */
  costSummary(): {
    totalUsd: number;
    totalTokens: number;
    byModel: Array<{ model: string; usd: number; tokens: number }>;
    recent: Array<{ usd: number; tokens: number; at: number }>;
  } {
    const tot = this.db
      .query<{ usd: number; intok: number; outtok: number }, []>(
        `SELECT COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens),0) intok, COALESCE(SUM(out_tokens),0) outtok FROM cost_events`,
      )
      .get();
    const byModel = this.db
      .query<{ model: string; usd: number; tokens: number }, []>(
        `SELECT model, COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens+out_tokens),0) tokens FROM cost_events GROUP BY model ORDER BY usd DESC`,
      )
      .all();
    const recent = this.db
      .query<{ usd: number; tokens: number; at: number }, []>(
        `SELECT usd, (in_tokens+out_tokens) tokens, created_at at FROM cost_events ORDER BY id DESC LIMIT 30`,
      )
      .all();
    return {
      totalUsd: tot?.usd ?? 0,
      totalTokens: (tot?.intok ?? 0) + (tot?.outtok ?? 0),
      byModel,
      recent,
    };
  }

  recallUserMemory(query: string, opts: { scope?: string; k?: number; floor?: number } = {}): Array<{ id:string; category:string; content:string; scope:string }> {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean); const rows = this.listMemory({ scope: opts.scope });
    return rows.map((r) => ({ r, score: terms.filter((t) => `${r.content} ${r.tags}`.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0).sort((a,b) => b.score-a.score).slice(0, opts.k ?? 5)
      .map(({r}) => ({ id:r.id, category:r.category, content:r.content, scope:r.scope }));
  }

  async recallUserMemorySemantic(query: string, opts: { scope?: string; k?: number; floor?: number } = {}) {
    return this.recallUserMemory(query, opts);
  }

  saveWorkflow(record: any): void {
    const now = Date.now();
    this.write(() => {
      this.db.query(`INSERT INTO agent_workflows (workflow_id,kind,goal,status,review_state,approval_state,cancellation_state,current_agent_id,plan_summary,final_output,data_json,created_at,updated_at,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET kind=excluded.kind,goal=excluded.goal,status=excluded.status,review_state=excluded.review_state,approval_state=excluded.approval_state,cancellation_state=excluded.cancellation_state,current_agent_id=excluded.current_agent_id,plan_summary=excluded.plan_summary,final_output=excluded.final_output,data_json=excluded.data_json,updated_at=excluded.updated_at,started_at=excluded.started_at,ended_at=excluded.ended_at`).run(record.workflowId,record.kind,record.goal,record.status,record.reviewState,record.approvalState,record.cancellationState,record.currentAgentId ?? null,record.planSummary,record.finalOutput ? JSON.stringify(record.finalOutput) : null,JSON.stringify(record),record.createdAt ?? now,record.updatedAt ?? now,record.startedAt ?? null,record.endedAt ?? null);
      this.db.query(`DELETE FROM agent_tasks WHERE workflow_id=?`).run(record.workflowId);
      const q=this.db.query(`INSERT INTO agent_tasks (task_id,workflow_id,parent_task_id,agent_id,role,name,status,review_state,approval_state,phase,parallel_key,dependencies_json,data_json,created_at,updated_at,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const t of record.tasks ?? []) q.run(t.taskId,t.workflowId,t.parentTaskId??null,t.agentId,t.role,t.name,t.status,t.reviewState,t.approvalState,t.phase??null,t.parallelKey??null,JSON.stringify(t.dependencies??[]),JSON.stringify(t),t.createdAt,t.updatedAt,t.startedAt??null,t.endedAt??null);
    });
  }
  getWorkflow(id:string): any { const r=this.db.query<any,[string]>(`SELECT data_json FROM agent_workflows WHERE workflow_id=?`).get(id); try{return r ? JSON.parse(r.data_json) : null}catch{return null} }
  listWorkflowSummaries(limit=20): any[] { return this.db.query<any,[number]>(`SELECT data_json FROM agent_workflows ORDER BY updated_at DESC LIMIT ?`).all(limit).flatMap((r:any)=>{try{return [JSON.parse(r.data_json)]}catch{return []}}); }
  workflowHealth(): any { const total=this.db.query<{c:number},[]>(`SELECT COUNT(*) c FROM agent_workflows`).get()?.c??0; const count=(s:string)=>this.db.query<{c:number},[string]>(`SELECT COUNT(*) c FROM agent_workflows WHERE status=?`).get(s)?.c??0; return {enabledAgents:0,totalAgents:0,workflows:{total,running:count("running"),paused:count("paused"),blocked:count("blocked"),failed:count("failed")}}; }

  /**
   * WAL maintenance: `PRAGMA wal_checkpoint(RESTART)` when no readers are
   * attached; falls back to TRUNCATE otherwise. Bounds WAL growth (T2).
   */
  checkpointWal(mode: "RESTART" | "TRUNCATE" = "RESTART"): { ok: boolean; used: string; detail: string } {
    try {
      const row = this.gate.rawDb
        .query<{ busy: number; log: number; checkpointed: number }, []>(`PRAGMA wal_checkpoint(${mode})`)
        .get();
      if (mode === "RESTART" && row && (row.busy > 0 || row.log > 0)) {
        const row2 = this.gate.rawDb
          .query<{ busy: number; log: number; checkpointed: number }, []>(`PRAGMA wal_checkpoint(TRUNCATE)`)
          .get();
        return { ok: true, used: "TRUNCATE", detail: JSON.stringify(row2) };
      }
      return { ok: true, used: mode, detail: JSON.stringify(row) };
    } catch (e) {
      return { ok: false, used: mode, detail: String((e as Error)?.message ?? e) };
    }
  }

  /**
   * Crash-consistent single-file backup via `VACUUM INTO` under the write
   * gate (T13). The snapshot is verified by returning its SHA-256.
   */
  createBackup(destPath: string): { ok: boolean; path: string; size: number; sha256: string } {
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // VACUUM INTO takes its own consistent snapshot and cannot run inside a
    // transaction — run it directly on the raw handle (it reads a consistent
    // database snapshot, so no write gate is required for correctness).
    this.gate.rawDb.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    const buf = readFileSync(destPath);
    return { ok: true, path: destPath, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  }

  /**
   * Restore from a backup snapshot: closes the current connection, replaces
   * the database file (+ sidecars), and rebinds THIS instance to a fresh
   * connection, so callers keep a valid store. Verifies the audit chain.
   */
  restoreFrom(srcPath: string): { ok: boolean; chainValid: boolean; error?: string } {
    if (!existsSync(srcPath)) return { ok: false, chainValid: false, error: `backup not found: ${srcPath}` };
    const path = this.openedPath;
    const workspaceId = this.workspaceId;
    const key = this.sharedKey;
    this.close();
    for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
      try {
        rmSync(sidecar, { force: true });
      } catch {
        /* best-effort (Windows may hold handles briefly) */
      }
    }
    copyFileSync(srcPath, path);
    // Re-open this instance against the restored file.
    const shared = WorkspaceStore.shared.get(key);
    if (!shared) {
      const db = openDatabase(path);
      const gate = new WriteGate(db);
      WorkspaceStore.shared.set(key, { db, gate, refs: 1 });
    } else {
      shared.refs += 1;
    }
    this.closed = false;
    this.gate = WorkspaceStore.shared.get(key)!.gate;
    this.db = gateConnection(WorkspaceStore.shared.get(key)!.db, this.gate);
    this.migrate();
    runMigrationsUp(this);
    const chain = this.verifyChain();
    return { ok: true, chainValid: chain.valid };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const shared = WorkspaceStore.shared.get(this.sharedKey);
    if (shared) {
      shared.refs -= 1;
      if (shared.refs <= 0) {
        WorkspaceStore.shared.delete(this.sharedKey);
        try {
          this.gate.finalizeAll(); // bun: prepared statements hold the file lock otherwise
        } catch {
          /* best-effort */
        }
        try {
          this.gate.rawDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch {
          /* best-effort */
        }
        try {
          shared.db.close();
        } catch {
          /* best-effort */
        }
      }
    }
    if (WorkspaceStore._lastOpened === this) {
      WorkspaceStore._lastOpened = null;
    }
  }

  /** Number of open read-write connections (per-file, per process). */
  static connectionCount(): number {
    return WorkspaceStore.shared.size;
  }

  /**
   * Phase 1 (T3): total mutating statements that ran outside the write gate
   * across all live connections. The property test asserts this is zero.
   */
  static unsafeWriteCount(): number {
    let n = 0;
    for (const s of WorkspaceStore.shared.values()) n += s.gate.executedOutsideTxn;
    return n;
  }

  /**
   * 0.2 Storage Unification: Returns the most recently opened WorkspaceStore
   * instance (the kernel's single store), or null if none has been opened yet.
   * This allows tool implementations and other code that doesn't have direct
   * access to the DI container to reuse the same database connection.
   */
  static lastOpened(): WorkspaceStore | null {
    return WorkspaceStore._lastOpened;
  }

  get dbPath(): string {
    return this.openedPath;
  }

  // ---- 0.5 Business OS adapter surface ----

  /**
   * Narrow prepared-statement passthrough required by BusinessDatabase
   * (extensions/business-os/src/core/database.ts), which is intentionally adapter-based so
   * Business OS runs on the SAME unified connection as everything else.
   * New XR code should use the typed repos — not raw SQL.
   */
  prepare(sql: string): ReturnType<Database["prepare"]> {
    return this.db.prepare(sql);
  }

  /**
   * Phase 7 · T8 — narrow statement passthrough for the Business OS L0
   * contract (xr_l0_* tables) on the SAME unified connection (single
   * writer). Same discipline as `prepare`: typed repos preferred elsewhere.
   */
  query(sql: string): ReturnType<Database["query"]> {
    return this.db.query(sql);
  }

  /** Transaction passthrough for BusinessDatabase migrations (single writer). */
  transaction<F extends (...args: any[]) => any>(fn: F): (...args: Parameters<F>) => ReturnType<F> {
    return (...args: Parameters<F>) => this.write(() => fn(...args));
  }

  /** Execution-fabric passthrough: run arbitrary DDL/DML. */
  exec(sql: string): void {
    this.db.exec(sql);
  }
}

export { WorkspaceStore as Store };
