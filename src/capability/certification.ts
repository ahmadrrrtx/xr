/**
 * XR 5.2.0 — Certification / Contract Test Framework
 *
 * Evidence-based certification, not popularity-based. Distinguishes
 * self-tested, XR-tested, verified, quarantined, legacy, unknown.
 */
import { CertificationSchema, CertificationStatus, Certification } from "./types.ts";

export interface ContractTestDef {
  name: string;
  description?: string;
  passed: boolean;
  timestamp: number;
  details?: string;
  verifiedBy?: string;
}

export interface CertificationUpdate {
  status?: CertificationStatus;
  contractTests?: ContractTestDef[];
  boundaryVerified?: boolean;
  permissionVerified?: boolean;
  executionVerified?: boolean;
  contextVerified?: boolean;
  durableVerified?: boolean;
  cleanupVerified?: boolean;
  compatibilityVerified?: boolean;
  certifiedBy?: string;
  certifiedAt?: number;
}

export function buildCertification(update: CertificationUpdate = {}): Certification {
  return CertificationSchema.parse({
    status: update.status ?? "unknown",
    contractTests: (update.contractTests ?? []).map((t) => ({
      name: t.name,
      passed: t.passed,
      timestamp: t.timestamp,
      details: t.details,
    })),
    securityBoundaryVerified: update.boundaryVerified,
    permissionHonestyVerified: update.permissionVerified,
    executionContractVerified: update.executionVerified,
    contextScopeVerified: update.contextVerified,
    durableBehaviorVerified: update.durableVerified,
    errorCleanupVerified: update.cleanupVerified,
    versionCompatibilityVerified: update.compatibilityVerified,
    certifiedBy: update.certifiedBy,
    certifiedAt: update.certifiedAt,
  });
}

export function addContractTest(
  current: Certification,
  test: ContractTestDef,
): Certification {
  const updatedTests = [...current.contractTests, {
    name: test.name,
    passed: test.passed,
    timestamp: test.timestamp,
    details: test.details,
  }];
  const allPassed = updatedTests.every((t) => t.passed);
  const newStatus = allPassed ? "self_tested" : current.status === "verified" ? "xr_tested" : current.status;
  return CertificationSchema.parse({
    ...current,
    status: newStatus,
    contractTests: updatedTests,
  });
}

export function evaluateCertificationEvidence(
  descriptor: any,
  executionHistory?: any[],
): { evidenceScore: number; evidenceReasons: string[]; recommendedStatus: CertificationStatus } {
  const reasons: string[] = [];
  let score = 0;

  const cert = descriptor?.certification ?? {};
  const tests = cert.contractTests ?? [];

  if (tests.length === 0) {
    reasons.push("no contract tests recorded");
  } else {
    const passedCount = tests.filter((t: any) => t.passed).length;
    score += Math.min(passedCount / Math.max(tests.length, 1), 1) * 0.4;
    reasons.push(`contract tests: ${passedCount}/${tests.length} passed`);
  }

  if (cert.securityBoundaryVerified) {
    score += 0.1;
    reasons.push("security boundary verified");
  }
  if (cert.permissionHonestyVerified) {
    score += 0.1;
    reasons.push("permission honesty verified");
  }
  if (cert.executionContractVerified) {
    score += 0.1;
    reasons.push("execution contract verified");
  }
  if (cert.errorCleanupVerified) {
    score += 0.1;
    reasons.push("error cleanup verified");
  }
  if (cert.versionCompatibilityVerified) {
    score += 0.1;
    reasons.push("version compatibility verified");
  }

  const recommendedStatus: CertificationStatus = score >= 0.8 ? "verified" : score >= 0.5 ? "xr_tested" : score >= 0.2 ? "self_tested" : "unknown";

  return { evidenceScore: score, evidenceReasons: reasons, recommendedStatus };
}
