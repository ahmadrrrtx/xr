/**
 * XR 6.1 — Backup and Disaster Recovery Operations
 *
 * Extends Phase 11 backup service with enterprise DR operations:
 * backup schedules, verification, RPO/RTO targets, cross-deployment
 * restore, and partial restore behavior.
 */

import { randomUUID } from "node:crypto";
import type { BackupSchedule, DRPlan, DRProcedure, RestoreVerification, BackupComponentKind } from "./types.ts";
import { ENTERPRISE_BOUNDS } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Default DR Plans
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_DR_PLAN: DRPlan = {
  id: "dr.default",
  name: "Default DR Plan",
  rpoMinutes: 60,
  rtoMinutes: 240,
  procedures: [
    {
      step: 1,
      action: "Identify affected deployment and assess scope of failure",
      expectedDurationMinutes: 15,
      rollbackStep: "Re-enable primary deployment",
    },
    {
      step: 2,
      action: "Verify latest backup integrity and availability",
      expectedDurationMinutes: 15,
    },
    {
      step: 3,
      action: "Provision or access recovery environment",
      expectedDurationMinutes: 30,
    },
    {
      step: 4,
      action: "Restore workspace state, workflows, and execution records",
      expectedDurationMinutes: 60,
    },
    {
      step: 5,
      action: "Restore audit and policy records",
      expectedDurationMinutes: 30,
    },
    {
      step: 6,
      action: "Verify restored data integrity and task resumability",
      expectedDurationMinutes: 30,
    },
    {
      step: 7,
      action: "Re-enable workers and resume operations",
      expectedDurationMinutes: 30,
    },
    {
      step: 8,
      action: "Notify stakeholders and document recovery",
      expectedDurationMinutes: 15,
    },
  ],
};

