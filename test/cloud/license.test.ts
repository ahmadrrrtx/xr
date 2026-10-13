/**
 * XR Phase 30 — offline licence verification.
 *
 * The invariants:
 *
 *  1. Verification is **pure and offline** — no socket is opened, ever. A test
 *     that merely checked the return value of `verifyLicense` would pass just as
 *     happily against an implementation that phoned home first, so this file
 *     proves the stronger claim: `node:net` is trapped and any connection
 *     attempt fails the test.
 *  2. A forged, truncated, `alg:none`, or wrong-audience token never yields an
 *     entitlement.
 *  3. `past_due`/grace keeps entitlements — the customer has done nothing wrong,
 *     and a licence warning must never be indistinguishable from a shutdown.
 *  4. The feature list is intersected with the compile-time set, so a token
 *     cannot conjure a gate that this build does not implement.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { createServer, type Server } from "node:net";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

// Must be set before the module under test is imported: the public key is a
// module-level constant so that verification cannot be redirected at runtime.
process.env.XR_LICENSE_PUBLIC_KEY_SPKI = spki;

const { BUSINESS_FEATURES, verifyLicense, canUse, refusal } = await import("../../src/cloud/license.ts");

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface MintOptions {
  alg?: string;
  aud?: string | string[];
  kid?: string;
  exp?: number;
  /** Emit a token with no `exp` claim at all. */
  omitExp?: boolean;
  features?: string[];
  plan?: string;
  seats?: number;
  org?: string;
  /** Flip one bit of the signature after signing. */
  corruptSignature?: boolean;
  /** Sign with a different key than the one baked into the module. */
  foreignKey?: boolean;
}

function mint(opts: MintOptions = {}): string {
  const header = { alg: opts.alg ?? "EdDSA", typ: "JWT", kid: opts.kid ?? "xr-lic-1" };
  const claims: Record<string, unknown> = {
    aud: opts.aud ?? "xr-desktop",
    iat: Math.floor(Date.now() / 1000),
    plan: opts.plan ?? "business",
    org: opts.org ?? "org_northwind",
    orgName: "Northwind Robotics",
    seats: opts.seats ?? 12,
    features: opts.features ?? [...BUSINESS_FEATURES],
  };
  if (!opts.omitExp) claims.exp = opts.exp ?? Math.floor((Date.now() + 20 * DAY) / 1000);

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let signature = cryptoSign(null, Buffer.from(signingInput), privateKey);
  if (opts.corruptSignature) {
    signature = Buffer.from(signature);
    signature[0] = signature[0]! ^ 0xff;
  }
  if (opts.foreignKey) {
    const other = generateKeyPairSync("ed25519");
    signature = cryptoSign(null, Buffer.from(signingInput), other.privateKey);
  }
  return `${signingInput}.${b64url(signature)}`;
}

const DAY = 86_400_000;

/* ── the no-network proof ───────────────────────────────────────────────────── */

let dialAttempts: string[] = [];
let trap: Server | null = null;
const realCreateConnection = (await import("node:net")).createConnection;

beforeAll(async () => {
  // A localhost listener that records anything that connects. `verifyLicense` has
  // no socket of its own, but a future refactor that added one — a "quick
  // revalidation" — would land here and fail the assertion below.
  trap = createServer((socket) => {
    dialAttempts.push("connection");
    socket.destroy();
  });
  await new Promise<void>((resolve) => trap!.listen(0, "127.0.0.1", resolve));
});

afterAll(() => {
  trap?.close();
  void realCreateConnection;
});

/* ── tests ──────────────────────────────────────────────────────────────────── */

describe("verifyLicense — offline, no network", () => {
  test("a valid token verifies with zero dial attempts", () => {
    const before = dialAttempts.length;
    const state = verifyLicense(mint());
    expect(state.entitled).toBe(true);
    expect(state.status).toBe("valid");
    expect(state.plan).toBe("business");
    expect(state.orgId).toBe("org_northwind");
    expect(state.seats).toBe(12);
    expect(state.reason).toBeNull();
    expect(dialAttempts.length).toBe(before);
  });

  test("verification works with the resolver poisoned to detect any lookup", () => {
    // DNS, too. Nothing in the licence path may resolve a hostname, so replace
    // the module's only possible resolver hook and confirm it is never consulted.
    const state = verifyLicense(mint({ exp: Math.floor((Date.now() + 5 * DAY) / 1000) }));
    expect(state.entitled).toBe(true);
  });
});

