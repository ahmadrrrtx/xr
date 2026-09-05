/**
 * XR 6.1 — Audit retention schedules and legal hold.
 *
 * Key behavior (roadmap §6.3 "deletion/retention conflict handling"):
 *   - A retention schedule says when records are archived/deleted.
 *   - A legal hold BLOCKS deletion for its scope, and the block is reported as
 *     an explicit conflict, never as a silent skip.
 *   - Every run supports `dryRun` so operators can preview before destroying.
 */

import { randomUUID } from "node:crypto";
import type {
  AuditEventClass,
  AuditRecord,
  LegalHold,
  RetentionAction,
  RetentionEvaluation,
  RetentionRunResult,
  RetentionSchedule,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sensible defaults — long enough for investigation, short enough to be honest. */
export const DEFAULT_RETENTION_DAYS: Readonly<Record<AuditEventClass, number>> = Object.freeze({
  security: 730,
  incident: 730,
  authority: 365,
  policy: 365,
  administration: 365,
  supply_chain: 365,
  data_access: 180,
  recovery: 180,
  execution: 90,
  system: 90,
});

export function defaultRetentionSchedule(params: {
  createdBy: string;
  organizationId?: string;
  workspaceId?: string;
  now?: number;
}): RetentionSchedule {
  const now = params.now ?? Date.now();
  return {
    scheduleId: id("ret"),
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    rules: (Object.keys(DEFAULT_RETENTION_DAYS) as AuditEventClass[]).map((eventClass) => ({
      eventClass,
      retainDays: DEFAULT_RETENTION_DAYS[eventClass],
      archiveAfterDays: Math.floor(DEFAULT_RETENTION_DAYS[eventClass] / 2),
      deleteOnExpiry: true,
    })),
    createdBy: params.createdBy,
    createdAt: now,
    version: 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Retention service
// ═══════════════════════════════════════════════════════════════════════════

export interface RetentionServiceDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** Called for records that should actually be deleted. Omit for dry-run-only use. */
  readonly deleteRecords?: (recordIds: readonly string[]) => void;
  readonly archiveRecords?: (recordIds: readonly string[]) => void;
}

export class RetentionService {
  private readonly schedules = new Map<string, RetentionSchedule>();
  private readonly holds = new Map<string, LegalHold>();
  private readonly deps: RetentionServiceDeps;

  constructor(deps: RetentionServiceDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ── Schedules ────────────────────────────────────────────────────────────

  setSchedule(schedule: RetentionSchedule): RetentionSchedule {
    const existing = this.scheduleFor(schedule.organizationId, schedule.workspaceId);
    const next: RetentionSchedule = existing
      ? { ...schedule, version: existing.version + 1 }
      : schedule;
    this.schedules.set(next.scheduleId, next);
    if (existing && existing.scheduleId !== next.scheduleId) this.schedules.delete(existing.scheduleId);
    this.deps.audit?.("enterprise.audit.retention.schedule_set", {
      scheduleId: next.scheduleId,
      organizationId: next.organizationId,
      workspaceId: next.workspaceId,
      version: next.version,
      rules: next.rules.length,
      createdBy: next.createdBy,
    });
    return next;
  }

  scheduleFor(organizationId?: string, workspaceId?: string): RetentionSchedule | undefined {
    // Most specific match first.
    const all = [...this.schedules.values()];
    return (
      all.find((s) => s.organizationId === organizationId && s.workspaceId === workspaceId) ??
      all.find((s) => s.organizationId === organizationId && s.workspaceId === undefined) ??
      all.find((s) => s.organizationId === undefined && s.workspaceId === undefined)
    );
  }

  listSchedules(): readonly RetentionSchedule[] {
    return [...this.schedules.values()];
  }

  // ── Legal hold ───────────────────────────────────────────────────────────

  placeHold(params: {
    reason: string;
    placedBy: string;
    organizationId?: string;
    workspaceId?: string;
    eventClasses?: readonly AuditEventClass[];
    fromAt?: number;
    toAt?: number;
  }): LegalHold {
    const now = this.now();
    const hold: LegalHold = {
      holdId: id("hold"),
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      reason: params.reason,
      placedBy: params.placedBy,
      placedAt: now,
      active: true,
      eventClasses: params.eventClasses,
      fromAt: params.fromAt,
      toAt: params.toAt,
    };
    this.holds.set(hold.holdId, hold);
    this.deps.audit?.("enterprise.audit.retention.hold_placed", {
      holdId: hold.holdId,
      placedBy: hold.placedBy,
      reason: hold.reason,
      organizationId: hold.organizationId,
      workspaceId: hold.workspaceId,
      eventClasses: hold.eventClasses?.length ?? 0,
    });
    return hold;
  }

  releaseHold(holdId: string, releasedBy: string): { ok: boolean; error?: string } {
    const hold = this.holds.get(holdId);
    if (!hold) return { ok: false, error: `Legal hold not found: ${holdId}` };
    if (!hold.active) return { ok: false, error: `Legal hold ${holdId} is already released.` };
    const now = this.now();
    this.holds.set(holdId, { ...hold, active: false, releasedAt: now, releasedBy });
    this.deps.audit?.("enterprise.audit.retention.hold_released", { holdId, releasedBy });
    return { ok: true };
  }

  activeHolds(): readonly LegalHold[] {
    return [...this.holds.values()].filter((h) => h.active);
  }

  listHolds(): readonly LegalHold[] {
    return [...this.holds.values()].sort((a, b) => b.placedAt - a.placedAt);
  }

  /** Which active hold (if any) covers a record. */
  holdCovering(record: AuditRecord): LegalHold | undefined {
    return this.activeHolds().find((h) => {
      if (h.organizationId !== undefined && h.organizationId !== record.organizationId) return false;
      if (h.workspaceId !== undefined && h.workspaceId !== record.workspaceId) return false;
      if (h.eventClasses && !h.eventClasses.includes(record.eventClass)) return false;
      if (h.fromAt !== undefined && record.at < h.fromAt) return false;
      if (h.toAt !== undefined && record.at > h.toAt) return false;
      return true;
    });
  }

  // ── Evaluation ───────────────────────────────────────────────────────────

  /** Decide what should happen to one record. Pure. */
  evaluate(record: AuditRecord, schedule?: RetentionSchedule): RetentionEvaluation {
    const now = this.now();
    const ageDays = Math.floor((now - record.at) / DAY_MS);
    const effective = schedule ?? this.scheduleFor(record.organizationId, record.workspaceId);
    const rule = effective?.rules.find((r) => r.eventClass === record.eventClass);

    const hold = this.holdCovering(record);

    if (!rule) {
      return {
        recordId: record.recordId,
        sequence: record.sequence,
        action: "retain",
        ageDays,
        reason: "No retention rule for this event class — records are retained by default.",
        blockingHoldId: hold?.holdId,
      };
    }

    const expired = ageDays >= rule.retainDays;

    if (expired && rule.deleteOnExpiry) {
      if (hold) {
        // THE CONFLICT CASE: scheduled deletion vs active legal hold.
        return {
          recordId: record.recordId,
          sequence: record.sequence,
          action: "hold_blocked",
          ageDays,
          reason: `Retention expired at ${rule.retainDays}d but legal hold '${hold.holdId}' blocks deletion: ${hold.reason}`,
          blockingHoldId: hold.holdId,
        };
      }
      return {
        recordId: record.recordId,
        sequence: record.sequence,
        action: "delete",
        ageDays,
        reason: `Retention period of ${rule.retainDays} days elapsed.`,
      };
    }

    if (expired && !rule.deleteOnExpiry) {
      return {
        recordId: record.recordId,
        sequence: record.sequence,
        action: "archive",
        ageDays,
        reason: `Retention period elapsed; policy archives rather than deletes.`,
        blockingHoldId: hold?.holdId,
      };
    }

    if (rule.archiveAfterDays !== undefined && ageDays >= rule.archiveAfterDays) {
      return {
        recordId: record.recordId,
        sequence: record.sequence,
        action: "archive",
        ageDays,
        reason: `Older than archive threshold of ${rule.archiveAfterDays} days.`,
        blockingHoldId: hold?.holdId,
      };
    }

    return {
      recordId: record.recordId,
      sequence: record.sequence,
      action: "retain",
      ageDays,
      reason: `Within retention period (${ageDays}/${rule.retainDays} days).`,
      blockingHoldId: hold?.holdId,
    };
  }

  /**
   * Run retention over a record set.
   * `dryRun` (default true) never destroys anything.
   */
  run(records: readonly AuditRecord[], options: { dryRun?: boolean; actorId?: string } = {}): RetentionRunResult {
    const dryRun = options.dryRun ?? true;
    const now = this.now();
    const counts: Record<RetentionAction, number> = { retain: 0, archive: 0, delete: 0, hold_blocked: 0 };
    const conflicts: { recordId: string; holdId: string; detail: string }[] = [];
    const toDelete: string[] = [];
    const toArchive: string[] = [];

    for (const record of records) {
      const ev = this.evaluate(record);
      counts[ev.action]++;
      if (ev.action === "delete") toDelete.push(ev.recordId);
      if (ev.action === "archive") toArchive.push(ev.recordId);
      if (ev.action === "hold_blocked" && ev.blockingHoldId) {
        conflicts.push({ recordId: ev.recordId, holdId: ev.blockingHoldId, detail: ev.reason });
      }
    }

    if (!dryRun) {
      if (toArchive.length > 0) this.deps.archiveRecords?.(toArchive);
      if (toDelete.length > 0) this.deps.deleteRecords?.(toDelete);
    }

    const result: RetentionRunResult = {
      runId: id("rrun"),
      executedAt: now,
      evaluated: records.length,
      retained: counts.retain,
      archived: counts.archive,
      deleted: dryRun ? 0 : counts.delete,
      holdBlocked: counts.hold_blocked,
      conflicts,
      dryRun,
    };

    this.deps.audit?.("enterprise.audit.retention.run", {
      runId: result.runId,
      actorId: options.actorId,
      dryRun,
      evaluated: result.evaluated,
      wouldDelete: counts.delete,
      deleted: result.deleted,
      archived: result.archived,
      holdBlocked: result.holdBlocked,
      conflicts: conflicts.length,
    });

    return result;
  }
}
