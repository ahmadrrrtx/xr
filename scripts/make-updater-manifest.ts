#!/usr/bin/env bun
/**
 * XR Phase 5 · Tauri updater manifest (latest.json) assembler.
 *
 *   bun run scripts/make-updater-manifest.ts --dir <bundle-dir> --version <v> \
 *       --tag <vX.Y.Z> --notes <file> --out latest.json
 *
 * Reads the per-platform updater artifacts that `tauri build` emits when
 * `bundle.createUpdaterArtifacts: true` is set AND the bundle job was given
 * TAURI_SIGNING_PRIVATE_KEY, and assembles the manifest tauri-plugin-updater
 * fetches from the release endpoint. No sig files → the manifest lists zero
 * platforms and the job publishes nothing (honest: an unprovisioned updater
 * never half-ships).
 *
 * Artifact shapes are Tauri v2's (`createUpdaterArtifacts: true`, NOT
 * "v1Compatible"): the installer itself is the updater payload and carries a
 * detached `.sig` —
 *   linux    xr-desktop_<v>_amd64.AppImage       + .sig
 *   macOS    XR Desktop_<v>_aarch64.app.tar.gz   + .sig
 *   windows  XR Desktop_<v>_x64-setup.exe        + .sig   (NSIS, per-user)
 *            XR Desktop_<v>_x64_en-US.msi        + .sig   (WiX, per-machine)
 *
 * WINDOWS FLAVOUR POLICY (W-4 · installer/updater coexistence)
 * Two Windows installers ship on purpose (per-machine MSI for existing
 * installs, per-user NSIS for new ones). An update must hand a user the SAME
 * flavour they installed, or they end up with two copies in "Apps".
 * tauri-plugin-updater ≥ 2.10 asks for an installer-specific key first
 * (`windows-x86_64-nsis` / `windows-x86_64-msi`) and only then the generic
 * `windows-x86_64`. So this assembler emits:
 *   · both specific keys whenever the artifact exists, and
 *   · the generic key pointing at the MSI when one exists — every install
 *     older than this policy is an MSI install, and an older plugin that only
 *     reads the generic key must keep receiving MSI-over-MSI. NSIS becomes the
 *     generic fallback only when no MSI was built at all.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Artifact shape → updater platform key (launch-audit L-002/L-003: arch-aware).
 * Specific-arch forms are matched FIRST so an x64 and an arm64 artifact of the
 * same bundle kind never collide on one key; the arch-less trailing patterns
 * keep the single-arch era's legacy behaviour (a bare `XR.app.tar.gz` was the
 * aarch64 build, a bare `…-setup.exe` the x64 NSIS).
 */
const PLATFORM_BY_EXT: Array<[RegExp, string]> = [
  [/amd64\.AppImage$/, "linux-x86_64"],
  [/aarch64\.app\.tar\.gz$/, "darwin-aarch64"],
  [/x64\.app\.tar\.gz$/, "darwin-x86_64"],
  [/(aarch64|arm64)-setup\.exe$/, "windows-aarch64-nsis"],
  [/x64-setup\.exe$/, "windows-x86_64-nsis"],
  [/x64[^/]*\.msi$/, "windows-x86_64-msi"],
  [/\.AppImage$/, "linux-x86_64"],
  [/\.app\.tar\.gz$/, "darwin-aarch64"],
  [/-setup\.exe$/, "windows-x86_64-nsis"],
  [/\.msi$/, "windows-x86_64-msi"],
];

/** Which specific Windows key the generic `windows-x86_64` mirrors, in preference order. */
const WINDOWS_GENERIC_PREFERENCE = ["windows-x86_64-msi", "windows-x86_64-nsis"];

/**
 * GitHub renames uploaded release assets: every space becomes a period
 * ("XR Desktop_1.0.0_x64-setup.exe" is served as
 * "XR.Desktop_1.0.0_x64-setup.exe"). The manifest must name the asset as the
 * release actually serves it, or every update check 404s.
 */
export function releaseAssetName(fileName: string): string {
  return fileName.replace(/ /g, ".");
}

function args(): Record<string, string> {
  const a = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i += 2) out[a[i].replace(/^--/, "")] = a[i + 1] ?? "";
  return out;
}

export function buildManifest(dir: string, version: string, tag: string, notes: string): Record<string, unknown> {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    files = []; // bundle dir absent ⇒ nothing was signed ⇒ empty manifest
  }
  const platforms: Record<string, { signature: string; url: string }> = {};
  for (const f of files) {
    if (!f.endsWith(".sig")) continue;
    const artifact = f.replace(/\.sig$/, "");
    if (!files.includes(artifact)) continue; // a stray .sig without its payload is not shippable
    const match = PLATFORM_BY_EXT.find(([re]) => re.test(artifact));
    if (!match) continue;
    const [, platform] = match;
    platforms[platform] = {
      signature: readFileSync(join(dir, f), "utf8").trim(),
      url: `https://github.com/ahmadrrrtx/xr/releases/download/${tag}/${releaseAssetName(artifact)}`,
    };
  }
  for (const specific of WINDOWS_GENERIC_PREFERENCE) {
    if (platforms[specific]) {
      platforms["windows-x86_64"] = { ...platforms[specific] };
      break;
    }
  }
  // Launch-audit L-002 — the Windows ARM flavour matrix is NSIS-only, so the
  // generic aarch64 key mirrors it directly when the specific key exists.
  if (platforms["windows-aarch64-nsis"] && !platforms["windows-aarch64"]) {
    platforms["windows-aarch64"] = { ...platforms["windows-aarch64-nsis"] };
  }
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };
}

if (import.meta.main) {
  const a = args();
  const manifest = buildManifest(
    a.dir ?? ".",
    a.version ?? "0.0.0",
    a.tag ?? "v0.0.0",
    // XR-LAUNCH-008: desktop-app.yml passes --notes as TEXT; reading it as a
    // path crashed the manifest job (ENOENT) on every tag. --notes-file reads a file.
    a["notes-file"] ? readFileSync(a["notes-file"], "utf8") : (a.notes || "See CHANGELOG.md"),
  );
  const n = Object.keys(manifest.platforms as object).length;
  writeFileSync(a.out ?? "latest.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[updater-manifest] ${n} platform key(s) with signatures → ${a.out ?? "latest.json"}`);
  if (n === 0) {
    console.log("[updater-manifest] no signed artifacts found — updater not provisioned; nothing to publish");
  }
}
