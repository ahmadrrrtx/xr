# Reproducible Release Runbook (Phase 9)

Everything below is enforced by CI; humans follow the same steps locally when
preparing a release. **The release is evidence-bound: if a gate fails, the
release does not happen.**

## 0. Preconditions (operator, one-time)

- npm trusted publishing configured for `@rrrtx/xr` (OIDC → this repo,
  `.github/workflows/release.yml`, environment `npm-publish`).
- (Homebrew tap) public repo `ahmadrrrtx/homebrew-tap` created with at least one
  commit; secret `TAP_GITHUB_TOKEN` (fine-grained, `contents: write` on the tap
  repo only). Used only by `publish-channels.yml`.
- (WinGet) secret `WINGET_TOKEN` (classic PAT, `public_repo`) for
  `wingetcreate submit`. Used only by `publish-channels.yml`.
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
# 1f. Re-stamp the published tree ceiling into the README gates table + canonical register
#     (single source: TREE_CEILING in scripts/size-gate.ts)
bun run size-gate --stamp-docs
# 1g. Refresh the published test baseline: run root `bun test` on the Linux lane, then write
#     docs/release/TEST-BASELINE.json ({pass, skip, fail, files, bunVersion, lane, commit,
#     measuredAt}) and the README gates-table line from its output — claim-lint fails when
#     the two disagree
```


## Independent version surfaces

The release-identity stamp (`release.manifest.json` → `bun run release:check`) owns the CLI surfaces. The surfaces below version **independently by evidence**: each was introduced with its own number and has never been a stamp target, and repo history shows no release-time bump commit for any of them. Policy: they must not silently claim the release identity; if one is ever meant to track the release, that is a deliberate decision recorded here first.

| Surface | Version (2026-10-17) | Stamped from the release identity? | Status & evidence |
|---|---|---|---|
| `cloud/package.json` | 1.0.0 | no | **Independent** — introduced at 1.0.0 as a separate Bun/Hono deployable (2026-10-13, `c1ad0e0f`) and never re-stamped; anything newer would be coincidence. |
| `mobile/package.json` | 28.0.0 | no | **Independent** — born at 28.0.0 at introduction (2026-10-13, `7d2338d6`); its number follows its own lineage, not the release. |
| `desktop/src-tauri/Cargo.toml` | 0.2.0 | no | **Independent** — the desktop inner crate carries its own 0.2.x infancy series; its version field has never been changed since introduction. |
| `extensions/vscode/package.json` | 0.2.0 | no | **Independent** — added 2026-06-04 (`af733159`) at 0.2.0 and only lockfile-maintained since. (4th surface: not covered by the original audit's release-manifest review — see the XR_FIX_TRACKER deviation log (docs/audits/XR_FIX_TRACKER.md).) |

## 2. Verify locally (the same gates CI runs)

```bash
bun run ci                      # full chain incl. channel:check + platform:parity:check + changelog:check
bun run golden-path             # hermetic golden path
bun run build:binary            # full 5-target canonical build + native smoke
bun run scripts/build-deb.ts --bin dist/xr-linux-x64 --out dist/
bun run scripts/beta-install-survey.ts --release-dir dist --runs 5
```

## 2b. Phase 3 — Artifact truth (1.x line)

- **Publish is tag-gated.** `workflow_dispatch` on `release.yml` assembles
  against `release.manifest.json`'s version (dry-run). npm, GitHub Release,
  SLSA, Docker, channels, `verify-release`, and consumer-smoke jobs run only
  when `github.ref_type == 'tag'`.
- **SBOM is checksummed.** Assemble writes CycloneDX *then* `scripts/write-sums.ts`
  (portable; no GNU `sha256sum`). SLSA subjects are SHA256SUMS entries plus the
  hash of SHA256SUMS itself (`--print-with-manifest`).
- **Post-sign verify.** The sign job `cosign verify-blob`s the checksums it just
  signed. An independent `verify-release` job downloads *only* the signed bundle
  and runs `scripts/verify-release.ts`.
- **npm dist-tags.** Prerelease tags (`v1.0.0-beta.1`) publish with `--tag beta`.
  Stable tags publish `--tag latest`. Because **`3.1.5` is still `latest` and
  sorts above `1.0.0`**, the first stable 1.0.0 publish must also
  `npm dist-tag add @rrrtx/xr@1.0.0 latest` (operator). Do **not** auto-repoint
  `latest` from a beta. Repair commands are print-only:
  `bun run scripts/tag-npm-invariant.ts --repair`.
- **Consumer smoke.** `release.yml` smokes the just-published version;
  `.github/workflows/consumer-smoke.yml` runs weekly with
  `--skip-if-unpublished`.
- **Canaries / nightly.** Zero-provider canaries fail unless
  `vars.XR_CANARY_ALLOW_EMPTY=1`. Nightly uses `write-sums.ts`, does not
  bind-mount `$PWD` over the image `/app`, and upserts issue
  "Nightly Golden Path failed" on red.

Rehearsal for this phase is `v1.0.0-beta.1`. Stable 1.0.0 / `latest` waits for P2.

## 3. Merge → tag → unattended release

```bash
git tag v$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("release.manifest.json","utf8")).identity.version)')
git push origin main --tags
```

On the tag, `.github/workflows/release.yml` runs — **unattended**:
gates → 5-target matrix build (+native smoke, +windows zip) → npm tarball +
source archive + `.deb` → CycloneDX SBOM → `SHA256SUMS` (includes SBOM) →
conventional-commit changelog → **cosign keyless `sign-blob`** + verify-blob →
GitHub Release (prerelease honored) → **SLSA3 provenance** → npm OIDC publish
(`beta` for prerelease, `latest` for stable) → independent `verify-release.ts`
→ consumer-smoke of the published version → GHCR image + cosign signature →
channel manifests stamped from the signed sums and attached. Untagged
`workflow_dispatch` stops after assemble/sign (dry-run).

The tag run does **not** push the Homebrew tap or submit to WinGet, and it does
**not** change what the installers serve. If any job fails, the GitHub release
must not stay a full release. Mark it pre-release (`gh release edit vX.Y.Z
--prerelease`) and add the tag to `channels.withdrawnTags` with the failing run
as evidence (this is what happened to v1.1.0).

## 3b. Promote to the public channels

Follow [CHANNELS.md § Promotion runbook](CHANNELS.md#promotion-runbook-moving-publicversion-forward):
**Publish Channels** (verified tap push + `brew install` smoke + WinGet
submission) → `bun run channel:live --version X.Y.Z` green → set
`channels.publicVersion` → `bun run release:stamp` → merge. Only that last step
changes what `install.sh` / `install.ps1` install and what the README calls
available.

## 4. Post-release verification (evidence, not ceremony)

- Follow `docs/release/VERIFYING_RELEASES.md`: `cosign verify-blob` the
  SHA256SUMS bundle + `sha256sum -c` on one binary per OS family.
- `channel-live.yml` (daily, and on every change to the release manifest or the
  installers) resolves every claimed channel against the live registries and
  clean-HOME installs the public version with `install.sh` (Linux, macOS) and
  `install.ps1` (Windows). Weekly `channel-install.yml` runs real apt/brew/scoop
  installs of the public version and **fails** on missing assets. Channel status
  goes into `docs/release/SUPPORT_MATRIX.md`; nothing is declared live before
  `channel:live` passes for it.
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
  is no longer referenced (revoke it after the first 1.0.0 publish).
- Channel configs live in `packaging/` as *generated* files; never hand-edit —
  `channel:sync` regenerates, `channel:check` fails CI on drift.
