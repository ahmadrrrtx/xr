#!/usr/bin/env bun
/**
 * XR Phase 9 · T3 — Distribution model (single authority for channels).
 *
 * ONE canonical build → many channels (research R1, Constitution Art. XXII.1).
 * This module holds:
 *
 *   1. the Distribution types + validation for release.manifest.json's
 *      `distribution` section (targets, channels, support tiers, stability);
 *   2. the pure render functions that GENERATE every channel file
 *      (Homebrew formula, Scoop manifest, WinGet manifests, RPM spec,
 *      the website distribution module, the support matrix);
 *   3. the hash-fill pass the release pipeline uses to pin sha256s into the
 *      rendered channel files before publishing.
 *
 * Nothing here performs I/O on the repo. `scripts/release-manifest.ts`
 * (the only surface-stamping authority, Phase 0 · T1) calls these renders as
 * stamp-target kinds, so `release:check` fails on any channel drift and
 * `release:stamp` regenerates every channel file from the manifest.
 *
 * Hash placeholders are intentional: the canonical SHA-256 of a release asset
 * exists only after the build. At release time the pipeline substitutes
 * `__SHA256_<FILE>__` tokens with the real digests from hashes.json — one
 * build, many channels, byte-identical payloads.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TargetDef {
  /** Logical id, e.g. "linux-x64". */
  id: string;
  os: "linux" | "macos" | "windows";
  arch: "x64" | "arm64";
  /** bun build --compile target, e.g. "bun-linux-x64". */
  bunTarget: string;
  /** Release asset file name, e.g. "xr-linux-x64". */
  file: string;
  /** 1 = default/recommended, 2 = community/best-effort. */
  tier: 1 | 2;
}

export type ChannelKind = "binary" | "package-manager" | "registry" | "container";
export type UpdateOwner = "xr" | "channel";

export interface ChannelDef {
  id: string;
  kind: ChannelKind;
  /** Who performs update/rollback for installs from this channel. */
  updateOwner: UpdateOwner;
  os: Array<TargetDef["os"]>;
  /** 1 = tier-1 (validated), 2 = best-effort. Absent ids are not offered. */
  tier: 1 | 2;
  /** Human one-liner; stamped into the website distribution module. */
  summary: string;
  /** The install command a user runs (stamped into docs/site). */
  install: string;
  /** Update (and rollback hint) presented to users of PM-owned channels. */
  update: string;
  rollback: string;
}

export interface SupportTierDef {
  os: TargetDef["os"];
  arch: string;
  tier: 1 | 2 | "unsupported";
  /** CI evidence link — a support claim without CI parity is a false claim. */
  evidence: string;
  notes?: string;
}

export interface Distribution {
  /** Honesty label — 'beta' for this phase; never 'stable'/'ga' until earned. */
  stability: "alpha" | "beta" | "rc" | "stable";
  stabilityLabel: string;
  tagline: string;
  targets: TargetDef[];
  channels: ChannelDef[];
  supportTiers: SupportTierDef[];
}

export interface MinimalManifest {
  identity: {
    name: string;
    version: string;
    codename: string;
    description: string;
    author: string;
    license: string;
    repo: string;
    homepage: string;
    npm: string;
  };
  distribution?: Distribution;
}

// ── Validation (fail closed) ─────────────────────────────────────────────────

export function validateDistribution(manifest: MinimalManifest): Distribution {
  const d = manifest.distribution;
  if (!d) throw new Error("manifest.distribution is required (Phase 9 · T3)");
  if (!["alpha", "beta", "rc", "stable"].includes(d.stability)) {
    throw new Error(`distribution.stability must be alpha|beta|rc|stable, got "${String(d.stability)}"`);
  }
  if (!d.stabilityLabel || typeof d.stabilityLabel !== "string") {
    throw new Error("distribution.stabilityLabel is required");
  }
  if (d.stability !== "stable" && /stable|production-ready|generally available|\bga\b/i.test(d.stabilityLabel)) {
    throw new Error(
      `distribution.stabilityLabel "${d.stabilityLabel}" overclaims for stability="${d.stability}" (Article XIX)`,
    );
  }

  const ids = new Set<string>();
  for (const t of d.targets ?? []) {
    if (!t.id || !t.os || !t.arch || !t.bunTarget || !t.file) {
      throw new Error(`distribution.targets entry malformed: ${JSON.stringify(t)}`);
    }
    if (ids.has(t.id)) throw new Error(`duplicate target id "${t.id}"`);
    ids.add(t.id);
    if (!t.bunTarget.startsWith("bun-")) {
      throw new Error(`target "${t.id}" bunTarget must start with "bun-"`);
    }
    if (t.tier !== 1 && t.tier !== 2) throw new Error(`target "${t.id}" tier must be 1|2`);
  }
  if (d.targets.length < 5) {
    throw new Error(`distribution.targets must cover all 5 build-matrix targets, got ${d.targets.length}`);
  }

  const channelIds = new Set<string>();
  for (const c of d.channels ?? []) {
    if (!c.id || !c.kind || !c.updateOwner || !Array.isArray(c.os) || !c.summary || !c.install || !c.update || !c.rollback) {
      throw new Error(`distribution.channels entry malformed: ${JSON.stringify(c)}`);
    }
    if (channelIds.has(c.id)) throw new Error(`duplicate channel id "${c.id}"`);
    channelIds.add(c.id);
    if (c.tier !== 1 && c.tier !== 2) throw new Error(`channel "${c.id}" tier must be 1|2`);
  }

  for (const s of d.supportTiers ?? []) {
    if (!s.os || !s.arch || !s.evidence) {
      throw new Error(`distribution.supportTiers entry malformed: ${JSON.stringify(s)}`);
    }
    if (s.tier !== 1 && s.tier !== 2 && s.tier !== "unsupported") {
      throw new Error(`supportTiers "${s.os}/${s.arch}" tier must be 1|2|"unsupported"`);
    }
    // Art. IX.4: a tier-1/2 claim without CI evidence is forbidden.
    if (s.tier !== "unsupported" && !s.evidence.startsWith(".github/workflows/")) {
      throw new Error(
        `supportTiers "${s.os}/${s.arch}" is tier ${s.tier} but names no CI evidence (workflow path required)`,
      );
    }
  }
  return d;
}

