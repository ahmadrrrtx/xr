# Verifying a candidate release — integrity is not publisher authentication

Current local candidate1.1.1-rc.1 is **UNPUBLISHED and NOT READY for public
preview/stable**. It has local hashes/inspection evidence, not owner-produced
trusted signatures/provenance. Historical or withdrawn releases may lack assets;
never infer that every historical tag has the proofs described below.

# # Expected new-pipeline proofs

| Subject | Required verification |
|---|---|
| CLI/source/npm/deb artifacts | Complete `SHA256SUMS`, all expected hashes, exact cosign workflow/tag identity and issuer |
| Locked application inventory | CycloneDX1.5 schema, declared product identity, valid hex digests/refs, signed SBOM/hash inventory; explicit root/renderer/Cargo scope |
| CLI SLSA | Actual DSSE/JSONL subject name+digest AND executed `slsa-verifier` builder/source-tag authentication |
| Desktop installers | Actual OS signature/notarization + installed native journey, `DESKTOP-SHA256SUMS` with cosign proof, exact-ref/commit GitHub provenance |
| Updater payloads | Committed matching Tauri public key, actual payload signature verification and complete supported-target manifest |
| Container | Exact immutable digest with authenticated signature/attestations and actual container checks |

A parsed subject or checksum does not prove who built it. Local Ed25519 fixture
keys demonstrate crypto/tamper regressions, **not** production publisher trust.
The combined SBOM is a flat union of application lock dependencies, including
development/target-optional packages; it does not invent dependency edges,
runtime reachability or system-library/framework completeness.

# # Independent verification after owner publication

These are owner recipes, **NOT executed production results** in this workspace.
Download the exact version's complete artifacts, cosign bundles and real
provenance from its authenticated release. Verify before installing. Do not
replace a missing proof with a test fixture or an unverified new public key.

```bash
VERSION=1.1.1-rc.1
REPO=ahmadrrrtx/xr
IDENTITY="https://github.com/$REPO/.github/workflows/release.yml@refs/tags/v$VERSION"

cosign verify-blob --certificate-identity "$IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --bundle SHA256SUMS.bundle SHA256SUMS

# strict verifies every inventory byte, SBOM, exact publisher signature bundles,
# DSSE subject, and invokes slsa-verifier for real source/tag authentication.
bun run release:verify --artifact "rrrtx-xr-$VERSION.tgz" --sums SHA256SUMS \
  --sbom sbom.cyclonedx.json --provenance multiple.intoto.jsonl \
  --expected-version "$VERSION" --cosign-identity "$IDENTITY" \
  --slsa-source-uri "github.com/$REPO" --slsa-source-tag "v$VERSION"
```

Use the actual downloaded provenance filename if the generator emitted a
single-subject name. The verifier requires an **exact** identity, not a wildcard
matching another tag. Missing requested files, empty/duplicate/unsafe checksum
paths, invalid version/digest/ref, mismatched subject/key and unavailable tools
fail closed. `VERIFIED REQUESTED FACETS` without `--strict` is not permission to
publish a complete release; omitted facets are not claimed.

Native desktop checksum proof uses identity
`https://github.com/ahmadrrrtx/xr/.github/workflows/desktop-app.yml@refs/tags/v<version>`.
After validating its cosign bundle, verify provenance with exact repository,
workflow, source ref and commit, for example:

```bash
gh attestation verify DESKTOP-SHA256SUMS --repo ahmadrrrtx/xr \
  --signer-workflow ahmadrrrtx/xr/.github/workflows/desktop-app.yml \
  --source-ref "refs/tags/v$VERSION" --source-digest "$ACTUAL_TAG_COMMIT" \
  --deny-self-hosted-runners
```

The owner must obtain ACTUAL_TAG_COMMIT from the real tag/API. An arbitrary SHA,
old PR/main run or source-string test cannot replace a successful tagged native
workflow. The CI native evidence helper compares tag, commit, latest run and the
completed required aggregate; no stored success boolean suffices.

# # Local evidence and intentional blocks

The candidate's local npm tarball has1671entries, three matching identity
surfaces, no disallowed private artifact path names; extracted Debian payload
hash matches the compiled engine and runs without global Bun on PATH. Debian
control version1.1.1~rc.1 orders before stable1.1.1. These are actual executed
local inspections, **not** a whole-content secret certification or a system
installer/native-GUI pass.

`verify-release --strict` against the local unsigned set returned exit1:
byte integrity/SBOM PASS, authenticated publisher/provenance absent. The signing
preflight returned BLOCKED for absent Apple/Windows owner prerequisites. This
is expected fail-closed release behavior, not a signature success.

# # Publication and channel separation

Tag pushes may prepare only verified **PRIVATE drafts**. Public versioned
publication requires explicit owner workflow_dispatch `publish=true`, all
applicable gates and same-tag native evidence; environment reviewer/ref rules
must actually be configured by the owner. npm publishes the already signed
tarball, not a fresh pack. Preview uses beta; plain stable version initially
uses candidate/version staging, **not** automatic latest.

Canonical committed Homebrew/WinGet/Scoop templates derive publicVersion1.0.0,
not development RC1.1.1-rc.1. Stable release metadata may be projected into a
separate output directory and included in signed SHA256SUMS without advancing
live defaults. The existing owner-dispatched Publish Channels workflow verifies
the exact signed metadata bytes (matching URLs alone cannot forgive injected
Ruby), native CI and immutable registry/image bytes before optional default
promotion. WinGet uses authenticated bounded Git Data/PR APIs, never a PAT in
argv or an unsigned downloaded executable. Existing owner staging branches are
not force-replaced. Community review remains pending, not installation success.

Default promotion across independent registries is not an atomic transaction;
a partial failure is RED and requires owner reconciliation/rerun, not an invented
all-channel PASS. Do not reuse the withdrawn1.1.0 tag or silently point stable
installers/updaters to an unverified preview. See [current report](RELEASE_CANDIDATE_REPORT.md),
[signing runbook](DESKTOP_SIGNING.md) and [commands](VERIFICATION_COMMANDS.md).
