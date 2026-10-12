/**
 * XR — Discord interactions-webhook signature verification (Phase 26).
 *
 * Gateway mode is the default and needs none of this. Webhook mode only exists
 * for users who already run a public HTTPS reverse proxy; Discord then calls
 * `POST /api/discord/webhook` and signs every request with the application's
 * Ed25519 key. An unsigned or stale request is dropped before any parsing, and
 * the route is the one daemon endpoint that does not require the bearer token
 * (the signature IS the authentication).
 *
 * No dependency: Node's crypto verifies Ed25519, and a raw 32-byte public key
 * is wrapped in the fixed SPKI prefix Discord documents.
 */
import { createPublicKey, verify } from "node:crypto";

/** ASN.1 prefix for an Ed25519 SubjectPublicKeyInfo (RFC 8410). */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Discord's replay window: a signed timestamp older than this is refused. */
export const MAX_SKEW_MS = 5 * 60_000;

export interface VerifyInput {
  publicKey: string;
  signature: string | null;
  timestamp: string | null;
  body: string;
  now?: number;
}

export function verifyInteractionSignature(input: VerifyInput): { ok: true } | { ok: false; reason: string } {
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing signature" };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  const now = input.now ?? Date.now();
  if (Math.abs(now - ts * 1000) > MAX_SKEW_MS) return { ok: false, reason: "stale timestamp" };
  const raw = input.publicKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return { ok: false, reason: "no application public key configured" };
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw, "hex")]), format: "der", type: "spki" });
    const ok = verify(null, Buffer.from(input.timestamp + input.body, "utf8"), key, Buffer.from(input.signature, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
  } catch {
    return { ok: false, reason: "verification failed" };
  }
}

/** Is this string a Discord application public key (64 hex chars)? */
export function isPublicKey(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());
}
