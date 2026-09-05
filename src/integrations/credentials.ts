/**
 * XR Business OS — Credential Vault (BYOK)
 *
 * Secure storage for integration credentials.
 * All credentials encrypted at rest. Users own their keys.
 * No credentials are ever sent to XR servers.
 *
 * ── Phase 0 · T5 — restart safety ───────────────────────────────────────────
 *
 * The previous implementation derived its AES key in the constructor from a
 * random salt that was never persisted:
 *
 *     const salt = randomBytes(SALT_LENGTH);            // discarded
 *     this.encryptionKey = scryptSync(masterKey, salt, 32);
 *
 * Every process start therefore produced a different key, so ciphertext written
 * before a restart could never be decrypted after it — a silent, total loss of
 * every stored business credential.
 *
 * The v2 format fixes this by making each record self-describing and by using
 * envelope encryption (principle adopted from libsodium / age / OS keychains):
 *
 *     v2:<salt>:<iv>:<tag>:<wrappedDEK>:<dekIv>:<dekTag>:<ciphertext>
 *
 *   · salt        — per-record scrypt salt, persisted WITH the record, so the
 *                   KEK is reproducible on any future process.
 *   · wrappedDEK  — a random 256-bit data key, encrypted under the KEK. The
 *                   payload is encrypted with the DEK, so the master key can be
 *                   rotated by re-wrapping the DEK without touching payloads.
 *   · GCM tags    — authenticate both the wrapped key and the payload, so any
 *                   corruption or tampering fails loudly instead of returning
 *                   garbage (fail closed — Commandment 13).
 *
 * Legacy `iv:tag:ciphertext` records are detected and REFUSED rather than
 * silently mis-decrypted, and `migrateLegacyRecords()` performs the forward,
 * reversible migration required by Constitution Article XXIII.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { BusinessSqlDatabase } from '../core/business-l0.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce — the GCM-recommended size.
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/** Ciphertext format marker. Bump only with a migration. */
export const VAULT_FORMAT_VERSION = 'v2';

