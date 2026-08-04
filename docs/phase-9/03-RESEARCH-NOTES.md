# Phase 9 — STEP 3 Research Notes (principles adopted, with sources)

XR is Bun-based (its own `build-matrix.ts`, not GoReleaser), so each principle is
recorded as *the pattern adopted* and *the XR adaptation*, never a copy.

## R1 — Multi-channel cross-platform CLI distribution (one build → many channels)

**Principle.** A CLI ships one canonical per-target build, then publishes the
*same* artifacts to every channel: GitHub Releases (direct binary) as the source
of truth for all hashes, Homebrew tap, WinGet/Scoop manifests, Linux packages
(.deb/.rpm), npm, and a container image. Channel manifests live in **separate
repos** (own tap/bucket) and are updated by the release automation with a
cross-repo token; every channel points back at the canonical release assets, so
hashes can never diverge. Versions stay in sync because one pipeline stamps
everything from one version source.

**Sources.** [GoReleaser+Actions Homebrew/Scoop automation discussion — floatpane/matcha example, tap-PAT + bucket token pattern](https://www.reddit.com/r/golang/comments/1tc4qp1/need_help_understanding_goreleaser_github_actions/) · [Homebrew tap one-command install pattern](https://www.reddit.com/r/commandline/comments/1r3w0ga/tool_homebrew_tap_for_github_copilot_cli_one/) · [Tracking Homebrew downloads via GitHub API — taps/buckets as separate repos updated per release](https://george.mand.is/2026/05/tracking-homebrew-downloads-with-github-s-api) · [winget/scoop install↔upgrade contract example (GitHub.cli)](https://winget.ragerworks.com/package/GitHub.cli)

**XR adaptation.** The canonical build is `scripts/build-matrix.ts` output for 5
targets. The **release manifest's new `distribution` section** is the single
authority for targets/channels/tiers/stability (Constitution Art. XXII.1 — one
source of truth). Channel files in `packaging/` are stamped by
`release:stamp` (exactly like `package.json`/`version.ts` today), hashed against
the canonical `SHA256SUMS`, and published by `release.yml` jobs. Own repos
(`homebrew-tap`, `scoop-bucket`) receive manifest commits via an org token;
WinGet submission is a `wingetcreate` job against `microsoft/winget-pkgs`
(honestly gated on the secret existing — see STEP 4 / ADR-0023).

## R2 — Automated signed release-from-tag

**Principle.** On a `v*` tag: build per target → `checksums.txt` → **cosign
keyless** signing (sigstore bundle; GitHub Actions OIDC identity embedded by
Fulcio; entry in the public Rekor log) → **CycloneDX SBOM** → **SLSA provenance**
attestation → changelog from conventional commits → GitHub Release with all
assets. Users verify with `cosign verify-blob --certificate-identity
<workflow>@refs/tags/v* --certificate-oidc-issuer … --bundle …` then `sha256sum
-c`; both the identity *and* the issuer must be pinned, or any GitHub workflow's
signature would pass.

**Sources.** [sigstore/cosign README — keyless sign-blob + verify-blob bundle pattern and identity pinning](https://github.com/sigstore/cosign) · [Keyless signatures with GitHub Actions OIDC (ephemeral 30-min cert; pipeline must start only from a maintainer tag)](https://shibumi.dev/posts/keyless-signatures-with-github-actions/) · [GoReleaser — Upgrading to Cosign v3 (single `--bundle` file replaces cert+sig pair)](https://goreleaser.com/blog/cosign-v3/) · [Sigstore cosign keyless complete guide — check identity AND issuer; SLSA L3 relation](https://www.qcecuring.com/blog/sigstore-cosign-keyless-github-actions)

**XR adaptation.** `release.yml` builds the binary matrix, generates
`SHA256SUMS` over **all** release assets, and signs every binary + the sums +
the SBOM with `cosign sign-blob --bundle`. The tag push is the trust boundary —
only maintainers tag. Identity string published in VERIFYING_RELEASES.md is the
exact `https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*`
form.

## R3 — SLSA provenance via the generic generator (and the current miswiring)

**Principle.** SLSA v1.0 provenance for arbitrary artifacts comes from the
**generic generator reusable workflow**: the build job emits
`outputs.hashes = sha256sum artifacts… | base64 -w0`, a separate
`provenance` job calls
`slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml`
with `base64-subjects: ${{ needs.build.outputs.hashes }}`,
`upload-assets: true`; the generator signs attestation(s) and uploads
`*.intoto.jsonl` assets (named `provenance.intoto.jsonl` / per-subject).
Users verify with `slsa-verifier verify-artifact --provenance-path …
--builder-id <generator workflow> --source-uri github.com/<repo>
--source-tag <tag>`.

**Sources.** [slsa-github-generator generic builder — inputs/outputs contract (base64-subjects required; generator reusable workflow)](https://github.com/slsa-framework/slsa-github-generator/blob/main/internal/builders/generic/README.md) · [Code Signing is Not Enough — build job must emit hashes output; slsa-verifier verification command](https://www.ianlewis.org/en/code-signing-is-not-enough) · [SLSA GA announcement — hash→base64 job output + slsa-verifier](https://slsa.dev/blog/2022/08/slsa-github-workflows-generic-ga)

**XR adaptation.** This research *confirmed audit finding R2*: the current
`release.yml` consumes `needs.build-and-sign.outputs.digests` while the job
declares **no outputs** — Phase 9 fixes the wiring exactly to the documented
contract (`outputs.hashes` → `base64-subjects`), and the verification docs use
the *actual* uploaded asset names (`*.intoto.jsonl`), not a hypothetical
`provenance.json`.

## R4 — npm trusted publishing (OIDC) is GA

**Principle.** npm Trusted Publishing with OIDC is generally available: a
package is configured (on npmjs.com) to trust a specific GitHub
repo/workflow/environment; the workflow needs `id-token: write`; `publish
--provenance` then exchanges the OIDC assertion for a transient credential —
**no `NODE_AUTH_TOKEN` must be set** (a default token injected by setup actions
has been observed to break OIDC exchange with a 404-class error).

**Sources.** [npm trusted publishing GA overview — remove long-lived tokens; registry issues transient credential per run](https://progosling.com/en/dev-digest/2025-09/npm-trusted-publishing-oidc-ga-2025) · [npm OIDC setup guide — `id-token: write`, remove NODE_AUTH_TOKEN, `npm publish --provenance`](https://npmdigest.com/guides/npm-trusted-publishing) · [GitHub community #176761 — stray NODE_AUTH_TOKEN breaks trusted publishing matching](https://github.com/orgs/community/discussions/176761)

**XR adaptation.** The publish job drops `secrets.NPM_TOKEN` and publishes with
`bun pm publish --provenance` under OIDC (`id-token: write`), environment
`npm-publish`. The workflow comment stops claiming "no long-lived tokens" until
it is literally true — and now it is. The npm-side "Trusted Publisher" config is
an operator step (documented in RELEASING.md; cannot be done from the repo).

## R5 — Cross-platform CI parity (real runners, honest tiers)

**Principle.** "Supported" = validated: real `macos-latest` / `windows-latest`
runners run the *same* tier as Linux (typecheck + full unit suite + golden
path), not an abbreviated subset. Platform-specific tests skip **by runtime
detection** (Constitution Art. XX.5 — optional capability detected and skipped
cleanly), never by excluding directories in CI config (config-level exclusion
hides drift; in-test skip conditions are versioned with the test). Honest
support tiers are published and generated from CI reality.

**XR adaptation.** `cross-platform.yml` runs the full `bun test` on all three
OS families; the audit's whitelisted POSIX/win32 skips become detection-based
skips inside the tests (crash-injection uses SIGKILL → POSIX-only; policy-gate
POSIX-path corpus → POSIX-only; `cli-spine` doctor probe → skips on win32 with
the exact parity note). The support matrix is *generated* from the manifest +
CI evidence (`scripts/support-matrix.ts`), never hand-claimed.

## R6 — Public Beta readiness

**Principle.** A public beta is: (1) honestly labeled everywhere (Developer
Preview/Beta — never GA/stable); (2) installable on every tier-1 platform;
(3) backed by a measured golden path running nightly per OS; (4) publishes a
support matrix and known-limitations register; (5) has a prerelease channel
(semver `-*` tags) so beta users can take early builds; (6) closes the loop:
feedback → acceptance (issue templates feeding a documented acceptance
process); (7) rolls out staged/canary where the channel allows it.

**XR adaptation.** The manifest gains `distribution.stability: "beta"` and
`distribution.channels.beta`; the website, installers, and docs are stamped
with the Beta label from the manifest (one truth). `v*-*` tags publish as
GitHub **prereleases**; stable users get `v*` only. The nightly workflow adds a
beta-install matrix (3 OS families × installer) recording an install-success
rate artifact; the >99% target is enforced as a *gate on the recorded metric*
(and reported honestly with its accumulation window — never claimed before the
window exists). Feedback loop: `beta_feedback.yml` issue template +
`docs/beta/FEEDBACK.md` acceptance process (triaged into acceptance criteria of
the next patch, honoring the false_claim.yml precedent).

## R7 — Cosign for container images + registry publishing

**Principle.** Container images publish to GHCR with
`docker/build-push-action` (multi-arch), then `cosign sign --yes <image>@<digest>`
keylessly against the digest (never a mutable tag); SBOM/provenance attach as
referrers; verify with
`cosign verify --certificate-identity … --certificate-oidc-issuer … <image>@<digest>`.

**Sources.** [Sigstore cosign keyless guide — image digest signing, annotations with build-url/git-sha/git-ref](https://www.qcecuring.com/blog/sigstore-cosign-keyless-github-actions) · [sigstore/cosign README — verification pins identity+issuer](https://github.com/sigstore/cosign)

**XR adaptation.** `release.yml` gains a `container` job: buildx → GHCR
(`ghcr.io/ahmadrrrtx/xr`) at `:v<version>` + `:latest` (stable only) → sign
digest keylessly → attest SBOM. Prerelease tags publish `:<version>` without
moving `:latest`. Requires secrets: none beyond `GITHUB_TOKEN` (`packages:
write`).
