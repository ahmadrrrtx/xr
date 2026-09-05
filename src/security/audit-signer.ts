/**
 * XR Phase 4 (Evidence Integrity) — Ed25519 audit signer.
 *
 * F-08: the SHA-256 hash chain is tamper-EVIDENT (any edit breaks a link) but
 * not tamper-RESISTANT against a local attacker with SQLite write access: such
 * an attacker can truncate the chain and REBUILD every link consistently, so
 * `verifyChain()` replays green over forged history.
 *
 * This module adds the missing asymmetric anchor:
 *
 *   - A per-install Ed25519 keypair is generated at first keying and stored via
 *     the EXISTING secret backends (`secrets.ts`: Keychain / secret-service /
 *     DPAPI / AES-GCM file). No new storage mechanism is introduced.
 *   - The public key (SPKI, base64) is published into the audit chain itself
 *     in an `audit.keyed` event — the genesis of a signed segment. Re-keying
 *     appends an `audit.rekey` event carrying the new public key.
 *   - Checkpoints (every N entries, plus chain heads and re-key/keyed events)
 *     are SIGNED by the private key. An attacker who rebuilds the chain cannot
 *     reproduce a valid signature without the private key, so the forgery is
 *     detected by `xr audit verify --crypto`.
 *
 * THREAT MODEL (honest — see docs/security/AUDIT-EVIDENCE.md):
 *   ✅ Protects against silent local rewrite by an attacker who can write the
 *      database but NOT read the private key.
 *   ❌ Does NOT protect against an attacker who ALSO exfiltrates the private
 *      key (full host compromise). That is out of scope for the local key and
 *      is raised against by the optional, egress-gated remote anchor.
 *
 * The signer is local-only. It never performs network I/O.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { getSecretSyncCached, setSecret } from "./secrets.ts";

/** Secret name in the XR secret store (must match secrets' UPPER_SNAKE rule). */
export const AUDIT_SIGNING_KEY_NAME = "XR_AUDIT_SIGN_KEY";

/** Head/counter checkpoint signing cadence (sign the Nth signed entry). */
export const DEFAULT_SIGN_EVERY = 256;

/** An installed audit identity: the keypair plus its public fingerprints. */
export interface AuditIdentity {
  /** PKCS#8 DER private key, base64 (kept only in the secret store). */
  privateKeyB64: string;
  /** SPKI DER public key, base64 — the on-chain identity. */
  publicKeyB64: string;
  /** First 16 hex chars of SHA-256(SPKI DER), for human display. */
  publicKeyFingerprint: string;
}

/**
 * The canonical message that gets signed for a chain checkpoint / head.
 * Binds the entry hash to its running counter, the signing segment public key,
 * and a domain-separation prefix — so a signature cannot be replayed across
 * installs, segments, or roles.
 */
export function checkpointMessage(opts: {
  entryHash: string;
  counter: number;
  publicKeyB64: string;
  kind: "checkpoint" | "head";
}): Buffer {
  const body = JSON.stringify({
    xr: "xr-audit-v1",
    kind: opts.kind,
    entry: opts.entryHash,
    counter: opts.counter,
    pub: opts.publicKeyB64,
  });
  return Buffer.from(body, "utf8");
}

/** SHA-256 fingerprint (16 hex chars) of an SPKI-DER public key (base64 in). */
export function publicKeyFingerprint(publicKeyB64: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyB64, "base64"))
    .digest("hex")
    .slice(0, 16);
}

function toPrivateKey(privateKeyB64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function toPublicKey(publicKeyB64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki",
  });
}

/** Generate a fresh Ed25519 identity (keys as base64 DER). */
export function generateAuditIdentity(): AuditIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyB64 = privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64");
  const publicKeyB64 = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  return {
    privateKeyB64,
    publicKeyB64,
    publicKeyFingerprint: publicKeyFingerprint(publicKeyB64),
  };
}

/** Derive the public identity (pubkey + fingerprint) from a stored priv key. */
export function publicIdentityFromPrivate(privateKeyB64: string): {
  publicKeyB64: string;
  publicKeyFingerprint: string;
} {
  const priv = toPrivateKey(privateKeyB64);
  const pub = createPublicKey(priv);
  const publicKeyB64 = pub.export({ type: "spki", format: "der" }).toString("base64");
  return { publicKeyB64, publicKeyFingerprint: publicKeyFingerprint(publicKeyB64) };
}

/** Sign a checkpoint/head message; returns base64 Ed25519 signature. */
export function signCheckpoint(
  privateKeyB64: string,
  message: Buffer,
): string {
  return cryptoSign(null, message, toPrivateKey(privateKeyB64)).toString("base64");
}

/** Verify a base64 Ed25519 signature against an SPKI-base64 public key. */
export function verifyCheckpoint(
  publicKeyB64: string,
  message: Buffer,
  signatureB64: string,
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }
  try {
    return cryptoVerify(null, message, toPublicKey(publicKeyB64), sig);
  } catch {
    return false;
  }
}

/**
 * Load the installed audit signing key from the secret store.
 * Returns null when no key has been provisioned yet (unsigned/legacy install).
 */
export function loadAuditSigningKey(): string | null {
  return getSecretSyncCached(AUDIT_SIGNING_KEY_NAME) ?? null;
}

/** Persist a private key (base64 PKCS#8) through the existing secret backend. */
export function storeAuditSigningKey(privateKeyB64: string): void {
  setSecret(AUDIT_SIGNING_KEY_NAME, privateKeyB64);
}

/**
 * Result of an attempted load-or-create of the audit identity.
 *  - `unavailable`: the key cannot be loaded AND cannot be created (e.g. the
 *    secret backend is failing). Verification must report an honest
 *    "key unavailable, verification limited to chain" state.
 */
export interface LoadedAuditIdentity {
  privateKeyB64: string;
  publicKeyB64: string;
  publicKeyFingerprint: string;
}

/** Load the existing identity, or generate + persist a new one. */
export function loadOrCreateAuditIdentity(): LoadedAuditIdentity | null {
  const existing = loadAuditSigningKey();
  if (existing) {
    try {
      const pub = publicIdentityFromPrivate(existing);
      return { privateKeyB64: existing, ...pub };
    } catch {
      // A corrupt stored key must not be silently overwritten (it anchors the
      // existing chain); surface as unavailable so the operator re-keys.
      return null;
    }
  }
  const id = generateAuditIdentity();
  try {
    storeAuditSigningKey(id.privateKeyB64);
  } catch {
    return null;
  }
  return {
    privateKeyB64: id.privateKeyB64,
    publicKeyB64: id.publicKeyB64,
    publicKeyFingerprint: id.publicKeyFingerprint,
  };
}
