/**
 * XR 6.1 — Certification evidence preparation.
 *
 * This module prepares evidence FOR an independent assessment. It does not,
 * and must never, assert that an assessment has happened.
 *
 * Roadmap §6.9 / §12: "Do not claim SOC/HIPAA/etc. certification unless
 * actually externally obtained." `externallyCertified` is therefore false
 * unless the caller supplies externally-issued attestations out of band, and
 * `assertNoFalseCertificationClaim` exists so tests can prove we never lie.
 *
 * Every control declares its assurance kind so a reader can tell the
 * difference between:
 *   technical         — enforced by code, provable by test
 *   operational       — depends on humans following a documented process
 *   external_required — cannot be satisfied by XR alone
 */

import { createHash, randomUUID } from "node:crypto";
import type { DeploymentProfileKind } from "../deployment/types.ts";
import {
  EVIDENCE_PACK_VERSION,
  type AssuranceKind,
  type ControlEvidence,
  type ControlStatus,
  type EvidencePack,
  type ThreatModelEntry,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export const EVIDENCE_DISCLAIMER =
  "This evidence pack is prepared BY the XR project FOR use in an independent security assessment. " +
  "It is a self-assessment. It is NOT a certification, attestation, or audit report. " +
  "XR makes no SOC 2, ISO 27001, HIPAA, PCI-DSS, or FedRAMP claim. " +
  "Controls marked 'operational' depend on the deploying organization following documented procedures and are not enforced by code. " +
  "Controls marked 'external_required' cannot be satisfied by XR alone and require an external auditor, provider, or organizational process.";

// ═══════════════════════════════════════════════════════════════════════════
// Control catalog
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Phase 12 control catalog.
 *
 * Each entry points at the file that implements it and the test that proves
 * it, so an assessor can trace a claim to code and to a passing test.
 */
export const PHASE12_CONTROLS: readonly ControlEvidence[] = Object.freeze([
  {
    controlId: "AC-01",
    title: "Layered policy with most-restrictive resolution",
    description:
      "Policy is resolved across six layers. Safety-relevant settings resolve most-restrictive-wins so a privileged layer can tighten but never loosen.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/policy/layers.ts", "src/enterprise/policy/engine.ts"],
    testedBy: ["test/enterprise/policy.test.ts"],
    limitations: [
      "Applies to policy keys registered in SAFETY_KEY_SPECS. Keys outside that registry resolve most-specific-wins.",
    ],
  },
  {
    controlId: "AC-02",
    title: "Non-overridable user-visibility invariants",
    description:
      "Approval visibility, policy effects, data scope, action provenance, capability trust, and incident impact cannot be disabled by any policy layer, including platform defaults.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/policy/layers.ts", "src/enterprise/policy/engine.ts"],
    testedBy: ["test/enterprise/policy.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: [
      "Guarantees the policy engine never resolves these to false. A UI that ignores the resolved policy is out of scope for this control.",
    ],
  },
  {
    controlId: "AC-03",
    title: "Rejected override attempts are recorded",
    description:
      "Attempts to weaken a safety or visibility setting are rejected and returned in the resolution, never silently dropped.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/policy/engine.ts", "src/enterprise/policy/bundles.ts"],
    testedBy: ["test/enterprise/policy.test.ts"],
    limitations: [],
  },
  {
    controlId: "AC-04",
    title: "Delegated authority is a strict subset",
    description:
      "A delegation can only grant scopes the delegator holds; unheld scopes are stripped. The risk-tier ceiling can only be lowered down a chain.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/authority/delegation.ts"],
    testedBy: ["test/enterprise/authority.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: ["Depth is bounded at MAX_DELEGATION_DEPTH (4)."],
  },
  {
    controlId: "AC-05",
    title: "Revocation is immediate and cascades",
    description: "Revoking a delegation immediately revokes every downstream delegation in its chain.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/authority/delegation.ts"],
    testedBy: ["test/enterprise/authority.test.ts"],
    limitations: [
      "In-flight operations already inside an isolation boundary are terminated by the trust layer, not by this module.",
    ],
  },
  {
    controlId: "AC-06",
    title: "Periodic access review",
    description: "Delegations carry a review due date, become pending_review when overdue, and reviews may only reduce scope.",
    assurance: "operational",
    status: "implemented",
    implementedIn: ["src/enterprise/authority/delegation.ts"],
    testedBy: ["test/enterprise/authority.test.ts"],
    limitations: ["XR surfaces the queue; an organization must actually perform the reviews."],
  },
  {
    controlId: "AU-01",
    title: "Tamper-evident audit chain",
    description: "Audit records are SHA-256 hash-chained; the chain is verifiable independently of export.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/state/workspace-store.ts", "extensions/business-os/src/core/audit.ts"],
    testedBy: ["test/enterprise/audit-export.test.ts"],
    limitations: [
      "Hash chaining detects tampering; it does not prevent an operator with filesystem access from deleting the store. " +
        "Off-host replication is an operational control.",
    ],
  },
  {
    controlId: "AU-02",
    title: "Verifiable redaction",
    description:
      "Redacted fields carry a SHA-256 digest of the original value and the record's original hash is preserved, so a redacted export still verifies.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/audit/redaction.ts"],
    testedBy: ["test/enterprise/audit-export.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: ["Digests reveal equality of values. Low-entropy fields remain subject to dictionary attack."],
  },
  {
    controlId: "AU-03",
    title: "Controlled audit export with integrity manifest",
    description:
      "Exports are access-controlled, carry a content hash, report chain verification, and mark partial results explicitly.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/audit/export.ts"],
    testedBy: ["test/enterprise/audit-export.test.ts"],
    limitations: ["Export integrity uses SHA-256, not an externally-anchored signature."],
  },
  {
    controlId: "AU-04",
    title: "Audit access logging",
    description: "Every export, view, and verify attempt is logged, including denials with reasons.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/audit/export.ts"],
    testedBy: ["test/enterprise/audit-export.test.ts"],
    limitations: [],
  },
  {
    controlId: "AU-05",
    title: "Retention schedules and legal hold",
    description:
      "Per-event-class retention with archive and delete actions; an active legal hold blocks deletion and the conflict is reported explicitly.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/audit/retention.ts"],
    testedBy: ["test/enterprise/audit-export.test.ts"],
    limitations: [
      "XR evaluates and reports; actual deletion is delegated to an injected handler owned by the deployment.",
    ],
  },
  {
    controlId: "OP-01",
    title: "Measurable SLOs only",
    description:
      "Each SLO declares whether it is measurable and from which signal. Unmeasurable objectives report 'unmeasurable' rather than a fabricated result.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/operations/slo.ts"],
    testedBy: ["test/enterprise/operations.test.ts"],
    limitations: [
      "upgrade_rollback is fleet-unmeasurable by design: XR does not collect telemetry from installed deployments.",
    ],
  },
  {
    controlId: "OP-02",
    title: "Operational status aggregation",
    description: "Health, SLOs, backup, recovery, security, and worker state aggregate into a single operational view with alert conditions.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/operations/status.ts"],
    testedBy: ["test/enterprise/operations.test.ts"],
    limitations: [],
  },
  {
    controlId: "IR-01",
    title: "Incident lifecycle with enforced transitions",
    description: "Seven-state incident machine with a validated transition table and a full timeline.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/incidents/workflow.ts"],
    testedBy: ["test/enterprise/incidents.test.ts"],
    limitations: [],
  },
  {
    controlId: "IR-02",
    title: "Immutable incident evidence",
    description: "Evidence is hash-committed at capture time and verifiable afterwards.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/incidents/workflow.ts"],
    testedBy: ["test/enterprise/incidents.test.ts"],
    limitations: ["Evidence is preserved in the incident record; long-term archival is an operational control."],
  },
  {
    controlId: "IR-03",
    title: "User-visible incident impact cannot be suppressed",
    description:
      "Incidents involving data leakage, credential exposure, isolation failure, or audit failure always set userVisibleImpact.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/incidents/workflow.ts"],
    testedBy: ["test/enterprise/incidents.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: [],
  },
  {
    controlId: "IR-04",
    title: "Incident response exercises",
    description: "Documented tabletop and technical exercises for each incident kind.",
    assurance: "operational",
    status: "implemented",
    implementedIn: ["docs/enterprise-readiness/INCIDENT_RESPONSE.md"],
    testedBy: ["test/enterprise/incidents.test.ts"],
    limitations: ["Exercise cadence and participation are organizational responsibilities."],
  },
  {
    controlId: "SC-01",
    title: "Publisher and version-range revocation",
    description: "Capabilities can be revoked by id, by semver range, or wholesale by publisher.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/supplychain/response.ts"],
    testedBy: ["test/enterprise/supplychain.test.ts"],
    limitations: [],
  },
  {
    controlId: "SC-02",
    title: "Evidence preserved before quarantine",
    description: "A capability is snapshotted before it is quarantined, so a malicious capability cannot erase its own trail.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/supplychain/response.ts"],
    testedBy: ["test/enterprise/supplychain.test.ts"],
    limitations: [],
  },
  {
    controlId: "SC-03",
    title: "Install and update blocking",
    description: "An active revocation blocks installation and update of the affected capability or version range.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/supplychain/response.ts"],
    testedBy: ["test/enterprise/supplychain.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: ["Blocking applies to installs that route through the XR capability install path."],
  },
  {
    controlId: "SC-04",
    title: "Organization capability catalogs",
    description: "Allowlist/denylist catalogs with signature and certification requirements, evaluated after revocation.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/supplychain/response.ts"],
    testedBy: ["test/enterprise/supplychain.test.ts"],
    limitations: [],
  },
  {
    controlId: "SC-05",
    title: "Capability provenance and signing",
    description: "Publisher identity, package integrity, and signature status are recorded and enforced.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/platform/capabilities/types.ts", "src/platform/capabilities/certification.ts"],
    testedBy: ["test/capabilities"],
    limitations: [
      "Signature verification proves package integrity and publisher identity. It does not prove the code is benign.",
    ],
  },
  {
    controlId: "DR-01",
    title: "Backup integrity verification",
    description: "Backups are verified by recomputing the manifest digest and checking every component.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/recovery/operations.ts"],
    testedBy: ["test/enterprise/recovery.test.ts"],
    limitations: [],
  },
  {
    controlId: "DR-02",
    title: "Restore refused on failed verification",
    description: "A restore cannot proceed unless preflight verification passes — the control against restore poisoning.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/recovery/operations.ts"],
    testedBy: ["test/enterprise/recovery.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: [],
  },
  {
    controlId: "DR-03",
    title: "Backup credential safety",
    description: "Backups are scanned for embedded credential material; a positive finding blocks restore.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/recovery/operations.ts"],
    testedBy: ["test/enterprise/recovery.test.ts"],
    limitations: ["Detection is heuristic, based on key names and value shape."],
  },
  {
    controlId: "DR-04",
    title: "Partial restore consistency reporting",
    description: "Component-level restore outcomes with explicit consistency warnings when related components diverge.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/recovery/operations.ts"],
    testedBy: ["test/enterprise/recovery.test.ts"],
    limitations: [],
  },
  {
    controlId: "DR-05",
    title: "Recovery drills with RPO/RTO measurement",
    description: "Recorded restore drills measure RPO and RTO against declared targets; unmeasured values are reported as unknown.",
    assurance: "operational",
    status: "implemented",
    implementedIn: ["src/enterprise/recovery/operations.ts"],
    testedBy: ["test/enterprise/recovery.test.ts"],
    limitations: ["Drill cadence is an organizational responsibility."],
  },
  {
    controlId: "RM-01",
    title: "Release channels and support windows",
    description: "stable/lts/beta/edge channels with computed active and security-only support windows.",
    assurance: "operational",
    status: "implemented",
    implementedIn: ["src/enterprise/release/channels.ts"],
    testedBy: ["test/enterprise/release.test.ts"],
    limitations: ["Support windows are a project commitment, not a contractual SLA."],
  },
  {
    controlId: "RM-02",
    title: "Compatibility and migration checks",
    description: "Upgrade and downgrade paths are checked against schema, API, and minimum-upgrade-floor declarations.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/release/channels.ts"],
    testedBy: ["test/enterprise/release.test.ts"],
    limitations: [],
  },
  {
    controlId: "RM-03",
    title: "Rollback preserves safety invariants",
    description:
      "Rollback validation blocks any rollback that would lose local operation, policy safety, audit integrity, backups, incident evidence, or capability revocation.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/release/channels.ts"],
    testedBy: ["test/enterprise/release.test.ts", "test/enterprise/security-adversarial.test.ts"],
    limitations: [],
  },
  {
    controlId: "RM-04",
    title: "Release artifact integrity",
    description: "Release artifacts carry recorded SHA-256 digests, reproducibility flags, and SBOM references.",
    assurance: "technical",
    status: "partial",
    implementedIn: ["src/enterprise/release/channels.ts"],
    testedBy: ["test/enterprise/release.test.ts"],
    limitations: [
      "Digest recording and verification are implemented. Reproducible builds and SBOM generation are release-pipeline responsibilities and are declared, not proven, by this control.",
    ],
  },
  {
    controlId: "TN-01",
    title: "Organization and workspace separation",
    description: "Audit export, policy resolution, and admin queries are scoped to the requesting organization and workspace.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/audit/export.ts", "src/enterprise/policy/engine.ts"],
    testedBy: ["test/enterprise/security-adversarial.test.ts"],
    limitations: ["Storage-level isolation depends on the deployment's TenantBoundary.isolationLevel."],
  },
  {
    controlId: "TN-02",
    title: "Local and private deployment autonomy",
    description:
      "Every enterprise service constructs and operates with no network and no control plane under personal_local.",
    assurance: "technical",
    status: "implemented",
    implementedIn: ["src/enterprise/index.ts"],
    testedBy: ["test/enterprise/governance-matrix.test.ts"],
    limitations: [],
  },
  {
    controlId: "EX-01",
    title: "Independent security assessment",
    description: "An external assessor reviews the threat model, controls, and test evidence.",
    assurance: "external_required",
    status: "not_implemented",
    implementedIn: [],
    testedBy: [],
    limitations: [
      "NOT PERFORMED. This requires engaging an external assessor. No XR release may claim independent assessment until one is completed and published.",
    ],
  },
  {
    controlId: "EX-02",
    title: "SOC 2 Type II attestation",
    description: "Attestation by a licensed CPA firm over the trust services criteria.",
    assurance: "external_required",
    status: "not_implemented",
    implementedIn: [],
    testedBy: [],
    limitations: ["NOT OBTAINED. XR makes no SOC 2 claim."],
  },
  {
    controlId: "EX-03",
    title: "Penetration test",
    description: "Independent adversarial testing of a deployed XR instance.",
    assurance: "external_required",
    status: "not_implemented",
    implementedIn: [],
    testedBy: [],
    limitations: [
      "NOT PERFORMED. XR ships an internal adversarial test suite; that is not a substitute for third-party penetration testing.",
    ],
  },
]);

