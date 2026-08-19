/**
 * XR Phase 11 — SQLite persistence for the repo index.
 *
 * Lives in the existing workspace database (Migration 4). Does not open a
 * second connection. Every row is workspace-stamped; every query requires
 * workspaceId. WorkspaceStore is not grown — we use prepare/exec.
 */

import type { WorkspaceStore } from "../state/workspace-store.ts";
import {
  REPO_INDEX_VERSION,
  REPO_PARSER_VERSION,
  type GitFileStatus,
  type IndexStats,
  type ParserConfidence,
  type RepoEdge,
  type RepoFile,
  type RepoIndexState,
  type RepoSymbol,
} from "./types.ts";

export const REPO_SCHEMA_SQL = `
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
`;

export function ensureRepoSchema(store: WorkspaceStore): void {
  store.exec(REPO_SCHEMA_SQL);
}

export interface RepoMetaRow {
  workspace_id: string;
  root: string;
  git_root: string | null;
  state: string;
  index_version: number;
  parser_version: number;
  indexed_at: number;
  error: string | null;
  stats_json: string;
}

export class RepoStore {
  constructor(
    private readonly store: WorkspaceStore,
    readonly workspaceId: string,
  ) {
    ensureRepoSchema(store);
  }

  getMeta(): RepoMetaRow | null {
    return (
      this.store
        .prepare(`SELECT * FROM repo_index_meta WHERE workspace_id = ?`)
        .get(this.workspaceId) as RepoMetaRow | null
    ) ?? null;
  }

  setMeta(input: {
    root: string;
    gitRoot: string | null;
    state: RepoIndexState;
    error?: string | null;
    stats?: Partial<IndexStats>;
    now?: number;
  }): void {
    const now = input.now ?? Date.now();
    this.store.write(() => {
      this.store
        .prepare(
          `INSERT INTO repo_index_meta
             (workspace_id, root, git_root, state, index_version, parser_version, indexed_at, error, stats_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             root=excluded.root, git_root=excluded.git_root, state=excluded.state,
             index_version=excluded.index_version, parser_version=excluded.parser_version,
             indexed_at=excluded.indexed_at, error=excluded.error, stats_json=excluded.stats_json`,
        )
        .run(
          this.workspaceId,
          input.root,
          input.gitRoot,
          input.state,
          REPO_INDEX_VERSION,
          REPO_PARSER_VERSION,
          now,
          input.error ?? null,
          JSON.stringify(input.stats ?? {}),
        );
    });
  }

  listFiles(): RepoFile[] {
    const rows = this.store
      .prepare(`SELECT * FROM repo_files WHERE workspace_id = ?`)
      .all(this.workspaceId) as Array<{
      path: string;
      content_hash: string;
      size: number;
      language: string | null;
      git_status: string;
      indexed_at: number;
      parser_confidence: string;
    }>;
    return rows.map((r) => ({
      path: r.path,
      relativePath: r.path,
      contentHash: r.content_hash,
      size: r.size,
      language: r.language,
      gitStatus: r.git_status as GitFileStatus,
      lastIndexed: r.indexed_at,
      parserConfidence: r.parser_confidence as ParserConfidence,
    }));
  }

  getFile(path: string): RepoFile | null {
    const r = this.store
      .prepare(`SELECT * FROM repo_files WHERE workspace_id = ? AND path = ?`)
      .get(this.workspaceId, path) as
      | {
          path: string;
          content_hash: string;
          size: number;
          language: string | null;
          git_status: string;
          indexed_at: number;
          parser_confidence: string;
        }
      | null;
    if (!r) return null;
    return {
      path: r.path,
      relativePath: r.path,
      contentHash: r.content_hash,
      size: r.size,
      language: r.language,
      gitStatus: r.git_status as GitFileStatus,
      lastIndexed: r.indexed_at,
      parserConfidence: r.parser_confidence as ParserConfidence,
    };
  }

  upsertFile(file: RepoFile): void {
    this.store
      .prepare(
        `INSERT INTO repo_files
           (workspace_id, path, content_hash, size, language, git_status, indexed_at, parser_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, path) DO UPDATE SET
           content_hash=excluded.content_hash, size=excluded.size, language=excluded.language,
           git_status=excluded.git_status, indexed_at=excluded.indexed_at,
           parser_confidence=excluded.parser_confidence`,
      )
      .run(
        this.workspaceId,
        file.relativePath,
        file.contentHash,
        file.size,
        file.language,
        file.gitStatus,
        file.lastIndexed,
        file.parserConfidence,
      );
  }

  deleteFile(path: string): void {
    this.store.write(() => {
      this.store.prepare(`DELETE FROM repo_files WHERE workspace_id = ? AND path = ?`).run(this.workspaceId, path);
      this.store.prepare(`DELETE FROM repo_symbols WHERE workspace_id = ? AND file_path = ?`).run(this.workspaceId, path);
      this.store.prepare(`DELETE FROM repo_edges WHERE workspace_id = ? AND (from_file = ? OR to_file = ?)`).run(
        this.workspaceId,
        path,
        path,
      );
    });
  }

  replaceFileGraph(path: string, symbols: readonly RepoSymbol[], edges: readonly RepoEdge[]): void {
    this.store.write(() => {
      this.store.prepare(`DELETE FROM repo_symbols WHERE workspace_id = ? AND file_path = ?`).run(this.workspaceId, path);
      this.store.prepare(`DELETE FROM repo_edges WHERE workspace_id = ? AND from_file = ?`).run(this.workspaceId, path);
      const insS = this.store.prepare(
        `INSERT OR REPLACE INTO repo_symbols
           (workspace_id, symbol_id, file_path, name, kind, start_line, end_line, signature, exported)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const sy of symbols) {
        insS.run(this.workspaceId, sy.id, path, sy.name, sy.kind, sy.startLine, sy.endLine, sy.signature, sy.exported ? 1 : 0);
      }
      const insE = this.store.prepare(
        `INSERT OR REPLACE INTO repo_edges
           (workspace_id, from_file, to_file, edge_type, symbol, kind, specifier)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of edges) {
        insE.run(this.workspaceId, e.fromFile, e.toFile, e.edgeType, e.symbol, e.kind, e.specifier);
      }
    });
  }

