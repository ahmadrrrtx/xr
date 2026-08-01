# ADR-0011 — Signed, Provenance-Bearing Releases (cosign/SLSA/SBOM)

- **Status:** Accepted (Phase 4 · T6)
- **Owner:** Release Lead / Trust Lead
- **Date:** 2026-08-01
- **Constitution:** Art. XXII.3 (signed, reproducible releases: SBOM, SLSA
  provenance, checksums, signatures), Art. IX.4 (no public claim without
  independent evidence).

## Context

Releases were published with no signing, no SBOM, no provenance, no
dependency/secret/container/license scanning, and npm installs ran
dependency scripts. A consumer could not verify authenticity or inventory.

## Decision

1. **CycloneDX 1.5 SBOM** from the LOCKED dependency set (`scripts/sbom.ts`,
   hashes from bun.lock) — generated and drift-guarded in CI; consumed by
   SBOM-driven vulnerability scanning.
2. **SLSA Build L3 provenance** via `slsa-github-generator` on tagged
   releases; `scripts/verify-release.ts` checks the provenance subject
   digest matches the artifact.
3. **cosign KEYLESS signing** (GitHub OIDC → Fulcio short-lived certs) of the
   tarball, SBOM and checksums; bundles recorded in the PUBLIC Rekor log.
   Verification: `cosign verify-blob --certificate-identity … --bundle …`
   (documented in docs/release/VERIFYING_RELEASES.md). In environments
   without cosign/Rekor access, `verify-release.ts` reports exactly what it
   verified and NEVER claims keyless proof (fails closed).
4. **CI scanning gates the release**: gitleaks (secrets), osv-scanner +
   npm audit (vulns), license-check (forbidden/unknown), trivy (container
   image), `bun install --frozen-lockfile --ignore-scripts` everywhere.
5. **npm trusted publishing**: OIDC-issued short-lived token,
   `provenance: true`; no long-lived npm token.
6. **Honesty boundary**: SLSA proves *where* an artifact was built, not that
   its source is safe — the combination of scanning + review + SBOM-driven
   vuln checks is what makes the release gate meaningful. The keyless/Rekor
   claim is only publishable after the release workflow has actually run on a
   real tag (evidence link + expiry, Art. IX.4).

## Consequences

- Consumers can independently verify: checksums, SBOM inventory, provenance
  subject, and signature against the public transparency log.
- The local verification path (`test/supply-chain/supply-chain.test.ts`)
  keeps the tooling honest even where cosign/Rekor are not reachable.
