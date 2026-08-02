/**
 * XR 4.5 — Scope-first retrieval pipeline (§7.4).
 *
 *   Query Intent
 *     → Scope/Policy Filter      (deterministic, BEFORE any ranking)
 *     → Candidate Retrieval      (SQL-level scope fence)
 *     → Freshness/Trust Filter
 *     → Reranking                (Phase 5 routed, deterministic fallback)
 *     → Contradiction/Confidence Check
 *     → Injection Package
 *     → Explanation
 *
 * The order is the security property: an unauthorized item is never scored,
 * so it can never be "considered" merely because it ranks highly.
 */

import {
  CONTEXT_BOUNDS,
  TIER_POLICIES,
  boundText,
  trustRank,
  type ConfidenceLevel,
  type ContextGrant,
  type ContextItem,
  type ContextTier,
  type ContextType,
  type RejectedItem,
  type RetrievalExplanation,
  type RetrievedItem,
} from "./types.ts";
import { authorize } from "./policy.ts";
import { conflictPenalty, detectConflicts, type ConflictFinding } from "./poison.ts";
import {
  cosine,
  deterministicRerank,
  embedWithRoute,
  lexicalVector,
  sameSpace,
  type EmbeddingRoute,
} from "./embedding.ts";
import { describeChannels, fuseRRF, structuredScore, type HybridChannel } from "./hybrid.ts";
import type { ContextRepository } from "./repository.ts";

export interface RetrievalRequest {
  /** What the retrieval is for — recorded in every explanation. */
  queryIntent: string;
  /** The query text used for ranking. */
  query: string;
  grant: ContextGrant;
  /** Restrict to these tiers (must already be within the grant). */
  tiers?: readonly ContextTier[];
  /** Per-tier item cap override (still bounded by tier policy). */
  limitPerTier?: number;
  /** Relevance floor override. */
  floor?: number;
  /** Force lexical scoring (no embedding call). */
  lexicalOnly?: boolean;
  /**
   * Phase 6 · T1 — retrieval depth.
   *   "progressive" (default): `externalized` originals are excluded from
   *     ranking — their summary stands for them. This is what keeps recall
   *     sharp at scale without ever deleting evidence.
   *   "deep": externalized originals rank alongside everything else
   *     (navigation/debug/investigation path; used by memory tools).
   */
  depth?: "progressive" | "deep";
  now?: number;
}

export interface RetrievalResult {
  items: RetrievedItem[];
  rejected: RejectedItem[];
  conflicts: ConflictFinding[];
  /** The embedding route actually used. */
  route: EmbeddingRoute;
  /** True when a tier could not be retrieved. */
  degraded: boolean;
  degradedReasons: string[];
  /** Wall-clock milliseconds for the whole pipeline. */
  durationMs: number;
}

/** Items sourced from somewhere other than the context repository. */
export interface ExternalCandidate {
  item: ContextItem;
  tier: ContextTier;
}

/**
 * The retrieval engine. Stateless apart from its repository handle so it is
 * trivially testable and cannot accumulate cross-request state.
 */
export class ContextRetrieval {
  constructor(
    private readonly repo: ContextRepository,
    private readonly route: EmbeddingRoute,
  ) {}

