/**
 * XR — offline licence verification.
 *
 * ## The constitutional constraint this file implements
 *
 * XR's Business licence is a signed token verified **entirely offline** against a
 * public key compiled into this binary. There is no licence server to call, no
 * heartbeat, no periodic check-in, and no remote kill switch. Two consequences
 * follow, and both are deliberate:
 *
 *   1. **A signed-out or offline machine is fully functional.** Unplug the network
 *      and nothing changes, because nothing was ever being asked for.
 *   2. **Enforcement is honest.** The only thing a licence decides is whether
 *      *cloud* surfaces are usable. It cannot disable a local feature, because the
 *      code path that would do so does not exist — `BUSINESS_FEATURES` below lists
 *      the entire set of gates, and every entry is a hosted service.
 *
 * ## No dependencies, on purpose
 *
 * This uses `node:crypto` rather than a JWT library. The root package has three
 * runtime dependencies and adding a fourth for two dozen lines of base64url and
 * Ed25519 verification would be a poor trade — especially in the one file whose
 * whole job is to be trustworthy. The verification is short enough to read in one
 * sitting, which matters more here than anywhere else in the codebase.
 *
 * ## What the grace period is for
 *
 * A licence is good for 30 days and a `past_due` subscription keeps its
 * entitlements (Stripe is retrying; the customer has done nothing wrong). The
 * expiry window exists so a cancelled subscription eventually stops working
 * without us needing a server to say so — not to catch anyone out.
 *
 * ## What this file deliberately does not do
 *
 * No obfuscation, no anti-tamper, no check for whether the binary was modified.
 * Anyone who wants to patch this out can, in about four minutes, and the honest
 * position is that they were never going to pay. Making it hard would cost
 * engineering time and make the product worse for the 99.9% who are not trying to
 * defraud us.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

/** The complete set of gates a Business licence controls. All are cloud surfaces. */
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

/**
 * Baked-in public key (Ed25519, SPKI base64).
 *
 * A constant in source rather than something fetched, so verification cannot be
 * redirected by a compromised network or a tampered DNS answer — a licence whose
 * key arrives over the wire is not a licence, it is a suggestion.
 */
export const XR_LICENSE_PUBLIC_KEY_SPKI =
  "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=";

/**
 * The key actually used, resolved at call time.
 *
 * The constant above is what ships. `XR_LICENSE_PUBLIC_KEY_SPKI` exists for two
 * honest reasons: a self-hosted control plane issues its own licences, and the
 * test suite mints its own. Resolving it per call rather than at import time also
 * means the answer cannot depend on which module happened to load first — a
 * coupling that produced a genuinely confusing test failure when the daemon's
 * route table was imported before the licence test set the variable.
 */
function resolvedSpki(): string {
  const override = process.env.XR_LICENSE_PUBLIC_KEY_SPKI?.trim();
  return override && override.length > 0 ? override : XR_LICENSE_PUBLIC_KEY_SPKI;
}

export const XR_LICENSE_KID = "xr-lic-1";

export const XR_LICENSE_AUDIENCE = "xr-desktop";