// ═══════════════════════════════════════════════════════════════════════════
// Threat model
// ═══════════════════════════════════════════════════════════════════════════

export const PHASE12_THREAT_MODEL: readonly ThreatModelEntry[] = Object.freeze([
  {
    threatId: "T-01",
    title: "Malicious administrator hides safety information from users",
    description:
      "An organization administrator sets policy that suppresses approval prompts, policy effects, or incident notices so users cannot see what the AI is permitted to do.",
    affectedBoundary: "B11 organization administration → user visibility",
    mitigations: [
      "AC-02: visibility keys are non-overridable at every layer",
      "AC-03: suppression attempts are rejected and recorded",
      "IR-03: user-visible incident impact cannot be cleared",
    ],
    residualRisk: "low",
  },
  {
    threatId: "T-02",
    title: "Privilege escalation via delegation chain",
    description: "A subject delegates authority it does not hold, or raises the risk ceiling partway down a chain.",
    affectedBoundary: "B4 authority grant issuance",
    mitigations: ["AC-04: strict subset enforcement", "AC-05: cascading revocation", "Depth bound of 4"],
    residualRisk: "low",
  },
  {
    threatId: "T-03",
    title: "Cross-tenant data access through admin tooling",
    description: "An administrator of one organization reads audit or policy data belonging to another.",
    affectedBoundary: "B7 tenant/workspace isolation",
    mitigations: ["TN-01: scoped export and resolution", "Authorizer denial is logged"],
    residualRisk: "medium",
    acceptedBy: undefined,
  },
  {
    threatId: "T-04",
    title: "Audit tampering or redaction bypass",
    description: "An actor alters audit history, or exports sensitive values that redaction should have removed.",
    affectedBoundary: "B9 audit hash chain",
    mitigations: ["AU-01: hash chain", "AU-02: verifiable redaction with digests", "AU-03: export integrity manifest"],
    residualRisk: "low",
  },
  {
    threatId: "T-05",
    title: "Restore poisoning",
    description: "An attacker supplies a corrupted or crafted backup and restores it to inject state or credentials.",
    affectedBoundary: "Backup/restore boundary",
    mitigations: ["DR-01: integrity verification", "DR-02: restore refused on failed verification", "DR-03: credential scan"],
    residualRisk: "low",
  },
  {
    threatId: "T-06",
    title: "Compromised capability publisher",
    description: "A trusted publisher's signing key is stolen and used to ship a malicious update.",
    affectedBoundary: "B6 capability provenance",
    mitigations: [
      "SC-01: publisher-wide revocation",
      "SC-02: evidence preserved before quarantine",
      "SC-03: install blocking",
    ],
    residualRisk: "medium",
  },
  {
    threatId: "T-07",
    title: "Compliance theater",
    description:
      "The project publishes compliance language that implies assurance it has not obtained, causing organizations to over-trust it.",
    affectedBoundary: "Institutional trust",
    mitigations: [
      "EX-01/02/03 are explicitly not_implemented",
      "externallyCertified is false unless attestations are supplied out of band",
      "assertNoFalseCertificationClaim is enforced by test",
    ],
    residualRisk: "low",
  },
  {
    threatId: "T-08",
    title: "Enterprise features coerce local users into a hosted control plane",
    description: "Enterprise administration becomes mandatory, breaking local autonomy and private operation.",
    affectedBoundary: "B8 control plane / data plane",
    mitigations: ["TN-02: all enterprise services operate offline under personal_local, enforced by test"],
    residualRisk: "low",
  },
]);

