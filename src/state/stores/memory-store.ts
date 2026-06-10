/**
 * XR — Memory Store
 * Manages project-level durable memory and RAG chunk indexing.
 */

import { BaseStore } from "../store.ts";

export interface MemoryEntry {
  id: string;
  kind: string;
  content: string;
}

export interface RagChunk {
  id: string;
  path: string;
  text: string;
  embedding: string | null;
}

export class MemoryStore extends BaseStore {
  constructor() {
    super();
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        path TEXT NOT NULL,
        chunk_idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

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

  recall(project: string, kind?: string): MemoryEntry[] {
    if (kind) {
      return this.db
        .query<MemoryEntry, [string, string]>(
          `SELECT id,kind,content FROM memory WHERE project=? AND kind=? ORDER BY created_at DESC`,
        )
        .all(project, kind);
    }
    return this.db
      .query<MemoryEntry, [string]>(
        `SELECT id,kind,content FROM memory WHERE project=? ORDER BY created_at DESC`,
      )
      .all(project);
  }

  forget(id: string): void {
    this.db.query(`DELETE FROM memory WHERE id=?`).run(id);
  }

  count(project: string): number {
    return (
      this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM memory WHERE project=?`)
        .get(project)?.c ?? 0
    );
  }

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
  ): RagChunk[] {
    return this.db
      .query<RagChunk, [string]>(
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
}
