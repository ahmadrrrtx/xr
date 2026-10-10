/**
 * Phase 22 · Integrations — persisted connection state.
 *
 * Holds the InstalledConnector fields the registry defines, minus anything secret.
 * `config` contains only non-secret fields (for example the Coolify URL). Tokens,
 * API keys and OAuth app secrets are referenced by `credentialId` and live in the
 * CredentialVault.
 */

import type { BusinessSqlDatabase } from '../core/business-l0.ts';
import type { InstalledConnector } from './registry.ts';

export interface AccountSummary {
  login?: string;
  name?: string;
}

export interface ConnectionRecord {
  workspaceId: string;
  connectorId: string;
  status: InstalledConnector['status'];
  config: Record<string, unknown>;
  credentialId: string | null;
  account: AccountSummary | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  error: string | null;
  updatedAt: string;
}

interface Row {
  workspace_id: string;
  connector_id: string;
  status: InstalledConnector['status'];
  config: string;
  credential_id: string | null;
  account: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  error: string | null;
  updated_at: string;
}

function fromRow(row: Row): ConnectionRecord {
  return {
    workspaceId: row.workspace_id,
    connectorId: row.connector_id,
    status: row.status,
    config: JSON.parse(row.config || '{}') as Record<string, unknown>,
    credentialId: row.credential_id,
    account: row.account ? (JSON.parse(row.account) as AccountSummary) : null,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    error: row.error,
    updatedAt: row.updated_at,
  };
}

export class ConnectionStore {
  constructor(private readonly db: BusinessSqlDatabase) {}

  get(workspaceId: string, connectorId: string): ConnectionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM integration_connectors WHERE workspace_id = ? AND connector_id = ?')
      .get(workspaceId, connectorId) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  list(workspaceId: string): ConnectionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM integration_connectors WHERE workspace_id = ?')
      .all(workspaceId) as Row[];
    return rows.map(fromRow);
  }

  upsert(record: ConnectionRecord): void {
    this.db.prepare(`
      INSERT INTO integration_connectors
        (workspace_id, connector_id, status, config, credential_id, account, connected_at, last_sync_at, error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, connector_id) DO UPDATE SET
        status = excluded.status,
        config = excluded.config,
        credential_id = excluded.credential_id,
        account = excluded.account,
        connected_at = excluded.connected_at,
        last_sync_at = excluded.last_sync_at,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run(
      record.workspaceId,
      record.connectorId,
      record.status,
      JSON.stringify(record.config),
      record.credentialId,
      record.account ? JSON.stringify(record.account) : null,
      record.connectedAt,
      record.lastSyncAt,
      record.error,
      record.updatedAt,
    );
  }

  remove(workspaceId: string, connectorId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM integration_connectors WHERE workspace_id = ? AND connector_id = ?')
      .run(workspaceId, connectorId);
    return result.changes > 0;
  }
}

/** Maps a persisted record to the registry's InstalledConnector shape, so both sides speak one type. */
export function toInstalledConnector(record: ConnectionRecord): InstalledConnector {
  return {
    id: `${record.workspaceId}:${record.connectorId}`,
    connectorId: record.connectorId,
    workspaceId: record.workspaceId,
    status: record.status,
    config: record.config,
    credentialRef: record.credentialId ?? '',
    connectedAt: record.connectedAt ?? undefined,
    lastSyncAt: record.lastSyncAt ?? undefined,
    error: record.error ?? undefined,
  };
}
