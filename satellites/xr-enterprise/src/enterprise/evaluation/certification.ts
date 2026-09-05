/**
 * XR 7.0 — Evidence-backed certification (Phase 13).
 *
 * Certification here means one thing only: a claim that specific requirements
 * were met, backed by named benchmark runs, valid for a bounded time, and
 * revocable.
 *
 * Hard rules (§11):
 *   - Certification is never granted from self-reported claims alone where
 *     independent evidence is required.
 *   - Certifications always expire. A permanent certification becomes a lie.
 *   - Certifications are revocable, and revocation is preserved, not erased.
 *   - This module NEVER asserts an external certification (SOC 2, ISO 27001,
 *     HIPAA, PCI-DSS, FedRAMP). It integrates with Phase 12 evidence packs,
 *     which already state they are self-assessments.
 */

import { randomUUID } from "node:crypto";
import { runCapabilityContractTests } from "@xr/core/platform/capabilities/certification.ts";
import type { CapabilityDescriptor } from "@xr/core/platform/capabilities/types.ts";
import {
  EVALUATION_CERTIFICATION_VERSION,
  type CertificationEvidenceRef,
  type CertificationRecord,
  type CertificationStatus,
  type CertificationTarget,
  type EvaluationRun,
  type ScenarioResult,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Requirements
// ═══════════════════════════════════════════════════════════════════════════

/** Default validity window: 90 days. Certification is never permanent. */
export const DEFAULT_CERTIFICATION_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

export interface CertificationRequirement {
  readonly id: string;
  readonly description: string;
  /** Scenario ids that must have passed. */
  readonly scenarioIds: readonly string[];
  /**
   * When true, a `partial` result is acceptable. Defaults to false — safety
   * requirements demand a full pass.
   */
  readonly allowPartial?: boolean;
}

/**
 * Requirement sets per certification target.
 *
 * These reference the scenarios shipped in `src/enterprise/evaluation/suites/`. A target
 * with no evidence cannot be certified.
 */
export const CERTIFICATION_REQUIREMENTS: Readonly<Record<CertificationTarget, readonly CertificationRequirement[]>> =
  Object.freeze({
    provider: Object.freeze([
      {
        id: "provider.locality",
        description: "Routing honours the configured locality/privacy boundary.",
        scenarioIds: ["intelligence.locality-policy-enforced"],
      },
      {
        id: "provider.explainability",
        description: "Routing decisions are explainable and durably recordable.",
        scenarioIds: ["intelligence.routing-explainable"],
      },
    ]),
    capability: Object.freeze([
      {
        id: "capability.authority",
        description: "Effective authority never exceeds declared authority.",
        scenarioIds: ["capability.authority-escalation-refused"],
      },
      {
        id: "capability.provenance",
        description: "Invalid package provenance prevents certification.",
        scenarioIds: ["capability.signature-status-honest"],
      },
    ]),
    workflow: Object.freeze([
      {
        id: "workflow.human-authority",
        description: "Human approval gates are honoured and denials stop work.",
        scenarioIds: ["workflow.human-gate-holds"],
      },
      {
        id: "workflow.integrity",
        description: "Published definitions are tamper-evident, including their executable content.",
        scenarioIds: ["workflow.definition-integrity"],
      },
      {
        id: "workflow.migration",
        description: "Active runs are only migrated onto compatible versions.",
        scenarioIds: ["workflow.version-migration-safety"],
      },
    ]),
    deployment_profile: Object.freeze([
      {
        id: "deployment.portability",
        description: "Every profile declares a coherent capability set and the local profile needs no cloud.",
        scenarioIds: ["deployment.profile-portability"],
      },
      {
        id: "deployment.honesty",
        description: "Profiles disclose unmet prerequisites instead of claiming readiness.",
        scenarioIds: ["deployment.cloud-profile-declares-requirements"],
      },
    ]),
    runtime_version: Object.freeze([
      {
        id: "runtime.identity",
        description: "Version identity is consistent across surfaces.",
        scenarioIds: ["runtime.version-single-source-of-truth"],
      },
      {
        id: "runtime.execution-honesty",
        description: "Outcomes are durably recorded and failures are reported honestly.",
        scenarioIds: ["execution.outcome-durably-recorded", "execution.failure-is-honest"],
      },
      {
        id: "runtime.trust",
        description: "High-risk work fails closed when isolation is unavailable.",
        scenarioIds: ["trust.fail-closed-without-isolation", "trust.risk-escalation"],
      },
      {
        id: "runtime.durability",
        description: "Interrupted work is recoverable and unsafe repetition is refused.",
        scenarioIds: ["durability.recovery-after-restart", "durability.duplicate-effect-refused"],
      },
      {
        id: "runtime.enterprise",
        description: "Safety policy cannot be loosened and audit evidence is tamper-evident.",
        scenarioIds: ["enterprise.policy-cannot-loosen-safety", "enterprise.audit-chain-detects-tampering"],
      },
    ]),
  });

// ═══════════════════════════════════════════════════════════════════════════
// Certification
// ═══════════════════════════════════════════════════════════════════════════

export interface CertifyOptions {
  readonly target: CertificationTarget;
  readonly subjectId: string;
  readonly subjectVersion: string;
  /** Runs supplying the evidence. Must be non-empty for a `certified` status. */
  readonly runs: readonly EvaluationRun[];
  readonly now?: number;
  readonly validityMs?: number;
  /**
   * Set true when the only evidence is the subject's own claim. Such a subject
   * can never reach `certified` — at best `insufficient_evidence`.
   */
  readonly selfReportedOnly?: boolean;
  readonly extraLimitations?: readonly string[];
}

function findScenario(runs: readonly EvaluationRun[], scenarioId: string): { run: EvaluationRun; result: ScenarioResult } | null {
  // Prefer the most recent run that contains the scenario.
  const sorted = [...runs].sort((a, b) => b.provenance.startedAt - a.provenance.startedAt);
  for (const run of sorted) {
    if (run.invalidation) continue;
    for (const suite of run.suites) {
      const result = suite.scenarios.find((s) => s.scenarioId === scenarioId);
      if (result) return { run, result };
    }
  }
  return null;
}

/**
 * Issue a certification from benchmark evidence.
 *
 * Status logic:
 *   certified              — every requirement met by a passing scenario
 *   provisional            — met, but only with `partial` results where allowed
 *   insufficient_evidence  — a required scenario never ran, or evidence is self-reported only
 *   not_certified          — a required scenario failed or was blocked
 */
export function certify(opts: CertifyOptions): CertificationRecord {
  const now = opts.now ?? Date.now();
  const requirements = CERTIFICATION_REQUIREMENTS[opts.target] ?? [];
  const evidence: CertificationEvidenceRef[] = [];
  const unmet: string[] = [];
  const limitations: string[] = [...(opts.extraLimitations ?? [])];

  let anyMissing = false;
  let anyFailed = false;
  let anyPartial = false;

  for (const req of requirements) {
    for (const scenarioId of req.scenarioIds) {
      const found = findScenario(opts.runs, scenarioId);
      if (!found) {
        anyMissing = true;
        unmet.push(`${req.id}: no evidence — scenario "${scenarioId}" was not executed in any supplied valid run`);
        continue;
      }

      evidence.push({
        runId: found.run.provenance.runId,
        scenarioId,
        scenarioVersion: found.result.scenarioVersion,
        status: found.result.status,
        runDigest: found.run.integrity.digest,
      });

      if (found.result.status === "passed") continue;
      if (found.result.status === "partial" && req.allowPartial) {
        anyPartial = true;
        limitations.push(`${req.id}: satisfied only partially by "${scenarioId}" — ${found.result.statusReason}`);
        continue;
      }
      if (found.result.status === "not_applicable") {
        anyMissing = true;
        unmet.push(`${req.id}: scenario "${scenarioId}" was not applicable to this configuration`);
        continue;
      }
      anyFailed = true;
      unmet.push(`${req.id}: scenario "${scenarioId}" ended "${found.result.status}" — ${found.result.statusReason}`);
    }
  }

  let status: CertificationStatus;
  if (requirements.length === 0) {
    status = "insufficient_evidence";
    unmet.push(`no certification requirements are defined for target "${opts.target}"`);
  } else if (opts.selfReportedOnly) {
    // §11: independent evidence is required; self-reporting alone cannot certify.
    status = "insufficient_evidence";
    unmet.push("evidence is self-reported only; independent benchmark evidence is required for certification");
  } else if (anyFailed) {
    status = "not_certified";
  } else if (anyMissing) {
    status = "insufficient_evidence";
  } else if (anyPartial) {
    status = "provisional";
  } else {
    status = "certified";
  }

  limitations.push(
    "This certification attests only that the named XR benchmark scenarios produced the recorded outcomes " +
      "in the recorded environment. It is not an external audit, accreditation, or security guarantee.",
  );

  return Object.freeze({
    version: EVALUATION_CERTIFICATION_VERSION,
    certificationId: `cert_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    target: opts.target,
    subjectId: opts.subjectId,
    subjectVersion: opts.subjectVersion,
    status,
    issuedAt: now,
    expiresAt: now + (opts.validityMs ?? DEFAULT_CERTIFICATION_VALIDITY_MS),
    productVersion: opts.runs[0]?.provenance.productVersion ?? "unknown",
    evidence: Object.freeze(evidence),
    unmetRequirements: Object.freeze(unmet),
    limitations: Object.freeze(limitations),
    selfReportedOnly: opts.selfReportedOnly ?? false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/** Effective status accounting for expiry. Never mutates the record. */
export function effectiveStatus(record: CertificationRecord, now = Date.now()): CertificationStatus {
  if (record.revocation) return "revoked";
  if (now >= record.expiresAt) return "expired";
  return record.status;
}

export function isValidNow(record: CertificationRecord, now = Date.now()): boolean {
  const s = effectiveStatus(record, now);
  return s === "certified" || s === "provisional";
}

/** Revoke a certification. Returns a new record; history is preserved. */
export function revoke(
  record: CertificationRecord,
  reason: string,
  revokedBy: string,
  now = Date.now(),
): CertificationRecord {
  return Object.freeze({
    ...record,
    status: "revoked" as CertificationStatus,
    revocation: Object.freeze({ revokedAt: now, reason, revokedBy }),
  });
}

/**
 * Invalidate certifications whose evidence came from a now-invalidated run.
 * Integrity of the evidence chain is part of the certification's meaning.
 */
export function revokeForInvalidatedRun(
  records: readonly CertificationRecord[],
  invalidatedRunId: string,
  now = Date.now(),
): CertificationRecord[] {
  return records.map((r) =>
    r.evidence.some((e) => e.runId === invalidatedRunId) && !r.revocation
      ? revoke(r, `supporting evaluation run "${invalidatedRunId}" was invalidated`, "xr-evaluation", now)
      : r,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Capability bridge (Phase 9 integration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Certify a capability by combining:
 *   1. XR 5.2 contract tests (the existing Phase 9 certifier), and
 *   2. Phase 13 benchmark evidence.
 *
 * Both must agree. This deliberately reuses the Phase 9 implementation rather
 * than creating a second, competing certification system.
 */
export function certifyCapability(
  descriptor: CapabilityDescriptor,
  runs: readonly EvaluationRun[],
  opts: { now?: number; validityMs?: number } = {},
): { certification: CertificationRecord; contractStatus: string; contractFailures: readonly string[] } {
  const now = opts.now ?? Date.now();
  const contract = runCapabilityContractTests(descriptor, { now });
  const failures = contract.tests.filter((t) => t.status === "failed").map((t) => `${t.id}: ${t.message}`);

  const base = certify({
    target: "capability",
    subjectId: descriptor.id,
    subjectVersion: descriptor.version,
    runs,
    now,
    ...(opts.validityMs !== undefined ? { validityMs: opts.validityMs } : {}),
    extraLimitations: [
      `Phase 9 contract certification reported "${contract.status}".`,
      ...(failures.length > 0 ? [`Contract test failures: ${failures.join("; ")}`] : []),
    ],
  });

  // A capability that fails its own contract tests can never be certified,
  // regardless of what the benchmark suite says.
  const certification: CertificationRecord =
    failures.length > 0
      ? Object.freeze({
          ...base,
          status: "not_certified" as CertificationStatus,
          unmetRequirements: Object.freeze([
            ...base.unmetRequirements,
            ...failures.map((f) => `capability contract test failed — ${f}`),
          ]),
        })
      : base;

  return { certification, contractStatus: contract.status, contractFailures: Object.freeze(failures) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Guards
// ═══════════════════════════════════════════════════════════════════════════

const FORBIDDEN_CLAIM = /\b(soc\s?2|iso\s?27001|hipaa|pci[- ]?dss|fedramp)\b.{0,40}\b(certified|compliant|accredited)\b/i;

/**
 * Assert that a certification record makes no external accreditation claim.
 * Mirrors Phase 12's `assertNoFalseCertificationClaim` for evaluation output.
 */
export function assertNoExternalAccreditationClaim(record: CertificationRecord): void {
  const text = JSON.stringify(record);
  if (FORBIDDEN_CLAIM.test(text)) {
    throw new Error(
      "Certification integrity violation: an XR evaluation certification must never assert an external " +
        "accreditation (SOC 2, ISO 27001, HIPAA, PCI-DSS, FedRAMP).",
    );
  }
  if (record.status === "certified" && record.evidence.length === 0) {
    throw new Error("Certification integrity violation: 'certified' was issued with no supporting evidence.");
  }
  if (record.status === "certified" && record.selfReportedOnly) {
    throw new Error("Certification integrity violation: 'certified' was issued from self-reported evidence alone.");
  }
  if (record.expiresAt <= record.issuedAt) {
    throw new Error("Certification integrity violation: certification must have a positive validity window.");
  }
}
