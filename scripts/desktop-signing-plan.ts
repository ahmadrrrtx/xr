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
 * Missing secrets never fail a PR build: they produce an UNSIGNED build (macOS
 * ad-hoc sealed) and a notice. STABLE tags require macOS Developer ID +
 * notarization and Windows Authenticode. PREVIEW tags (a prerelease identity)
 * may ship unsigned installers by owner decision (UNSIGNED_PREVIEW_INSTALLERS).
 * Half-provisioned material still fails. A tag build with the updater pubkey
 * committed but no private key FAILS, because it would publish installers the
 * shipped updater rejects.
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
  /** The tag's version is a prerelease (`x.y.z-…`), read from the committed release identity. */
  preview?: boolean;
}

export interface SigningPlan {
  config: Record<string, unknown>;
  notices: string[];
  error?: string;
  signedOs: boolean;
  notarized: boolean;
  updaterArtifacts: boolean;
  /** macOS bundle sealed with the ad-hoc identity "-" (no Apple Developer ID). */
  adhocSigned: boolean;
}

export const TIMESTAMP_URL = "http://timestamp.digicert.com";

/**
 * Owner decision (ahmadrrrtx, 2026-11-21): there is no budget for signing certificates. A PREVIEW tag may ship desktop
 * installers without OS signing: Windows unsigned (SmartScreen warns: "More info" → "Run anyway"), macOS ad-hoc sealed
 * (Gatekeeper asks once: System Settings → Privacy & Security → "Open Anyway"). Integrity still comes from the cosign-
 * signed DESKTOP-SHA256SUMS and the build-provenance attestation. A STABLE tag still requires Developer ID +
 * notarization and Authenticode, and half-provisioned material still fails.
 */
export const UNSIGNED_PREVIEW_INSTALLERS = true;

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
    if (i.tag)
      error =
        "updater pubkey is committed but the TAURI_UPDATER_KEY secret is missing: a tag build would ship installers without updater signatures";
    else
      notices.push(
        "updater: TAURI_UPDATER_KEY not available to this run — building without updater signatures (normal for PRs)",
      );
  } else {
    notices.push(
      "updater: not provisioned (no pubkey in tauri.conf.json) — no latest.json will be published; see docs/release/DESKTOP_SIGNING.md",
    );
  }

  let signedOs = false;
  let notarized = false;
  let adhocSigned = false;
  const unsignedPreviewTag = i.tag && i.preview === true && UNSIGNED_PREVIEW_INSTALLERS;
  if (i.os === "windows") {
    if (
      i.hasWindowsCert &&
      i.windowsThumbprint &&
      /^[0-9A-Fa-f]{40}$/.test(i.windowsThumbprint)
    ) {
      bundle.windows = {
        certificateThumbprint: i.windowsThumbprint.toUpperCase(),
        digestAlgorithm: "sha256",
        timestampUrl: TIMESTAMP_URL,
      };
      signedOs = true;
      notices.push(
        "windows: Authenticode signing with the imported certificate (SHA-256, RFC 3161 timestamp)",
      );
    } else if (i.hasWindowsCert) {
      error ??=
        "windows: WINDOWS_CERTIFICATE is set but no valid certificate thumbprint was imported";
    } else {
      notices.push(
        "windows: UNSIGNED build (WINDOWS_CERTIFICATE not provisioned) — SmartScreen will warn",
      );
    }
  } else if (i.os === "macos") {
    if (i.hasAppleCert) {
      signedOs = true;
      notarized = i.hasAppleNotary;
      notices.push(
        `macos: Developer ID signing${notarized ? " + notarization (stapled)" : " WITHOUT notarization (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID missing) — Gatekeeper will still block"}`,
      );
      if (i.tag && !notarized)
        error ??=
          "macos: a tag build is signed but not notarized; provision the notarization secrets do not publish an unsigned replacement";
    } else {
      // Ad-hoc seal: without it a downloaded bundle reads as "damaged" on Apple Silicon, with no way to open it.
      // Hardened runtime only matters for notarization, which needs a Developer ID.
      bundle.macOS = { signingIdentity: "-", hardenedRuntime: false };
      adhocSigned = true;
      notices.push(
        "macos: UNSIGNED by Apple (no Developer ID: APPLE_CERTIFICATE not provisioned) — AD-HOC sealed so a download is not reported as damaged; not notarized, so Gatekeeper asks once: System Settings → Privacy & Security → Open Anyway",
      );
    }
  } else {
    notices.push(
      "linux: packages are not code-signed (checksums + release signature only)",
    );
  }

  if (i.tag && i.os === "windows" && !signedOs && !unsignedPreviewTag)
    error ??=
      "windows: stable tags require a valid Authenticode certificate; unsigned builds ship only on preview tags";
  if (i.tag && i.os === "macos" && !unsignedPreviewTag && (!signedOs || !notarized))
    error ??=
      "macos: stable tags require Developer ID signing and notarization; missing owner credentials block the release";
  if (unsignedPreviewTag && !signedOs && i.os !== "linux")
    notices.push(`${i.os}: PREVIEW tag shipping without OS signing (owner decision, UNSIGNED_PREVIEW_INSTALLERS)`);
  const config = Object.keys(bundle).length > 0 ? { bundle } : {};
  return { config, notices, error, signedOs, notarized, updaterArtifacts, adhocSigned };
}

