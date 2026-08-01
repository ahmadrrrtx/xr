/**
 * XR 4.2 — Policy-to-Placement Decision
 *
 * Pure decision logic: given a deterministic risk classification and the set
 * of placement backends actually available on this host, decide WHERE the
 * action may run. High-risk (Tier 2) work FAILS CLOSED when no enforceable
 * backend is available — it is never silently downgraded to in-process.
 *
 * This module decides; the EnvironmentManager provisions/verifies/cleans.
 */
import {
  TRUST_POLICY_VERSION,
  type PlacementDecision,
  type PlacementKind,
  type RiskClassification,
  type RiskTier,
} from "./types.ts";
import { placementSatisfiesTier } from "./lattice.ts";

/** Capability snapshot of which placements the host can currently enforce. */
export interface PlacementCapabilities {
  readonly inProcess: boolean;          // always true
  readonly restrictedProcess: boolean;  // can spawn a confined child process
  readonly namespaceSandbox: boolean;   // bubblewrap or user-namespace sandbox
  readonly container: boolean;          // docker/podman present + usable
  readonly browserIsolated: boolean;    // isolated browser profile available
  /** Phase 4 · T1 — gVisor runsc container runtime (detection hook). */
  readonly gvisor: boolean;
  /** Phase 4 · T1 — Firecracker microVM runtime (detection hook). */
  readonly firecracker: boolean;
  /** True when running as root (which weakens many sandboxes). */
  readonly isRoot: boolean;
}

export interface PlacementPolicyConfig {
  /**
   * Permit Tier 1 (restricted) work to run in-process when no process
   * sandbox is available. Default FALSE (fail closed). Enabling this is an
   * explicit, logged weakening of the boundary for medium-risk work only; it
   * NEVER affects Tier 2.
   */
  readonly allowTier1InProcessFallback?: boolean;
  /** Prefer container over namespace sandbox when both are available. */
  readonly preferContainer?: boolean;
  /**
   * Phase 4 · T1 — hardened mode. When true (the default), the policy NEVER
   * weakens a required tier: the tier1 in-process fallback is refused even if
   * explicitly configured, and any placement weaker than the tier minimum is
   * rejected. Fail-closed everywhere (Art. IV.4 / IX.6).
   */
  readonly hardened?: boolean;
}

/**
 * Candidate order per tier — cheapest ADEQUATE backend first (Art. XII:
 * low/medium-risk work stays fast; the microVM rungs are for hosts that have
 * them and for high-risk/infrequent actions, not a default slowdown).
 *
 * The escalate-only property of the lattice (lattice.ts) is enforced at MERGE
 * time — per-run escalation, capability-declared minimum tiers, and refusal
 * of any placement weaker than the tier minimum — not by always picking the
 * strongest available backend. `preferContainer` moves the container above
 * the namespace sandbox (an operator preference between two tier-adequate
 * placements, never a downgrade).
 */
const MIN_PLACEMENT_FOR_TIER: Record<RiskTier, PlacementKind[]> = {
  tier0_in_process: ["in_process"],
  tier1_restricted: ["restricted_process", "namespace_sandbox", "container", "gvisor", "firecracker"],
  tier2_isolated: ["namespace_sandbox", "container", "browser_isolated", "gvisor", "firecracker"],
};

function orderedCandidates(tier: RiskTier, config: PlacementPolicyConfig): PlacementKind[] {
  const min = [...MIN_PLACEMENT_FOR_TIER[tier]];
  if (config.preferContainer) {
    return min.sort((a, b) => (a === "container" && b === "namespace_sandbox" ? -1 : 0));
  }
  return min;
}

function isAvailable(kind: PlacementKind, caps: PlacementCapabilities): boolean {
  switch (kind) {
    case "in_process":
      return caps.inProcess;
    case "restricted_process":
      return caps.restrictedProcess && !caps.isRoot;
    case "namespace_sandbox":
      return caps.namespaceSandbox && !caps.isRoot;
    case "container":
      return caps.container;
    case "browser_isolated":
      return caps.browserIsolated && !caps.isRoot;
    case "gvisor":
      return caps.gvisor && !caps.isRoot;
    case "firecracker":
      return caps.firecracker && !caps.isRoot;
  }
}