  /**
   * Run the full pipeline.
   *
   * `extra` lets callers contribute already-materialised items (e.g. user
   * memory rows adapted from `user_memory`) — they go through exactly the same
   * authorization, filtering, ranking, and explanation stages. There is no
   * privileged path.
   */
  async retrieve(req: RetrievalRequest, extra: readonly ExternalCandidate[] = []): Promise<RetrievalResult> {
    const started = Date.now();
    const now = req.now ?? started;
    const rejected: RejectedItem[] = [];
    const degradedReasons: string[] = [];

    // ── Stage 0: grant sanity ────────────────────────────────────────────
    if (req.grant.allowedTiers.length === 0 || req.grant.maxItems === 0) {
      return {
        items: [],
        rejected: [],
        conflicts: [],
        route: this.route,
        degraded: false,
        degradedReasons: [],
        durationMs: Date.now() - started,
      };
    }

    const activeTiers = (req.tiers ?? req.grant.allowedTiers).filter((t) =>
      req.grant.allowedTiers.includes(t),
    );
    if (activeTiers.length === 0) {
      return {
        items: [],
        rejected: [],
        conflicts: [],
        route: this.route,
        degraded: false,
        degradedReasons: [],
        durationMs: Date.now() - started,
      };
    }

    // ── Stage 1: scope-fenced candidate retrieval ────────────────────────
    // The SQL query itself applies workspace/project/task/agent fences, so
    // unauthorized rows never enter process memory.
    const wantedTypes = new Set<ContextType>();
    for (const tier of activeTiers) {
      for (const t of TIER_POLICIES[tier].allowedTypes) wantedTypes.add(t);
    }

    let repoCandidates: ContextItem[] = [];
    try {
      repoCandidates = this.repo.listCandidates({
        workspaceId: req.grant.scope.workspaceId,
        projectScope: req.grant.scope.projectScope,
        types: [...wantedTypes],
        taskId: req.grant.scope.taskId,
        agentId: req.grant.scope.agentId,
        limit: CONTEXT_BOUNDS.maxCandidates,
        now,
      });
    } catch (e) {
      degradedReasons.push(`candidate retrieval failed: ${errMsg(e)}`);
    }

    // Expired items are excluded in SQL (they never enter process memory), but
    // the user still deserves to know something was withheld. Fetch just the
    // IDS of expired rows in scope so `xr context explain` can show them —
    // no content is loaded, so this cannot leak data.
    try {
      const withExpired = this.repo.listCandidates({
        workspaceId: req.grant.scope.workspaceId,
        projectScope: req.grant.scope.projectScope,
        types: [...wantedTypes],
        taskId: req.grant.scope.taskId,
        agentId: req.grant.scope.agentId,
        includeExpired: true,
        limit: CONTEXT_BOUNDS.maxCandidates,
        now,
      });
      const live = new Set(repoCandidates.map((c) => c.id));
      for (const c of withExpired) {
        if (live.has(c.id)) continue;
        if (rejected.length >= CONTEXT_BOUNDS.maxRejectedRecorded) break;
        rejected.push({
          itemId: c.id,
          reason: "expired",
          detail: "past hard expiry — excluded before ranking",
        });
      }
    } catch {
      /* the exclusion already happened; reporting it is best-effort */
    }

    // ── Stage 2: authorization (deterministic, before ranking) ───────────
    type Admitted = { item: ContextItem; tier: ContextTier; policyReason: string };
    const admitted: Admitted[] = [];

    const consider = (item: ContextItem, preferredTier?: ContextTier): void => {
      // Phase 6 · T1 — progressive depth: folded originals stand down.
      const stage = item.lifecycleStage ?? "verbatim";
      if (stage === "externalized" && req.depth !== "deep") {
        if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
          rejected.push({
            itemId: item.id,
            reason: "lifecycle_externalized",
            detail: "folded into a summary — retrievable via deep retrieval or navigation",
          });
        }
        return;
      }
      const decision = authorize(item, req.grant, { tier: preferredTier, now });
      if (!decision.allowed) {
        if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
          // Note: never includes content — a rejection must not leak data.
          rejected.push({ itemId: item.id, reason: decision.reason, detail: decision.detail });
        }
        return;
      }
      if (!activeTiers.includes(decision.tier)) {
        if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
          rejected.push({
            itemId: item.id,
            reason: "tier_not_granted",
            detail: `tier "${decision.tier}" not requested for this retrieval`,
          });
        }
        return;
      }
      admitted.push({ item, tier: decision.tier, policyReason: decision.reason });
    };

    for (const item of repoCandidates) consider(item);
    for (const ext of extra) consider(ext.item, ext.tier);

    if (admitted.length === 0) {
      return {
        items: [],
        rejected,
        conflicts: [],
        route: this.route,
        degraded: degradedReasons.length > 0,
        degradedReasons,
        durationMs: Date.now() - started,
      };
    }

    // ── Stage 3: ranking (only authorized items reach here) ──────────────
    const floor = req.floor ?? CONTEXT_BOUNDS.relevanceFloor;
    const query = (req.query ?? "").trim();

    let queryVec: number[] | null = null;
    let matchMode: RetrievalExplanation["matchMode"] = "lexical";
    if (query && !req.lexicalOnly && !this.route.fallback) {
      try {
        const { vec } = await embedWithRoute(query, this.route);
        queryVec = vec;
        matchMode = "semantic";
      } catch {
        queryVec = null;
        matchMode = "lexical";
        degradedReasons.push("query embedding failed — lexical scoring used");
      }
    }

    const qLex = query ? lexicalVector(query) : null;

    interface Scored extends Admitted {
      similarity: number;
      mode: RetrievalExplanation["matchMode"];
      prior: number;
      score: number;
      fusedScore?: number;
      channels?: { lexical: number; semantic: number; structured: number };
      voted?: HybridChannel[];
    }

    // ── Phase 6 · T2: hybrid channel scoring + RRF fusion ──────────────────
    // Channels: lexical (always, offline) · semantic (routed vector when the
    // item has a cached vector in the active space) · structured (metadata).
    // A channel abstains rather than emit a garbage cross-space number.
    interface HybridEntry extends Admitted {
      prior: number;
      scores: { lexical: number; semantic: number | null; structured: number };
    }

    const hybridInput: HybridEntry[] = admitted.map((a) => {
      const text = `${a.item.title} ${a.item.content} ${a.item.tags.join(" ")}`.trim();
      const lexS = !query ? 1 : qLex ? Math.max(0, cosine(qLex, lexicalVector(text))) : 0;

      let semS: number | null = null;
      if (query && queryVec) {
        const cached = this.repo.getEmbedding(a.item.id);
        if (cached && cached.model === this.route.model && sameSpace(cached.vec, queryVec)) {
          semS = Math.max(0, cosine(queryVec, cached.vec));
        }
        // Else: semantic ABSTAINS for this item (never a cross-space cosine).
      }

      const structS = structuredScore(query, a.item);
      const prior = computePrior(a.item);
      return { ...a, prior, scores: { lexical: lexS, semantic: semS, structured: structS } };
    });

    const fusedById = new Map(fuseRRF(hybridInput).map((f) => [f.item.id, f]));
    const scored: Scored[] = hybridInput.map((h) => {
      const f = fusedById.get(h.item.id);
      // contentSim = the strongest *content* evidence (lexical or semantic).
      // The relevance floor gates on this — identical semantics to the
      // pre-hybrid floor — so an item that merely ranks via RRF ordering can
      // never slip in with no content match at all.
      const semVal = h.scores.semantic ?? -1;
      const contentSim = !query ? 1 : Math.max(h.scores.lexical, semVal);
      // The FUSED score drives ranking (order) — recorded for lineage.
      return {
        ...h,
        similarity: contentSim,
        mode: !query ? "lexical" : f?.mode ?? "lexical",
        score: !query ? 1 : f?.fused ?? contentSim,
        fusedScore: f?.fused ?? 0,
        channels: {
          lexical: h.scores.lexical,
          semantic: h.scores.semantic ?? 0,
          structured: h.scores.structured,
        },
        voted: f?.voted ?? [],
      };
    });

    // Floor check happens before reranking so noise never occupies rerank slots.
    const aboveFloor = scored.filter((s) => {
      if (s.similarity >= floor) return true;
      if (rejected.length < CONTEXT_BOUNDS.maxRejectedRecorded) {
        rejected.push({
          itemId: s.item.id,
          reason: "below_relevance_floor",
          detail: `similarity ${s.similarity.toFixed(3)} < floor ${floor}`,
        });
      }
      return false;
    });

    // ── Stage 4: reranking ───────────────────────────────────────────────
    const rerankMap = new Map<string, { before: number; after: number; reason: string; score: number }>();
    if (aboveFloor.length > 1) {
      const results = deterministicRerank(
        query,
        aboveFloor.map((s) => ({
          id: s.item.id,
          text: `${s.item.title} ${s.item.content}`,
          // The reranker receives the FUSED score so all channels influence order.
          similarity: s.fusedScore ?? s.similarity,
          prior: s.prior,
        })),
      );
      for (const r of results) rerankMap.set(r.id, r);
      for (const s of aboveFloor) {
        const r = rerankMap.get(s.item.id);
        if (r) s.score = r.score;
      }
    } else {
      for (const s of aboveFloor) s.score = s.similarity;
    }

    // ── Stage 5: contradiction / confidence ──────────────────────────────
    const conflicts = detectConflicts(aboveFloor.map((s) => s.item));
    for (const s of aboveFloor) {
      const { penalty } = conflictPenalty(s.item.id, conflicts);
      s.score = Math.max(0, s.score - penalty);
    }

    // ── Stage 6: tier-bounded selection ──────────────────────────────────
    aboveFloor.sort((a, b) => (b.score - a.score) || (a.item.id < b.item.id ? -1 : 1));

    const perTierCount = new Map<ContextTier, number>();
    const perTierChars = new Map<ContextTier, number>();
    const out: RetrievedItem[] = [];
    let totalChars = 0;

    for (const s of aboveFloor) {
      if (out.length >= req.grant.maxItems) break;

      const policy = TIER_POLICIES[s.tier];
      const tierCap = Math.min(req.limitPerTier ?? policy.maxItems, policy.maxItems);
      const usedCount = perTierCount.get(s.tier) ?? 0;
      if (usedCount >= tierCap) continue;

      const usedChars = perTierChars.get(s.tier) ?? 0;
      const itemChars = s.item.content.length;
      if (usedChars + itemChars > policy.maxChars) continue;
      if (totalChars + itemChars > req.grant.maxChars) continue;

      const rr = rerankMap.get(s.item.id);
      const { notes } = conflictPenalty(s.item.id, conflicts);

      const explanation: RetrievalExplanation = {
        queryIntent: boundText(req.queryIntent, 256),
        scopeMatch: `${s.item.scope.projectScope} @ ${s.item.scope.workspaceId}`,
        similarity: round3(s.similarity),
        matchMode: s.mode,
        ...(s.channels ? { channels: s.channels } : {}),
        ...(rr && rr.before !== rr.after
          ? { rerank: { before: rr.before, after: rr.after, reason: rr.reason } }
          : {}),
        freshness: `${s.item.freshness.label} (${s.item.freshness.reason})`,
        trustStatus: s.item.trustStatus,
        consentState: s.item.consentState,
        provenance: describeProvenance(s.item),
        policyReason: boundText(
          [
            s.voted && s.voted.length > 0 ? `hybrid:${describeChannels(s.voted)}` : null,
            s.policyReason,
            ...(notes.length ? notes : []),
          ]
            .filter(Boolean)
            .join(" · "),
          CONTEXT_BOUNDS.maxExplanationChars,
        ),
        score: round3(s.score),
        legacy: s.item.consentState === "legacy_unknown",
      };

      out.push({ item: s.item, tier: s.tier, explanation });
      perTierCount.set(s.tier, usedCount + 1);
      perTierChars.set(s.tier, usedChars + itemChars);
      totalChars += itemChars;
    }

    // ── Stage 7: access tracking ─────────────────────────────────────────
    try {
      this.repo.touchAccess(out.map((r) => r.item.id), now);
    } catch {
      /* best-effort — never fails a retrieval */
    }

    return {
      items: out,
      rejected,
      conflicts,
      route: this.route,
      degraded: degradedReasons.length > 0,
      degradedReasons,
      durationMs: Date.now() - started,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Deterministic ranking prior from trust + freshness ONLY.
 * Never derived from similarity, so relevance can never inflate trust.
 */
function computePrior(item: ContextItem): number {
  const trust = trustRank(item.trustStatus) / 5; // 0..1
  const fresh =
    item.freshness.label === "fresh"
      ? 1
      : item.freshness.label === "recent"
        ? 0.8
        : item.freshness.label === "aging"
          ? 0.5
          : item.freshness.label === "stale"
            ? 0.2
            : 0;
  const confidence: Record<ConfidenceLevel, number> = { high: 1, medium: 0.7, low: 0.4, unknown: 0.5 };
  const conf = confidence[item.uncertainty.confidence];
  const confirmed = item.uncertainty.userConfirmed ? 0.1 : 0;
  return Math.min(1, 0.45 * trust + 0.35 * fresh + 0.2 * conf + confirmed);
}

/** Safe, non-leaking provenance description for an explanation. */
function describeProvenance(item: ContextItem): string {
  const parts: string[] = [item.provenanceKind];
  if (item.actorName) parts.push(`by ${item.actorName}`);
  else if (item.actorKind !== "unknown") parts.push(`by ${item.actorKind}`);
  if (item.provenanceRef) {
    // Only show a short, non-sensitive tail of the reference.
    const ref = item.provenanceRef;
    parts.push(ref.length > 64 ? `…${ref.slice(-60)}` : ref);
  }
  return parts.join(" · ");
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