  listSymbols(opts: { file?: string; name?: string; limit?: number } = {}): RepoSymbol[] {
    const limit = Math.min(opts.limit ?? 500, 2000);
    let sql = `SELECT * FROM repo_symbols WHERE workspace_id = ?`;
    const params: Array<string | number> = [this.workspaceId];
    if (opts.file) {
      sql += ` AND file_path = ?`;
      params.push(opts.file);
    }
    if (opts.name) {
      sql += ` AND name = ?`;
      params.push(opts.name);
    }
    sql += ` LIMIT ?`;
    params.push(limit);
    const rows = this.store.prepare(sql).all(...params) as Array<{
      symbol_id: string;
      file_path: string;
      name: string;
      kind: string;
      start_line: number;
      end_line: number;
      signature: string | null;
      exported: number;
    }>;
    return rows.map((r) => ({
      id: r.symbol_id,
      file: r.file_path,
      name: r.name,
      kind: r.kind as RepoSymbol["kind"],
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      exported: r.exported === 1,
    }));
  }

  searchSymbols(query: string, limit = 40): RepoSymbol[] {
    const q = query.trim();
    if (!q) return [];
    const rows = this.store
      .prepare(
        `SELECT * FROM repo_symbols WHERE workspace_id = ? AND (name LIKE ? OR signature LIKE ?) LIMIT ?`,
      )
      .all(this.workspaceId, `%${q}%`, `%${q}%`, Math.min(limit, 200)) as Array<{
      symbol_id: string;
      file_path: string;
      name: string;
      kind: string;
      start_line: number;
      end_line: number;
      signature: string | null;
      exported: number;
    }>;
    return rows.map((r) => ({
      id: r.symbol_id,
      file: r.file_path,
      name: r.name,
      kind: r.kind as RepoSymbol["kind"],
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      exported: r.exported === 1,
    }));
  }

  listEdges(opts: { from?: string; to?: string; limit?: number } = {}): RepoEdge[] {
    const limit = Math.min(opts.limit ?? 2000, 10_000);
    let sql = `SELECT * FROM repo_edges WHERE workspace_id = ?`;
    const params: Array<string | number> = [this.workspaceId];
    if (opts.from) {
      sql += ` AND from_file = ?`;
      params.push(opts.from);
    }
    if (opts.to) {
      sql += ` AND to_file = ?`;
      params.push(opts.to);
    }
    sql += ` LIMIT ?`;
    params.push(limit);
    const rows = this.store.prepare(sql).all(...params) as Array<{
      from_file: string;
      to_file: string;
      edge_type: string;
      symbol: string | null;
      kind: string;
      specifier: string;
    }>;
    return rows.map((r) => ({
      fromFile: r.from_file,
      toFile: r.to_file,
      edgeType: r.edge_type as RepoEdge["edgeType"],
      symbol: r.symbol,
      kind: r.kind as RepoEdge["kind"],
      specifier: r.specifier,
    }));
  }

  getParseCache(contentHash: string): string | null {
    const row = this.store
      .prepare(
        `SELECT payload FROM repo_parse_cache WHERE workspace_id = ? AND content_hash = ? AND parser_version = ?`,
      )
      .get(this.workspaceId, contentHash, REPO_PARSER_VERSION) as { payload: string } | null;
    return row?.payload ?? null;
  }

  putParseCache(contentHash: string, language: string, payload: string): void {
    this.store
      .prepare(
        `INSERT OR REPLACE INTO repo_parse_cache (workspace_id, content_hash, parser_version, language, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(this.workspaceId, contentHash, REPO_PARSER_VERSION, language, payload);
  }

  invalidateIfVersionChanged(): boolean {
    const meta = this.getMeta();
    if (!meta) return false;
    if (meta.index_version === REPO_INDEX_VERSION && meta.parser_version === REPO_PARSER_VERSION) return false;
    this.store.write(() => {
      this.store.prepare(`DELETE FROM repo_files WHERE workspace_id = ?`).run(this.workspaceId);
      this.store.prepare(`DELETE FROM repo_symbols WHERE workspace_id = ?`).run(this.workspaceId);
      this.store.prepare(`DELETE FROM repo_edges WHERE workspace_id = ?`).run(this.workspaceId);
      this.store.prepare(`DELETE FROM repo_parse_cache WHERE workspace_id = ?`).run(this.workspaceId);
      this.store.prepare(`DELETE FROM repo_index_meta WHERE workspace_id = ?`).run(this.workspaceId);
    });
    return true;
  }

  counts(): { files: number; symbols: number; edges: number } {
    const files = (this.store.prepare(`SELECT COUNT(*) c FROM repo_files WHERE workspace_id = ?`).get(this.workspaceId) as { c: number })?.c ?? 0;
    const symbols = (this.store.prepare(`SELECT COUNT(*) c FROM repo_symbols WHERE workspace_id = ?`).get(this.workspaceId) as { c: number })?.c ?? 0;
    const edges = (this.store.prepare(`SELECT COUNT(*) c FROM repo_edges WHERE workspace_id = ?`).get(this.workspaceId) as { c: number })?.c ?? 0;
    return { files, symbols, edges };
  }
}
