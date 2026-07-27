/**
 * XR 6.1 — Enterprise Deployment Diagnostics
 *
 * Provides a comprehensive diagnostic framework for enterprise deployments:
 * connectivity, identity, policy, audit integrity, backup, security,
 * performance, compatibility, and certification checks.
 */

import { randomUUID } from "node:crypto";
import type {
  EnterpriseDiagnostic,
  DiagnosticCategory,
  DiagnosticReport,
  OperationalHealth,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostic Service
// ═══════════════════════════════════════════════════════════════════════════

export interface DiagnosticContext {
  /** Whether the control plane is reachable. */
  controlPlaneReachable: boolean;
  /** Whether workers are healthy. */
  workersHealthy: boolean;
  /** Whether the latest backup is verified. */
  backupVerified: boolean;
  /** Whether audit integrity checks pass. */
  auditIntegrityOk: boolean;
  /** Whether all required profiles are supported. */
  profilesSupported: boolean;
  /** Whether the current version is supported. */
  versionSupported: boolean;
  /** Whether security policies are active. */
  securityPoliciesActive: boolean;
  /** Current version string. */
  currentVersion: string;
  /** Active deployment profile. */
  activeProfile: string;
  /** Count of active incidents. */
  activeIncidents: number;
  /** Count of unreviewed delegated authorities. */
  unreviewedAuthorities: number;
}

export interface DeploymentDiagnosticsDeps {
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class DeploymentDiagnosticsService {
  private readonly reports: DiagnosticReport[] = [];
  private readonly deps: DeploymentDiagnosticsDeps;

  constructor(deps: DeploymentDiagnosticsDeps = {}) {
    this.deps = deps;
  }

  // ── Run Diagnostics ──────────────────────────────────────────────────

  /**
   * Run a full suite of enterprise deployment diagnostics.
   */
  runDiagnostics(ctx: DiagnosticContext): DiagnosticReport {
    const now = Date.now();
    const diagnostics: EnterpriseDiagnostic[] = [];

    // 1. Connectivity
    diagnostics.push({
      id: "diag.connectivity.control_plane",
      category: "connectivity",
      name: "Control Plane Reachability",
      status: ctx.controlPlaneReachable ? "pass" : "warn",
      detail: ctx.controlPlaneReachable ? "Control plane is reachable" : "Control plane is not reachable",
      recommendation: ctx.controlPlaneReachable ? undefined : "Verify network connectivity and control plane configuration",
      checkedAt: now,
    });

    // 2. Identity
    diagnostics.push({
      id: "diag.identity.version",
      category: "identity",
      name: "Version Status",
      status: ctx.versionSupported ? "pass" : "warn",
      detail: `Running version ${ctx.currentVersion}`,
      recommendation: ctx.versionSupported ? undefined : "Upgrade to a supported version",
      checkedAt: now,
    });

    // 3. Policy
    diagnostics.push({
      id: "diag.policy.active",
      category: "policy",
      name: "Security Policies Active",
      status: ctx.securityPoliciesActive ? "pass" : "fail",
      detail: ctx.securityPoliciesActive
        ? "Enterprise security policies are active"
        : "Core security policies are not active",
      recommendation: ctx.securityPoliciesActive ? undefined : "Apply at minimum the enterprise_baseline policy bundle",
      checkedAt: now,
    });

    diagnostics.push({
      id: "diag.policy.authorities_unreviewed",
      category: "policy",
      name: "Unreviewed Delegated Authorities",
      status: ctx.unreviewedAuthorities === 0 ? "pass" : "warn",
      detail: `${ctx.unreviewedAuthorities} delegated authorities pending review`,
      recommendation: ctx.unreviewedAuthorities > 0 ? "Review and recertify delegated authorities" : undefined,
      checkedAt: now,
    });

    // 4. Audit Integrity
    diagnostics.push({
      id: "diag.audit.integrity",
      category: "audit_integrity",
      name: "Audit Integrity",
      status: ctx.auditIntegrityOk ? "pass" : "fail",
      detail: ctx.auditIntegrityOk
        ? "Audit hash chain integrity verified"
        : "Audit integrity check failed — records may have been tampered with",
      recommendation: ctx.auditIntegrityOk ? undefined : "Run audit verification and investigate discrepancies",
      checkedAt: now,
    });

    // 5. Backup
    diagnostics.push({
      id: "diag.backup.recent",
      category: "backup",
      name: "Recent Backup Status",
      status: ctx.backupVerified ? "pass" : "warn",
      detail: ctx.backupVerified
        ? "Recent backup verified successfully"
        : "No recent verified backup found",
      recommendation: ctx.backupVerified ? undefined : "Create and verify a backup",
      checkedAt: now,
    });

    // 6. Security
    diagnostics.push({
      id: "diag.security.active_incidents",
      category: "security",
      name: "Active Security Incidents",
      status: ctx.activeIncidents === 0 ? "pass" : ctx.activeIncidents > 3 ? "fail" : "warn",
      detail: `${ctx.activeIncidents} active security incidents`,
      recommendation: ctx.activeIncidents > 0 ? "Review and contain open incidents" : undefined,
      checkedAt: now,
    });

    // 7. Performance
    diagnostics.push({
      id: "diag.performance.workers",
      category: "performance",
      name: "Worker Health",
      status: ctx.workersHealthy ? "pass" : "fail",
      detail: ctx.workersHealthy ? "All workers reporting healthy" : "One or more workers unhealthy",
      recommendation: ctx.workersHealthy ? undefined : "Check worker health and restart unhealthy workers",
      checkedAt: now,
    });

    // 8. Compatibility
    diagnostics.push({
      id: "diag.compatibility.profile",
      category: "compatibility",
      name: "Profile Compatibility",
      status: ctx.profilesSupported ? "pass" : "fail",
      detail: `Active profile: ${ctx.activeProfile}`,
      recommendation: ctx.profilesSupported ? undefined : "Switch to a supported deployment profile",
      checkedAt: now,
    });

    // 9. Certification
    diagnostics.push({
      id: "diag.certification.assessment",
      category: "certification",
      name: "Security Assessment Status",
      status: "warn", // Always warn unless external assessment is done.
      detail: "No external security assessment has been completed",
      recommendation: "Schedule independent security assessment for certification readiness",
      checkedAt: now,
    });

    const failCount = diagnostics.filter(d => d.status === "fail").length;
    const warnCount = diagnostics.filter(d => d.status === "warn").length;

    let overall: OperationalHealth["overall"];
    if (failCount > 0) overall = "degraded";
    else if (warnCount > 3) overall = "unhealthy";
    else overall = "healthy";

    const report: DiagnosticReport = {
      runAt: now,
      overallHealth: overall,
      diagnostics,
      failCount,
      warnCount,
      summary: `Diagnostics complete: ${diagnostics.length - failCount - warnCount} passed, ${warnCount} warnings, ${failCount} failures`,
    };

    this.reports.push(report);
    this.deps.audit?.("diagnostics.run", { reportAt: now, overall, failCount, warnCount });

    return report;
  }

  // ── Quick Checks ─────────────────────────────────────────────────────

  /** Run a single category check. */
  runCategoryCheck(category: DiagnosticCategory, ctx: DiagnosticContext): EnterpriseDiagnostic[] {
    const report = this.runDiagnostics(ctx);
    return report.diagnostics.filter(d => d.category === category);
  }

  // ── Reports ──────────────────────────────────────────────────────────

  /** Get the latest diagnostic report. */
  getLatestReport(): DiagnosticReport | undefined {
    return this.reports[this.reports.length - 1];
  }

  /** List all diagnostic reports. */
  listReports(): DiagnosticReport[] {
    return [...this.reports];
  }

  /** Get diagnostic by category from the latest report. */
  getDiagnosticsByCategory(category: DiagnosticCategory): EnterpriseDiagnostic[] {
    const latest = this.getLatestReport();
    if (!latest) return [];
    return latest.diagnostics.filter(d => d.category === category);
  }

  /** Quick health check — are all critical diagnostics passing? */
  quickHealthCheck(ctx: DiagnosticContext): { healthy: boolean; criticalFailures: string[] } {
    const criticalFailures: string[] = [];
    if (!ctx.securityPoliciesActive) criticalFailures.push("security_policies_inactive");
    if (!ctx.auditIntegrityOk) criticalFailures.push("audit_integrity_failed");
    if (!ctx.workersHealthy) criticalFailures.push("workers_unhealthy");
    if (ctx.activeIncidents > 3) criticalFailures.push("too_many_incidents");

    return {
      healthy: criticalFailures.length === 0,
      criticalFailures,
    };
  }
}
