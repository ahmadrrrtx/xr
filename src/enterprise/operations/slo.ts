/**
 * XR 6.1 — Service Level Objectives.
 *
 * Roadmap §6.4: "Do not promise SLOs that cannot be measured."
 *
 * Every definition therefore declares:
 *   - `measurable`: whether XR has a real signal for it today
 *   - `source`: the concrete signal used
 *   - `unmeasurableReason`: what is missing, when it is not measurable
 *
 * When no samples exist, the report status is `unmeasurable` — never a
 * fabricated "meeting". An SLO that does not apply to the active deployment
 * profile reports `not_applicable`.
 */

import type { DeploymentProfileKind } from "../deployment/types.ts";
import {
  SLO_IDS,
  type SloDefinition,
  type SloId,
  type SloReport,
  type SloSample,
  type SloStatus,
} from "../types.ts";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const ALL_PROFILES: readonly DeploymentProfileKind[] = [
  "personal_local",
  "private_local_server",
  "team_private",
  "managed_cloud",
  "hybrid",
];

const MULTI_USER_PROFILES: readonly DeploymentProfileKind[] = [
  "team_private",
  "managed_cloud",
  "hybrid",
];

const REMOTE_PROFILES: readonly DeploymentProfileKind[] = [
  "private_local_server",
  "team_private",
  "managed_cloud",
  "hybrid",
];

/**
 * The SLO catalog.
 *
 * Each entry maps to an existing XR signal from Phases 2/4/9/11. Where XR
 * cannot yet measure something honestly, `measurable` is false and the reason
 * is stated rather than the objective being quietly published.
 */
export const SLO_CATALOG: Readonly<Record<SloId, SloDefinition>> = Object.freeze({
  runtime_availability: {
    id: "runtime_availability",
    name: "Runtime availability",
    description: "Fraction of health probes where the local runtime plane is reachable and serving.",
    unit: "ratio",
    objective: 0.995,
    windowMs: 30 * DAY,
    measurable: true,
    source: "deployment.PlaneStatus.reachable (local plane heartbeat)",
    appliesToProfiles: ALL_PROFILES,
  },
  task_completion: {
    id: "task_completion",
    name: "Task completion rate",
    description: "Fraction of started tasks that reach a terminal success state without operator intervention.",
    unit: "ratio",
    objective: 0.98,
    windowMs: 7 * DAY,
    measurable: true,
    source: "execution records (terminal state transitions)",
    appliesToProfiles: ALL_PROFILES,
  },
  task_recovery: {
    id: "task_recovery",
    name: "Task recovery rate",
    description: "Fraction of interrupted tasks successfully resumed from a checkpoint.",
    unit: "ratio",
    objective: 0.95,
    windowMs: 30 * DAY,
    measurable: true,
    source: "durable agency checkpoints/leases (Phase 4 recovery events)",
    appliesToProfiles: ALL_PROFILES,
  },
  approval_delivery: {
    id: "approval_delivery",
    name: "Approval delivery latency",
    description: "Time from approval request creation to it being delivered to an approver surface.",
    unit: "milliseconds",
    objective: 5000,
    windowMs: 7 * DAY,
    measurable: true,
    source: "business approval-escalation events",
    appliesToProfiles: ALL_PROFILES,
  },
  worker_health: {
    id: "worker_health",
    name: "Worker health",
    description: "Fraction of registered workers reporting healthy heartbeats.",
    unit: "ratio",
    objective: 0.99,
    windowMs: 7 * DAY,
    measurable: true,
    source: "deployment.WorkerHealthReport / WorkerHeartbeat",
    appliesToProfiles: REMOTE_PROFILES,
  },
  provider_routing_availability: {
    id: "provider_routing_availability",
    name: "Provider routing availability",
    description: "Fraction of routing attempts that found an eligible, reachable provider.",
    unit: "ratio",
    objective: 0.99,
    windowMs: 7 * DAY,
    measurable: true,
    source: "intelligence routing outcomes (provider selection success/failure)",
    appliesToProfiles: ALL_PROFILES,
  },
  backup_success: {
    id: "backup_success",
    name: "Backup success rate",
    description: "Fraction of scheduled backups that completed and passed verification.",
    unit: "ratio",
    objective: 0.99,
    windowMs: 30 * DAY,
    measurable: true,
    source: "enterprise.recovery BackupVerification records",
    appliesToProfiles: ALL_PROFILES,
  },
  audit_export: {
    id: "audit_export",
    name: "Audit export success rate",
    description: "Fraction of audit export requests that completed with a verified integrity manifest.",
    unit: "ratio",
    objective: 0.99,
    windowMs: 30 * DAY,
    measurable: true,
    source: "enterprise.audit AuditExportManifest.status",
    appliesToProfiles: ALL_PROFILES,
  },
  security_event_response: {
    id: "security_event_response",
    name: "Security event response time",
    description: "Time from incident detection to first containment action.",
    unit: "milliseconds",
    objective: 60 * MIN,
    windowMs: 90 * DAY,
    measurable: true,
    source: "enterprise.incidents (detectedAt → containedAt)",
    appliesToProfiles: ALL_PROFILES,
  },
  upgrade_rollback: {
    id: "upgrade_rollback",
    name: "Upgrade/rollback success rate",
    description: "Fraction of version upgrades and rollbacks that completed without manual repair.",
    unit: "ratio",
    objective: 0.99,
    windowMs: 180 * DAY,
    measurable: false,
    source: "release migration/rollback validation records",
    unmeasurableReason:
      "Upgrade telemetry is not collected from installed deployments by design (XR does not phone home). " +
      "This SLO is measurable only for locally recorded upgrades and is reported per-deployment, not fleet-wide.",
    appliesToProfiles: ALL_PROFILES,
  },
});

