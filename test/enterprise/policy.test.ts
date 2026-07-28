/**
 * XR 6.1 — Phase 12 Tests: Organization policy layers, precedence, bundles.
 */
import { describe, expect, test } from "bun:test";
import {
  POLICY_LAYERS,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  resolvePolicy,
  evaluatePolicy,
  explainPolicyKey,
  summarizeRejectedOverrides,
  policyRule,
  validateBundleRules,
  PolicyBundleStore,
  hashRules,
  canAuthorLayer,
  compareRestrictiveness,
  getSafetyKeySpec,
  isSafetyRelevantKey,
  isVisibilitySuppression,
  layerPrivilege,
  layerSpecificity,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;

describe("Policy layers", () => {
  test("six layers are defined in order", () => {
    expect(POLICY_LAYERS).toEqual([
      "platform_default",
      "deployment",
      "organization",
      "workspace",
      "user_task",
      "capability",
    ]);
  });

  test("specificity increases toward the task/capability layers", () => {
    expect(layerSpecificity("platform_default")).toBeLessThan(layerSpecificity("organization"));
    expect(layerSpecificity("organization")).toBeLessThan(layerSpecificity("workspace"));
    expect(layerSpecificity("workspace")).toBeLessThan(layerSpecificity("user_task"));
  });

  test("privilege decreases toward the task/capability layers", () => {
    expect(layerPrivilege("platform_default")).toBeGreaterThan(layerPrivilege("organization"));
    expect(layerPrivilege("organization")).toBeGreaterThan(layerPrivilege("workspace"));
    expect(layerPrivilege("user_task")).toBeGreaterThan(layerPrivilege("capability"));
  });

  test("a lower-privileged author cannot write a higher-privileged layer", () => {
    expect(canAuthorLayer("organization", "workspace")).toBe(true);
    expect(canAuthorLayer("organization", "organization")).toBe(true);
    expect(canAuthorLayer("workspace", "organization")).toBe(false);
    expect(canAuthorLayer("capability", "user_task")).toBe(false);
  });
});

describe("Safety key restrictiveness", () => {
  test("false is stricter for permission booleans", () => {
    const spec = getSafetyKeySpec("allowNetworkEgress")!;
    expect(compareRestrictiveness(spec, false, true)).toBeGreaterThan(0);
    expect(compareRestrictiveness(spec, true, false)).toBeLessThan(0);
    expect(compareRestrictiveness(spec, true, true)).toBe(0);
  });

  test("higher tier is stricter for minRiskTier", () => {
    const spec = getSafetyKeySpec("minRiskTier")!;
    expect(compareRestrictiveness(spec, "tier2_isolated", "tier0_in_process")).toBeGreaterThan(0);
    expect(compareRestrictiveness(spec, "tier0_in_process", "tier1_restricted")).toBeLessThan(0);
  });

  test("requireApprovalAbove inverts: a lower threshold is stricter", () => {
    const spec = getSafetyKeySpec("requireApprovalAbove")!;
    // tier0 threshold => approvals required above tier0 => MORE approvals => stricter
    expect(compareRestrictiveness(spec, "tier0_in_process", "tier2_isolated")).toBeGreaterThan(0);
  });

  test("all safety keys are recognized", () => {
    for (const key of [
      "minRiskTier",
      "requireApprovalAbove",
      "allowNetworkEgress",
      "allowFilesystemWrite",
      "allowProcessSpawn",
      "allowRemotePlacement",
      "allowUnsignedCapabilities",
      "allowUncertifiedCapabilities",
    ]) {
      expect(isSafetyRelevantKey(key)).toBe(true);
    }
    expect(isSafetyRelevantKey("themeColor")).toBe(false);
  });
});

describe("Policy precedence — most restrictive wins for safety keys", () => {
  test("organization tightening a permissive platform default is applied", () => {
    const rules = [
      policyRule({
        key: "allowNetworkEgress",
        value: true,
        layer: "platform_default",
        reason: "Default allows egress.",
        authoredBy: "system",
        authoredAt: NOW,
      }),
      policyRule({
        key: "allowNetworkEgress",
        value: false,
        layer: "organization",
        reason: "Org forbids outbound network.",
        authoredBy: "admin1",
        authoredAt: NOW,
      }),
    ];
    const policy = evaluatePolicy(rules, { now: NOW });
    expect(policy.getBoolean("allowNetworkEgress", true)).toBe(false);
  });

  test("a MORE privileged layer cannot loosen a stricter lower layer", () => {
    const rules = [
      // Workspace (less privileged) is strict.
      policyRule({
        key: "allowFilesystemWrite",
        value: false,
        layer: "workspace",
        reason: "Workspace is read-only.",
        authoredBy: "ws-admin",
        authoredAt: NOW,
      }),
      // Organization (more privileged) tries to loosen it.
      policyRule({
        key: "allowFilesystemWrite",
        value: true,
        layer: "organization",
        reason: "Org wants writes enabled.",
        authoredBy: "org-admin",
        authoredAt: NOW,
      }),
    ];
    const resolution = resolvePolicy(rules, { now: NOW });
    const entry = resolution.entries.find((e) => e.key === "allowFilesystemWrite")!;

    expect(entry.effectiveValue).toBe(false);
    expect(entry.winningLayer).toBe("workspace");
    expect(entry.reason).toBe("most_restrictive");

    // The loosening attempt is recorded, not dropped.
    const attempt = resolution.rejectedOverrides.find(
      (o) => o.key === "allowFilesystemWrite" && o.layer === "organization",
    );
    expect(attempt).toBeDefined();
    expect(attempt!.severity).toBe("warning");
    expect(attempt!.authoredBy).toBe("org-admin");
  });

  test("user task policy may tighten but not loosen", () => {
    const tighten = evaluatePolicy(
      [
        policyRule({ key: "allowProcessSpawn", value: true, layer: "organization", reason: "org allows", authoredBy: "a", authoredAt: NOW }),
        policyRule({ key: "allowProcessSpawn", value: false, layer: "user_task", reason: "user declines", authoredBy: "u", authoredAt: NOW }),
      ],
      { now: NOW },
    );
    expect(tighten.getBoolean("allowProcessSpawn", true)).toBe(false);

    const loosen = evaluatePolicy(
      [
        policyRule({ key: "allowProcessSpawn", value: false, layer: "organization", reason: "org forbids", authoredBy: "a", authoredAt: NOW }),
        policyRule({ key: "allowProcessSpawn", value: true, layer: "user_task", reason: "user wants", authoredBy: "u", authoredAt: NOW }),
      ],
      { now: NOW },
    );
    expect(loosen.getBoolean("allowProcessSpawn", true)).toBe(false);
  });

  test("strictest risk tier across many layers wins", () => {
    const rules = [
      policyRule({ key: "minRiskTier", value: "tier0_in_process", layer: "platform_default", reason: "d", authoredBy: "s", authoredAt: NOW }),
      policyRule({ key: "minRiskTier", value: "tier1_restricted", layer: "deployment", reason: "d", authoredBy: "s", authoredAt: NOW }),
      policyRule({ key: "minRiskTier", value: "tier2_isolated", layer: "organization", reason: "d", authoredBy: "s", authoredAt: NOW }),
      policyRule({ key: "minRiskTier", value: "tier0_in_process", layer: "capability", reason: "d", authoredBy: "s", authoredAt: NOW }),
    ];
    const policy = evaluatePolicy(rules, { now: NOW });
    expect(policy.get("minRiskTier")).toBe("tier2_isolated");
  });

  test("non-safety preferences resolve most-specific-wins", () => {
    const rules = [
      policyRule({ key: "defaultModel", value: "small", layer: "organization", reason: "cost", authoredBy: "a", authoredAt: NOW }),
      policyRule({ key: "defaultModel", value: "large", layer: "user_task", reason: "quality", authoredBy: "u", authoredAt: NOW }),
    ];
    const resolution = resolvePolicy(rules, { now: NOW });
    const entry = resolution.entries.find((e) => e.key === "defaultModel")!;
    expect(entry.effectiveValue).toBe("large");
    expect(entry.winningLayer).toBe("user_task");
    expect(entry.reason).toBe("most_specific");
    expect(entry.safetyRelevant).toBe(false);
  });

  test("decision trace lists every candidate with an explanation", () => {
    const rules = [
      policyRule({ key: "allowNetworkEgress", value: true, layer: "platform_default", reason: "d", authoredBy: "s", authoredAt: NOW }),
      policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "d", authoredBy: "a", authoredAt: NOW }),
    ];
    const resolution = resolvePolicy(rules, { now: NOW });
    const entry = resolution.entries.find((e) => e.key === "allowNetworkEgress")!;
    expect(entry.candidates.length).toBe(2);
    for (const c of entry.candidates) expect(c.why.length).toBeGreaterThan(0);
    expect(entry.candidates.filter((c) => c.applied).length).toBe(1);
  });

  test("explainPolicyKey renders a human summary", () => {
    const resolution = resolvePolicy(
      [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "d", authoredBy: "a", authoredAt: NOW })],
      { now: NOW },
    );
    const ex = explainPolicyKey(resolution, "allowNetworkEgress")!;
    expect(ex.effectiveValue).toBe(false);
    expect(ex.summary).toContain("allowNetworkEgress");
    expect(ex.detail.length).toBeGreaterThan(0);
  });
});

