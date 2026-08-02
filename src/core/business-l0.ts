/**
 * XR Phase 7 · T8 — Business OS thin L0 contract.
 *
 * Constitution Art. XVI + Part Eight: the kernel holds ONLY a thin
 * record/artifact/identity/audit contract for Business OS. No business
 * domain schema lives in the kernel; the extension (L5, packaged under
 * extensions/business-os) implements the domain on top of this contract.
 *
 * Contract surface (stable, versioned):
 *   - records     : durable business records (any module/entity) — CRUD
 *                   through the single-writer store, hash-chained audit
 *   - artifacts   : structured evidence/artifacts attached to records
 *   - identity    : actor identity (user/worker/system) resolution
 *   - audit       : append-only, tamper-evident audit events
 *
 * This module is L0: it imports ONLY the workspace store (also L0) and
 * never imports the extension. Versioned via BUSINESS_L0_VERSION; the
 * extension manifest declares which L0 version it targets.
 */
import type { Store } from "../state/workspace-store.ts";

export const BUSINESS_L0_VERSION = 1 as const;

export interface L0ActorIdentity {
  kind: "user" | "worker" | "system";
  id: string;
  label?: string;
}

export interface L0RecordRef {
  module: string;
  entity: string;
  entityId: string;
  workspaceId: string;
}

export interface L0RecordInput extends L0RecordRef {
  data: Record<string, unknown>;
  actor: L0ActorIdentity;
  reason?: string;
  evidenceRefs?: string[];
}

export interface L0Record {
  module: string;
  entity: string;
  entityId: string;
  workspaceId: string;
  version: number;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  createdBy: L0ActorIdentity;
  updatedBy: L0ActorIdentity;
  reason?: string;
  evidenceRefs: string[];
}

export interface L0ArtifactInput {
  module: string;
  entity: string;
  entityId: string;
  workspaceId: string;
  kind: string;
  content: string;
  actor: L0ActorIdentity;
  metadata?: Record<string, unknown>;
}

export interface L0Artifact {
  artifactId: string;
  module: string;
  entity: string;
  entityId: string;
  workspaceId: string;
  kind: string;
  content: string;
  actor: L0ActorIdentity;
  createdAt: number;
  metadata: Record<string, unknown>;
  /** sha256 of content (integrity). */
  contentHash: string;
}

export interface L0AuditEvent {
  at: number;
  actor: L0ActorIdentity;
  action: string;
  resource?: string;
  resourceId?: string;
  detail: Record<string, unknown>;
}

export interface BusinessL0 {
  readonly contractVersion: typeof BUSINESS_L0_VERSION;
  putRecord(input: L0RecordInput): L0Record;
  readRecord(ref: L0RecordRef): L0Record | null;
  queryRecords(ref: Omit<L0RecordRef, "entityId">, limit?: number): L0Record[];
  putArtifact(input: L0ArtifactInput): L0Artifact;
  readArtifact(artifactId: string): L0Artifact | null;
  artifactsFor(ref: L0RecordRef): L0Artifact[];
  identityFor(actor: L0ActorIdentity): L0ActorIdentity;
  audit(event: L0AuditEvent): void;
  auditSince(since: number, limit?: number): L0AuditEvent[];
}

const L0_TABLE = "xr_l0_records";
const L0_ARTIFACT_TABLE = "xr_l0_artifacts";

/**
 * L0 implementation over the existing single-writer workspace store.
 * All writes go through the store's write gate (one writer per db file,
 * Phase 1 invariant) and are appended to the hash-chained audit log.
 */
export class BusinessL0 implements BusinessL0 {
  readonly contractVersion: typeof BUSINESS_L0_VERSION = BUSINESS_L0_VERSION;

  constructor(private readonly store: Store) {}

