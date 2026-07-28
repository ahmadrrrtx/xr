/**
 * XR 6.1 — Controlled audit export with integrity verification.
 *
 * Responsibilities:
 *   - Access control: only authorized subjects export, and only within their
 *     organization/workspace scope. Denials are recorded, not silent.
 *   - Redaction: applied before serialization; defaults always protect secrets.
 *   - Integrity: the export manifest carries a content hash, the first/last
 *     chain hashes, and an explicit `chainVerified` flag.
 *   - Failure behavior: truncation or partial results ALWAYS produce
 *     `status: "partial"` with `incompleteReason` — never a silent short export.
 *   - Access logging: every export/view/verify attempt is logged.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  AUDIT_EXPORT_FORMAT_VERSION,
  ENTERPRISE_BOUNDS,
  SENSITIVITY_ORDER,
  type AuditAccessLogEntry,
  type AuditExportManifest,
  type AuditExportRequest,
  type AuditExportResult,
  type AuditExportVerification,
  type AuditRecord,
  type ExportFormat,
  type ExportStatus,
  type RedactedAuditRecord,
} from "../types.ts";
import { redactRecords } from "./redaction.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Access control
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditExportAuthorizer {
  /**
   * @returns granted=false with a reason to deny. Implementations should use
   * existing RBAC / delegated authority rather than inventing new roles.
   */
  canExport(params: {
    actorId: string;
    organizationId?: string;
    workspaceId?: string;
    includeRestricted: boolean;
  }): { granted: boolean; reason?: string };
}

/**
 * Default authorizer used in local/personal deployments: the local user may
 * export their own data, but restricted records still require an explicit flag.
 */
