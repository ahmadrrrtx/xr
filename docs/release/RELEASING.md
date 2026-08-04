# Releasing XR (runbook, Phase 9)

This is the complete, honest procedure for shipping a signed multi-channel
release. One pipeline authority exists — `scripts/release-build.ts` — and
`.github/workflows/release.yml` is the thin caller of it. If this document
and the workflow disagree, **the workflow is wrong**: fix it to match the
model, never the reverse.

## 0. Model

```
tag v<X.Y.Z>[-beta.N]  →  gate  →  build  →  sign  →  provenance  →  release
                          (identity,    (5 targets,   (cosign     (SLSA v1.0   (changelog +
                           truth,       npm tg,       keyless,    subjects)     GitHub Release;
                           tests,       deb/rpm,      Rekor)                    prerelease if
                           golden path) SHA256SUMS,                            tag has a suffix)
                                        SBOM)
                                                                     ↓
              publish: npm (OIDC) · GHCR (digest-signed) · Homebrew tap · Scoop · WinGet
                                                                     ↓
                                   evidence job: ANY non-success stage fails the release
```

Channel semantics:

| Tag form | GitHub Release | npm dist-tag | GHCR `:latest` |
|---|---|---|---|
| `v7.2.0` | stable | `latest` | moved |
| `v7.2.0-beta.1` (alpha/beta/rc suffix) | **prerelease** | `beta` | NOT moved |

XR is a **Public Beta**: `distribution.stabilityLabel` is fail-closed
validated by `scripts/distribution-model.ts` — labeling a beta "stable"/"GA"
fails `release:check`.

## 1. Prepare (normal PR flow)

1. Bump `identity.version` in `release.manifest.json` (semver; prerelease
   suffix allowed) and — if claims or distribution change — edit those
   sections too.
2. `bun run release:stamp` — regenerates every stamped surface (14 targets:
   `src/core/version.ts`, `package.json`, README block, installers, website
   module, support matrix, channel files).
3. `bun run ci` — must be green locally (includes `release:check`,
   `claim-lint`, full suite).
4. Merge to `main`. Cross-platform CI (4 runners at full parity) must be
   green on the commit you will tag.

## 2. Cut the tag

```bash
git tag -a v7.2.0 -m "XR 7.2.0 — see RELEASE_NOTES"
git push origin v7.2.0
```

The **gate** refuses to proceed if `tag != release.manifest.json version`
(Art. XXII.1), the suffix isn't alpha/beta/rc for prereleases, or any truth
gate is red. Retagging is the fix — never weaken the gate.

## 3. Watch the workflow

`gh run watch`. The `evidence` job summarizes every stage and **fails the
whole release if any stage is not success** — a manifest-listed channel that
cannot publish is a failed release, never a silently-skipped one
(Constitution Art. XXII).

## 4. Verify the published release (independent check)

```bash
mkdir /tmp/xr-verify && cd /tmp/xr-verify
TAG=v7.2.0
gh release download "$TAG" --repo ahmadrrrtx/xr

sha256sum -c SHA256SUMS --ignore-missing
cosign verify-blob \
  --certificate-identity-regexp 'https://github\.com/ahmadrrrtx/xr/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --bundle xr-linux-x64.bundle xr-linux-x64
slsa-verifier verify-artifact xr-linux-x64 \
  --provenance-path provenance.intoto.jsonl \
  --source-uri github.com/ahmadrrrtx/xr --source-tag "$TAG"
```

Then update the known-limitations register for the new version directory
(`docs/release/<version>/known-limitations.md`) — an entry may only be
removed with a test proving it closed.

<a id="secrets"></a>
## 5. Secrets the release needs (and fails loudly without)

| Secret | Used by | How to create |
|---|---|---|
| (none for npm) | `publish-npm` | **OIDC trusted publishing**: on npmjs.com → package `@rrrtx/xr` → Settings → Trusted Publisher → GitHub Actions, repo `ahmadrrrtx/xr`, workflow `release.yml`, environment `npm-publish`. **Do NOT set `NODE_AUTH_TOKEN`** — a token in the environment breaks the OIDC exchange. The job also requires a GitHub **environment named `npm-publish`**. |
| `GITHUB_TOKEN` (automatic) | release assets, GHCR | Built-in; needs `packages: write` (already granted to the job). |
| `TAP_TOKEN` | Homebrew tap push | Fine-grained PAT with **contents: write** on `ahmadrrrtx/homebrew-tap`. |
| `SCOOP_TOKEN` | Scoop bucket push | Fine-grained PAT with **contents: write** on `ahmadrrrtx/scoop-bucket`. |
| `WINGET_TOKEN` | WinGet submission | Classic PAT with `public_repo` for fork-and-PR against `microsoft/winget-pkgs` (wingetcreate contract). |

Job-level fail-closed checks refuse to even attempt a channel publish if its
secret is absent — the release goes red, by design (Part 13.6 / Art. XXII).

Cosign needs **no key material**: keyless signing uses the workflow's OIDC
identity (`id-token: write`), recorded in the public Rekor log.

## 6. Local rehearsal (what CI will do, minus publishing)

```bash
# Full local bundle: compiles all 5 targets (slow), packs npm, builds
# deb/rpm (rpm tool required or XR_REQUIRE_RPM=0), SBOM, SHA256SUMS, SLSA
# subjects, hashes.json, then INDEPENDENTLY VERIFIES the bundle.
bun run release:build -- --with-npm --verify

# Fast dry-run on prebuilt binaries (tests use this path):
bun run release:build -- --skip-gate --targets linux-x64 \
    --skip-build <dir-with-prebuilt-bins> --local-sign --out /tmp/xr-rel

# Preview channel files with the hashes the release would pin:
bun run channel:render -- --fill-hashes /tmp/xr-rel/hashes.json --dest /tmp/xr-ch

# Preview release notes for a tag range:
bun run changelog -- --from v7.1.0 --to HEAD --version 7.2.0
```

## 7. Rollback of a release

Releases are additive; rollback means **demote, never rewrite**:

1. GitHub: mark the bad release as prerelease/draft — do **not** delete the
   tag history users may have verified against Rekor.
2. npm: `npm deprecate @rrrtx/xr@<bad> "reason"` or move the dist-tag:
   `npm dist-tag add @rrrtx/xr@<last-good> latest`.
3. GHCR: re-tag last-good as `:latest` (`docker buildx imagetools create -t ghcr.io/ahmadrrrtx/xr:latest ghcr.io/ahmadrrrtx/xr:<last-good>`).
4. Channels: tap/bucket roll back by pointing at the previous pinned hashes
   (the previous release's commit in those repos); WinGet submits a new
   manifest for the next good version.
5. Cut `v<N+1>` with the fix. A release tag is never reused.

## 8. What this runbook deliberately does NOT contain

No hosted apt/dnf repositories, no snap/flatpak stores (deferred with
rationale — ADR-0023), and no "stable/GA" wording anywhere: XR is a Public
Beta and the tooling refuses labels that say otherwise.