// ═══════════════════════════════════════════════════════════════════════════
// Pack assembly
// ═══════════════════════════════════════════════════════════════════════════

export interface BuildEvidencePackParams {
  readonly xrVersion: string;
  readonly profile: DeploymentProfileKind;
  readonly controls?: readonly ControlEvidence[];
  readonly threatModel?: readonly ThreatModelEntry[];
  /**
   * Externally-issued attestations. Supplying a non-empty list is the ONLY way
   * `externallyCertified` becomes true, and callers must be able to produce the
   * corresponding report on request.
   */
  readonly externalCertifications?: readonly string[];
  readonly unresolvedRisks?: readonly string[];
  readonly skippedControls?: readonly string[];
  readonly now?: number;
}

export function buildEvidencePack(params: BuildEvidencePackParams): EvidencePack {
  const controls = params.controls ?? PHASE12_CONTROLS;
  const threatModel = params.threatModel ?? PHASE12_THREAT_MODEL;
  const now = params.now ?? Date.now();

  const count = (pred: (c: ControlEvidence) => boolean): number => controls.filter(pred).length;

  const external = params.externalCertifications ?? [];

  const unresolvedRisks = [
    ...(params.unresolvedRisks ?? []),
    ...threatModel.filter((t) => t.residualRisk === "high").map((t) => `${t.threatId}: ${t.title} (high residual risk)`),
    ...threatModel
      .filter((t) => t.residualRisk === "medium" && !t.acceptedBy)
      .map((t) => `${t.threatId}: ${t.title} (medium residual risk, not formally accepted)`),
  ];

  const skippedControls = [
    ...(params.skippedControls ?? []),
    ...controls
      .filter((c) => c.status === "not_implemented")
      .map((c) => `${c.controlId}: ${c.title} — ${c.limitations[0] ?? "not implemented"}`),
  ];

  const summary = {
    total: controls.length,
    implemented: count((c) => c.status === "implemented"),
    partial: count((c) => c.status === "partial"),
    notImplemented: count((c) => c.status === "not_implemented"),
    technical: count((c) => c.assurance === "technical"),
    operational: count((c) => c.assurance === "operational"),
    externalRequired: count((c) => c.assurance === "external_required"),
  };

  const body = JSON.stringify({ controls, threatModel, summary, external });

  return {
    packId: id("pack"),
    packVersion: EVIDENCE_PACK_VERSION,
    generatedAt: now,
    xrVersion: params.xrVersion,
    profile: params.profile,
    controls,
    threatModel,
    summary,
    externallyCertified: external.length > 0,
    externalCertifications: external,
    disclaimer: EVIDENCE_DISCLAIMER,
    unresolvedRisks,
    skippedControls,
    contentHash: createHash("sha256").update(body).digest("hex"),
  };
}

