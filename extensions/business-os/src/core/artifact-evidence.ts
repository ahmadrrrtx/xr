/**
 * XR 5.3 — Artifacts and Evidence — Documents, Research, Meeting, Communication artifacts
 * Uses existing context/artifact/provenance contracts. No disconnected formats.
 *
 * Integrates with context/provenance/artifact contracts, workflow artifacts.
 */

import { createHash } from 'crypto';
import type { BusinessDatabase } from './database.ts';
import type { BusinessArtifact, EvidenceRef } from './operating-types.ts';

export interface ArtifactDeps {
  db: BusinessDatabase;
}

export class ArtifactEvidenceService {
  constructor(private deps: ArtifactDeps) {}

  /**
   * Create an artifact linked to workflow run, with provenance.
   */
  createArtifact(params: {
    workspaceId: string;
    orgId?: string;
    workflowRunId?: string;
    nodeId?: string;
    contract: BusinessArtifact['contract'];
    content: string; // raw content to hash and store reference
    location?: string; // file path if stored
    provenance: Omit<BusinessArtifact['provenance'], 'createdAt'>;
    linkedRecords?: Array<{ module: string; entity: string; id: string }>;
    sensitivity?: BusinessArtifact['sensitivity'];
  }): BusinessArtifact {
    const artifactId = `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const contentHash = createHash('sha256').update(params.content).digest('hex');
    const now = new Date().toISOString();
    const location = params.location ?? `memory://${artifactId}`;

    const artifact: BusinessArtifact = {
      artifactId,
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      workflowRunId: params.workflowRunId,
      nodeId: params.nodeId,
      contract: params.contract,
      location,
      contentHash,
      provenance: {
        ...params.provenance,
        createdAt: Date.now(),
      },
      linkedRecords: params.linkedRecords ?? [],
      sensitivity: params.sensitivity ?? 'internal',
      createdAt: now,
    };

    this.persistArtifact(artifact, params.content);
    return artifact;
  }

  /**
   * Link artifact to business record.
   */
  linkToRecord(artifactId: string, record: { module: string; entity: string; id: string }): void {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) return;
    if (!artifact.linkedRecords.some(r => r.id === record.id && r.entity === record.entity)) {
      artifact.linkedRecords.push(record);
      this.persistArtifact(artifact);
    }
  }

  /**
   * Get artifact.
   */
  getArtifact(artifactId: string): BusinessArtifact | null {
    try {
      const row = this.deps.db.prepare(`SELECT * FROM biz_artifacts WHERE artifact_id = ?`).get(artifactId) as any;
      if (!row) return null;
      return this.rowToArtifact(row);
    } catch {
      return null;
    }
  }

  listByWorkspace(workspaceId: string, opts?: { limit?: number; contractKind?: string }): BusinessArtifact[] {
    try {
      let sql = `SELECT * FROM biz_artifacts WHERE workspace_id = ?`;
      const vals: unknown[] = [workspaceId];
      if (opts?.contractKind) { sql += ` AND contract_kind = ?`; vals.push(opts.contractKind); }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      vals.push(opts?.limit ?? 50);
      const rows = this.deps.db.prepare(sql).all(...vals) as any[];
      return rows.map(r => this.rowToArtifact(r));
    } catch {
      return [];
    }
  }

  listByWorkflowRun(workflowRunId: string): BusinessArtifact[] {
    try {
      const rows = this.deps.db.prepare(`SELECT * FROM biz_artifacts WHERE workflow_run_id = ? ORDER BY created_at ASC`).all(workflowRunId) as any[];
      return rows.map(r => this.rowToArtifact(r));
    } catch {
      return [];
    }
  }

  /**
   * Evidence linkage: create evidence ref for storage.
   */
  createEvidenceRef(kind: EvidenceRef['kind'], id: string, content?: string): EvidenceRef {
    const ref: EvidenceRef = { kind, id };
    if (content) {
      ref.hash = createHash('sha256').update(content).digest('hex');
    }
    return ref;
  }

  /**
   * Verify artifact integrity via hash.
   */
  verifyArtifact(artifactId: string, content: string): boolean {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) return false;
    const hash = createHash('sha256').update(content).digest('hex');
    return hash === artifact.contentHash;
  }

  /**
   * Export provenance for audit.
   */
  getProvenance(artifactId: string): BusinessArtifact['provenance'] | null {
    const artifact = this.getArtifact(artifactId);
    return artifact?.provenance ?? null;
  }

  private persistArtifact(artifact: BusinessArtifact, content?: string): void {
    try {
      this.deps.db.prepare(`
        INSERT OR REPLACE INTO biz_artifacts
        (artifact_id, workspace_id, org_id, workflow_run_id, node_id, contract_kind, contract_name, location, content_hash, provenance, linked_records, sensitivity, content_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifact.artifactId,
        artifact.workspaceId,
        artifact.orgId ?? null,
        artifact.workflowRunId ?? null,
        artifact.nodeId ?? null,
        artifact.contract.kind,
        artifact.contract.name,
        artifact.location,
        artifact.contentHash,
        JSON.stringify(artifact.provenance),
        JSON.stringify(artifact.linkedRecords),
        artifact.sensitivity,
        content ? content.slice(0, 1000) : null,
        artifact.createdAt
      );
    } catch (e) {
      console.warn(`[ArtifactService] persist failed:`, (e as Error).message);
    }
  }

  private rowToArtifact(row: any): BusinessArtifact {
    return {
      artifactId: row.artifact_id,
      workspaceId: row.workspace_id,
      orgId: row.org_id,
      workflowRunId: row.workflow_run_id,
      nodeId: row.node_id,
      contract: { kind: row.contract_kind, name: row.contract_name },
      location: row.location,
      contentHash: row.content_hash,
      provenance: row.provenance ? JSON.parse(row.provenance) : { actor: { kind: 'system', id: 'unknown' }, sources: [], contextPackageIds: [], executionRefs: [], createdAt: Date.now() },
      linkedRecords: row.linked_records ? JSON.parse(row.linked_records) : [],
      sensitivity: row.sensitivity ?? 'internal',
      createdAt: row.created_at,
    };
  }
}