describe("Non-overridable user-visibility invariants", () => {
  test("all visibility keys default to true with no rules at all", () => {
    const policy = evaluatePolicy([], { now: NOW });
    for (const key of NON_OVERRIDABLE_VISIBILITY_KEYS) {
      expect(policy.getBoolean(key, false)).toBe(true);
    }
  });

  test("an organization admin CANNOT hide approval requests", () => {
    const resolution = resolvePolicy(
      [
        policyRule({
          key: "showApprovalRequests",
          value: false,
          layer: "organization",
          reason: "Reduce user friction.",
          authoredBy: "sneaky-admin",
          authoredAt: NOW,
        }),
      ],
      { now: NOW },
    );

    const entry = resolution.entries.find((e) => e.key === "showApprovalRequests")!;
    expect(entry.effectiveValue).toBe(true);
    expect(entry.reason).toBe("invariant_floor");
    expect(entry.userVisible).toBe(true);

    const attempt = resolution.rejectedOverrides.find((o) => o.key === "showApprovalRequests")!;
    expect(attempt).toBeDefined();
    expect(attempt.severity).toBe("critical");
    expect(attempt.authoredBy).toBe("sneaky-admin");
  });

  test("even the platform_default layer cannot suppress visibility", () => {
    const resolution = resolvePolicy(
      [
        policyRule({
          key: "showPolicyEffects",
          value: false,
          layer: "platform_default",
          reason: "attempt",
          authoredBy: "system",
          authoredAt: NOW,
        }),
      ],
      { now: NOW },
    );
    expect(resolution.entries.find((e) => e.key === "showPolicyEffects")!.effectiveValue).toBe(true);
    expect(resolution.rejectedOverrides.some((o) => o.key === "showPolicyEffects")).toBe(true);
  });

  test("every visibility key resists suppression from every layer", () => {
    for (const key of NON_OVERRIDABLE_VISIBILITY_KEYS) {
      for (const layer of POLICY_LAYERS) {
        const resolution = resolvePolicy(
          [policyRule({ key, value: false, layer, reason: "attempt", authoredBy: "attacker", authoredAt: NOW })],
          { now: NOW },
        );
        expect(resolution.entries.find((e) => e.key === key)!.effectiveValue).toBe(true);
        expect(resolution.rejectedOverrides.some((o) => o.key === key && o.layer === layer)).toBe(true);
      }
    }
  });

  test("isVisibilitySuppression identifies only real suppression", () => {
    expect(isVisibilitySuppression("showDataScope", false)).toBe(true);
    expect(isVisibilitySuppression("showDataScope", true)).toBe(false);
    expect(isVisibilitySuppression("themeColor", false)).toBe(false);
  });

  test("userVisibleEffects surfaces invariants and safety restrictions to the user", () => {
    const policy = evaluatePolicy(
      [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "Org forbids egress.", authoredBy: "a", authoredAt: NOW })],
      { now: NOW },
    );
    const effects = policy.userVisibleEffects();
    expect(effects.some((e) => e.key === "allowNetworkEgress")).toBe(true);
    expect(effects.some((e) => e.key === "showApprovalRequests")).toBe(true);
  });

  test("summarizeRejectedOverrides groups by severity", () => {
    const resolution = resolvePolicy(
      [
        policyRule({ key: "showDataScope", value: false, layer: "organization", reason: "x", authoredBy: "a", authoredAt: NOW }),
        policyRule({ key: "allowNetworkEgress", value: false, layer: "workspace", reason: "x", authoredBy: "b", authoredAt: NOW }),
        policyRule({ key: "allowNetworkEgress", value: true, layer: "organization", reason: "x", authoredBy: "a", authoredAt: NOW }),
      ],
      { now: NOW },
    );
    const summary = summarizeRejectedOverrides(resolution);
    expect(summary.find((s) => s.severity === "critical")).toBeDefined();
    expect(summary.find((s) => s.severity === "warning")).toBeDefined();
  });
});

