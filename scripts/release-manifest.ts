#!/usr/bin/env bun
/**
 * XR — Release manifest authority (Phase 0 · T1)
 *
 * `release.manifest.json` is the SINGLE SOURCE OF TRUTH for release identity and
 * public claims (Constitution Article XXII.1, Article XIX.1, Commandment 6).
 *
 * This module is the only code permitted to read that manifest and to write the
 * derived surfaces. It replaces the partial authority previously held by
 * `scripts/set-version.ts`, which stamped only 3 of 6 surfaces — the exact gap
 * that let README (3.1.6) and the installers (1.0.0) drift away from
 * version.ts (7.0.0) while CI stayed green.
 *
 *   bun run scripts/release-manifest.ts --check   # CI: fail on any drift
 *   bun run scripts/release-manifest.ts --write   # stamp every surface
 *   bun run scripts/release-manifest.ts --print   # emit resolved identity JSON
 *
 * Design principle (research R1): a stamping tool is only as strong as its file
 * list, so the manifest declares its own target list and `--check` fails if a
 * declared target is missing. Coverage is data, not code.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export const MANIFEST_PATH = join(ROOT, "release.manifest.json");

export interface ReleaseIdentity {
  name: string;
  version: string;
  codename: string;
  description: string;
  author: string;
  license: string;
  repo: string;
  homepage: string;
  npm: string;
  /**
   * Phase 9 · T6 — honest maturity label stamped across surfaces. Stable
   * releases carry "public-beta" until Phase 10 enterprise readiness; the
   * label is never upgraded without the exit-gate evidence that allows it
   * (Art. XIX). Pre-release versions are detected from semver suffixes.
   */
  stability?: "public-beta" | "developer-preview" | "stable";
}

export interface ReleaseClaim {
  id: string;
  text: string;
  evidence: string;
  expires: string;
  mechanical?: { kind: string; value: number };
}

export interface ProhibitedClaim {
  pattern: string;
  reason: string;
}

export interface StampTarget {
  id: string;
  path: string;
  kind: "json-version" | "generated-module" | "site-identity" | "marker-block" | "shell-var" | "powershell-var";
}

export interface ReleaseManifest {
  manifestVersion: number;
  identity: ReleaseIdentity;
  stampTargets: StampTarget[];
  claims: ReleaseClaim[];
  prohibitedClaims: ProhibitedClaim[];
  supervisedTerms: string[];
  scannedSurfaces: string[];
}