export const BUSINESS_CRITICAL_DR_PLAN: DRPlan = {
  id: "dr.business_critical",
  name: "Business Critical DR Plan",
  rpoMinutes: 15,
  rtoMinutes: 60,
  procedures: [
    { step: 1, action: "Activate DR site / standby deployment", expectedDurationMinutes: 5 },
    { step: 2, action: "Verify latest backup (max 15 min old)", expectedDurationMinutes: 5 },
    { step: 3, action: "Restore mission-critical workspace and workflow state", expectedDurationMinutes: 20 },
    { step: 4, action: "Verify integrity and task continuity", expectedDurationMinutes: 10 },
    { step: 5, action: "Switch DNS/routing to DR environment", expectedDurationMinutes: 10 },
    { step: 6, action: "Notify incident team and stakeholders", expectedDurationMinutes: 5 },
    { step: 7, action: "Begin root cause analysis on primary failure", expectedDurationMinutes: 5 },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Backup DR Service
// ═══════════════════════════════════════════════════════════════════════════

export interface BackupDRDeps {
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class BackupDRService {
  private readonly schedules = new Map<string, BackupSchedule>();
  private readonly drPlans = new Map<string, DRPlan>();
  private readonly verifications = new Map<string, RestoreVerification[]>();
  private readonly deps: BackupDRDeps;

  constructor(deps: BackupDRDeps = {}) {
    this.deps = deps;
    this.drPlans.set(DEFAULT_DR_PLAN.id, DEFAULT_DR_PLAN);
    this.drPlans.set(BUSINESS_CRITICAL_DR_PLAN.id, BUSINESS_CRITICAL_DR_PLAN);
  }

  // ── Backup Schedules ─────────────────────────────────────────────────

  /** Create a backup schedule. */
  createSchedule(params: {
    scope: BackupSchedule["scope"];
    frequencyMinutes: number;
    retentionCount: number;
    encrypted?: boolean;
    components?: BackupComponentKind[];
    verifyAfterCreate?: boolean;
  }): BackupSchedule {
    const schedule: BackupSchedule = {
      id: `bs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      scope: params.scope,
      frequencyMinutes: params.frequencyMinutes,
      retentionCount: Math.min(params.retentionCount, ENTERPRISE_BOUNDS.MAX_BACKUP_RETENTION),
      encrypted: params.encrypted ?? false,
      components: params.components ?? [
        "execution_records", "workflow_states", "audit_records",
        "workspace_config", "memory_records", "policy_records",
      ],
      verifyAfterCreate: params.verifyAfterCreate ?? true,
      enabled: true,
    };

    this.schedules.set(schedule.id, schedule);
    this.deps.audit?.("backup.schedule_created", {
      id: schedule.id,
      scope: schedule.scope,
      frequencyMinutes: schedule.frequencyMinutes,
    });

    return schedule;
  }

  /** Enable or disable a backup schedule. */
  setScheduleEnabled(scheduleId: string, enabled: boolean): boolean {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) return false;
    this.schedules.set(scheduleId, { ...schedule, enabled });
    this.deps.audit?.("backup.schedule_toggled", { id: scheduleId, enabled });
    return true;
  }

  /** Get a backup schedule. */
  getSchedule(scheduleId: string): BackupSchedule | undefined {
    return this.schedules.get(scheduleId);
  }

  /** List all backup schedules. */
  listSchedules(enabledOnly = false): BackupSchedule[] {
    const all = Array.from(this.schedules.values());
    return enabledOnly ? all.filter(s => s.enabled) : all;
  }

  /** Remove a backup schedule. */
  removeSchedule(scheduleId: string): boolean {
    const deleted = this.schedules.delete(scheduleId);
    if (deleted) {
      this.deps.audit?.("backup.schedule_removed", { id: scheduleId });
    }
    return deleted;
  }

  // ── DR Plans ─────────────────────────────────────────────────────────

  /** Register a DR plan. */
  registerDRPlan(plan: DRPlan): void {
    this.drPlans.set(plan.id, plan);
    this.deps.audit?.("dr.plan_registered", {
      id: plan.id,
      rpoMinutes: plan.rpoMinutes,
      rtoMinutes: plan.rtoMinutes,
    });
  }

  /** Get a DR plan. */
  getDRPlan(id: string): DRPlan | undefined {
    return this.drPlans.get(id);
  }

  /** List all DR plans. */
  listDRPlans(): DRPlan[] {
    return Array.from(this.drPlans.values());
  }

  /** Record a DR test result. */
  recordDRTest(planId: string, result: "pass" | "fail" | "partial", testedBy: string): boolean {
    const plan = this.drPlans.get(planId);
    if (!plan) return false;

    this.drPlans.set(planId, {
      ...plan,
      lastTestedAt: Date.now(),
      testResult: result,
      verifiedAt: Date.now(),
    });

    this.deps.audit?.("dr.test_recorded", { planId, result, by: testedBy });
    return true;
  }

  /** Get RPO/RTO status for a plan. */
  getRPORTOStatus(planId: string): {
    plan: DRPlan;
    rpoAchievable: boolean;
    rtoAchievable: boolean;
  } | undefined {
    const plan = this.drPlans.get(planId);
    if (!plan) return undefined;

    return {
      plan,
      rpoAchievable: plan.lastTestedAt ? (Date.now() - plan.lastTestedAt) / 60_000 <= plan.rpoMinutes : false,
      rtoAchievable: plan.testResult === "pass",
    };
  }

  // ── Verification ─────────────────────────────────────────────────────

  /** Record a backup restore verification. */
  recordVerification(backupId: string, result: "pass" | "fail" | "partial", details: string[]): RestoreVerification {
    const verification: RestoreVerification = {
      id: `rv_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      backupId,
      verifiedAt: Date.now(),
      result,
      checksRun: details.length,
      checksPassed: result === "pass" ? details.length : details.filter(d => !d.startsWith("FAIL:")).length,
      details,
    };

    const existing = this.verifications.get(backupId) ?? [];
    existing.push(verification);
    this.verifications.set(backupId, existing);

    this.deps.audit?.("backup.verification_recorded", {
      backupId,
      result,
      checksPassed: verification.checksPassed,
      checksRun: verification.checksRun,
    });

    return verification;
  }

  /** Get verifications for a backup. */
  getVerifications(backupId: string): RestoreVerification[] {
    return this.verifications.get(backupId) ?? [];
  }

  /** Get the latest verification result for a backup. */
  getLatestVerification(backupId: string): RestoreVerification | undefined {
    const verifications = this.verifications.get(backupId) ?? [];
    return verifications.sort((a, b) => b.verifiedAt - a.verifiedAt)[0];
  }

  /** Compute backup status for operational health. */
  computeBackupStatus(latestBackupTimestamp?: number): "ok" | "stale" | "failed" | "none" {
    if (!latestBackupTimestamp) return "none";

    // Check if any enabled schedules are overdue.
    const enabledSchedules = this.listSchedules(true);
    if (enabledSchedules.length === 0) {
      return Date.now() - latestBackupTimestamp > 7 * 24 * 60 * 60 * 1000 ? "stale" : "ok";
    }

    const maxFrequency = Math.max(...enabledSchedules.map(s => s.frequencyMinutes));
    const staleThreshold = maxFrequency * 2 * 60 * 1000; // 2x the slowest schedule.

    if (Date.now() - latestBackupTimestamp > staleThreshold) {
      return "stale";
    }

    return "ok";
  }
}
