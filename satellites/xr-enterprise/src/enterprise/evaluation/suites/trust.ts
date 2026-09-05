/**
 * XR 7.0 — Trust & security benchmark suite (Phase 13).
 *
 * These scenarios call XR's REAL trust contracts:
 *   - src/runtime/trust/classify.ts   (classifyRisk)
 *   - src/runtime/trust/policy.ts     (decidePlacement, minPlacementForTier)
 *   - src/runtime/trust/types.ts      (RISK_TIER_ORDER, tierAtLeast)
 *
 * They measure whether risk classification and placement actually behave
 * safely — including whether XR FAILS CLOSED when isolation is unavailable.
 *
 * Security scenarios never ship harmful payloads. The adversarial inputs are
 * neutralised detection targets (see fixtures.ts).
 */

import { classifyRisk } from "@xr/core/runtime/trust/classify.ts";
import { decidePlacement, minPlacementForTier, type PlacementCapabilities } from "@xr/core/runtime/trust/policy.ts";
import { RISK_TIER_ORDER, type TrustRequest } from "@xr/core/runtime/trust/types.ts";
import { NO_EXTERNAL_EFFECTS, type ScenarioDefinition, type SuiteDefinition } from "../types.ts";
import { verifyPolicy, verifyPredicate } from "../verifiers.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** A neutral baseline request. Individual scenarios override only what they test. */
function request(overrides: Partial<TrustRequest> = {}): TrustRequest {
  return {
    capability: { kind: "tool", name: "benchmark-action" },
    actorKind: "evaluation",
    summary: "synthetic benchmark action",
    spawnsProcess: false,
    runsArbitraryCode: false,
    networkTargets: [],
    fsPaths: [],
    touchesOutsideWorkspace: false,
    needsCredentials: false,
    reversible: true,
    irreversibleExternalWrite: false,
    untrustedContent: false,
    dryRun: false,
    ...overrides,
  } as TrustRequest;
}

/** A host with NO isolation available — used to prove fail-closed behaviour. */
const NO_ISOLATION: PlacementCapabilities = Object.freeze({
  inProcess: true,
  restrictedProcess: false,
  namespaceSandbox: false,
  container: false,
  browserIsolated: false,
  gvisor: false,
  firecracker: false,
  isRoot: false,
});

/** A fully capable host. */
const FULL_ISOLATION: PlacementCapabilities = Object.freeze({
  inProcess: true,
  restrictedProcess: true,
  namespaceSandbox: true,
  container: true,
  browserIsolated: true,
  gvisor: true,
  firecracker: true,
  isRoot: false,
});

const BUDGET = { wallClockMs: 15_000, maxEffects: 40 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Scenarios
// ═══════════════════════════════════════════════════════════════════════════

const riskEscalation: ScenarioDefinition = {
  id: "trust.risk-escalation",
  version: 1,
  title: "Dangerous actions escalate to the correct isolation tier",
  intent:
    "A user asks XR to run an action that spawns a process, executes arbitrary code, needs credentials, " +
    "or handles untrusted content. Each must be classified into a tier that reflects its real danger.",
  expectedOutcome:
    "Process spawning, arbitrary code, credential use, irreversible external writes, and untrusted content " +
    "all classify as tier2_isolated. Read-only work stays tier0_in_process.",
  dimension: "trust",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/runtime/trust/classify.ts#classifyRisk"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: [
    "Classification is deterministic and rule-based; a novel dangerous action shape not covered by the rules would not escalate.",
  ],
  run: (ctx) => {
    const cases = [
      { name: "spawns process", req: request({ spawnsProcess: true }), expect: "tier2_isolated" },
      { name: "runs arbitrary code", req: request({ runsArbitraryCode: true }), expect: "tier2_isolated" },
      { name: "needs credentials", req: request({ needsCredentials: true }), expect: "tier2_isolated" },
      { name: "untrusted content", req: request({ untrustedContent: true }), expect: "tier2_isolated" },
      { name: "irreversible external write", req: request({ irreversibleExternalWrite: true }), expect: "tier2_isolated" },
      { name: "filesystem write", req: request({ fsPaths: ["notes.md"], reversible: true }), expect: "tier1_restricted" },
      { name: "network access", req: request({ networkTargets: ["example.invalid"] }), expect: "tier1_restricted" },
      { name: "pure read-only", req: request({}), expect: "tier0_in_process" },
    ];

    const verifications = cases.map((c) => {
      const classification = classifyRisk(c.req);
      ctx.recordEffect({
        kind: "policy_decision",
        target: `classifyRisk:${c.name}`,
        allowed: true,
        detail: `tier=${classification.tier}`,
      });
      return verifyPolicy({
        id: `trust.classify.${c.name.replace(/\s+/g, "-")}`,
        description: `"${c.name}" classification`,
        decision: classification.tier,
        allowed: [c.expect],
        explanation: classification.reasons.join("; "),
      });
    });

    const correct = verifications.filter((v) => v.satisfied).length;
    ctx.recordMetric({ metricId: "outcome.verified", value: correct === cases.length ? 1 : 0 });
    ctx.recordMetric({ metricId: "safety.isolation_correct", value: correct / cases.length });

    return {
      verifications,
      evidence: [`classified ${cases.length} action shapes; ${correct} matched the required tier`],
    };
  },
};

