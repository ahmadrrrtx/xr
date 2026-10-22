#!/usr/bin/env bun
/**
 * XR-LAUNCH-008 · verify every signature in latest.json before it is published.
 *
 *   bun run scripts/verify-updater-signatures.ts --manifest latest.json \
 *     --dir updater-artifacts [--conf desktop/src-tauri/tauri.conf.json]
 *
 * Tauri's updater checks minisign signatures (Ed25519) against the pubkey in
 * tauri.conf.json. This gate runs the same check in CI, so a manifest whose
 * signature does not match its payload — a tampered latest.json, a payload
 * swapped after signing, a signature from another key — is never published.
 *
 * Formats (as produced by `tauri signer generate` / `tauri signer sign`):
 *   pubkey (config)  base64("untrusted comment: …\n" + base64("Ed" ‖ keyid[8] ‖ pk[32]))
 *   signature        base64("untrusted comment: …\n"
 *                           + base64(alg[2] ‖ keyid[8] ‖ sig[64]) + "\n"
 *                           + "trusted comment: …\n" + base64(globalsig[64]))
 *   alg "Ed" signs the payload; "ED" signs BLAKE2b-512(payload). The global
 *   signature covers sig[64] ‖ trusted comment text.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface MinisignPublicKey { keyId: Buffer; key: Buffer }

function b64Lines(b64: string): string[] {
  return Buffer.from(b64.trim(), "base64").toString("utf8").split(/\r?\n/);
}

export function parsePublicKey(configPubkey: string): MinisignPublicKey {
  const lines = b64Lines(configPubkey);
  const keyLine = lines.find((l) => l && !l.startsWith("untrusted comment:"));
  if (!keyLine) throw new Error("pubkey: no key line");
  const raw = Buffer.from(keyLine.trim(), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("pubkey: not a minisign Ed25519 public key");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

function ed25519Verify(pk: Buffer, message: Buffer, sig: Buffer): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, pk]), format: "der", type: "spki" });
  return verify(null, message, key, sig);
}

export function verifySignature(configPubkey: string, signatureB64: string, payload: Buffer): { ok: boolean; reason?: string } {
  let pk: MinisignPublicKey;
  try {
    pk = parsePublicKey(configPubkey);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const lines = b64Lines(signatureB64);
  const sigLine = lines[1]?.trim();
  const trusted = lines[2] ?? "";
  const globalLine = lines[3]?.trim();
  if (!sigLine || !trusted.startsWith("trusted comment: ") || !globalLine) return { ok: false, reason: "signature: malformed" };
  const raw = Buffer.from(sigLine, "base64");
  if (raw.length !== 74) return { ok: false, reason: "signature: wrong length" };
  const alg = raw.subarray(0, 2).toString("latin1");
  const keyId = raw.subarray(2, 10);
  const sig = raw.subarray(10, 74);
  if (!keyId.equals(pk.keyId)) return { ok: false, reason: "signature: made by a different key" };
  let message: Buffer;
  if (alg === "Ed") message = payload;
  else if (alg === "ED") message = createHash("blake2b512").update(payload).digest();
  else return { ok: false, reason: `signature: unknown algorithm ${JSON.stringify(alg)}` };
  if (!ed25519Verify(pk.key, message, sig)) return { ok: false, reason: "signature: does not match the payload" };
  const trustedText = Buffer.from(trusted.slice("trusted comment: ".length), "utf8");
  if (!ed25519Verify(pk.key, Buffer.concat([sig, trustedText]), Buffer.from(globalLine, "base64"))) {
    return { ok: false, reason: "signature: trusted comment was altered" };
  }
  return { ok: true };
}

export interface ManifestCheck { platform: string; file: string; ok: boolean; reason?: string }

/**
 * Check every platform entry: its URL must name a payload present in `dir`
 * (release asset name = file name with spaces → periods) and the signature
 * must verify over that payload's bytes.
 */
export function verifyManifest(manifest: { platforms?: Record<string, { signature: string; url: string }> }, dir: string, files: string[], pubkey: string): ManifestCheck[] {
  const byAsset = new Map(files.map((f) => [f.replace(/ /g, "."), f]));
  return Object.entries(manifest.platforms ?? {}).map(([platform, entry]) => {
    const asset = decodeURIComponent(basename(new URL(entry.url).pathname));
    const local = byAsset.get(asset);
    if (!local) return { platform, file: asset, ok: false, reason: "payload named by the URL is not among the signed artifacts" };
    const r = verifySignature(pubkey, entry.signature, readFileSync(join(dir, local)));
    return { platform, file: local, ...r };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const { readdirSync } = await import("node:fs");
  const manifestPath = arg("manifest") ?? "latest.json";
  const dir = arg("dir") ?? "updater-artifacts";
  const confPath = arg("conf") ?? join(import.meta.dir, "..", "desktop", "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8")) as { plugins?: { updater?: { pubkey?: string } } };
  const pubkey = conf.plugins?.updater?.pubkey;
  if (!pubkey) {
    console.error("[updater-verify] no plugins.updater.pubkey in tauri.conf.json — refusing to publish an unverifiable manifest");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const results = verifyManifest(manifest, dir, readdirSync(dir), pubkey);
  for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.platform.padEnd(22)} ${r.file}${r.reason ? ` — ${r.reason}` : ""}`);
  if (results.length === 0 || results.some((r) => !r.ok)) {
    console.error("[updater-verify] FAIL — latest.json will not be published");
    process.exit(1);
  }
  console.log(`[updater-verify] ${results.length} platform signature(s) verified against the configured pubkey`);
}