/** scrypt cost parameters, persisted implicitly by the format version. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export class CredentialVaultError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

export interface MigrationReport {
  scanned: number;
  migrated: number;
  alreadyCurrent: number;
  failed: Array<{ id: string; reason: string }>;
}

export class CredentialVault {
  private readonly masterKey: string;

  constructor(private db: BusinessSqlDatabase, masterKey: string) {
    if (!masterKey || masterKey.length === 0) {
      throw new CredentialVaultError('master key must be a non-empty string', 'invalid_master_key');
    }
    // The master key is retained; per-record KEKs are derived on demand from the
    // salt stored alongside each ciphertext. No key material is cached across
    // records, so rotating one record never invalidates another.
    this.masterKey = masterKey;
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
    const row = this.db.prepare('SELECT credentials FROM biz_credentials WHERE id = ?').get(id) as
      | { credentials: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(this.decrypt(row.credentials)) as Record<string, unknown>;
  }

  /**
   * Get credentials by connector ID for an org.
   */
  getByConnector(orgId: string, connectorId: string): { id: string; name: string; credentials: Record<string, unknown> } | null {
    const row = this.db.prepare(
      'SELECT id, name, credentials FROM biz_credentials WHERE org_id = ? AND connector_id = ? LIMIT 1'
    ).get(orgId, connectorId) as { id: string; name: string; credentials: string } | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name, credentials: JSON.parse(this.decrypt(row.credentials)) as Record<string, unknown> };
  }

  /**
   * List stored credentials (without revealing values).
   */
  list(orgId: string): { id: string; connectorId: string; name: string; expiresAt?: string; createdAt: string }[] {
    const rows = this.db.prepare(
      'SELECT id, connector_id, name, expires_at, created_at FROM biz_credentials WHERE org_id = ?'
    ).all(orgId) as Array<{
      id: string;
      connector_id: string;
      name: string;
      expires_at?: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
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
    const row = this.db.prepare('SELECT expires_at FROM biz_credentials WHERE id = ?').get(id) as
      | { expires_at?: string }
      | undefined;
    if (!row?.expires_at) return false;
    return new Date(row.expires_at) < new Date();
  }

  // ─── MIGRATION (Constitution Article XXIII — reversible, no silent loss) ───

  /** True when a stored value uses the current self-describing format. */
  static isCurrentFormat(value: string): boolean {
    return typeof value === 'string' && value.startsWith(`${VAULT_FORMAT_VERSION}:`);
  }

  /** True when a stored value uses the pre-Phase-0 `iv:tag:ciphertext` layout. */
  static isLegacyFormat(value: string): boolean {
    return typeof value === 'string' && !CredentialVault.isCurrentFormat(value) && value.split(':').length === 3;
  }

  /**
   * Report how many records still use the legacy format.
   *
   * Legacy records are, in the general case, undecryptable: the salt that
   * produced their key was never written down. This method exists so an
   * operator can see the blast radius before acting, rather than discovering it
   * when a decrypt throws.
   */
  legacyRecordCount(): number {
    const rows = this.db.prepare('SELECT credentials FROM biz_credentials').all() as Array<{ credentials: string }>;
    return rows.filter((r) => CredentialVault.isLegacyFormat(r.credentials)).length;
  }

  /**
   * Forward-migrate legacy records to the v2 envelope format.
   *
   * `legacyKey` must be the exact key that encrypted the old rows. Because the
   * old code derived that key from a salt it discarded, the caller can only
   * supply it if it was captured out-of-band; when it cannot be supplied the
   * record is reported as failed and left untouched. Nothing is deleted and
   * nothing is overwritten unless the plaintext was recovered and re-encrypted
   * successfully, so the operation is safe to re-run and never loses data.
   */
  migrateLegacyRecords(legacyKey?: Buffer): MigrationReport {
    const rows = this.db.prepare('SELECT id, credentials FROM biz_credentials').all() as Array<{
      id: string;
      credentials: string;
    }>;
    const report: MigrationReport = { scanned: rows.length, migrated: 0, alreadyCurrent: 0, failed: [] };

    for (const row of rows) {
      if (CredentialVault.isCurrentFormat(row.credentials)) {
        report.alreadyCurrent++;
        continue;
      }
      if (!CredentialVault.isLegacyFormat(row.credentials)) {
        report.failed.push({ id: row.id, reason: 'unrecognised ciphertext format' });
        continue;
      }
      if (!legacyKey) {
        report.failed.push({
          id: row.id,
          reason: 'legacy record requires the original derived key, which the old format did not persist',
        });
        continue;
      }
      try {
        const plaintext = decryptLegacy(row.credentials, legacyKey);
        const reEncrypted = this.encrypt(plaintext);
        this.db.prepare('UPDATE biz_credentials SET credentials = ?, updated_at = ? WHERE id = ?')
          .run(reEncrypted, new Date().toISOString(), row.id);
        report.migrated++;
      } catch (err) {
        report.failed.push({ id: row.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return report;
  }

  /**
   * Re-encrypt every current-format record under a new master key.
   *
   * Envelope encryption makes this cheap and safe: each record's DEK is
   * unwrapped with the old KEK and re-wrapped with the new one.
   */
  rotateMasterKey(newMasterKey: string): { rotated: number; failed: Array<{ id: string; reason: string }> } {
    if (!newMasterKey) {
      throw new CredentialVaultError('new master key must be a non-empty string', 'invalid_master_key');
    }
    const rows = this.db.prepare('SELECT id, credentials FROM biz_credentials').all() as Array<{
      id: string;
      credentials: string;
    }>;
    const failed: Array<{ id: string; reason: string }> = [];
    let rotated = 0;

    for (const row of rows) {
      try {
        const plaintext = this.decrypt(row.credentials);
        const reEncrypted = encryptWithMaster(plaintext, newMasterKey);
        this.db.prepare('UPDATE biz_credentials SET credentials = ?, updated_at = ? WHERE id = ?')
          .run(reEncrypted, new Date().toISOString(), row.id);
        rotated++;
      } catch (err) {
        failed.push({ id: row.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { rotated, failed };
  }

  // ─── ENCRYPTION ───

  private encrypt(plaintext: string): string {
    return encryptWithMaster(plaintext, this.masterKey);
  }

  private decrypt(encryptedString: string): string {
    if (CredentialVault.isLegacyFormat(encryptedString)) {
      // Blocked, not guessed. Reading a legacy record with a freshly derived key
      // would either throw deep inside OpenSSL or — worse — appear to work.
      throw new CredentialVaultError(
        'credential is stored in the pre-7.0.1 format, which did not persist its KDF salt and cannot be decrypted. ' +
          'Run the credential-vault migration (see docs/migration/credential-vault.md) or re-enter the credential.',
        'legacy_format',
      );
    }
    if (!CredentialVault.isCurrentFormat(encryptedString)) {
      throw new CredentialVaultError('credential ciphertext is malformed or truncated', 'malformed_ciphertext');
    }
    return decryptV2(encryptedString, this.masterKey);
  }
}

// ─── Format helpers (module-level so migration/rotation can reuse them) ───────

function deriveKek(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

function encryptWithMaster(plaintext: string, masterKey: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const kek = deriveKek(masterKey, salt);

  // Envelope: random data key encrypts the payload; the KEK only wraps the DEK.
  const dek = randomBytes(KEY_LENGTH);
  const dekIv = randomBytes(IV_LENGTH);
  const dekCipher = createCipheriv(ALGORITHM, kek, dekIv);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekTag = dekCipher.getAuthTag();

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VAULT_FORMAT_VERSION,
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    wrappedDek.toString('base64'),
    dekIv.toString('base64'),
    dekTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptV2(encoded: string, masterKey: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 8) {
    throw new CredentialVaultError('credential ciphertext has an unexpected field count', 'malformed_ciphertext');
  }
  const [, saltB64, ivB64, tagB64, wrappedB64, dekIvB64, dekTagB64, dataB64] = parts as [
    string, string, string, string, string, string, string, string,
  ];

  try {
    const salt = Buffer.from(saltB64, 'base64');
    const kek = deriveKek(masterKey, salt);

    const dekDecipher = createDecipheriv(ALGORITHM, kek, Buffer.from(dekIvB64, 'base64'));
    dekDecipher.setAuthTag(Buffer.from(dekTagB64, 'base64'));
    const dek = Buffer.concat([dekDecipher.update(Buffer.from(wrappedB64, 'base64')), dekDecipher.final()]);

    const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    // GCM authentication failure means a wrong master key or tampering. Both are
    // reported as an explicit, non-recoverable error rather than partial output.
    throw new CredentialVaultError(
      `credential decryption failed (wrong master key or corrupted record): ${err instanceof Error ? err.message : String(err)}`,
      'decryption_failed',
    );
  }
}

/** Decrypt a pre-Phase-0 record when the original derived key is available. */
export function decryptLegacy(encoded: string, legacyKey: Buffer): string {
  const [ivB64, tagB64, dataB64] = encoded.split(':') as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, legacyKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Constant-time comparison helper for callers verifying credential fingerprints. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
