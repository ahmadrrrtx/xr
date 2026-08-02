/**
 * XR 4.4 — Deterministic, explainable candidate scoring.
 * Weights are inspectable; no opaque ML. Historical influence is confidence-gated.
 */

import type { BehavioralView } from "./behavioral.ts";
import type { RoutingHealthView } from "./health.ts";
import type {
  CandidateEvaluation,
  ModelDescriptor,
  ModelOutcomeStats,
  PolicyConstraints,
  ScoreBreakdown,
  TaskRequirements,
} from "./types.ts";

export interface ScoreWeights {
  taskFit: number;
  quality: number;
  latency: number;
  cost: number;
  locality: number;
  preference: number;
  historical: number;
  availability: number;
}

/** Default weights — sum need not be 1; we normalize. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  taskFit: 1.2,
  quality: 1.0,
  latency: 0.7,
  cost: 0.9,
  locality: 0.8,
  preference: 1.1,
  historical: 0.6,
  availability: 0.5,
};

export interface ScoreContext {
  requirements: TaskRequirements;
  policy: PolicyConstraints;
  weights?: Partial<ScoreWeights>;
  historical?: ModelOutcomeStats | null;
  /** Provider ids the user has configured keys for (soft boost). */
  configuredProviders?: Set<string>;
  /** Phase 5 · T2 — measured behavioral contracts (quality = measured fidelity). */
  behavioral?: BehavioralView;
  /** Phase 5 · T3 — rolling health view (availability = rolling score). */
  routingHealth?: RoutingHealthView;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mergeWeights(partial?: Partial<ScoreWeights>): ScoreWeights {
  return { ...DEFAULT_WEIGHTS, ...partial };
}

