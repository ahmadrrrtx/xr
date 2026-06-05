/**
 * XR — state store (SQLite via Bun's built-in driver).
 * Sessions + steps + the tamper-evident, hash-chained audit log.
 * (TRD §1 / schema doc 05. This is our "blockchain-grade" tamper evidence — free & offline.)
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { XR_HOME } from "../config/config.ts";

const GENESIS = "xr-genesis";

export class Store {
  private db: Database;

  constructor(path = join(XR_HOME, "xr.db")) {
    // Ensure the home dir exists before opening the DB ("never breaks" rule).
    if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
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
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        spec TEXT NOT NULL,            -- JSON Schedule
        created_at INTEGER NOT NULL
      );
    `);
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

  setBudgetConfig(config: { monthly_cap: number; daily_cap?: number; warnings_enabled?: boolean; auto_fallback?: boolean }): void {
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
  recentAudit(limit = 50): Array<{ id: number; event: string; detail: string; hash: string; created_at: number }> {
    return this.db
      .query<{ id: number; event: string; detail: string; hash: string; created_at: number }, [number]>(
        `SELECT id,event,detail,hash,created_at FROM audit_log ORDER BY id DESC LIMIT ?`,
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

  close(): void {
    this.db.close();
  }
}
