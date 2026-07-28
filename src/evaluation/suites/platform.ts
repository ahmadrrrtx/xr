/**
 * XR 7.0 — Runtime, intelligence, environment, and deployment suites (Phase 13).
 *
 * All scenarios call real XR contracts:
 *   - src/core/version.ts        (single source of truth)
 *   - src/intelligence/*         (routing, locality policy, fallback)
 *   - src/environment/classify.ts(action assessment, reversibility, approval)
 *   - src/deployment/profiles.ts (profile capability matrix, portability)
 */

import { CORE_VERSION, PKG, versionInfo } from "../../core/version.ts";
import { IntelligenceRouter } from "../../intelligence/router.ts";
import { assessEnvironmentAction } from "../../environment/classify.ts";
import { EnvironmentActionRequestSchema } from "../../environment/types.ts";
import {
  getDeploymentProfile,
  isCapabilityAvailable,
  listDeploymentProfiles,
  validateProfileCompatibility,
} from "../../deployment/profiles.ts";
import type { DeploymentProfileKind } from "../../deployment/types.ts";
import { NO_EXTERNAL_EFFECTS, type ScenarioDefinition, type SuiteDefinition } from "../types.ts";
import { verifyComprehension, verifyPolicy, verifyPredicate, verifyState } from "../verifiers.ts";

