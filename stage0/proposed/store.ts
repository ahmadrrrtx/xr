/**
 * XR — Unified WorkspaceStore (storage consolidation)
 *
 * Replaces:
 *   - src/state/db.ts  (Store, 996-line god-object)
 *   - src/state/stores/*.ts (7 specialized stores, each its OWN connection)
 *
 * Design:
 *   - EXACTLY ONE SQLite connection per active workspace.
 *   - All tables are created ONCE in `migrate()` (no schema split across files).
 *   - "Repos" are thin, typed namespaces over the shared connection. They never
 *     open their own DB. This eliminates the dual-DB fragmentation bug where a
 *     single `xr "task"` wrote sessions/costs to ~/.xr/xr.db and audit/memory
 *     to the workspace DB.
 *   - Business OS tables are OPTIONAL and gated behind a feature flag, so the
 *     "Stage 15 Business OS" can be truly initialized or cleanly absent.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { XR_HOME } from "../config/config.ts";

export interface Repo {
  readonly name: string;
}

export class WorkspaceStore {
  private db: Database;
  readonly repos: Record<string, Repo> = {};

  constructor(
    public readonly workspaceId: string,
    dbPath: string = join(XR_HOME, "xr.db"),
  ) {
    if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  /** Run a function inside a transaction; repos use this for writes. */
  tx<T>(fn: (db: Database) => T): T {
    const run = this.db.transaction(fn);
    return run(this.db);
  }

  get raw(): Database {
    return this.db;
  }

  /** Register a repo namespace over this store (no new connection). */
  addRepo(name: string, make: (db: Database, store: WorkspaceStore) => Repo): this {
    this.repos[name] = make(this.db, this);
    return this;
  }

  close(): void {
    this.db.close();
  }

  /**
   * ALL schema in one place. Add new namespaces here, not in separate files.
   * (Port the existing creates from Store.migrate() + the 7 specialized
   * stores' migrate() methods; keep the existing hash-chained audit_log.)
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS steps (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, idx INTEGER NOT NULL, phase TEXT NOT NULL, tool TEXT, detail TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS user_memory (id TEXT PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', importance INTEGER NOT NULL DEFAULT 3, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, embedding TEXT, last_accessed_at INTEGER, access_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS skills (id TEXT NOT NULL, version INTEGER NOT NULL, source TEXT NOT NULL, why TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, PRIMARY KEY (id, version));
      CREATE TABLE IF NOT EXISTS cost_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, provider TEXT, model TEXT NOT NULL, in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, usd REAL NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS budget_config (id INTEGER PRIMARY KEY CHECK (id = 1), monthly_cap REAL NOT NULL, daily_cap REAL, warnings_enabled INTEGER NOT NULL DEFAULT 1, auto_fallback INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS research_sessions (id TEXT PRIMARY KEY, topic TEXT NOT NULL, depth TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_workflows (workflow_id TEXT PRIMARY KEY, kind TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, review_state TEXT NOT NULL, approval_state TEXT NOT NULL, cancellation_state TEXT NOT NULL, current_agent_id TEXT, plan_summary TEXT NOT NULL, final_output TEXT, data_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER);
    `);
    // Optional business schema — gated by caller (only created when business is enabled).
  }

  /** Call only when config.business.enabled is true. Idempotent. */
  migrateBusiness(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS biz_orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS biz_contacts (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL);
      -- ... port BusinessDatabase schema here, ONCE ...
    `);
  }
}
