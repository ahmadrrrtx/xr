# Phase 9 — Gap Analysis (STEP 2)

Maps audited gaps (01-AUDIT-REPORT.md §C) to tasks and the test that proves each closure.
Constitution anchors: Art. XXII (one manifest, signed reproducible releases), XXIII (reversibility),
XXVIII/XXIX (release discipline / verifiable done), XIX (claim-governed docs), XX (cross-platform CI),
IV.5 (no claim outruns evidence), IX.4 (no security claim without independent evidence).

| Order | Gap | Task | Constitutional anchor | Proving test |
|---|---|---|---|---|
| 1 | G1 release pipeline broken (SLSA wire-less outputs; npm never publishes) | T2 | Art. XXII.3 | `test/release/release-workflow.test.ts` — structural assertion that `build` job publishes `outputs.digests`, `provenance` consumes them, all gates precede build; yaml-driven |
| 2 | G2 no per-target signed binaries on releases | T1 | Art. XXII.3 | `test/release/release-workflow.test.ts` (matrix job per OS; 5 targets; sign step signs SHA256SUMS; assets uploaded) + `test/release/checksums.test.ts` (SHA256SUMS parse/verify round-trip) |
| 3 | G3 no checksum verification on binary download paths | T5 | Art. XXII.5 / Part 20 | `test/update/channels-update.test.ts` (binary plan verifies fetched sums, fail-closed) + `test/release/installer-verify.test.ts` (install.sh/install.ps1 fail closed on bad/missing sums) |
| 4 | G5 no native channels | T3 | Art. XXII | `test/release/channels.test.ts` — Homebrew formula, WinGet manifests, Scoop manifest, .deb structural validation (ar/control/payload hash), Docker publish job; one canonical build (`channel:check`) |
| 5 | G10 no channel-sync gate | T3 | Art. XXII.1 | `bun run channel:check` in `ci` + release gate; drift test (doctored formula fails) |
| 6 | G6 cross-platform subset, not full parity | T4 | Art. XX.4 | `scripts/platform-parity.ts` + `test/platform/exclusions.json` (documented, reasoned, bounded) + workflow runs full suite − exclusions + golden path on 3 OS families; `test/release/platform-parity.test.ts` validates the exclusion machinery |
| 7 | G8 stale CHANGELOG, no convention | T2 | Art. XIX | `scripts/changelog.ts` (conventional commits) + `test/release/changelog.test.ts`; entry generated from git log |
| 8 | G9 updater blind to channel-managed installs | T5 | Art. XXIII | `test/update/channels-update.test.ts` — detection + delegation plans + forced-failure rollback per channel |
| 9 | G4 npm drift / no prerelease channel | T2/T6 | Art. XXII | release.yml publishes dist-tags (`latest` / `beta`); workflow test asserts dist-tag logic |
| 10 | G7 no Public-Beta product surface | T6 | Art. XIX | Beta label stamped from `release.manifest.json` (`identity.stability`); support matrix + refreshed known-limitations; nightly beta install survey on 3 OS; prerelease handling; `test/release/beta.test.ts` |

## Non-goals (scope law)

- No net-new product features (Part 4). No Phase-10 enterprise/remote work.
- `.rpm` and Snap are **not** shipped this phase: they cannot be structurally validated and
  install-tested without an RPM toolchain / snapcraft in CI, and "supported means validated".
  Recorded as known-limitations with a dated plan (see T3 docs), not claimed.

## Version plan

The machinery ships as release **7.1.0** (minor: new distribution channels; no breaking change;
CLI/API compatibility preserved per Part 17). Stamping uses the Phase-0 `release:stamp` flow so all
six surfaces + the new seventh (channel manifests via `channel:check`) move together.
