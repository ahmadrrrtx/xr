/**
 * XR 6.1 — Verified Audit Export, Retention, and Redaction
 *
 * Provides controlled audit export with integrity verification, redaction,
 * retention schedules, legal hold support, and access controls.
 * Audit records remain tamper-evident and verifiable without exposing
 * unnecessary sensitive content.
 */

import { randomUUID, createHash } from "node:crypto";
import type {
  AuditEventClass,
  AuditExportRequest,
  AuditExportResult,
  AuditExportFormat,
  RedactionRule,
  RedactionStrategy,
  RetentionSchedule,
  LegalHold,
} from "./types.ts";
import { ENTERPRISE_BOUNDS } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Audit Export Service
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditExportDeps {
  /** Callback to retrieve audit records from the store. */
  retrieveRecords: (filter: {
    eventClasses?: AuditEventClass[];
    timeRange?: { start: number; end: number };
    workspaceFilter?: string[];
    limit?: number;
    offset?: number;
  }) => Promise<Array<Record<string, unknown>>>;
  /** Callback to count matching records. */
  countRecords: (filter: {
    eventClasses?: AuditEventClass[];
    timeRange?: { start: number; end: number };
    workspaceFilter?: string[];
  }) => Promise<number>;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class AuditExportService {
  private readonly exports = new Map<string, AuditExportResult>();
  private readonly schedules = new Map<string, RetentionSchedule>();
  private readonly legalHolds = new Map<string, LegalHold>();
  private readonly deps: AuditExportDeps;

  constructor(deps: AuditExportDeps) {
    this.deps = deps;

    // Register default retention schedules.
    for (const schedule of DEFAULT_RETENTION_SCHEDULES) {
      this.schedules.set(schedule.id, schedule);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────

  /**
   * Export audit records with redaction and integrity proofs.
   * The export is tamper-evident — integrity hash covers all records.
   */
  async exportAudit(request: AuditExportRequest): Promise<AuditExportResult> {
    const exportId = `export_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const startTime = Date.now();
    const warnings: string[] = [];

    // Count total matching records.
    const totalCount = await this.deps.countRecords({
      eventClasses: request.scopes,
      timeRange: request.timeRange,
      workspaceFilter: request.workspaceFilter,
    });

    if (totalCount > ENTERPRISE_BOUNDS.MAX_EXPORT_BATCH) {
      warnings.push(`Export capped at ${ENTERPRISE_BOUNDS.MAX_EXPORT_BATCH} records (total: ${totalCount})`);
    }

    // Retrieve records.
    const rawRecords = await this.deps.retrieveRecords({
      eventClasses: request.scopes,
      timeRange: request.timeRange,
      workspaceFilter: request.workspaceFilter,
      limit: ENTERPRISE_BOUNDS.MAX_EXPORT_BATCH,
      offset: 0,
    });

    // Apply redaction.
    let redactedCount = 0;
    const redactedRecords = rawRecords.map(record => {
      const redacted = this.applyRedaction(record, request.redactionRules);
      if (redacted !== record) redactedCount++;
      return redacted;
    });

    // Serialize based on format.
    const serialized = this.serializeRecords(redactedRecords, request.format);

    // Compute integrity hash.
    const integrityHash = createHash("sha256")
      .update(serialized)
      .digest("hex")
      .slice(0, 32);

    const result: AuditExportResult = {
      ok: true,
      exportId,
      recordCount: redactedRecords.length,
      format: request.format,
      sizeBytes: Buffer.byteLength(serialized, "utf-8"),
      integrityHash,
      redactionApplied: redactedCount,
      warnings,
    };

    this.exports.set(exportId, result);

    this.deps.audit?.("audit.exported", {
      exportId,
      requestedBy: request.requestedBy,
      scopes: request.scopes.length,
      recordCount: result.recordCount,
      redacted: redactedCount,
      format: request.format,
    });

    return result;
  }

  /** Get a previous export result. */
  getExport(exportId: string): AuditExportResult | undefined {
    return this.exports.get(exportId);
  }

  /** Verify the integrity of an exported audit bundle. */
  verifyIntegrity(exportId: string, data: string): { valid: boolean; hash?: string } {
    const result = this.exports.get(exportId);
    if (!result) return { valid: false };
    const computedHash = createHash("sha256").update(data).digest("hex").slice(0, 32);
    return { valid: computedHash === result.integrityHash, hash: computedHash };
  }

  // ── Redaction ────────────────────────────────────────────────────────

  /** Apply redaction rules to a record. Returns a new object (immutable). */
  applyRedaction(record: Record<string, unknown>, rules: readonly RedactionRule[]): Record<string, unknown> {
    const redacted = { ...record };
    for (const rule of rules) {
      if (rule.field in redacted) {
        redacted[rule.field] = this.redactValue(redacted[rule.field], rule.strategy, rule.pattern);
      }
      // Support nested fields with dot notation.
      const parts = rule.field.split(".");
      if (parts.length > 1) {
        let current: Record<string, unknown> = redacted;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof current[parts[i]] !== "object" || current[parts[i]] === null) break;
          current = current[parts[i]] as Record<string, unknown>;
        }
        const lastKey = parts[parts.length - 1];
        if (lastKey in current) {
          current[lastKey] = this.redactValue(current[lastKey], rule.strategy, rule.pattern);
        }
      }
    }
    return redacted;
  }

  private redactValue(value: unknown, strategy: RedactionStrategy, pattern?: string): unknown {
    if (value === null || value === undefined) return value;

    switch (strategy) {
      case "full_mask":
        return "****";
      case "partial_mask": {
        const str = String(value);
        if (str.length <= 4) return "****";
        return str.slice(0, 2) + "****" + str.slice(-2);
      }
      case "hash":
        return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
      case "remove":
        return undefined;
      case "tokenize": {
        // Replace with a stable token derived from the value.
        const token = createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
        return `TOKEN:${token}`;
      }
      default:
        return value;
    }
  }

  // ── Serialization ────────────────────────────────────────────────────

  private serializeRecords(records: Array<Record<string, unknown>>, format: AuditExportFormat): string {
    switch (format) {
      case "json":
        return JSON.stringify(records, null, 2);
      case "json_lines":
        return records.map(r => JSON.stringify(r)).join("\n");
      case "csv": {
        if (records.length === 0) return "";
        const headers = Object.keys(records[0]);
        const lines = [headers.join(",")];
        for (const record of records) {
          const values = headers.map(h => {
            const v = record[h];
            if (v === null || v === undefined) return "";
            const s = String(v).replace(/"/g, '""');
            return `"${s}"`;
          });
          lines.push(values.join(","));
        }
        return lines.join("\n");
      }
      case "signed_bundle":
        return JSON.stringify({
          version: 1,
          exportedAt: Date.now(),
          records,
          signature: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
        });
      default:
        return JSON.stringify(records);
    }
  }

  // ── Retention ────────────────────────────────────────────────────────

  /** Set a custom retention schedule. */
  setRetentionSchedule(schedule: RetentionSchedule): void {
    this.schedules.set(schedule.id, schedule);
    this.deps.audit?.("retention.schedule_set", {
      id: schedule.id,
      eventClass: schedule.eventClass,
      durationDays: schedule.durationDays,
    });
  }

  /** Get retention schedule for an event class. */
  getRetentionSchedule(eventClass: AuditEventClass): RetentionSchedule | undefined {
    return this.schedules.get(`retention.${eventClass}`);
  }

  /** List all retention schedules. */
  listRetentionSchedules(): RetentionSchedule[] {
    return Array.from(this.schedules.values());
  }

  /** Determine retention action for a record based on its age. */
  determineRetentionAction(
    eventClass: AuditEventClass,
    recordAgeDays: number,
    underLegalHold: boolean,
  ): "keep" | "archive" | "delete" | "anonymize" {
    if (underLegalHold) return "keep";

    const schedule = this.schedules.get(`retention.${eventClass}`);
    if (!schedule) return "keep"; // No schedule = keep indefinitely.

    if (recordAgeDays < schedule.durationDays) return "keep";
    if (recordAgeDays < schedule.durationDays + schedule.gracePeriodDays) return "archive";
    return schedule.action;
  }

  // ── Legal Hold ───────────────────────────────────────────────────────

  /** Place a legal hold on records. */
  placeLegalHold(hold: LegalHold): void {
    this.legalHolds.set(hold.id, hold);
    this.deps.audit?.("legal_hold.placed", {
      id: hold.id,
      reason: hold.reason,
      scope: hold.scope.length,
      by: hold.placedBy,
    });
  }

  /** Release a legal hold. */
  releaseLegalHold(id: string, releasedBy: string): boolean {
    const hold = this.legalHolds.get(id);
    if (!hold) return false;
    this.legalHolds.set(id, { ...hold, active: false });

    this.deps.audit?.("legal_hold.released", { id, by: releasedBy });
    return true;
  }

  /** List active legal holds. */
  listLegalHolds(activeOnly = true): LegalHold[] {
    const all = Array.from(this.legalHolds.values());
    return activeOnly ? all.filter(h => h.active) : all;
  }

  /** Check if records matching criteria are under legal hold. */
  isUnderLegalHold(eventClass: AuditEventClass, timestamp: number, workspaceId?: string): boolean {
    for (const hold of this.legalHolds.values()) {
      if (!hold.active) continue;
      if (!hold.scope.includes(eventClass)) continue;
      if (hold.workspaceFilter && workspaceId && !hold.workspaceFilter.includes(workspaceId)) continue;
      if (hold.timeRange && (timestamp < hold.timeRange.start || timestamp > hold.timeRange.end)) continue;
      return true;
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Retention Schedules
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_RETENTION_SCHEDULES: readonly RetentionSchedule[] = [
  {
    id: "retention.execution",
    eventClass: "execution",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.policy_decision",
    eventClass: "policy_decision",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.identity",
    eventClass: "identity",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.authority",
    eventClass: "authority",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.capability_lifecycle",
    eventClass: "capability_lifecycle",
    durationDays: 180,
    gracePeriodDays: 30,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.data_access",
    eventClass: "data_access",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.credential",
    eventClass: "credential",
    durationDays: 365,
    gracePeriodDays: 15,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.network",
    eventClass: "network",
    durationDays: 90,
    gracePeriodDays: 15,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.incident",
    eventClass: "incident",
    durationDays: 2555, // 7 years
    gracePeriodDays: 90,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.backup",
    eventClass: "backup",
    durationDays: 365,
    gracePeriodDays: 30,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.deployment",
    eventClass: "deployment",
    durationDays: 180,
    gracePeriodDays: 30,
    action: "delete",
    legalHoldOverride: true,
  },
  {
    id: "retention.release",
    eventClass: "release",
    durationDays: 730, // 2 years
    gracePeriodDays: 90,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.governance",
    eventClass: "governance",
    durationDays: 2555, // 7 years
    gracePeriodDays: 90,
    action: "archive",
    legalHoldOverride: true,
  },
  {
    id: "retention.security",
    eventClass: "security",
    durationDays: 2555, // 7 years
    gracePeriodDays: 90,
    action: "archive",
    legalHoldOverride: true,
  },
];
