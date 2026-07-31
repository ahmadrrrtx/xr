/**
 * XR 4.5 — Embedding/reranking selection through the Phase 5 Intelligence Plane.
 *
 * §8.3 / §6.3: "Do not create a second provider selection system."
 *
 * XR 4.4 shipped `src/context/memory/embed.ts`, which read `config.localModels` and
 * `XR_EMBED_*` directly and hand-rolled provider choice — a second router.
 * This module makes the intelligence plane the decision-maker while keeping
 * `embed()`'s existing behaviour (and its deterministic lexical fallback) as the
 * transport. No new provider selection logic lives in memory/context modules.
 *
 * Contract:
 *   1. Ask `IntelligenceService` to route `modelClass: "embeddings"` under the
 *      current locality/privacy policy.
 *   2. Honour the decision by pointing the existing embed transport at the
 *      selected provider/model.
 *   3. If the plane says "unavailable" (or is not registered), fall back to the
 *      deterministic lexical vector — never to a silent cloud call.
 */

import type { ServiceRegistry } from "../core/service-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { embed as legacyEmbed, lexicalVector, cosine, sameSpace } from "./memory/embed.ts";
import type { ModelClass, RoutingDecision } from "../intelligence/types.ts";

/** The embedding space actually used for a call. */
export interface EmbeddingRoute {
  /** "provider:model" or "lexical". */
  model: string;
  providerId?: string;
  modelId?: string;
  /** Locality of the selected model, for privacy explanations. */
  locality: "local" | "private" | "cloud" | "hybrid" | "unknown";
  /** True when the deterministic fallback was used. */
  fallback: boolean;
  reason: string;
  decisionId?: string;
}

export const LEXICAL_ROUTE: EmbeddingRoute = {
  model: "lexical",
  locality: "local",
  fallback: true,
  reason: "deterministic lexical fallback (no embedding model routed)",
};

/**
 * Route an embedding/reranking model through the Phase 5 plane.
 * Never throws — routing failure degrades to the lexical route.
 */
export function routeModelClass(
  registry: ServiceRegistry | undefined,
  modelClass: Extract<ModelClass, "embeddings" | "reranking">,
  opts: { localOnly?: boolean; summary?: string } = {},
): EmbeddingRoute {
  if (!registry) return { ...LEXICAL_ROUTE, reason: "no service registry available" };

  let intelligence: ReturnType<ServiceRegistry["tryResolve"]> extends never ? never : unknown;
  try {
    intelligence = registry.tryResolve(Tokens.Intelligence);
  } catch {
    return { ...LEXICAL_ROUTE, reason: "intelligence plane not registered" };
  }
  if (!intelligence) return { ...LEXICAL_ROUTE, reason: "intelligence plane not registered" };

  try {
    const svc = intelligence as {
      route: (req: {
        requirements?: Record<string, unknown>;
        dryRun?: boolean;
      }) => { decision: RoutingDecision };
      getModel?: (p: string, m?: string) => { locality?: { locality?: string } } | undefined;
    };

    const { decision } = svc.route({
      requirements: {
        modelClass,
        require: modelClass === "embeddings" ? { embeddings: true } : {},
        ...(opts.localOnly ? { localityPolicy: "local_only" } : {}),
        summary: opts.summary ?? `context ${modelClass}`,
      },
      dryRun: true,
    });

    if (decision.unavailable || !decision.selected) {
      return {
        ...LEXICAL_ROUTE,
        reason: `intelligence plane: ${decision.explanation || "no compatible embedding model"}`,
        decisionId: decision.decisionId,
      };
    }

    const desc = svc.getModel?.(decision.selected.providerId, decision.selected.modelId);
    const locality = (desc?.locality?.locality as EmbeddingRoute["locality"]) ?? "unknown";

    return {
      model: `${decision.selected.providerId}:${decision.selected.modelId}`,
      providerId: decision.selected.providerId,
      modelId: decision.selected.modelId,
      locality,
      fallback: false,
      reason: decision.explanation || "routed by intelligence plane",
      decisionId: decision.decisionId,
    };
  } catch {
    return { ...LEXICAL_ROUTE, reason: "routing error — using deterministic fallback" };
  }
}

/**
 * Embed text using the routed model.
 *
 * The transport is the existing `src/context/memory/embed.ts` implementation (Ollama /
 * OpenAI-compatible + lexical fallback). We point it at the routed model via
 * the documented `XR_EMBED_MODEL` override for the duration of the call, so
 * there is exactly one HTTP path and one fallback path in the codebase.
 */
export async function embedWithRoute(text: string, route: EmbeddingRoute): Promise<{ vec: number[]; space: string }> {
  if (route.fallback) {
    return { vec: lexicalVector(text), space: "lexical" };
  }

  const prevModel = process.env.XR_EMBED_MODEL;
  try {
    if (route.modelId) process.env.XR_EMBED_MODEL = route.modelId;
    const vec = await legacyEmbed(text);
    return { vec, space: route.model };
  } catch {
    return { vec: lexicalVector(text), space: "lexical" };
  } finally {
    if (prevModel === undefined) delete process.env.XR_EMBED_MODEL;
    else process.env.XR_EMBED_MODEL = prevModel;
  }
}

/**
 * Deterministic reranker used when no reranking model is available.
 *
 * Combines the original similarity with lexical term overlap and an explicit
 * trust/freshness prior supplied by the caller. Fully explainable and stable —
 * the same inputs always produce the same order.
 */
export interface RerankCandidate {
  id: string;
  text: string;
  /** Similarity from the retrieval stage (0..1). */
  similarity: number;
  /** Caller-supplied deterministic prior (0..1) from trust + freshness. */
  prior: number;
}

export interface RerankResult {
  id: string;
  score: number;
  before: number;
  after: number;
  reason: string;
}

/**
 * Rerank candidates deterministically.
 * Score = 0.55·similarity + 0.25·lexicalOverlap + 0.20·prior
 */
export function deterministicRerank(query: string, candidates: readonly RerankCandidate[]): RerankResult[] {
  const qTerms = new Set((query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 2));

  const scored = candidates.map((c, idx) => {
    const cTerms = new Set((c.text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 2));
    let hits = 0;
    for (const t of qTerms) if (cTerms.has(t)) hits++;
    const overlap = qTerms.size === 0 ? 0 : hits / qTerms.size;
    const score = 0.55 * c.similarity + 0.25 * overlap + 0.2 * c.prior;
    return { id: c.id, score, before: idx, overlap };
  });

  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1));

  return scored.map((s, after) => ({
    id: s.id,
    score: s.score,
    before: s.before,
    after,
    reason:
      after === s.before
        ? "rank unchanged"
        : `reranked ${s.before} → ${after} (term overlap ${Math.round(s.overlap * 100)}%)`,
  }));
}

export { cosine, lexicalVector, sameSpace };
