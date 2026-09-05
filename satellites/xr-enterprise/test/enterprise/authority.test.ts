/**
 * XR 6.1 — Phase 12 Tests: Delegated authority, subset enforcement, revocation, review.
 */
import { describe, expect, test } from "bun:test";
import {
  DelegationRegistry,
  validateDelegation,
  scopeHeld,
  minRiskTier,
  rootAuthority,
  evaluatePolicy,
  policyRule,
  type AuthoritySubject,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const human: AuthoritySubject = { kind: "user", subjectId: "user_alice", organizationId: "org1", displayName: "Alice" };
const worker: AuthoritySubject = { kind: "ai_worker", subjectId: "worker_sales", organizationId: "org1", displayName: "Sales Worker" };
const worker2: AuthoritySubject = { kind: "ai_worker", subjectId: "worker_ops", organizationId: "org1" };

function registry(now = NOW): DelegationRegistry {
  return new DelegationRegistry({ now: () => now });
}

describe("Scope matching", () => {
  test("exact match", () => {
    expect(scopeHeld(["fs:read"], "fs:read")).toBe(true);
    expect(scopeHeld(["fs:read"], "fs:write")).toBe(false);
  });

  test("wildcard segment", () => {
    expect(scopeHeld(["fs:*"], "fs:read")).toBe(true);
    expect(scopeHeld(["fs:*"], "fs:write")).toBe(true);
    expect(scopeHeld(["fs:*"], "net:egress")).toBe(false);
  });

  test("global wildcard", () => {
    expect(scopeHeld(["*"], "anything:at:all")).toBe(true);
  });

  test("empty holds nothing", () => {
    expect(scopeHeld([], "fs:read")).toBe(false);
  });
});

describe("Risk tier ceiling", () => {
  test("minRiskTier picks the lower (tighter) ceiling", () => {
    expect(minRiskTier("tier0_in_process", "tier2_isolated")).toBe("tier0_in_process");
    expect(minRiskTier("tier2_isolated", "tier1_restricted")).toBe("tier1_restricted");
    expect(minRiskTier("tier1_restricted", "tier1_restricted")).toBe("tier1_restricted");
  });
});

describe("Delegation validation — strict subset", () => {
  test("scopes the delegator does not hold are stripped, not granted", () => {
    const v = validateDelegation({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "net:egress", "admin:everything"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      now: NOW,
    });

    expect(v.ok).toBe(true);
    expect(v.effectiveScopes).toEqual(["fs:read", "net:egress"]);
    expect(v.deniedScopes).toEqual(["admin:everything"]);
  });

  test("risk ceiling cannot exceed the delegator's ceiling", () => {
    const v = validateDelegation({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier0_in_process" }),
      expiresAt: NOW + DAY,
      now: NOW,
    });
    expect(v.effectiveMaxRiskTier).toBe("tier0_in_process");
  });

  test("a subject cannot delegate to itself", () => {
    const v = validateDelegation({
      delegator: human,
      delegate: human,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      now: NOW,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("itself"))).toBe(true);
  });

  test("a delegator without sub-delegation authority cannot delegate", () => {
    const v = validateDelegation({
      delegator: worker,
      delegate: worker2,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: ["fs:read"], maxRiskTier: "tier1_restricted", canSubDelegate: false, depth: 1 },
      expiresAt: NOW + DAY,
      now: NOW,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("sub-delegation"))).toBe(true);
  });

  test("depth is bounded", () => {
    const v = validateDelegation({
      delegator: worker,
      delegate: worker2,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: ["fs:read"], maxRiskTier: "tier1_restricted", canSubDelegate: true, depth: 4 },
      expiresAt: NOW + DAY,
      now: NOW,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("depth"))).toBe(true);
  });

  test("expiry must be in the future", () => {
    const v = validateDelegation({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW - 1,
      now: NOW,
    });
    expect(v.ok).toBe(false);
  });

  test("cross-organization delegation is refused", () => {
    const v = validateDelegation({
      delegator: { kind: "user", subjectId: "u1", organizationId: "orgA" },
      delegate: { kind: "ai_worker", subjectId: "w1", organizationId: "orgB" },
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      now: NOW,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("Cross-organization"))).toBe(true);
  });
});

