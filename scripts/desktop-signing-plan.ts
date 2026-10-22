#!/usr/bin/env bun
/**
 * XR-LAUNCH-008 (decision D5) · what the desktop bundle job may sign, decided
 * from which owner secrets are PRESENT (never their values).
 *
 *   bun run scripts/desktop-signing-plan.ts --os <linux|macos|windows> --tag <true|false> \
 *     [--thumbprint <sha1>] --out tauri-signing.json
 *
 * Inputs are presence flags in the environment, set by the workflow:
 *   HAS_UPDATER_KEY   TAURI_UPDATER_KEY secret is non-empty
 *   HAS_APPLE_CERT    APPLE_CERTIFICATE (+ password, identity) non-empty
 *   HAS_APPLE_NOTARY  APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID non-empty
 *   HAS_WINDOWS_CERT  WINDOWS_CERTIFICATE (+ password) non-empty
 * Output: a Tauri `--config` merge file plus a one-line summary per surface.
 * Missing secrets never fail a PR build; they produce an UNSIGNED build and a
 * notice. A tag build with the updater pubkey committed but no private key
 * FAILS, because it would publish installers the shipped updater rejects.
 * The agent that wrote this never handled any key or certificate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Os = "linux" | "macos" | "windows";

export interface PlanInput {
  os: Os;
  tag: boolean;
  pubkeyCommitted: boolean;
  hasUpdaterKey: boolean;
  hasAppleCert: boolean;
  hasAppleNotary: boolean;
  hasWindowsCert: boolean;
  windowsThumbprint?: string;
}

export interface SigningPlan {
  config: Record<string, unknown>;
  notices: string[];
  error?: string;
  signedOs: boolean;
  notarized: boolean;
  updaterArtifacts: boolean;
}

export const TIMESTAMP_URL = "http://timestamp.digicert.com";

export function signingPlan(i: PlanInput): SigningPlan {
  const notices: string[] = [];
  const bundle: Record<string, unknown> = {};
  let error: string | undefined;

  // Updater artifacts (.sig) — need the committed pubkey AND the private key.
  let updaterArtifacts = false;
  if (i.pubkeyCommitted && i.hasUpdaterKey) {
    updaterArtifacts = true;
    notices.push("updater: signed artifacts (.sig) will be produced");
  } else if (i.pubkeyCommitted && !i.hasUpdaterKey) {
    bundle.createUpdaterArtifacts = false;
    if (i.tag) error = "updater pubkey is committed but the TAURI_UPDATER_KEY secret is missing: a tag build would ship installers without updater signatures";
    else notices.push("updater: TAURI_UPDATER_KEY not available to this run — building without updater signatures (normal for PRs)");
  } else {
    notices.push("updater: not provisioned (no pubkey in tauri.conf.json) — no latest.json will be published; see docs/release/DESKTOP_SIGNING.md");
  }

  let signedOs = false;
  let notarized = false;
  if (i.os === "windows") {
    if (i.hasWindowsCert && i.windowsThumbprint && /^[0-9A-Fa-f]{40}$/.test(i.windowsThumbprint)) {
      bundle.windows = { certificateThumbprint: i.windowsThumbprint.toUpperCase(), digestAlgorithm: "sha256", timestampUrl: TIMESTAMP_URL };
      signedOs = true;
      notices.push("windows: Authenticode signing with the imported certificate (SHA-256, RFC 3161 timestamp)");
    } else if (i.hasWindowsCert) {
      error ??= "windows: WINDOWS_CERTIFICATE is set but no valid certificate thumbprint was imported";
    } else {
      notices.push("windows: UNSIGNED build (WINDOWS_CERTIFICATE not provisioned) — SmartScreen will warn");
    }
  } else if (i.os === "macos") {
    if (i.hasAppleCert) {
      signedOs = true;
      notarized = i.hasAppleNotary;
      notices.push(`macos: Developer ID signing${notarized ? " + notarization (stapled)" : " WITHOUT notarization (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID missing) — Gatekeeper will still block"}`);
      if (i.tag && !notarized) error ??= "macos: a tag build is signed but not notarized; provision the notarization secrets or remove the certificate";
    } else {
      notices.push("macos: UNSIGNED build (APPLE_CERTIFICATE not provisioned) — Gatekeeper will block on first open");
    }
  } else {
    notices.push("linux: packages are not code-signed (checksums + release signature only)");
  }

  const config = Object.keys(bundle).length > 0 ? { bundle } : {};
  return { config, notices, error, signedOs, notarized, updaterArtifacts };
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

if (import.meta.main) {
  const os = (arg("os") ?? "linux") as Os;
  const conf = JSON.parse(readFileSync(join(import.meta.dir, "..", "desktop", "src-tauri", "tauri.conf.json"), "utf8")) as { plugins?: { updater?: { pubkey?: string } } };
  const on = (k: string) => process.env[k] === "true" || process.env[k] === "1";
  const plan = signingPlan({
    os,
    tag: arg("tag") === "true",
    pubkeyCommitted: Boolean(conf.plugins?.updater?.pubkey),
    hasUpdaterKey: on("HAS_UPDATER_KEY"),
    hasAppleCert: on("HAS_APPLE_CERT"),
    hasAppleNotary: on("HAS_APPLE_NOTARY"),
    hasWindowsCert: on("HAS_WINDOWS_CERT"),
    windowsThumbprint: arg("thumbprint"),
  });
  writeFileSync(arg("out") ?? "tauri-signing.json", JSON.stringify(plan.config, null, 2) + "\n");
  for (const n of plan.notices) console.log(`::notice title=Desktop signing::${n}`);
  const gh = process.env.GITHUB_ENV;
  if (gh) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(gh, `XR_SIGNED_OS=${plan.signedOs ? 1 : 0}\nXR_NOTARIZED=${plan.notarized ? 1 : 0}\nXR_UPDATER_ARTIFACTS=${plan.updaterArtifacts ? 1 : 0}\n`);
  }
  if (plan.error) {
    console.log(`::error title=Desktop signing::${plan.error}`);
    process.exit(1);
  }
}
