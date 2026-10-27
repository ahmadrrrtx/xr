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
  kind: "json-version" | "json-version-only" | "toml-version" | "cargo-lock-root" | "generated-module" | "site-identity" | "marker-block" | "shell-var" | "powershell-var";
}

/**
 * Launch-audit XR-LAUNCH-001 / owner decision D1 (2026-10-22) — public channels.
 *
 * `identity.version` is the in-development line carried on `main`. The public
 * install paths (bootstrap installers, npm `latest`, GitHub "latest" release,
 * Homebrew, WinGet, Scoop, Docker `latest`) serve `channels.publicVersion`, which
 * is promoted only after that version's live channel check passes
 * (`bun run channel:live`). Keeping the two apart prevents the v1.1.0 failure
 * mode: installers stamped with a version whose artifacts were never published.
 */
export const CHANNEL_IDS = ["github-releases", "npm", "homebrew", "winget", "scoop", "docker"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface WithdrawnTag {
  /** Git tag that exists but was never published (e.g. "v1.1.0"). */
  tag: string;
  /** Why it was withdrawn — evidence, not prose. */
  reason: string;
}

export interface ReleaseChannels {
  comment?: string;
  /** Version every public install path serves today (stable semver). */
  publicVersion: string;
  /** Channels publicly claimed; each is verified live by scripts/channel-live-check.ts. */
  claimed: ChannelId[];
  /** Homebrew tap repository (owner/homebrew-<name>); install as owner/<name>/xr. */
  homebrewTap: string;
  /** WinGet PackageIdentifier in microsoft/winget-pkgs. */
  wingetPackageId: string;
  /** Container image reference without tag. */
  dockerImage: string;
  /** Tags that exist in git but were never published on any channel. */
  withdrawnTags: WithdrawnTag[];
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** SemVer 2 precedence: numeric prerelease identifiers are NOT lexical (rc.9 < rc.10). */
export function compareSemver(a: string, b: string): number {
  const [ac, ap] = splitSemver(a);
  const [bc, bp] = splitSemver(b);
  for (let i = 0; i < 3; i++) {
    if (ac[i] !== bc[i]) return ac[i] < bc[i] ? -1 : 1;
  }
  if (ap === bp) return 0;
  if (ap === "") return 1;
  if (bp === "") return -1;
  const aa = ap.split("."), bb = bp.split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === undefined) return -1;
    if (bb[i] === undefined) return 1;
    if (aa[i] === bb[i]) continue;
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i]);
    if (an && bn) return BigInt(aa[i]) < BigInt(bb[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

function splitSemver(v: string): [bigint[], string] {
  const match = v.replace(/^v/, "").match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match || (match[4]?.split(".").some(p => /^0\d+$/.test(p)))) throw new Error(`invalid semver: ${v}`);
  return [[BigInt(match[1]), BigInt(match[2]), BigInt(match[3])], match[4] ?? ""];
}

/** Validate BEFORE any build. Never restamp committed identity from an arbitrary tag. */
export function validateReleaseTag(manifest: ReleaseManifest, tag: string): void {
  if (tag !== `v${manifest.identity.version}`) {
    throw new Error(`release tag ${tag} does not match committed identity v${manifest.identity.version}`);
  }
  splitSemver(manifest.identity.version);
  if (manifest.channels?.withdrawnTags.some(w => w.tag === tag)) throw new Error(`release tag ${tag} is withdrawn; never reuse it`);
  const preview = manifest.identity.version.includes("-");
  if (!preview && manifest.identity.stability !== "stable") throw new Error("stable tag requires identity.stability=stable and completed stable release gates; use a prerelease suffix for previews");
  if (preview && manifest.identity.stability === "stable") throw new Error("preview tag cannot be labeled stable");
}

/** The version public install paths serve (falls back to identity.version for legacy manifests). */
export function publicVersionOf(manifest: Pick<ReleaseManifest, "identity" | "channels">): string {
  return manifest.channels?.publicVersion ?? manifest.identity.version;
}

function validateChannels(channels: ReleaseChannels, id: ReleaseIdentity): void {
  if (typeof channels.publicVersion !== "string" || !SEMVER.test(channels.publicVersion)) {
    throw new Error(`manifest.channels.publicVersion must be semver, got "${String(channels.publicVersion)}"`);
  }
  if (channels.publicVersion.includes("-")) {
    throw new Error(
      `manifest.channels.publicVersion "${channels.publicVersion}" is a pre-release; public channels serve stable versions only`,
    );
  }
  if (compareSemver(channels.publicVersion, id.version) > 0) {
    throw new Error(
      `manifest.channels.publicVersion ${channels.publicVersion} is ahead of identity.version ${id.version}; promote only released versions`,
    );
  }
  if (!Array.isArray(channels.claimed) || channels.claimed.length === 0) {
    throw new Error("manifest.channels.claimed must be a non-empty array");
  }
  for (const c of channels.claimed) {
    if (!(CHANNEL_IDS as readonly string[]).includes(c)) {
      throw new Error(`manifest.channels.claimed has unknown channel "${c}" (known: ${CHANNEL_IDS.join(", ")})`);
    }
  }
  if (!/^[A-Za-z0-9-]+\/homebrew-[A-Za-z0-9-]+$/.test(channels.homebrewTap ?? "")) {
    throw new Error(`manifest.channels.homebrewTap must look like owner/homebrew-<name>, got "${String(channels.homebrewTap)}"`);
  }
  if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/.test(channels.wingetPackageId ?? "")) {
    throw new Error(`manifest.channels.wingetPackageId must look like Publisher.Package, got "${String(channels.wingetPackageId)}"`);
  }
  if (!/^[a-z0-9.-]+\/[a-z0-9._/-]+$/.test(channels.dockerImage ?? "")) {
    throw new Error(`manifest.channels.dockerImage must be registry/owner/name without a tag, got "${String(channels.dockerImage)}"`);
  }
  if (!Array.isArray(channels.withdrawnTags)) {
    throw new Error("manifest.channels.withdrawnTags must be an array (use [] when none)");
  }
  for (const w of channels.withdrawnTags) {
    if (!w || typeof w.tag !== "string" || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(w.tag)) {
      throw new Error(`manifest.channels.withdrawnTags entry has an invalid tag: ${JSON.stringify(w)}`);
    }
    if (typeof w.reason !== "string" || w.reason.trim().length < 10) {
      throw new Error(`manifest.channels.withdrawnTags ${w.tag} needs an evidence-backed reason`);
    }
    if (w.tag.slice(1) === channels.publicVersion) {
      throw new Error(`manifest.channels.publicVersion ${channels.publicVersion} cannot also be a withdrawn tag`);
    }
  }
}