/** Read and validate the manifest. Throws on structural problems — fail closed. */
export function loadManifest(path: string = MANIFEST_PATH): ReleaseManifest {
  if (!existsSync(path)) {
    throw new Error(`release manifest not found at ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ReleaseManifest;

  const id = parsed.identity;
  if (!id) throw new Error("manifest.identity is required");
  for (const field of ["name", "version", "codename", "description", "author", "license", "repo", "homepage", "npm"] as const) {
    if (!id[field] || typeof id[field] !== "string") {
      throw new Error(`manifest.identity.${field} is required and must be a string`);
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(id.version)) {
    throw new Error(`manifest.identity.version must be semver, got "${id.version}" (Article XXII.2)`);
  }
  if (id.stability !== undefined && !["public-beta", "developer-preview", "stable"].includes(id.stability)) {
    throw new Error(`manifest.identity.stability must be public-beta | developer-preview | stable, got "${id.stability}"`);
  }
  // Art. XXII.4/IX.4 — a prerelease version can never wear a "stable" label.
  if (id.stability === "stable" && id.version.includes("-")) {
    throw new Error(`prerelease version "${id.version}" cannot be labeled "stable" (Article XXII.4)`);
  }
  if (!Array.isArray(parsed.stampTargets) || parsed.stampTargets.length === 0) {
    throw new Error("manifest.stampTargets must be a non-empty array");
  }
  if (!Array.isArray(parsed.claims)) throw new Error("manifest.claims must be an array");
  for (const claim of parsed.claims) {
    if (!claim.id || !claim.text) throw new Error(`claim missing id/text: ${JSON.stringify(claim)}`);
    if (!claim.evidence) throw new Error(`claim "${claim.id}" has no evidence link (Article XIX.1 / ADR-10)`);
    if (!claim.expires || Number.isNaN(Date.parse(claim.expires))) {
      throw new Error(`claim "${claim.id}" has no valid expiry date (Article XXII.4)`);
    }
  }
  return parsed;
}

/** Count bundled skills — mechanical evidence for the skills-count claim. */
export function countSkills(root: string = ROOT): number {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((entry) => {
    try {
      return statSync(join(dir, entry)).isDirectory();
    } catch {
      return false;
    }
  }).length;
}

export const DISPLAY = (id: ReleaseIdentity) => `${id.version} (${id.codename})`;

// ── Surface generators ───────────────────────────────────────────────────────

export function buildVersionTs(id: ReleaseIdentity): string {
  return `/**
 * XR — SINGLE SOURCE OF TRUTH for version + identity (runtime view).
 *
 * GENERATED FILE — do not edit by hand.
 * Source: release.manifest.json  ·  Regenerate: bun run release:stamp
 *
 * Constitution Article XXII.1 requires one release manifest to stamp version
 * across version.ts, package.json, README, installers and website, with CI
 * failing on drift. Editing this file directly reintroduces the drift that
 * Phase 0 exists to eliminate.
 */

export const PKG = {
  name: ${JSON.stringify(id.name)},
  version: ${JSON.stringify(id.version)},
  codename: ${JSON.stringify(id.codename)},
  repo: ${JSON.stringify(id.repo)},
  homepage: ${JSON.stringify(id.homepage)},
  npm: ${JSON.stringify(id.npm)},
  description: ${JSON.stringify(id.description)},
  author: ${JSON.stringify(id.author)},
  license: ${JSON.stringify(id.license)},
} as const;

/** Runtime/package version. All code should use this, not XRKernel.VERSION directly. */
export const CORE_VERSION: string = PKG.version;

/** CLI codename — human friendly release name. */
export const CODENAME: string = PKG.codename;

/**
 * Host ABI version exposed to plugins (see src/plugins/host.ts).
 * Bump ONLY when the host surface (PluginHost / capabilities) changes in a
 * breaking way, so XR can deterministically refuse an incompatible plugin.
 */
export const PLUGIN_API_VERSION = 2;

/** Human-facing version string for \`xr version\` and dashboard. */
export const DISPLAY_VERSION = \`\${PKG.version} (\${PKG.codename})\`;

/** Compact identity object for cross-cutting use (website, CLI, dashboard, --json). */
export const PKG_IDENTITY = {
  name: PKG.name,
  version: PKG.version,
  codename: PKG.codename,
  repo: PKG.repo,
  homepage: PKG.homepage,
  npm: PKG.npm,
  displayVersion: DISPLAY_VERSION,
  description: PKG.description,
  author: PKG.author,
  license: PKG.license,
} as const;

export interface VersionInfo {
  name: string;
  version: string;
  codename: string;
  display: string;
  displayVersion: string;
  repo: string;
  homepage: string;
  npm: string;
  description: string;
  author: string;
  license: string;
  pluginApi: number;
}

/** Structured version payload for \`--json\` surfaces. */
export function versionInfo(): VersionInfo {
  return {
    name: PKG.name,
    version: PKG.version,
    codename: PKG.codename,
    display: DISPLAY_VERSION,
    displayVersion: DISPLAY_VERSION,
    repo: PKG.repo,
    homepage: PKG.homepage,
    npm: PKG.npm,
    description: PKG.description,
    author: PKG.author,
    license: PKG.license,
    pluginApi: PLUGIN_API_VERSION,
  };
}
`;
}

/**
 * Stamp identity fields into website/src/lib/site.ts *in place*.
 *
 * The website's `site` object also carries navigation and footer structure that
 * is NOT release identity and must survive stamping (Constitution Article XXIII:
 * stable surfaces stay stable; no silent breaks). So this is a surgical field
 * update, not a regeneration: only the release-owned scalars are rewritten, and
 * `skillCount` is inserted/updated so the site can render a true scale number.
 */
export function stampSiteTs(current: string, id: ReleaseIdentity, skillCount: number): string {
  const scalars: Array<[string, string]> = [
    ["version", id.version],
    ["codename", id.codename],
    ["displayVersion", DISPLAY(id)],
    ["github", id.repo],
    ["npm", id.npm],
    ["url", id.homepage],
  ];

  let out = current;
  for (const [key, value] of scalars) {
    const re = new RegExp(`^(\\s*)${key}:\\s*"[^"]*",`, "m");
    if (!re.test(out)) {
      throw new Error(`website/src/lib/site.ts is missing the stampable field "${key}"`);
    }
    out = out.replace(re, `$1${key}: ${JSON.stringify(value)},`);
  }

  const skillRe = /^(\s*)skillCount:\s*\d+,/m;
  if (skillRe.test(out)) {
    out = out.replace(skillRe, `$1skillCount: ${skillCount},`);
  } else {
    const anchor = /^(\s*)displayVersion:\s*"[^"]*",/m;
    out = out.replace(
      anchor,
      `$&\n$1/** Bundled skills, mechanically counted from skills/ at stamp time. */\n$1skillCount: ${skillCount},`,
    );
  }
  return out;
}

// ── Marker-block stamping (README) ───────────────────────────────────────────

export const README_BEGIN = "<!-- XR:RELEASE-IDENTITY:BEGIN -->";
export const README_END = "<!-- XR:RELEASE-IDENTITY:END -->";

export function buildReadmeBlock(id: ReleaseIdentity, skillCount: number): string {
  const stabilityLine =
    id.stability === "public-beta"
      ? `\n\n> **Status: Public Beta.** ${id.name} is honestly labeled beta software: install and use it,\n> expect the documented golden path to work on the validated platforms, and check the\n> [support matrix](docs/release/SUPPORT_MATRIX.md) and\n> [known-limitations register](docs/release/${id.version}/known-limitations.md) before adopting it\n> for anything critical. \`v*-beta.*\` tags land on the prerelease channel (npm \`beta\` dist-tag,\n> GitHub prerelease) for early adopters; feedback goes through the\n> [beta loop](docs/release/BETA.md).`
      : id.stability === "developer-preview"
        ? `\n\n> **Status: Developer Preview.** APIs and behavior may change without a deprecation cycle.`
        : "";
  return `${README_BEGIN}
<!-- GENERATED from release.manifest.json — do not edit by hand. Run: bun run release:stamp -->

**Version:** \`${DISPLAY(id)}\` · **Package:** [\`${id.name}\`](${id.npm}) · **License:** ${id.license}${stabilityLine}

> **Version source of truth:** [\`release.manifest.json\`](release.manifest.json). Every surface —
> \`src/core/version.ts\`, \`package.json\`, this README, \`install.sh\`, \`install.ps1\` and the website —
> is stamped from that one file, and CI fails the build if any of them drift
> (Constitution Article XXII.1).

${id.description}

**Bundled skills:** ${skillCount} (counted from \`skills/\` at release time.)
${README_END}`;
}

export function stampMarkerBlock(content: string, block: string): string {
  const begin = content.indexOf(README_BEGIN);
  const end = content.indexOf(README_END);
  if (begin === -1 || end === -1) {
    throw new Error(
      `README is missing the ${README_BEGIN} / ${README_END} markers — cannot stamp release identity.`,
    );
  }
  return content.slice(0, begin) + block + content.slice(end + README_END.length);
}

// ── Scalar stamping (installers, package.json) ───────────────────────────────

export function stampShellVersion(content: string, version: string): string {
  if (!/^VERSION="[^"]*"$/m.test(content)) {
    throw new Error('install.sh is missing a top-level VERSION="…" assignment');
  }
  return content.replace(/^VERSION="[^"]*"$/m, `VERSION="${version}"`);
}

