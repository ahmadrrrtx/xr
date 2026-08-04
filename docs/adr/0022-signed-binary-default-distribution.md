# ADR-0022 — Signed compiled binary is the default distribution; one build feeds every channel

- **Status:** accepted (Phase 9 · T1/T2)
- **Owner:** release engineering · **Review:** 2026-08-04

## Context

Through 7.0.1, `install.sh` tried to fetch a release binary, always 404'd
(no release assets existed — API-verified: the only GitHub release was
v3.0.0), and silently fell back to a source build that required Bun. The
7.0.1 known-limitations register stated plainly: *"Releases are not signed …
there is no SBOM or SLSA provenance."* The Phase-4 release workflow scaffold
had a miswired SLSA job (`needs.build-and-sign.outputs.digests` consumed,
never produced) and an npm step that claimed "no long-lived tokens" while
using `secrets.NPM_TOKEN`.

Three honest-distribution questions had to be answered once, not per channel:
what is the *default* artifact, how is integrity proven, and how do nine
channels avoid diverging into nine truths.

## Decision

1. **The compiled binary is the default distribution.** One `bun build
   --compile` artifact per tier-1 target (linux x64/arm64, darwin
   arm64/x64, windows x64), self-contained, no runtime prerequisite. npm and
   source checkout remain channels, not the fallback-everyone-actually-gets.
2. **No unsigned distribution path exists.** Every release asset is covered
   by `SHA256SUMS` (one authority computed over the exact release
   directory), cosign-signed keylessly (sigstore bundle + public Rekor log)
   by the tag-triggered Release workflow, and attested by SLSA v1.0
   provenance (generic generator; the `outputs.digests` miswiring is fixed —
   `build` exports `subjects.b64`, the generator consumes
   `base64-subjects`). Installers and `xr update` verify checksums
   **fail-closed**; signature verification runs automatically when cosign is
   present. Claims of signing are made only for tags the workflow actually
   ran on (Art. IX.4).
3. **One build feeds every channel.** `scripts/release-build.ts` assembles
   one release bundle; `hashes.json` from that bundle pins the Homebrew
   formula, Scoop manifest and WinGet manifests via
   `scripts/channel-render.ts --fill-hashes`, which *refuses to emit* any
   file still holding a placeholder. No channel ever carries a hash from a
   second build.
4. **npm uses OIDC trusted publishing** (`id-token: write`,
   `npm publish --provenance`, no `NODE_AUTH_TOKEN` — a token in the
   environment is documented as breaking the exchange). The R5 lie ("no
   tokens" while using one) is replaced by it being actually true.
   Prerelease tags publish to the `beta` dist-tag and never take `latest`.
5. **The release bundle independently verifies itself before upload**
   (`--verify` runs `scripts/verify-release.ts` against the assembled
   directory); a bundle that fails its own verification is never signed.

## Consequences

- "Signed releases" is claimable **per tag, with Rekor evidence links** —
  and only from the first tag this workflow runs on; older tags stay
  unsigned by record, not by rewording.
- The npm job now requires a configured GitHub environment (`npm-publish`)
  plus npm-side trusted-publisher setup (runbook §5); missing secrets fail
  the release loudly rather than silently skipping a listed channel.
- bin-in-PM channels (deb/rpm/Homebrew/Scoop/WinGet) are byte-identical to
  the direct download by construction.

## Tests

`test/release/release-build.test.ts` (gate, bundle, checksums, subjects,
hashes), `test/release/install-scripts.test.ts` (fail-closed checksum/signature
paths), `test/release/release-workflow.test.ts` (YAML contract incl. SLSA
wiring), `test/perf/binary-update.test.ts` + `test/release/channel-update.test.ts`
(verified atomic update, tamper refusals).
