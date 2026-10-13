/**
 * XR Cloud — policy engine (the enforcement half).
 *
 * The admin console writes policy; this file is where policy means something.
 * Every gate below is a **pure function over an explicit decision input**, which
 * is what makes it testable without a database and — more importantly — what
 * makes it impossible for a route to accidentally consult half a policy.
 *
 * ## The composition rule
 *
 * Team policy can only ever *narrow* what a user may do. It is ANDed with
 * everything else that already applies on the local machine:
 *
 *   may_run = local_budget_ok AND team_policy_ok AND subscription_ok
 *
 * The local budget is never widened, never bypassed, and never even seen by this
 * service. A team admin setting a $10/day cap does not raise a member's own $5
 * local cap; it adds a second, tighter lane. That is the whole reason a
 * Personal-tier user can install XR on the same machine and notice no difference
 * whatsoever.
 *
 * ## Fail-closed
 *
 * Where a decision depends on a value that is missing or unparseable, the
 * restrictive branch is taken (Constitution Art. IV.4). A policy row that failed
 * to load is not "no policy" — the caller distinguishes `null` (genuinely no row,
 * use safe defaults) from an error (refuse).
 */

import type { EgressRule, PolicyRow, ProviderAllowlist } from "../db/schema.ts";

/** Safe defaults, used only when an org has no policy row at all. */
export const DEFAULT_POLICY = {
  includedQuotaMicroUsd: 20_000_000, // $20 / user / month soft quota
  defaultDailyBudgetMicroUsd: null,
  defaultMonthlyBudgetMicroUsd: null,
  teamMonthlyBudgetMicroUsd: null,
  requireApprovalAboveMicroUsd: null,
  allowedProviders: [] as ProviderAllowlist[],
  egressRules: [] as EgressRule[],
  dataRetentionDays: 30,
  auditRetentionDays: 365,
  blockSensitiveMemory: false,
  disableByok: false,
  relayEnabled: true,
} as const;

export type PolicyView = Omit<PolicyRow, "id" | "orgId" | "createdAt" | "updatedAt">;

export function policyView(row: PolicyRow | undefined): PolicyView {
  if (!row) return { ...DEFAULT_POLICY };
  return {
    includedQuotaMicroUsd: row.includedQuotaMicroUsd,
    defaultDailyBudgetMicroUsd: row.defaultDailyBudgetMicroUsd,
    defaultMonthlyBudgetMicroUsd: row.defaultMonthlyBudgetMicroUsd,
    teamMonthlyBudgetMicroUsd: row.teamMonthlyBudgetMicroUsd,
    requireApprovalAboveMicroUsd: row.requireApprovalAboveMicroUsd,
    allowedProviders: row.allowedProviders,
    egressRules: row.egressRules,
    dataRetentionDays: row.dataRetentionDays,
    auditRetentionDays: row.auditRetentionDays,
    blockSensitiveMemory: row.blockSensitiveMemory,
    disableByok: row.disableByok,
    relayEnabled: row.relayEnabled,
  };
}

export interface MemberOverrides {
  dailyCapMicroUsd: number | null;
  monthlyCapMicroUsd: number | null;
  byokOnly: boolean;
}

export interface ModelRequestDecisionInput {
  policy: PolicyView;
  overrides: MemberOverrides;
  provider: string;
  model: string;
  /** true when the request would be paid for by XR rather than the user's key. */
  managed: boolean;
  /**
   * Known cost of the call when the provider is metered (estimated cost when the
   * model can be priced, else null). `null` means "unknown", which cannot
   * satisfy a spend ceiling — see the approval gate below.
   */
  estimatedCostMicroUsd: number | null;
  /** Already-spent counters for this user. */
  spentTodayMicroUsd: number;
  spentThisMonthMicroUsd: number;
  /** Aggregate team spend this month, for the team ceiling. */
  teamSpentThisMonthMicroUsd: number;
  /** Subscription status — the gate that makes a cancelled org stop spending. */
  subscriptionStatus: "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete";
}

export type ModelRequestDecision =
  | { allowed: true; requiresApproval: boolean; reason?: string }
  | { allowed: false; code: PolicyDenyCode; repair: string; detail?: Record<string, unknown> };

export type PolicyDenyCode =
  | "budget_exceeded"
  | "provider_disabled"
  | "byok_required"
  | "subscription_inactive"
  | "approval_required";

/** Provider allowlist. An empty list means "no restriction", stated explicitly. */
export function providerAllowed(policy: PolicyView, provider: string, model: string): boolean {
  if (policy.allowedProviders.length === 0) return true;
  return policy.allowedProviders.some((entry) => {
    if (entry.provider !== provider) return false;
    if (!entry.models || entry.models.length === 0) return true;
    // A model allowlist inside a provider entry is a prefix match, so
    // "claude-sonnet" allows "claude-sonnet-4-5-20250929" without the admin
    // having to track every dated release.
    return entry.models.some((prefix) => model === prefix || model.startsWith(prefix));
  });
}

