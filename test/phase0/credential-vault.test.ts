/**
 * Phase 0 · T5 — Credential vault restart safety (effect tests).
 *
 * Constitution Article XX.1: tests assert effects, not transitions. These tests
 * therefore never inspect internal state — they write a credential, throw the
 * vault instance away to simulate a process restart, build a brand-new vault
 * from the same persisted bytes, and assert the secret comes back intact.
 *
 * The pre-Phase-0 implementation fails every one of these tests.
 */

import { describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { CredentialVault, CredentialVaultError, VAULT_FORMAT_VERSION } from "../../src/integrations/credentials.ts";

/**
 * Minimal in-memory stand-in for BusinessDatabase.
 *
 * It stores rows as plain objects, so the bytes a vault writes are exactly the
 * bytes the next vault reads — which is what makes the restart test meaningful
 * rather than a mock asserting itself.
 */
interface Row {
  id: string;
  org_id: string;
  connector_id: string;
  name: string;
  credentials: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

class FakeDb {
  rows: Row[] = [];

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    const rows = this.rows;

    return {
      run: (...args: unknown[]) => {
        if (normalized.startsWith("INSERT INTO biz_credentials")) {
          const [id, org_id, connector_id, name, credentials, expires_at, created_at, updated_at] = args as string[];
          rows.push({
            id: id!, org_id: org_id!, connector_id: connector_id!, name: name!,
            credentials: credentials!, expires_at: (expires_at ?? null) as string | null,
            created_at: created_at!, updated_at: updated_at!,
          });
          return { changes: 1 };
        }
        if (normalized.startsWith("UPDATE biz_credentials SET credentials")) {
          const [credentials, updated_at, id] = args as string[];
          const row = rows.find((r) => r.id === id);
          if (!row) return { changes: 0 };
          row.credentials = credentials!;
          row.updated_at = updated_at!;
          return { changes: 1 };
        }
        if (normalized.startsWith("DELETE FROM biz_credentials")) {
          const [id] = args as string[];
          const before = rows.length;
          this.rows = rows.filter((r) => r.id !== id);
          return { changes: before - this.rows.length };
        }
        return { changes: 0 };
      },
      get: (...args: unknown[]) => {
        if (normalized.includes("WHERE org_id = ? AND connector_id = ?")) {
          const [orgId, connectorId] = args as string[];
          return rows.find((r) => r.org_id === orgId && r.connector_id === connectorId);
        }
        const [id] = args as string[];
        return rows.find((r) => r.id === id);
      },
      all: (...args: unknown[]) => {
        if (normalized.includes("WHERE org_id = ?")) {
          const [orgId] = args as string[];
          return rows.filter((r) => r.org_id === orgId);
        }
        return rows;
      },
    };
  }
}

const MASTER = "correct-horse-battery-staple";
const SECRET = { apiKey: "sk-live-do-not-lose-me", refresh: "rt-9931", nested: { scope: ["read", "write"] } };

function newVault(db: FakeDb, masterKey: string = MASTER): CredentialVault {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FakeDb implements the narrow slice used here.
  return new CredentialVault(db as any, masterKey);
}

describe("Phase 0 · T5 — credential vault", () => {
  test("EFFECT: a credential written before a restart is readable after it", () => {
    const db = new FakeDb();

    // ── process 1 ──
    const id = newVault(db).store("org-1", { connectorId: "stripe", name: "Prod key", credentials: SECRET });

    // ── process 2: a brand-new vault, same persisted bytes, same master key ──
    const recovered = newVault(db).retrieve(id);

    expect(recovered).toEqual(SECRET);
  });

  test("EFFECT: many independent restarts all recover the same plaintext", () => {
    const db = new FakeDb();
    const id = newVault(db).store("org-1", { connectorId: "slack", name: "Bot", credentials: SECRET });

    for (let restart = 0; restart < 5; restart++) {
      expect(newVault(db).retrieve(id)).toEqual(SECRET);
    }
  });

  test("EFFECT: getByConnector survives a restart", () => {
    const db = new FakeDb();
    newVault(db).store("org-7", { connectorId: "github", name: "CI token", credentials: { token: "ghp_x" } });

    const found = newVault(db).getByConnector("org-7", "github");
    expect(found?.credentials).toEqual({ token: "ghp_x" });
  });

  test("EFFECT: update is durable across a restart", () => {
    const db = new FakeDb();
    const v1 = newVault(db);
    const id = v1.store("org-1", { connectorId: "aws", name: "Key", credentials: { k: "old" } });
    v1.update(id, { k: "new" });

    expect(newVault(db).retrieve(id)).toEqual({ k: "new" });
  });

  test("stored ciphertext is versioned, salted and never contains the plaintext", () => {
    const db = new FakeDb();
    newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });
    const stored = db.rows[0]!.credentials;

    expect(stored.startsWith(`${VAULT_FORMAT_VERSION}:`)).toBe(true);
    expect(stored.split(":")).toHaveLength(8); // version + salt + iv + tag + wrappedDEK + dekIv + dekTag + payload
    expect(stored).not.toContain("sk-live-do-not-lose-me");
    expect(stored).not.toContain("rt-9931");
  });

  test("each record gets a unique salt and IV (no key or nonce reuse)", () => {
    const db = new FakeDb();
    const vault = newVault(db);
    vault.store("org-1", { connectorId: "a", name: "a", credentials: SECRET });
    vault.store("org-1", { connectorId: "b", name: "b", credentials: SECRET });

    const [saltA, ivA] = db.rows[0]!.credentials.split(":").slice(1, 3);
    const [saltB, ivB] = db.rows[1]!.credentials.split(":").slice(1, 3);

    expect(saltA).not.toEqual(saltB);
    expect(ivA).not.toEqual(ivB);
    // Identical plaintext under different salts must not produce identical output.
    expect(db.rows[0]!.credentials).not.toEqual(db.rows[1]!.credentials);
  });

  test("FAIL CLOSED: the wrong master key is rejected, never partially decrypted", () => {
    const db = new FakeDb();
    const id = newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });

    expect(() => newVault(db, "the-wrong-key").retrieve(id)).toThrow(CredentialVaultError);
  });

  test("FAIL CLOSED: a corrupted payload is detected by the GCM tag", () => {
    const db = new FakeDb();
    const id = newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });

    const parts = db.rows[0]!.credentials.split(":");
    const payload = Buffer.from(parts[7]!, "base64");
    payload[0] = payload[0]! ^ 0xff; // flip one bit of ciphertext
    parts[7] = payload.toString("base64");
    db.rows[0]!.credentials = parts.join(":");

    expect(() => newVault(db).retrieve(id)).toThrow(/decryption failed/i);
  });

  test("FAIL CLOSED: a corrupted wrapped data key is detected", () => {
    const db = new FakeDb();
    const id = newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });

    const parts = db.rows[0]!.credentials.split(":");
    const wrapped = Buffer.from(parts[4]!, "base64");
    wrapped[0] = wrapped[0]! ^ 0xff;
    parts[4] = wrapped.toString("base64");
    db.rows[0]!.credentials = parts.join(":");

    expect(() => newVault(db).retrieve(id)).toThrow(CredentialVaultError);
  });

  test("MIGRATION: a legacy record is refused rather than silently mis-read", () => {
    const db = new FakeDb();
    // Write a record in the pre-Phase-0 format: iv:tag:ciphertext, no salt.
    const lostSalt = randomBytes(32);
    const legacyKey = scryptSync(MASTER, lostSalt, 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(SECRET), "utf8"), cipher.final()]);
    const legacy = `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;

    db.rows.push({
      id: "legacy-1", org_id: "org-1", connector_id: "stripe", name: "old",
      credentials: legacy, expires_at: null, created_at: "", updated_at: "",
    });

    const vault = newVault(db);
    expect(CredentialVault.isLegacyFormat(legacy)).toBe(true);
    expect(vault.legacyRecordCount()).toBe(1);
    expect(() => vault.retrieve("legacy-1")).toThrow(/pre-7\.0\.1 format/i);
  });

  test("MIGRATION: a legacy record is upgraded and readable after restart when the old key is supplied", () => {
    const db = new FakeDb();
    const lostSalt = randomBytes(32);
    const legacyKey = scryptSync(MASTER, lostSalt, 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(SECRET), "utf8"), cipher.final()]);
    db.rows.push({
      id: "legacy-1", org_id: "org-1", connector_id: "stripe", name: "old",
      credentials: `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`,
      expires_at: null, created_at: "", updated_at: "",
    });

    const report = newVault(db).migrateLegacyRecords(legacyKey);
    expect(report.migrated).toBe(1);
    expect(report.failed).toHaveLength(0);

    // EFFECT: after migration a *new* vault reads the original secret.
    expect(newVault(db).retrieve("legacy-1")).toEqual(SECRET);
    expect(newVault(db).legacyRecordCount()).toBe(0);
  });

  test("MIGRATION: without the original key the record is reported failed and left untouched (no data loss)", () => {
    const db = new FakeDb();
    const legacy = `${randomBytes(16).toString("base64")}:${randomBytes(16).toString("base64")}:${randomBytes(24).toString("base64")}`;
    db.rows.push({
      id: "legacy-1", org_id: "org-1", connector_id: "stripe", name: "old",
      credentials: legacy, expires_at: null, created_at: "", updated_at: "",
    });

    const report = newVault(db).migrateLegacyRecords();
    expect(report.migrated).toBe(0);
    expect(report.failed).toHaveLength(1);
    expect(db.rows[0]!.credentials).toBe(legacy); // untouched — nothing destroyed
  });

  test("MIGRATION: re-running migration is idempotent", () => {
    const db = new FakeDb();
    newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });

    const report = newVault(db).migrateLegacyRecords();
    expect(report.alreadyCurrent).toBe(1);
    expect(report.migrated).toBe(0);
    expect(newVault(db).retrieve(db.rows[0]!.id)).toEqual(SECRET);
  });

  test("ROTATION: the master key can be rotated and old records still decrypt with the new key", () => {
    const db = new FakeDb();
    const id = newVault(db).store("org-1", { connectorId: "stripe", name: "k", credentials: SECRET });

    const result = newVault(db).rotateMasterKey("a-brand-new-master-key");
    expect(result.rotated).toBe(1);
    expect(result.failed).toHaveLength(0);

    // EFFECT: new key works after "restart"; old key no longer does.
    expect(newVault(db, "a-brand-new-master-key").retrieve(id)).toEqual(SECRET);
    expect(() => newVault(db, MASTER).retrieve(id)).toThrow(CredentialVaultError);
  });

  test("an empty master key is rejected at construction", () => {
    expect(() => newVault(new FakeDb(), "")).toThrow(CredentialVaultError);
  });

  test("retrieve returns null for an unknown id (not an exception)", () => {
    expect(newVault(new FakeDb()).retrieve("nope")).toBeNull();
  });
});
