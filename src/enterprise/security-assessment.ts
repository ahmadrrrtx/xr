/**
 * XR 6.1 — Security Assessment Preparation and Evidence
 *
 * Prepares evidence for independent security assessment:
 * threat model, control implementation, test results, audit integrity,
 * isolation results, access reviews, backup/restore, incident exercises,
 * release/change management, and data retention/residency.
 *
 * Does NOT claim SOC/HIPAA/etc. certification unless externally obtained.
 */

import { randomUUID } from "node:crypto";
import type { SecurityAssessmentEvidence, SecurityFinding } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Security Assessment Service
// ═══════════════════════════════════════════════════════════════════════════

export interface SecurityAssessmentDeps {
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class SecurityAssessmentService {
  private readonly assessments = new Map<string, SecurityAssessmentEvidence>();
  private readonly deps: SecurityAssessmentDeps;
  private readonly limitations: string[] = [];

  constructor(deps: SecurityAssessmentDeps = {}) {
    this.deps = deps;
  }

  // ── Assessment Evidence ──────────────────────────────────────────────

  /** Record a security assessment. */
  recordAssessment(params: {
    assessmentType: SecurityAssessmentEvidence["assessmentType"];
    conductedBy: string;
    scope: string[];
    findings: SecurityFinding[];
    overallRating: SecurityAssessmentEvidence["overallRating"];
    evidenceReferences?: string[];
  }): SecurityAssessmentEvidence {
    const evidence: SecurityAssessmentEvidence = {
      id: `sa_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      assessmentType: params.assessmentType,
      conductedBy: params.conductedBy,
      conductedAt: Date.now(),
      scope: params.scope,
      findings: params.findings,
      overallRating: params.overallRating,
      evidenceReferences: params.evidenceReferences ?? [],
    };

    this.assessments.set(evidence.id, evidence);

    this.deps.audit?.("security.assessment_recorded", {
      id: evidence.id,
      type: params.assessmentType,
      rating: params.overallRating,
      findings: params.findings.length,
    });

    return evidence;
  }

  /** Get an assessment. */
  getAssessment(id: string): SecurityAssessmentEvidence | undefined {
    return this.assessments.get(id);
  }

  /** List all assessments. */
  listAssessments(): SecurityAssessmentEvidence[] {
    return Array.from(this.assessments.values())
      .sort((a, b) => b.conductedAt - a.conductedAt);
  }

  /** Get the latest assessment. */
  getLatestAssessment(): SecurityAssessmentEvidence | undefined {
    const all = this.listAssessments();
    return all[0];
  }

  // ── Finding Management ───────────────────────────────────────────────

  /** Update a finding's status. */
  updateFindingStatus(
    assessmentId: string,
    findingId: string,
    status: SecurityFinding["status"],
    updatedBy: string,
  ): boolean {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) return false;

    const findings = assessment.findings.map(f =>
      f.id === findingId ? { ...f, status } : f
    );

    this.assessments.set(assessmentId, { ...assessment, findings });

    this.deps.audit?.("security.finding_updated", {
      assessmentId,
      findingId,
      status,
      by: updatedBy,
    });

    return true;
  }

  /** Get unresolved findings. */
  getUnresolvedFindings(): SecurityFinding[] {
    const unresolved: SecurityFinding[] = [];
    for (const assessment of this.assessments.values()) {
      for (const finding of assessment.findings) {
        if (finding.status === "open" || finding.status === "in_progress") {
          unresolved.push(finding);
        }
      }
    }
    return unresolved;
  }

  // ── Evidence Preparation ─────────────────────────────────────────────

  /** Prepare a summary of assessment evidence for certification readiness. */
  prepareEvidenceSummary(): {
    assessmentsCompleted: number;
    latestRating?: string;
    openFindings: number;
    criticalFindings: number;
    highFindings: number;
    scopeCoverage: string[];
    limitations: string[];
  } {
    const latest = this.getLatestAssessment();
    const unresolved = this.getUnresolvedFindings();

    const criticalFindings = unresolved.filter(f => f.severity === "critical").length;
    const highFindings = unresolved.filter(f => f.severity === "high").length;

    // Aggregate all scopes across assessments.
    const allScopes = new Set<string>();
    for (const assessment of this.assessments.values()) {
      for (const s of assessment.scope) allScopes.add(s);
    }

    return {
      assessmentsCompleted: this.assessments.size,
      latestRating: latest?.overallRating,
      openFindings: unresolved.length,
      criticalFindings,
      highFindings,
      scopeCoverage: Array.from(allScopes),
      limitations: this.limitations,
    };
  }

  /** Record a known limitation (for transparency). */
  recordLimitation(limitation: string): void {
    this.limitations.push(limitation);
    this.deps.audit?.("security.limitation_recorded", { limitation });
  }

  /** Get all recorded limitations. */
  getLimitations(): readonly string[] {
    return this.limitations;
  }

  // ── Certification Readiness ──────────────────────────────────────────

  /**
   * Check if the deployment is ready for external certification.
   * This is an internal check — does NOT claim actual certification.
   */
  checkCertificationReadiness(): {
    ready: boolean;
    blockers: string[];
    recommendations: string[];
  } {
    const blockers: string[] = [];
    const recommendations: string[] = [];

    const evidence = this.prepareEvidenceSummary();

    if (evidence.assessmentsCompleted === 0) {
      blockers.push("No security assessment has been conducted");
    }

    if (evidence.criticalFindings > 0) {
      blockers.push(`${evidence.criticalFindings} critical findings remain unresolved`);
    }

    if (evidence.highFindings > 0) {
      recommendations.push(`${evidence.highFindings} high-severity findings should be addressed`);
    }

    if (!evidence.latestRating || evidence.latestRating === "fail") {
      blockers.push("Latest assessment did not pass");
    }

    if (this.limitations.length > 0) {
      recommendations.push(`${this.limitations.length} known limitations are documented`);
    }

    return {
      ready: blockers.length === 0,
      blockers,
      recommendations,
    };
  }

  /**
   * IMPORTANT: This function does NOT issue a certification.
   * It only reports readiness. Actual certification requires an external
   * auditor and formal compliance review.
   */
  getCertificationDisclaimer(): string {
    return "XR 6.1 provides security assessment evidence and certification readiness checks. " +
      "It does NOT claim SOC 2, HIPAA, ISO 27001, PCI DSS, or any other external certification. " +
      "Actual certification requires an independent external assessment by a qualified auditor.";
  }
}
