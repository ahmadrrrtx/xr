/**
 * Phase 22 · Integrations — CredentialVault wiring.
 *
 * CredentialVault (credentials.ts) is the single encrypted store for connector
 * tokens, API keys and OAuth app secrets. Its SQL is written against the
 * Business OS table `biz_credentials`, which carries a foreign key to
 * `biz_organizations`. Integrations are a core feature, so they get their own
 * table with the same columns and no foreign key. The adapter below rewrites
 * the table name on the way to the database; credentials.ts itself is not
 * changed, so Business OS behaviour is identical.
 *
 * The master key lives in the OS keychain (SecretBroker → secrets.ts). It is
 * generated once and never written to a plaintext file. If the key is missing
 * but encrypted rows already exist, we refuse to start rather than generate a
 * new key: a new key would make every stored token permanently unreadable.
 */

import { randomBytes } from 'crypto';
import type { BusinessSqlDatabase } from '../core/business-l0.ts';
import { CredentialVault, CredentialVaultError } from './credentials.ts';
import { getSecretAsync, setSecretAsync } from '../security/secrets.ts';

export const INTEGRATION_CREDENTIALS_TABLE = 'integration_credentials';
export const INTEGRATIONS_ORG_ID = 'local';
export const VAULT_MASTER_KEY_SECRET = 'XR_INTEGRATIONS_VAULT_KEY';

/** Schema for the integration tables. Idempotent; run once per store. */
export const INTEGRATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS integration_credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS integration_credentials_connector
  ON integration_credentials (org_id, connector_id);
CREATE TABLE IF NOT EXISTS integration_connectors (
  workspace_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  credential_id TEXT,
  account TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, connector_id)
);
`;

/** Table-scoped view of a database: every `biz_credentials` statement targets the integrations table. */
export function integrationCredentialsDb(db: BusinessSqlDatabase): BusinessSqlDatabase {
  return {
    prepare(sql: string) {
      return db.prepare(sql.replaceAll('biz_credentials', INTEGRATION_CREDENTIALS_TABLE));
    },
  };
}

export function ensureIntegrationSchema(db: BusinessSqlDatabase): void {
  // bun:sqlite and better-sqlite3 both accept a multi-statement exec through prepare
  // only one statement at a time, so split on the terminator.
  for (const stmt of INTEGRATION_SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    db.prepare(stmt).run();
  }
}

/** Returns the existing master key, or creates one. Fails closed if encrypted rows exist without a key. */
export async function loadOrCreateVaultMasterKey(db: BusinessSqlDatabase): Promise<string> {
  const existing = await getSecretAsync(VAULT_MASTER_KEY_SECRET);
  if (existing) return existing;

  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${INTEGRATION_CREDENTIALS_TABLE}`).get() as { n: number } | undefined;
  if ((row?.n ?? 0) > 0) {
    throw new CredentialVaultError(
      'Integration credentials exist but the vault key is missing from the OS keychain. Refusing to create a new key.',
      'missing_master_key',
    );
  }

  const key = randomBytes(32).toString('hex');
  await setSecretAsync(VAULT_MASTER_KEY_SECRET, key);
  return key;
}

/** Builds the integrations vault. Callers must have run ensureIntegrationSchema first. */
export async function openIntegrationVault(db: BusinessSqlDatabase): Promise<CredentialVault> {
  const scoped = integrationCredentialsDb(db);
  const key = await loadOrCreateVaultMasterKey(scoped);
  return new CredentialVault(scoped, key);
}