export interface ReleaseManifest {
  manifestVersion: number;
  identity: ReleaseIdentity;
  channels?: ReleaseChannels;
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
  splitSemver(id.version); // Reject malformed/leading-zero prerelease identifiers too.
  if (id.stability !== undefined && !["public-beta", "developer-preview", "stable"].includes(id.stability)) {
    throw new Error(`manifest.identity.stability must be public-beta | developer-preview | stable, got "${id.stability}"`);
  }
  // Art. XXII.4/IX.4 — a prerelease version can never wear a "stable" label.
  if (id.stability === "stable" && id.version.includes("-")) {
    throw new Error(`prerelease version "${id.version}" cannot be labeled "stable" (Article XXII.4)`);
  }
  if (parsed.channels !== undefined) validateChannels(parsed.channels, id);
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
/** Human label for identity.stability (README, website). */
export const STATUS_LABEL: Record<NonNullable<ReleaseIdentity["stability"]>, string> = {
  "public-beta": "Public beta",
  "developer-preview": "Developer preview",
  stable: "Stable",
};

export function stampSiteTs(
  current: string,
  id: ReleaseIdentity,
  skillCount: number,
  publicVersion: string = id.version,
): string {
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

  // XR-LAUNCH-001: what the install channels serve, so the site never
  // announces an unpublished development line as "available".
  const publicRe = /^(\s*)publicVersion:\s*"[^"]*",/m;
  if (publicRe.test(out)) {
    out = out.replace(publicRe, `$1publicVersion: ${JSON.stringify(publicVersion)},`);
  } else {
    out = out.replace(
      /^(\s*)displayVersion:\s*"[^"]*",/m,
      `$&\n$1/** Version every install channel serves (release.manifest.json channels.publicVersion). */\n$1publicVersion: ${JSON.stringify(publicVersion)},`,
    );
  }

  // XR-LAUNCH-010 / D2: the release label the site shows next to the version.
  const label = STATUS_LABEL[id.stability ?? "stable"];
  const statusRe = /^(\s*)status:\s*"[^"]*",/m;
  if (statusRe.test(out)) {
    out = out.replace(statusRe, `$1status: ${JSON.stringify(label)},`);
  } else {
    out = out.replace(
      /^(\s*)publicVersion:\s*"[^"]*",/m,
      `$&\n$1/** Release label (release.manifest.json identity.stability; decision D2). */\n$1status: ${JSON.stringify(label)},`,
    );
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

