/**
 * XR Cloud — cryptography primitives.
 *
 * The scheme, stated plainly because the trust page has to describe it honestly:
 *
 *   KEK  (32 bytes, from env, never in the DB)
 *     └─ wraps → org_key (32 random bytes per org, in the DB only as ciphertext)
 *          └─ HKDF-SHA256(org_key, info = "xr:team-memory:v1:<workspaceId>")
 *               └─ AES-256-GCM per team-memory fact body
 *
 * Why this shape and not something simpler:
 *
 *   - A database dump alone yields no plaintext. `org_key_wrapped` is useless
 *     without the deployment KEK, which lives in the environment/secret manager.
 *   - Per-workspace derivation is *deterministic*, so there is no per-workspace
 *     key table that can be lost, mis-backed-up, or drift out of sync between
 *     replicas. Losing the org key loses team memory — which is exactly the
 *     blast radius a customer-managed-key product would have, and is why the
 *     brief scopes CMK to a later release.
 *   - `kek_id` is stored alongside every wrapped key so the KEK can be rotated
 *     by re-wrapping org keys without re-encrypting a single memory fact.
 *
 * This is **server-side encryption with exportable snapshots**, which is what the
 * brief's §A actually specifies for v1. It is NOT end-to-end encryption, and
 * nothing in the product or the trust page claims that it is. Per-message E2E is
 * explicitly v2.
 *
 * Constitution Art. IX.5 — secrets scoped, revocable, never logged. Every
 * function below takes and returns opaque strings or Buffers; none of them log,
 * and `redact()` is the only export that ever turns one into text.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** AES-256-GCM. 12-byte IV, 16-byte tag, base64 of `iv || ct || tag`. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

/** 32 cryptographically random bytes, base64. */
export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** URL-safe opaque token, `bytes` of entropy. Used for refresh/invite/device tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-typable code: 6 digits, uniform, no modulo bias. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return String(value % max).padStart(digits, "0");
}

/** SHA-256, hex. Used for token storage — always one-way for secrets at rest. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Constant-time string compare. Length differences short-circuit (not secret). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** base64 of `iv || ciphertext || tag`. */
export function encryptWithKey(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoError(`encryption key must be ${KEY_BYTES} bytes`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Inverse of `encryptWithKey`. Throws a CryptoError with a *terse* message on
 * tamper — the caller maps it to a 400/500, and the message never contains the
 * plaintext or the key.
 */
export function decryptWithKey(key: Buffer, encoded: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoError(`decryption key must be ${KEY_BYTES} bytes`);
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, "base64");
  } catch {
    throw new CryptoError("ciphertext is not valid base64");
  }
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new CryptoError("ciphertext is truncated");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ct = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered payload — indistinguishable on purpose.
    throw new CryptoError("ciphertext failed authentication");
  }
}

/**
 * HKDF-SHA256. `info` is the domain separator: it is what keeps a workspace key
 * from ever being a valid key for a different purpose, even if the same org key
 * is reused across features later.
 */
export function deriveKey(orgKey: Buffer, info: string, length = KEY_BYTES): Buffer {
  const out = hkdfSync("sha256", orgKey, Buffer.alloc(0), Buffer.from(info, "utf8"), length);
  return Buffer.from(out);
}

/** The one and only source of workspace memory keys. */
export function workspaceKey(orgKey: Buffer, workspaceId: string): Buffer {
  return deriveKey(orgKey, `xr:team-memory:v1:${workspaceId}`);
}

/**
 * A short, non-reversible digest of plaintext content. Used for dedupe and for
 * comparing two versions of a fact during last-writer-wins merge **without**
 * decrypting either. It is a salted-with-nothing SHA-256, so it leaks equality
 * of identical bodies — acceptable because it never leaves the tenant's own
 * rows and is never exposed through the API.
 */
export function bodyDigest(plaintext: string): string {
  return sha256Hex(plaintext).slice(0, 32);
}

/**
 * Envelope: wrap an org key under the deployment KEK. `kekId` is stored beside
 * the ciphertext so a rotated deployment can still read old rows during the
 * wrap-rotation window.
 */
export function wrapKey(kek: Buffer, key: Buffer): string {
  return encryptWithKey(kek, key.toString("base64"));
}

export function unwrapKey(kek: Buffer, wrapped: string): Buffer {
  const b64 = decryptWithKey(kek, wrapped);
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_BYTES) throw new CryptoError("unwrapped key has the wrong length");
  return key;
}

export function kekFromEnv(envValue: string): Buffer {
  const key = Buffer.from(envValue, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoError("XR_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/**
 * Cheap structural fingerprint of an org key, for proving two rows were wrapped
 * with the same KEK without ever comparing keys directly. Never reversible.
 */
export function keyFingerprint(key: Buffer): string {
  return sha256Hex(key).slice(0, 16);
}

/**
 * Redact a secret for a log line or an error message. Keeps a short prefix so an
 * operator can still tell *which* key was involved, and nothing else.
 */
export function redact(secret: string | undefined | null, keep = 6): string {
  if (!secret) return "(none)";
  if (secret.length <= keep) return "***";
  return `${secret.slice(0, keep)}…(${secret.length} chars)`;
}

/**
 * Provenance hash for the audit chain. Mirrors `src/security/audit-signer.ts`:
 * a stable serialisation of the row's meaningful fields, so any edit to a
 * persisted audit row breaks the link that the next row points at.
 *
 * Key order is fixed explicitly. `JSON.stringify` on an object literal is
 * insertion-ordered, which is stable for a literal but NOT for a row read back
 * out of Postgres — so the fields are listed here, once.
 */
export function auditEntryHash(input: {
  orgId: string;
  seq: number;
  actorKind: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  workspaceId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
}): string {
  const canonical = JSON.stringify([
    input.orgId,
    input.seq,
    input.actorKind,
    input.actorId ?? "",
    input.action,
    input.targetType ?? "",
    input.targetId ?? "",
    input.workspaceId ?? "",
    stableStringify(input.detail),
    input.createdAt,
    input.prevHash,
  ]);
  return sha256Hex(canonical);
}

/** Deterministic JSON: object keys sorted, so `{a,b}` and `{b,a}` hash alike. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
