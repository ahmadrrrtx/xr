#!/usr/bin/env bun
/**
 * Launch audit XR-LAUNCH-001 — pre-publish verification of package-manager files.
 *
 * Input: the channel files attached to a GitHub release (flat asset names, as
 * GitHub stores them) plus that release's SHA256SUMS, whose cosign signature
 * the workflow verifies before calling this. Output: the files laid out the
 * way each package manager expects them, but only if every file is pinned to
 * the requested version and every sha256 matches the signed SHA256SUMS.
 *
 *   bun run scripts/channel-publish-verify.ts --version 1.0.0 \
 *     --dir release-assets --sums release-assets/SHA256SUMS --out publish
 *
 * Layout written to --out:
 *   homebrew/Formula/xr.rb
 *   winget/manifests/<l>/<Publisher>/<Package>/<version>/<id>.{yaml,installer.yaml,locale.en-US.yaml}
 *   scoop/xr.json
 *
 * Fails closed (exit 1) on any mismatch; publishes nothing itself.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formulaPairs, wingetManifestDir } from "./channel-live-check.ts";
import { loadManifest } from "./release-manifest.ts";
import { parse as parseSums } from "./sums.ts";

export interface VerifyInput {
  version: string;
  packageId: string;
  repoSlug: string;
  sums: Map<string, string>;
  files: Record<string, string | undefined>;
}

const pinned = (url: string, repoSlug: string, version: string): boolean =>
  url.startsWith(`https://github.com/${repoSlug}/releases/download/v${version}/`);

export function wingetFileNames(packageId: string): string[] {
  return [`${packageId}.yaml`, `${packageId}.installer.yaml`, `${packageId}.locale.en-US.yaml`];
}

/** Return every problem found; an empty list means the files are safe to publish. */
export function verifyChannelFiles(input: VerifyInput): string[] {
  const { version, packageId, repoSlug, sums, files } = input;
  const problems: string[] = [];

  const formula = files["xr.rb"];
  if (!formula) {
    problems.push("xr.rb (Homebrew formula) is missing from the release");
  } else {
    const declared = formula.match(/^\s*version\s+"([^"]+)"/m)?.[1];
    if (declared !== version) problems.push(`xr.rb declares version ${declared ?? "none"}, expected ${version}`);
    const pairs = formulaPairs(formula);
    if (pairs.length < 4) problems.push(`xr.rb has ${pairs.length} url/sha256 pairs, expected 4 (macOS arm/intel, Linux arm/intel)`);
    for (const { url, sha } of pairs) {
      const file = url.split("/").pop() ?? "";
      if (!pinned(url, repoSlug, version)) problems.push(`xr.rb url not pinned to v${version}: ${url}`);
      if (sums.get(file) !== sha) problems.push(`xr.rb sha256 for ${file} does not match SHA256SUMS`);
    }
  }

  for (const name of wingetFileNames(packageId)) {
    const body = files[name];
    if (!body) {
      problems.push(`${name} (WinGet manifest) is missing from the release`);
      continue;
    }
    if (!new RegExp(`^PackageIdentifier:\\s*${packageId.replace(/\./g, "\\.")}\\s*$`, "m").test(body)) {
      problems.push(`${name} has the wrong PackageIdentifier (expected ${packageId})`);
    }
    if (!new RegExp(`^PackageVersion:\\s*${version.replace(/\./g, "\\.")}\\s*$`, "m").test(body)) {
      problems.push(`${name} has the wrong PackageVersion (expected ${version})`);
    }
    if (/SHA256_[A-Z0-9_]+/.test(body)) problems.push(`${name} still contains an unstamped checksum placeholder`);
  }
  const installer = files[`${packageId}.installer.yaml`];
  if (installer) {
    const urls = [...installer.matchAll(/InstallerUrl:\s*(\S+)/g)].map((m) => m[1]);
    const shas = [...installer.matchAll(/InstallerSha256:\s*([0-9a-fA-F]{64})/g)].map((m) => m[1].toLowerCase());
    if (urls.length === 0 || urls.length !== shas.length) problems.push("installer manifest must pair every InstallerUrl with an InstallerSha256");
    urls.forEach((url, i) => {
      const file = url.split("/").pop() ?? "";
      if (!pinned(url, repoSlug, version)) problems.push(`WinGet InstallerUrl not pinned to v${version}: ${url}`);
      if (sums.get(file) !== shas[i]) problems.push(`WinGet InstallerSha256 for ${file} does not match SHA256SUMS`);
    });
  }

  const scoop = files["xr.json"];
  if (!scoop) {
    problems.push("xr.json (Scoop manifest) is missing from the release");
  } else {
    try {
      const doc = JSON.parse(scoop) as { version?: string; architecture?: Record<string, { url?: string; hash?: string }> };
      if (doc.version !== version) problems.push(`xr.json declares ${doc.version ?? "none"}, expected ${version}`);
      for (const [arch, entry] of Object.entries(doc.architecture ?? {})) {
        const url = entry.url ?? "";
        const file = url.split("/").pop() ?? "";
        if (!pinned(url, repoSlug, version)) problems.push(`xr.json ${arch} url not pinned to v${version}: ${url}`);
        if (sums.get(file) !== (entry.hash ?? "").toLowerCase()) problems.push(`xr.json ${arch} hash does not match SHA256SUMS`);
      }
    } catch {
      problems.push("xr.json is not valid JSON");
    }
  }
  return problems;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const version = (arg(argv, "--version") ?? "").replace(/^v/, "");
  const dir = arg(argv, "--dir");
  const sumsPath = arg(argv, "--sums");
  const out = arg(argv, "--out");
  if (!version || !dir || !sumsPath || !out) {
    console.error("usage: channel-publish-verify.ts --version X.Y.Z --dir <assets> --sums <SHA256SUMS> --out <dir>");
    process.exit(2);
  }
  const manifest = loadManifest();
  const packageId = manifest.channels?.wingetPackageId ?? "ahmadrrrtx.XR";
  const repoSlug = manifest.identity.repo.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  const names = ["xr.rb", "xr.json", ...wingetFileNames(packageId)];
  const files: Record<string, string | undefined> = {};
  for (const n of names) files[n] = existsSync(join(dir, n)) ? readFileSync(join(dir, n), "utf8") : undefined;
  const problems = verifyChannelFiles({ version, packageId, repoSlug, sums: parseSums(readFileSync(sumsPath, "utf8")), files });
  if (problems.length > 0) {
    for (const p of problems) console.error(`[channel-publish-verify] FAIL — ${p}`);
    process.exit(1);
  }
  const place = (name: string, rel: string): void => {
    const dest = join(out, rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    copyFileSync(join(dir, name), dest);
    console.log(`[channel-publish-verify] ${name} → ${rel}`);
  };
  place("xr.rb", "homebrew/Formula/xr.rb");
  place("xr.json", "scoop/xr.json");
  const wdir = `winget/${wingetManifestDir(packageId, version)}`;
  for (const n of wingetFileNames(packageId)) place(n, `${wdir}/${n}`);
  console.log(`[channel-publish-verify] ok — channel files for v${version} are pinned and match the signed SHA256SUMS`);
}
