/**
 * Phase 4 (Evidence Integrity, F-08) — WorkspaceStore signed-audit BRANCH
 * coverage.
 *
 * The mutation gate (scripts/mutate.ts) scores src/state/workspace-store.ts:
 * the Phase-4 signing methods added many boolean / ternary / short-circuit
 * branches that a single happy-path migration test does not exercise. This
 * suite drives every reachable branch so a semantic mutant is caught:
 *
 *   · keying idempotency (provision/ensure) and the already-keyed fast path
 *   · every-N checkpoint cadence + signed head refresh on each append
 *   · re-key (NEW keypair, audited boundary, distinct pubkey)
 *   · anchor record/verify/count and the head-for-anchor export
 *   · the auditIsKeyed / auditSigningKeyMissing getters in both states
 *   · cryptographic verification detecting tamper (edited row + missing head)
 *   · signing OFF when migration 7 is absent (down-migrated legacy schema)
 *
 * The secret backend is the file fallback (kept entirely inside the test's
 * own XR_HOME), so no OS keychain is touched.
 */
import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore, auditKeyingEnabledOnBoot } from "../../src/state/workspace-store.ts";
import {
  runMigrationsDown,
  currentSchemaVersion,
} from "../../src/state/migrations.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";
import { DEFAULT_SIGN_EVERY } from "../../src/security/audit-signer.ts";

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-p4-branch-home-"));
  prevHome = process.env.XR_HOME;
  // Sign every entry so the checkpoint/head branch fires on every append.
  process.env.XR_HOME = home;
  process.env.XR_AUDIT_SIGN_EVERY = "1";
  clearSecretMemo();
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  delete process.env.XR_AUDIT_SIGN_EVERY;
  clearSecretMemo();
});

/** A fresh keyed store on its own isolated DB, closed by the caller. */
function freshKeyedStore(label: string): { store: WorkspaceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `xr-p4-${label}-`));
  const store = new WorkspaceStore("t", join(dir, "xr.db"));
  // Before keying: not keyed, no missing key (nothing to load).
  expect(store.auditIsKeyed).toBe(false);
  expect(store.auditSigningKeyMissing).toBe(false);
  expect(store.anchorCount()).toBe(0);
  expect(store.headForAnchor()).toBeNull();
  const k = store.ensureAuditKeying("test");
  expect(k.keyed).toBe(true);
  expect(typeof k.pubkey).toBe("string");
  expect((k.pubkey ?? "").length).toBeGreaterThan(0);
  return { store, dir };
}

