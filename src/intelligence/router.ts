/**
 * XR 4.4 — Universal Intelligence Router.
 * Filters → scores → selects → explains. Deterministic under the same inputs.
 */

import { buildCatalog, findModel, type IntelligenceCatalog } from "./catalog.ts";
import { evaluateAll } from "./evaluator.ts";
import { buildFallbackChain } from "./fallback.ts";
import {
  getDefaultMetrics,
  type IntelligenceMetrics,
} from "./metrics.ts";
import { rankCandidates } from "./scorer.ts";
import type {
  PolicyConstraints,
  RouteRequest,
  RouteResult,
  RoutingDecision,
  RoutingDecisionRecord,
  RoutingMode,
  TaskRequirements,
} from "./types.ts";
import type { XRConfig } from "../config/config.ts";
import { randomBytes } from "node:crypto";

export interface RouterOptions {
  catalog?: IntelligenceCatalog;
  metrics?: IntelligenceMetrics;
  /** Max rejected entries retained in the decision. */
  maxRejected?: number;
  /** Max considered (non-selected) scored entries. */
  maxConsidered?: number;
}

function decisionId(): string {
  return `rd_${randomBytes(8).toString("hex")}`;
}

/** Map legacy providerEngine.routingStrategy → mode + locality hints. */
export function policyFromConfig(config: XRConfig): PolicyConstraints {
  const engine = (config as any).providerEngine ?? {};
  const intel = (config as any).intelligencePlane ?? {};
  const localModels = (config as any).localModels ?? {};
  const strategy: string = intel.routingMode
    ? String(intel.routingMode)
    : (engine.routingStrategy ?? "hybrid");

  let routingMode: RoutingMode = "automatic";
  let localityPolicy: PolicyConstraints["localityPolicy"] = "any";
  let allowCloudFallback = true;

  // Explicit intelligencePlane.localityPolicy wins
  if (intel.localityPolicy === "local_only" || localModels.routing === "local-only") {
    localityPolicy = "local_only";
    allowCloudFallback = false;
    routingMode = "local_only";
  } else if (intel.localityPolicy === "private_only") {
    localityPolicy = "private_only";
    allowCloudFallback = intel.allowCloudFallback === true;
    routingMode = "private_only";
  } else if (intel.localityPolicy === "no_cloud") {
    localityPolicy = "no_cloud";
    allowCloudFallback = false;
  }

  // Legacy strategy mapping when not already local_only
  if (routingMode !== "local_only" && routingMode !== "private_only") {
    switch (strategy) {
      case "primary":
        routingMode = "preferred_with_fallback";
        break;
      case "localFirst":
        routingMode = "automatic";
        if (localityPolicy === "any") {
          // prefer local but allow cloud unless local-only
          allowCloudFallback = intel.allowCloudFallback !== false;
        }
        break;
      case "cloudFirst":
        routingMode = "automatic";
        break;
      case "cheapest":
        routingMode = "cost_constrained";
        break;
      case "fastest":
        routingMode = "latency_constrained";
        break;
      case "hybrid":
      case "automatic":
        routingMode = "automatic";
        break;
      case "manual":
        routingMode = "manual";
        break;
      case "local_only":
        routingMode = "local_only";
        localityPolicy = "local_only";
        allowCloudFallback = false;
        break;
      case "disabled":
        routingMode = "disabled";
        break;
      default:
        if (
          strategy === "preferred_with_fallback" ||
          strategy === "cost_constrained" ||
          strategy === "latency_constrained" ||
          strategy === "quality_constrained"
        ) {
          routingMode = strategy as RoutingMode;
        }
        break;
    }
  }

  // intelligencePlane explicit mode override
  if (intel.mode && typeof intel.mode === "string") {
    routingMode = intel.mode as RoutingMode;
    if (intel.mode === "local_only") {
      localityPolicy = "local_only";
      allowCloudFallback = false;
    }
  }

  const allowFallback =
    intel.allowFallback !== undefined
      ? !!intel.allowFallback
      : routingMode !== "manual";

  return {
    routingMode,
    localityPolicy,
    allowFallback,
    allowCloudFallback:
      intel.allowCloudFallback !== undefined
        ? !!intel.allowCloudFallback
        : allowCloudFallback,
    preferFree: intel.preferFree ?? config.preferFreeProviders ?? true,
    maxCostUsd: intel.maxCostUsd,
    latencyPreference: intel.latencyPreference ?? "any",
    qualityPreference: intel.qualityPreference ?? "any",
    disableHistorical: intel.disableHistorical === true,
    defaultProviderId: config.defaults?.provider,
    defaultModelId: config.defaults?.model,
    fallbackProviderId: config.defaults?.fallbackProvider,
    fallbackModelId: config.defaults?.fallbackModel,
    legacyStrategy: engine.routingStrategy,
  };
}

