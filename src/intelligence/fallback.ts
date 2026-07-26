/**
 * XR 4.4 — Safe fallback / escalation policy.
 *
 * Fallback must:
 *   - stay capability + policy compatible
 *   - never silently escalate locality (local → cloud) without allowCloudFallback
 *   - preserve original selection in the decision record
 *   - support human handoff when nothing safe remains
 */

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
 */
export function buildFallbackChain(
  rankedCompatible: CandidateEvaluation[],
  selected: ModelDescriptor | undefined,
  requirements: TaskRequirements,
  policy: PolicyConstraints,
  maxSteps = 3,
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

  for (const ev of rankedCompatible) {
    if (steps.length >= maxSteps) break;
    const m = ev.model;
    if (selected && m.key === selected.key) continue;

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

    steps.push({
      providerId: m.providerId,
      modelId: m.modelId,
      reason: ev.score
        ? `next-best score=${ev.score.total.toFixed(3)}`
        : "compatible alternative",
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