export function allowedProviderNames(policy: PolicyView): string[] {
  return policy.allowedProviders.map((p) => p.provider);
}

/** Effective caps: a member override is a tightening knob, never a widening one. */
export function effectiveCaps(
  policy: PolicyView,
  overrides: MemberOverrides,
): { dailyMicroUsd: number | null; monthlyMicroUsd: number | null } {
  const daily = minDefined(policy.defaultDailyBudgetMicroUsd, overrides.dailyCapMicroUsd);
  const monthly = minDefined(policy.defaultMonthlyBudgetMicroUsd, overrides.monthlyCapMicroUsd);
  return { dailyMicroUsd: daily, monthlyMicroUsd: monthly };
}

/** The lower of two ceilings. `null` = no ceiling. */
function minDefined(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * The decision. Order matters, and it is chosen so the most *actionable* reason
 * wins: telling someone "your team must configure Stripe" is worse than telling
 * them "you are $2 over today's cap" when both are true.
 */
export function decideModelRequest(input: ModelRequestDecisionInput): ModelRequestDecision {
  const { policy, overrides } = input;

  // 1. Subscription. A cancelled org stops spending XR's money immediately.
  if (
    input.subscriptionStatus === "canceled" ||
    input.subscriptionStatus === "unpaid" ||
    input.subscriptionStatus === "incomplete"
  ) {
    return {
      allowed: false,
      code: "subscription_inactive",
      repair:
        "Your team's Business subscription is not active, so XR-managed models are unavailable. " +
        "Your own API keys (BYOK) and every local model still work — nothing else is affected.",
    };
  }

  // 2. BYOK-required orgs. Checked before budget because it applies regardless.
  if (policy.disableByok && input.managed) {
    return {
      allowed: false,
      code: "byok_required",
      repair:
        "Your team requires bring-your-own-key for cost control. Add a provider key in Settings → Models, " +
        "or ask an admin to allow XR-managed keys.",
    };
  }

  // 3. BYOK-only member. Uses the provider directly, so no XR spend is involved
  //    and the budget gates below do not apply — but the provider allowlist does,
  //    because an org may have contractual reasons to exclude a provider.
  if (input.managed && overrides.byokOnly) {
    return {
      allowed: false,
      code: "byok_required",
      repair:
        "Your account is set to BYOK-only. Add your own provider key in Settings → Models to use this model.",
    };
  }

  // 4. Provider allowlist. Applies to BYOK too.
  if (!providerAllowed(policy, input.provider, input.model)) {
    return {
      allowed: false,
      code: "provider_disabled",
      repair:
        allowedProviderNames(policy).length > 0
          ? `Your admin allows: ${allowedProviderNames(policy).join(", ")}. Use one of those, or ask for ${input.provider} to be added.`
          : "Ask an organization admin to enable this provider.",
      detail: { provider: input.provider, allowed: allowedProviderNames(policy) },
    };
  }

  // Everything below concerns XR's money. BYOK requests are done.
  if (!input.managed) return { allowed: true, requiresApproval: false };

  const caps = effectiveCaps(policy, overrides);
  const cost = input.estimatedCostMicroUsd;

  // 5. Per-user daily cap. `cost` may be null when a model is unpriced; an
  //    unpriced call still counts as spend, so it is compared at zero-tolerance
  //    only against whether the cap is *already* met.
  if (caps.dailyMicroUsd !== null) {
    const spent = input.spentTodayMicroUsd;
    if (spent >= caps.dailyMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair:
          `Today's XR-managed budget is used up (${fmtMicro(spent)} of ${fmtMicro(caps.dailyMicroUsd)}). ` +
          "It resets at 00:00 UTC. Your local models and your own API keys are unaffected and still work.",
        detail: { scope: "daily", spentMicroUsd: spent, capMicroUsd: caps.dailyMicroUsd },
      };
    }
    if (cost !== null && spent + cost > caps.dailyMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair:
          `This request would take you past today's XR-managed budget ` +
          `(${fmtMicro(spent)} + ~${fmtMicro(cost)} of ${fmtMicro(caps.dailyMicroUsd)}). ` +
          "It resets at 00:00 UTC. Try a smaller model, or use your own key.",
        detail: { scope: "daily", spentMicroUsd: spent, capMicroUsd: caps.dailyMicroUsd, estimatedMicroUsd: cost },
      };
    }
  }

  // 6. Per-user monthly cap.
  if (caps.monthlyMicroUsd !== null) {
    const spent = input.spentThisMonthMicroUsd;
    if (spent >= caps.monthlyMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair:
          `This month's XR-managed budget is used up (${fmtMicro(spent)} of ${fmtMicro(caps.monthlyMicroUsd)}). ` +
          "It resets on the 1st. Ask an admin to raise it, or use your own key.",
        detail: { scope: "monthly", spentMicroUsd: spent, capMicroUsd: caps.monthlyMicroUsd },
      };
    }
    if (cost !== null && spent + cost > caps.monthlyMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair: `This request would exceed this month's XR-managed budget (${fmtMicro(spent)} of ${fmtMicro(caps.monthlyMicroUsd)}).`,
        detail: { scope: "monthly", spentMicroUsd: spent, capMicroUsd: caps.monthlyMicroUsd },
      };
    }
  }

  // 7. Team ceiling — a blast-radius limit, checked last so an individual's
  //    personal cap message reaches them first.
  if (policy.teamMonthlyBudgetMicroUsd !== null) {
    const spent = input.teamSpentThisMonthMicroUsd;
    if (spent >= policy.teamMonthlyBudgetMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair:
          `Your team's monthly XR-managed ceiling is reached (${fmtMicro(spent)} of ${fmtMicro(policy.teamMonthlyBudgetMicroUsd)}). ` +
          "Ask an organization owner to raise it. Local models and BYOK are unaffected.",
        detail: { scope: "team", spentMicroUsd: spent, capMicroUsd: policy.teamMonthlyBudgetMicroUsd },
      };
    }
    if (cost !== null && spent + cost > policy.teamMonthlyBudgetMicroUsd) {
      return {
        allowed: false,
        code: "budget_exceeded",
        repair: "This request would exceed your team's monthly XR-managed ceiling.",
        detail: { scope: "team", spentMicroUsd: spent, capMicroUsd: policy.teamMonthlyBudgetMicroUsd },
      };
    }
  }

  // 8. Approval escalation. When a threshold is configured and the cost is
  //    UNKNOWN, the restrictive branch applies: an unpriced action above an
  //    approval threshold cannot be assumed cheap. The cloud does not implement
  //    the approval UX (it lives on the local approval store, which already
  //    syncs across surfaces) — it reports that approval is required and the
  //    daemon raises the prompt.
  if (policy.requireApprovalAboveMicroUsd !== null) {
    const overThreshold = cost === null || cost > policy.requireApprovalAboveMicroUsd;
    if (overThreshold) {
      return {
        allowed: true,
        requiresApproval: true,
        reason:
          cost === null
            ? "This model is not priced by XR, so it counts as above your team's approval threshold."
            : `Estimated cost ${fmtMicro(cost)} is above your team's approval threshold of ${fmtMicro(policy.requireApprovalAboveMicroUsd)}.`,
      };
    }
  }

  return { allowed: true, requiresApproval: false };
}