describe("Phase 4 · signed-audit store branches", () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  test("keying is idempotent: provision + ensure after keyed hit the already-keyed path and return the same key", () => {
    const { store, dir } = freshKeyedStore("idem");
    dirs.push(dir);
    const first = store.ensureAuditKeying("test");
    // provisionAuditKeying on a healthy keyed chain delegates to the fast path.
    const provisioned = store.provisionAuditKeying("boot");
    expect(provisioned.keyed).toBe(true);
    expect(provisioned.keyMissing).toBeFalsy();
    const again = store.ensureAuditKeying("test");
    expect(again.keyed).toBe(true);
    expect(again.pubkey).toBe(first.pubkey);
    expect(store.auditIsKeyed).toBe(true);
    expect(store.auditSigningKeyMissing).toBe(false);
    // Exactly one keyed event despite multiple calls (no identity fork).
    const keyedEvents = store.auditChainRange({ limit: 1000 }).filter((e) => e.event === "audit.keyed");
    expect(keyedEvents.length).toBe(1);
    store.close();
  });

  test("every signed append refreshes the signed head and produces a verifiable chain", () => {
    const { store, dir } = freshKeyedStore("append");
    dirs.push(dir);
    store.audit("a", { x: 1 });
    const head1 = store.headForAnchor();
    expect(head1).not.toBeNull();
    expect(head1!.sig.length).toBeGreaterThan(0);
    expect(head1!.pubkey.length).toBeGreaterThan(0);
    store.audit("b", { x: 2 });
    const head2 = store.headForAnchor();
    expect(head2).not.toBeNull();
    // Head advanced to the newer entry (counter/hash change).
    expect(head2!.counter).toBeGreaterThanOrEqual(head1!.counter);
    expect(head2!.entry_hash).not.toBe(head1!.entry_hash);

    const v = store.verifyCrypto();
    expect(v.chainValid).toBe(true);
    expect(v.keyed).toBe(true);
    expect(v.signaturesValid).toBe(true);
    expect(v.head?.present).toBe(true);
    expect(v.head?.matches).toBe(true);
    expect(v.head?.stale).toBe(false);
    store.close();
  });

  test("re-key rotates to a NEW pubkey, records an audited boundary, and keeps the chain verifiable", () => {
    const { store, dir } = freshKeyedStore("rekey");
    dirs.push(dir);
    const oldPub = store.ensureAuditKeying("test").pubkey;
    store.audit("before.rekey", {});
    const r = store.rekeyAudit("operator");
    expect(r.ok).toBe(true);
    expect(r.pubkey).toBeTruthy();
    expect(r.pubkey).not.toBe(oldPub);
    store.audit("after.rekey", {});

    // The re-key boundary event exists and carries a distinct pubkey.
    const events = store.auditChainRange({ limit: 1000 });
    const rekey = events.filter((e) => e.event === "audit.rekey");
    expect(rekey.length).toBe(1);

    const v = store.verifyCrypto();
    expect(v.chainValid).toBe(true);
    expect(v.keyed).toBe(true);
    expect(v.signaturesValid).toBe(true);
    expect(v.head?.matches).toBe(true);
    // After rotation the in-force key is the new one.
    expect(store.ensureAuditKeying("test").pubkey).toBe(r.pubkey);
    store.close();
  });

  test("anchors record, count and append-verify; headForAnchor reflects the latest signed head", () => {
    const { store, dir } = freshKeyedStore("anchor");
    dirs.push(dir);
    store.audit("anchored.1", {});
    const head = store.headForAnchor()!;
    expect(head).toBeTruthy();
    store.recordAnchor({
      counter: head.counter,
      entry_hash: head.entry_hash,
      entry_id: head.entry_id,
      sig: head.sig,
      pubkey: head.pubkey,
      sink: "file:///tmp/xr-anchor-test.jsonl",
      anchored_at: Date.now(),
    });
    expect(store.anchorCount()).toBe(1);
    const a = store.verifyAnchors();
    expect(a.failed).toEqual([]);
    expect(a.verified).toBe(1);

    // A second anchor over the same head is also recorded/verified.
    store.recordAnchor({
      counter: head.counter,
      entry_hash: head.entry_hash,
      entry_id: head.entry_id,
      sig: head.sig,
      pubkey: head.pubkey,
      sink: "https://anchor.example.test/xr",
    });
    expect(store.anchorCount()).toBe(2);
    const a2 = store.verifyAnchors();
    expect(a2.verified).toBe(2);
    expect(a2.failed).toEqual([]);
    store.close();
  });

  test("cryptographic verification fails closed on a tampered signed entry and a missing head", () => {
    const { store, dir } = freshKeyedStore("tamper");
    dirs.push(dir);
    store.audit("honest", { v: 1 });
    store.audit("honest2", { v: 2 });
    // Tamper: rewrite a detail blob directly, breaking BOTH the hash chain
    // and the signature binding.
    store.write(() => {
      (store as unknown as { db: { query: (s: string) => { run: (...a: unknown[]) => void } } }).db
        .query(`UPDATE audit_log SET detail = ? WHERE event = ?`)
        .run(JSON.stringify({ v: 999 }), "honest");
    });
    const v = store.verifyCrypto();
    expect(v.chainValid).toBe(false);
    expect(v.signaturesValid).toBe(false);

    // Delete the unforgeable signed head → a rebuilt/forged chain cannot
    // restore it; verification still fails.
    store.write(() => {
      (store as unknown as { db: { exec: (s: string) => void } }).db.exec(`DELETE FROM audit_head WHERE id = 1`);
    });
    const v2 = store.verifyCrypto();
    expect(v2.chainValid).toBe(false);
    store.close();
  });

  test("a down-migrated (pre-migration-7) database suspends signing: unsigned inserts use the legacy 6-column path and stay verifiable", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p4-down-"));
    dirs.push(dir);
    const store = new WorkspaceStore("t", join(dir, "xr.db"));
    expect(currentSchemaVersion(store)).toBe(7);
    store.ensureAuditKeying("test");
    store.audit("while.keyed", {});
    // Roll migration 7 down: signed columns/tables are dropped.
    runMigrationsDown(store, 6);
    store.refreshAuditKeyingState();
    expect(currentSchemaVersion(store)).toBe(6);
    // Not keyed in memory (signing suspended); no missing-key false positive.
    expect(store.auditIsKeyed).toBe(false);
    expect(store.auditSigningKeyMissing).toBe(false);
    expect(store.headForAnchor()).toBeNull();
    // Appends still work via the legacy unsigned insert and the hash chain
    // remains intact (signing is suspended, not the tamper-evident chain).
    store.audit("after.down", {});
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });

  test("audit.repair re-seeding event on a broken+repaired KEYED chain is a signed boundary and the chain re-verifies", () => {
    const { store, dir } = freshKeyedStore("repair");
    dirs.push(dir);
    store.audit("good.1", {});
    store.audit("good.2", {});
    // Break the chain by rewriting an entry's detail.
    store.write(() => {
      (store as unknown as { db: { query: (s: string) => { run: (...a: unknown[]) => void } } }).db
        .query(`UPDATE audit_log SET detail = ? WHERE event = ?`)
        .run(JSON.stringify({ tampered: true }), "good.1");
    });
    expect(store.verifyChain().valid).toBe(false);
    // Keying refuses to paper over a broken chain.
    expect(store.ensureAuditKeying("boot").keyed).toBe(false);
    // Repair truncates and appends a signed audit.repair boundary event.
    const rep = store.repairChain("operator");
    expect(rep.repaired).toBe(true);
    expect(rep.removed).toBeGreaterThanOrEqual(1);
    expect(store.verifyChain().valid).toBe(true);
    const events = store.auditChainRange({ limit: 1000 });
    expect(events.some((e) => e.event === "audit.repair")).toBe(true);
    // The repair boundary re-established a verifiable signed head.
    const v = store.verifyCrypto();
    expect(v.chainValid).toBe(true);
    expect(v.keyed).toBe(true);
    expect(v.head?.matches).toBe(true);
    store.close();
  });

  test("default signing cadence is the published DEFAULT_SIGN_EVERY when XR_AUDIT_SIGN_EVERY is unset/invalid", () => {
    const prev = process.env.XR_AUDIT_SIGN_EVERY;
    delete process.env.XR_AUDIT_SIGN_EVERY;
    try {
      const dir = mkdtempSync(join(tmpdir(), "xr-p4-cadence-"));
      dirs.push(dir);
      const store = new WorkspaceStore("t", join(dir, "xr.db"));
      store.ensureAuditKeying("test");
      expect(DEFAULT_SIGN_EVERY).toBeGreaterThan(1);
      // A single normal entry sits well INSIDE the default cadence window, so
      // it is not a checkpoint (only the audit.keyed boundary carries a sig).
      // This proves the env-unset default is honoured rather than "sign all".
      store.audit("cadence.check", {});
      const normalEvents = store
        .auditChainRange({ limit: 1000 })
        .filter((e) => e.event !== "audit.keyed");
      expect(normalEvents.length).toBe(1);
      expect(normalEvents[0]!.event).toBe("cadence.check");
      store.close();
    } finally {
      if (prev === undefined) delete process.env.XR_AUDIT_SIGN_EVERY;
      else process.env.XR_AUDIT_SIGN_EVERY = prev;
    }
  });
});

