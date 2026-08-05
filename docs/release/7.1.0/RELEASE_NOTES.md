# XR 7.1.0 (Truth) — Release Notes

**7.1.0 is the Public Beta's distribution release: no new product features —
the existing product is now a signed, reproducible, cross-platform artifact
that installs, updates and rolls back through native channels.**

This release closes XR's Article-XXII failure mode (source 7.0.1 vs npm 3.1.5
vs unattached binaries) and makes "supported" mean *validated*.

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
  typecheck + the FULL unit suite (minus only four documented, reason-guarded
  POSIX exclusions) + the golden path — from one computation authority.
- **Per-channel atomic update/rollback/uninstall:** `xr update` detects
  brew/scoop/winget/apt installs and delegates through each manager's own
  upgrade + pinned-downgrade path (Phase-1 state machine, unchanged);
  binary updates are checksum-verified before they run; installers refuse
  unverified binaries (fail closed).
- **Honest Public Beta:** the label is stamped from the release manifest;
  support matrix + refreshed known-limitations register; prerelease channel
  (`v*-beta.*` → npm `beta` / prerelease / image `:beta`); nightly
  install-success metric per OS family (gate ≥ 99%); a feedback → acceptance
  loop with a beta feedback issue template.

## Performance (no startup regression — measured)

Version cold/warm p95 **35.9 / 37.5 ms** · help **40.0 / 40.7 ms** · doctor
456 ms · dashboard first render 5.7 ms · channel tooling is not on any boot
path. Baseline artifact: `docs/perf/baseline-7.1.0-source.{json,md}`.

## Reading the guarantees

Right-sized reading order: README → this file →
[`docs/release/7.1.0/known-limitations.md`](known-limitations.md) →
[`../SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md) →
[`../VERIFYING_RELEASES.md`](../VERIFYING_RELEASES.md) →
[`../BETA.md`](../BETA.md) (the prerelease channel + feedback loop) →
[`../RELEASING.md`](../RELEASING.md) (reproducible-release runbook).