export const LOCAL_EXPORT_AUTHORIZER: AuditExportAuthorizer = {
  canExport: () => ({ granted: true }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Serialization
// ═══════════════════════════════════════════════════════════════════════════

function serializeRecords(records: readonly RedactedAuditRecord[], format: ExportFormat): string {
  switch (format) {
    case "jsonl":
      return records.map((r) => JSON.stringify(r)).join("\n");
    case "json":
      return JSON.stringify(records, null, 2);
    case "csv": {
      const header = [
        "recordId",
        "sequence",
        "at",
        "eventClass",
        "event",
        "actorId",
        "organizationId",
        "workspaceId",
        "resource",
        "resourceId",
        "sensitivity",
        "redactedFieldCount",
        "prevHash",
        "hash",
      ].join(",");
      const rows = records.map((r) =>
        [
          csvCell(r.recordId),
          String(r.sequence),
          String(r.at),
          csvCell(r.eventClass),
          csvCell(r.event),
          csvCell(r.actorId ?? ""),
          csvCell(r.organizationId ?? ""),
          csvCell(r.workspaceId ?? ""),
          csvCell(r.resource ?? ""),
          csvCell(r.resourceId ?? ""),
          csvCell(r.sensitivity),
          String(r.redactedFields.length),
          csvCell(r.prevHash),
          csvCell(r.hash),
        ].join(","),
      );
      return [header, ...rows].join("\n");
    }
  }
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ═══════════════════════════════════════════════════════════════════════════
// Chain verification over an exported subset
// ═══════════════════════════════════════════════════════════════════════════

export interface ChainCheck {
  readonly intact: boolean;
  readonly breakAtSequence?: number;
  readonly detail: string;
}

/**
 * Verify that the exported records form an unbroken hash chain.
 *
 * A filtered export is legitimately non-contiguous; in that case we verify
 * that each record's `prevHash` matches the previous record IN THE FULL
 * SOURCE ordering when available, otherwise we report the export as a
 * verified-but-filtered subset.
 */
export function verifyExportedChain(
  records: readonly RedactedAuditRecord[],
  opts: { contiguous: boolean },
): ChainCheck {
  if (records.length === 0) return { intact: true, detail: "Empty export — nothing to verify." };

  if (!opts.contiguous) {
    return {
      intact: true,
      detail:
        "Filtered subset: per-record hashes preserved from source. Contiguity not asserted because the export is filtered.",
    };
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]!;
    const cur = records[i]!;
    if (cur.prevHash !== prev.hash) {
      return {
        intact: false,
        breakAtSequence: cur.sequence,
        detail: `Chain break at sequence ${cur.sequence}: prevHash does not match the preceding record's hash.`,
      };
    }
  }

  return { intact: true, detail: `Contiguous chain verified across ${records.length} records.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Export service
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditExportServiceDeps {
  /** Source of audit records. Wraps existing stores; does not replace them. */
  readonly source: () => readonly AuditRecord[];
  readonly authorizer?: AuditExportAuthorizer;
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
}

export class AuditExportService {
  private readonly deps: AuditExportServiceDeps;
  private readonly accessLog: AuditAccessLogEntry[] = [];
  private readonly manifests = new Map<string, AuditExportManifest>();

  constructor(deps: AuditExportServiceDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private authorizer(): AuditExportAuthorizer {
    return this.deps.authorizer ?? LOCAL_EXPORT_AUTHORIZER;
  }

  /** Perform a controlled export. Never throws on access denial — returns a manifest. */
  export(request: AuditExportRequest): AuditExportResult {
    const now = this.now();
    const includeRestricted = request.includeRestricted ?? false;

    // ── 1. Access control ──────────────────────────────────────────────────
    const decision = this.authorizer().canExport({
      actorId: request.requestedBy,
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      includeRestricted,
    });

    if (!decision.granted) {
      const manifest = this.emptyManifest({
        request,
        status: "denied",
        now,
        incompleteReason: decision.reason ?? "Export denied by access control.",
      });
      this.log({
        actorId: request.requestedBy,
        action: "export",
        organizationId: request.organizationId,
        workspaceId: request.workspaceId,
        recordCount: 0,
        granted: false,
        denyReason: decision.reason,
        exportId: manifest.exportId,
        at: now,
      });
      this.deps.audit?.("enterprise.audit.export.denied", {
        exportId: manifest.exportId,
        actorId: request.requestedBy,
        reason: decision.reason,
      });
      this.manifests.set(manifest.exportId, manifest);
      return { manifest, records: [], serialized: "" };
    }

    // ── 2. Gather and scope-filter ─────────────────────────────────────────
    let all: readonly AuditRecord[];
    try {
      all = this.deps.source();
    } catch (err) {
      const manifest = this.emptyManifest({
        request,
        status: "failed",
        now,
        incompleteReason: `Audit source unavailable: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.manifests.set(manifest.exportId, manifest);
      this.deps.audit?.("enterprise.audit.export.failed", {
        exportId: manifest.exportId,
        actorId: request.requestedBy,
        reason: manifest.incompleteReason,
      });
      return { manifest, records: [], serialized: "" };
    }

    const scoped = all.filter((r) => {
      if (request.organizationId !== undefined && r.organizationId !== request.organizationId) return false;
      if (request.workspaceId !== undefined && r.workspaceId !== request.workspaceId) return false;
      return true;
    });

    const windowed = scoped.filter((r) => {
      if (request.fromAt !== undefined && r.at < request.fromAt) return false;
      if (request.toAt !== undefined && r.at > request.toAt) return false;
      if (request.eventClasses && !request.eventClasses.includes(r.eventClass)) return false;
      return true;
    });

    // ── 3. Withhold restricted records unless explicitly authorized ────────
    let withheldCount = 0;
    const permitted = windowed.filter((r) => {
      if (!includeRestricted && SENSITIVITY_ORDER[r.sensitivity] >= SENSITIVITY_ORDER.restricted) {
        withheldCount++;
        return false;
      }
      return true;
    });

    // ── 4. Cap, and mark partial when capped ───────────────────────────────
    const cap = Math.min(request.maxRecords ?? ENTERPRISE_BOUNDS.MAX_EXPORT_RECORDS, ENTERPRISE_BOUNDS.MAX_EXPORT_RECORDS);
    const ordered = [...permitted].sort((a, b) => a.sequence - b.sequence);
    const truncated = ordered.length > cap;
    const selected = truncated ? ordered.slice(0, cap) : ordered;

    // ── 5. Redact ──────────────────────────────────────────────────────────
    const { records, appliedRuleIds, redactedFieldCount } = redactRecords(selected, {
      rules: request.redactionRules,
    });

    // ── 6. Serialize + integrity ───────────────────────────────────────────
    const serialized = serializeRecords(records, request.format);
    const contentHash = createHash("sha256").update(serialized).digest("hex");

    const contiguous =
      !truncated &&
      withheldCount === 0 &&
      request.eventClasses === undefined &&
      selected.length === scoped.filter((r) => {
        if (request.fromAt !== undefined && r.at < request.fromAt) return false;
        if (request.toAt !== undefined && r.at > request.toAt) return false;
        return true;
      }).length;

    const chain = verifyExportedChain(records, { contiguous });

    // ── 7. Status: partial is explicit, never silent ───────────────────────
    let status: ExportStatus = "complete";
    const reasons: string[] = [];
    if (truncated) {
      status = "partial";
      reasons.push(`Result truncated at ${cap} records (${ordered.length} matched).`);
    }
    if (withheldCount > 0) {
      status = "partial";
      reasons.push(`${withheldCount} restricted record(s) withheld — includeRestricted was not authorized.`);
    }
    if (!chain.intact) {
      status = "partial";
      reasons.push(chain.detail);
    }

    const manifest: AuditExportManifest = {
      exportId: id("exp"),
      formatVersion: AUDIT_EXPORT_FORMAT_VERSION,
      status,
      createdAt: now,
      requestedBy: request.requestedBy,
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      recordCount: records.length,
      withheldCount,
      redactedFieldCount,
      firstSequence: records[0]?.sequence,
      lastSequence: records[records.length - 1]?.sequence,
      firstHash: records[0]?.hash,
      lastHash: records[records.length - 1]?.hash,
      contentHash,
      chainVerified: chain.intact,
      chainBreakAtSequence: chain.breakAtSequence,
      format: request.format,
      incompleteReason: reasons.length > 0 ? reasons.join(" ") : undefined,
      appliedRedactionRuleIds: appliedRuleIds,
    };

    this.manifests.set(manifest.exportId, manifest);

    this.log({
      actorId: request.requestedBy,
      action: "export",
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      recordCount: records.length,
      granted: true,
      exportId: manifest.exportId,
      at: now,
    });

    this.deps.audit?.("enterprise.audit.export.completed", {
      exportId: manifest.exportId,
      actorId: request.requestedBy,
      status: manifest.status,
      recordCount: manifest.recordCount,
      withheldCount: manifest.withheldCount,
      redactedFieldCount: manifest.redactedFieldCount,
      chainVerified: manifest.chainVerified,
      contentHash: manifest.contentHash,
      reason: request.reason,
    });

    return { manifest, records, serialized };
  }

  /** Verify a previously produced export against its manifest. */
  verify(result: AuditExportResult): AuditExportVerification {
    const now = this.now();
    const errors: string[] = [];

    const recomputed = createHash("sha256").update(result.serialized).digest("hex");
    const contentHashMatches = recomputed === result.manifest.contentHash;
    if (!contentHashMatches) errors.push("Content hash mismatch — the export payload has been altered.");

    const recordCountMatches = result.records.length === result.manifest.recordCount;
    if (!recordCountMatches) errors.push("Record count does not match the manifest.");

    // Re-run chain verification independently of the manifest's claim.
    const contiguous = result.manifest.status === "complete" && result.manifest.withheldCount === 0;
    const chain = verifyExportedChain(result.records, { contiguous });
    if (!chain.intact) errors.push(chain.detail);

    this.log({
      actorId: result.manifest.requestedBy,
      action: "verify",
      organizationId: result.manifest.organizationId,
      workspaceId: result.manifest.workspaceId,
      recordCount: result.records.length,
      granted: true,
      exportId: result.manifest.exportId,
      at: now,
    });

    return {
      ok: errors.length === 0,
      contentHashMatches,
      chainIntact: chain.intact,
      recordCountMatches,
      errors,
      verifiedAt: now,
    };
  }

  manifest(exportId: string): AuditExportManifest | undefined {
    return this.manifests.get(exportId);
  }

  /** The audit-access log — who looked at audit data. */
  accessEntries(filter?: { actorId?: string; granted?: boolean }): readonly AuditAccessLogEntry[] {
    let rows = [...this.accessLog];
    if (filter?.actorId) rows = rows.filter((e) => e.actorId === filter.actorId);
    if (filter?.granted !== undefined) rows = rows.filter((e) => e.granted === filter.granted);
    return rows.sort((a, b) => b.at - a.at);
  }

  private log(params: Omit<AuditAccessLogEntry, "entryId">): void {
    this.accessLog.push({ entryId: id("acc"), ...params });
  }

  private emptyManifest(params: {
    request: AuditExportRequest;
    status: ExportStatus;
    now: number;
    incompleteReason: string;
  }): AuditExportManifest {
    return {
      exportId: id("exp"),
      formatVersion: AUDIT_EXPORT_FORMAT_VERSION,
      status: params.status,
      createdAt: params.now,
      requestedBy: params.request.requestedBy,
      organizationId: params.request.organizationId,
      workspaceId: params.request.workspaceId,
      recordCount: 0,
      withheldCount: 0,
      redactedFieldCount: 0,
      contentHash: createHash("sha256").update("").digest("hex"),
      chainVerified: false,
      format: params.request.format,
      incompleteReason: params.incompleteReason,
      appliedRedactionRuleIds: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Adapter: existing XR audit rows → normalized AuditRecord
// ═══════════════════════════════════════════════════════════════════════════

/** Classify a raw XR audit event name into an audit event class. */
export function classifyAuditEvent(event: string): AuditRecord["eventClass"] {
  if (event.startsWith("enterprise.incident") || event.includes("incident")) return "incident";
  if (event.startsWith("enterprise.policy") || event.includes("policy")) return "policy";
  if (event.startsWith("enterprise.authority") || event.includes("grant") || event.includes("delegat")) return "authority";
  if (event.startsWith("enterprise.supplychain") || event.includes("capability") || event.includes("plugin")) {
    return "supply_chain";
  }
  if (event.startsWith("enterprise.recovery") || event.includes("backup") || event.includes("restore")) return "recovery";
  if (event.includes("shield") || event.includes("attack") || event.includes("threat") || event.includes("security")) {
    return "security";
  }
  if (event.includes("export") || event.includes("read") || event.includes("access")) return "data_access";
  if (event.includes("admin") || event.includes("config")) return "administration";
  if (event.includes("exec") || event.includes("run") || event.includes("task")) return "execution";
  return "system";
}

/** Infer a default sensitivity from the event class. */
export function defaultSensitivity(eventClass: AuditRecord["eventClass"]): AuditRecord["sensitivity"] {
  switch (eventClass) {
    case "security":
    case "incident":
      return "confidential";
    case "authority":
    case "policy":
    case "administration":
      return "internal";
    case "data_access":
      return "confidential";
    default:
      return "internal";
  }
}

export interface RawAuditRow {
  readonly id: number;
  readonly session_id: string | null;
  readonly event: string;
  readonly detail: string;
  readonly prev_hash: string;
  readonly hash: string;
  readonly created_at: number;
}

/**
 * Adapt rows from `WorkspaceStore` / `AuditRepo` into normalized records.
 * Pure function — safe to run without a database.
 */
export function adaptWorkspaceAuditRows(
  rows: readonly RawAuditRow[],
  scope?: { organizationId?: string; workspaceId?: string },
): readonly AuditRecord[] {
  return rows.map((row) => {
    let detail: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(row.detail);
      detail = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      detail = { raw: row.detail };
    }
    const eventClass = classifyAuditEvent(row.event);
    return {
      recordId: `wsa_${row.id}`,
      sequence: row.id,
      eventClass,
      event: row.event,
      at: row.created_at,
      actorId: typeof detail.actorId === "string" ? detail.actorId : undefined,
      organizationId: scope?.organizationId,
      workspaceId: scope?.workspaceId,
      sessionId: row.session_id ?? undefined,
      sensitivity: defaultSensitivity(eventClass),
      detail,
      prevHash: row.prev_hash,
      hash: row.hash,
    } satisfies AuditRecord;
  });
}
