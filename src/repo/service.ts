/**
 * XR Phase 11 — public Repo Intelligence API.
 *
 * All methods require workspaceId. Nothing here grants capability; tools
 * wrap these calls so Policy / Approval / Audit still apply.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import { loadRepoConfig } from "./config.ts";
import { readDiff, readGitSnapshot } from "./git.ts";
import { indexRepository, indexStatus } from "./indexer.ts";
import { recordMapMetrics } from "./metrics.ts";
import { rankFiles } from "./ranking.ts";
import { generateRepoMap } from "./repo-map.ts";
import { findSymbol, searchRepo } from "./search.ts";
import { RepoStore } from "./store.ts";
import type {
  IndexStats,
  RankedFile,
  RepoDiffHunk,
  RepoEdge,
  RepoFileContext,
  RepoMapResult,
  RepoSearchHit,
  RepoSymbol,
} from "./types.ts";

export interface RepoServiceHandle {
  workspaceId: string;
  root: string;
  store: WorkspaceStore;
}

export class RepoIntelligence {
  constructor(private readonly handle: RepoServiceHandle) {}

  private repo(): RepoStore {
    return new RepoStore(this.handle.store, this.handle.workspaceId);
  }

  status(): IndexStats {
    return indexStatus(this.handle.store, this.handle.workspaceId);
  }

  async index(opts: { force?: boolean } = {}): Promise<IndexStats> {
    return indexRepository({
      workspaceId: this.handle.workspaceId,
      root: this.handle.root,
      store: this.handle.store,
      force: opts.force,
    });
  }

  async ensureIndexed(): Promise<IndexStats> {
    const st = this.status();
    if (st.state === "ready" && st.files > 0) return st;
    return this.index();
  }

  async map(query = "", tokenBudget?: number): Promise<RepoMapResult> {
    await this.ensureIndexed();
    const ranked = this.rank(query);
    const result = generateRepoMap(ranked, {
      query,
      tokenBudget: tokenBudget ?? loadRepoConfig().mapTokens,
    });
    recordMapMetrics(result);
    return result;
  }

  rank(query: string): RankedFile[] {
    const repo = this.repo();
    return rankFiles({
      query,
      files: repo.listFiles(),
      symbols: collectSymbols(repo),
      edges: repo.listEdges({ limit: 8_000 }),
    });
  }

  search(query: string, limit = 24): RepoSearchHit[] {
    return searchRepo(this.repo(), query, limit);
  }

  symbols(name: string): RepoSymbol[] {
    return findSymbol(this.repo(), name);
  }

  dependencies(file: string): { outbound: RepoEdge[]; inbound: RepoEdge[] } {
    const repo = this.repo();
    return {
      outbound: repo.listEdges({ from: file, limit: 200 }),
      inbound: repo.listEdges({ to: file, limit: 200 }),
    };
  }

  fileContext(path: string, opts: { symbol?: string; around?: number } = {}): RepoFileContext | null {
    const repo = this.repo();
    const file = repo.getFile(path);
    if (!file) return null;
    const symbols = repo.listSymbols({ file: path, limit: 200 });
    const cfg = loadRepoConfig();
    let start = 1;
    let end = cfg.maxFileContextLines;
    let reason = "file head";
    if (opts.symbol) {
      const hit = symbols.find((s) => s.name === opts.symbol) ?? symbols.find((s) => s.name.includes(opts.symbol!));
      if (hit) {
        const pad = opts.around ?? 4;
        start = Math.max(1, hit.startLine - pad);
        end = hit.endLine + pad;
        reason = `symbol ${hit.name} (${hit.kind})`;
      }
    }
    const abs = join(this.handle.root, path);
    let text = "";
    try {
      const lines = readFileSync(abs, "utf8").split(/\r?\n/);
      end = Math.min(lines.length, end);
      text = lines.slice(start - 1, end).join("\n");
    } catch {
      return null;
    }
    return {
      relativePath: path,
      language: file.language,
      startLine: start,
      endLine: end,
      text,
      symbols,
      reason,
    };
  }

  async diff(file?: string): Promise<RepoDiffHunk[]> {
    return readDiff(this.handle.root, file);
  }

  async gitStatus(): Promise<Record<string, string>> {
    const snap = await readGitSnapshot(this.handle.root);
    const out: Record<string, string> = {};
    for (const [k, v] of snap.status) out[k] = v;
    return out;
  }
}

function collectSymbols(repo: RepoStore): RepoSymbol[] {
  const out: RepoSymbol[] = [];
  for (const f of repo.listFiles()) {
    out.push(...repo.listSymbols({ file: f.relativePath, limit: 400 }));
    if (out.length > 20_000) break;
  }
  return out;
}

export function createRepoIntelligence(handle: RepoServiceHandle): RepoIntelligence {
  return new RepoIntelligence(handle);
}
