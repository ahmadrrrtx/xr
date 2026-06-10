/**
 * XR — Session Store
 * Manages conversation sessions and individual execution steps.
 */

import { BaseStore } from "../store.ts";

export interface Session {
  id: string;
  title: string;
  mode: string;
  status: string;
  created_at: number;
}

export interface Step {
  id: string;
  session_id: string;
  idx: number;
  phase: string;
  tool: string | null;
  detail: string;
  created_at: number;
}

export class SessionStore extends BaseStore {
  constructor() {
    super();
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
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
    `);
  }

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

  recentSessions(limit = 50): Session[] {
    return this.db
      .query<Session, [number]>(
        `SELECT id,title,mode,status,created_at FROM sessions ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
  }
}