export function mergeRequirements(
  partial: Partial<TaskRequirements> | undefined,
  policy: PolicyConstraints,
  request: RouteRequest,
): TaskRequirements {
  const pinProvider = request.provider ?? partial?.pin?.providerId;
  const pinModel = request.model ?? partial?.pin?.modelId;
  const hasExplicitPin = !!(request.provider || request.model);

  const mode = request.mode ?? policy.routingMode;

  const req: TaskRequirements = {
    modelClass: partial?.modelClass ?? "chat",
    modalities: partial?.modalities,
    require: partial?.require,
    minContextTokens: partial?.minContextTokens,
    latencyPreference: partial?.latencyPreference ?? policy.latencyPreference,
    qualityPreference: partial?.qualityPreference ?? policy.qualityPreference,
    maxCostUsd: partial?.maxCostUsd ?? policy.maxCostUsd,
    preferFree: partial?.preferFree ?? policy.preferFree,
    localityPolicy: partial?.localityPolicy ?? policy.localityPolicy,
    pin: hasExplicitPin
      ? {
          providerId: pinProvider,
          modelId: pinModel,
          // Explicit caller pin is strict unless allowFallback was set true on requirements
          strict: partial?.pin?.strict ?? partial?.allowFallback !== true,
        }
      : partial?.pin,
    preferred: partial?.preferred ?? {
      providerId: policy.defaultProviderId,
      modelId: policy.defaultModelId,
    },
    allowFallback:
      partial?.allowFallback ??
      (hasExplicitPin ? false : policy.allowFallback),
    allowCloudFallback: partial?.allowCloudFallback ?? policy.allowCloudFallback,
    disableHistorical: partial?.disableHistorical ?? policy.disableHistorical,
    summary: partial?.summary,
  };

  // Manual mode without pin → use defaults as preferred pin (non-strict if fallback on)
  if (mode === "manual" && !req.pin?.providerId && policy.defaultProviderId) {
    req.pin = {
      providerId: policy.defaultProviderId,
      modelId: policy.defaultModelId,
      strict: !policy.allowFallback,
    };
  }

  return req;
}

export class IntelligenceRouter {
  private metrics: IntelligenceMetrics;
  private maxRejected: number;
  private maxConsidered: number;

  constructor(private opts: RouterOptions = {}) {
    this.metrics = opts.metrics ?? getDefaultMetrics();
    this.maxRejected = opts.maxRejected ?? 12;
    this.maxConsidered = opts.maxConsidered ?? 5;
  }

  route(config: XRConfig, request: RouteRequest = {}): RouteResult {
    const catalog = this.opts.catalog ?? buildCatalog(config);
    const basePolicy = policyFromConfig(config);
    const policy: PolicyConstraints = {
      ...basePolicy,
      routingMode: request.mode ?? basePolicy.routingMode,
    };
    const requirements = mergeRequirements(request.requirements, policy, request);

    // Manual / pin path — highest precedence
    if (requirements.pin?.providerId) {
      return this.routePinned(catalog, requirements, policy, request);
    }

    if (policy.routingMode === "disabled") {
      return this.unavailable(
        requirements,
        policy,
        "Intelligence routing is disabled",
        true,
      );
    }

    // Preferred_with_fallback using defaults when mode says so
    if (policy.routingMode === "manual") {
      // Should have been pinned via merge; if still not, unavailable
      return this.unavailable(
        requirements,
        policy,
        "Manual mode requires an explicit provider/model",
        true,
      );
    }

    return this.routeAutomatic(catalog, requirements, policy);
  }

