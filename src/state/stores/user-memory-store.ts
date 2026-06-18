/**
 * XR — User Memory Store
 * Manages durable, user-controlled long-term memory and session summaries.
 */

import { BaseStore } from "../store.ts";
import type { MemoryEntry, MemoryCategory, MemorySource } from "../../memory/types.ts";
import { lexicalVector, cosine, embed, sameSpace } from "../../memory/embed.ts";

export interface UserMemoryRow {
  id: string;
  category: string;
  content: string;
  scope: string;
  source: string;
  tags: string;
  importance: number;
  created_at: number;
  updated_at: number;
  embedding: string | null;
}

export interface SummaryRow {
  id: string;
  scope: string;
  summary: string;
  created_at: number;
}

function rowToEntry(row: UserMemoryRow): MemoryEntry {
  return {
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    scope: row.scope,
    source: row.source as MemorySource,
    tags: row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RECALL_FLOOR = 0.12;

export class UserMemoryStore extends BaseStore {
  constructor() {
    super();
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS user_memory (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        importance INTEGER NOT NULL DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        embedding TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_memory_scope ON user_memory(scope);
      CREATE INDEX IF NOT EXISTS idx_user_memory_category ON user_memory(category);
      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    try {
      const cols = this.db
        .query<{ name: string }, []>(`PRAGMA table_info(user_memory)`)
        .all();
      if (!cols.some((c) => c.name === "embedding")) {
        this.exec(`ALTER TABLE user_memory ADD COLUMN embedding TEXT`);
      }
    } catch {
      /* fail-soft */
    }
  }

  insertMemory(row: {
    id: string;
    category: string;
    content: string;
    scope: string;
    source: string;
    tags: string;
    importance: number;
    embedding?: number[] | null;
  }): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO user_memory (id,category,content,scope,source,tags,importance,created_at,updated_at,embedding)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
      );
  }

  setMemoryEmbedding(id: string, embedding: number[] | null): void {
    this.db
      .query(`UPDATE user_memory SET embedding=? WHERE id=?`)
      .run(embedding && embedding.length ? JSON.stringify(embedding) : null, id);
  }

  findMemoryByContent(
    scope: string,
    category: string,
    content: string,
  ): UserMemoryRow | null {
    return (
      this.db
        .query<UserMemoryRow, [string, string, string]>(
          `SELECT * FROM user_memory WHERE scope=? AND category=? AND content=? LIMIT 1`,
        )
        .get(scope, category, content) ?? null
    );
  }

  getMemory(id: string): UserMemoryRow | null {
    return (
      this.db
        .query<UserMemoryRow, [string]>(`SELECT * FROM user_memory WHERE id=?`)
        .get(id) ?? null
    );
  }

  findMemoryByPrefix(prefix: string): UserMemoryRow[] {
    return this.db
      .query<UserMemoryRow, [string]>(
        `SELECT * FROM user_memory WHERE id LIKE ? ORDER BY updated_at DESC`,
      )
      .all(prefix + "%");
  }

  listMemory(
    opts: { scope?: string; category?: string; includeExclusions?: boolean } = {},
  ): UserMemoryRow[] {
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
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .query<UserMemoryRow, string[]>(
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
    }>,
  ): boolean {
    const cur = this.getMemory(id);
    if (!cur) return false;
    const textChanged =
      (patch.content !== undefined && patch.content !== cur.content) ||
      (patch.tags !== undefined && patch.tags !== cur.tags);
    this.db
      .query(
        `UPDATE user_memory SET content=?, category=?, scope=?, tags=?, importance=?, updated_at=?, embedding=? WHERE id=?`,
      )
      .run(
        patch.content ?? cur.content,
        patch.category ?? cur.category,
        patch.scope ?? cur.scope,
        patch.tags ?? cur.tags,
        patch.importance ?? cur.importance,
        Date.now(),
        textChanged ? null : cur.embedding,
        id,
      );
    return true;
  }

  deleteMemory(id: string): boolean {
    const r = this.db.query(`DELETE FROM user_memory WHERE id=?`).run(id);
    return ((r as any).changes ?? 0) > 0;
  }

  clearMemory(scope?: string): number {
    if (scope) {
      const r = this.db.query(`DELETE FROM user_memory WHERE scope=?`).run(scope);
      return (r as any).changes ?? 0;
    }
    const r = this.db.query(`DELETE FROM user_memory`).run();
    return (r as any).changes ?? 0;
  }

  count(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM user_memory`)
        .get()?.c ?? 0
    );
  }

  stats(): Array<{ category: string; c: number }> {
    return this.db
      .query<{ category: string; c: number }, []>(
        `SELECT category, COUNT(*) c FROM user_memory GROUP BY category ORDER BY c DESC`,
      )
      .all();
  }


  recall(query: string, opts: { scope?: string; k?: number; floor?: number } = {}): MemoryEntry[] {
    const q = (query ?? "").trim();
    if (!q) return [];
    const k = opts.k ?? 5;
    const floor = opts.floor ?? RECALL_FLOOR;
    const candidates = this.listMemory({ scope: opts.scope });
    if (!candidates.length) return [];
    const qv = lexicalVector(q);
    return candidates
      .map((row) => {
        const sim = cosine(qv, lexicalVector(`${row.content} ${(row.tags || "").split(",").join(" ")}`));
        const score = sim + (row.importance - 3) * 0.0125;
        return { row, sim, score };
      })
      .filter((s) => s.sim >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => rowToEntry(s.row));
  }

  async recallSemantic(query: string, opts: { scope?: string; k?: number; floor?: number } = {}): Promise<MemoryEntry[]> {
    const q = (query ?? "").trim();
    if (!q) return [];
    const k = opts.k ?? 5;
    const floor = opts.floor ?? RECALL_FLOOR;
    const rows = this.listMemory({ scope: opts.scope }).filter((r) => r.category !== "exclusion");
    if (!rows.length) return [];
    let qvec: number[];
    try { qvec = await embed(q); } catch { return this.recall(q, opts); }
    const scored: Array<{ row: UserMemoryRow; sim: number; score: number }> = [];
    for (const row of rows) {
      const text = `${row.content} ${(row.tags || "").split(",").join(" ")}`.trim();
      let stored: number[] | null = null;
      if (row.embedding) {
        try { stored = JSON.parse(row.embedding); } catch { stored = null; }
      }
      if (!stored?.length) {
        try {
          stored = await embed(text);
          this.setMemoryEmbedding(row.id, stored);
        } catch {
          stored = null;
        }
      }
      const sim = stored?.length && sameSpace(stored, qvec)
        ? cosine(qvec, stored)
        : cosine(lexicalVector(q), lexicalVector(text));
      scored.push({ row, sim, score: sim + (row.importance - 3) * 0.0125 });
    }
    return scored
      .filter((s) => s.sim >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => rowToEntry(s.row));
  }

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
}
