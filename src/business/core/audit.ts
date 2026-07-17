/**
 * XR Business OS — Audit Trail
 * 
 * Integrates with XR's existing tamper-evident audit log (SHA-256 chain).
 * All business mutations are logged with hash chain.
 */

import { createHash } from 'crypto';
import { BusinessDatabase } from './database.ts';
import type { AuditEntry } from './types.ts';

export class AuditTrail {
  constructor(private db: BusinessDatabase) {}

  /**
   * Log an audit entry with SHA-256 hash chain.
   */
  log(params: {
    orgId: string;
    workspaceId?: string;
    actorId: string;
    actorType: AuditEntry['actorType'];
    action: string;
    resource: string;
    resourceId: string;
    changes?: Record<string, { before: unknown; after: unknown }>;
    metadata?: Record<string, unknown>;
  }): AuditEntry {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();

    // Get previous hash for chain
    const previousEntry = this.db.prepare(
      'SELECT hash FROM biz_audit WHERE org_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(params.orgId) as any;
    const previousHash = previousEntry?.hash ?? '0'.repeat(64);

    // Compute hash: SHA-256(previous_hash + action + resource + resource_id + timestamp)
    const hashInput = `${previousHash}${params.action}${params.resource}${params.resourceId}${now}`;
    const hash = createHash('sha256').update(hashInput).digest('hex');

    this.db.prepare(`
      INSERT INTO biz_audit (id, org_id, workspace_id, actor_id, actor_type, action, resource, resource_id, changes, metadata, hash, previous_hash, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.orgId, params.workspaceId ?? null,
      params.actorId, params.actorType, params.action,
      params.resource, params.resourceId,
      params.changes ? JSON.stringify(params.changes) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      hash, previousHash, now
    );

    return {
      id,
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      actorType: params.actorType,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      changes: params.changes,
      metadata: params.metadata,
      hash,
      previousHash,
      timestamp: now,
    };
  }

  /**
   * Verify audit chain integrity.
   */
  verify(orgId: string): { valid: boolean; entries: number; brokenAt?: number } {
    const entries = this.db.prepare(
      'SELECT * FROM biz_audit WHERE org_id = ? ORDER BY timestamp ASC'
    ).all(orgId) as any[];

    let previousHash = '0'.repeat(64);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry.previous_hash !== previousHash) {
        return { valid: false, entries: entries.length, brokenAt: i };
      }

      const hashInput = `${previousHash}${entry.action}${entry.resource}${entry.resource_id}${entry.timestamp}`;
      const expectedHash = createHash('sha256').update(hashInput).digest('hex');

      if (entry.hash !== expectedHash) {
        return { valid: false, entries: entries.length, brokenAt: i };
      }

      previousHash = entry.hash;
    }

    return { valid: true, entries: entries.length };
  }

  /**
   * Get audit log for an organization.
   */
  getLog(orgId: string, params?: {
    limit?: number;
    offset?: number;
    resource?: string;
    resourceId?: string;
    actorId?: string;
    action?: string;
    from?: string;
    to?: string;
  }): AuditEntry[] {
    let whereClause = 'WHERE org_id = ?';
    const values: unknown[] = [orgId];

    if (params?.resource) { whereClause += ' AND resource = ?'; values.push(params.resource); }
    if (params?.resourceId) { whereClause += ' AND resource_id = ?'; values.push(params.resourceId); }
    if (params?.actorId) { whereClause += ' AND actor_id = ?'; values.push(params.actorId); }
    if (params?.action) { whereClause += ' AND action = ?'; values.push(params.action); }
    if (params?.from) { whereClause += ' AND timestamp >= ?'; values.push(params.from); }
    if (params?.to) { whereClause += ' AND timestamp <= ?'; values.push(params.to); }

    const limit = params?.limit ?? 100;
    const offset = params?.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM biz_audit ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as any[];

    return rows.map(r => this.rowToAuditEntry(r));
  }

  /**
   * Get audit log for a specific resource.
   */
  getResourceHistory(resource: string, resourceId: string): AuditEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_audit WHERE resource = ? AND resource_id = ? ORDER BY timestamp DESC'
    ).all(resource, resourceId) as any[];

    return rows.map(r => this.rowToAuditEntry(r));
  }

  private rowToAuditEntry(row: any): AuditEntry {
    return {
      id: row.id,
      orgId: row.org_id,
      workspaceId: row.workspace_id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      changes: row.changes ? JSON.parse(row.changes) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      hash: row.hash,
      previousHash: row.previous_hash,
      timestamp: row.timestamp,
    };
  }
}