export function buildReadmeBlock(id: ReleaseIdentity, skillCount: number, publicVersion: string = id.version): string {
  const stabilityLine =
    id.stability === "public-beta"
      ? `\n\n> **Status: Public beta.** ${id.name} is labelled beta until every launch gate in\n> [docs/release/launch-gates.json](docs/release/launch-gates.json) is green (decision D2; enforced by\n> \`bun run claim-lint\`). Install and use it, but check the [support matrix](docs/release/SUPPORT_MATRIX.md)\n> and the [known-limitations register](docs/release/${id.version}/known-limitations.md) before relying on it\n> for anything critical. The npm package and source installs need [Bun](https://bun.sh) ≥ 1.3 on \`PATH\`;\n> the installer binaries do not. Desktop app builds are not code-signed yet. On macOS and Windows the\n> agent's shell commands need Docker/Podman (or the experimental \`XR_OS_SANDBOX=experimental\` sandbox)\n> and are refused otherwise; never approve commands in a repository you do not trust. Feedback goes\n> through the [beta loop](docs/release/BETA.md).`
      : id.stability === "developer-preview"
        ? `\n\n> **Status: ${STATUS_LABEL["developer-preview"]}.** APIs and behavior may change without a deprecation cycle. Check the [known-limitations register](docs/release/${id.version}/known-limitations.md) and [candidate evidence](docs/release/RELEASE_CANDIDATE_REPORT.md); a preview label does not imply native-platform or signing validation.`
        : `\n\n> **Status: Stable.** ${id.name} is on the 1.0.0 production line: \`latest\` moves only on a stable tag, while pre-releases keep landing on the pre-release channel (npm \`beta\` dist-tag, GitHub pre-release). Check the [support matrix](docs/release/SUPPORT_MATRIX.md) and the [known-limitations register](docs/release/${id.version}/known-limitations.md) before adopting it for anything critical; feedback goes through the [issue tracker](https://github.com/ahmadrrrtx/xr/issues).`;
  return `${README_BEGIN}
<!-- GENERATED from release.manifest.json — do not edit by hand. Run: bun run release:stamp -->

**Version:** \`${DISPLAY(id)}\` · **Package:** [\`${id.name}\`](${id.npm}) · **License:** ${id.license}${stabilityLine}

> **Version source of truth:** [\`release.manifest.json\`](release.manifest.json). Every surface —
> \`src/core/version.ts\`, \`package.json\`, this README, \`install.sh\`, \`install.ps1\` and the website —
> is stamped from that one file, and CI fails the build if any of them drift
> (Constitution Article XXII.1).

${id.description}

**Bundled skills:** ${skillCount} (counted from \`skills/\` at release time.)${publicChannelLine(id, publicVersion)}
${README_END}`;
}

/**
 * XR-LAUNCH-001 — when `main` carries a version that public channels do not
 * serve, say so next to the version line instead of implying it is installable.
 */
export function publicChannelLine(id: ReleaseIdentity, publicVersion: string): string {
  if (publicVersion === id.version) return "";
  return `

> **Install channels currently serve \`${publicVersion}\`.** \`${id.version}\` is the in-development line on
> \`main\`: it is not published to npm, Homebrew, WinGet, Scoop or Docker, and the installers below
> install \`${publicVersion}\`. See [docs/release/CHANNELS.md](docs/release/CHANNELS.md#public-version).`;
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

/**
 * Launch-audit L-008 — version-ONLY sync for JSON surfaces that must not be
 * rewritten wholesale (tauri.conf.json): stamp just the top-level `version`,
 * leaving every other key byte-identical. This is what users actually see on
 * the produced installers (Tauri v2 reads conf version over Cargo version).
 */
export function stampJsonVersionOnly(content: string, version: string): string {
  const doc = JSON.parse(content);
  doc.version = version;
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Launch-audit L-008 — stamp `version` inside the `[package]` section of a
 * Cargo.toml without touching anything else (comments, key order, spacing).
 * Fails loudly if the file has no package-version line — silent no-op
 * stamping is exactly the drift class this gate exists to kill.
 */
export function stampTomlPackageVersion(content: string, version: string): string {
  const lines = content.split("\n");
  let inPackage = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\[.*\]$/.test(t)) inPackage = t === "[package]";
    if (inPackage && /^version\s*=\s*"[^"]*"\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(version\s*=\s*")[^"]*(".*)$/u, `$1${version}$2`);
      return lines.join("\n");
    }
  }
  throw new Error("no [package] version line found to stamp");
}