/** Presence-only early blocker. It is NEVER proof of a verified signature. */
export function signingPreflight(
  input: Pick<
    PlanInput,
    | "tag"
    | "hasAppleCert"
    | "hasAppleNotary"
    | "hasWindowsCert"
    | "pubkeyCommitted"
    | "hasUpdaterKey"
    | "preview"
  >,
): string[] {
  if (!input.tag) return [];
  const missing: string[] = [];
  if (input.preview === true && UNSIGNED_PREVIEW_INSTALLERS) {
    // A preview may ship unsigned, but material that is present must be complete.
    if (input.hasAppleCert && !input.hasAppleNotary)
      missing.push("APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID (the Apple certificate is set, so notarization must be too)");
  } else {
    if (!input.hasAppleCert)
      missing.push("APPLE_CERTIFICATE / password / signing identity");
    if (!input.hasAppleNotary)
      missing.push("APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID");
    if (!input.hasWindowsCert) missing.push("WINDOWS_CERTIFICATE / password");
  }
  if (input.pubkeyCommitted && !input.hasUpdaterKey)
    missing.push("TAURI_UPDATER_KEY");
  return missing;
}

/** Whether the committed release identity is a prerelease (the tag must equal it; release.yml enforces that). */
export function identityIsPreview(manifestText: string): boolean {
  const version = (JSON.parse(manifestText) as { identity?: { version?: string } }).identity?.version ?? "";
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version);
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

if (import.meta.main) {
  const os = (arg("os") ?? "linux") as Os;
  const conf = JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "desktop", "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  ) as { plugins?: { updater?: { pubkey?: string } } };
  const on = (k: string) => process.env[k] === "true" || process.env[k] === "1";
  const preview = identityIsPreview(
    readFileSync(join(import.meta.dir, "..", "release.manifest.json"), "utf8"),
  );
  if (!["linux", "macos", "windows"].includes(os))
    throw new Error("Invalid signing platform");
  if (process.argv.includes("--preflight")) {
    const missing = signingPreflight({
      tag: arg("tag") === "true",
      pubkeyCommitted: Boolean(conf.plugins?.updater?.pubkey),
      hasUpdaterKey: on("HAS_UPDATER_KEY"),
      hasAppleCert: on("HAS_APPLE_CERT"),
      hasAppleNotary: on("HAS_APPLE_NOTARY"),
      hasWindowsCert: on("HAS_WINDOWS_CERT"),
      preview,
    });
    if (missing.length) {
      console.error(
        `BLOCKED: missing owner signing prerequisites: ${missing.join("; ")}`,
      );
      process.exit(1);
    }
    const tag = arg("tag") === "true";
    const nothingProvisioned = !on("HAS_APPLE_CERT") && !on("HAS_WINDOWS_CERT");
    console.log(
      tag && preview && UNSIGNED_PREVIEW_INSTALLERS && nothingProvisioned
        ? "::notice title=Desktop signing::PREVIEW tag without signing material: installers ship UNSIGNED (Windows) and AD-HOC sealed (macOS) by owner decision; stable tags still require OS signing"
        : "Signing prerequisite presence checked; actual OS verification still required",
    );
    process.exit(0);
  }
  const plan = signingPlan({
    os,
    tag: arg("tag") === "true",
    pubkeyCommitted: Boolean(conf.plugins?.updater?.pubkey),
    hasUpdaterKey: on("HAS_UPDATER_KEY"),
    hasAppleCert: on("HAS_APPLE_CERT"),
    hasAppleNotary: on("HAS_APPLE_NOTARY"),
    hasWindowsCert: on("HAS_WINDOWS_CERT"),
    windowsThumbprint: arg("thumbprint"),
    preview,
  });
  writeFileSync(
    arg("out") ?? "tauri-signing.json",
    JSON.stringify(plan.config, null, 2) + "\n",
  );
  for (const n of plan.notices)
    console.log(`::notice title=Desktop signing::${n}`);
  const gh = process.env.GITHUB_ENV;
  if (gh) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      gh,
      `XR_SIGNED_OS=${plan.signedOs ? 1 : 0}\nXR_NOTARIZED=${plan.notarized ? 1 : 0}\nXR_UPDATER_ARTIFACTS=${plan.updaterArtifacts ? 1 : 0}\nXR_ADHOC_SIGNED=${plan.adhocSigned ? 1 : 0}\n`,
    );
  }
  if (plan.error) {
    console.log(`::error title=Desktop signing::${plan.error}`);
    process.exit(1);
  }
}