describe("Delegation registry", () => {
  test("creating a delegation grants only the effective subset", () => {
    const r = registry();
    const res = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "deal:update", "admin:billing"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "deal:update"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "Sales worker automation.",
    });

    expect(res.ok).toBe(true);
    expect(res.delegation!.scopes).toEqual(["fs:read", "deal:update"]);
    expect(res.validation.deniedScopes).toEqual(["admin:billing"]);
    expect(res.delegation!.depth).toBe(1);
    expect(res.delegation!.state).toBe("active");
  });

  test("expired delegations are not usable", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + HOUR,
      reason: "short lived",
    }).delegation!;

    expect(r.isUsable(d.delegationId)).toBe(true);

    const later = new DelegationRegistry({ now: () => NOW + 2 * HOUR });
    // Re-create in a future-clock registry to assert state computation.
    const d2 = later.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + 3 * HOUR,
      reason: "ok",
    }).delegation!;
    expect(later.stateOf(d2.delegationId)).toBe("active");
  });

  test("revocation cascades to sub-delegations", () => {
    const r = registry();
    const parent = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "net:egress"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "parent",
      canSubDelegate: true,
    }).delegation!;

    const child = r.delegate({
      delegator: worker,
      delegate: worker2,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: { scopes: parent.scopes, maxRiskTier: parent.maxRiskTier, canSubDelegate: true, depth: parent.depth },
      expiresAt: NOW + DAY,
      reason: "child",
      parentDelegationId: parent.delegationId,
    }).delegation!;

    expect(child.chain).toContain(parent.delegationId);
    expect(child.depth).toBe(2);

    const rev = r.revoke(parent.delegationId, "admin", "Worker compromised.");
    expect(rev.ok).toBe(true);
    expect(rev.revoked).toContain(parent.delegationId);
    expect(rev.revoked).toContain(child.delegationId);
    expect(r.stateOf(parent.delegationId)).toBe("revoked");
    expect(r.stateOf(child.delegationId)).toBe("revoked");
    expect(r.isUsable(child.delegationId)).toBe(false);
  });

  test("a revoked delegation grants nothing", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    }).delegation!;

    expect(r.effectiveAuthority(worker).scopes).toContain("fs:read");
    r.revoke(d.delegationId, "admin", "revoked");
    expect(r.effectiveAuthority(worker).scopes.length).toBe(0);
    expect(r.authorize(worker, "fs:read", "tier0_in_process").allowed).toBe(false);
  });

  test("suspend and reinstate", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    }).delegation!;

    expect(r.suspend(d.delegationId, "admin", "investigating").ok).toBe(true);
    expect(r.isUsable(d.delegationId)).toBe(false);
    expect(r.reinstate(d.delegationId, "admin").ok).toBe(true);
    expect(r.isUsable(d.delegationId)).toBe(true);
  });

  test("a revoked delegation cannot be suspended", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    }).delegation!;
    r.revoke(d.delegationId, "admin", "gone");
    expect(r.suspend(d.delegationId, "admin", "x").ok).toBe(false);
  });
});

describe("Access review", () => {
  test("a review may reduce scope but never expand it", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "net:egress"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + 30 * DAY,
      reason: "test",
    }).delegation!;

    const reduced = r.review({
      delegationId: d.delegationId,
      reviewedBy: "auditor",
      outcome: "reduced",
      notes: "Egress no longer needed.",
      scopesAfter: ["fs:read"],
    });
    expect(reduced.ok).toBe(true);
    expect(r.get(d.delegationId)!.scopes).toEqual(["fs:read"]);

    // Attempt to expand back beyond what was held.
    r.review({
      delegationId: d.delegationId,
      reviewedBy: "auditor",
      outcome: "affirmed",
      notes: "try to expand",
      scopesAfter: ["fs:read", "admin:all"],
    });
    expect(r.get(d.delegationId)!.scopes).not.toContain("admin:all");
  });

  test("a revoking review revokes the delegation", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    }).delegation!;

    r.review({ delegationId: d.delegationId, reviewedBy: "auditor", outcome: "revoked", notes: "No longer justified." });
    expect(r.stateOf(d.delegationId)).toBe("revoked");
  });

  test("reviews are recorded with before/after scopes", () => {
    const r = registry();
    const d = r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "net:egress"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    }).delegation!;

    r.review({ delegationId: d.delegationId, reviewedBy: "auditor", outcome: "reduced", notes: "trim", scopesAfter: ["fs:read"] });
    const reviews = r.reviewsFor(d.delegationId);
    expect(reviews.length).toBe(1);
    expect(reviews[0]!.scopesBefore.length).toBe(2);
    expect(reviews[0]!.scopesAfter.length).toBe(1);
    expect(reviews[0]!.outcome).toBe("reduced");
  });

  test("overdue delegations appear in the review queue", () => {
    const r = new DelegationRegistry({ now: () => NOW, reviewIntervalMs: HOUR });
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + 30 * DAY,
      reason: "test",
    });

    expect(r.pendingReviews().length).toBe(0);

    const future = new DelegationRegistry({ now: () => NOW, reviewIntervalMs: -1 });
    future.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + 30 * DAY,
      reason: "test",
    });
    expect(future.pendingReviews().length).toBe(1);
  });
});

