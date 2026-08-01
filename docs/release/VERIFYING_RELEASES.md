# Verifying an XR Release (Phase 4 · T6)

Every tagged release ships four things you can verify independently:

| Asset | What it proves |
|---|---|
| `SHA256SUMS` | the artifacts you downloaded are byte-identical to what CI built |
| `sbom.cyclonedx.json` | the exact locked dependency inventory (with integrity hashes) |
| `provenance.json` | SLSA build provenance; its subject digest matches the artifact |
| `*.bundle` (cosign) | a keyless signature bound to the GitHub Actions OIDC identity, recorded in the PUBLIC Rekor transparency log |

## 1. Verify integrity

```bash
cd <download-dir>
sha256sum -c SHA256SUMS
```

## 2. Verify the signature (cosign keyless, Rekor)

```bash
# install cosign: https://docs.sigstore.dev/cosign/installation/
cosign verify-blob \
  --certificate-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --bundle xr-7.0.1.tgz.bundle \
  xr-7.0.1.tgz
```

The signature and certificate are independently confirmable in the public
Rekor log:

```bash
rekor-cli search --sha <sha256-of-artifact>
rekor-cli get --uuid <entry-uuid>   # shows the Fulcio certificate + signed payload
```

## 3. Verify the SBOM

```bash
bun run scripts/verify-release.ts \
  --artifact xr-7.0.1.tgz --sums SHA256SUMS \
  --sbom sbom.cyclonedx.json --provenance provenance.json
```

The verifier fails closed: it reports exactly what it verified and makes no
claim for anything it could not check.

## 4. Verify SLSA provenance

The provenance subject digest must equal the artifact's SHA-256 (checked by
the verifier above). You can also inspect it directly:

```bash
jq '.subject' provenance.json
sha256sum xr-7.0.1.tgz
```

## Honesty notes

- Keyless/Rekor proof exists only after the Release workflow has actually run
  on a real tag (evidence link + expiry, Constitution Art. IX.4).
- SLSA proves *where* an artifact was built, not that its source is safe —
  combine with the published scan results (gitleaks/osv/license/trivy) and
  review.
- `verify-release.ts` without cosign inputs deliberately FAILS (no claim).