/**
 * Reply text for a policy denial, already shaped for the wire.
 *
 * `approval_required` is in the union even though it is not reachable today: the
 * type describes every reason a policy can refuse, and narrowing it to the
 * currently-reachable subset is how a new gate ships with an unhandled case.
 */
export function denyBody(decision: Extract<ModelRequestDecision, { allowed: false }>): {
  code: "policy_denied" | "budget_exceeded" | "provider_disabled" | "byok_required" | "approval_required";
  message: string;
  repair: string;
  details?: Record<string, unknown>;
} {
  const message =
    decision.code === "budget_exceeded"
      ? "Your XR-managed budget is exhausted for this period."
      : decision.code === "provider_disabled"
        ? "That provider is not enabled for your team."
        : decision.code === "byok_required"
          ? "Your team requires bring-your-own-key."
          : "Your team's subscription is not active.";
  return {
    code: decision.code === "subscription_inactive" ? "policy_denied" : decision.code,
    message,
    repair: decision.repair,
    ...(decision.detail ? { details: decision.detail } : {}),
  };
}

function fmtMicro(micro: number): string {
  const usd = micro / 1_000_000;
  return `$${usd < 0.01 ? usd.toFixed(6) : usd.toFixed(2)}`;
}

/**
 * Egress rules for team-mode skills. Returns the note attached to the matching
 * rule so the daemon can tell a user *why* a destination was allowed.
 */
export function egressDecision(
  policy: PolicyView,
  destination: string,
): { allowed: true; note?: string } | { allowed: false; repair: string } {
  if (policy.egressRules.length === 0) return { allowed: true };
  const match = policy.egressRules.find(
    (rule) => destination === rule.destination || destination.endsWith(`.${rule.destination}`),
  );
  if (match) return { allowed: true, ...(match.note ? { note: match.note } : {}) };
  return {
    allowed: false,
    repair:
      `Your team restricts outbound traffic to: ${policy.egressRules.map((r) => r.destination).join(", ")}. ` +
      `Ask an admin to allow ${destination} if it is needed.`,
  };
}