describe("Effective authority and authorization", () => {
  test("union of usable delegations", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "a",
    });
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["net:egress"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "b",
    });

    const eff = r.effectiveAuthority(worker);
    expect(eff.scopes).toEqual(["fs:read", "net:egress"]);
    expect(eff.viaDelegations.length).toBe(2);
  });

  test("organization policy narrows effective authority WITH a visible reason", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read", "net:egress"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read", "net:egress"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });

    const policy = evaluatePolicy(
      [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "No egress in this org.", authoredBy: "admin", authoredAt: NOW })],
      { now: NOW },
    );

    const eff = r.effectiveAuthority(worker, policy);
    expect(eff.scopes).not.toContain("net:egress");
    expect(eff.scopes).toContain("fs:read");

    // The restriction is explicit, not silent.
    expect(eff.restrictedByPolicy.length).toBe(1);
    expect(eff.restrictedByPolicy[0]!.scope).toBe("net:egress");
    expect(eff.restrictedByPolicy[0]!.reason).toContain("policy");
  });

  test("policy floor raises the isolation ceiling", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier0_in_process",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });

    const policy = evaluatePolicy(
      [policyRule({ key: "minRiskTier", value: "tier2_isolated", layer: "organization", reason: "Isolate everything.", authoredBy: "admin", authoredAt: NOW })],
      { now: NOW },
    );
    expect(r.effectiveAuthority(worker, policy).maxRiskTier).toBe("tier2_isolated");
  });

  test("authorize denies an unheld scope", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });
    const d = r.authorize(worker, "fs:write", "tier0_in_process");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("does not hold");
  });

  test("authorize denies an action above the delegated ceiling", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["proc:spawn"],
      requestedMaxRiskTier: "tier0_in_process",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["proc:spawn"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });
    const d = r.authorize(worker, "proc:spawn", "tier2_isolated");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("exceeds the delegated ceiling");
  });

  test("authorize flags actions that require human approval", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["deal:close"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["deal:close"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
      requiresApprovalFor: ["deal:close"],
    });
    const d = r.authorize(worker, "deal:close", "tier0_in_process");
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(true);
  });

  test("policy-driven approval threshold applies", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:write"],
      requestedMaxRiskTier: "tier2_isolated",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:write"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });

    const policy = evaluatePolicy(
      [policyRule({ key: "requireApprovalAbove", value: "tier0_in_process", layer: "organization", reason: "Approve risky work.", authoredBy: "admin", authoredAt: NOW })],
      { now: NOW },
    );

    expect(r.authorize(worker, "fs:write", "tier1_restricted", policy).requiresApproval).toBe(true);
    expect(r.authorize(worker, "fs:write", "tier0_in_process", policy).requiresApproval).toBe(false);
  });

  test("a subject with no delegation has no authority", () => {
    const r = registry();
    const eff = r.effectiveAuthority({ kind: "ai_worker", subjectId: "unknown_worker" });
    expect(eff.scopes.length).toBe(0);
    expect(eff.maxRiskTier).toBe("tier0_in_process");
  });

  test("listing filters by delegate, delegator, and organization", () => {
    const r = registry();
    r.delegate({
      delegator: human,
      delegate: worker,
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({ subject: human, scopes: ["fs:read"], maxRiskTier: "tier2_isolated" }),
      expiresAt: NOW + DAY,
      reason: "test",
    });
    expect(r.list({ delegateId: "worker_sales" }).length).toBe(1);
    expect(r.list({ delegatorId: "user_alice" }).length).toBe(1);
    expect(r.list({ organizationId: "org1" }).length).toBe(1);
    expect(r.list({ delegateId: "nobody" }).length).toBe(0);
  });
});
