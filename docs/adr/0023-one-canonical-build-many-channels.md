# ADR-0023 — One Canonical Build, Many Channels (channel derivation + drift gate)

- **Status:** Accepted (Phase 9 · T3)
- **Owner:** Release Lead
- **Date:** 2026-08-05
- **Constitution:** Art. XXII.1/XXII.3 (one manifest; version stays in sync
  across every surface), Art. XXIX (verifiable done), "supported means
  validated" (Phase-9 contract Part 5).

## Context

XR's distribution incoherence was the canonical Article-XXII failure: source
7.0.1 vs npm 3.1.5 vs installers pointing at binaries that did not exist, and
no native package-manager channels at all (no Homebrew/WinGet/Scoop/deb, no
published registry image despite a nightly-validated Dockerfile). Hand-written
channel configs would repeat the exact class of drift the release manifest
eliminated for version identity.

## Decision

1. **Channel configs are generated artifacts.** `scripts/channel-manifest.ts`
   is the single generator for Homebrew (`packaging/homebrew/xr.rb`), WinGet
   (`packaging/winget/manifests/...`), Scoop (`packaging/scoop/xr.json`);
   `scripts/build-deb.ts` assembles the `.deb` purely (ar/ustar, epoch
   timestamps → reproducible). Templates carry version + canonical URLs only.
2. **Checks arrive only from the signed build.** At release time the stamping
   mode binds each channel to the signed `SHA256SUMS` and **fails closed** if
   any required artifact is absent — a channel can never bind unsigned bytes.
3. **A CI drift gate forbids hand drift:** `bun run channel:check` (in the
   `ci` chain + release gate) fails unless `packaging/*` exactly equals the
   generator output for the manifest version.
4. **"Supported" = install-validated per channel:** real `dpkg -i` + remove
   on every PR; stamped-binding checks for brew/winget/scoop every PR; weekly
   REAL installs from the published assets for apt/brew/scoop. Channels
   without an install test are deferred, not shipped (recorded: `.rpm`,
   Snap/Flatpak — known-limitations register with the closure requirements).
5. **Publishing discipline:** npm via OIDC trusted publishing with `latest` /
   `beta` dist-tags; Docker multi-arch to GHCR with buildx SBOM/SLSA +
   cosign; Homebrew tap push is operator-opt-in with a scoped token; WinGet
   community submission is a documented PR flow.

## Consequences

- Version sync becomes structural: channel files are a function of the
  release manifest, so they cannot drift as a class.
- The beta can promise one-command installs only where install tests are
  green (support matrix mirrors CI exactly).
- Future channels enter through one generator + one install test + one update
  contract — the checklist in docs/release/CHANNELS.md.

## Alternatives considered

GoReleaser — rejected (Bun toolchain; a second build authority). Self-hosted
apt repository — rejected this phase (operator burden outweighs value while
`dpkg -i` covers direct install; revisit when an enterprise mirror is demanded).
.rpm/Snap now — rejected: no install-test toolchain in CI yet, and unvalidated
channels violate the phase's own rule.
