# Reproducible Release Runbook (Phase 9)

Everything below is enforced by CI; humans follow the same steps locally when
preparing a release. **The release is evidence-bound: if a gate fails, the
release does not happen.**

## 0. Preconditions (operator, one-time)

- npm trusted publishing configured for `@rrrtx/xr` (OIDC → this repo,
  `.github/workflows/release.yml`, environment `npm-publish`).
- (Homebrew tap) repo `ahmadrrrtx/homebrew-tap` created; repo variables
  `HOMEBREW_TAP_PUBLISH=true`, `HOMEBREW_TAP_REPO=ahmadrrrtx/homebrew-tap`;
  secret `TAP_GITHUB_TOKEN` scoped to the tap repo only.
- GHCR package linked to this repo (auto on first push).

## 1. Prepare (on a release PR)

```bash
# 1a. Set the version in the ONE source of truth (release.manifest.json → identity.version)
# 1b. Stamp every surface (fails if any surface cannot be stamped)
bun run release:stamp
# 1c. Regenerate channel configs (version/URL sync — the no-drift gate)
bun run channel:sync
# 1d. Generate the changelog entry from conventional commits since the previous tag
bun run changelog:generate
# 1e. Regenerate the known-limitations register + support matrix for the new version dir
#     (docs/release/<version>/known-limitations.md — review; entries may only disappear
#      when the limitation is genuinely closed AND a test proves it)
```

## 2. Verify locally (the same gates CI runs)

```bash
bun run ci                      # full chain incl. channel:check + platform:parity:check + changelog:check
bun run golden-path             # hermetic golden path
bun run build:binary            # full 5-target canonical build + native smoke
bun run scripts/build-deb.ts --bin dist/xr-linux-x64 --out dist/
bun run scripts/beta-install-survey.ts --release-dir dist --runs 5
```

## 3. Merge → tag → unattended release

```bash
git tag v$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("release.manifest.json","utf8")).identity.version)')
git push origin main --tags
```

On the tag, `.github/workflows/release.yml` runs — **unattended**:
gates → 5-target matrix build (+native smoke, +windows zip) → npm tarball +
source archive + `.deb` → `SHA256SUMS` → CycloneDX SBOM → conventional-commit
changelog → **cosign keyless `sign-blob`** → GitHub Release (prerelease honored)
→ **SLSA3 provenance** → npm OIDC publish (`latest`/`beta`) → GHCR image +
cosign signature → channel manifests stamped from the signed sums and attached
(+ tap push when operator-enabled).

## 4. Post-release verification (evidence, not ceremony)

- Follow `docs/release/VERIFYING_RELEASES.md`: `cosign verify-blob` the
  SHA256SUMS bundle + `sha256sum -c` on one binary per OS family.
- Weekly `channel-install.yml` runs REAL installs from the published assets
  (apt/brew/scoop) and reports. First-run status for each channel goes into
  `docs/release/SUPPORT_MATRIX.md` — nothing is declared live before that.
- The nightly beta survey reports install-success per OS; investigate any dip
  below 99% before the next tag.

## Rollback playbook (release-level)

If a release is bad: publish a fixed patch release (fastest honest path) —
the per-channel user rollback (`xr update`'s canary + auto-rollback,
`brew install xr@<prev>`, `scoop install xr@<prev>`, `winget ... --version <prev>`,
`apt-get install xr=<prev>`) is tested and documented per channel in
`docs/release/CHANNELS.md`. Never unpublish a signed artifact without a
replacement; the Rekor entry is permanent (by design — that's the point).

## What changed vs Phase 4 (migration notes)

- The SLSA job now consumes **real emitted digests** (`assemble.outputs.digests`)
  — the Phase-4 wiring (undefined outputs → empty subjects) is fixed and
  regression-tested (`test/release/release-workflow.test.ts`).
- npm publish uses OIDC trusted publishing; the long-lived `NPM_TOKEN` secret
  is no longer referenced (revoke it after the first 7.1.0 publish).
- Channel configs live in `packaging/` as *generated* files; never hand-edit —
  `channel:sync` regenerates, `channel:check` fails CI on drift.
