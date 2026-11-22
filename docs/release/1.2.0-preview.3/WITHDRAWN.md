# XR 1.2.0-preview.3: withdrawn tag (not published)

**Status:** withdrawn. Nothing was published for 1.2.0-preview.3. The public version is
**1.0.0** (`release.manifest.json` → `channels.publicVersion`). Preview 3's changes ship in
**1.2.0-preview.4**.

## What happened (evidence)

- `v1.2.0-preview.3` was tagged at `b46173a`, after all six required checks had passed on that commit.
- Release workflow run **44931782266** built, signed and checked almost everything: 37 of its 45 jobs passed,
  including the gates, every build leg (windows-arm64 too), assembly, the cosign signatures, the SLSA provenance,
  the clean-machine journeys and the supply chain.
- Its job "Verify signed artifacts (verify-release.ts)" failed. `slsa-verifier` authenticated the provenance
  builder, but the repository's own `slsa-provenance-subject` check found no subject. It read only a flat DSSE
  envelope, while slsa-github-generator v2.1.0 writes the provenance as a Sigstore bundle with the envelope one
  level down (NEW-17 in `HARDENING_LOG.md`). The draft and publishing jobs depend on that job, so all 7 were
  skipped.
- So 1.2.0-preview.3 has **no** GitHub release or draft, npm version, Docker image or channel manifest. Its build
  outputs exist only as workflow artifacts of that run.
- The desktop workflow's tag run **44931781798** stopped at its signing preflight, because no signing secrets are
  provisioned. No desktop bundle was attached anywhere.

## Resolution

- `v1.2.0-preview.3` is listed in `channels.withdrawnTags`. `validateReleaseTag` refuses to release it again, and the
  tag ⇔ npm invariant fails if it ever appears on npm. The tag is not deleted or moved.
- `verify-release` now reads the subject through a Sigstore bundle's DSSE envelope as well as from a flat envelope,
  and every failed check also becomes a GitHub Actions annotation (NEW-17).
- By owner decision, preview tags now build unsigned desktop installers (macOS ad-hoc sealed) instead of stopping at
  the signing preflight. Stable tags still require signing. See
  [`DESKTOP_SIGNING.md`](../DESKTOP_SIGNING.md).
- The next tag is `v1.2.0-preview.4`, and it too prepares a verified private draft only. Promoting it is the owner's
  decision.