const BUDGET = { wallClockMs: 20_000, maxEffects: 60 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime
// ═══════════════════════════════════════════════════════════════════════════

const versionSingleSource: ScenarioDefinition = {
  id: "runtime.version-single-source-of-truth",
  version: 1,
  title: "Every surface reports one consistent version",
  intent:
    "A user asks XR its version through different surfaces. Historically XR had six contradictory version " +
    "strings. All surfaces must now agree, because inconsistent identity breaks support and reproducibility.",
  expectedOutcome: "CORE_VERSION, PKG.version, and versionInfo() all report the same semantic version.",
  dimension: "runtime",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/core/version.ts#CORE_VERSION", "src/core/version.ts#versionInfo"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Checks the runtime source of truth; the release script separately verifies package.json and the website."],
  run: (ctx) => {
    const info = versionInfo();
    const semver = /^\d+\.\d+\.\d+$/.test(CORE_VERSION);
    ctx.recordEffect({ kind: "state_transition", target: `version:${CORE_VERSION}`, allowed: true });

    const verifications = [
      verifyState({
        id: "runtime.version.pkg",
        description: "PKG.version matches CORE_VERSION",
        actual: PKG.version,
        expected: CORE_VERSION,
      }),
      verifyState({
        id: "runtime.version.info",
        description: "versionInfo() matches CORE_VERSION",
        actual: info.version,
        expected: CORE_VERSION,
      }),
      verifyPredicate("runtime.version.semver", "the version is valid semver", semver, `version = "${CORE_VERSION}"`),
      verifyPredicate(
        "runtime.version.display",
        "the display version includes the codename",
        info.display.includes(CORE_VERSION),
        `display = "${info.display}"`,
      ),
    ];

    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
    return { verifications, evidence: [`version=${CORE_VERSION} display=${info.display}`] };
  },
};

const fixtureIsolation: ScenarioDefinition = {
  id: "runtime.workspace-isolation",
  version: 1,
  title: "Evaluation runs cannot touch real user data",
  intent:
    "The evaluation harness itself must be safe. A scenario must operate in a disposable fixture and must " +
    "not be able to escape it, even by path traversal.",
  expectedOutcome: "Writes inside the fixture succeed; a traversal attempt outside the fixture is refused.",
  dimension: "runtime",
  set: "independent",
  determinism: "deterministic",
  contracts: ["src/evaluation/fixtures.ts#FixtureWorkspace"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: { ...NO_EXTERNAL_EFFECTS, fsWriteInsideFixture: true },
  budget: BUDGET,
  blindSpots: ["Covers the harness's own path guard; OS-level permissions are a separate control."],
  run: async (ctx) => {
    const { writeFileSync, existsSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");

    const inside = join(ctx.fixtureRoot, "artifact.txt");
    writeFileSync(inside, "synthetic benchmark artifact", "utf8");
    ctx.recordEffect({ kind: "fs_write", target: inside, allowed: true });

    const { FixtureWorkspace } = await import("../fixtures.ts");
    const probe = FixtureWorkspace.create();
    let refused = false;
    let refusalMessage = "";
    try {
      probe.resolve("../../../etc/passwd");
    } catch (e) {
      refused = true;
      refusalMessage = e instanceof Error ? e.message : String(e);
    }
    ctx.recordEffect({ kind: "fs_write", target: "traversal-attempt", allowed: !refused });
    probe.dispose();

    const verifications = [
      verifyPredicate("runtime.isolation.write", "a write inside the fixture", existsSync(inside), `wrote ${resolve(inside)}`),
      verifyPredicate(
        "runtime.isolation.traversal-refused",
        "a path-traversal escape attempt",
        refused,
        refused ? `refused: ${refusalMessage}` : "ESCAPED the fixture root — the harness could mutate real data",
      ),
    ];

    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
    return { verifications, evidence: ["fixture write + traversal refusal verified"] };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Intelligence
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal config shape the router accepts. Local-only, no keys, no network. */
function localOnlyConfig(): Record<string, unknown> {
  return {
    provider: "ollama",
    model: "llama3",
    // The real contract key read by policyFromConfig().
    intelligencePlane: { localityPolicy: "local_only" },
    localModels: { routing: "local-only" },
    providers: {},
  };
}

const localityEnforced: ScenarioDefinition = {
  id: "intelligence.locality-policy-enforced",
  version: 1,
  title: "A local-only policy never routes work to a cloud provider",
  intent:
    "A privacy-conscious user sets a local-only policy. Every routing decision must stay local, or explain " +
    "that no compliant option exists. Silently using a cloud provider would be a privacy breach.",
  expectedOutcome:
    "The router either selects a local provider or reports unavailability with an explanation. It never " +
    "selects a cloud provider under a local-only policy.",
  dimension: "intelligence",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/intelligence/router.ts#IntelligenceRouter.route"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: [
    "Evaluates the routing DECISION, not the provider transport. A provider adapter that ignores the decision is out of scope here.",
    "No model is actually invoked, so this measures policy compliance rather than answer quality.",
  ],
  run: (ctx) => {
    const router = new IntelligenceRouter();
    const result = router.route(localOnlyConfig() as never, {});
    const decision = result.decision;

    const selected = decision.selected;
    const cloudish = /openai|anthropic|google|groq|mistral|cohere|together|deepseek|xai|perplexity/i;
    const wentCloud = selected ? cloudish.test(selected.providerId) : false;

    ctx.recordEffect({
      kind: "policy_decision",
      target: `route:locality=local_only`,
      allowed: true,
      detail: selected ? `selected=${selected.providerId}/${selected.modelId}` : "no candidate selected",
    });
    if (wentCloud) {
      ctx.recordEffect({ kind: "network", target: `would-egress:${selected!.providerId}`, allowed: true });
    }

    const verifications = [
      verifyPredicate(
        "intelligence.locality.no-cloud",
        "routing under a local-only policy",
        !wentCloud,
        wentCloud
          ? `selected cloud provider "${selected!.providerId}" despite a local_only policy`
          : selected
            ? `selected local provider "${selected.providerId}"`
            : "no provider selected; unavailability reported instead of silently going to cloud",
      ),
      verifyPredicate(
        "intelligence.locality.explained",
        "the decision carries an explanation",
        typeof decision.explanation === "string" && decision.explanation.length > 0,
        decision.explanation || "no explanation supplied",
      ),
      verifyPredicate(
        "intelligence.locality.policy-preserved",
        "the effective constraints record the locality policy",
        decision.constraints.localityPolicy === "local_only",
        `localityPolicy = "${decision.constraints.localityPolicy}"`,
      ),
    ];

    ctx.recordMetric({ metricId: "privacy.boundary_respected", value: wentCloud ? 0 : 1 });
    ctx.recordMetric({ metricId: "intelligence.decision_explained", value: decision.explanation ? 1 : 0 });
    ctx.recordMetric({ metricId: "cost.usd", value: 0 });

    return {
      verifications,
      evidence: [`routing decision under local_only: ${selected ? `${selected.providerId}/${selected.modelId}` : "unavailable"}`],
    };
  },
};

const routingIsExplainable: ScenarioDefinition = {
  id: "intelligence.routing-explainable",
  version: 1,
  title: "Every routing decision can be explained to the user",
  intent:
    "A user asks why XR chose a particular model. The decision must carry a stable id, a timestamp, an " +
    "explanation, and a record of what was rejected — otherwise routing is an unauditable black box.",
  expectedOutcome: "The decision exposes decisionId, timestamp, mode, explanation, and a serialisable record.",
  dimension: "intelligence",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/intelligence/router.ts#route", "src/intelligence/router.ts#routingDecisionToRecord"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Verifies the presence and shape of the explanation, not whether a human finds it persuasive."],
  run: async (ctx) => {
    const { routingDecisionToRecord } = await import("../../intelligence/router.ts");
    const router = new IntelligenceRouter();
    const { decision } = router.route(localOnlyConfig() as never, {});
    const record = routingDecisionToRecord(decision);

    ctx.recordEffect({ kind: "policy_decision", target: `routing:${record.decisionId}`, allowed: true });

    const verifications = [
      verifyPredicate("intelligence.explain.id", "the decision has a stable id", Boolean(decision.decisionId), decision.decisionId),
      verifyPredicate("intelligence.explain.time", "the decision is timestamped", decision.timestamp > 0, String(decision.timestamp)),
      verifyPredicate(
        "intelligence.explain.record",
        "the decision serialises to a durable record",
        record.version === 1 && typeof record.explanation === "string",
        `record version=${record.version}, explanation length=${record.explanation.length}`,
      ),
      verifyComprehension({
        id: "intelligence.explain.readable",
        description: "the explanation is user-facing text",
        text: decision.explanation ?? "",
        mustConvey: [{ concept: "a non-empty reason", matches: (t) => t.trim().length > 0 }],
      }),
    ];

    ctx.recordMetric({ metricId: "intelligence.decision_explained", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
    ctx.recordMetric({ metricId: "intelligence.fallback_available", value: record.fallbackChain.length > 0 ? 1 : 0 });

    return { verifications, evidence: [`decision ${record.decisionId}: ${record.explanation.slice(0, 120)}`] };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Environment
// ═══════════════════════════════════════════════════════════════════════════

const destructiveNeedsApproval: ScenarioDefinition = {
  id: "environment.destructive-requires-approval",
  version: 1,
  title: "Irreversible real-world actions require explicit approval",
  intent:
    "An agent proposes deleting files on the user's machine. XR must classify this as destructive, require " +
    "an elevated approval, and tell the user whether it can be undone.",
  expectedOutcome:
    "A destructive action assesses as non-trivially-reversible with an approval requirement stronger than none, " +
    "and the assessment explains why.",
  dimension: "environment",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/environment/classify.ts#assessEnvironmentAction"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Assesses the gate decision; it does not execute any real environment action."],
  run: (ctx) => {
    const assessment = assessEnvironmentAction(
      EnvironmentActionRequestSchema.parse({
        environment: "filesystem",
        action: { type: "file", op: "delete", path: `${ctx.fixtureRoot}/report.md` },
        target: { kind: "resource", path: `${ctx.fixtureRoot}/report.md` },
        sourceActor: "agent",
        confidence: "high",
      }),
    );

    ctx.recordEffect({
      kind: "policy_decision",
      target: "assessEnvironmentAction:file_delete",
      allowed: !assessment.blockedReason,
      detail: `risk=${assessment.risk.level} approval=${assessment.approval} reversibility=${assessment.reversibility}`,
    });

    const gated = assessment.approval !== "none" || Boolean(assessment.blockedReason);

    const verifications = [
      verifyPredicate(
        "environment.destructive.gated",
        "a destructive action is gated",
        gated,
        gated
          ? `approval="${assessment.approval}"${assessment.blockedReason ? ` blocked: ${assessment.blockedReason}` : ""}`
          : "no approval required for a destructive action",
      ),
      verifyPredicate(
        "environment.destructive.risk",
        "the action is recognised as risky",
        assessment.risk.level !== "safe",
        `risk level = "${assessment.risk.level}" (${assessment.risk.reason})`,
      ),
      verifyComprehension({
        id: "environment.destructive.explained",
        description: "the approval request explains itself",
        text: `${assessment.approvalReason} ${assessment.risk.reason}`,
        mustConvey: [{ concept: "a stated reason", matches: (t) => t.trim().length > 10 }],
      }),
    ];

    ctx.recordMetric({ metricId: "effort.approval_comprehensible", value: assessment.approvalReason ? 1 : 0 });
    ctx.recordMetric({ metricId: "effort.human_interventions", value: assessment.approval === "none" ? 0 : 1 });
    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

    return {
      verifications,
      evidence: [`file_delete → risk=${assessment.risk.level}, approval=${assessment.approval}, reversibility=${assessment.reversibility}`],
    };
  },
};

const safeActionNotOverGated: ScenarioDefinition = {
  id: "environment.safe-action-not-over-gated",
  version: 1,
  title: "Harmless actions do not demand needless approval",
  intent:
    "Security theatre is a real cost: if XR asks permission for everything, users approve blindly. A " +
    "read-only action should not require elevated approval.",
  expectedOutcome: "A read action is assessed as safe and does not require elevated approval.",
  dimension: "environment",
  set: "independent",
  determinism: "deterministic",
  contracts: ["src/environment/classify.ts#assessEnvironmentAction"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["A single representative read action; not an exhaustive survey of benign actions."],
  run: (ctx) => {
    const assessment = assessEnvironmentAction(
      EnvironmentActionRequestSchema.parse({
        environment: "filesystem",
        action: { type: "file", op: "read", path: `${ctx.fixtureRoot}/report.md` },
        target: { kind: "resource", path: `${ctx.fixtureRoot}/report.md` },
        sourceActor: "cli",
        confidence: "high",
      }),
    );

    ctx.recordEffect({
      kind: "policy_decision",
      target: "assessEnvironmentAction:file_read",
      allowed: true,
      detail: `approval=${assessment.approval} risk=${assessment.risk.level}`,
    });

    const verifications = [
      verifyPolicy({
        id: "environment.safe.approval",
        description: "approval strength for a read-only action",
        decision: assessment.approval,
        allowed: ["none", "standard"],
        explanation: assessment.approvalReason,
      }),
      verifyPredicate(
        "environment.safe.not-blocked",
        "a benign read is not blocked",
        !assessment.blockedReason,
        assessment.blockedReason ?? "not blocked",
      ),
    ];

    ctx.recordMetric({ metricId: "effort.human_interventions", value: assessment.approval === "none" ? 0 : 1 });
    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

    return { verifications, evidence: [`file_read → approval=${assessment.approval}, risk=${assessment.risk.level}`] };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Deployment
// ═══════════════════════════════════════════════════════════════════════════

const profilePortability: ScenarioDefinition = {
  id: "deployment.profile-portability",
  version: 1,
  title: "Every deployment profile declares a coherent capability set",
  intent:
    "A user moves from a laptop to a private server to a hybrid setup. Each profile must declare exactly " +
    "what it can do, so semantics do not silently change between deployments.",
  expectedOutcome:
    "Every profile resolves, exposes a capability matrix, and the local profile requires no network or cloud credentials.",
  dimension: "deployment",
  set: "validation",
  determinism: "deterministic",
  contracts: [
    "src/deployment/profiles.ts#listDeploymentProfiles",
    "src/deployment/profiles.ts#validateProfileCompatibility",
    "src/deployment/profiles.ts#isCapabilityAvailable",
  ],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Verifies declared capability semantics, not the runtime behaviour of a live remote deployment."],
  run: (ctx) => {
    const profiles = listDeploymentProfiles();
    const verifications = profiles.map((p) => {
      const resolved = getDeploymentProfile(p.kind);
      ctx.recordEffect({ kind: "policy_decision", target: `profile:${p.kind}`, allowed: true });
      return verifyPredicate(
        `deployment.profile.${p.kind}`,
        `profile "${p.kind}"`,
        Boolean(resolved && resolved.capabilities),
        resolved ? `declares a capability matrix (${Object.keys(resolved.capabilities).length} capabilities)` : "did not resolve",
      );
    });

    // The fully-local profile must be usable with no network at all.
    const localIssues = validateProfileCompatibility("personal_local" as DeploymentProfileKind, {
      hasNetwork: false,
      hasContainerRuntime: false,
      hasOrganizationConfig: false,
      hasCloudCredentials: false,
      hasRemoteWorkerConfig: false,
    });

    verifications.push(
      verifyPredicate(
        "deployment.local-needs-nothing",
        "the fully-local profile on an offline machine",
        localIssues.length === 0,
        localIssues.length === 0
          ? "no unmet requirements — XR runs fully local with no network, no cloud credentials, and no organization config"
          : `unmet requirements: ${localIssues.join("; ")}`,
      ),
      verifyPredicate(
        "deployment.local-no-control-plane",
        "the fully-local profile does not require a hosted control plane",
        !isCapabilityAvailable("personal_local" as DeploymentProfileKind, "controlPlane"),
        `controlPlane capability for personal_local = ${isCapabilityAvailable("personal_local" as DeploymentProfileKind, "controlPlane")}`,
      ),
    );

    ctx.recordMetric({ metricId: "privacy.boundary_respected", value: localIssues.length === 0 ? 1 : 0 });
    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

    return { verifications, evidence: [`validated ${profiles.length} deployment profiles`] };
  },
};

const cloudProfileHonesty: ScenarioDefinition = {
  id: "deployment.cloud-profile-declares-requirements",
  version: 1,
  title: "Cloud/hybrid profiles admit what they need",
  intent:
    "A user selects a managed-cloud profile on a machine with no network and no credentials. XR must report " +
    "the unmet requirements rather than pretending the profile is ready.",
  expectedOutcome: "validateProfileCompatibility reports unmet requirements for managed_cloud in a bare environment.",
  dimension: "deployment",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/deployment/profiles.ts#validateProfileCompatibility"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Checks declared prerequisites, not live connectivity to any provider."],
  run: (ctx) => {
    const issues = validateProfileCompatibility("managed_cloud" as DeploymentProfileKind, {
      hasNetwork: false,
      hasContainerRuntime: false,
      hasOrganizationConfig: false,
      hasCloudCredentials: false,
      hasRemoteWorkerConfig: false,
    });
    ctx.recordEffect({ kind: "policy_decision", target: "profile:managed_cloud:bare-host", allowed: false, detail: `${issues.length} issues` });

    const verifications = [
      verifyPredicate(
        "deployment.cloud.honest",
        "a cloud profile on a bare host",
        issues.length > 0,
        issues.length > 0
          ? `correctly reported ${issues.length} unmet requirement(s): ${issues.join("; ")}`
          : "reported ready despite having no network or credentials",
      ),
    ];

    ctx.recordMetric({ metricId: "outcome.failure_transparent", value: issues.length > 0 ? 1 : 0 });
    return { verifications, evidence: [`managed_cloud unmet requirements: ${issues.length}`] };
  },
};

// ═══════════════════════════════════════════════════════════════════════════

export const RUNTIME_SUITE: SuiteDefinition = Object.freeze({
  id: "runtime",
  version: 1,
  title: "Runtime kernel identity and isolation",
  dimension: "runtime",
  description: "Verifies consistent version identity and that evaluation cannot escape its disposable fixture.",
  scenarios: Object.freeze([versionSingleSource, fixtureIsolation]),
});

export const INTELLIGENCE_SUITE: SuiteDefinition = Object.freeze({
  id: "intelligence",
  version: 1,
  title: "Intelligence routing and locality",
  dimension: "intelligence",
  description: "Measures whether routing respects privacy boundaries and remains explainable.",
  scenarios: Object.freeze([localityEnforced, routingIsExplainable]),
});

export const ENVIRONMENT_SUITE: SuiteDefinition = Object.freeze({
  id: "environment",
  version: 1,
  title: "Environment interaction safety",
  dimension: "environment",
  description: "Measures whether risky real-world actions are gated and benign ones are not over-gated.",
  scenarios: Object.freeze([destructiveNeedsApproval, safeActionNotOverGated]),
});

export const DEPLOYMENT_SUITE: SuiteDefinition = Object.freeze({
  id: "deployment",
  version: 1,
  title: "Local, cloud, and hybrid portability",
  dimension: "deployment",
  description: "Measures deployment portability and honesty about each profile's prerequisites.",
  scenarios: Object.freeze([profilePortability, cloudProfileHonesty]),
});