  // LifecycleHook surface (the kernel registers this token with
  // lifecycle: true; these are no-ops — the contract is passive).
  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}

  putRecord(input: L0RecordInput): L0Record {
    const now = Date.now();
    const existing = this.readRecord(input);
    const version = (existing?.version ?? 0) + 1;
    const record: L0Record = {
      module: input.module,
      entity: input.entity,
      entityId: input.entityId,
      workspaceId: input.workspaceId,
      version,
      data: input.data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: existing?.createdBy ?? input.actor,
      updatedBy: input.actor,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs ?? existing?.evidenceRefs ?? [],
    };
    this.store.query(`INSERT OR REPLACE INTO ${L0_TABLE} (module, entity, entity_id, workspace_id, version, data, created_at, updated_at, created_by, updated_by, reason, evidence_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.module,
      record.entity,
      record.entityId,
      record.workspaceId,
      record.version,
      JSON.stringify(record.data),
      record.createdAt,
      record.updatedAt,
      JSON.stringify(record.createdBy),
      JSON.stringify(record.updatedBy),
      record.reason ?? null,
      JSON.stringify(record.evidenceRefs),
    );
    this.audit({
      at: now,
      actor: input.actor,
      action: `${input.module}.${input.entity}.write`,
      resource: `${input.module}:${input.entity}`,
      resourceId: input.entityId,
      detail: { version, workspaceId: input.workspaceId, reason: input.reason },
    });
    return record;
  }

  readRecord(ref: L0RecordRef): L0Record | null {
    const row = this.store.query(`SELECT * FROM ${L0_TABLE} WHERE module = ? AND entity = ? AND entity_id = ? AND workspace_id = ? LIMIT 1`).get(ref.module, ref.entity, ref.entityId, ref.workspaceId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  queryRecords(ref: Omit<L0RecordRef, "entityId">, limit = 100): L0Record[] {
    const rows = this.store.query(`SELECT * FROM ${L0_TABLE} WHERE module = ? AND entity = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT ?`).all(ref.module, ref.entity, ref.workspaceId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRecord(r));
  }

  putArtifact(input: L0ArtifactInput): L0Artifact {
    const { createHash, randomUUID } = require("node:crypto") as typeof import("node:crypto");
    const artifact: L0Artifact = {
      artifactId: `art_${randomUUID().slice(0, 12)}`,
      module: input.module,
      entity: input.entity,
      entityId: input.entityId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      content: input.content,
      actor: input.actor,
      createdAt: Date.now(),
      metadata: input.metadata ?? {},
      contentHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
    };
    this.store.query(`INSERT INTO ${L0_ARTIFACT_TABLE} (artifact_id, module, entity, entity_id, workspace_id, kind, content, actor, created_at, metadata, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      artifact.artifactId,
      artifact.module,
      artifact.entity,
      artifact.entityId,
      artifact.workspaceId,
      artifact.kind,
      artifact.content,
      JSON.stringify(artifact.actor),
      artifact.createdAt,
      JSON.stringify(artifact.metadata),
      artifact.contentHash,
    );
    return artifact;
  }

  readArtifact(artifactId: string): L0Artifact | null {
    const row = this.store.query(`SELECT * FROM ${L0_ARTIFACT_TABLE} WHERE artifact_id = ? LIMIT 1`).get(artifactId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToArtifact(row);
  }

  artifactsFor(ref: L0RecordRef): L0Artifact[] {
    const rows = this.store.query(`SELECT * FROM ${L0_ARTIFACT_TABLE} WHERE module = ? AND entity = ? AND entity_id = ? AND workspace_id = ? ORDER BY created_at DESC`).all(ref.module, ref.entity, ref.entityId, ref.workspaceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToArtifact(r));
  }

  identityFor(actor: L0ActorIdentity): L0ActorIdentity {
    // Identity is resolved by the extension (workers/users); the kernel
    // contract only normalizes the shape.
    return { kind: actor.kind, id: actor.id, label: actor.label };
  }

  audit(event: L0AuditEvent): void {
    this.store.audit(`l0.${event.action}`, {
      actor: `${event.actor.kind}:${event.actor.id}`,
      resource: event.resource,
      resourceId: event.resourceId,
      ...event.detail,
    });
  }

  auditSince(since: number, limit = 500): L0AuditEvent[] {
    // The workspace audit repo owns the authoritative log; L0 exposes a
    // filtered view for the extension's outcome trails.
    const rows = this.store.query("SELECT * FROM audit_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?").all(since, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      at: Number(r.created_at),
      actor: { kind: "system", id: String(r.actor_id ?? "unknown") },
      action: String(r.action),
      resource: String(r.resource ?? ""),
      resourceId: String(r.resource_id ?? ""),
      detail: {},
    }));
  }

  private rowToRecord(row: Record<string, unknown>): L0Record {
    return {
      module: String(row.module),
      entity: String(row.entity),
      entityId: String(row.entity_id),
      workspaceId: String(row.workspace_id),
      version: Number(row.version),
      data: JSON.parse(String(row.data)),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      createdBy: JSON.parse(String(row.created_by)),
      updatedBy: JSON.parse(String(row.updated_by)),
      reason: row.reason ? String(row.reason) : undefined,
      evidenceRefs: JSON.parse(String(row.evidence_refs ?? "[]")),
    };
  }

  private rowToArtifact(row: Record<string, unknown>): L0Artifact {
    return {
      artifactId: String(row.artifact_id),
      module: String(row.module),
      entity: String(row.entity),
      entityId: String(row.entity_id),
      workspaceId: String(row.workspace_id),
      kind: String(row.kind),
      content: String(row.content),
      actor: JSON.parse(String(row.actor)),
      createdAt: Number(row.created_at),
      metadata: JSON.parse(String(row.metadata ?? "{}")),
      contentHash: String(row.content_hash),
    };
  }
}

/** Loadable interface the kernel uses — the extension satisfies it. */
export interface BusinessOsExtension {
  readonly l0: BusinessL0;
  initialize(): Promise<void>;
  health(): { loaded: boolean; modules: string[]; verified: boolean; reason?: string };
  dispose(): Promise<void>;
}
