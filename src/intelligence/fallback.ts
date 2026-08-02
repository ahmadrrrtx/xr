/**
 * XR 4.4 — Safe fallback / escalation policy.
 *
 * Fallback must:
 *   - stay capability + policy compatible
 *   - never silently escalate locality (local → cloud) without allowCloudFallback
 *   - preserve original selection in the decision record
 *   - support human handoff when nothing safe remains
 */

import type { RoutingHealthView } from "./health.ts";
import type {
  CandidateEvaluation,
  FallbackStep,
  Locality,
  ModelDescriptor,
  PolicyConstraints,
  RoutingDecision,
  TaskRequirements,
} from "./types.ts";

export type FallbackTrigger =
  | "before_request"
  | "rate_limit"
  | "timeout"
  | "invalid_response"
  | "tool_incompatible"
  | "provider_outage"
  | "budget_exhausted"
  | "privacy_restriction"
  | "local_unavailable"
  | "unknown_completion"
  | "auth_failure";

export interface FallbackPlan {
  allowed: boolean;
  steps: FallbackStep[];
  humanHandoff?: { required: boolean; reason: string };
  /** True when cloud would be needed but is not allowed. */
  blockedCloudEscalation?: boolean;
}

const LOCALITY_RANK: Record<Locality, number> = {
  local: 0,
  private: 1,
  hybrid: 2,
  cloud: 3,
};

/**
 * Build an ordered fallback chain from ranked compatible candidates,
 * excluding the already-selected model.
 *
 * Phase 5 · T3 — TARGET DIVERSITY, FIRST-CLASS (Charter §9.5; R3): a
 * cross-provider step outranks a same-provider step with a similar score,
 * because a provider-level outage or a shared rate-limit pool makes the
 * same-provider step fail for the SAME reason the primary just failed.
 * Ordering is stable within each class (score order preserved).
 *
 * Phase 5 · T3 — candidates behind an OPEN circuit breaker are excluded
 * (their reason stays visible in the decision's rejected list, produced by
 * the evaluator).
 */
export function buildFallbackChain(
  rankedCompatible: CandidateEvaluation[],
  selected: ModelDescriptor | undefined,
  requirements: TaskRequirements,
  policy: PolicyConstraints,
  maxSteps = 3,
  routingHealth?: RoutingHealthView,
): FallbackPlan {
  const allow =
    (requirements.allowFallback ?? policy.allowFallback) &&
    policy.routingMode !== "disabled";

  if (!allow) {
    return {
      allowed: false,
      steps: [],
      humanHandoff: selected
        ? undefined
        : { required: true, reason: "No primary selection and fallback disabled" },
    };
  }

  // Strict pin with no fallback-on-failure
  if (requirements.pin?.strict && requirements.allowFallback !== true) {
    return {
      allowed: false,
      steps: [],
      humanHandoff: {
        required: !selected,
        reason: "Strict pin — fallback disabled",
      },
    };
  }

  const allowCloud =
    requirements.allowCloudFallback === true ||
    (policy.allowCloudFallback &&
      (requirements.localityPolicy ?? policy.localityPolicy) !== "local_only" &&
      (requirements.localityPolicy ?? policy.localityPolicy) !== "private_only" &&
      (requirements.localityPolicy ?? policy.localityPolicy) !== "no_cloud");

  const selectedLocality = selected?.locality.locality;
  const steps: FallbackStep[] = [];
  let blockedCloudEscalation = false;

  // Target diversity first: cross-provider candidates before same-provider
  // (different model) ones — stable within each class.
  const ordered = [...rankedCompatible].sort((a, b) => {
    if (!selected) return 0;
    const aCross = a.model.providerId !== selected.providerId ? 0 : 1;
    const bCross = b.model.providerId !== selected.providerId ? 0 : 1;
    return aCross - bCross;
  });

  for (const ev of ordered) {
    if (steps.length >= maxSteps) break;
    const m = ev.model;
    if (selected && m.key === selected.key) continue;

    // Circuit breaker: skip OPEN targets (reason already on rejected list)
    if (routingHealth && routingHealth.gate(m.providerId, m.modelId).state === "open") {
      continue;
    }

    // Never escalate locality silently
    if (selectedLocality) {
      const from = LOCALITY_RANK[selectedLocality] ?? 0;
      const to = LOCALITY_RANK[m.locality.locality] ?? 0;
      if (to > from) {
        // Escalation
        if (m.locality.locality === "cloud" && !allowCloud) {
          blockedCloudEscalation = true;
          continue;
        }
        if (
          (requirements.localityPolicy ?? policy.localityPolicy) === "local_only" ||
          (requirements.localityPolicy ?? policy.localityPolicy) === "no_cloud"
        ) {
          blockedCloudEscalation = true;
          continue;
        }
      }
    } else if (m.locality.locality === "cloud" && !allowCloud) {
      const loc = requirements.localityPolicy ?? policy.localityPolicy;
      if (loc === "local_only" || loc === "private_only" || loc === "no_cloud") {
        blockedCloudEscalation = true;
        continue;
      }
    }

    const diverse = !selected || m.providerId !== selected.providerId;
    steps.push({
      providerId: m.providerId,
      modelId: m.modelId,
      reason:
        (ev.score ? `next-best score=${ev.score.total.toFixed(3)}` : "compatible alternative") +
        (diverse ? " · cross-provider" : " · same-provider distinct model"),
    });
  }

  if (!selected && steps.length === 0) {
    return {
      allowed: true,
      steps: [],
      blockedCloudEscalation,
      humanHandoff: {
        required: true,
        reason: blockedCloudEscalation
          ? "No compatible local/private candidate; cloud escalation blocked by policy"
          : "No compatible candidate available",
      },
    };
  }

  return { allowed: true, steps, blockedCloudEscalation };
}

/**
 * Decide whether a runtime failure may trigger fallback.
 * Unknown completion after possible side effects must NOT auto-fallback.
 */
export function mayFallbackOnTrigger(trigger: FallbackTrigger): {
  allow: boolean;
  reason: string;
} {
  switch (trigger) {
    case "before_request":
    case "provider_outage":
    case "auth_failure":
    case "rate_limit":
    case "timeout":
    case "invalid_response":
    case "tool_incompatible":
    case "local_unavailable":
      return { allow: true, reason: `trigger ${trigger} is safe for model-level fallback` };
    case "budget_exhausted":
      return { allow: false, reason: "budget exhausted — revalidate budget before any retry" };
    case "privacy_restriction":
      return { allow: false, reason: "privacy restriction — do not escalate" };
    case "unknown_completion":
      return {
        allow: false,
        reason: "ambiguous provider completion — refuse automatic fallback to avoid duplicate side effects",
      };
    default:
      return { allow: false, reason: "unknown trigger" };
  }
}

/** Next fallback step from a decision, if any. */
export function nextFallback(decision: RoutingDecision): FallbackStep | undefined {
  return decision.fallbackChain[0];
}

/** Advance chain after a failed attempt (returns new chain without the head). */
export function advanceFallbackChain(decision: RoutingDecision): FallbackStep[] {
  return decision.fallbackChain.slice(1);
}
