/**
 * XR — state store (SQLite via Bun's built-in driver).
 * Sessions + steps + the tamper-evident, hash-chained audit log.
 * (TRD §1 / schema doc 05. This is our "blockchain-grade" tamper evidence — free & offline.)
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { XR_HOME } from "../config/config.ts";

const GENESIS = "xr-genesis";

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
  /** Stage 6: access tracking + retention. */
  last_accessed_at: number | null;
  access_count: number;
  expires_at: number | null;
}

/** v0.9: a session summary row (kept separate from long-term memory). */
export interface SummaryRow {
  id: string;
  scope: string;
  summary: string;
  created_at: number;
}

export class WorkspaceStore {
  private static openConnections = 0;
  /** 0.2 Storage Unification: Track the last-opened instance for singleton access. */
  private static _lastOpened: WorkspaceStore | null = null;
  private db: Database;
  private readonly openedPath: string;

  public readonly workspaceId: string;

  constructor(workspaceIdOrPath: string = "default", path?: string) {
    const legacyPath = path === undefined && (workspaceIdOrPath.includes("/") || workspaceIdOrPath.endsWith(".db"));
    this.workspaceId = legacyPath ? "default" : workspaceIdOrPath;
    path = legacyPath ? workspaceIdOrPath : (path ?? join(XR_HOME, "xr.db"));
    // Ensure the home dir exists before opening the DB ("never breaks" rule).
    if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
    const parent = dirname(path);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    this.openedPath = path;
    this.db = new Database(path, { create: true });
    WorkspaceStore.openConnections += 1;
    WorkspaceStore._lastOpened = this;
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
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
        created_at INTEGER NOT NULL
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
    } catch {
      /* never block startup on a migration probe */
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

  audit(
    event: string,
    detail: Record<string, unknown>,
    sessionId: string | null = null,
  ): string {
    const prev = this.lastHash();
    const ts = Date.now();
    const safe = this.redact(detail);
    const payload = JSON.stringify({ event, detail: safe, prev, ts });
    const hash = createHash("sha256").update(payload).digest("hex");
    this.db
      .query(
        `INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(sessionId, event, JSON.stringify(safe), prev, hash, ts);
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
        return { valid: false, brokenAt: r.id };
      }
      prev = r.hash;
    }
    return { valid: true };
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
    this.db.query(`UPDATE skills SET active=0 WHERE id=?`).run(id);
    this.db.query(`UPDATE skills SET active=1 WHERE id=? AND version=?`).run(id, version);
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
    const exists = this.db
      .query<{ c: number }, [string, string, string]>(
        `SELECT COUNT(*) c FROM memory WHERE project=? AND kind=? AND content=?`,
      )
      .get(project, kind, content);
    if (exists && exists.c > 0) return;
    this.db
      .query(`INSERT INTO memory (id,project,kind,content,created_at) VALUES (?,?,?,?,?)`)
      .run(id, project, kind, content, Date.now());
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
  ): void {
    this.db
      .query(
        `INSERT INTO cost_events (session_id,provider,model,in_tokens,out_tokens,usd,created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(sessionId, provider, model, inTokens, outTokens, usd, Date.now());
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
    this.db.transaction(() => {
      this.db.query(`INSERT INTO agent_workflows (workflow_id,kind,goal,status,review_state,approval_state,cancellation_state,current_agent_id,plan_summary,final_output,data_json,created_at,updated_at,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET kind=excluded.kind,goal=excluded.goal,status=excluded.status,review_state=excluded.review_state,approval_state=excluded.approval_state,cancellation_state=excluded.cancellation_state,current_agent_id=excluded.current_agent_id,plan_summary=excluded.plan_summary,final_output=excluded.final_output,data_json=excluded.data_json,updated_at=excluded.updated_at,started_at=excluded.started_at,ended_at=excluded.ended_at`).run(record.workflowId,record.kind,record.goal,record.status,record.reviewState,record.approvalState,record.cancellationState,record.currentAgentId ?? null,record.planSummary,record.finalOutput ? JSON.stringify(record.finalOutput) : null,JSON.stringify(record),record.createdAt ?? now,record.updatedAt ?? now,record.startedAt ?? null,record.endedAt ?? null);
      this.db.query(`DELETE FROM agent_tasks WHERE workflow_id=?`).run(record.workflowId);
      const q=this.db.query(`INSERT INTO agent_tasks (task_id,workflow_id,parent_task_id,agent_id,role,name,status,review_state,approval_state,phase,parallel_key,dependencies_json,data_json,created_at,updated_at,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const t of record.tasks ?? []) q.run(t.taskId,t.workflowId,t.parentTaskId??null,t.agentId,t.role,t.name,t.status,t.reviewState,t.approvalState,t.phase??null,t.parallelKey??null,JSON.stringify(t.dependencies??[]),JSON.stringify(t),t.createdAt,t.updatedAt,t.startedAt??null,t.endedAt??null);
    })();
  }
  getWorkflow(id:string): any { const r=this.db.query<any,[string]>(`SELECT data_json FROM agent_workflows WHERE workflow_id=?`).get(id); try{return r ? JSON.parse(r.data_json) : null}catch{return null} }
  listWorkflowSummaries(limit=20): any[] { return this.db.query<any,[number]>(`SELECT data_json FROM agent_workflows ORDER BY updated_at DESC LIMIT ?`).all(limit).flatMap((r:any)=>{try{return [JSON.parse(r.data_json)]}catch{return []}}); }
  workflowHealth(): any { const total=this.db.query<{c:number},[]>(`SELECT COUNT(*) c FROM agent_workflows`).get()?.c??0; const count=(s:string)=>this.db.query<{c:number},[string]>(`SELECT COUNT(*) c FROM agent_workflows WHERE status=?`).get(s)?.c??0; return {enabledAgents:0,totalAgents:0,workflows:{total,running:count("running"),paused:count("paused"),blocked:count("blocked"),failed:count("failed")}}; }

  close(): void {
    this.db.close();
    WorkspaceStore.openConnections = Math.max(0, WorkspaceStore.openConnections - 1);
    if (WorkspaceStore._lastOpened === this) {
      WorkspaceStore._lastOpened = null;
    }
  }

  static connectionCount(): number {
    return WorkspaceStore.openConnections;
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
}

export { WorkspaceStore as Store };
