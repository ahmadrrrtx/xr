/**
 * XR 4.6 — Phase 6 · T2: hybrid retrieval channels + Reciprocal Rank Fusion.
 *
 * Prior to this module the pipeline ranked each item with EITHER a semantic
 * cosine (when a cached vector existed in the routed space) OR a lexical
 * cosine — never both, and never anything structured. That is selection, not
 * hybrid: one weak channel drags the whole ranking.
 *
 * This module defines the three retrieval channels and fuses them:
 *
 *   1. LEXICAL    — deterministic hashing-vector cosine (always available,
 *                   fully offline; the mandatory local-only baseline).
 *   2. SEMANTIC   — routed embedding cosine when the item has a cached vector
 *                   in the active embedding space; null (abstains) otherwise.
 *   3. STRUCTURED — deterministic metadata matching over tags, provenance,
 *                   type hints, scope and actor. Abstains on empty queries.
 *
 * Fusion is RECIPROCAL RANK FUSION (RRF, k=60): each participating channel
 * contributes 1/(k + rank_in_channel). RRF is deliberately score-free — a
 * channel cannot drown another merely because its raw scores are scaled
 * differently, and abstaining channels simply do not vote. This is the
 * production pattern for hybrid memory retrieval (research note R8, cited
 * external measurement: BM25+vector hybrid lifted LongMemEval R@5 from
 * 86.2% → 95.2% — https://github.com/rohitg00/agentmemory).
 *
 * Everything here is deterministic given the same inputs; no model is called.
 * Explanations record every channel's pre-fusion score (lineage-first).
 */

import { cosine, lexicalVector } from "./memory/embed.ts";
import type { ContextItem } from "./types.ts";

/** RRF smoothing constant — the standard literature value. */
export const RRF_K = 60;

/** The three channels, in contribution order. */
export type HybridChannel = "lexical" | "semantic" | "structured";

export interface ChannelScores {
  lexical: number;
  semantic: number;
  structured: number;
}

export interface HybridCandidate {
  item: ContextItem;
  /** Raw channel scores in 0..1. Semantic is null when the channel abstains. */
  scores: { lexical: number; semantic: number | null; structured: number };
}

export type FusedCandidate = HybridCandidate & {
  /** Fused score in 0..1 (normalised RRF). */
  fused: number;
  /** The mode label for the explanation: hybrid when >1 channel voted. */
  mode: "hybrid" | "semantic" | "lexical";
  /** Channels that actually voted (for the policy detail line). */
  voted: HybridChannel[];
};

// ── Channel scorers ─────────────────────────────────────────────────────────

/** Lexical channel: hashing-vector cosine over title+content+tags. */
export function lexicalScore(query: string, text: string): number {
  if (!query.trim()) return 1; // no query → recency/trust ordering (see retrieval)
  return Math.max(0, cosine(queryLexicalCached(query), lexicalVector(text)));
}

const qLexCache = new Map<string, number[]>();
function queryLexicalCached(query: string): number[] {
  const cached = qLexCache.get(query);
  if (cached) return cached;
  const v = lexicalVector(query);
  // Unbounded-query guard: cap the cache so a long-running agent cannot grow it.
  if (qLexCache.size > 64) qLexCache.clear();
  qLexCache.set(query, v);
  return v;
}

/**
 * Structured channel: metadata overlap between the query terms and the item's
 * tags, type, provenance kind, and scope. Exact, explainable signals only —
 * a tag match is worth 3 title-ish token matches because the user (or policy)
 * curated it.
 */
