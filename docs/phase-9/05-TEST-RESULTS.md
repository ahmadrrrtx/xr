# Phase 9 · 05 — Test Results (STEP 6/7 evidence)

**Date:** 2026-08-04 · **Host:** Linux x64 sandbox, Bun 1.3.14, Node 20.20.2 ·
**Branch:** `feat/phase9-packaging-release`

Every number below is a measured output of the named command on this branch,
not a transcription of any report. Tests assert **effects** (Art. XX): bytes
on disk, exit codes, served responses, rendered files — never mocks of the
thing under test.

## Baseline (pre-Phase-9, commit 2ec994a)

| Gate | Result |
|---|---|
| `bun run typecheck` | 0 errors |
| `bun test` | 2684 pass / 13 skip / 0 fail |
| `bun run ci` (all 13 gates) | green |
| golden path | `{"ok":true,"version":"7.0.1"}` · 17 checks · `chainValid:true` |
| `release:check` | 6 surfaces in sync at 7.0.1 |
| `claim-lint` | 8 evidenced claims |

Recorded flake (pre-existing, reproduced isolated): `test/context/performance.test.ts`
G6 p95<100 ms fails only under full-suite contention (1640 ms observed vs
20.8 ms isolated). Not a Phase-9 regression; unchanged.

## Final (HEAD of `feat/phase9-packaging-release`)

| Gate | Result |
|---|---|
| `bun run typecheck` | 0 errors |
| `bun test` | **2771 pass / 13 skip / 0 fail** (2784 tests, 222 files) — +87 net vs baseline; 86 of them the new `test/release/` suite |
| `bun run ci` (13 gates) | **green** (typecheck, tests, release:check, claim-lint, baseline inventory, capability gate, api:schema:check, client:check, api:compat, boundaries, size-gate, hot-path-lint, ownership:check) |
| `bun run release:check` | **14 surfaces** in sync at 7.1.0 (incl. channel files, support matrix, website distribution module) |
| `bun run claim-lint` | **11 evidenced claims** · no unsupported claims |
| golden path | `{"ok":true,"version":"7.1.0"}` · 17 checks · `chainValid:true` |
| `bun run perf:gate` | **PASS** all budgets — version p95 cold 42.4 ms / warm 42.0 ms (budget 300/150), doctor 452.5 ms (1500), route 0.0025 ms (20), dashboard 10.9 ms (1000), retrieval@100k 42.0 ms (250). **No startup regression (Art. XII).** |
| unit tier | 279 pass · 1.4 s (budget 5 s) |

## Phase-9 suite (`test/release/`, 86 tests) — what is actually proven

- **release-build / release-gate**: the assembler runs against `XR_ROOT`
  fixtures; the gate refuses unstagged tags and bad prerelease suffixes with
  real exit codes; the bundle contains the 5 binaries + npm tgz + deb/rpm +
  SHA256SUMS + SBOM + subjects + hashes.json, and `--verify` independently
  re-verifies it (fail-closed).
- **channels**: the ar/ustar parsers read a real `.deb`; deb control file
  asserts the Debianized version + Public Beta label; the Homebrew formula
  passes `ruby -c` syntax validation; Scoop/WinGet manifests parse as
  JSON/YAML; every manifest channel field validates (dup ids, tiers, kinds,
  overclaim words rejected).
- **channel-update**: a real loopback HTTP release feed (`Bun.serve`) drives
  `applyUpdate` end to end — happy-path swap, **three tamper refusals**
  (hash mismatch, checksums unavailable, missing entry — current binary
  byte-identical after each), forced-failure canary auto-rollback, and
  channel detection precedence (install.json > path > legacy).
- **changelog**: a real git fixture repo; grouping, breaking `!` callout,
  deterministic re-emission, empty-range marker.
- **release-workflow**: `release.yml` parsed as YAML and asserted
  structurally — SLSA `base64-subjects` wiring (the Phase-4 miswire), cosign
  per-asset signing, OIDC npm job with **no** `NODE_AUTH_TOKEN`, secret
  fail-loudly checks, evidence job gating all stages; `cross-platform.yml`
  asserted for full-parity `bun test` + golden path on all 4 runners.
- **install-scripts**: `bash -n` clean; checksum-verification blocks,
  die-not-warn paths, optional cosign path with pinned identity, channel
  records; install.ps1 Get-FileHash + Die paths.
- **downloads-page / beta**: website contains no `href="#"`, no fictional
  channels/editors, derives channels from the stamped distribution module,
  labels Public Beta; beta-metric gate is PROVISIONAL below the 30-attempt
  window and fail-closed on corrupt lines.
- **support-matrix / portability**: stamped matrix tiers ↔ workflow jobs;
  runtime OS-detection skips whitelisted (3 files), self-exempt pattern file,
  whitelist drift fails.

## Incidents during validation (recorded honestly)

1. **/tmp exhaustion (SQLITE_FULL):** mid-phase full-suite runs began failing
   en masse in `src/state/write-gate.ts` (`database or disk is full`). Root
   cause: the 993 MB tmpfs `/tmp` was 100% full of leaked temp dirs from
   accumulated test runs (envadv/plugin suites, ~636 K×1500 dirs). Clearing
   stale dirs restored the full green run. Not a code defect; noted here so a
   future sandbox investigator doesn't misread it as a regression.
2. **Artifact-E2E pin:** the Phase-1 hermetic E2E pinned `doctorVersion` to
   the literal `"7.0.1"`; the 7.1.0 stamp broke it (correctly — one identity
   everywhere). Fixed by binding the assertion to
   `release.manifest.json → identity.version`; `scripts/golden-path.ts` now
   reports `CORE_VERSION` from the stamped module instead of a literal.
3. **Dashboard hash pin:** deliberately re-pinned after *proving* the only
   render delta was the single 7.0.1→7.1.0 version string (substitution
   reproduces the old SHA-256 exactly); documented bump history in the test.
4. **OWNERSHIP/OpenAPI drift:** regenerated (`bun run ownership:generate`,
   `bun run api:schema:generate`); drift gates caught exactly what they are
   designed to catch.
5. **Typecheck narrowing:** bun's `expect()` doesn't narrow TS unions;
   channel-update tests gained an `expectRefused` assertion helper (primary
   fix), `server.port` non-null in test setup.

## Environment honesty (what this sandbox could not execute)

| Capability | Status here | Consequence |
|---|---|---|
| GitHub-hosted runners (Windows/macOS/arm64) | unavailable | full-parity CI is **defined and YAML-contract-tested**, its green status must come from real CI — claimed as pending, not achieved |
| cosign / Rekor | unavailable | local Ed25519 self-sign + `verify-release.ts` tested; keyless path proven by workflow contract tests, live Rekor entry only from a real tag run |
| Docker daemon | unavailable | container build/push is CI-only; no local image smoke |
| rpmbuild | absent (dpkg present) | `package-linux.ts` detection+skip verified; `XR_REQUIRE_RPM=1` fail-closed verified; release workflow `apt-get install rpm` |
| npm/tap/bucket/winget network pushes | no credentials | publish steps are contract-tested; first real publish happens on the first tag with secrets configured |