// ── Hash placeholders ────────────────────────────────────────────────────────

export function shaTokenFor(file: string): string {
  return `__SHA256_${file.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}__`;
}

export interface ReleaseHashes {
  version: string;
  files: Array<{ file: string; sha256: string; bytes?: number; target?: string }>;
}

/**
 * Substitute every `__SHA256_<FILE>__` token in `content` with the real digest.
 * FAIL CLOSED: if a placeholder remains after substitution, throw — a channel
 * must never be published half-pinned (Part 20: no unsigned distribution).
 */
export function fillHashes(content: string, hashes: ReleaseHashes): string {
  const byFile = new Map(hashes.files.map((f) => [f.file, f.sha256]));
  const out = content.replace(/__SHA256_([A-Z0-9_]+)__/g, (_all, key: string) => {
    const file = [...byFile.keys()].find(
      (f) => f.replace(/[^A-Za-z0-9]/g, "_").toUpperCase() === key,
    );
    if (!file) {
      throw new Error(`no sha256 recorded for channel token __SHA256_${key}__ (hashes.json incomplete?)`);
    }
    return byFile.get(file)!;
  });
  if (/__SHA256_[A-Z0-9_]+__/.test(out)) {
    throw new Error("unresolved sha256 placeholder remains after fill — refusing to publish an unpinned channel");
  }
  return out;
}

// ── Homebrew formula (tap: ahmadrrrtx/homebrew-tap) ─────────────────────────

export function renderHomebrewFormula(manifest: MinimalManifest): string {
  const d = validateDistribution(manifest);
  const id = manifest.identity;
  const v = id.version;
  const url = (file: string) => `${id.repo}/releases/download/v${v}/${file}`;
  const t = (targetId: string) => {
    const t = d.targets.find((x) => x.id === targetId);
    if (!t) throw new Error(`target "${targetId}" missing from manifest`);
    return t;
  };
  const desc = "XR — a local-first, provider-neutral AI agent runtime. BYOK, spend-capped, tamper-evident audit.";
  return `# GENERATED from release.manifest.json — do not edit by hand.
# Regenerate: bun run channel:render (source of truth: manifest.distribution)
# Phase 9 · T3. Hash tokens are pinned with real digests from SHA256SUMS at
# release time; a formula with __SHA256_…__ tokens is never published.
class Xr < Formula
  desc ${JSON.stringify(desc)}
  homepage ${JSON.stringify(id.homepage)}
  version ${JSON.stringify(v)}
  license ${JSON.stringify(id.license)}

  on_macos do
    on_arm do
      url ${JSON.stringify(url(t("darwin-arm64").file))}
      sha256 "${shaTokenFor(t("darwin-arm64").file)}"
    end
    on_intel do
      url ${JSON.stringify(url(t("darwin-x64").file))}
      sha256 "${shaTokenFor(t("darwin-x64").file)}"
    end
  end

  on_linux do
    on_arm do
      url ${JSON.stringify(url(t("linux-arm64").file))}
      sha256 "${shaTokenFor(t("linux-arm64").file)}"
    end
    on_intel do
      url ${JSON.stringify(url(t("linux-x64").file))}
      sha256 "${shaTokenFor(t("linux-x64").file)}"
    end
  end

  def install
    bin.install Dir["xr-*"].first => "xr"
  end

  def caveats
    <<~EOS
      XR is a ${d.stabilityLabel}. Report false claims or bugs:
        ${id.repo}/issues
      Verify this release: ${id.repo}/blob/main/docs/release/VERIFYING_RELEASES.md
    EOS
  end

  test do
    assert_match version.to_s, shell_output("\#{bin}/xr --version")
  end
end
`;
}