/**
 * Guard against compliance theater.
 *
 * Returns the list of violations found in a pack. A release must not ship if
 * this returns anything. Enforced by `test/enterprise/certification.test.ts`.
 */
export function assertNoFalseCertificationClaim(pack: EvidencePack): readonly string[] {
  const violations: string[] = [];

  if (pack.externallyCertified && pack.externalCertifications.length === 0) {
    violations.push("Pack claims external certification but lists no attestations.");
  }

  for (const c of pack.controls) {
    if (c.assurance === "external_required" && c.status === "implemented") {
      violations.push(
        `Control ${c.controlId} is marked implemented but requires external assurance. XR cannot self-satisfy it.`,
      );
    }
    if (c.status === "implemented" && c.assurance === "technical" && c.testedBy.length === 0) {
      violations.push(`Control ${c.controlId} claims a technical implementation with no test evidence.`);
    }
    if (c.status === "implemented" && c.implementedIn.length === 0) {
      violations.push(`Control ${c.controlId} claims implementation with no source reference.`);
    }
  }

  if (!pack.disclaimer || pack.disclaimer.length < 100) {
    violations.push("Evidence pack is missing an adequate disclaimer.");
  }

  const forbidden = /\b(we are|xr is)\s+(soc\s*2|iso\s*27001|hipaa|pci[- ]dss|fedramp)\s+(certified|compliant)\b/i;
  if (forbidden.test(JSON.stringify(pack))) {
    violations.push("Evidence pack contains an unqualified external certification claim.");
  }

  return violations;
}