export function listSloDefinitions(): readonly SloDefinition[] {
  return SLO_IDS.map((id) => SLO_CATALOG[id]);
}

export function getSloDefinition(id: SloId): SloDefinition {
  return SLO_CATALOG[id];
}

// ═══════════════════════════════════════════════════════════════════════════
// SLI computation
// ═══════════════════════════════════════════════════════════════════════════

export interface SloComputeOptions {
  readonly now?: number;
  readonly profile?: DeploymentProfileKind;
  /** Fraction of the objective's allowed failure budget that triggers `at_risk`. */
  readonly atRiskBudgetThreshold?: number;
}

/**
 * Compute a report for one SLO from its samples.
 * Pure and deterministic.
 */
export function computeSlo(
  definition: SloDefinition,
  samples: readonly SloSample[],
  options: SloComputeOptions = {},
): SloReport {
  const now = options.now ?? Date.now();
  const windowStart = now - definition.windowMs;
  const windowEnd = now;

  // Profile applicability first — never report a number that does not apply.
  if (options.profile && !definition.appliesToProfiles.includes(options.profile)) {
    return {
      definition,
      status: "not_applicable",
      sampleCount: 0,
      windowStart,
      windowEnd,
      detail: `Not applicable to deployment profile '${options.profile}'.`,
    };
  }

  if (!definition.measurable) {
    return {
      definition,
      status: "unmeasurable",
      sampleCount: 0,
      windowStart,
      windowEnd,
      detail: definition.unmeasurableReason ?? "This objective cannot be measured from available signals.",
    };
  }

  const inWindow = samples.filter((s) => s.sloId === definition.id && s.at >= windowStart && s.at <= windowEnd);

  if (inWindow.length === 0) {
    return {
      definition,
      status: "unmeasurable",
      sampleCount: 0,
      windowStart,
      windowEnd,
      detail: `No samples in the ${Math.round(definition.windowMs / DAY)}-day window. Status is unknown, not assumed healthy.`,
    };
  }

  if (definition.unit === "milliseconds") {
    const values = inWindow.map((s) => s.valueMs ?? 0).filter((v) => v > 0);
    if (values.length === 0) {
      return {
        definition,
        status: "unmeasurable",
        sampleCount: inWindow.length,
        windowStart,
        windowEnd,
        detail: "Samples present but no latency values recorded.",
      };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    const status: SloStatus = p95 <= definition.objective ? "meeting" : p95 <= definition.objective * 1.25 ? "at_risk" : "breaching";
    return {
      definition,
      status,
      measured: p95,
      sampleCount: values.length,
      windowStart,
      windowEnd,
      detail: `p95 = ${Math.round(p95)}ms against an objective of ${definition.objective}ms.`,
    };
  }

  // Ratio SLO.
  const good = inWindow.reduce((acc, s) => acc + s.good, 0);
  const total = inWindow.reduce((acc, s) => acc + s.total, 0);
  if (total === 0) {
    return {
      definition,
      status: "unmeasurable",
      sampleCount: inWindow.length,
      windowStart,
      windowEnd,
      detail: "Samples present but the denominator is zero.",
    };
  }

  const ratio = good / total;
  const allowedFailure = 1 - definition.objective;
  const actualFailure = 1 - ratio;
  const errorBudgetRemaining =
    allowedFailure <= 0 ? (actualFailure <= 0 ? 1 : 0) : Math.max(0, Math.min(1, 1 - actualFailure / allowedFailure));

  const atRiskThreshold = options.atRiskBudgetThreshold ?? 0.25;
  const status: SloStatus =
    ratio >= definition.objective
      ? errorBudgetRemaining <= atRiskThreshold
        ? "at_risk"
        : "meeting"
      : "breaching";

  return {
    definition,
    status,
    measured: ratio,
    sampleCount: inWindow.length,
    windowStart,
    windowEnd,
    errorBudgetRemaining,
    detail: `${good}/${total} = ${(ratio * 100).toFixed(3)}% against an objective of ${(definition.objective * 100).toFixed(3)}%. Error budget remaining: ${(errorBudgetRemaining * 100).toFixed(1)}%.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SLO registry
// ═══════════════════════════════════════════════════════════════════════════

export interface SloRegistryDeps {
  readonly now?: () => number;
  readonly profile?: DeploymentProfileKind;
  /** Retain at most this many samples per SLO (bounded memory). */
  readonly maxSamplesPerSlo?: number;
}

export class SloRegistry {
  private readonly samples = new Map<SloId, SloSample[]>();
  private readonly deps: SloRegistryDeps;

  constructor(deps: SloRegistryDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Record a ratio observation. */
  observe(sloId: SloId, good: number, total: number, at?: number): void {
    this.push({ sloId, at: at ?? this.now(), good, total });
  }

  /** Record a latency observation. */
  observeLatency(sloId: SloId, valueMs: number, at?: number): void {
    this.push({ sloId, at: at ?? this.now(), good: 1, total: 1, valueMs });
  }

  /** Record a single success/failure. */
  observeOutcome(sloId: SloId, success: boolean, at?: number): void {
    this.push({ sloId, at: at ?? this.now(), good: success ? 1 : 0, total: 1 });
  }

  private push(sample: SloSample): void {
    const list = this.samples.get(sample.sloId) ?? [];
    list.push(sample);
    const cap = this.deps.maxSamplesPerSlo ?? 10_000;
    if (list.length > cap) list.splice(0, list.length - cap);
    this.samples.set(sample.sloId, list);
  }

  samplesFor(sloId: SloId): readonly SloSample[] {
    return this.samples.get(sloId) ?? [];
  }

  report(sloId: SloId, options: SloComputeOptions = {}): SloReport {
    return computeSlo(SLO_CATALOG[sloId], this.samplesFor(sloId), {
      profile: this.deps.profile,
      now: this.now(),
      ...options,
    });
  }

  reportAll(options: SloComputeOptions = {}): readonly SloReport[] {
    return SLO_IDS.map((id) => this.report(id, options));
  }

  /** SLOs currently breaching or at risk — the alerting surface. */
  breaching(options: SloComputeOptions = {}): readonly SloReport[] {
    return this.reportAll(options).filter((r) => r.status === "breaching" || r.status === "at_risk");
  }

  clear(): void {
    this.samples.clear();
  }
}
