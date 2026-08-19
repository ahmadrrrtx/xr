/**
 * XR Phase 11 — incremental, content-addressed repository indexer.
 *
 * Lifecycle: not_indexed → indexing → ready | failed.
 * Concurrent index jobs for the same workspace coalesce.
 * Unchanged files (same sha256 + parser version) are not re-parsed.
 * Deleted files disappear from files, symbols, edges, search, and the map.
 * Never marks a partial/corrupt index `ready`.
 */

import { readFileSync } from "node:fs";
import { loadRepoConfig } from "./config.ts";
import { resolveDependencies } from "./dependencies.ts";
import { hashFile } from "./hash.ts";
import { readGitSnapshot } from "./git.ts";
import { parseSource } from "./parser/index.ts";
import { scanRepository } from "./scanner.ts";
import { RepoStore } from "./store.ts";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import {
  REPO_INDEX_VERSION,
  REPO_PARSER_VERSION,
  type GitFileStatus,
  type IndexStats,
  type ParseResult,
  type RepoFile,
} from "./types.ts";
import { recordIndexMetrics } from "./metrics.ts";

const inflight = new Map<string, Promise<IndexStats>>();

export interface IndexRequest {
  workspaceId: string;
  root: string;
  store: WorkspaceStore;
  force?: boolean;
}

export function indexStatus(store: WorkspaceStore, workspaceId: string): IndexStats {
  const repo = new RepoStore(store, workspaceId);
  const meta = repo.getMeta();
  const counts = repo.counts();
  const parsed = meta ? safeJson(meta.stats_json) : {};
  return {
    state: (meta?.state as IndexStats["state"]) ?? "not_indexed",
    files: counts.files,
    symbols: counts.symbols,
    edges: counts.edges,
    changedFiles: Number(parsed.changedFiles ?? 0),
    deletedFiles: Number(parsed.deletedFiles ?? 0),
    cacheHits: Number(parsed.cacheHits ?? 0),
    cacheMisses: Number(parsed.cacheMisses ?? 0),
    errors: Number(parsed.errors ?? 0),
    durationMs: Number(parsed.durationMs ?? 0),
    error: meta?.error ?? undefined,
  };
}

export async function indexRepository(req: IndexRequest): Promise<IndexStats> {
  const key = `${req.workspaceId}::${req.root}`;
  const existing = inflight.get(key);
  if (existing && !req.force) return existing;
  const job = runIndex(req).finally(() => {
    if (inflight.get(key) === job) inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

async function runIndex(req: IndexRequest): Promise<IndexStats> {
  const started = Date.now();
  const repo = new RepoStore(req.store, req.workspaceId);
  repo.invalidateIfVersionChanged();
  const cfg = loadRepoConfig();

  repo.setMeta({ root: req.root, gitRoot: null, state: "indexing", stats: { state: "indexing", files: 0, symbols: 0, edges: 0, changedFiles: 0, deletedFiles: 0, cacheHits: 0, cacheMisses: 0, errors: 0, durationMs: 0 } });

  try {
    const scanned = scanRepository(req.root, { maxFiles: cfg.maxFiles });
    const git = await readGitSnapshot(req.root);
    const known = new Set(scanned.map((f) => f.relativePath));
    const existing = new Map(repo.listFiles().map((f) => [f.relativePath, f]));

    let cacheHits = 0;
    let cacheMisses = 0;
    let changedFiles = 0;
    let errors = 0;

    // Deletions first so stale symbols cannot linger.
    let deletedFiles = 0;
    for (const [path] of existing) {
      if (!known.has(path)) {
        repo.deleteFile(path);
        deletedFiles += 1;
      }
    }

    for (const file of scanned) {
      const hash = hashFile(file.absolute);
      if (!hash) {
        errors += 1;
        continue;
      }
      const prev = existing.get(file.relativePath);
      const gitStatus: GitFileStatus = git.status.get(file.relativePath) ?? "clean";
      if (prev && prev.contentHash === hash && !req.force) {
        if (prev.gitStatus !== gitStatus) {
          repo.upsertFile({ ...prev, gitStatus, lastIndexed: prev.lastIndexed });
        }
        cacheHits += 1;
        continue;
      }

      cacheMisses += 1;
      changedFiles += 1;
      let parsed: ParseResult | null = null;
      const cached = repo.getParseCache(hash);
      if (cached && !req.force) {
        try {
          parsed = JSON.parse(cached) as ParseResult;
          cacheHits += 1;
          cacheMisses -= 1;
        } catch {
          parsed = null;
        }
      }
      if (!parsed) {
        let source = "";
        try {
          source = readFileSync(file.absolute, "utf8");
        } catch {
          errors += 1;
          continue;
        }
        parsed = parseSource(file.relativePath, source);
        try {
          repo.putParseCache(hash, parsed.language, JSON.stringify(parsed));
        } catch {
          /* cache write is best-effort */
        }
      }

      const rec: RepoFile = {
        path: file.relativePath,
        relativePath: file.relativePath,
        contentHash: hash,
        size: file.size,
        language: parsed.language,
        gitStatus,
        lastIndexed: Date.now(),
        parserConfidence: parsed.confidence,
      };
      repo.upsertFile(rec);
      const edges = resolveDependencies(req.root, file.relativePath, parsed.imports, known);
      repo.replaceFileGraph(file.relativePath, parsed.symbols, edges);
    }

    const counts = repo.counts();
    const stats: IndexStats = {
      state: "ready",
      files: counts.files,
      symbols: counts.symbols,
      edges: counts.edges,
      changedFiles,
      deletedFiles,
      cacheHits,
      cacheMisses,
      errors,
      durationMs: Date.now() - started,
    };
    repo.setMeta({
      root: req.root,
      gitRoot: git.gitRoot,
      state: "ready",
      stats,
    });
    recordIndexMetrics(stats);
    return stats;
  } catch (err) {
    const stats: IndexStats = {
      state: "failed",
      files: 0,
      symbols: 0,
      edges: 0,
      changedFiles: 0,
      deletedFiles: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 1,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
    repo.setMeta({
      root: req.root,
      gitRoot: null,
      state: "failed",
      error: stats.error,
      stats,
    });
    recordIndexMetrics(stats);
    return stats;
  }
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export { REPO_INDEX_VERSION, REPO_PARSER_VERSION };