export function structuredScore(query: string, item: ContextItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const tokens = new Set((q.match(/[a-z0-9_:.-]+/g) ?? []).filter((t) => t.length > 1));
  if (tokens.size === 0) return 0;

  let weights = 0;
  let hits = 0;

  // Tags (weight 3 each).
  for (const tag of item.tags) {
    const t = tag.toLowerCase();
    if (!t) continue;
    weights += 3;
    if (tokens.has(t) || q.includes(t)) hits += 3;
  }

  // Type hint ("type:knowledge", or the bare type word as a tag-like token).
  for (const hint of [`type:${item.type}`]) {
    weights += 2;
    if (tokens.has(hint)) hits += 2;
  }

  // Provenance kind hint ("source:web" / "from:file").
  for (const hint of [`source:${item.provenanceKind}`, `from:${item.provenanceKind}`]) {
    weights += 1;
    if (tokens.has(hint)) hits += 1;
  }

  // Scope hint ("scope:project" / a project-scope word in the query).
  if (item.scope.projectScope && item.scope.projectScope !== "global") {
    weights += 1;
    if (tokens.has(item.scope.projectScope.toLowerCase())) hits += 1;
  }

  if (weights === 0) return 0;
  return hits / weights;
}

// ── Fusion ──────────────────────────────────────────────────────────────────

/**
 * Fuse channel scores with Reciprocal Rank Fusion.
 *
 * Each channel produces a ranking of the candidates; each candidate's fused
 * score is Σ 1/(k + rank). Scores are then normalised to 0..1 against the
 * best candidate so downstream floors and rerankers stay comparable to the
 * pre-hybrid similarity scale.
 *
 * Note: fusion metadata is keyed by item id so callers with richer candidate
 * types can zip it back into their own structures without unsafe generics.
 */
export function fuseRRF(candidates: readonly HybridCandidate[]): FusedCandidate[] {
  if (candidates.length === 0) return [];

  // Build one ranked ordering per channel (abstaining channels skip).
  const rankings: Map<HybridChannel, Map<string, number>> = new Map();

  const rankBy = (channel: HybridChannel, key: (c: HybridCandidate) => number | null): void => {
    const scorable = candidates
      .map((c) => ({ c, s: key(c) }))
      .filter((x): x is { c: HybridCandidate; s: number } => x.s !== null);
    scorable.sort((a, b) => b.s - a.s || (a.c.item.id < b.c.item.id ? -1 : 1));
    const pos = new Map<string, number>();
    scorable.forEach((x, i) => pos.set(x.c.item.id, i));
    rankings.set(channel, pos);
  };

  rankBy("lexical", (c) => c.scores.lexical);
  rankBy("semantic", (c) => c.scores.semantic);
  rankBy("structured", (c) => (c.scores.structured > 0 ? c.scores.structured : null));

  const raws = candidates.map((c) => {
    let rrf = 0;
    const voted: HybridChannel[] = [];
    for (const [channel, pos] of rankings) {
      const rank = pos.get(c.item.id);
      if (rank === undefined) continue;
      // Semantic ranks are meaningless when every score is 0 — don't vote.
      if (channel === "semantic" && (c.scores.semantic ?? 0) <= 0) continue;
      voted.push(channel);
      rrf += 1 / (RRF_K + rank + 1);
    }
    return { c, rrf, voted };
  });

  const max = raws.reduce((m, r) => Math.max(m, r.rrf), 0);
  const fusedAll = raws.map(({ c, rrf, voted }) => {
    const fused = max > 0 ? rrf / max : 0;
    const mode: FusedCandidate["mode"] =
      voted.length > 1 ? "hybrid" : voted[0] === "semantic" ? "semantic" : "lexical";
    return { ...c, fused, mode, voted };
  });
  // Rank-ordered output: fusion exists to PRODUCE a ranking; callers that zip
  // by item id are unaffected, callers that read position get the fused order.
  // Ties break deterministically by item id.
  fusedAll.sort((a, b) => b.fused - a.fused || (a.item.id < b.item.id ? -1 : 1));
  return fusedAll;
}

/** Explainability helper: which channels contributed, as a short string. */
export function describeChannels(voted: readonly HybridChannel[]): string {
  return voted.length ? voted.join("+") : "none";
}
