/**
 * XR Phase 11 — workspace-scoped repo search.
 */

import { tokenizeQuery } from "./tokens.ts";
import type { RepoSearchHit, RepoSymbol } from "./types.ts";
import type { RepoStore } from "./store.ts";
import { recordQueryMetrics } from "./metrics.ts";

export function searchRepo(store: RepoStore, query: string, limit = 24): RepoSearchHit[] {
  const started = Date.now();
  const terms = tokenizeQuery(query);
  if (terms.length === 0 && !query.trim()) {
    recordQueryMetrics(Date.now() - started);
    return [];
  }
  const hits: RepoSearchHit[] = [];
  const q = query.trim();

  for (const file of store.listFiles()) {
    const path = file.relativePath.toLowerCase();
    let score = 0;
    for (const t of terms) if (path.includes(t)) score += 2;
    if (q && path.includes(q.toLowerCase())) score += 3;
    if (score > 0) {
      hits.push({ relativePath: file.relativePath, kind: "file", name: file.relativePath, score });
    }
  }

  const symbols = q ? store.searchSymbols(q, 80) : [];
  for (const s of symbols) {
    let score = 3;
    if (s.name.toLowerCase() === q.toLowerCase()) score = 10;
    hits.push({
      relativePath: s.file,
      kind: "symbol",
      name: s.name,
      symbolKind: s.kind,
      startLine: s.startLine,
      endLine: s.endLine,
      score,
      snippet: s.signature ?? s.name,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
  recordQueryMetrics(Date.now() - started);
  return hits.slice(0, limit);
}

export function findSymbol(store: RepoStore, name: string): RepoSymbol[] {
  return store.listSymbols({ name, limit: 50 });
}
