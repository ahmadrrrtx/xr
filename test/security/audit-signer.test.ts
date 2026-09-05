/**
 * Phase 4 (Evidence Integrity, F-08) — Ed25519 audit signer unit tests.
 *
 * Covers: keypair gen/import round-trip, sign/verify, tampered-signature
 * rejection, wrong-key rejection, and the secret-storage round-trip via the
 * XR secret backends (isolated XR_HOME → AES-GCM file fallback in CI/sandbox).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAuditIdentity,
  signCheckpoint,
  verifyCheckpoint,
  checkpointMessage,
  publicIdentityFromPrivate,
  publicKeyFingerprint,
  loadOrCreateAuditIdentity,
  loadAuditSigningKey,
  storeAuditSigningKey,
  AUDIT_SIGNING_KEY_NAME,
} from "../../src/security/audit-signer.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-signer-home-"));
  prevHome = process.env.XR_HOME;
  process.env.XR_HOME = home;
  clearSecretMemo();
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  clearSecretMemo();
  rmSync(home, { recursive: true, force: true });
});

describe("Phase 4 · audit signer — Ed25519 primitives", () => {
  test("generated identity signs and verifies; pubkey derives from priv", () => {
    const id = generateAuditIdentity();
    expect(id.publicKeyB64).toBeTruthy();
    expect(id.privateKeyB64).toBeTruthy();
    expect(id.publicKeyFingerprint).toHaveLength(16);

    const derived = publicIdentityFromPrivate(id.privateKeyB64);
    expect(derived.publicKeyB64).toBe(id.publicKeyB64);
    expect(derived.publicKeyFingerprint).toBe(id.publicKeyFingerprint);

    const msg = checkpointMessage({ entryHash: "abc", counter: 3, publicKeyB64: id.publicKeyB64, kind: "head" });
    const sig = signCheckpoint(id.privateKeyB64, msg);
    expect(verifyCheckpoint(id.publicKeyB64, msg, sig)).toBe(true);
  });

  test("tampered signature or message fails verification", () => {
    const id = generateAuditIdentity();
    const msg = checkpointMessage({ entryHash: "aaa", counter: 1, publicKeyB64: id.publicKeyB64, kind: "checkpoint" });
    const sig = signCheckpoint(id.privateKeyB64, msg);

    // flipped signature
    const badSig = sig.slice(0, -2) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyCheckpoint(id.publicKeyB64, msg, badSig)).toBe(false);

    // different message (counter changed)
    const msg2 = checkpointMessage({ entryHash: "aaa", counter: 2, publicKeyB64: id.publicKeyB64, kind: "checkpoint" });
    expect(verifyCheckpoint(id.publicKeyB64, msg2, sig)).toBe(false);

    // malformed signature
    expect(verifyCheckpoint(id.publicKeyB64, msg, "not-base64!!")).toBe(false);
  });

  test("a different key's signature does not verify (wrong-key attack)", () => {
    const idA = generateAuditIdentity();
    const idB = generateAuditIdentity();
    expect(idA.publicKeyB64).not.toBe(idB.publicKeyB64);
    const msg = checkpointMessage({ entryHash: "h", counter: 0, publicKeyB64: idA.publicKeyB64, kind: "head" });
    const sigByB = signCheckpoint(idB.privateKeyB64, msg);
    // A's pubkey must reject a signature B made (even over A's message).
    expect(verifyCheckpoint(idA.publicKeyB64, msg, sigByB)).toBe(false);
  });

  test("checkpoint vs head messages are domain-separated", () => {
    const id = generateAuditIdentity();
    const cp = checkpointMessage({ entryHash: "h", counter: 5, publicKeyB64: id.publicKeyB64, kind: "checkpoint" });
    const head = checkpointMessage({ entryHash: "h", counter: 5, publicKeyB64: id.publicKeyB64, kind: "head" });
    const sigCp = signCheckpoint(id.privateKeyB64, cp);
    // A checkpoint signature must not validate as a head signature.
    expect(verifyCheckpoint(id.publicKeyB64, head, sigCp)).toBe(false);
  });

  test("fingerprint is stable and collision-free across keys", () => {
    const a = generateAuditIdentity();
    const b = generateAuditIdentity();
    expect(publicKeyFingerprint(a.publicKeyB64)).toBe(a.publicKeyFingerprint);
    expect(a.publicKeyFingerprint).not.toBe(b.publicKeyFingerprint);
  });
});

describe("Phase 4 · audit signer — secret-storage round-trip", () => {
  test("store → load round-trips through the secret backend", () => {
    clearSecretMemo();
    const id = generateAuditIdentity();
    storeAuditSigningKey(id.privateKeyB64);
    expect(AUDIT_SIGNING_KEY_NAME).toBe("XR_AUDIT_SIGN_KEY");

    clearSecretMemo(); // force a fresh read from the backend (not the memo)
    const loaded = loadAuditSigningKey();
    expect(loaded).toBe(id.privateKeyB64);
  });

  test("loadOrCreateAuditIdentity is stable across calls (same key)", () => {
    clearSecretMemo();
    const first = loadOrCreateAuditIdentity();
    expect(first).not.toBeNull();
    clearSecretMemo();
    const second = loadOrCreateAuditIdentity();
    expect(second!.publicKeyB64).toBe(first!.publicKeyB64);
    expect(second!.privateKeyB64).toBe(first!.privateKeyB64);
  });
});