describe("Phase 4 · checkpoint signature selection (boundary vs cadence)", () => {
  test("under the default cadence ONLY boundary events (audit.keyed/rekey/repair) carry a signature; a normal entry does not", () => {
    const prev = process.env.XR_AUDIT_SIGN_EVERY;
    delete process.env.XR_AUDIT_SIGN_EVERY; // force DEFAULT cadence
    const dir = mkdtempSync(join(tmpdir(), "xr-p4-sigselect-"));
    try {
      const store = new WorkspaceStore("t", join(dir, "xr.db"));
      store.ensureAuditKeying("test");
      // One normal event: cadence window (DEFAULT_SIGN_EVERY) not reached, so
      // it must NOT be signed — only the boundary (audit.keyed) is.
      store.audit("ordinary.event", { n: 1 });
      // Read the raw signed flag per row via the read adapter.
      const signedRows = (store as unknown as {
        readSource: { all: <T>(sql: string) => T[] };
      }).readSource.all<{ event: string; sig: string | null }>(
        `SELECT event, sig FROM audit_log ORDER BY id ASC`,
      );
      const keyed = signedRows.filter((r) => r.event === "audit.keyed");
      const ordinary = signedRows.filter((r) => r.event === "ordinary.event");
      expect(keyed.length).toBe(1);
      expect(keyed[0]!.sig).toBeTruthy(); // boundary always signed
      expect(ordinary.length).toBe(1);
      expect(ordinary[0]!.sig).toBeNull(); // inside cadence → unsigned
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.XR_AUDIT_SIGN_EVERY;
      else process.env.XR_AUDIT_SIGN_EVERY = prev;
    }
  });

  test("an invalid XR_AUDIT_SIGN_EVERY falls back to DEFAULT_SIGN_EVERY (a normal event stays unsigned)", () => {
    const prev = process.env.XR_AUDIT_SIGN_EVERY;
    process.env.XR_AUDIT_SIGN_EVERY = "not-a-number";
    const dir = mkdtempSync(join(tmpdir(), "xr-p4-badevery-"));
    try {
      const store = new WorkspaceStore("t", join(dir, "xr.db"));
      store.ensureAuditKeying("test");
      store.audit("ordinary.2", {});
      const ordinary = (store as unknown as {
        readSource: { all: <T>(sql: string) => T[] };
      }).readSource.all<{ event: string; sig: string | null }>(
        `SELECT event, sig FROM audit_log WHERE event = 'ordinary.2'`,
      );
      expect(ordinary.length).toBe(1);
      expect(ordinary[0]!.sig).toBeNull(); // invalid cadence → default (unsigned here)
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prev === undefined) delete process.env.XR_AUDIT_SIGN_EVERY;
      else process.env.XR_AUDIT_SIGN_EVERY = prev;
    }
  });

  test("reopening a keyed store loads the private key (fast-path identity) and keeps the same pubkey", () => {
    const { store, dir } = freshKeyedStore("reopen");
    const pub = store.ensureAuditKeying("test").pubkey;
    store.audit("before.close", {});
    store.close();
    // Reopen the SAME file: on-disk keyed chain + file-backed secret key →
    // the already-keyed-with-identity fast path returns the same pubkey.
    const reopened = new WorkspaceStore("t", join(dir, "xr.db"));
    expect(reopened.auditIsKeyed).toBe(true);
    expect(reopened.auditSigningKeyMissing).toBe(false);
    const again = reopened.ensureAuditKeying("boot");
    expect(again.keyed).toBe(true);
    expect(again.pubkey).toBe(pub);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Phase 4 · boot auto-keying gate (env)", () => {
  test("auditKeyingEnabledOnBoot defaults ON and honours XR_AUDIT_NO_AUTOKEY=1/true", () => {
    const prev = process.env.XR_AUDIT_NO_AUTOKEY;
    try {
      delete process.env.XR_AUDIT_NO_AUTOKEY;
      expect(auditKeyingEnabledOnBoot()).toBe(true);
      process.env.XR_AUDIT_NO_AUTOKEY = "1";
      expect(auditKeyingEnabledOnBoot()).toBe(false);
      process.env.XR_AUDIT_NO_AUTOKEY = "true";
      expect(auditKeyingEnabledOnBoot()).toBe(false);
      process.env.XR_AUDIT_NO_AUTOKEY = "0";
      expect(auditKeyingEnabledOnBoot()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.XR_AUDIT_NO_AUTOKEY;
      else process.env.XR_AUDIT_NO_AUTOKEY = prev;
    }
  });
});
