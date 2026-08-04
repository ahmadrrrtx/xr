/**
 * XR Website — distribution surface (Beta label, channels, install commands).
 *
 * GENERATED FILE — do not edit by hand.
 * Source: release.manifest.json (distribution section) · bun run release:stamp
 * Constitution Article XXII: one release manifest stamps every public surface.
 */

export const XR_DISTRIBUTION = {
  "version": "7.1.0",
  "codename": "Truth",
  "displayVersion": "7.1.0 (Truth)",
  "stability": "beta",
  "stabilityLabel": "Public Beta",
  "tagline": "honestly labeled: validated, signed and reversible — and not finished. Known limitations are public.",
  "repo": "https://github.com/ahmadrrrtx/xr",
  "channels": [
    {
      "id": "github-releases",
      "kind": "binary",
      "updateOwner": "xr",
      "os": [
        "linux",
        "macos",
        "windows"
      ],
      "tier": 1,
      "summary": "Signed compiled binary straight from the release (default distribution).",
      "install": "curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash",
      "update": "xr update",
      "rollback": "xr update is atomic; a failed canary auto-rolls back"
    },
    {
      "id": "homebrew",
      "kind": "package-manager",
      "updateOwner": "channel",
      "os": [
        "macos",
        "linux"
      ],
      "tier": 1,
      "summary": "Homebrew formula from the ahmadrrrtx/homebrew-tap tap.",
      "install": "brew install ahmadrrrtx/tap/xr",
      "update": "brew upgrade ahmadrrrtx/tap/xr",
      "rollback": "brew switch xr <previous-version> (brew keeps prior Cellar versions)"
    },
    {
      "id": "scoop",
      "kind": "package-manager",
      "updateOwner": "channel",
      "os": [
        "windows"
      ],
      "tier": 1,
      "summary": "Scoop manifest from the ahmadrrrtx/scoop-bucket bucket.",
      "install": "scoop bucket add ahmadrrrtx https://github.com/ahmadrrrtx/scoop-bucket; scoop install xr",
      "update": "scoop update xr",
      "rollback": "scoop reset xr@<previous-version>"
    },
    {
      "id": "winget",
      "kind": "package-manager",
      "updateOwner": "channel",
      "os": [
        "windows"
      ],
      "tier": 2,
      "summary": "WinGet community manifest (ahmadrrrtx.XR) — lags one registry review after each release.",
      "install": "winget install ahmadrrrtx.XR",
      "update": "winget upgrade ahmadrrrtx.XR",
      "rollback": "winget install ahmadrrrtx.XR --version <previous-version> --force"
    },
    {
      "id": "deb",
      "kind": "package-manager",
      "updateOwner": "channel",
      "os": [
        "linux"
      ],
      "tier": 1,
      "summary": "Native .deb for Debian/Ubuntu from the canonical release assets.",
      "install": "sudo dpkg -i xr_<version>_amd64.deb   # from the GitHub release",
      "update": "sudo dpkg -i xr_<new-version>_amd64.deb",
      "rollback": "sudo dpkg -i xr_<previous-version>_amd64.deb"
    },
    {
      "id": "rpm",
      "kind": "package-manager",
      "updateOwner": "channel",
      "os": [
        "linux"
      ],
      "tier": 2,
      "summary": "Native .rpm for Fedora/RHEL/openSUSE from the canonical release assets.",
      "install": "sudo rpm -Uvh xr-<version>-1.<arch>.rpm   # from the GitHub release",
      "update": "sudo rpm -Uvh xr-<new-version>-1.<arch>.rpm",
      "rollback": "sudo rpm -Uvh --oldpackage xr-<previous-version>-1.<arch>.rpm"
    },
    {
      "id": "npm",
      "kind": "registry",
      "updateOwner": "xr",
      "os": [
        "linux",
        "macos",
        "windows"
      ],
      "tier": 1,
      "summary": "npm package @rrrtx/xr (Bun required; OIDC trusted publishing).",
      "install": "npm i -g @rrrtx/xr",
      "update": "xr update",
      "rollback": "npm i -g @rrrtx/xr@<previous-version>"
    },
    {
      "id": "docker",
      "kind": "container",
      "updateOwner": "channel",
      "os": [
        "linux",
        "macos",
        "windows"
      ],
      "tier": 1,
      "summary": "Container image ghcr.io/ahmadrrrtx/xr with a signed digest.",
      "install": "docker run --rm -it -v xr-data:/data ghcr.io/ahmadrrrtx/xr:latest",
      "update": "docker pull ghcr.io/ahmadrrrtx/xr:latest",
      "rollback": "docker pull ghcr.io/ahmadrrrtx/xr:<previous-version> (immutable tag)"
    }
  ],
  "supportTiers": [
    {
      "os": "linux",
      "arch": "x64",
      "tier": 1,
      "evidence": ".github/workflows/ci.yml + cross-platform.yml (Linux x64 full tier + golden path)",
      "notes": "Primary CI."
    },
    {
      "os": "linux",
      "arch": "arm64",
      "tier": 1,
      "evidence": ".github/workflows/cross-platform.yml (ubuntu-24.04-arm: full unit tier + golden path)",
      "notes": "Native arm64 runner."
    },
    {
      "os": "macos",
      "arch": "arm64",
      "tier": 1,
      "evidence": ".github/workflows/cross-platform.yml (macos-latest: full unit tier + golden path)",
      "notes": ""
    },
    {
      "os": "macos",
      "arch": "x64",
      "tier": 1,
      "evidence": ".github/workflows/cross-platform.yml (macos-13/intel: full unit tier + golden path)",
      "notes": ""
    },
    {
      "os": "windows",
      "arch": "x64",
      "tier": 1,
      "evidence": ".github/workflows/cross-platform.yml (windows-latest: full unit tier + golden path)",
      "notes": ""
    },
    {
      "os": "windows",
      "arch": "arm64",
      "tier": "unsupported",
      "evidence": "no bun-windows-arm64 build target; installs fail honestly",
      "notes": "Tracked as a possible future target."
    }
  ],
  "verifyingUrl": "https://github.com/ahmadrrrtx/xr/blob/main/docs/release/VERIFYING_RELEASES.md",
  "knownLimitationsUrl": "https://github.com/ahmadrrrtx/xr/blob/main/docs/release/7.1.0/known-limitations.md"
} as const;

export type XrDistribution = typeof XR_DISTRIBUTION;
