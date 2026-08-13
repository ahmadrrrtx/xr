# XR 1.0.0 (Truth) — Release Notes

> **Rebaseline note.** 1.0.0 is a **deliberate semver rebaseline** of 7.1.0 (Truth):
> the same codebase, re-identified as the first stable line. No functionality was
> removed or added in the re-identification. The 7.1.0-era change history remains
> intact under `CHANGELOG.md §7.1.0` and the frozen 7.x artifacts under `docs/`.

**1.0.0 is the Public Beta's distribution release: no new product features — the
existing product is now a signed, reproducible, cross-platform artifact that
installs, updates and rolls back through native channels.**

This release closes XR's Article-XXII failure mode (source vs npm vs unattached
binaries) and makes "supported" mean *validated*.

## Highlights (full conventional-commit changelog: CHANGELOG.md §7.1.0)

- **Signed per-target compiled binaries are the default distribution**
  (linux-x64/arm64, darwin-arm64/x64, windows-x64): built per-OS with native
  smoke; `SHA256SUMS` over everything, cosign keyless signature (public Rekor),
  CycloneDX SBOM, SLSA3 provenance — verify per `docs/release/VERIFYING_RELEASES.md`.
- **Automated release-from-tag**, unattended: gates (`release:check` +
  `claim-lint` + `channel:check`, typecheck, test floor) → build → checksums →
  SBOM → cosign → SLSA (real digests — the Phase-4 wiring defect is fixed and
  regression-tested) → changelog → GitHub Release → npm OIDC (`latest`/`beta`)
  → GHCR image + cosign → channel manifests stamped from the signed sums.
- **One canonical build → many channels:** Homebrew formula, WinGet manifests,
  Scoop manifest, `.deb` (pure-TS builder, dpkg-install-tested), npm, Docker —
  all generated from the release manifest; `channel:check` fails CI on drift.
- **Cross-platform full-parity CI:** Linux + macOS + Windows each run
  typecheck + the FULL unit suite (minus only documented, reason-guarded
  exclusions) + the golden path — from one computation authority.
- **Per-channel atomic update/rollback/uninstall:** `xr update` detects
  brew/scoop/winget/apt installs and delegates through each manager's own
  upgrade + pinned-downgrade path; binary updates are checksum-verified before
  they run; installers refuse unverified binaries (fail closed).
- **Honest Public Beta:** the label is stamped from the release manifest;
  support matrix + refreshed known-limitations register; prerelease channel
  (`v*-beta.*` → npm `beta` / prerelease / image `:beta`); nightly
  install-success metric per OS family (gate ≥ 99%).

## Performance (no startup regression — measured)

Version cold/warm p95 **40.8 / 39.8 ms** · help **42.5 / 40.5 ms** · doctor
586 ms · dashboard first render 12.1 ms · retrieval@100k 28.1 ms · channel
tooling is not on any boot path. Baseline artifact:
`docs/perf/baseline-1.0.0-source.{json,md}` (regenerated 2026-08-13).

## npm dist-tag note (rebaseline consequence)

The pre-rebaseline `@rrrtx/xr` `latest` dist-tag is `3.1.5`. Because `3.1.5`
sorts **higher** than `1.0.0` under semver, publishing 1.0.0 does **not**
automatically move `latest` — the release runbook re-points it explicitly
(`npm dist-tag add @rrrtx/xr@1.0.0 latest`) at publish time. Until the first
1.0.0 publish, install from the binary channel or build from source.

## Reading the guarantees

Right-sized reading order: README → this file →
[`known-limitations.md`](known-limitations.md) →
[`../SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md) →
[`../VERIFYING_RELEASES.md`](../VERIFYING_RELEASES.md) →
[`../BETA.md`](../BETA.md) (the prerelease channel + feedback loop) →
[`../RELEASING.md`](../RELEASING.md) (reproducible-release runbook).
