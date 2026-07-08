/**
 * XR Business OS — Credential Vault (BYOK)
 * 
 * Secure storage for integration credentials.
 * All credentials encrypted at rest. Users own their keys.
 * No credentials are ever sent to XR servers.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { BusinessDatabase } from '../core/database.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

export class CredentialVault {
  private encryptionKey: Buffer;

  constructor(private db: BusinessDatabase, masterKey: string) {
    // Derive encryption key from master key
    const salt = randomBytes(SALT_LENGTH);
    this.encryptionKey = scryptSync(masterKey, salt, 32);
  }

  /**
   * Store credentials securely.
   */
  store(orgId: string, params: {
    connectorId: string;
    name: string;
    credentials: Record<string, unknown>;
    expiresAt?: string;
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const encrypted = this.encrypt(JSON.stringify(params.credentials));

    this.db.prepare(`
      INSERT INTO biz_credentials (id, org_id, connector_id, name, credentials, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, params.connectorId, params.name, encrypted, params.expiresAt ?? null, now, now);

    return id;
  }

  /**
   * Retrieve credentials.
   */
  retrieve(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT credentials FROM biz_credentials WHERE id = ?').get(id) as any;
    if (!row) return null;
    return JSON.parse(this.decrypt(row.credentials));
  }

  /**
   * Get credentials by connector ID for an org.
   */
  getByConnector(orgId: string, connectorId: string): { id: string; name: string; credentials: Record<string, unknown> } | null {
    const row = this.db.prepare(
      'SELECT id, name, credentials FROM biz_credentials WHERE org_id = ? AND connector_id = ? LIMIT 1'
    ).get(orgId, connectorId) as any;
    if (!row) return null;
    return { id: row.id, name: row.name, credentials: JSON.parse(this.decrypt(row.credentials)) };
  }

  /**
   * List stored credentials (without revealing values).
   */
  list(orgId: string): { id: string; connectorId: string; name: string; expiresAt?: string; createdAt: string }[] {
    const rows = this.db.prepare(
      'SELECT id, connector_id, name, expires_at, created_at FROM biz_credentials WHERE org_id = ?'
    ).all(orgId) as any[];

    return rows.map(r => ({
      id: r.id,
      connectorId: r.connector_id,
      name: r.name,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }

  /**
   * Update credentials.
   */
  update(id: string, credentials: Record<string, unknown>): void {
    const encrypted = this.encrypt(JSON.stringify(credentials));
    this.db.prepare('UPDATE biz_credentials SET credentials = ?, updated_at = ? WHERE id = ?')
      .run(encrypted, new Date().toISOString(), id);
  }

  /**
   * Delete credentials.
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM biz_credentials WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Check if credentials are expired.
   */
  isExpired(id: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM biz_credentials WHERE id = ?').get(id) as any;
    if (!row?.expires_at) return false;
    return new Date(row.expires_at) < new Date();
  }

  // ─── ENCRYPTION ───

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext (all base64)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decrypt(encryptedString: string): string {
    const [ivB64, tagB64, dataB64] = encryptedString.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  }
}
