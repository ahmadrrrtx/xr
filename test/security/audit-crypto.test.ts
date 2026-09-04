/**
 * Phase 4 (Evidence Integrity, F-08) — signed audit chain integration tests.
 *
 * The tamper matrix:
 *   (a) single-entry edit          → chain replay fails (pre-existing)
 *   (b) WHOLESALE truncate+rebuild  → --crypto fails on head signature (the
 *       F-08 KILL PROOF: an attacker with SQLite write access who recomputes
 *       every hash link still cannot forge the Ed25519 head signature)
 *   (c) key file deleted            → honest "key unavailable, verification
 *       limited to chain" state
 *   (d) re-key                      → old segment verifies to the re-key point,
 *       new segment verifies fully
 *   plus: counter-gap detection, head deletion, wrong-key signing.
 *
 * These construct WorkspaceStore directly with keying EXPLICITLY invoked
 * (unit-suite preload sets XR_AUDIT_NO_AUTOKEY=1), and a tiny sign-every
 * cadence so checkpoints occur on every entry.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";
import {
  generateAuditIdentity,
  checkpointMessage,
} from "../../src/security/audit-signer.ts";

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-crypto-home-"));
  prevHome = process.env.XR_HOME;
  process.env.XR_HOME = home;
  // Sign every entry (cadence 1) so checkpoints are dense in these short chains.
  process.env.XR_AUDIT_SIGN_EVERY = "1";
  clearSecretMemo();
});

function freshStore(label: string): { store: WorkspaceStore; dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `xr-crypto-${label}-`));
  const dbPath = join(dir, "xr.db");
  const store = new WorkspaceStore("t", dbPath);
  return { store, dbPath, dir };
}

describe("Phase 4 · signed audit — keying and signing", () => {
  test("ensureAuditKeying is idempotent and publishes pubkey into the chain", () => {
    const { store, dir } = freshStore("key");
    try {
      const r1 = store.ensureAuditKeying("test");
      expect(r1.keyed).toBe(true);
      expect(r1.pubkey).toBeTruthy();
      expect(store.auditIsKeyed).toBe(true);

      const r2 = store.ensureAuditKeying("test");
      expect(r2.keyed).toBe(true);
      expect(r2.pubkey).toBe(r1.pubkey);

      store.audit("a", { v: 1 });
      store.audit("b", { v: 2 });

      const v = store.verifyCrypto();
      expect(v.chainValid).toBe(true);
      expect(v.keyed).toBe(true);
      expect(v.keyAvailable).toBe(true);
      expect(v.signaturesValid).toBe(true);
      expect(v.head?.present).toBe(true);
      expect(v.head?.matches).toBe(true);
      expect(v.head?.stale).toBe(false);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unsigned store reports keyed=false; verify still works chain-only", () => {
    const { store, dir } = freshStore("unsigned");
    try {
      store.audit("x", { v: 1 });
      const v = store.verifyCrypto();
      expect(v.chainValid).toBe(true);
      expect(v.keyed).toBe(false);
      expect(v.signaturesValid).toBe(true); // no signatures to fail
      expect(v.head?.present).toBe(false);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 4 · tamper matrix", () => {
  test("(a) single-entry edit breaks chain replay", () => {
    const { store, dbPath, dir } = freshStore("t-a");
    try {
      store.ensureAuditKeying("test");
      store.audit("a", { v: 1 });
      store.audit("b", { v: 2 });
      store.close();

      const raw = new Database(dbPath);
      raw.query(`UPDATE audit_log SET detail='{"v":999}' WHERE event='a'`).run();
      raw.close();

      const reopened = new WorkspaceStore("t", dbPath);
      const v = reopened.verifyCrypto();
      expect(v.chainValid).toBe(false);
      expect(v.signaturesValid).toBe(false);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(b) WHOLESALE truncate + consistent hash rebuild is caught by the signed head (F-08 kill proof)", () => {
    const { store, dbPath, dir } = freshStore("t-b");
    try {
      store.ensureAuditKeying("test");
      for (let i = 0; i < 6; i++) store.audit(`e${i}`, { i });
      expect(store.verifyCrypto().signaturesValid).toBe(true);
      store.close();

      // Attacker: open the DB, delete the last 3 entries AND REBUILD the hash
      // chain consistently (the exact attack F-08 describes), recomputing
      // prev_hash/hash for the survivors... here we truncate then append a
      // fresh, fully-consistent forged tail with recomputed links.
      const raw = new Database(dbPath);
      // Wipe the unforgeable head record (attacker tries to cover the trail).
      raw.query(`DELETE FROM audit_head`).run();
      // Truncate the last 3 entries.
      raw.query(`DELETE FROM audit_log WHERE id > (SELECT MAX(id)-3 FROM audit_log)`).run();
      // Rebuild a consistent hash chain over forged new entries (no key!).
      const last = raw.query(`SELECT hash,head_counter FROM audit_log ORDER BY id DESC LIMIT 1`).get() as { hash: string; head_counter: number | null };
      let prev = last.hash;
      let counter = (last.head_counter ?? 0) + 1;
      for (let i = 0; i < 3; i++) {
        const event = `forged${i}`;
        const detail = JSON.stringify({ forged: true });
        const ts = Date.now() + i;
        const hash = createHash("sha256")
          .update(JSON.stringify({ event, detail: { forged: true }, prev, ts }))
          .digest("hex");
        raw
          .query(`INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at,head_counter,sig) VALUES (?,?,?,?,?,?,?,?)`)
          .run(null, event, detail, prev, hash, ts, counter++, null);
        prev = hash;
      }
      raw.close();

      const reopened = new WorkspaceStore("t", dbPath);
      const v = reopened.verifyCrypto();
      // Chain replay itself may pass (attacker recomputed links) — but the
      // signed head is GONE / cannot be forged → signaturesValid MUST be false.
      expect(v.keyed).toBe(true);
      expect(v.signaturesValid).toBe(false);
      expect(v.head?.present).toBe(false); // attacker deleted it; cannot re-create
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(b2) rebuilding a forged head signature with the WRONG key fails", () => {
    const { store, dbPath, dir } = freshStore("t-b2");
    try {
      store.ensureAuditKeying("test");
      for (let i = 0; i < 4; i++) store.audit(`e${i}`, { i });
      store.close();

      // Attacker has their OWN key but NOT the install's private key.
      const attacker = generateAuditIdentity();
      const raw = new Database(dbPath);
      const head = raw.query(`SELECT counter,entry_hash,entry_id,pubkey FROM audit_head WHERE id=1`).get() as any;
      // Forge a head row claiming the real entry hash but signed by attacker.
      const priv = createPrivateKey({
        key: Buffer.from(attacker.privateKeyB64, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const msg = checkpointMessage({ entryHash: head.entry_hash, counter: head.counter, publicKeyB64: head.pubkey, kind: "head" });
      const forgedSig = cryptoSign(null, msg, priv).toString("base64");
      raw.query(`UPDATE audit_head SET sig=? WHERE id=1`).run(forgedSig);
      raw.close();

      const reopened = new WorkspaceStore("t", dbPath);
      const v = reopened.verifyCrypto();
      expect(v.signaturesValid).toBe(false); // forged sig rejected
      expect(v.head?.matches).toBe(false);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(c) key unavailable on a keyed install → limited verification (exit-code 2 state)", () => {
    const { store, dbPath, dir } = freshStore("t-c");
    try {
      store.ensureAuditKeying("test");
      store.audit("a", { v: 1 });
      store.close();

      // Simulate key loss: the install key lives in the secrets fallback
      // (~/.xr/.env under this isolated XR_HOME). Delete it and clear the
      // in-memory memo so detection reads the backend (no keychain in sandbox).
      const envFile = join(home, ".env");
      const envBackup = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
      if (envBackup !== null) rmSync(envFile, { force: true });
      clearSecretMemo();
      // The secrets shim may also mirror the key into process.env (compat
      // hydration); remove that so detection reads only the (now-empty) backend.
      delete process.env["XR_AUDIT_SIGN_KEY"];
      try {
        const reopened = new WorkspaceStore("t", dbPath);
        expect(reopened.auditIsKeyed).toBe(true);
        expect(reopened.auditSigningKeyMissing).toBe(true);
        const v = reopened.verifyCrypto();
        expect(v.keyed).toBe(true);
        expect(v.keyAvailable).toBe(false);
        // Existing signatures still verify (pubkey is on-chain); only the
        // "key unavailable" limited state is reported.
        expect(v.chainValid).toBe(true);
        reopened.close();
      } finally {
        if (envBackup !== null) writeFileSync(envFile, envBackup);
        clearSecretMemo();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(d) re-key: old segment verifies to the re-key point; new segment verifies fully", () => {
    const { store, dir } = freshStore("t-d");
    try {
      store.ensureAuditKeying("test");
      store.audit("before.1", {});
      store.audit("before.2", {});
      const rk = store.rekeyAudit("test");
      expect(rk.ok).toBe(true);
      expect(rk.pubkey).toBeTruthy();
      store.audit("after.1", {});
      store.audit("after.2", {});

      const v = store.verifyCrypto();
      expect(v.chainValid).toBe(true);
      expect(v.signaturesValid).toBe(true);
      expect(v.segments.length).toBeGreaterThanOrEqual(2);
      expect(v.head?.matches).toBe(true);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("counter gap (truncate-within-segment) is detected", () => {
    const { store, dbPath, dir } = freshStore("t-gap");
    try {
      store.ensureAuditKeying("test");
      for (let i = 0; i < 5; i++) store.audit(`e${i}`, { i });
      store.close();

      // Delete one signed entry mid-segment and splice a forged replacement
      // with a non-contiguous counter.
      const raw = new Database(dbPath);
      raw.query(`DELETE FROM audit_log WHERE id = 3`).run();
      raw.query(`DELETE FROM audit_head`).run();
      raw.close();

      const reopened = new WorkspaceStore("t", dbPath);
      const v = reopened.verifyCrypto();
      expect(v.signaturesValid).toBe(false);
      expect(v.counterError).toBeTruthy();
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
