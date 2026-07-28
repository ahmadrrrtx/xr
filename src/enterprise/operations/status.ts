/**
 * XR 6.1 — Aggregate operational status.
 *
 * Combines Phase 11 deployment health with Phase 12 SLOs, backup/recovery
 * state, security posture, and worker health into one view that a CLI,
 * dashboard, or daemon endpoint can render.
 *
 * Design notes:
 *   - Every input is optional. Under `personal_local` with nothing configured,
 *     this still produces a valid, honest status rather than failing.
 *   - "Unknown" is never rendered as "healthy".
 */

import type { DeploymentProfileKind, DeploymentStatus } from "../../deployment/types.ts";
import type {
  AlertCondition,
  AlertSeverity,
  Incident,
  OperationalStatus,
  RecoveryDrill,
  RecoveryTargetAssessment,
  SloReport,
} from "../types.ts";

export interface BuildStatusInput {
  readonly profile: DeploymentProfileKind;
  readonly now?: number;
  /** Phase 11 deployment status, when a deployment plane is configured. */
  readonly deployment?: DeploymentStatus;
  readonly sloReports?: readonly SloReport[];
  readonly incidents?: readonly Incident[];
  readonly backup?: {
    readonly lastBackupAt?: number;
    readonly lastVerifiedAt?: number;
    readonly successRate?: { good: number; total: number };
  };
  readonly recovery?: {
    readonly lastDrill?: RecoveryDrill;
    readonly lastRestoreAt?: number;
    readonly assessment?: RecoveryTargetAssessment;
  };
  readonly quarantinedCapabilities?: number;
  readonly revokedDelegations?: number;
  /** Extra conditions contributed by callers. */
  readonly extraAlerts?: readonly AlertCondition[];
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

/**
 * Build the aggregate operational status.
 * Pure function — deterministic given its inputs.
 */
export function buildOperationalStatus(input: BuildStatusInput): OperationalStatus {
  const now = input.now ?? Date.now();
  const alerts: AlertCondition[] = [];

  // ── Deployment health issues become alerts ───────────────────────────────
  if (input.deployment) {
    for (const issue of input.deployment.health.issues) {
      alerts.push({
        conditionId: `deployment.${issue.component}.${issue.since}`,
        severity: issue.severity,
        component: issue.component,
        message: issue.message,
        since: issue.since,
        remediation: issue.remediation,
      });
    }
  }

  // ── SLO breaches become alerts ───────────────────────────────────────────
  const slos = input.sloReports ?? [];
  for (const r of slos) {
    if (r.status === "breaching") {
      alerts.push({
        conditionId: `slo.${r.definition.id}.breaching`,
        severity: "error",
        component: `slo/${r.definition.id}`,
        message: `SLO '${r.definition.name}' is breaching: ${r.detail}`,
        since: r.windowStart,
        remediation: "Investigate the underlying signal and reduce error rate before the budget is exhausted.",
        sloId: r.definition.id,
      });
    } else if (r.status === "at_risk") {
      alerts.push({
        conditionId: `slo.${r.definition.id}.at_risk`,
        severity: "warning",
        component: `slo/${r.definition.id}`,
        message: `SLO '${r.definition.name}' is at risk: ${r.detail}`,
        since: r.windowStart,
        sloId: r.definition.id,
      });
    }
  }

  // ── Incidents ────────────────────────────────────────────────────────────
  const incidents = input.incidents ?? [];
  const open = incidents.filter((i) => i.state !== "resolved" && i.state !== "postmortem");
  const critical = open.filter((i) => i.severity === "critical");

  for (const i of critical) {
    alerts.push({
      conditionId: `incident.${i.incidentId}`,
      severity: "critical",
      component: `incident/${i.kind}`,
      message: `Critical incident open: ${i.title}`,
      since: i.detectedAt,
      remediation: "Contain, quarantine affected components, and preserve evidence.",
    });
  }

  const uncontained = open.filter((i) => i.state === "detected" && i.severity !== "low");
  for (const i of uncontained) {
    alerts.push({
      conditionId: `incident.${i.incidentId}.untriaged`,
      severity: i.severity === "critical" ? "critical" : "warning",
      component: `incident/${i.kind}`,
      message: `Incident '${i.title}' is detected but not yet triaged.`,
      since: i.detectedAt,
      remediation: "Triage and take a containment action.",
    });
  }

  // ── Backup ───────────────────────────────────────────────────────────────
  const rate = input.backup?.successRate;
  const successRate = rate && rate.total > 0 ? rate.good / rate.total : undefined;
  const backupHealthy =
    input.backup?.lastBackupAt !== undefined && (successRate === undefined || successRate >= 0.99);

  if (input.backup?.lastBackupAt === undefined) {
    alerts.push({
      conditionId: "backup.none",
      severity: "warning",
      component: "backup",
      message: "No backup has been recorded for this deployment.",
      since: now,
      remediation: "Run `xr enterprise backup verify` after configuring a backup, and schedule regular backups.",
    });
  } else if (successRate !== undefined && successRate < 0.99) {
    alerts.push({
      conditionId: "backup.failures",
      severity: "error",
      component: "backup",
      message: `Backup verification success rate is ${(successRate * 100).toFixed(1)}%.`,
      since: input.backup.lastBackupAt,
      remediation: "Inspect failed verifications; a backup that does not verify cannot be restored.",
    });
  }

  if (input.backup?.lastBackupAt !== undefined && input.backup.lastVerifiedAt === undefined) {
    alerts.push({
      conditionId: "backup.unverified",
      severity: "warning",
      component: "backup",
      message: "Backups exist but none has been verified.",
      since: input.backup.lastBackupAt,
      remediation: "An unverified backup is not a tested backup. Run a verification and a restore drill.",
    });
  }

  // ── Recovery ─────────────────────────────────────────────────────────────
  const assessment = input.recovery?.assessment ?? input.recovery?.lastDrill?.assessment;
  const meetingTargets =
    assessment === undefined
      ? undefined
      : assessment.rpoMet === undefined && assessment.rtoMet === undefined
        ? undefined
        : (assessment.rpoMet ?? true) && (assessment.rtoMet ?? true);

  if (input.recovery?.lastDrill === undefined) {
    alerts.push({
      conditionId: "recovery.no_drill",
      severity: "warning",
      component: "recovery",
      message: "No restore drill has been recorded.",
      since: now,
      remediation: "Run `xr enterprise recovery drill` to produce evidence that restore actually works.",
    });
  } else if (meetingTargets === false) {
    alerts.push({
      conditionId: "recovery.targets_missed",
      severity: "error",
      component: "recovery",
      message: `Recovery targets not met. ${assessment?.basis ?? ""}`,
      since: input.recovery.lastDrill.executedAt,
      remediation: "Increase backup frequency to improve RPO, or optimize restore to improve RTO.",
    });
  }

  // ── Workers ──────────────────────────────────────────────────────────────
  const workerSummaries = input.deployment?.workers ?? [];
  const healthyWorkers = workerSummaries.filter((w) => w.healthOk).length;
  const degradedWorkers = workerSummaries.length - healthyWorkers;
  if (degradedWorkers > 0) {
    alerts.push({
      conditionId: "workers.degraded",
      severity: degradedWorkers === workerSummaries.length ? "critical" : "warning",
      component: "workers",
      message: `${degradedWorkers} of ${workerSummaries.length} worker(s) are unhealthy.`,
      since: now,
      remediation: "Inspect worker heartbeats and restart or drain unhealthy workers.",
    });
  }

  // ── Extra alerts ─────────────────────────────────────────────────────────
  if (input.extraAlerts) alerts.push(...input.extraAlerts);

  // ── Overall ──────────────────────────────────────────────────────────────
  const worst = alerts.reduce<AlertSeverity>(
    (acc, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[acc] ? a.severity : acc),
    "info",
  );

  const deploymentOverall = input.deployment?.health.overall;
  let overall: OperationalStatus["overall"];
  if (deploymentOverall === "offline") overall = "offline";
  else if (worst === "critical" || deploymentOverall === "critical") overall = "critical";
  else if (worst === "error" || worst === "warning" || deploymentOverall === "degraded") overall = "degraded";
  else overall = "healthy";

  return {
    generatedAt: now,
    profile: input.profile,
    overall,
    slos,
    alerts: alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.since - b.since),
    backup: {
      lastBackupAt: input.backup?.lastBackupAt,
      lastVerifiedAt: input.backup?.lastVerifiedAt,
      successRate,
      healthy: backupHealthy,
    },
    recovery: {
      lastDrillAt: input.recovery?.lastDrill?.executedAt,
      lastRestoreAt: input.recovery?.lastRestoreAt,
      rpoTargetMinutes: assessment?.targets.rpoMinutes,
      rtoTargetMinutes: assessment?.targets.rtoMinutes,
      meetingTargets,
    },
    security: {
      openIncidents: open.length,
      criticalIncidents: critical.length,
      quarantinedCapabilities: input.quarantinedCapabilities ?? 0,
      revokedDelegations: input.revokedDelegations ?? 0,
    },
    workers: {
      total: workerSummaries.length,
      healthy: healthyWorkers,
      degraded: degradedWorkers,
    },
  };
}

/** Alerts at or above a severity, for a paging/notification integration. */
export function alertsAtOrAbove(
  status: OperationalStatus,
  minSeverity: AlertSeverity,
): readonly AlertCondition[] {
  return status.alerts.filter((a) => SEVERITY_RANK[a.severity] >= SEVERITY_RANK[minSeverity]);
}

/** One-line summary for the CLI header. */
export function summarizeStatus(status: OperationalStatus): string {
  const parts = [
    `overall=${status.overall}`,
    `alerts=${status.alerts.length}`,
    `incidents=${status.security.openIncidents}`,
  ];
  const measurable = status.slos.filter((s) => s.status !== "unmeasurable" && s.status !== "not_applicable");
  const meeting = measurable.filter((s) => s.status === "meeting").length;
  parts.push(`slos=${meeting}/${measurable.length} meeting`);
  return parts.join(" ");
}