describe("Policy scoping", () => {
  test("workspace-scoped rules do not apply outside their workspace", () => {
    const rules = [
      policyRule({
        key: "allowNetworkEgress",
        value: false,
        layer: "workspace",
        reason: "ws1 only",
        authoredBy: "a",
        authoredAt: NOW,
        workspaceId: "ws1",
      }),
    ];
    expect(evaluatePolicy(rules, { now: NOW, workspaceId: "ws1" }).getBoolean("allowNetworkEgress", true)).toBe(false);
    expect(evaluatePolicy(rules, { now: NOW, workspaceId: "ws2" }).getBoolean("allowNetworkEgress", true)).toBe(true);
    expect(evaluatePolicy(rules, { now: NOW }).getBoolean("allowNetworkEgress", true)).toBe(true);
  });

  test("organization-scoped rules do not leak across organizations", () => {
    const rules = [
      policyRule({
        key: "allowRemotePlacement",
        value: false,
        layer: "organization",
        reason: "org1 only",
        authoredBy: "a",
        authoredAt: NOW,
        organizationId: "org1",
      }),
    ];
    expect(evaluatePolicy(rules, { now: NOW, organizationId: "org1" }).getBoolean("allowRemotePlacement", true)).toBe(false);
    expect(evaluatePolicy(rules, { now: NOW, organizationId: "org2" }).getBoolean("allowRemotePlacement", true)).toBe(true);
  });

  test("resolution is deterministic", () => {
    const rules = [
      policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "d", authoredBy: "a", authoredAt: NOW }),
      policyRule({ key: "minRiskTier", value: "tier1_restricted", layer: "deployment", reason: "d", authoredBy: "a", authoredAt: NOW }),
    ];
    const a = resolvePolicy(rules, { now: NOW });
    const b = resolvePolicy(rules, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("Policy bundle validation", () => {
  test("rules must carry a reason (shown to affected users)", () => {
    const v = validateBundleRules(
      [{ key: "allowNetworkEgress", value: false, layer: "organization", reason: "", authoredBy: "a", authoredAt: NOW }],
      { now: NOW },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("reason"))).toBe(true);
  });

  test("rules must record an author", () => {
    const v = validateBundleRules(
      [{ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "", authoredAt: NOW }],
      { now: NOW },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("authoredBy"))).toBe(true);
  });

  test("visibility suppression is rejected at authoring time", () => {
    const v = validateBundleRules(
      [policyRule({ key: "showActionProvenance", value: false, layer: "organization", reason: "hide it", authoredBy: "a", authoredAt: NOW })],
      { now: NOW },
    );
    expect(v.ok).toBe(false);
    expect(v.rejectedOverrides.some((o) => o.severity === "critical")).toBe(true);
  });

  test("an author cannot write above their privilege", () => {
    const v = validateBundleRules(
      [policyRule({ key: "allowNetworkEgress", value: false, layer: "deployment", reason: "r", authoredBy: "ws-admin", authoredAt: NOW })],
      { authorLayer: "workspace", now: NOW },
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes("insufficient privilege"))).toBe(true);
  });

  test("invalid enum values are rejected", () => {
    const v = validateBundleRules(
      [policyRule({ key: "minRiskTier", value: "tier9_nope", layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      { now: NOW },
    );
    expect(v.ok).toBe(false);
  });

  test("a valid bundle passes", () => {
    const v = validateBundleRules(
      [
        policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "No egress.", authoredBy: "a", authoredAt: NOW }),
        policyRule({ key: "minRiskTier", value: "tier1_restricted", layer: "organization", reason: "Isolate.", authoredBy: "a", authoredAt: NOW }),
      ],
      { now: NOW },
    );
    expect(v.ok).toBe(true);
    expect(v.errors.length).toBe(0);
  });

  test("hashRules is order-independent and content-sensitive", () => {
    const r1 = policyRule({ key: "a", value: 1, layer: "organization", reason: "r", authoredBy: "x", authoredAt: NOW });
    const r2 = policyRule({ key: "b", value: 2, layer: "organization", reason: "r", authoredBy: "x", authoredAt: NOW });
    expect(hashRules([r1, r2])).toBe(hashRules([r2, r1]));
    const r3 = policyRule({ key: "b", value: 3, layer: "organization", reason: "r", authoredBy: "x", authoredAt: NOW });
    expect(hashRules([r1, r2])).not.toBe(hashRules([r1, r3]));
  });
});

describe("Policy bundles — versioning and rollback", () => {
  function store(): PolicyBundleStore {
    return new PolicyBundleStore({ now: () => NOW });
  }

  test("create produces a draft with version 1 and a content hash", () => {
    const s = store();
    const r = s.create({
      name: "Baseline",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    });
    expect(r.ok).toBe(true);
    expect(r.bundle!.state).toBe("draft");
    expect(r.bundle!.version).toBe(1);
    expect(r.bundle!.contentHash.length).toBe(64);
  });

  test("an invalid bundle is refused", () => {
    const s = store();
    const r = s.create({
      name: "Bad",
      rules: [policyRule({ key: "showDataScope", value: false, layer: "organization", reason: "hide", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    });
    expect(r.ok).toBe(false);
    expect(r.bundle).toBeUndefined();
  });

  test("activation supersedes the previous active bundle", () => {
    const s = store();
    const b1 = s.create({
      name: "v1",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(b1.bundleId, "admin");

    const b2 = s.create({
      name: "v2",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r2", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    expect(b2.version).toBe(2);
    expect(b2.previousBundleId).toBe(b1.bundleId);

    s.activate(b2.bundleId, "admin");
    expect(s.get(b1.bundleId)!.state).toBe("superseded");
    expect(s.get(b2.bundleId)!.state).toBe("active");
    expect(s.active("org1")!.bundleId).toBe(b2.bundleId);
  });

  test("rollback restores the previous bundle", () => {
    const s = store();
    const b1 = s.create({
      name: "v1",
      rules: [policyRule({ key: "minRiskTier", value: "tier1_restricted", layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(b1.bundleId, "admin");

    const b2 = s.create({
      name: "v2",
      rules: [policyRule({ key: "minRiskTier", value: "tier2_isolated", layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(b2.bundleId, "admin");

    const rb = s.rollback(b2.bundleId, "admin", "Too strict for the team.");
    expect(rb.ok).toBe(true);
    expect(s.get(b2.bundleId)!.state).toBe("rolled_back");
    expect(s.get(b2.bundleId)!.rolledBackReason).toBe("Too strict for the team.");
    expect(s.active("org1")!.bundleId).toBe(b1.bundleId);
  });

  test("rollback with no previous version fails cleanly", () => {
    const s = store();
    const b1 = s.create({
      name: "only",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(b1.bundleId, "admin");
    const rb = s.rollback(b1.bundleId, "admin", "nope");
    expect(rb.ok).toBe(false);
    expect(rb.error).toContain("no previous version");
  });

  test("effectiveRules merges organization and workspace bundles", () => {
    const s = store();
    const org = s.create({
      name: "org",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(org.bundleId, "admin");

    const ws = s.create({
      name: "ws",
      rules: [policyRule({ key: "allowProcessSpawn", value: false, layer: "workspace", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
      workspaceId: "ws1",
    }).bundle!;
    s.activate(ws.bundleId, "admin");

    const merged = s.effectiveRules("org1", "ws1");
    expect(merged.length).toBe(2);

    const policy = evaluatePolicy(merged, { now: NOW, organizationId: "org1", workspaceId: "ws1" });
    expect(policy.getBoolean("allowNetworkEgress", true)).toBe(false);
    expect(policy.getBoolean("allowProcessSpawn", true)).toBe(false);
  });

  test("bundles from other organizations are not returned", () => {
    const s = store();
    const org1 = s.create({
      name: "org1",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "admin",
      organizationId: "org1",
    }).bundle!;
    s.activate(org1.bundleId, "admin");
    expect(s.active("org2")).toBeUndefined();
    expect(s.effectiveRules("org2").length).toBe(0);
  });

  test("history is newest first", () => {
    const s = store();
    for (let i = 0; i < 3; i++) {
      const b = s.create({
        name: `v${i}`,
        rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
        createdBy: "admin",
        organizationId: "org1",
      }).bundle!;
      s.activate(b.bundleId, "admin");
    }
    const h = s.history("org1");
    expect(h.length).toBe(3);
    expect(h[0]!.version).toBe(3);
  });
});
