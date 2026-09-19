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
    const plugins = (conf.plugins ?? {}) as Record<string, unknown>;
    plugins.updater = {
      active: true,
      endpoints: ["https://github.com/ahmadrrrtx/xr/releases/latest/download/latest.json"],
      pubkey,
      windows: { installMode: "passive" },
    };
    conf.plugins = plugins;
    writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n", "utf8");
    console.log(`\napplied pubkey to ${confPath} — commit this file; store the PRIVATE key as the repo secret.`);
  } else {
    console.log("\n(re-run with --apply to patch the pubkey into tauri.conf.json)");
  }
}

main();