// ── Scoop manifest (bucket: ahmadrrrtx/scoop-bucket) ────────────────────────

export function renderScoopManifest(manifest: MinimalManifest): string {
  const d = validateDistribution(manifest);
  const id = manifest.identity;
  const v = id.version;
  const win = d.targets.find((t) => t.id === "windows-x64");
  if (!win) throw new Error("windows-x64 target missing from manifest");
  const manifestJson = {
    "##": "GENERATED from release.manifest.json — regenerate: bun run channel:render",
    version: v,
    description:
      "XR — a local-first, provider-neutral AI agent runtime (" + d.stabilityLabel.toLowerCase() + "). BYOK, spend-capped, local-first.",
    homepage: id.homepage,
    license: id.license,
    github: id.repo,
    architecture: {
      "64bit": {
        url: `${id.repo}/releases/download/v${v}/${win.file}#/xr.exe`,
        hash: shaTokenFor(win.file),
      },
    },
    bin: "xr.exe",
    checkver: "github",
    autoupdate: {
      architecture: {
        "64bit": {
          url: `${id.repo}/releases/download/v$version/${win.file}#/xr.exe`,
          hash: {
            url: "$baseurl/SHA256SUMS",
          },
        },
      },
    },
  };
  return JSON.stringify(manifestJson, null, 4) + "\n";
}

// ── WinGet manifests (submission templates; wingetcreate submits) ────────────

export function renderWingetFiles(manifest: MinimalManifest): Record<string, string> {
  const d = validateDistribution(manifest);
  const id = manifest.identity;
  const v = id.version;
  const win = d.targets.find((t) => t.id === "windows-x64");
  if (!win) throw new Error("windows-x64 target missing from manifest");
  const pkgId = "ahmadrrrtx.XR";
  const url = `${id.repo}/releases/download/v${v}/${win.file}`;

  const version = `# GENERATED from release.manifest.json — regenerate: bun run channel:render
# Reference manifest; the release job submits via wingetcreate (ADR-0023).
PackageIdentifier: ${pkgId}
PackageVersion: ${v}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`;
  const locale = `# GENERATED from release.manifest.json — regenerate: bun run channel:render
PackageIdentifier: ${pkgId}
PackageVersion: ${v}
PackageLocale: en-US
Publisher: Muhammad Ahmad
PackageName: XR
PackageUrl: ${id.repo}
License: ${id.license}
LicenseUrl: ${id.repo}/blob/main/LICENSE
ShortDescription: Local-first, provider-neutral AI agent runtime (${d.stabilityLabel})
Description: ${manifest.identity.description}
Moniker: xr
Tags:
- ai-agent
- ai-os
- byok
- cli
- local-llm
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`;
  const installer = `# GENERATED from release.manifest.json — regenerate: bun run channel:render
PackageIdentifier: ${pkgId}
PackageVersion: ${v}
InstallerType: portable
UpgradeBehavior: install
Commands:
- xr
ReleaseDate: __RELEASE_DATE__
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${shaTokenFor(win.file)}
ManifestType: installer
ManifestVersion: 1.6.0
`;
  return {
    "packaging/winget/ahmadrrrtx.XR.yaml": version,
    "packaging/winget/ahmadrrrtx.XR.locale.en-US.yaml": locale,
    "packaging/winget/ahmadrrrtx.XR.installer.yaml": installer,
  };
}

// ── RPM spec reference (built by scripts/package-linux.ts via rpmbuild) ──────

export function renderRpmSpec(manifest: MinimalManifest): string {
  validateDistribution(manifest);
  const id = manifest.identity;
  return `# GENERATED from release.manifest.json — regenerate: bun run channel:render
# Built by scripts/package-linux.ts (rpmbuild on the release runner); SOURCE0 is
# the canonical xr-linux-x64 binary from SHA256SUMS (never a rebuilt artifact).
Name:           xr
Version:        ${id.version.split("-")[0]}
Release:        1%{?dist}
Summary:        XR — local-first, provider-neutral AI agent runtime

License:        ${id.license}
URL:            ${id.homepage}
Source0:        xr-linux-x64
Requires:       coreutils
AutoReqProv:    no

%description
${manifest.identity.description}

%install
mkdir -p %{buildroot}/usr/bin %{buildroot}/usr/share/licenses/xr
install -m 0755 %{SOURCE0} %{buildroot}/usr/bin/xr
install -m 0644 %{SOURCE1} %{buildroot}/usr/share/licenses/xr/LICENSE

%files
/usr/bin/xr
%license /usr/share/licenses/xr/LICENSE
`;
}

