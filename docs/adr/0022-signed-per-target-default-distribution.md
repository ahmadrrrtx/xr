# ADR-0022 — Signed Per-Target Compiled Binaries as the Default Distribution

- **Status:** Accepted (Phase 9 · T1/T2)
- **Owner:** Release Lead
- **Date:** 2026-08-05
- **Constitution:** Art. XXII.3 (signed reproducible releases), Art. IX.4 (claim
  evidence), Art. XII (startup budgets — the compiled binary is the fast path),
  Part 20 of the Phase-9 contract (no unsigned distribution; checksum
  verification at install/update).

## Context

Phase 3 built the compile matrix (`scripts/build-matrix.ts`, five targets) and
the installers preferred the binary — but no release ever attached them: the
GitHub Releases feed contained one stale v3.0.0 with zero assets, npm served
3.1.5 against source 7.0.1, and the Phase-4 SLSA job consumed job outputs that
were never emitted (empty `base64-subjects` → SLSA + npm publish could never
complete a tag). The declared "default distribution" did not exist as an
artifact. Binary downloads (install.sh, install.ps1, `xr update`) also ran
**without any integrity verification**.

## Decision

1. **Five per-target compiled binaries ARE the default distribution**
   (linux-x64/arm64, darwin-arm64/x64, windows-x64), built in a per-OS matrix
   with native smoke (`scripts/build-matrix.ts`).
2. **One signed checksum manifest as the trust unit** (R2): `SHA256SUMS` over
   every release artifact, signed cosign-keyless (GitHub OIDC → Fulcio →
   public Rekor) alongside the npm tarball and SBOM. Verification =
   `cosign verify-blob … SHA256SUMS` + `sha256sum --ignore-missing -c`
   (docs/release/VERIFYING_RELEASES.md).
3. **Verified-only install/update paths, fail closed:** install.sh/install.ps1
   fetch SHA256SUMS first and refuse unverified/mismatched binaries
   (falling back to the source-checkout channel); the binary updater verifies
   the candidate hash before writing it (`src/update/channels.ts:downloadVerified`).
   The only escape hatch is `verify:false`, explicitly test-scoped.
4. **SLSA3 provenance over real digests:** the assemble job emits
   `outputs.digests` from the artifact set; the generator consumes them. The
   wiring is structurally tested (`test/release/release-workflow.test.ts`).

## Consequences

- Every distributed byte is hash-bound to a Rekor-recorded signature; an
  unsigned window no longer exists on any install/update path.
- Fallback to source persists as an *alternative channel* (also integrity-bound
  to git), preserving the contributor path (Art. XXIII compatibility).
- Claim discipline: Rekor-verifiability is claimable only after the first
  tagged release ≥ 7.1.0 runs — recorded in the manifest claim evidence.

## Alternatives considered

Per-binary detached signatures as the primary trust unit — rejected in favor
of the checksum-manifest pattern (one identity covers all artifacts; binaries
remain individually hash-verified through it). Signing with long-lived keys —
rejected: OIDC keyless has no key material to leak.
