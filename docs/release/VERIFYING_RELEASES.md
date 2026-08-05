# Verifying an XR Release (Phase 9 — per-target signed distribution)

Every tagged release ≥ 7.1.0 ships independently verifiable proof for **every**
artifact — the five compiled binaries, the windows channel zip, the `.deb`,
the npm tarball, the source archive, and the container image:

| Asset | What it proves |
|---|---|
| `SHA256SUMS` | byte-identity of every artifact in the release (single checksum manifest over the whole canonical set) |
| `SHA256SUMS.bundle` | cosign **keyless** signature over that manifest — GitHub Actions OIDC identity → Fulcio → **public Rekor log** |
| `sbom.cyclonedx.json` (+ `.bundle`) | the exact locked dependency inventory, also signed |
| `*.intoto.jsonl` | SLSA3 build provenance (slsa-github-generator) over the real artifact digests |
| container signature | `cosign sign` on the GHCR image digest, keyless |

Trust root: the public Rekor transparency log + the OIDC identity
`https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*`
(issuer `https://token.actions.githubusercontent.com`). No long-lived signing
keys exist to lose.

## 1. Verify the signature over the checksum manifest (once per release)

```bash
# install cosign: https://docs.sigstore.dev/cosign/installation/
cosign verify-blob \
  --certificate-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --bundle SHA256SUMS.bundle \
  SHA256SUMS
```

Independently confirmable in the public Rekor log (the signature is public,
append-only evidence — not a claim):

```bash
rekor-cli search --sha <sha256-of-SHA256SUMS>
rekor-cli get --uuid <entry-uuid>   # Fulcio certificate + signed payload
```

## 2. Verify the artifact you downloaded (any binary / archive)

```bash
cd <download-dir>
sha256sum --ignore-missing -c SHA256SUMS
# →  xr-linux-x64: OK  (etc., one line per file you downloaded)
```

This pair (1 + 2) proves: *the exact bytes you hold were produced by the
tag-triggered release workflow of this repository.* The install scripts and
`xr update` do step 2 for you and **refuse unverified artifacts** (fail
closed) — there is no unsigned distribution path.

## 3. Verify SLSA provenance (where and how it was built)

```bash
slsa-verifier verify-artifact xr-linux-x64 \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/ahmadrrrtx/xr \
  --source-tag v<version>
# or inspect subjects directly:
jq '.subject' multiple.intoto.jsonl ; sha256sum xr-linux-x64
```

## 4. Verify the container image

```bash
cosign verify ghcr.io/ahmadrrrtx/xr:v<version> \
  --certificate-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

The image also carries buildx SBOM + SLSA provenance attestations
(`docker buildx imagetools inspect ghcr.io/ahmadrrrtx/xr:v<version>`).

## 5. Verify npm provenance

```bash
npm audit signatures        # verifies the registry-side provenance attestation
```

## One-command local verification

`bun run scripts/verify-release.ts --artifact <file> --sums SHA256SUMS \
--sbom sbom.cyclonedx.json --provenance multiple.intoto.jsonl \
--cosign-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*'`

The verifier fails closed: it reports exactly what it verified and makes no
claim for anything it could not check. Keyless/Rekor proof exists only after
the Release workflow has actually run on a real tag (Constitution Art. IX.4) —
the workflow's structural integrity is itself tested by
`test/release/release-workflow.test.ts`.
