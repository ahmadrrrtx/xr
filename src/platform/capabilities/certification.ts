/** XR 5.2 — capability contract certification tests. */
import type { CapabilityCertification, CapabilityDescriptor, CapabilityTestEvidence } from "./types.ts";
import { validateCapabilityDescriptor } from "./types.ts";

export interface CertificationOptions {
  now?: number;
  xrTested?: boolean;
  verifiedBy?: string;
}

function evidence(id: string, kind: CapabilityTestEvidence["kind"], status: CapabilityTestEvidence["status"], message: string, at: number): CapabilityTestEvidence {
  return { id, kind, status, message, at, source: "xr-5.2-contract-tests" };
}

export function runCapabilityContractTests(descriptor: CapabilityDescriptor, opts: CertificationOptions = {}): CapabilityCertification {
  const at = opts.now ?? Date.now();
  const tests: CapabilityTestEvidence[] = [];

  const schema = validateCapabilityDescriptor(descriptor);
  tests.push(evidence(
    "descriptor.schema",
    "manifest",
    schema.ok ? "passed" : "failed",
    schema.ok ? "common descriptor validates" : schema.errors.join("; "),
    at,
  ));

  const declared = new Set(descriptor.permissions.declared.map((p) => p.scope));
  const effectiveDeclaredSubset = descriptor.permissions.effective.effective.every((p) => declared.has(p));
  const deniedSet = new Set(descriptor.permissions.effective.denied);
  const deniedExcluded = descriptor.permissions.effective.effective.every((p) => !deniedSet.has(p));
  tests.push(evidence(
    "authority.declared-vs-effective",
    "permission",
    effectiveDeclaredSubset && deniedExcluded && !descriptor.permissions.effective.undetermined ? "passed" : "failed",
    descriptor.permissions.effective.undetermined
      ? `effective authority undetermined: ${descriptor.permissions.effective.reason ?? "unknown"}`
      : effectiveDeclaredSubset && deniedExcluded
        ? "effective authority is a subset of declarations and excludes denied scopes"
        : "effective authority exceeds declarations or includes denied scopes",
    at,
  ));

  tests.push(evidence(
    "provenance.package-integrity",
    "security",
    descriptor.package.signatureStatus === "invalid" ? "failed" : descriptor.package.signatureStatus === "unknown" ? "unknown" : "passed",
    descriptor.package.signatureStatus === "invalid"
      ? descriptor.package.signatureReason ?? "invalid package signature"
      : `signature status: ${descriptor.package.signatureStatus}`,
    at,
  ));

  const canPlace = descriptor.placement.riskTier !== "blocked" && descriptor.placement.requested !== "unknown";
  tests.push(evidence(
    "trust.placement",
    "trust",
    canPlace ? "passed" : "failed",
    canPlace ? `${descriptor.placement.riskTier} via ${descriptor.placement.requested}` : "risk/placement is blocked or unknown",
    at,
  ));

  const hasInterface = descriptor.interfaces.length > 0 || ["provider", "integration", "artifact"].includes(descriptor.type);
  tests.push(evidence(
    "execution.interface-contract",
    "execution",
    hasInterface ? "passed" : "unknown",
    hasInterface ? "capability exposes at least one typed interface" : "no executable interface declared",
    at,
  ));

  const contextOk = !descriptor.dataScopes.some((s) => (s.kind === "context" || s.kind === "memory") && s.access !== "none") || descriptor.permissions.effective.effective.some((p) => p.startsWith("memory:") || p === "context");
  tests.push(evidence(
    "context.scope-honesty",
    "context",
    contextOk ? "passed" : "failed",
    contextOk ? "context/data scopes align with effective authority" : "context/memory data scope declared without effective authority",
    at,
  ));

  tests.push(evidence(
    "durability.lifecycle-history",
    "durability",
    descriptor.lifecycle.history.length > 0 || !descriptor.lifecycle.installed ? "passed" : "unknown",
    descriptor.lifecycle.history.length > 0 ? "lifecycle history is inspectable" : "not installed or no lifecycle history yet",
    at,
  ));

  tests.push(evidence(
    "cleanup.quarantine-rollback",
    "cleanup",
    descriptor.lifecycle.quarantineReason || descriptor.lifecycle.rollbackAvailable || !descriptor.lifecycle.installed ? "passed" : "unknown",
    descriptor.lifecycle.quarantineReason
      ? `quarantined: ${descriptor.lifecycle.quarantineReason}`
      : descriptor.lifecycle.rollbackAvailable
        ? "rollback snapshot available"
        : "no rollback evidence yet",
    at,
  ));

  const compatibilityKnown = Boolean(descriptor.compatibility.xr || descriptor.compatibility.apiVersion || descriptor.compatibility.os?.length || descriptor.type === "tool" || descriptor.type === "integration");
  tests.push(evidence(
    "compatibility.runtime",
    "compatibility",
    compatibilityKnown ? "passed" : "unknown",
    compatibilityKnown ? "runtime compatibility is declared or intrinsic" : "runtime compatibility unknown",
    at,
  ));

  const failures = tests.filter((t) => t.status === "failed");
  const unknowns = tests.filter((t) => t.status === "unknown");
  let status: CapabilityCertification["status"] = "unknown";
  let reason: string | undefined;

  if (descriptor.lifecycle.state === "quarantined" || descriptor.trust.vulnerabilityStatus === "quarantined") {
    status = "quarantined";
    reason = descriptor.lifecycle.quarantineReason ?? "capability is quarantined";
  } else if (failures.length) {
    status = descriptor.lifecycle.installed ? "unknown" : "legacy";
    reason = failures.map((f) => `${f.id}: ${f.message}`).join("; ");
  } else if (opts.verifiedBy || descriptor.publisher.verified || descriptor.trust.trustLevel === "official") {
    status = "verified";
  } else if (opts.xrTested || unknowns.length === 0) {
    status = "xr-tested";
  } else if (descriptor.certification.tests.some((t) => t.kind === "self" && t.status === "passed") || descriptor.certification.status === "self-tested") {
    status = "self-tested";
  } else if (descriptor.type === "skill" && descriptor.certification.status === "legacy") {
    status = "legacy";
  }

  return {
    status,
    tests,
    certifiedAt: at,
    certifiedBy: opts.verifiedBy ?? (status === "xr-tested" ? "xr-contract" : undefined),
    reason,
  };
}

export function certificationEvidenceScore(cert: CapabilityCertification): number {
  if (cert.status === "quarantined") return 0;
  const weights: Record<CapabilityTestEvidence["status"], number> = { passed: 1, failed: -2, skipped: 0, unknown: 0 };
  const raw = cert.tests.reduce((sum, test) => sum + weights[test.status], 0);
  const max = Math.max(1, cert.tests.length);
  const base = Math.max(0, raw) / max;
  const bonus = cert.status === "verified" ? 0.25 : cert.status === "xr-tested" ? 0.15 : cert.status === "self-tested" ? 0.05 : 0;
  return Math.max(0, Math.min(1, base + bonus));
}
