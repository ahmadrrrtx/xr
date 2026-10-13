/**
 * XR Cloud — Business licence minting.
 *
 * ## The design rule that makes the tier honest
 *
 * `feat` below is a list of **cloud surfaces**: team management, SSO
 * administration, managed models, relay, memory sync, audit export. There is no
 * value in this vocabulary for "voice", "local models", "CLI", "themes",
 * "mobile PWA", "skills" or anything else that already works on a machine that
 * has never heard of this service.
 *
 * That is not a policy — it is a type. The desktop client maps `feat` entries to
 * UI affordances and there is nothing else it *can* do with them, so the class
 * of bug "we accidentally paywalled a local feature" cannot be expressed. When a
 * later phase wants to gate something cloud-side, it adds a cloud service; when
 * it wants to gate something local-side, the only way to express it is to edit
 * the client, which is where the reviewer will see it.
 *
 * ## Verification is offline
 *
 * The licence is an Ed25519 JWT. The desktop bakes in the public key and verifies
 * with `node:crypto` — **no network call is required to enter or remain in
 * Business mode**. A machine that has been offline for a month still opens its
 * team workspace list, because the alternative (phoning home to decide whether
 * the UI works) is the thing this project exists not to do.
 *
 * ## Grace is a client rule, not a server favour
 *
 * `exp` is minted at `now + 1 day`. The client does not lock team UI until
 * `exp + 30 days`. The short server-side expiry means a cancelled subscription
 * stops being *refreshed* almost immediately, while the long client-side grace
 * means a cancelled subscription does not stop *working* for a month — and a
 * cancelled subscription never stops anything local, at any time, for any reason.
 */

import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload } from "jose";

import { loadEnv } from "../env.ts";
import { CryptoError } from "./crypto.ts";
import { internal } from "./errors.ts";

/**
 * The complete set of Business entitlements. Frozen at the type level so a
 * typo in a route cannot invent an entitlement that the desktop ignores.
 */
export const BUSINESS_FEATURES = [
  "team",
  "team-workspaces",
  "sso-admin",
  "managed-models",
  "relay",
  "memory-sync",
  "audit-export",
  "admin-console",
] as const;

export type BusinessFeature = (typeof BUSINESS_FEATURES)[number];

/** Server-side licence lifetime. Short, so cancellation stops refresh quickly. */
export const LICENSE_TTL_SECONDS = 24 * 60 * 60;

/** Client-side grace after `exp` before team UI locks. Documented in the docs. */
export const LICENSE_GRACE_DAYS = 30;

export interface MintLicenseInput {
  userId: string;
  orgId: string;
  plan: "business";
  seats: number;
  features?: readonly BusinessFeature[];
}

export interface LicenseClaims extends JWTPayload {
  org: string;
  plan: "business";
  seats: number;
  feat: string[];
}

/** jose v6 dropped the `KeyLike` alias; the inferred return type is authoritative. */
type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

let privateKeyCache: SigningKey | undefined;

async function privateKey(): Promise<SigningKey> {
  const env = loadEnv();
  if (!env.XR_LICENSE_PRIVATE_KEY) {
    throw internal();
  }
  if (!privateKeyCache) {
    try {
      privateKeyCache = await importPKCS8(env.XR_LICENSE_PRIVATE_KEY, "EdDSA");
    } catch {
      // A malformed signing key is a deployment defect. Say so plainly rather
      // than minting unsigned licences that verify nowhere.
      throw new CryptoError(
        "XR_LICENSE_PRIVATE_KEY is not a valid PKCS#8 Ed25519 private key (base64). " +
          "Generate one with `bun run license:keypair`.",
      );
    }
  }
  return privateKeyCache;
}

export async function mintLicense(input: MintLicenseInput): Promise<{
  token: string;
  jti: string;
  expiresAt: Date;
}> {
  const env = loadEnv();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + LICENSE_TTL_SECONDS) * 1000);
  const jti = crypto.randomUUID();

  const token = await new SignJWT({
    org: input.orgId,
    plan: input.plan,
    seats: input.seats,
    // Only ever the frozen vocabulary. A caller cannot smuggle an extra entry in.
    feat: [...(input.features ?? BUSINESS_FEATURES)],
  })
    .setProtectedHeader({ alg: "EdDSA", kid: env.XR_LICENSE_KID, typ: "JWT" })
    .setIssuer(env.API_URL)
    .setSubject(input.userId)
    .setAudience("xr-desktop")
    .setIssuedAt(now)
    .setExpirationTime(now + LICENSE_TTL_SECONDS)
    .setJti(jti)
    .sign(await privateKey());

  return { token, jti, expiresAt };
}

/**
 * Server-side verify. Used by `/license/refresh` to decide whether the caller's
 * *existing* licence is still good, and by tests. The authoritative issuance
 * decision is always re-derived from the subscription row.
 */
export async function verifyLicense(
  token: string,
  publicKeyPemOrBase64Spki: string,
): Promise<LicenseClaims> {
  const key = await importSPKI(
    publicKeyPemOrBase64Spki.includes("BEGIN")
      ? publicKeyPemOrBase64Spki
      : `-----BEGIN PUBLIC KEY-----\n${publicKeyPemOrBase64Spki}\n-----END PUBLIC KEY-----`,
    "EdDSA",
  );
  const { payload } = await jwtVerify(token, key, {
    issuer: loadEnv().API_URL,
    audience: "xr-desktop",
  });
  return payload as LicenseClaims;
}

/**
 * Which entitlements a subscription status grants.
 *
 * `past_due` keeps entitlements on purpose: Stripe is still retrying, the
 * customer has not cancelled, and cutting a team off the moment a card expires
 * is the behaviour this product exists to not have. `canceled` and `unpaid`
 * grant none — and grant none *only* to cloud surfaces.
 */
export function featuresForStatus(
  status: "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete",
): BusinessFeature[] {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
      return [...BUSINESS_FEATURES];
    case "unpaid":
    case "canceled":
    case "incomplete":
      return [];
  }
}
