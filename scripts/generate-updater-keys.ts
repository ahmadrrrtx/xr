#!/usr/bin/env bun
/**
 * XR Phase 5 · Tauri updater key provisioning (operator-run, once).
 *
 *   bun run scripts/generate-updater-keys.ts            # generate, print both halves
 *   bun run scripts/generate-updater-keys.ts --apply    # also patch pubkey into tauri.conf.json
 *
 * WHY MANUAL: the updater verifies artifacts against an Ed25519 pubkey baked
 * into tauri.conf.json at build time. The PRIVATE half must live ONLY in a
 * CI secret (TAURI_UPDATER_KEY) so release.yml can sign latest.json — it is
 * never written to the repo, never printed by CI, and this script never
 * stores it. Run it once on a trusted machine: commit the --apply pubkey
 * change, paste the private key into the repo secret, then delete the
 * terminal scrollback.
 *
 * The pubkey emitted here is the base64 of the RAW 32-byte Ed25519 public
 * key (Tauri's expected format), extracted from the SPKI DER encoding.
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const SPKI_ED25519_PREFIX = "302a300506032b6570032100"; // 12-byte DER header before the raw key

function main() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  if (!spki.startsWith(SPKI_ED25519_PREFIX)) {
    console.error("unexpected SPKI layout for ed25519 — aborting rather than emitting a bad pubkey");
    process.exit(1);
  }
  const pubkey = Buffer.from(spki.slice(SPKI_ED25519_PREFIX.length), "hex").toString("base64");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  console.log("UPDATER PUBLIC KEY  (commit via --apply):");
  console.log(`  ${pubkey}`);
  console.log("");
  console.log("UPDATER PRIVATE KEY (CI secret TAURI_UPDATER_KEY — never commit):");
  console.log(privPem.trim());

  if (process.argv.includes("--apply")) {
    const confPath = join(import.meta.dir, "..", "desktop", "src-tauri", "tauri.conf.json");
    const conf = JSON.parse(readFileSync(confPath, "utf8")) as Record<string, unknown>;
    writeFileSync(confPath, JSON.stringify(applyUpdaterConfig(conf, pubkey), null, 2) + "\n", "utf8");
    console.log(`\napplied pubkey + createUpdaterArtifacts to ${confPath} — commit this file; store the PRIVATE key as the repo secret.`);
  } else {
    console.log("\n(re-run with --apply to patch the pubkey into tauri.conf.json)");
  }
}

if (import.meta.main) main();
