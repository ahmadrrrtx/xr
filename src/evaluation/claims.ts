/**
 * XR 7.0 — Public claim / evidence matrix (Phase 13).
 *
 * The governing rule of the phase:
 *
 *   Every strategic claim about XR must be backed by reproducible evidence,
 *   or be explicitly labelled as product vision rather than fact.
 *
 * This module makes that machine-checkable. `auditClaims()` cross-references
 * each published claim against actual scenario results, so a claim whose
 * supporting scenario failed cannot keep being advertised as verified.
 */

import {
  type ClaimAuditResult,
  type ClaimRecord,
  type EvaluationRun,
  type ScenarioResult,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// The claim register
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Claims XR makes publicly, each classified and bound to evidence.
 *
 * Sourced from an audit of README.md, package.json, SECURITY.md, and the
 * website copy at the XR 6.1 baseline.
 */
export const XR_CLAIMS: readonly ClaimRecord[] = Object.freeze([
  {
    id: "claim.local-first",
    statement: "XR is local-first: it runs fully on your machine with no cloud dependency.",
    sources: ["README.md", "package.json#keywords", "website"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["deployment.profile-portability", "intelligence.locality-policy-enforced"],
    evidenceTests: ["test/deployment/", "test/intelligence/"],
    doesNotProve:
      "It does not prove every optional feature works offline. Cloud providers, web research, and remote " +
      "workers require network access by definition; the local subset is what is measured.",
  },
  {
    id: "claim.byok",
    statement: "BYOK — bring your own key; XR is not locked to one vendor.",
    sources: ["README.md"],
    classification: "verified_by_contract",
    evidenceScenarios: ["intelligence.routing-explainable"],
    evidenceTests: ["test/intelligence/", "test/config/"],
    doesNotProve: "It does not prove every listed provider is currently functional; provider health is a runtime property.",
  },
  {
    id: "claim.spend-capped",
    statement: "Spending is capped by an explicit budget that blocks work before it overruns.",
    sources: ["README.md"],
    classification: "verified_by_contract",
    evidenceScenarios: [],
    evidenceTests: ["test/cost.test.ts"],
    doesNotProve:
      "Budget enforcement covers costs XR observes. It cannot cap spending incurred outside XR, and " +
      "provider-side pricing changes are not predicted.",
  },
  {
    id: "claim.tamper-evident-audit",
    statement: "The audit log is tamper-evident via a SHA-256 hash chain.",
    sources: ["README.md", "SECURITY.md"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["enterprise.audit-chain-detects-tampering"],
    evidenceTests: ["test/enterprise/audit-export.test.ts"],
    doesNotProve:
      "Tamper EVIDENCE is not tamper PREVENTION. An attacker with write access to the whole chain and its head " +
      "can rebuild it; off-host retention and export signing address that separate threat model.",
  },
  {
    id: "claim.no-telemetry",
    statement: "XR sends no telemetry; the dashboard is loopback-only.",
    sources: ["README.md"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["intelligence.locality-policy-enforced", "deployment.profile-portability"],
    evidenceTests: ["test/daemon.test.ts"],
    doesNotProve:
      "The offline benchmark subset asserts no unexpected egress within instrumented XR contracts. It does not " +
      "audit the network behaviour of third-party plugins, MCP servers, or the models you configure.",
  },
  {
    id: "claim.sandboxed",
    statement: "Risky actions run under isolation appropriate to their risk tier.",
    sources: ["README.md", "SECURITY.md"],
    classification: "documented_limitation",
    evidenceScenarios: [
      "trust.risk-escalation",
      "trust.placement-sufficiency",
      "trust.fail-closed-without-isolation",
    ],
    evidenceTests: ["test/trust/"],
    doesNotProve:
      "Isolation strength is HOST-DEPENDENT. On a machine with no container runtime or namespace sandbox, XR " +
      "fails closed for Tier 2 work rather than providing isolation it does not have. The backends actually " +
      "available are recorded in every benchmark run's provenance.",
  },
  {
    id: "claim.durable",
    statement: "Work is durable: interrupted tasks can be recovered rather than silently lost.",
    sources: ["README.md", "docs/EXECUTION_FABRIC.md"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["durability.recovery-after-restart", "durability.duplicate-effect-refused"],
    evidenceTests: ["test/execution/"],
    doesNotProve:
      "Recovery means the work is discoverable and safely resumable or safely refused. It does not mean every " +
      "action can be automatically re-run: non-idempotent effects are deliberately NOT auto-retried.",
  },
  {
    id: "claim.injection-defense",
    statement: "XR detects prompt-injection and context-poisoning attempts before they enter memory.",
    sources: ["README.md", "SECURITY.md"],
    classification: "documented_limitation",
    evidenceScenarios: ["context.injection-detection", "context.instruction-write-refused", "context.trust-clamping"],
    evidenceTests: ["test/context/", "test/security/"],
    doesNotProve:
      "Detection is measured against XR's own signature corpus. A novel attack with no lexical signature is not " +
      "represented by the score. This is a defence-in-depth control, not a guarantee.",
  },
  {
    id: "claim.enterprise-governance",
    statement:
      "Enterprise policy can be administered centrally without ever weakening a user's visible safety controls.",
    sources: ["package.json#description", "PHASE12_VALIDATION_REPORT.md"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["enterprise.policy-cannot-loosen-safety"],
    evidenceTests: ["test/enterprise/policy.test.ts"],
    doesNotProve:
      "It applies to keys registered as safety-relevant. Keys outside that registry resolve most-specific-wins " +
      "by design, and operational controls depend on the deploying organization following documented process.",
  },
  {
    id: "claim.no-external-certification",
    statement: "XR does not hold SOC 2, ISO 27001, HIPAA, PCI-DSS, or FedRAMP certification.",
    sources: ["src/enterprise/certification/evidence.ts"],
    classification: "verified_by_benchmark",
    evidenceScenarios: ["enterprise.no-false-certification-claim"],
    evidenceTests: ["test/enterprise/"],
    doesNotProve:
      "This is a statement of what XR does NOT claim. Evidence packs are self-assessments prepared for an " +
      "independent assessor.",
  },
  {
    id: "claim.ai-operating-system",
    statement: "XR is an AI Operating System.",
    sources: ["README.md", "package.json#keywords", "website"],
    classification: "product_vision",
    evidenceScenarios: [],
    evidenceTests: [],
    doesNotProve:
      "This is product vision and architectural vocabulary, not a technical claim. XR is precisely a " +
      "single-machine AI runtime and application platform with OS-like service, policy, workspace, and " +
      "extensibility layers. It is not an operating-system kernel.",
  },
  {
    id: "claim.provider-count",
    statement: "XR ships 26 built-in providers (16 hosted + 10 local runtimes).",
    sources: ["README.md"],
    classification: "verified_by_contract",
    evidenceScenarios: [],
    evidenceTests: ["src/providers/presets.ts#PRESETS"],
    doesNotProve:
      "Provider COUNT is explicitly not a measure of product quality and is deliberately not scored by this " +
      "benchmark suite. The number counts built-in presets; it does not prove every provider is currently " +
      "reachable, correctly keyed, or performing well. (XR 7.0 corrected an earlier README inconsistency that " +
      "stated both '20+' and '12+'.)",
  },
  {
    id: "claim.superiority",
    statement: "XR is the best / fastest / most secure AI agent platform.",
    sources: [],
    classification: "unsupported",
    evidenceScenarios: [],
    evidenceTests: [],
    doesNotProve:
      "No such comparative claim is shipped, and none may be. XR runs no competitor in its benchmarks, so it has " +
      "no evidence for a comparative superiority claim. The suite measures XR against its own declared contracts only.",
    requiredCorrection: "Never publish a comparative superiority claim as fact. This entry exists to keep that explicit.",
  },
]);

// ═══════════════════════════════════════════════════════════════════════════
// Audit
// ═══════════════════════════════════════════════════════════════════════════

function collectResults(runs: readonly EvaluationRun[]): Map<string, ScenarioResult> {
  const map = new Map<string, ScenarioResult>();
  const sorted = [...runs].sort((a, b) => b.provenance.startedAt - a.provenance.startedAt);
  for (const run of sorted) {
    if (run.invalidation) continue;
    for (const suite of run.suites) {
      for (const s of suite.scenarios) if (!map.has(s.scenarioId)) map.set(s.scenarioId, s);
    }
  }
  return map;
}

/**
 * Audit every claim against actual evidence.
 *
 * A claim classified as benchmark-verified is only "clean" when its scenarios
 * exist AND passed. This is what prevents documentation from drifting ahead of
 * reality.
 */
export function auditClaims(
  runs: readonly EvaluationRun[] = [],
  claims: readonly ClaimRecord[] = XR_CLAIMS,
  now = Date.now(),
): ClaimAuditResult {
  const results = collectResults(runs);
  const unsupported: string[] = [];

  for (const claim of claims) {
    if (claim.classification === "product_vision") continue;

    if (claim.classification === "unsupported") {
      // Present intentionally, as a standing prohibition. Not a defect.
      continue;
    }

    if (claim.classification === "verified_by_benchmark" && claim.evidenceScenarios.length === 0) {
      unsupported.push(`${claim.id}: classified benchmark-verified but names no scenario`);
      continue;
    }

    // Any claim that names supporting scenarios is checked against them —
    // including `documented_limitation` claims, whose stated guarantee still
    // has to hold. A limitation is a narrower promise, not an exemption.
    if (claim.evidenceScenarios.length > 0 && runs.length > 0) {
      for (const scenarioId of claim.evidenceScenarios) {
        const r = results.get(scenarioId);
        if (!r) {
          unsupported.push(`${claim.id}: supporting scenario "${scenarioId}" did not run`);
        } else if (r.status !== "passed" && r.status !== "not_applicable") {
          unsupported.push(
            `${claim.id}: supporting scenario "${scenarioId}" ended "${r.status}" — the claim is not currently substantiated`,
          );
        }
      }
    }

    if (claim.classification === "verified_by_contract" && claim.evidenceTests.length === 0) {
      unsupported.push(`${claim.id}: classified contract-verified but names no test`);
    }

    if (!claim.doesNotProve.trim()) {
      unsupported.push(`${claim.id}: does not state what its evidence fails to prove`);
    }
  }

  return Object.freeze({
    generatedAt: now,
    claims: Object.freeze([...claims]),
    unsupported: Object.freeze(unsupported),
    clean: unsupported.length === 0,
  });
}

/**
 * Assert no shipped claim asserts comparative superiority as fact.
 * Exercised by tests so the prohibition is executable, not aspirational.
 */
export function assertNoUnsupportedSuperiorityClaim(claims: readonly ClaimRecord[] = XR_CLAIMS): void {
  const pattern = /\b(world'?s best|the best|fastest|most secure|number one|#1|unbeatable|superior to)\b/i;
  for (const claim of claims) {
    if (claim.classification === "unsupported" || claim.classification === "product_vision") continue;
    if (pattern.test(claim.statement)) {
      throw new Error(
        `Claim "${claim.id}" asserts comparative superiority as fact: "${claim.statement}". ` +
          `XR runs no competitor in its benchmarks and therefore has no evidence for such a claim.`,
      );
    }
  }
}

/** Claims that still require a correction before publication. */
export function pendingCorrections(claims: readonly ClaimRecord[] = XR_CLAIMS): readonly ClaimRecord[] {
  return Object.freeze(claims.filter((c) => Boolean(c.requiredCorrection)));
}