export function scoreCandidate(
  model: ModelDescriptor,
  ctx: ScoreContext,
): ScoreBreakdown {
  const w = mergeWeights(ctx.weights);
  const notes: string[] = [];
  const req = ctx.requirements;
  const policy = ctx.policy;

  // Task fit
  let taskFit = 0.5;
  if (model.classes.includes(req.modelClass)) {
    taskFit = 1;
    notes.push(`class match: ${req.modelClass}`);
  } else if (req.modelClass === "chat" && model.capabilities.chat === "supported") {
    taskFit = 0.9;
  } else if (req.require?.toolUse && model.capabilities.toolUse === "supported") {
    taskFit = 0.85;
    notes.push("tool-use capable");
  } else if (model.capabilities.chat === "supported") {
    taskFit = 0.55;
    notes.push("generic chat fallback fit");
  } else {
    taskFit = 0.2;
  }
  if (req.require?.reasoning && model.capabilities.reasoning === "supported") {
    taskFit = clamp01(taskFit + 0.1);
    notes.push("reasoning boost");
  }
  if (req.require?.vision && model.capabilities.vision === "supported") {
    taskFit = clamp01(taskFit + 0.1);
  }

  // Quality — Phase 5 · T2/T8: MEASURED behavioral fidelity wins over static
  // (declared) priors. The static quality class survives only as a cold-start
  // prior and is labeled as such in the notes (no vendor-claim presented as
  // measurement — Art. IV.5).
  const qMap: Record<string, number> = { basic: 0.4, standard: 0.65, high: 0.85, frontier: 1, unknown: 0.5 };
  let quality: number = qMap[model.quality.class] ?? 0.5;
  if (model.quality.staticScore !== undefined) {
    quality = clamp01(0.5 * quality + 0.5 * model.quality.staticScore);
  }
  const contract = ctx.behavioral?.contract(model.providerId, model.modelId);
  if (contract && contract.source === "measured") {
    // Blend dimensions by what THIS task requires (capability-per-quality).
    if (req.require?.toolUse) {
      quality = clamp01(0.6 * contract.toolUseFidelity + 0.4 * contract.overallFidelity);
    } else if (req.require?.structuredOutput || req.require?.jsonMode) {
      quality = clamp01(0.6 * contract.structuredOutputFidelity + 0.4 * contract.overallFidelity);
    } else if ((req.minContextTokens ?? 0) > 16_000) {
      quality = clamp01(0.6 * contract.contextRetention + 0.4 * contract.overallFidelity);
    } else {
      quality = clamp01(contract.overallFidelity);
    }
    notes.push(`measured fidelity ${contract.overallFidelity.toFixed(2)} (n=${contract.samples})`);
  } else if (ctx.behavioral) {
    notes.push("quality from static prior (unmeasured)");
  }
  if (policy.routingMode === "quality_constrained" || req.qualityPreference === "high" || req.qualityPreference === "frontier") {
    notes.push("quality-weighted mode");
  }

  // Latency (higher is better = faster)
  const lMap: Record<string, number> = { realtime: 1, fast: 0.85, standard: 0.6, slow: 0.3, unknown: 0.5 };
  let latency: number = lMap[model.latency.class] ?? 0.5;
  if (model.latency.lastMs !== undefined) {
    // <300ms excellent, >5000ms poor
    const msScore = clamp01(1 - model.latency.lastMs / 5000);
    latency = clamp01(0.6 * latency + 0.4 * msScore);
  }
  if (policy.routingMode === "latency_constrained" || req.latencyPreference === "fast" || req.latencyPreference === "realtime") {
    notes.push("latency-weighted mode");
  }

  // Cost (higher is better = cheaper)
  let cost = model.cost.free ? 1 : 0.5;
  if (model.cost.tier === "cheap") cost = 0.75;
  if (model.cost.tier === "premium") cost = 0.35;
  if (model.cost.tier === "enterprise") cost = 0.25;
  if (model.cost.tier === "custom") cost = 0.5;
  if (policy.routingMode === "cost_constrained" || policy.preferFree || req.preferFree) {
    notes.push("cost-weighted mode");
    if (model.cost.free) cost = 1;
  }

  // Locality (prefer local when hybrid/local policies)
  let locality = 0.5;
  if (model.locality.locality === "local") {
    locality = 0.95;
    notes.push("local");
  } else if (model.locality.locality === "private") {
    locality = 0.75;
    notes.push("private endpoint");
  } else {
    locality = 0.4;
  }
  if (policy.localityPolicy === "local_only") locality = model.locality.locality === "local" ? 1 : 0;
  if (policy.legacyStrategy === "localFirst" && model.locality.locality === "local") {
    locality = clamp01(locality + 0.15);
  }
  if (policy.legacyStrategy === "cloudFirst" && model.locality.locality === "cloud") {
    locality = clamp01(locality + 0.15);
    notes.push("cloud-first preference");
  }

  // Preference (pins already filtered; soft preferred + defaults)
  let preference = 0.4;
  if (req.preferred?.providerId === model.providerId) {
    preference = 0.85;
    notes.push("preferred provider");
    if (req.preferred.modelId && req.preferred.modelId === model.modelId) {
      preference = 1;
      notes.push("preferred model");
    }
  }
  if (policy.defaultProviderId === model.providerId) {
    preference = Math.max(preference, 0.8);
    notes.push("workspace default provider");
    if (policy.defaultModelId === model.modelId) {
      preference = Math.max(preference, 0.95);
      notes.push("workspace default model");
    }
  }
  if (model.isDefault) preference = clamp01(preference + 0.05);
  if (ctx.configuredProviders?.has(model.providerId)) {
    preference = clamp01(preference + 0.05);
  }

  // Historical (confidence-gated)
  let historical = 0.5; // neutral when no data
  const hist = ctx.historical;
  if (!req.disableHistorical && !policy.disableHistorical && hist && hist.confidence >= 0.3 && hist.samples >= 3) {
    historical = clamp01(hist.successRate);
    notes.push(`history n=${hist.samples} conf=${hist.confidence.toFixed(2)}`);
    if (hist.avgLatencyMs !== undefined && hist.avgLatencyMs < 1000) {
      historical = clamp01(historical + 0.05);
    }
  } else if (hist && hist.samples > 0 && hist.confidence < 0.3) {
    notes.push("history sparse — ignored");
  }

  // Availability — Phase 5 · T3: rolling health score (measured outcomes)
  // overrides the point-in-time snapshot when samples exist.
  let availability = 0.7;
  if (model.health) {
    if (model.health.ok && model.health.available !== false) {
      availability = model.health.stale ? 0.75 : 0.95;
    } else if (model.health.stale) {
      availability = 0.55;
      notes.push("stale health");
    } else {
      availability = 0.15;
      notes.push("unhealthy");
    }
  }
  // Local without health still ok
  if (!model.health && model.locality.locality === "local") availability = 0.7;
  // Cloud without credentials should have been filtered; if not, tank score
  if (model.locality.requiresCredential && model.health?.authOk === false) {
    availability = 0.05;
  }
  const gate = ctx.routingHealth?.gate(model.providerId, model.modelId);
  if (gate && gate.samples > 0) {
    availability = clamp01(0.2 + 0.8 * gate.score);
    notes.push(`rolling health ${gate.score.toFixed(2)} (n=${gate.samples})`);
    if (gate.state === "half_open") {
      availability = clamp01(availability * 0.5);
      notes.push("half-open probe pending");
    }
  }

  // Mode-specific weight emphasis
  const weights = { ...w };
  if (policy.routingMode === "cost_constrained" || policy.legacyStrategy === "cheapest") {
    weights.cost *= 2;
  }
  if (policy.routingMode === "latency_constrained" || policy.legacyStrategy === "fastest") {
    weights.latency *= 2;
  }
  if (policy.routingMode === "quality_constrained") {
    weights.quality *= 2;
  }
  if (policy.legacyStrategy === "localFirst") {
    weights.locality *= 1.8;
  }

  const totalW =
    weights.taskFit +
    weights.quality +
    weights.latency +
    weights.cost +
    weights.locality +
    weights.preference +
    weights.historical +
    weights.availability;

  const total =
    (taskFit * weights.taskFit +
      quality * weights.quality +
      latency * weights.latency +
      cost * weights.cost +
      locality * weights.locality +
      preference * weights.preference +
      historical * weights.historical +
      availability * weights.availability) /
    (totalW || 1);

  return {
    taskFit: round4(taskFit),
    quality: round4(quality),
    latency: round4(latency),
    cost: round4(cost),
    locality: round4(locality),
    preference: round4(preference),
    historical: round4(historical),
    availability: round4(availability),
    total: round4(total),
    notes,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Score all compatible evaluations in place; returns sorted best-first.
 * Tie-break: higher preference, then free, then providerId/modelId lexical.
 */
export function rankCandidates(
  evaluations: CandidateEvaluation[],
  ctx: ScoreContext,
  historicalFor?: (m: ModelDescriptor) => ModelOutcomeStats | null | undefined,
): CandidateEvaluation[] {
  const scored: CandidateEvaluation[] = [];
  for (const ev of evaluations) {
    if (!ev.compatible) {
      scored.push(ev);
      continue;
    }
    const hist = historicalFor?.(ev.model) ?? ctx.historical ?? null;
    const score = scoreCandidate(ev.model, { ...ctx, historical: hist });
    scored.push({ ...ev, score });
  }

  const compatible = scored.filter((e) => e.compatible && e.score);
  compatible.sort((a, b) => {
    const dt = (b.score!.total - a.score!.total);
    if (Math.abs(dt) > 1e-9) return dt > 0 ? 1 : -1;
    // tie-breakers
    const pref = (b.score!.preference - a.score!.preference);
    if (Math.abs(pref) > 1e-9) return pref > 0 ? 1 : -1;
    if (a.model.cost.free !== b.model.cost.free) return a.model.cost.free ? -1 : 1;
    const pk = a.model.providerId.localeCompare(b.model.providerId);
    if (pk !== 0) return pk;
    return a.model.modelId.localeCompare(b.model.modelId);
  });

  // Return ranked compatible first, then incompatible
  const incompatible = scored.filter((e) => !e.compatible);
  return [...compatible, ...incompatible];
}