/**
 * Derived root-package identity only. This is an explicit release stamp, not a
 * dependency lock regeneration: no third-party version, checksum or edge is
 * changed. `cargo check --locked` remains the independent dependency gate.
 */
export function stampCargoLockRoot(content: string, version: string): string {
  const block = /(^\[\[package\]\]\r?\nname = "xr-desktop"\r?\nversion = ")[^"]*(")/gm;
  if ([...content.matchAll(block)].length !== 1) throw new Error("Cargo.lock must contain exactly one xr-desktop root package identity");
  return content.replace(block, `$1${version}$2`);
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
function isInstallerTarget(target: StampTarget): boolean {
  return target.kind === "shell-var" || target.kind === "powershell-var";
}

export function evaluateSurfaces(manifest: ReleaseManifest, root: string = ROOT): SurfaceResult[] {
  const id = manifest.identity;
  const pub = publicVersionOf(manifest);
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
      desired = renderTarget(target, current, id, skillCount, pub);
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
    const want = isInstallerTarget(target) ? `public ${pub}` : id.version;
    results.push({
      id: target.id,
      path: target.path,
      inSync,
      detail: inSync ? `in sync at ${want}` : `out of sync — expected version ${want}`,
    });
  }
  return results;
}

export function renderTarget(
  target: StampTarget,
  current: string,
  id: ReleaseIdentity,
  skillCount: number,
  publicVersion: string = id.version,
): string {
  switch (target.kind) {
    case "json-version":
      return stampPackageJson(current, id);
    case "json-version-only":
      return stampJsonVersionOnly(current, id.version);
    case "toml-version":
      return stampTomlPackageVersion(current, id.version);
    case "cargo-lock-root":
      return stampCargoLockRoot(current, id.version);
    case "generated-module":
      return buildVersionTs(id);
    case "site-identity":
      return stampSiteTs(current, id, skillCount, publicVersion);
    case "marker-block":
      return stampMarkerBlock(current, buildReadmeBlock(id, skillCount, publicVersion));
    // The bootstrap installers install what public channels serve (XR-LAUNCH-001/002),
    // never an in-development version whose artifacts may not exist.
    case "shell-var":
      return stampShellVersion(current, publicVersion);
    case "powershell-var":
      return stampPowershellVersion(current, publicVersion);
    default: {
      const exhaustive: never = target.kind;
      throw new Error(`unknown stamp target kind: ${String(exhaustive)}`);
    }
  }
}

export function writeSurfaces(manifest: ReleaseManifest, root: string = ROOT): SurfaceResult[] {
  const id = manifest.identity;
  const pub = publicVersionOf(manifest);
  const skillCount = countSkills(root);
  const results: SurfaceResult[] = [];

  for (const target of manifest.stampTargets) {
    const abs = join(root, target.path);
    if (!existsSync(abs)) {
      throw new Error(`declared stamp target does not exist: ${target.path}`);
    }
    const current = readFileSync(abs, "utf8");
    const desired = renderTarget(target, current, id, skillCount, pub);
    if (normalizeEol(current) !== normalizeEol(desired)) {
      writeFileSync(abs, desired, "utf8");
      const want = isInstallerTarget(target) ? `public ${pub}` : id.version;
      results.push({ id: target.id, path: target.path, inSync: true, detail: `stamped → ${want}` });
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
    console.log(
      JSON.stringify({ ...id, display: DISPLAY(id), skillCount: countSkills(), publicVersion: publicVersionOf(manifest) }, null, 2),
    );
    return;
  }

  if (args.includes("--check")) {
    const tagIndex = args.indexOf("--tag");
    const tag = tagIndex >= 0 ? args[tagIndex + 1] : process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
    if (tagIndex >= 0 && (!tag || tag.startsWith("--"))) throw new Error("--tag requires a release tag");
    if (tag !== undefined) validateReleaseTag(manifest, tag);
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