// ── Website distribution module (stamped; consumed by the downloads page) ────

export function renderDistributionModule(manifest: MinimalManifest): string {
  const d = validateDistribution(manifest);
  const id = manifest.identity;
  const channels = d.channels
    .filter((c) => c.id !== "git-checkout")
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      updateOwner: c.updateOwner,
      os: c.os,
      tier: c.tier,
      summary: c.summary,
      install: c.install,
      update: c.update,
      rollback: c.rollback,
    }));
  const body = {
    version: id.version,
    codename: id.codename,
    displayVersion: `${id.version} (${id.codename})`,
    stability: d.stability,
    stabilityLabel: d.stabilityLabel,
    tagline: d.tagline,
    repo: id.repo,
    channels,
    supportTiers: d.supportTiers,
    verifyingUrl: `${id.repo}/blob/main/docs/release/VERIFYING_RELEASES.md`,
    knownLimitationsUrl: `${id.repo}/blob/main/docs/release/${id.version}/known-limitations.md`,
  };
  return `/**
 * XR Website — distribution surface (Beta label, channels, install commands).
 *
 * GENERATED FILE — do not edit by hand.
 * Source: release.manifest.json (distribution section) · bun run release:stamp
 * Constitution Article XXII: one release manifest stamps every public surface.
 */

export const XR_DISTRIBUTION = ${JSON.stringify(body, null, 2)} as const;

export type XrDistribution = typeof XR_DISTRIBUTION;
`;
}

// ── Support matrix (stamped into docs/release/SUPPORT_MATRIX.md) ─────────────

export function renderSupportMatrix(manifest: MinimalManifest): string {
  const d = validateDistribution(manifest);
  const id = manifest.identity;
  const tierLabel = (t: number | string) =>
    t === 1 ? "**Tier 1 — supported**" : t === 2 ? "Tier 2 — best-effort" : "Unsupported";

  const rows = d.supportTiers
    .map(
      (s) =>
        `| ${s.os} | ${s.arch} | ${tierLabel(s.tier)} | ${s.tier === "unsupported" ? "—" : `\`${s.evidence}\``} | ${s.notes ?? ""} |`,
    )
    .join("\n");

  const channelRows = d.channels
    .filter((c) => c.id !== "git-checkout")
    .map(
      (c) => `| \`${c.id}\` | ${c.kind} | ${c.os.join(", ")} | ${c.tier === 1 ? "Tier 1" : "Tier 2"} | ${c.updateOwner === "xr" ? "XR atomic updater" : "package manager"} | \`${c.install}\` |`,
    )
    .join("\n");

  return `<!-- GENERATED from release.manifest.json (distribution section) — do not edit by hand.
     Regenerate: bun run release:stamp · CI fails on drift (release:check). -->
# XR ${id.version} (${id.codename}) — Support Matrix

**Stability:** ${d.stabilityLabel} — ${d.tagline}

A platform or channel is **supported** only where cross-platform CI validates it
at full parity (typecheck + the full unit tier + the golden path) — never
"it imports" (Phase 9 contract; Constitution Articles IX.4 / XX.4).

## Platform tiers

| OS | Arch | Tier | CI evidence | Notes |
|---|---|---|---|---|
${rows}

## Distribution channels

Every channel publishes the **same canonical build** (one release manifest → one
build → many channels; Art. XXII/XXIX). Hashes are pinned from the release's
\`SHA256SUMS\`; binaries are cosign-keyless signed (see
\`docs/release/VERIFYING_RELEASES.md\`).

| Channel | Kind | OS | Tier | Update owner | Install |
|---|---|---|---|---|---|
${channelRows}

## Prerelease channel

Tags matching \`v*-*\` (semver prerelease) publish GitHub **prereleases** on the
beta channel. Stable tags (\`vX.Y.Z\`) publish stable releases. Nothing about a
prerelease is implied stable.

## Honesty notes

- "Best-effort" tiers ship the same signed artifacts; they lack full CI parity
  on that arch, so defects there are not gated. Details and the
  not-yet-real list live in \`docs/release/${id.version}/known-limitations.md\`.
- Windows arm64: no compiled-binary target exists today — installs fail
  honestly instead of pretending.
`;
}

// ── Registry of every generated path ─────────────────────────────────────────

/** Returns path → content for every channel file the manifest owns. */
export function renderChannelFiles(manifest: MinimalManifest): Record<string, string> {
  return {
    "packaging/homebrew/xr.rb": renderHomebrewFormula(manifest),
    "packaging/scoop/xr.json": renderScoopManifest(manifest),
    ...renderWingetFiles(manifest),
    "packaging/rpm/xr.spec": renderRpmSpec(manifest),
  };
}