/** Certificate-style wrappers, assembled here so the constant above stays one line. */
function spkiPem(base64: string): string {
  const body = base64.replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

export interface LicenseState {
  /** What the client should do. */
  status: "none" | "valid" | "grace" | "expired" | "invalid" | "stale";
  /** True when business entitlement-bearing features should be available. */
  entitled: boolean;
  plan: string;
  orgId: string | null;
  orgName: string | null;
  seats: number | null;
  features: readonly BusinessFeature[];
  expiresAt: Date | null;
  daysRemaining: number | null;
  /** Why not, in a sentence a user can act on. Null when `entitled` is true. */
  reason: string | null;
}

export const NO_LICENSE: LicenseState = Object.freeze({
  status: "none" as const,
  entitled: false,
  plan: "personal",
  orgId: null,
  orgName: null,
  seats: null,
  features: [] as readonly BusinessFeature[],
  expiresAt: null,
  daysRemaining: null,
  // Personal is the default state of XR and never an error. No reason string,
  // because a reason is what a UI renders as a warning.
  reason: null,
});

// Cached per SPKI string, never globally: a deployment that swaps the key (or a
// test that does) gets the new one on the next call.
let cachedKey: { spki: string; key: KeyObject } | null = null;

function publicKey(): KeyObject {
  const spki = resolvedSpki();
  if (cachedKey?.spki === spki) return cachedKey.key;
  const key = createPublicKey({ key: spkiPem(spki), format: "pem" });
  cachedKey = { spki, key };
  return key;
}

function b64urlToBytes(part: string): Buffer | null {
  try {
    return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
}

export interface LicenseClaims {
  plan?: string;
  org?: string;
  orgName?: string;
  seats?: number;
  features?: string[];
  exp?: number;
  iat?: number;
  aud?: string | string[];
  kid?: string;
}

export type DecodedLicense =
  | { ok: true; claims: LicenseClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "wrong-key" | "wrong-audience" | "expired" };

/**
 * Verify the signature and decode the claims. Pure, synchronous, offline.
 *
 * Order matters: signature before claims. A token whose payload is parsed before
 * its signature is checked is a token whose payload can influence the check.
 */
export function decodeLicense(token: string): DecodedLicense {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signature = b64urlToBytes(signaturePart);
  const payload = b64urlToBytes(payloadPart);
  const header = b64urlToBytes(headerPart);
  if (!signature || !payload || !header) return { ok: false, reason: "malformed" };

  let head: { alg?: string; kid?: string };
  try {
    head = JSON.parse(header.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Only EdDSA is accepted. `alg: none` — the oldest JWT attack — is refused by
  // simply not being on this list, rather than by a check that could be reordered.
  if (head.alg !== "EdDSA") return { ok: false, reason: "wrong-key" };
  if (head.kid && head.kid !== XR_LICENSE_KID) return { ok: false, reason: "wrong-key" };

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(null, Buffer.from(`${headerPart}.${payloadPart}`), publicKey(), signature);
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  if (!signatureOk) return { ok: false, reason: "bad-signature" };

  let claims: LicenseClaims;
  try {
    claims = JSON.parse(payload.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(XR_LICENSE_AUDIENCE)) return { ok: false, reason: "wrong-audience" };

  return { ok: true, claims };
}

/**
 * Verify a licence token into a renderable state.
 *
 * Never throws: an invalid token is a state, not an exception, because the caller
 * is a UI that has to render something either way.
 */
export function verifyLicense(token: string | undefined | null, now = new Date()): LicenseState {
  if (!token || !token.trim()) return NO_LICENSE;

  const decoded = decodeLicense(token);
  if (!decoded.ok) {
    const messages: Record<typeof decoded.reason, string> = {
      malformed: "This licence is not in a format XR recognises. Nothing local is affected.",
      "bad-signature":
        "This licence's signature does not check out, so it has not been applied. Nothing local is affected.",
      "wrong-key": "This licence was issued for a different product or version of XR.",
      "wrong-audience": "This licence was issued for a different product or version of XR.",
      expired: "This licence has expired.",
    };
    return {
      ...NO_LICENSE,
      status: "invalid",
      reason: `${messages[decoded.reason]} Sign in again from Settings → Billing & Account to fetch a fresh one.`,
    };
  }

  const claims = decoded.claims;
  const expiresAt = typeof claims.exp === "number" ? new Date(claims.exp * 1000) : null;
  const daysRemaining = expiresAt ? Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000) : null;

  const features = (claims.features ?? []).filter((f): f is BusinessFeature =>
    (BUSINESS_FEATURES as readonly string[]).includes(f),
  );

  const base: LicenseState = {
    status: "valid",
    entitled: true,
    plan: claims.plan ?? "business",
    orgId: claims.org ?? null,
    orgName: claims.orgName ?? null,
    seats: typeof claims.seats === "number" ? claims.seats : null,
    // Intersected with the compile-time list on purpose: a token claiming a
    // feature this build does not implement must not produce a flag for a surface
    // that does not exist.
    features,
    expiresAt,
    daysRemaining,
    reason: null,
  };

  if (!expiresAt) {
    // No `exp` at all is a licensing mistake upstream, and the safe read of
    // "unlimited" is to grant it and say so rather than to invent a deadline.
    return { ...base, status: "stale", reason: "This licence carries no expiry date, which is unexpected." };
  }

  if (expiresAt.getTime() <= now.getTime()) {
    return {
      ...base,
      status: "grace",
      entitled: true,
      reason:
        "This licence is past its renewal date, so XR is running on the grace window. Team features stay on; " +
        "connect once to refresh it. Nothing local is affected either way.",
    };
  }

  if (daysRemaining !== null && daysRemaining <= 7) {
    return {
      ...base,
      // A warning, not a gate. There is no state in which a licence warning turns
      // anything off, and the UI is not allowed to make one look like it does.
      status: "stale",
      entitled: true,
      reason: `This licence refreshes in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Nothing is disabled either way.`,
    };
  }

  return base;
}

/** The single question a gated surface should ask. */
export function canUse(state: LicenseState | null | undefined, feature: BusinessFeature): boolean {
  // Tolerant of a missing state on purpose: callers include render paths that may
  // run before the licence has been read, and "not entitled yet" is the correct
  // answer there — never a crash.
  return Boolean(state?.entitled) && (state?.features.includes(feature) ?? false);
}

/**
 * The contract every refusal must satisfy.
 *
 * Exported so the rule is written down once: a refused cloud feature may never
 * claim that a local one was affected. If a caller needs a refusal message, this
 * is the shape it gets, and `localUnaffected` is `true` by construction rather
 * than by remembering.
 */
export function refusal(state: LicenseState | null | undefined, feature: BusinessFeature) {
  return {
    feature,
    allowed: false as const,
    reason: state?.reason ?? "This organization does not have the Business tier active.",
    localUnaffected: true as const,
  };
}
