/**
 * XR Cloud — the licence verification key, as data.
 *
 * This module exists so there is exactly one definition of the public key: the
 * one the API publishes at `/.well-known/xr-license-pubkey`, and the one whose
 * *private* half signs licences.
 *
 * The desktop does **not** fetch this at runtime. `src/cloud/license-pubkey.ts`
 * in the repo carries the same SPKI as a baked-in constant, which is what makes
 * offline licence verification possible. If the keys ever disagree, offline
 * verification fails closed and the daemon reports it — it does not silently
 * accept an unverified licence.
 *
 * ## Rotation
 *
 * `kid` identifies the key. A future rotation publishes a new `kid` in the
 * `/.well-known` document; the desktop keeps the old key in a list so a licence
 * minted under `xr-lic-1` still verifies after the deployment starts minting
 * under `xr-lic-2`. That is why the document is a **set** and not a single key,
 * even though the set has one member today.
 */

import { createPublicKey } from "node:crypto";
import { exportSPKI, importPKCS8 } from "jose";

import type { CloudEnv } from "../env.ts";

export interface LicenseKeyDocument {
  issuer: string;
  keys: Array<{ kid: string; alg: "EdDSA"; use: "sig"; spki: string }>;
  /** How the desktop is expected to use the key. Stated so it cannot drift. */
  usage: string;
}

/**
 * Derive the public key from the private key. Exporting it is deliberate: it
 * means a deployment cannot accidentally publish a key that does not match the
 * one signing licences, because there is only one input.
 */
export async function deriveLicensePublicKeySpki(privateKeyBase64: string): Promise<string> {
  const key = await importPKCS8(privateKeyBase64, "EdDSA");
  const raw = await exportSPKI(key);
  // `exportSPKI` returns a PEM; strip the armour so the document carries base64
  // only, which survives JSON, YAML and copy-paste equally well.
  return raw
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
}

/**
 * Node's own view of the same key, used to sanity-check that a derived SPKI is
 * loadable before it is published. A published key that cannot be imported is
 * worse than no published key.
 */
export function assertLoadableSpki(spkiBase64: string): void {
  const pem = `-----BEGIN PUBLIC KEY-----\n${spkiBase64}\n-----END PUBLIC KEY-----`;
  const key = createPublicKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`licence key must be ed25519, got ${key.asymmetricKeyType}`);
  }
}

export async function buildLicensePublicKeyDocument(env: CloudEnv): Promise<LicenseKeyDocument> {
  const keys: LicenseKeyDocument["keys"] = [];
  if (env.XR_LICENSE_PRIVATE_KEY) {
    const spki = await deriveLicensePublicKeySpki(env.XR_LICENSE_PRIVATE_KEY);
    assertLoadableSpki(spki);
    keys.push({ kid: env.XR_LICENSE_KID, alg: "EdDSA", use: "sig", spki });
  }
  return {
    issuer: env.API_URL,
    keys,
    usage:
      "Verify the `sig` of a licence JWT with this key. Licence checking is fully offline: the XR desktop carries the same key " +
      "baked into its binary and never fetches this document. This endpoint exists for third-party verifiers and curious customers, " +
      "not because any XR client needs it.",
  };
}
