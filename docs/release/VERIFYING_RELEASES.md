# Verifying an XR Release (Phase 9 · T1/T2)

Every tagged release `v7.1.0+` ships assets you can verify independently —
integrity, keyless signatures, SBOM, and SLSA provenance. **You never have to
trust the download mirrors, the CDN, or this document's word: every claim
below is checkable from the release page itself.**

This document describes the procedure. Whether a *specific* tag carries these
proofs is decided by evidence: the Release workflow (`.github/workflows/release.yml`)
must have run on that tag and the Rekor transparency log must confirm the
signature. XR is a **Public Beta**; the verification story is not beta.

## Assets attached to each release

| Asset | What it proves |
|---|---|
| `xr-linux-x64`, `xr-linux-arm64`, `xr-darwin-arm64`, `xr-darwin-x64`, `xr-windows-x64.exe` | the compiled binaries (default distribution) |
| `xr_<version>_amd64.deb` / `xr-<version>-1.<arch>.rpm` | native Linux packages |
| `rrrtx-xr-<version>.tgz` | the exact tarball published to npm |
| `SHA256SUMS` | the artifacts you downloaded are byte-identical to what CI built |
| `sbom.cyclonedx.json` | the exact locked dependency inventory (with integrity hashes) |
| `<asset>.bundle` | cosign **keyless** signature bundle per asset, bound to the GitHub Actions OIDC identity and recorded in the **public Rekor transparency log** |
| `provenance.intoto.jsonl` | SLSA v1.0 build provenance (generic generator, level 3); its subject digests match the assets |

## 1. Verify integrity

```bash
cd <download-dir>
sha256sum -c SHA256SUMS --ignore-missing   # or drop --ignore-missing if you fetched everything
```

A mismatch means the bytes are not what CI signed. Stop there.

## 2. Verify the signature (cosign keyless, Rekor)

[Install cosign](https://docs.sigstore.dev/cosign/installation/), then for
each asset:

```bash
cosign verify-blob \
  --certificate-identity-regexp 'https://github\.com/ahmadrrrtx/xr/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --bundle xr-linux-x64.bundle \
  xr-linux-x64
```

The identity is pinned to *this* repository's *release* workflow on tag refs —
a signature produced by any other repo, workflow, or branch does not verify.
The certificate and signature are independently confirmable in the public
Rekor log (the `--bundle` carries the Rekor entry; `cosign verify-blob` checks
inclusion offline against the bundle's signed timestamp).

The installers do this for you when cosign is present (`install.sh`,
`install.ps1`): checksum verification is **mandatory**, signature verification
is automatic when cosign is installed, and both fail closed.

## 3. Verify SLSA provenance

```bash
# install slsa-verifier: https://github.com/slsa-framework/slsa-verifier
slsa-verifier verify-artifact xr-linux-x64 \
  --provenance-path provenance.intoto.jsonl \
  --source-uri github.com/ahmadrrrtx/xr \
  --source-tag v<version>
```

SLSA proves *where* and *how* the artifact was built (this repo, this tag, the
hardened GitHub-hosted builder), not that the source is safe — combine with
the published scan results (gitleaks/osv/license/trivy) and review.

## 4. Verify the SBOM

```bash
jq '.metadata.component.version' sbom.cyclonedx.json   # == release version
jq '.components | length' sbom.cyclonedx.json
```

## 5. Verify the container image

The GHCR image is signed **by digest** and carries buildx SBOM/provenance
attestations:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github\.com/ahmadrrrtx/xr/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/ahmadrrrtx/xr:v<version>
docker buildx imagetools inspect ghcr.io/ahmadrrrtx/xr:v<version> --format '{{ json .Provenance }}'
```

Pull by digest (`ghcr.io/ahmadrrrtx/xr@sha256:…`) for full immutability.

## 6. One-command verification (repo tooling)

From a source checkout, `scripts/verify-release.ts` runs the whole battery and
**fails closed**: it reports exactly what it verified and makes no claim for
anything it could not check. Without cosign inputs it fails rather than claim
keyless proof.

```bash
bun run verify-release -- \
  --artifact xr-linux-x64 --sums SHA256SUMS \
  --sbom sbom.cyclonedx.json --provenance provenance.intoto.jsonl \
  --cosign-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*'
```

## Honesty notes (Art. IX.4)

- Keyless/Rekor proof exists only for tags the Release workflow actually ran
  on. Check the tag's workflow run evidence before trusting a `v*` asset that
  predates the workflow.
- npm publishes use **OIDC trusted publishing** (`npm publish --provenance`);
  the npm provenance statement is a second, independent attestation visible on
  the package page.
- WinGet is tier 2: community-manifest review lags one review cycle after each
  release. The version on `winget` may trail the GitHub release; that is
  documented, not hidden (see `docs/release/CHANNELS.md`).
