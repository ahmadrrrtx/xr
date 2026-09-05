# Phase 9 — Research Notes (STEP 3)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Principles adopted (not copied), each verified against its source.

## R1 — One canonical build → many channels (multi-channel CLI distribution)

**Principle:** Ship one signed, per-target artifact set, then publish *derivatives* of it through
every package manager (GitHub Releases binaries · Homebrew tap · WinGet · Scoop · .deb · npm ·
Docker). Channels carry identical bytes — a channel manifest points at release URLs + SHA-256 from
the release's checksum file, so a channel cannot drift from the canonical build. Every channel has
its own update path; versions stay in sync because each manifest is *generated from the release
manifest + SHA256SUMS*, never hand-edited.
**Source:** GoReleaser docs (single build fan-out to brew/scoop/winget/deb/docker; checksums file as
the signing unit) — goreleaser.com/customization/[release,homebrew,docker]; pattern recap in
github.com/szksh-lab-2/example-sigstore-cosign. XR is Bun-based (`scripts/build-matrix.ts`), so the
generation fan-out is implemented in `scripts/channel-manifest.ts` rather than GoReleaser.

## R2 — Automated signed release-from-tag (cosign keyless + checksums + SBOM + SLSA + changelog)

**Principle:** On `v*`: build per target → write `SHA256SUMS` → **cosign keyless `sign-blob` the
checksums** (sigstore bundle, GitHub OIDC → Fulcio → public Rekor) → CycloneDX SBOM → **SLSA3
provenance** (slsa-github-generator) → changelog from conventional commits → GitHub Release
(softprops/action-gh-release) with all assets. Users verify:
`cosign verify-blob --certificate-identity … --certificate-oidc-issuer https://token.actions.githubusercontent.com --bundle SHA256SUMS.bundle`
then `sha256sum --ignore-missing -c SHA256SUMS`. Signing the *checksums file* covers every artifact
with one signature identity; the npm tarball + SBOM are additionally signed directly.
**Sources:** sigstore/cosign docs; github.com/szksh-lab-2/example-sigstore-cosign
("Sign checksum files by Cosign … verify + `sha256sum --ignore-missing -c`");
slsa-framework/slsa-github-generator `generator_generic_slsa3.yml` — **`base64-subjects` (or
`-as-file`) is a required input; the failing-empty wiring in today's release.yml is the exact
misconfiguration its README warns about**; npm OIDC trusted publishing docs (no long-lived token).

## R3 — Cross-platform CI parity

**Principle:** real runners per OS (`runs-on: macos-latest/windows-latest`), the *same* gates on
each: typecheck + full unit suite + golden path. OS-specific tests are excluded from a single
manifest (`test/platform/exclusions.json`) where each exclusion carries a reason — never an ad-hoc
skip list drifting per-job. Support tiers reflect what CI actually validates; `partial` is never
rounded to `supported` (repo's own environment-matrix rule).
**Source:** Constitution Art. XX.4; GoReleaser/gh-actions cross-platform matrix precedent; repo's
Phase-1 honest-gap discipline (`docs/phase-1/KNOWN_LIMITATIONS.md`).

## R4 — Public-beta readiness

**Principle:** a beta you can trust is (a) honestly labeled (Public Beta — not "stable/GA"),
(b) installable in one command per platform on *validated* channels, (c) measured on the golden path
(nightly, per OS, install-success rate reported as evidence, gate > 99%), (d) publishing a support
matrix and a known-limitations register as first-class release artifacts, (e) offering a prerelease
channel (`vX.Y.Z-beta.N` tags → npm `beta` dist-tag / pre-release assets) so users can opt into
bleeding edge, (f) closing the loop: issue templates → triage → acceptance criteria fed back into the
next release; (g) staged rollout discipline (prerelease first, promote after metrics).
**Source:** npm dist-tags docs; GitHub Releases prerelease flag; first-task-survey precedent in this
repo (Phase 8) extended per-OS; Constitution Art. X.1 (honesty first) + XIX.

## R5 — Package-manager atomicity and rollback semantics

**Principle:** each package manager owns its own install/update atomicity; XR's updater must *detect*
channel-managed installs and delegate (brew upgrade / scoop update / winget upgrade / apt), keeping
the Phase-1 contract — config backup → candidate → health canary → auto-rollback — where rollback is
the channel's own downgrade path (`brew switch`-style previous-version assets, `apt install pkg=ver`,
`scoop install xr@ver`, `winget install --version`). A forced canary failure must leave the user on
the previous working version, verified by injected-failure tests per channel.
**Source:** Homebrew/Scoop/WinGet/apt CLI semantics; Phase-1 `src/update/selfheal.ts` state machine
reused unchanged (no second update engine — Art. III).
