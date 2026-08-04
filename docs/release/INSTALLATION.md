# Installing XR (Phase 9 · Public Beta)

XR **7.1.0 (Truth)** is a **Public Beta**: validated, signed and reversible —
and not finished. Every channel below is listed in `release.manifest.json`
(the single authority) with its exact install, update and rollback commands;
`docs/release/CHANNELS.md` explains how that authority works, and
`docs/release/SUPPORT_MATRIX.md` is the platform truth.

**First-install rule:** from the GitHub release or any channel, the downloaded
bytes are checksum-verified before they are trusted. Signature verification
(cosign) runs automatically when cosign is installed. See
[VERIFYING_RELEASES.md](VERIFYING_RELEASES.md).

---

## Default: compiled binary (self-installer)

The binary path is the default distribution (ADR-0022): a single signed
artifact per platform, no runtime to install.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
iex "& { $(irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1) } -Yes"
```

The installer prints that XR is a Public Beta, downloads the binary for your
platform from the latest release, **verifies SHA256SUMS (fail-closed)**,
verifies the cosign bundle when cosign is present, installs to
`~/.xr-agent` (data in `~/.xr`), and records the install channel in
`install.json` so `xr update` knows which channel owns updates.

- **update:** `xr update` (atomic: download → checksum verify → canary
  self-test → swap; a failed canary auto-rolls back)
- **rollback:** automatic on failed update; to pin a version manually,
  re-run the installer against a specific tag
- **uninstall:** `xr uninstall --yes` (removes the launcher; keeps your data
  unless you pass `--purge`)

### Unsigned-binary platform prompts (documented, not hidden)

The binaries are **cosign-signed**, not Apple-notarized or
Authenticode-signed (paid vendor certificates are a later purchase; see
known limitations). Therefore:

- **macOS (Gatekeeper):** binaries fetched via `curl` (the installer path)
  are not quarantine-flagged, but a **browser-downloaded** binary is — the
  first run may be blocked. After verifying it (§2 in VERIFYING_RELEASES.md),
  remove the flag: `xattr -d com.apple.quarantine xr-darwin-arm64`, or
  right-click → Open.
- **Windows (SmartScreen):** you may see a SmartScreen prompt on first run —
  expected for a binary without an EV certificate. Verify the bundle first
  (`VERIFYING_RELEASES.md` §2) and it is safe to proceed.

---

## Package-manager channels (the PM owns updates)

For these channels the package manager — not XR — owns update and rollback.
`xr update` detects the channel from `install.json`, refuses to half-edit a
PM-owned installation, and prints the exact commands below.

### Homebrew (macOS, Linux)

```bash
brew install ahmadrrrtx/tap/xr
```

- **update:** `brew upgrade ahmadrrrtx/tap/xr`
- **rollback:** `brew switch xr <previous-version>` (Homebrew keeps prior Cellar versions)

The formula (`packaging/homebrew/xr.rb`) is rendered from the release
manifest and its sha256 is pinned from the release's `SHA256SUMS` by the
Release workflow — a formula with an unpinned hash is never published.

### Scoop (Windows)

```powershell
scoop bucket add ahmadrrrtx https://github.com/ahmadrrrtx/scoop-bucket
scoop install xr
```

- **update:** `scoop update xr`
- **rollback:** `scoop reset xr@<previous-version>`

### WinGet (Windows) — tier 2

```powershell
winget install ahmadrrrtx.XR
```

- **update:** `winget upgrade ahmadrrrtx.XR`
- **rollback:** `winget install ahmadrrrtx.XR --version <previous-version> --force`

**Documented lag:** the community-registry review takes one cycle after each
release, so WinGet can trail the GitHub release by days. That lag is disclosed
on the downloads page and in the manifest, not hidden.

### Debian / Ubuntu (.deb)

```bash
sudo dpkg -i xr_<version>_amd64.deb   # file from the GitHub release
```

- **update:** `sudo dpkg -i xr_<new-version>_amd64.deb`
- **rollback:** `sudo dpkg -i xr_<previous-version>_amd64.deb`

The `.deb` carries the packaged binary and metadata; because the binary is
self-contained there are no dependency resolutions for dpkg to miss. There is
no hosted apt repository (known limitation — update = fetch the new package).

### Fedora / RHEL / openSUSE (.rpm) — tier 2

```bash
sudo rpm -Uvh xr-<version>-1.<arch>.rpm   # file from the GitHub release
```

- **update:** `sudo rpm -Uvh xr-<new-version>-1.<arch>.rpm`
- **rollback:** `sudo rpm -Uvh --oldpackage xr-<previous-version>-1.<arch>.rpm`

No dnf/yum repository is hosted (known limitation).

### npm (`@rrrtx/xr`)

```bash
npm i -g @rrrtx/xr    # requires Bun at run time
```

- **update:** `xr update`
- **rollback:** `npm i -g @rrrtx/xr@<previous-version>`

Published by OIDC **trusted publishing** from the Release workflow — no
long-lived npm token exists to leak. Beta tags publish under the `beta`
dist-tag and never take over `latest`.

### Docker / GHCR

```bash
docker run --rm -it -v xr-data:/data ghcr.io/ahmadrrrtx/xr:latest
```

- **update:** `docker pull ghcr.io/ahmadrrrtx/xr:latest`
- **rollback:** `docker pull ghcr.io/ahmadrrrtx/xr:<previous-version>` (immutable tag)

The image is multi-arch (linux/amd64, linux/arm64), carries buildx SBOM +
provenance attestations, and its **digest is cosign-signed** (verify:
[VERIFYING_RELEASES.md](VERIFYING_RELEASES.md) §5). Release picks:
`v7.1.0-beta.1`-style prereleases get the version tag only; stable tags also
move `:latest`.

### From source (contributors)

```bash
git clone https://github.com/ahmadrrrtx/xr && cd xr && bun install
bun run start -- help
```

- **update:** `xr update` or `git pull`
- **rollback:** `git checkout <previous-tag>`

---

## Data locations

| What | Where |
|---|---|
| Package/binaries | `~/.xr-agent` (installer) or the PM's prefix |
| Runtime data (config, state, audit) | `$XR_HOME` or `~/.xr` |
| Install channel record | `install.json` in both of the above |

---

## Requirements

Compiled binaries: none (self-contained). npm/source: Bun ≥ 1.1. Platform
support and CI evidence per OS/arch: [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md).
Windows ARM64 is **unsupported** (installs fail honestly). Known gaps:
[7.1.0 known limitations](7.1.0/known-limitations.md).
