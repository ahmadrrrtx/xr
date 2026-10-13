#!/usr/bin/env bun
/**
 * Generate the Ed25519 keypair that signs Business licences.
 *
 * Run once per deployment. The private half goes in `XR_LICENSE_PRIVATE_KEY`;
 * the public half is what the desktop bakes into `src/cloud/license-pubkey.ts`
 * so licence verification works with no network call, ever.
 *
 * The printed private key is the ONLY copy. It is not written to disk, not
 * committed, and not recoverable — losing it means every issued licence fails to
 * verify, which is a bad day but not a silent one.
 */
import { generateKeyPairSync } from "node:crypto";
import { exportPKCS8, exportSPKI } from "jose";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privatePkcs8 = await exportPKCS8(privateKey);
const publicSpki = await exportSPKI(publicKey);

const privateB64 = privatePkcs8
  .replace(/-----BEGIN PRIVATE KEY-----/, "")
  .replace(/-----END PRIVATE KEY-----/, "")
  .replace(/\s+/g, "");
const publicB64 = publicSpki
  .replace(/-----BEGIN PUBLIC KEY-----/, "")
  .replace(/-----END PUBLIC KEY-----/, "")
  .replace(/\s+/g, "");

const kid = `xr-lic-${new Date().toISOString().slice(0, 7)}`;

process.stdout.write(
  [
    "── XR Business licence keypair ─────────────────────────────────────────",
    "",
    "1) Put this in the cloud service environment (secret manager, not a file):",
    "",
    `   XR_LICENSE_PRIVATE_KEY=${privateB64}`,
    `   XR_LICENSE_KID=${kid}`,
    "",
    "2) Paste this into src/cloud/license-pubkey.ts in the repo:",
    "",
    `   export const XR_LICENSE_PUBLIC_KEY_SPKI = "${publicB64}";`,
    `   export const XR_LICENSE_KID = "${kid}";`,
    "",
    "3) Confirm it loads:  bun run scripts/verify-license-keypair.ts",
    "",
    "The desktop verifies licences OFFLINE against the public key above.",
    "Rotating this keypair invalidates every licence already issued.",
    "─────────────────────────────────────────────────────────────────────────",
    "",
  ].join("\n"),
);
