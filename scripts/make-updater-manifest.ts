#!/usr/bin/env bun
/**
 * XR Phase 5 · Tauri updater manifest (latest.json) assembler.
 *
 *   bun run scripts/make-updater-manifest.ts --dir <bundle-dir> --version <v> \
 *       --tag <vX.Y.Z> --notes <file> --out latest.json
 *
 * Reads the per-platform updater artifacts that `tauri build` emits ONLY when
 * the bundle job was given TAURI_SIGNING_PRIVATE_KEY (`<artifact>.tar.gz` +
 * `<artifact>.tar.gz.sig` on linux/macos, `.msi.zip` + sig on windows) and
 * assembles the manifest the tauri-plugin-updater fetches from the release
 * endpoint. No sig files → the manifest lists zero platforms and the job
 * publishes nothing (honest: an unprovisioned updater never half-ships).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLATFORM_BY_EXT: Array<[RegExp, string]> = [
  [/\.AppImage\.tar\.gz$/, "linux-x86_64"],
  [/\.app\.tar\.gz$/, "darwin-aarch64"],
  [/\.dmg\.tar\.gz$/, "darwin-aarch64"],
  [/\.msi\.zip$/, "windows-x86_64"],
];

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
    const match = PLATFORM_BY_EXT.find(([re]) => re.test(artifact));
    if (!match) continue;
    const [, platform] = match;
    platforms[platform] = {
      signature: readFileSync(join(dir, f), "utf8").trim(),
      url: `https://github.com/ahmadrrrtx/xr/releases/download/${tag}/${artifact}`,
    };
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
    a.notes ? readFileSync(a.notes, "utf8") : "See CHANGELOG.md",
  );
  const n = Object.keys(manifest.platforms as object).length;
  writeFileSync(a.out ?? "latest.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[updater-manifest] ${n} platform(s) with signatures → ${a.out ?? "latest.json"}`);
  if (n === 0) {
    console.log("[updater-manifest] no signed updater artifacts found — manifest is empty; publish step must skip.");
  }
}