/**
 * Decide placement for an explicitly requested tier (used by the trust
 * service after the lattice merge: the effective tier may be higher than the
 * classifier's, and the placement decision must follow the EFFECTIVE tier).
 */
export function decidePlacementForTier(
  tier: RiskTier,
  caps: PlacementCapabilities,
  config: PlacementPolicyConfig = {},
): PlacementDecision {
  const now = Date.now();
  const base = {
    requestedTier: tier,
    decidedAt: now,
    policyVersion: TRUST_POLICY_VERSION,
  } as const;

  // Running as root defeats unprivileged sandbox guarantees.
  if (tier !== "tier0_in_process" && caps.isRoot) {
    return {
      ...base,
      kind: "blocked",
      placement: "in_process",
      reason: "refusing restricted/isolated placement while running as root (sandbox guarantees void)",
      remediation: "Run XR as an unprivileged user.",
    };
  }

  if (tier === "tier0_in_process") {
    return { ...base, kind: "in_process_ok", placement: "in_process", reason: "low-risk in-process path" };
  }

  const candidates = orderedCandidates(tier, config);
  for (const kind of candidates) {
    if (isAvailable(kind, caps)) {
      // Lattice sanity: never admit a placement weaker than the tier minimum
      // (escalate-only; hardened or not, this is an invariant).
      if (!placementSatisfiesTier(kind, tier)) {
        return {
          ...base,
          kind: "blocked",
          placement: "in_process",
          reason: `internal: candidate ${kind} does not satisfy ${tier} (lattice violated)`,
          remediation: "Report as a defect; the lattice must never admit a weaker placement.",
        };
      }
      return {
        ...base,
        kind: "admitted",
        placement: kind,
        reason: `selected ${kind} for ${tier}`,
      };
    }
  }

  // No enforceable backend for the required tier.
  if (
    tier === "tier1_restricted" &&
    config.allowTier1InProcessFallback &&
    caps.inProcess &&
    !config.hardened
  ) {
    return {
      ...base,
      kind: "admitted",
      placement: "in_process",
      reason: "TIER1 DEGRADED: process sandbox unavailable; running in-process with policy-only boundary (explicit fallback; hardened mode OFF)",
      remediation: "Install a process/namespace sandbox to restore the Tier 1 boundary, or enable hardened mode.",
    };
  }

  // Fail closed (this is the path Tier 2 takes when no sandbox exists, and the
  // path Tier 1 takes when hardened).
  return {
    ...base,
    kind: "blocked",
    placement: "in_process",
    reason: `required isolation for ${tier} is unavailable on this host${config.hardened ? " (hardened mode)" : ""}`,
    remediation:
      tier === "tier2_isolated"
        ? "Install bubblewrap (or a container runtime) so high-risk actions can run isolated; high-risk work will not run in-process."
        : "Install a process/namespace sandbox, or set allowTier1InProcessFallback to accept a policy-only boundary.",
  };
}

/**
 * Decide placement. Returns an "admitted"/"in_process_ok" decision when an
 * enforceable backend exists, or a "blocked" decision (fail closed) when the
 * required isolation is unavailable.
 */
export function decidePlacement(
  classification: RiskClassification,
  caps: PlacementCapabilities,
  config: PlacementPolicyConfig = {},
): PlacementDecision {
  if (classification.blocked) {
    return {
      ...decidePlacementForTier(classification.tier, caps, config),
      kind: "blocked",
      reason: classification.blockReason ?? "classifier marked request blocked",
      remediation: "Reduce action scope or provide required isolation/credentials.",
    };
  }
  return decidePlacementForTier(classification.tier, caps, config);
}

/** Minimum placement kind required for a tier (for verification + docs). */
export function minPlacementForTier(tier: RiskTier): PlacementKind[] {
  return MIN_PLACEMENT_FOR_TIER[tier];
}