  private routePinned(
    catalog: IntelligenceCatalog,
    requirements: TaskRequirements,
    policy: PolicyConstraints,
    _request: RouteRequest,
  ): RouteResult {
    const providerId = requirements.pin!.providerId!;
    const modelId = requirements.pin!.modelId;
    const model = findModel(catalog, providerId, modelId);

    if (!model) {
      // Pin missing — optional fallback if allowed
      if (requirements.allowFallback || requirements.pin?.strict === false) {
        const auto = this.routeAutomatic(catalog, {
          ...requirements,
          pin: undefined,
          preferred: { providerId, modelId },
        }, policy);
        if (auto.decision.selected) {
          auto.decision.factors = [
            `pin ${providerId}/${modelId ?? "?"} unavailable — fell back`,
            ...auto.decision.factors,
          ];
          auto.decision.explanation =
            `Pinned provider/model unavailable; selected fallback ${auto.decision.selected.providerId}/${auto.decision.selected.modelId}.`;
          auto.decision.manual = false;
          return finalize(auto.decision);
        }
      }
      return this.unavailable(
        requirements,
        policy,
        `Pinned provider/model not found: ${providerId}/${modelId ?? "(default)"}`,
        true,
      );
    }

    // Still enforce hard policy (local-only etc.) even on manual pin —
    // security policy cannot be bypassed by pin.
    const evals = evaluateAll([model], requirements, {
      ...policy,
      // For pin eval, don't apply pin-strict rejection to itself
    });
    // Clear user_pin self-rejections
    const ev = evals[0]!;
    ev.rejections = ev.rejections.filter((r) => r.code !== "user_pin");
    ev.compatible = ev.rejections.length === 0;

    if (!ev.compatible) {
      if (requirements.allowFallback) {
        const auto = this.routeAutomatic(
          catalog,
          { ...requirements, pin: undefined },
          policy,
        );
        if (auto.decision.selected) {
          auto.decision.factors.unshift(
            `pin rejected: ${ev.rejections.map((r) => r.message).join("; ")}`,
          );
          return auto;
        }
      }
      return this.unavailable(
        requirements,
        policy,
        `Pinned model incompatible: ${ev.rejections.map((r) => r.message).join("; ")}`,
        true,
        [
          {
            providerId: model.providerId,
            modelId: model.modelId,
            reasons: ev.rejections,
          },
        ],
      );
    }

    // Build fallback chain from other candidates when allowed
    const allEvals = evaluateAll(catalog.models, { ...requirements, pin: undefined }, policy);
    const ranked = rankCandidates(allEvals, {
      requirements: { ...requirements, pin: undefined },
      policy,
    }, (m) =>
      this.metrics.statsFor(m.providerId, m.modelId, requirements.modelClass),
    );
    const compatible = ranked.filter((e) => e.compatible);
    const fb = buildFallbackChain(compatible, model, requirements, policy);

    const decision: RoutingDecision = {
      version: 1,
      decisionId: decisionId(),
      timestamp: Date.now(),
      mode: "manual",
      requirements,
      constraints: policy,
      selected: {
        providerId: model.providerId,
        modelId: model.modelId,
        key: model.key,
      },
      fallbackChain: fb.steps,
      rejected: [],
      considered: [],
      manual: true,
      unavailable: false,
      explanation: `Manual pin: ${model.providerId}/${model.modelId}`,
      factors: ["explicit provider/model pin", `locality=${model.locality.locality}`],
      confidence: 1,
      humanHandoff: fb.humanHandoff,
    };
    return finalize(decision);
  }