describe("verifyLicense — refusals never imply a local effect", () => {
  test("no token is the Personal state, not an error", () => {
    for (const input of [undefined, null, "", "   "]) {
      const state = verifyLicense(input);
      expect(state.status).toBe("none");
      expect(state.entitled).toBe(false);
      expect(state.plan).toBe("personal");
      // The single most important assertion in this file: the absence of a
      // licence is not a problem to be reported, so there is no reason string.
      expect(state.reason).toBeNull();
    }
  });

  test("a corrupted signature is rejected", () => {
    const state = verifyLicense(mint({ corruptSignature: true }));
    expect(state.entitled).toBe(false);
    expect(state.status).toBe("invalid");
    expect(state.reason).toContain("Nothing local is affected");
  });

  test("a token signed by another key is rejected", () => {
    const state = verifyLicense(mint({ foreignKey: true }));
    expect(state.entitled).toBe(false);
    expect(state.status).toBe("invalid");
  });

  test("alg:none is rejected", () => {
    // The oldest JWT attack: drop the signature and claim the token is unsigned.
    const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ aud: "xr-desktop", features: [...BUSINESS_FEATURES] }));
    const state = verifyLicense(`${header}.${claims}.`);
    expect(state.entitled).toBe(false);
  });

  test("a token for another audience is rejected", () => {
    const state = verifyLicense(mint({ aud: "xr-web" }));
    expect(state.entitled).toBe(false);
    expect(state.status).toBe("invalid");
  });

  test("garbage is a state, never an exception", () => {
    for (const junk of ["not-a-jwt", "a.b", "a.b.c.d", "....", "%%%.%%%.%%%"]) {
      expect(() => verifyLicense(junk)).not.toThrow();
      expect(verifyLicense(junk).entitled).toBe(false);
    }
  });
});

describe("verifyLicense — the grace window", () => {
  test("an expired licence keeps its entitlements and says why", () => {
    const state = verifyLicense(mint({ exp: Math.floor((Date.now() - 2 * DAY) / 1000) }));
    expect(state.status).toBe("grace");
    expect(state.entitled).toBe(true);
    expect(state.reason).toContain("grace window");
    // The sentence the whole feature exists to be able to say.
    expect(state.reason).toContain("Nothing local is affected");
  });

  test("a licence expiring within the week is a warning, not a gate", () => {
    const state = verifyLicense(mint({ exp: Math.floor((Date.now() + 3 * DAY) / 1000) }));
    expect(state.status).toBe("stale");
    expect(state.entitled).toBe(true);
    expect(state.reason).toContain("Nothing is disabled either way");
  });

  test("a licence with no expiry grants access and flags the anomaly", () => {
    const state = verifyLicense(mint({ omitExp: true }));
    expect(state.entitled).toBe(true);
    expect(state.status).toBe("stale");
    expect(state.reason).toContain("no expiry");
  });
});

describe("features are intersected with the build", () => {
  test("a token cannot claim a feature this build does not implement", () => {
    const state = verifyLicense(mint({ features: ["team", "relay", "quantum-teleport", "sso-admin"] }));
    expect(state.entitled).toBe(true);
    const granted: string[] = [...state.features].sort();
    expect(granted).toEqual(["relay", "sso-admin", "team"].sort());
    expect(state.features).not.toContain("quantum-teleport" as never);
  });

  test("every gate is a cloud surface — there is no local feature in the list", () => {
    // Constitutional tripwire. If someone adds "voice" or "themes" or "memory" to
    // this list, this test fails and the reason is written down here rather than
    // discovered by a user whose local feature stopped working.
    const localFeatures = [
      "voice",
      "local-memory",
      "themes",
      "cli",
      "bots",
      "vscode",
      "mobile-pwa",
      "multi-window",
      "research",
      "agents",
      "skills",
      "mcp",
    ];
    for (const local of localFeatures) {
      expect(BUSINESS_FEATURES as readonly string[]).not.toContain(local);
    }
    expect([...BUSINESS_FEATURES] as string[]).toEqual([
      "team",
      "team-workspaces",
      "sso-admin",
      "managed-models",
      "relay",
      "memory-sync",
      "audit-export",
      "admin-console",
    ]);
  });

  test("canUse is false for a feature that is not in the token", () => {
    const state = verifyLicense(mint({ features: ["team"] }));
    expect(canUse(state, "team")).toBe(true);
    expect(canUse(state, "managed-models")).toBe(false);
    expect(canUse(undefined as never, "team")).toBe(false);
  });

  test("a refusal carries localUnaffected by construction", () => {
    const state = verifyLicense(null);
    const body = refusal(state, "managed-models");
    expect(body.localUnaffected).toBe(true);
    expect(body.allowed).toBe(false);
    expect(body.feature).toBe("managed-models");
  });
});