export function stampPowershellVersion(content: string, version: string): string {
  if (!/^\$Version = '[^']*'/m.test(content)) {
    throw new Error("install.ps1 is missing a top-level $Version = '…' assignment");
  }
  return content.replace(/^\$Version = '[^']*'/m, `$Version = '${version}'`);
}

export function stampPackageJson(content: string, id: ReleaseIdentity): string {
  const pkg = JSON.parse(content);
  pkg.name = id.name;
  pkg.version = id.version;
  pkg.description = id.description;
  pkg.author = id.author;
  pkg.license = id.license;
  pkg.homepage = id.homepage;
  return JSON.stringify(pkg, null, 2) + "\n";
}

// ── Drift detection ──────────────────────────────────────────────────────────

export interface SurfaceResult {
  id: string;
  path: string;
  inSync: boolean;
  detail: string;
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * Compute the desired content of every declared surface and compare with disk.
 * A missing declared target is itself a failure (research R1: incomplete
 * coverage is the defect class, not just stale content).
 */
export function evaluateSurfaces(manifest: ReleaseManifest, root: string = ROOT): SurfaceResult[] {
  const id = manifest.identity;
  const skillCount = countSkills(root);
  const results: SurfaceResult[] = [];

  for (const target of manifest.stampTargets) {
    const abs = join(root, target.path);
    if (!existsSync(abs)) {
      results.push({ id: target.id, path: target.path, inSync: false, detail: "declared stamp target does not exist" });
      continue;
    }
    const current = readFileSync(abs, "utf8");
    let desired: string;
    try {
      desired = renderTarget(target, current, id, skillCount);
    } catch (err) {
      results.push({
        id: target.id,
        path: target.path,
        inSync: false,
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const inSync = normalizeEol(current) === normalizeEol(desired);
    results.push({
      id: target.id,
      path: target.path,
      inSync,
      detail: inSync ? `in sync at ${id.version}` : `out of sync — expected version ${id.version}`,
    });
  }
  return results;
}

export function renderTarget(
  target: StampTarget,
  current: string,
  id: ReleaseIdentity,
  skillCount: number,
): string {
  switch (target.kind) {
    case "json-version":
      return stampPackageJson(current, id);
    case "generated-module":
      return buildVersionTs(id);
    case "site-identity":
      return stampSiteTs(current, id, skillCount);
    case "marker-block":
      return stampMarkerBlock(current, buildReadmeBlock(id, skillCount));
    case "shell-var":
      return stampShellVersion(current, id.version);
    case "powershell-var":
      return stampPowershellVersion(current, id.version);
    default: {
      const exhaustive: never = target.kind;
      throw new Error(`unknown stamp target kind: ${String(exhaustive)}`);
    }
  }
}

export function writeSurfaces(manifest: ReleaseManifest, root: string = ROOT): SurfaceResult[] {
  const id = manifest.identity;
  const skillCount = countSkills(root);
  const results: SurfaceResult[] = [];

  for (const target of manifest.stampTargets) {
    const abs = join(root, target.path);
    if (!existsSync(abs)) {
      throw new Error(`declared stamp target does not exist: ${target.path}`);
    }
    const current = readFileSync(abs, "utf8");
    const desired = renderTarget(target, current, id, skillCount);
    if (normalizeEol(current) !== normalizeEol(desired)) {
      writeFileSync(abs, desired, "utf8");
      results.push({ id: target.id, path: target.path, inSync: true, detail: `stamped → ${id.version}` });
    } else {
      results.push({ id: target.id, path: target.path, inSync: true, detail: "already in sync" });
    }
  }
  return results;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifest = loadManifest();
  const id = manifest.identity;

  if (args.includes("--print")) {
    console.log(JSON.stringify({ ...id, display: DISPLAY(id), skillCount: countSkills() }, null, 2));
    return;
  }

  if (args.includes("--check")) {
    const results = evaluateSurfaces(manifest);
    const drifted = results.filter((r) => !r.inSync);
    for (const r of results) {
      console.log(`${r.inSync ? "  ok  " : " DRIFT"}  ${r.path.padEnd(28)} ${r.detail}`);
    }
    if (drifted.length > 0) {
      console.error(
        `\n[release-manifest] ${drifted.length} surface(s) drifted from release.manifest.json (v${id.version}).`,
      );
      console.error("[release-manifest] Fix: bun run release:stamp");
      process.exit(1);
    }
    console.log(`\n[release-manifest] all ${results.length} surfaces in sync at ${DISPLAY(id)}`);
    return;
  }

  const results = writeSurfaces(manifest);
  for (const r of results) console.log(`  ${r.path.padEnd(28)} ${r.detail}`);
  console.log(`\n[release-manifest] stamped ${results.length} surfaces → ${DISPLAY(id)}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[release-manifest] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
