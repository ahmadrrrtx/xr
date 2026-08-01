/**
 * Phase 4 · T1 — restrictiveness lattice (escalate-only) tests.
 *
 * Asserts the lattice ORDERING and the escalate-only MERGE semantics:
 *   · placement order: in_process < restricted_process < namespace_sandbox
 *     < container ≈ browser_isolated < gvisor < firecracker;
 *   · merges always pick the more restrictive element;
 *   · a capability-declared minimum tier can only RAISE the effective tier;
 *   · a placement weaker than the tier minimum is refused;
 *   · per-run escalation is monotone (never downgrades).
 */
import { describe, expect, test } from "bun:test";
import {
  PLACEMENT_RANK,
  atLeastAsRestrictive,
  mergePlacements,
  mergeAllPlacements,
  effectiveTier,
  placementSatisfiesTier,
  escalateOnly,
} from "../../src/runtime/trust/lattice.ts";
import { decidePlacementForTier } from "../../src/runtime/trust/policy.ts";
import type { PlacementCapabilities } from "../../src/runtime/trust/policy.ts";

describe("Phase 4 · T1 — restrictiveness lattice ordering", () => {
  test("the total order is firecracker > gvisor > container > namespace > restricted > in-process", () => {
    expect(PLACEMENT_RANK.in_process).toBeLessThan(PLACEMENT_RANK.restricted_process);
    expect(PLACEMENT_RANK.restricted_process).toBeLessThan(PLACEMENT_RANK.namespace_sandbox);
    expect(PLACEMENT_RANK.namespace_sandbox).toBeLessThan(PLACEMENT_RANK.container);
    expect(PLACEMENT_RANK.container).toBeLessThan(PLACEMENT_RANK.gvisor);
    expect(PLACEMENT_RANK.gvisor).toBeLessThan(PLACEMENT_RANK.firecracker);
  });

  test("atLeastAsRestrictive is reflexive and transitive", () => {
    expect(atLeastAsRestrictive("in_process", "in_process")).toBe(true);
    expect(atLeastAsRestrictive("namespace_sandbox", "in_process")).toBe(true);
    expect(atLeastAsRestrictive("in_process", "namespace_sandbox")).toBe(false);
    // transitivity sample
    expect(atLeastAsRestrictive("gvisor", "namespace_sandbox")).toBe(true);
    expect(atLeastAsRestrictive("firecracker", "gvisor")).toBe(true);
    expect(atLeastAsRestrictive("firecracker", "restricted_process")).toBe(true);
  });
});

describe("Phase 4 · T1 — escalate-only merge", () => {
  test("mergePlacements always picks the more restrictive element", () => {
    expect(mergePlacements("in_process", "namespace_sandbox")).toBe("namespace_sandbox");
    expect(mergePlacements("namespace_sandbox", "in_process")).toBe("namespace_sandbox");
    expect(mergePlacements("container", "namespace_sandbox")).toBe("container");
    expect(mergePlacements("gvisor", "container")).toBe("gvisor");
    expect(mergePlacements("firecracker", "gvisor")).toBe("firecracker");
  });

  test("mergeAllPlacements folds a list to the strongest", () => {
    expect(
      mergeAllPlacements(["in_process", "restricted_process", "namespace_sandbox", "in_process"]),
    ).toBe("namespace_sandbox");
  });

  test("a later weaker request can never downgrade the merged placement", () => {
    // Simulate a run: escalated to namespace_sandbox, then a weaker request arrives.
    let merged: ReturnType<typeof mergePlacements> = "in_process";
    merged = mergePlacements(merged, "namespace_sandbox"); // first action escalates
    merged = mergePlacements(merged, "restricted_process"); // second action asks for less
    expect(merged).toBe("namespace_sandbox"); // stays escalated
    merged = mergePlacements(merged, "container");
    expect(merged).toBe("container");
    merged = mergePlacements(merged, "restricted_process"); // downgrade attempt
    expect(merged).toBe("container"); // refused by construction
  });
});

