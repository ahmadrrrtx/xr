/**
 * XR Phase 4 · T1 — Restrictiveness lattice (escalate-only merge).
 *
 * Constitution Art. IX.2: *"Isolation follows risk."* Art. IX (Isolation is
 * risk-tiered): *"Agents/capabilities may only ESCALATE isolation, never
 * downgrade."*
 *
 * Placement kinds form a total order from weakest to strongest confinement.
 * Every merge of placement requirements — the tier the classifier derived
 * from objective facts, the tier a capability DECLARED it needs, and the
 * tier already escalated to earlier in the same run — picks the MOST
 * RESTRICTIVE element. A model may propose an action; it cannot choose a
 * weaker placement than policy demands, and once a run has escalated, no
 * later action in that run may pull it back down.
 *
 * This module is PURE and deterministic: no I/O, no state. The TrustService
 * holds the mutable per-run escalation state; this module only orders.
 */
import { RISK_TIER_ORDER, type PlacementKind, type RiskTier } from "./types.ts";

/**
 * Restrictiveness rank: higher = stronger confinement.
 *
 *   firecracker > gvisor > container > namespace_sandbox > restricted_process > in_process
 *
 * `browser_isolated` sits at the container rank: it confines the browser
 * surface (a different domain than a generic container, but the same strength
 * class for merge purposes — a browser action is never placed in a weaker
 * generic placement).
 */
export const PLACEMENT_RANK: Record<PlacementKind, number> = {
  in_process: 0,
  restricted_process: 1,
  namespace_sandbox: 2,
  container: 3,
  browser_isolated: 3,
  // Extended placements (detection hooks; fail-closed when unavailable):
  gvisor: 4,
  firecracker: 5,
};

/** Extended placement kinds beyond the Phase-3 core union (detect-only). */
export type ExtendedPlacementKind = "gvisor" | "firecracker";

/** True when `a` confines at least as strongly as `b`. */
export function atLeastAsRestrictive(a: PlacementKind, b: PlacementKind): boolean {
  return PLACEMENT_RANK[a] >= PLACEMENT_RANK[b];
}

/** True when `a` confines strictly more strongly than `b`. */
export function strictlyMoreRestrictive(a: PlacementKind, b: PlacementKind): boolean {
  return PLACEMENT_RANK[a] > PLACEMENT_RANK[b];
}

/**
 * Merge two placement requirements — the merge ALWAYS picks the more
 * restrictive element (escalate-only). On a tie the first argument wins.
 */
export function mergePlacements(a: PlacementKind, b: PlacementKind): PlacementKind {
  return atLeastAsRestrictive(a, b) ? a : b;
}

/** Merge a list of placements, most restrictive wins. */
export function mergeAllPlacements(placements: readonly PlacementKind[]): PlacementKind {
  let merged: PlacementKind = "in_process";
  for (const p of placements) merged = mergePlacements(merged, p);
  return merged;
}

/**
 * The effective tier for an action: the most restrictive of
 *   · the tier the classifier derived from objective facts (never chosen by
 *     the model),
 *   · the minimum tier the capability DECLARED it requires (a plugin/MCP
 *     server may declare a higher minimum than the classifier assigns; it can
 *     never declare a lower one and thereby weaken policy),
 *   · the tier this run has already escalated to (escalate-only within a run).
 */
export function effectiveTier(
  classified: RiskTier,
  declaredMinimum: RiskTier | undefined,
  runEscalated: RiskTier | undefined,
): RiskTier {
  const tiers = [classified, declaredMinimum ?? "tier0_in_process", runEscalated ?? "tier0_in_process"];
  return tiers.sort((x, y) => RISK_TIER_ORDER[y] - RISK_TIER_ORDER[x])[0];
}

/**
 * True when the given placement is strong enough for the given tier:
 *   tier0 → in_process is enough (and anything stronger also satisfies it);
 *   tier1 → at least restricted_process;
 *   tier2 → at least namespace_sandbox (never in-process, never policy-only).
 */
export function placementSatisfiesTier(placement: PlacementKind, tier: RiskTier): boolean {
  const minimum: Record<RiskTier, PlacementKind> = {
    tier0_in_process: "in_process",
    tier1_restricted: "restricted_process",
    tier2_isolated: "namespace_sandbox",
  };
  return atLeastAsRestrictive(placement, minimum[tier]);
}

/**
 * Refuse a requested placement that would DOWNGRADE an existing requirement.
 * Returns the merged (more restrictive) placement, or null when the request
 * is not strong enough for the declared minimum tier.
 */
export function escalateOnly(
  current: PlacementKind | undefined,
  requested: PlacementKind,
  requiredTier: RiskTier,
): { placement: PlacementKind } | { blocked: true; reason: string } {
  if (!placementSatisfiesTier(requested, requiredTier)) {
    return {
      blocked: true,
      reason: `placement "${requested}" is not strong enough for ${requiredTier} (escalate-only; refused downgrade)`,
    };
  }
  const merged = current === undefined ? requested : mergePlacements(current, requested);
  return { placement: merged };
}
