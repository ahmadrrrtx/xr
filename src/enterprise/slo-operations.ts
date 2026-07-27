// v6.1.0-fix
/**
 * XR 6.1 — SLOs and Operational Metrics
 *
 * Defines and measures Service Level Objectives for runtime availability,
 * task completion/recovery, approval delivery, worker health, provider
 * routing, backup success, audit export, security event detection/response,
 * and upgrade/rollback. Does not promise SLOs that cannot be measured.
 */

import type {
  ServiceLevelObjective,
  SLOStatus,
  SLODataPoint,
  SLOMetric,
  OperationalHealth,
} from "./types.ts";
import { ENTERPRISE_BOUNDS } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Default SLO Definitions
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_SLOS: readonly ServiceLevelObjective[] = [
  {
    id: "slo.runtime.availability",
    name: "Runtime Availability",
    description: "Percentage of time the runtime is operational and responding to tasks",
    metric: "runtime.availability",
    target: { kind: "minimum", value: 99.5, unit: "percent" },
    window: { durationMs: 7 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 60_000, minimumSamples: 100 },
    severity: "critical",
    enabled: false, // Disabled by default — enable per deployment.
  },
  {
    id: "slo.task.completion",
    name: "Task Completion Rate",
    description: "Percentage of tasks that complete successfully within the timeout period",
    metric: "task.completion_rate",
    target: { kind: "minimum", value: 95, unit: "percent" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 50 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.task.recovery",
    name: "Task Recovery Rate",
    description: "Percentage of interrupted tasks that successfully recover and resume",
    metric: "task.recovery_rate",
    target: { kind: "minimum", value: 90, unit: "percent" },
    window: { durationMs: 7 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 20 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.approval.delivery",
    name: "Approval Delivery Time",
    description: "95th percentile time for approval requests to reach the intended approver",
    metric: "approval.delivery_time_ms",
    target: { kind: "percentile", value: 30000, percentile: 95, unit: "ms" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 10 },
    severity: "medium",
    enabled: false,
  },
  {
    id: "slo.worker.health",
    name: "Worker Health",
    description: "Percentage of workers reporting healthy status",
    metric: "worker.health",
    target: { kind: "minimum", value: 95, unit: "percent" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 60_000, minimumSamples: 10 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.provider.routing",
    name: "Provider Routing Availability",
    description: "Percentage of routing requests that find a healthy, policy-compliant provider",
    metric: "provider.routing.availability",
    target: { kind: "minimum", value: 99, unit: "percent" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 50 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.backup.success",
    name: "Backup Success Rate",
    description: "Percentage of scheduled backups that complete successfully",
    metric: "backup.success_rate",
    target: { kind: "minimum", value: 99, unit: "percent" },
    window: { durationMs: 7 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 3600_000, minimumSamples: 5 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.audit.export",
    name: "Audit Export Availability",
    description: "Percentage of audit export requests that succeed within the timeout",
    metric: "audit.export.availability",
    target: { kind: "minimum", value: 99, unit: "percent" },
    window: { durationMs: 30 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 3600_000, minimumSamples: 10 },
    severity: "medium",
    enabled: false,
  },
  {
    id: "slo.security.detection",
    name: "Security Detection Time",
    description: "95th percentile time from security event to detection",
    metric: "security.detection_time_ms",
    target: { kind: "percentile", value: 300_000, percentile: 95, unit: "ms" },
    window: { durationMs: 30 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 3600_000, minimumSamples: 5 },
    severity: "critical",
    enabled: false,
  },
  {
    id: "slo.security.response",
    name: "Security Response Time",
    description: "95th percentile time from detection to containment",
    metric: "security.response_time_ms",
    target: { kind: "percentile", value: 900_000, percentile: 95, unit: "ms" },
    window: { durationMs: 30 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 3600_000, minimumSamples: 5 },
    severity: "critical",
    enabled: false,
  },
  {
    id: "slo.upgrade.success",
    name: "Upgrade Success Rate",
    description: "Percentage of version upgrades that complete successfully",
    metric: "upgrade.success_rate",
    target: { kind: "minimum", value: 98, unit: "percent" },
    window: { durationMs: 90 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 86400_000, minimumSamples: 3 },
    severity: "high",
    enabled: false,
  },
  {
    id: "slo.rollback.success",
    name: "Rollback Success Rate",
    description: "Percentage of rollbacks that complete successfully without data loss",
    metric: "rollback.success_rate",
    target: { kind: "minimum", value: 99, unit: "percent" },
    window: { durationMs: 90 * 24 * 60 * 60 * 1000, evaluationIntervalMs: 86400_000, minimumSamples: 2 },
    severity: "critical",
    enabled: false,
  },
  {
    id: "slo.sync.latency",
    name: "Sync Latency",
    description: "95th percentile sync latency between deployment planes",
    metric: "sync.latency_ms",
    target: { kind: "percentile", value: 5000, percentile: 95, unit: "ms" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 100 },
    severity: "medium",
    enabled: false,
  },
  {
    id: "slo.sync.conflict",
    name: "Sync Conflict Rate",
    description: "Percentage of sync operations that result in conflicts",
    metric: "sync.conflict_rate",
    target: { kind: "maximum", value: 1, unit: "percent" },
    window: { durationMs: 24 * 60 * 60 * 1000, evaluationIntervalMs: 300_000, minimumSamples: 100 },
    severity: "medium",
    enabled: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SLO Operations Service
// ═══════════════════════════════════════════════════════════════════════════

export interface SLOOperationsDeps {
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class SLOOperationsService {
  private readonly slos = new Map<string, ServiceLevelObjective>();
  private readonly dataPoints = new Map<string, SLODataPoint[]>();
  private readonly deps: SLOOperationsDeps;

  constructor(deps: SLOOperationsDeps = {}) {
    this.deps = deps;
    for (const slo of DEFAULT_SLOS) {
      this.slos.set(slo.id, slo);
    }
  }

  // ── SLO Management ───────────────────────────────────────────────────

  /** Enable or disable an SLO. */
  setEnabled(sloId: string, enabled: boolean): boolean {
    const slo = this.slos.get(sloId);
    if (!slo) return false;
    this.slos.set(sloId, { ...slo, enabled });
    this.deps.audit?.("slo.enabled_changed", { sloId, enabled });
    return true;
  }

  /** Get an SLO definition. */
  getSLO(sloId: string): ServiceLevelObjective | undefined {
    return this.slos.get(sloId);
  }

  /** List all SLOs. */
  listSLOs(enabledOnly = false): ServiceLevelObjective[] {
    const all = Array.from(this.slos.values());
    return enabledOnly ? all.filter(s => s.enabled) : all;
  }

  /** Register a custom SLO. */
  registerSLO(slo: ServiceLevelObjective): void {
    this.slos.set(slo.id, slo);
    this.deps.audit?.("slo.registered", { sloId: slo.id, metric: slo.metric });
  }

  // ── Data Points ──────────────────────────────────────────────────────

  /** Record a data point for an SLO metric. */
  recordDataPoint(metric: SLOMetric, value: number, label?: string): void {
    const point: SLODataPoint = {
      timestamp: Date.now(),
      value,
      label,
    };
    const existing = this.dataPoints.get(metric) ?? [];
    existing.push(point);

    // Enforce max history.
    while (existing.length > ENTERPRISE_BOUNDS.MAX_SLO_HISTORY) {
      existing.shift();
    }
    this.dataPoints.set(metric, existing);
  }

  /** Get data points for a metric within a time window. */
  getDataPoints(metric: SLOMetric, windowMs: number): SLODataPoint[] {
    const points = this.dataPoints.get(metric) ?? [];
    const cutoff = Date.now() - windowMs;
    return points.filter(p => p.timestamp >= cutoff);
  }

  // ── Evaluation ───────────────────────────────────────────────────────

  /** Evaluate a single SLO's current status. */
  evaluateSLO(sloId: string): SLOStatus | undefined {
    const slo = this.slos.get(sloId);
    if (!slo || !slo.enabled) return undefined;

    const points = this.getDataPoints(slo.metric, slo.window.durationMs);
    if (points.length < slo.window.minimumSamples) {
      return {
        slo,
        currentValue: 0,
        meetsTarget: true, // Not enough data to fail.
        trend: "stable",
        samples: points.length,
        lastEvaluatedAt: Date.now(),
        history: points,
      };
    }

    const currentValue = this.computeMetricValue(points, slo);
    const meetsTarget = this.checkTarget(currentValue, slo);
    const trend = this.computeTrend(points);

    return {
      slo,
      currentValue,
      meetsTarget,
      trend,
      samples: points.length,
      lastEvaluatedAt: Date.now(),
      history: points.slice(-20), // Return last 20 for display.
    };
  }

  /** Evaluate all enabled SLOs. */
  evaluateAll(): SLOStatus[] {
    const results: SLOStatus[] = [];
    for (const sloId of this.slos.keys()) {
      const status = this.evaluateSLO(sloId);
      if (status) results.push(status);
    }
    return results;
  }

  /** Build a comprehensive operational health summary. */
  getOperationalHealth(params: {
    activeIncidents?: number;
    unresolvedVulnerabilities?: number;
    backupStatus?: OperationalHealth["backupStatus"];
    workerPoolStatus?: OperationalHealth["workerPoolStatus"];
    syncStatus?: OperationalHealth["syncStatus"];
    lastBackupAt?: number;
  }): OperationalHealth {
    const sloStatuses = this.evaluateAll();
    const issues: string[] = [];

    // Determine overall SLO health.
    const failedCritical = sloStatuses.filter(s => !s.meetsTarget && s.slo.severity === "critical").length;
    const failedHigh = sloStatuses.filter(s => !s.meetsTarget && s.slo.severity === "high").length;
    const failedMedium = sloStatuses.filter(s => !s.meetsTarget && s.slo.severity === "medium").length;

    for (const s of sloStatuses) {
      if (!s.meetsTarget) {
        issues.push(`SLO "${s.slo.name}" is not meeting target (${s.currentValue} vs ${s.slo.target.value}${s.slo.target.unit})`);
      }
    }

    if (params.backupStatus === "failed") {
      issues.push("Last backup failed");
    }
    if (params.backupStatus === "stale") {
      issues.push("Backup is stale — no recent successful backup");
    }
    if (params.workerPoolStatus === "critical") {
      issues.push("Worker pool is in critical state");
    }
    if (params.syncStatus === "conflicted") {
      issues.push("Sync has unresolved conflicts");
    }

    let overall: OperationalHealth["overall"];
    if (failedCritical > 0 || params.backupStatus === "failed" || params.workerPoolStatus === "critical") {
      overall = "critical";
    } else if (failedHigh > 0 || params.backupStatus === "stale" || params.syncStatus === "conflicted") {
      overall = "degraded";
    } else if (failedMedium > 0 || params.syncStatus === "lagging") {
      overall = "unhealthy";
    } else {
      overall = "healthy";
    }

    return {
      overall,
      slos: sloStatuses,
      activeIncidents: params.activeIncidents ?? 0,
      unresolvedVulnerabilities: params.unresolvedVulnerabilities ?? 0,
      backupStatus: params.backupStatus ?? "none",
      workerPoolStatus: params.workerPoolStatus ?? "ok",
      syncStatus: params.syncStatus ?? "ok",
      lastBackupAt: params.lastBackupAt,
      issuesRequiringAttention: issues,
    };
  }

  // ── Internal Computation ─────────────────────────────────────────────

  private computeMetricValue(points: SLODataPoint[], slo: ServiceLevelObjective): number {
    const values = points.map(p => p.value);

    switch (slo.target.kind) {
      case "percentile": {
        const p = slo.target.percentile ?? 95;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
      }
      case "minimum":
        return Math.min(...values);
      case "maximum":
        return Math.max(...values);
      case "rate": {
        // Rate = percentage of points meeting the target.
        const meeting = values.filter(v => v >= slo.target.value).length;
        return (meeting / values.length) * 100;
      }
      default:
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
  }

  private checkTarget(value: number, slo: ServiceLevelObjective): boolean {
    switch (slo.target.kind) {
      case "minimum":
      case "rate":
        return value >= slo.target.value;
      case "maximum":
        return value <= slo.target.value;
      case "percentile":
        return value <= slo.target.value;
      default:
        return true;
    }
  }

  private computeTrend(points: SLODataPoint[]): "improving" | "stable" | "degrading" {
    if (points.length < 10) return "stable";
    const recent = points.slice(-10);
    const older = points.slice(-20, -10);
    if (older.length === 0) return "stable";

    const recentAvg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
    const olderAvg = older.reduce((s, p) => s + p.value, 0) / older.length;

    const change = ((recentAvg - olderAvg) / Math.abs(olderAvg || 1)) * 100;
    if (change > 5) return "improving";
    if (change < -5) return "degrading";
    return "stable";
  }
}