/** Render a human-readable evidence summary for the CLI and for assessors. */
export function renderEvidenceSummary(pack: EvidencePack): string {
  const lines: string[] = [];
  lines.push(`XR Certification Evidence Pack`);
  lines.push(`  Pack:     ${pack.packId} (${pack.packVersion})`);
  lines.push(`  XR:       ${pack.xrVersion} on profile '${pack.profile}'`);
  lines.push(`  Hash:     ${pack.contentHash.slice(0, 32)}…`);
  lines.push(`  Controls: ${pack.summary.total} total`);
  lines.push(
    `            ${pack.summary.implemented} implemented, ${pack.summary.partial} partial, ${pack.summary.notImplemented} not implemented`,
  );
  lines.push(
    `  Assurance: ${pack.summary.technical} technical, ${pack.summary.operational} operational, ${pack.summary.externalRequired} external-required`,
  );
  lines.push(`  Externally certified: ${pack.externallyCertified ? pack.externalCertifications.join(", ") : "NO"}`);
  if (pack.skippedControls.length > 0) {
    lines.push(`  Skipped/not implemented:`);
    for (const s of pack.skippedControls) lines.push(`    - ${s}`);
  }
  if (pack.unresolvedRisks.length > 0) {
    lines.push(`  Unresolved risks:`);
    for (const r of pack.unresolvedRisks) lines.push(`    - ${r}`);
  }
  lines.push("");
  lines.push(pack.disclaimer);
  return lines.join("\n");
}

export type { AssuranceKind, ControlStatus };
