/**
 * XR Cloud — session tokens.
 *
 * Two tokens, two jobs, two lifetimes:
 *
 *   - **Access token** — a short-lived HS256 JWT (15 min default). Stateless, so
 *     the hot path costs one HMAC and zero queries. It carries `sid`, so a
 *     revoked session can still be enforced at refresh time.
 *   - **Refresh token** — 32 opaque bytes, stored **only as a SHA-256 hash**,
 *     rotated on every use, and grouped into a `familyId`. Presenting a token
 *     that has already been rotated means someone has a stolen copy, and the
 *     entire family is revoked rather than just that one token.
 *
 * The access token intentionally does NOT carry entitlements. A plan change, a
 * seat change, or a policy edit must take effect on the next request, and baking
 * a plan into a 15-minute token would make "the admin changed it" untrue for up
 * to 15 minutes. Entitlements are read from the database where they are cheap
 * (one indexed row) and where they cannot go stale.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import { loadEnv } from "../env.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { sessionExpired, unauthorized } from "./errors.ts";

export interface AccessTokenClaims extends JWTPayload {
  /** Session id — lets a revocation land before natural expiry. */
  sid: string;
  sub: string;
  /** Active org, if the session is bound to one. */
  org?: string;
  /** Role inside that org. Advisory only; every route re-checks against the DB. */
  role?: string;
  kind: "web" | "device" | "cli" | "vscode" | "mobile";
}

function secretKey(): Uint8Array {
  const env = loadEnv();
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function mintAccessToken(claims: {
  userId: string;
  sessionId: string;
  orgId?: string | null;
  role?: string | null;
  kind: AccessTokenClaims["kind"];
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: Date; expiresInSeconds: number }> {
  const env = loadEnv();
  const ttl = claims.ttlSeconds ?? env.SESSION_ACCESS_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + ttl) * 1000);

  const token = await new SignJWT({
    sid: claims.sessionId,
    org: claims.orgId ?? undefined,
    role: claims.role ?? undefined,
    kind: claims.kind,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(env.API_URL)
    .setAudience("xr-cloud")
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(randomToken(8))
    .sign(secretKey());

  return { token, expiresAt, expiresInSeconds: ttl };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: loadEnv().API_URL,
      audience: "xr-cloud",
    });
    if (typeof payload.sid !== "string" || typeof payload.sub !== "string") {
      throw unauthorized("Access token is missing required claims.");
    }
    return payload as AccessTokenClaims;
  } catch (error) {
    if (error instanceof Error && error.name === "JWTExpired") {
      // Distinct code so the client knows to refresh rather than re-authenticate.
      throw sessionExpired();
    }
    throw unauthorized("Access token is not valid.");
  }
}

export interface RefreshTokenMaterial {
  /** The only copy that leaves the server. */
  readonly token: string;
  /** What gets stored. */
  readonly hash: string;
}

export function mintRefreshToken(): RefreshTokenMaterial {
  const token = randomToken(32);
  return { token, hash: sha256Hex(token) };
}

export function hashRefreshToken(token: string): string {
  return sha256Hex(token);
}

/** Family ids group a rotation chain so theft can revoke the whole line. */
export function newFamilyId(): string {
  return randomToken(12);
}