describe("Phase 4 · T1 — effective tier (classified × declared × run)", () => {
  test("a capability-declared minimum can only raise the effective tier", () => {
    expect(effectiveTier("tier0_in_process", "tier2_isolated", undefined)).toBe("tier2_isolated");
    expect(effectiveTier("tier2_isolated", "tier0_in_process", undefined)).toBe("tier2_isolated");
    expect(effectiveTier("tier1_restricted", "tier2_isolated", undefined)).toBe("tier2_isolated");
  });

  test("run escalation is monotone: once escalated, never downgraded", () => {
    expect(effectiveTier("tier0_in_process", undefined, "tier2_isolated")).toBe("tier2_isolated");
    expect(effectiveTier("tier1_restricted", undefined, "tier2_isolated")).toBe("tier2_isolated");
    expect(effectiveTier("tier2_isolated", undefined, "tier1_restricted")).toBe("tier2_isolated");
  });

  test("the max of all three inputs wins", () => {
    expect(effectiveTier("tier1_restricted", "tier2_isolated", "tier2_isolated")).toBe("tier2_isolated");
    expect(effectiveTier("tier0_in_process", "tier1_restricted", "tier1_restricted")).toBe("tier1_restricted");
  });
});

describe("Phase 4 · T1 — tier sufficiency", () => {
  test("tier2 never accepts in-process or restricted placements", () => {
    expect(placementSatisfiesTier("in_process", "tier2_isolated")).toBe(false);
    expect(placementSatisfiesTier("restricted_process", "tier2_isolated")).toBe(false);
    expect(placementSatisfiesTier("namespace_sandbox", "tier2_isolated")).toBe(true);
    expect(placementSatisfiesTier("container", "tier2_isolated")).toBe(true);
    expect(placementSatisfiesTier("gvisor", "tier2_isolated")).toBe(true);
    expect(placementSatisfiesTier("firecracker", "tier2_isolated")).toBe(true);
  });

  test("tier1 accepts restricted and above, never in-process", () => {
    expect(placementSatisfiesTier("in_process", "tier1_restricted")).toBe(false);
    expect(placementSatisfiesTier("restricted_process", "tier1_restricted")).toBe(true);
    expect(placementSatisfiesTier("namespace_sandbox", "tier1_restricted")).toBe(true);
  });

  test("escalateOnly refuses a downgrade below the required tier", () => {
    const r = escalateOnly("namespace_sandbox", "restricted_process", "tier2_isolated");
    expect("blocked" in r && r.blocked).toBe(true);
    const ok = escalateOnly(undefined, "container", "tier2_isolated");
    expect("placement" in ok && ok.placement).toBe("container");
    const merge = escalateOnly("namespace_sandbox", "container", "tier2_isolated");
    expect("placement" in merge && merge.placement).toBe("container");
  });
});

describe("Phase 4 · T1 — placement decision honors the lattice", () => {
  const caps: PlacementCapabilities = {
    inProcess: true,
    restrictedProcess: true,
    namespaceSandbox: true,
    container: false,
    browserIsolated: false,
    gvisor: false,
    firecracker: false,
    isRoot: false,
  };

  test("tier2 with only in-process/restricted available is BLOCKED", () => {
    const d = decidePlacementForTier("tier2_isolated", {
      ...caps,
      restrictedProcess: true,
      namespaceSandbox: false,
    });
    expect(d.kind).toBe("blocked");
  });

  test("gVisor/Firecracker are selected only when actually available (fail-closed)", () => {
    // Cheapest adequate backend first (Art. XII); the stronger rungs are
    // selected when the weaker ones are unavailable — and never claimed
    // otherwise.
    const plain = decidePlacementForTier("tier2_isolated", caps);
    expect(plain.kind === "admitted" && plain.placement).toBe("namespace_sandbox");
    const noNs = decidePlacementForTier("tier2_isolated", { ...caps, namespaceSandbox: false, gvisor: true });
    expect(noNs.kind === "admitted" && noNs.placement).toBe("gvisor");
    const onlyFc = decidePlacementForTier("tier2_isolated", { ...caps, namespaceSandbox: false, gvisor: false, firecracker: true });
    expect(onlyFc.kind === "admitted" && onlyFc.placement).toBe("firecracker");
    const none = decidePlacementForTier("tier2_isolated", { ...caps, namespaceSandbox: false });
    expect(none.kind).toBe("blocked"); // fail closed
  });

  test("hardened mode refuses the tier1 in-process fallback even when configured", () => {
    const soft = decidePlacementForTier("tier1_restricted", { ...caps, restrictedProcess: false, namespaceSandbox: false }, {
      allowTier1InProcessFallback: true,
      hardened: false,
    });
    expect(soft.kind).toBe("admitted");
    const hard = decidePlacementForTier("tier1_restricted", { ...caps, restrictedProcess: false, namespaceSandbox: false }, {
      allowTier1InProcessFallback: true,
      hardened: true,
    });
    expect(hard.kind).toBe("blocked");
  });
});
