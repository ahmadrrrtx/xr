<!-- GENERATED from release.manifest.json (distribution section) — do not edit by hand.
     Regenerate: bun run release:stamp · CI fails on drift (release:check). -->
# XR 7.1.0 (Truth) — Support Matrix

**Stability:** Public Beta — honestly labeled: validated, signed and reversible — and not finished. Known limitations are public.

A platform or channel is **supported** only where cross-platform CI validates it
at full parity (typecheck + the full unit tier + the golden path) — never
"it imports" (Phase 9 contract; Constitution Articles IX.4 / XX.4).

## Platform tiers

| OS | Arch | Tier | CI evidence | Notes |
|---|---|---|---|---|
| linux | x64 | **Tier 1 — supported** | `.github/workflows/ci.yml + cross-platform.yml (Linux x64 full tier + golden path)` | Primary CI. |
| linux | arm64 | **Tier 1 — supported** | `.github/workflows/cross-platform.yml (ubuntu-24.04-arm: full unit tier + golden path)` | Native arm64 runner. |
| macos | arm64 | **Tier 1 — supported** | `.github/workflows/cross-platform.yml (macos-latest: full unit tier + golden path)` |  |
| macos | x64 | **Tier 1 — supported** | `.github/workflows/cross-platform.yml (macos-13/intel: full unit tier + golden path)` |  |
| windows | x64 | **Tier 1 — supported** | `.github/workflows/cross-platform.yml (windows-latest: full unit tier + golden path)` |  |
| windows | arm64 | Unsupported | — | Tracked as a possible future target. |

## Distribution channels

Every channel publishes the **same canonical build** (one release manifest → one
build → many channels; Art. XXII/XXIX). Hashes are pinned from the release's
`SHA256SUMS`; binaries are cosign-keyless signed (see
`docs/release/VERIFYING_RELEASES.md`).

| Channel | Kind | OS | Tier | Update owner | Install |
|---|---|---|---|---|---|
| `github-releases` | binary | linux, macos, windows | Tier 1 | XR atomic updater | `curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash` |
| `homebrew` | package-manager | macos, linux | Tier 1 | package manager | `brew install ahmadrrrtx/tap/xr` |
| `scoop` | package-manager | windows | Tier 1 | package manager | `scoop bucket add ahmadrrrtx https://github.com/ahmadrrrtx/scoop-bucket; scoop install xr` |
| `winget` | package-manager | windows | Tier 2 | package manager | `winget install ahmadrrrtx.XR` |
| `deb` | package-manager | linux | Tier 1 | package manager | `sudo dpkg -i xr_<version>_amd64.deb   # from the GitHub release` |
| `rpm` | package-manager | linux | Tier 2 | package manager | `sudo rpm -Uvh xr-<version>-1.<arch>.rpm   # from the GitHub release` |
| `npm` | registry | linux, macos, windows | Tier 1 | XR atomic updater | `npm i -g @rrrtx/xr` |
| `docker` | container | linux, macos, windows | Tier 1 | package manager | `docker run --rm -it -v xr-data:/data ghcr.io/ahmadrrrtx/xr:latest` |

## Prerelease channel

Tags matching `v*-*` (semver prerelease) publish GitHub **prereleases** on the
beta channel. Stable tags (`vX.Y.Z`) publish stable releases. Nothing about a
prerelease is implied stable.

## Honesty notes

- "Best-effort" tiers ship the same signed artifacts; they lack full CI parity
  on that arch, so defects there are not gated. Details and the
  not-yet-real list live in `docs/release/7.1.0/known-limitations.md`.
- Windows arm64: no compiled-binary target exists today — installs fail
  honestly instead of pretending.