  private routeAutomatic(
    catalog: IntelligenceCatalog,
    requirements: TaskRequirements,
    policy: PolicyConstraints,
  ): RouteResult {
    // Credential hard-filter: attach auth health onto models from provider list
    const models = catalog.models.map((m) => {
      const p = catalog.providers.find((x) => x.providerId === m.providerId);
      if (!p) return m;
      const health = m.health ?? p.health;
      const authOk = p.auth.credentialAvailable;
      return {
        ...m,
        health: {
          ok: health?.ok ?? authOk,
          authOk,
          available: health?.available ?? authOk,
          latencyMs: health?.latencyMs,
          detail: health?.detail ?? (!authOk ? "credentials missing" : undefined),
          checkedAt: health?.checkedAt ?? catalog.builtAt,
          stale: health?.stale ?? true,
        },
        locality: {
          ...m.locality,
          requiresCredential: p.auth.type !== "none" && !!p.auth.apiKeyEnv,
        },
      };
    });

    // Drop models without credentials (hard)
    const withCreds = models.filter((m) => {
      if (!m.locality.requiresCredential) return true;
      return m.health?.authOk !== false;
    });

    const evaluations = evaluateAll(withCreds, requirements, policy);
    const ranked = rankCandidates(
      evaluations,
      { requirements, policy },
      (m) => this.metrics.statsFor(m.providerId, m.modelId, requirements.modelClass),
    );

    const compatible = ranked.filter((e) => e.compatible);
    const incompatible = ranked.filter((e) => !e.compatible);

    // Preferred fallback list from config defaults as soft first pick when score close
    if (policy.fallbackProviderId && compatible.length) {
      // already scored with preference; optional explicit fallback chain seed later
    }

    const best = compatible[0];
    if (!best) {
      const rejected = incompatible.slice(0, this.maxRejected).map((e) => ({
        providerId: e.model.providerId,
        modelId: e.model.modelId,
        reasons: e.rejections,
      }));
      return this.unavailable(
        requirements,
        policy,
        "No compatible model for task requirements and policy",
        false,
        rejected,
      );
    }

    const fb = buildFallbackChain(compatible, best.model, requirements, policy);

    // Seed configured fallback provider into chain if compatible and not selected
    if (policy.fallbackProviderId && policy.fallbackProviderId !== best.model.providerId) {
      const fbModel = findModel(
        { ...catalog, models: withCreds },
        policy.fallbackProviderId,
        policy.fallbackModelId,
      );
      if (fbModel && !fb.steps.some((s) => s.providerId === fbModel.providerId && s.modelId === fbModel.modelId)) {
        const fbEval = evaluateAll([fbModel], requirements, policy)[0];
        if (fbEval?.compatible) {
          fb.steps.unshift({
            providerId: fbModel.providerId,
            modelId: fbModel.modelId,
            reason: "configured fallback provider",
          });
          // keep bounded
          fb.steps = fb.steps.slice(0, 3);
        }
      }
    }

    const rejected = incompatible.slice(0, this.maxRejected).map((e) => ({
      providerId: e.model.providerId,
      modelId: e.model.modelId,
      reasons: e.rejections,
    }));
    const considered = compatible.slice(1, 1 + this.maxConsidered).map((e) => ({
      providerId: e.model.providerId,
      modelId: e.model.modelId,
      score: e.score!,
    }));

    const factors = [
      ...(best.score?.notes ?? []),
      `score=${best.score?.total.toFixed(3) ?? "?"}`,
      `mode=${policy.routingMode}`,
      `localityPolicy=${requirements.localityPolicy ?? policy.localityPolicy}`,
    ];

    const decision: RoutingDecision = {
      version: 1,
      decisionId: decisionId(),
      timestamp: Date.now(),
      mode: policy.routingMode,
      requirements,
      constraints: policy,
      selected: {
        providerId: best.model.providerId,
        modelId: best.model.modelId,
        key: best.model.key,
        score: best.score,
      },
      fallbackChain: fb.steps,
      rejected,
      considered,
      manual: false,
      unavailable: false,
      explanation: explain(best.model.providerId, best.model.modelId, factors, policy),
      factors,
      confidence: estimateConfidence(best, compatible.length),
      humanHandoff: fb.humanHandoff,
    };
    return finalize(decision);
  }

  private unavailable(
    requirements: TaskRequirements,
    policy: PolicyConstraints,
    reason: string,
    manual: boolean,
    rejected: RoutingDecision["rejected"] = [],
  ): RouteResult {
    const decision: RoutingDecision = {
      version: 1,
      decisionId: decisionId(),
      timestamp: Date.now(),
      mode: policy.routingMode,
      requirements,
      constraints: policy,
      selected: undefined,
      fallbackChain: [],
      rejected,
      considered: [],
      manual,
      unavailable: true,
      explanation: reason,
      factors: [reason],
      confidence: 1,
      humanHandoff: { required: true, reason },
    };
    return finalize(decision);
  }
}

function explain(
  providerId: string,
  modelId: string,
  factors: string[],
  policy: PolicyConstraints,
): string {
  const bits = [
    `Selected ${providerId}/${modelId}`,
    `mode=${policy.routingMode}`,
    factors.slice(0, 4).join("; "),
  ];
  return bits.filter(Boolean).join(" — ");
}

function estimateConfidence(
  best: { score?: { total: number; notes: string[] } },
  compatibleCount: number,
): number {
  let c = 0.6;
  if (best.score && best.score.total > 0.75) c += 0.15;
  if (compatibleCount >= 3) c += 0.1;
  if (best.score?.notes.some((n) => n.includes("history"))) c += 0.05;
  return Math.min(1, Math.round(c * 100) / 100);
}

function toRecord(decision: RoutingDecision): RoutingDecisionRecord {
  return {
    decisionId: decision.decisionId,
    version: 1,
    timestamp: decision.timestamp,
    mode: decision.mode,
    providerId: decision.selected?.providerId,
    modelId: decision.selected?.modelId,
    manual: decision.manual,
    unavailable: decision.unavailable,
    explanation: decision.explanation,
    factors: decision.factors.slice(0, 16),
    fallbackChain: decision.fallbackChain,
    localityPolicy: decision.constraints.localityPolicy,
    confidence: decision.confidence,
    rejectedCount: decision.rejected.length,
    humanHandoff: decision.humanHandoff?.required,
  };
}

function finalize(decision: RoutingDecision): RouteResult {
  return { decision, record: toRecord(decision) };
}

export function routingDecisionToRecord(decision: RoutingDecision): RoutingDecisionRecord {
  return toRecord(decision);
}
