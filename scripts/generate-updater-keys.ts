#!/usr/bin/env bun
/**
 * XR · Tauri updater key provisioning (operator-run, once). XR-LAUNCH-008.
 *
 *   cd desktop && bunx tauri signer generate -w ~/.tauri/xr-updater.key   # set a password
 *   bun run scripts/generate-updater-keys.ts --apply ~/.tauri/xr-updater.key.pub
 *
 * The updater verifies MINISIGN signatures, so the key pair must come from
 * `tauri signer generate`. (This script used to mint a raw Ed25519 PKCS#8 key
 * and a raw 32-byte pubkey; `tauri build` cannot sign with the first and the
 * updater cannot parse the second, so a "provisioned" build could never have
 * updated.) This script never generates, reads or prints a private key: it
 * validates the PUBLIC key file and writes it, the endpoint and
 * createUpdaterArtifacts into tauri.conf.json.
 *
 * Then: store the private key file's content as the TAURI_UPDATER_KEY secret
 * and its password as TAURI_UPDATER_KEY_PASSWORD, back the key up offline
 * (two copies; losing it strands every installed copy — a launch gate), and
 * follow docs/release/DESKTOP_SIGNING.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePublicKey } from "./verify-updater-signatures.ts";

export const UPDATER_ENDPOINT = "https://github.com/ahmadrrrtx/xr/releases/latest/download/latest.json";

/**
 * Provisioning flips the WHOLE updater pipeline on in one step:
 *   · plugins.updater      — pubkey + endpoint the shell verifies against
 *   · bundle.createUpdaterArtifacts — without it Tauri v2 emits no updater
 *     payloads and no .sig files even with the key present; and WITH it but
 *     without plugins.updater `tauri build` refuses to start ("plugins >
 *     updater doesn't exist"). The two are one decision, so they are set
 *     together and tested together (test/release/updater-manifest.test.ts).
 * Tauri v2 config only (no v1 `active` flag).
 */
export function applyUpdaterConfig(conf: Record<string, unknown>, pubkey: string): Record<string, unknown> {
  const out = structuredClone(conf);
  const plugins = (out.plugins ?? {}) as Record<string, unknown>;
  plugins.updater = {
    endpoints: [UPDATER_ENDPOINT],
    pubkey,
    windows: { installMode: "passive" },
  };
  out.plugins = plugins;
  const bundle = (out.bundle ?? {}) as Record<string, unknown>;
  bundle.createUpdaterArtifacts = true;
  out.bundle = bundle;
  return out;
}

function main() {
  const i = process.argv.indexOf("--apply");
  const pubPath = i >= 0 ? process.argv[i + 1] : undefined;
  if (!pubPath) {
    console.log("1. cd desktop && bunx tauri signer generate -w ~/.tauri/xr-updater.key   (choose a password)");
    console.log("2. bun run scripts/generate-updater-keys.ts --apply ~/.tauri/xr-updater.key.pub");
    console.log("3. secrets: TAURI_UPDATER_KEY = content of xr-updater.key, TAURI_UPDATER_KEY_PASSWORD = its password");
    console.log("4. back the private key up offline (two copies) — see docs/release/DESKTOP_SIGNING.md");
    return;
  }
  const pubkey = readFileSync(pubPath, "utf8").trim();
  if (/PRIVATE|secret key/i.test(Buffer.from(pubkey, "base64").toString("utf8"))) {
    console.error("refusing: that file looks like a PRIVATE key. Pass the .pub file.");
    process.exit(1);
  }
  parsePublicKey(pubkey); // throws unless it is a minisign Ed25519 public key
  const confPath = join(import.meta.dir, "..", "desktop", "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8")) as Record<string, unknown>;
  writeFileSync(confPath, JSON.stringify(applyUpdaterConfig(conf, pubkey), null, 2) + "\n", "utf8");
  console.log(`applied the updater pubkey + createUpdaterArtifacts to ${confPath} — commit it.`);
}

if (import.meta.main) main();