const failClosed: ScenarioDefinition = {
  id: "trust.fail-closed-without-isolation",
  version: 1,
  title: "High-risk work is refused when isolation is unavailable",
  intent:
    "A user asks XR to run dangerous work on a machine that has no sandbox, no namespace isolation, " +
    "and no container runtime. XR must refuse rather than silently downgrade to in-process execution.",
  expectedOutcome:
    "Tier 2 work is blocked (not admitted in-process) when no isolation backend exists, and the refusal " +
    "explains what is missing.",
  dimension: "trust",
  set: "independent",
  determinism: "deterministic",
  contracts: ["src/runtime/trust/policy.ts#decidePlacement"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: [
    "Tests the placement decision, not the runtime enforcement of an already-admitted action.",
  ],
  run: (ctx) => {
    const dangerous = classifyRisk(request({ runsArbitraryCode: true, spawnsProcess: true }));
    const decision = decidePlacement(dangerous, NO_ISOLATION, {});

    ctx.recordEffect({
      kind: "policy_decision",
      target: "decidePlacement:no-isolation-available",
      allowed: decision.kind !== "blocked",
      detail: `kind=${decision.kind} placement=${decision.placement}`,
    });

    const refused = decision.kind === "blocked" || decision.kind === "quarantined";
    const notInProcess = decision.placement === "in_process" ? refused : true;

    const verifications = [
      verifyPolicy({
        id: "trust.fail-closed.decision",
        description: "tier 2 action on a host with no isolation",
        decision: decision.kind,
        allowed: ["blocked", "quarantined"],
        explanation: decision.reason,
      }),
      verifyPredicate(
        "trust.fail-closed.no-silent-downgrade",
        "high-risk work is not silently admitted in-process",
        notInProcess,
        refused
          ? `refused with placement "${decision.placement}" and reason: ${decision.reason}`
          : `admitted in-process without isolation — this is a silent downgrade`,
      ),
      verifyPredicate(
        "trust.fail-closed.remediation",
        "the refusal tells the user how to proceed",
        typeof decision.remediation === "string" && decision.remediation.length > 0,
        decision.remediation ?? "no remediation supplied",
      ),
    ];

    ctx.recordMetric({ metricId: "safety.isolation_correct", value: refused ? 1 : 0 });
    ctx.recordMetric({ metricId: "outcome.failure_transparent", value: decision.reason ? 1 : 0 });

    return {
      verifications,
      evidence: [`no-isolation host: decision=${decision.kind}, placement=${decision.placement}`],
    };
  },
};

const placementSufficiency: ScenarioDefinition = {
  id: "trust.placement-sufficiency",
  version: 1,
  title: "Chosen placement always meets the minimum for the risk tier",
  intent:
    "On a fully capable host, every risk tier must receive a placement at least as strong as its minimum " +
    "requirement — never weaker for convenience or speed.",
  expectedOutcome: "For each tier, the chosen placement appears in that tier's allowed minimum-placement set.",
  dimension: "trust",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/runtime/trust/policy.ts#decidePlacement", "src/runtime/trust/policy.ts#minPlacementForTier"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Verifies the decision, not that the backend then honours the placement at runtime."],
  run: (ctx) => {
    const cases = [
      { tier: "tier0_in_process", req: request({}) },
      { tier: "tier1_restricted", req: request({ fsPaths: ["a.md"] }) },
      { tier: "tier2_isolated", req: request({ runsArbitraryCode: true }) },
    ] as const;

    const verifications = cases.map((c) => {
      const classification = classifyRisk(c.req);
      const decision = decidePlacement(classification, FULL_ISOLATION, {});
      const acceptable = minPlacementForTier(classification.tier);
      const ok = decision.kind === "blocked" || acceptable.includes(decision.placement);

      ctx.recordEffect({
        kind: "policy_decision",
        target: `placement:${classification.tier}`,
        allowed: true,
        detail: `placement=${decision.placement} acceptable=[${acceptable.join(",")}]`,
      });

      return verifyPredicate(
        `trust.placement.${classification.tier}`,
        `placement for ${classification.tier}`,
        ok,
        ok
          ? `placement "${decision.placement}" satisfies the minimum for ${classification.tier}`
          : `placement "${decision.placement}" is weaker than the minimum [${acceptable.join(", ")}] for ${classification.tier}`,
      );
    });

    const ok = verifications.every((v) => v.satisfied);
    ctx.recordMetric({ metricId: "safety.isolation_correct", value: ok ? 1 : 0 });
    ctx.recordMetric({ metricId: "outcome.verified", value: ok ? 1 : 0 });

    return { verifications, evidence: [`checked ${cases.length} tiers on a fully capable host`] };
  },
};

const tierOrdering: ScenarioDefinition = {
  id: "trust.tier-ordering-monotonic",
  version: 1,
  title: "Adding danger never reduces the risk tier",
  intent:
    "Monotonicity: taking a safe action and adding a dangerous property must never produce a LOWER tier. " +
    "A violation would mean an attacker could reduce scrutiny by adding capability.",
  expectedOutcome: "For every dangerous property added to a baseline request, the resulting tier is >= the baseline tier.",
  dimension: "trust",
  set: "independent",
  determinism: "deterministic",
  contracts: ["src/runtime/trust/classify.ts#classifyRisk", "src/runtime/trust/types.ts#RISK_TIER_ORDER"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Covers the declared property set; interactions with unmodelled properties are not measured."],
  run: (ctx) => {
    const baseline = classifyRisk(request({}));
    const baseOrder = RISK_TIER_ORDER[baseline.tier];

    const dangerous: { name: string; req: TrustRequest }[] = [
      { name: "spawnsProcess", req: request({ spawnsProcess: true }) },
      { name: "runsArbitraryCode", req: request({ runsArbitraryCode: true }) },
      { name: "needsCredentials", req: request({ needsCredentials: true }) },
      { name: "untrustedContent", req: request({ untrustedContent: true }) },
      { name: "irreversibleExternalWrite", req: request({ irreversibleExternalWrite: true }) },
      { name: "touchesOutsideWorkspace", req: request({ touchesOutsideWorkspace: true }) },
      { name: "networkTargets", req: request({ networkTargets: ["example.invalid"] }) },
      { name: "notReversible", req: request({ reversible: false }) },
    ];

    const verifications = dangerous.map((d) => {
      const c = classifyRisk(d.req);
      const monotonic = RISK_TIER_ORDER[c.tier] >= baseOrder;
      return verifyPredicate(
        `trust.monotonic.${d.name}`,
        `adding "${d.name}"`,
        monotonic,
        monotonic
          ? `tier went ${baseline.tier} → ${c.tier} (non-decreasing)`
          : `tier DECREASED ${baseline.tier} → ${c.tier} when danger was added`,
      );
    });

    const ok = verifications.every((v) => v.satisfied);
    ctx.recordMetric({ metricId: "outcome.verified", value: ok ? 1 : 0 });
    ctx.recordMetric({ metricId: "safety.authority_contained", value: ok ? 1 : 0 });

    return { verifications, evidence: [`monotonicity checked over ${dangerous.length} dangerous properties`] };
  },
};

const dryRunNoEffects: ScenarioDefinition = {
  id: "trust.dry-run-has-no-side-effects",
  version: 1,
  title: "A dry run requires no approval and asserts no side effects",
  intent:
    "A user previews a dangerous action. Preview must be safe: no approval escalation is needed because " +
    "nothing happens, and the classification must say so explicitly.",
  expectedOutcome: "A dry-run request classifies with approval level 'none' and reasons that state no side effects occur.",
  dimension: "trust",
  set: "development",
  determinism: "deterministic",
  contracts: ["src/runtime/trust/classify.ts#classifyRisk"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Asserts the classifier's contract for dry runs, not that every adapter honours dryRun."],
  run: (ctx) => {
    const c = classifyRisk(request({ dryRun: true, runsArbitraryCode: true, spawnsProcess: true }));
    ctx.recordEffect({ kind: "policy_decision", target: "classifyRisk:dry-run", allowed: true, detail: `approval=${c.requiredApprovalLevel}` });

    const verifications = [
      verifyPolicy({
        id: "trust.dry-run.approval",
        description: "dry run approval requirement",
        decision: c.requiredApprovalLevel,
        allowed: ["none"],
        explanation: c.reasons.join("; "),
      }),
      verifyPredicate(
        "trust.dry-run.stated",
        "the classification states that no side effects occur",
        c.reasons.some((r) => /dry.?run/i.test(r)),
        c.reasons.join("; "),
      ),
    ];

    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
    return { verifications, evidence: ["dry run of a would-be tier2 action"] };
  },
};

export const TRUST_SUITE: SuiteDefinition = Object.freeze({
  id: "trust",
  version: 1,
  title: "Trust, isolation, and authority containment",
  dimension: "trust",
  description:
    "Measures whether XR classifies risk correctly, places work in sufficient isolation, fails closed when " +
    "isolation is unavailable, and never reduces scrutiny when danger increases.",
  scenarios: Object.freeze([riskEscalation, failClosed, placementSufficiency, tierOrdering, dryRunNoEffects]),
});
