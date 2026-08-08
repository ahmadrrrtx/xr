# Phase 9 — Architecture Validation (STEP 4)

Plan validated against the Constitution before code. Each row: the decision rule checks, and the
task's verification evidence. Rejected alternatives recorded.

## Per-task validation against ADR decision rules

| Task | Boundary (ADR-1) | Single authority (ADR-2) | Substrate (ADR-3) | Local-first (ADR-5) | Evidence (ADR-10) | Verification at exit |
|---|---|---|---|---|---|---|
| T1 sign per-target binaries | CI/release tooling (`scripts/`, `.github/`) — no new L0–L6 module | reuses Phase-3 `build-matrix.ts`; no second builder | build matrix proven green (94 MiB, smoke PASS) | signing happens in CI; zero runtime deps | Rekor-verifiable `SHA256SUMS.bundle` per tag | per-target sha256 in signed sums; cosign verify-blob path documented + asserted in workflow test |
| T2 release-from-tag | `.github/workflows/release.yml` | one release pipeline (fix, don't fork) | truth-gate already enforced in CI | unchanged | tag → release proven by workflow structure + local release-dry-run test | workflow test: gates precede build; SLSA outputs wired; prerelease detection; dist-tag logic |
| T3 channels | `packaging/` generated configs + `scripts/channel-manifest.ts` (one generator) | one channel manifest model derived **from the release manifest + SHA256SUMS** | all artifacts are the canonical build — no per-channel rebuild | installs work offline from published assets | `channel:check` drift gate in CI + release gate | structural + effect tests per channel (formula fields, winget/scoop manifests, .deb ar-structure + payload hash) |
| T4 cross-platform parity | `.github/workflows/cross-platform.yml` + `test/platform/exclusions.json` (one exclusion manifest) | one parity computation (`scripts/platform-parity.ts`) used by all OS jobs | full suite proven green on Linux (2685 pass) | unchanged | exclusion list is a versioned, reasoned artifact | parity-script unit tests; workflow runs typecheck + (suite − exclusions) + golden path on 3 OS |
| T5 per-channel update/rollback | extend `src/update/` (existing L1 home) — no new module | reuses `selfheal.ts` state machine; adds `channels.ts` detection/delegation only | Phase-1 updater proven (update-uninstall tests green) | update sources are user-chosen channels; no new cloud dependency | forced-failure rollback tests per channel; checksum-verified binary path | `test/update/channels-update.test.ts` |
| T6 Public Beta | docs + manifest field + nightly jobs | Beta truth stamped from the ONE release manifest | measured golden path exists (Phase 1/8) | unchanged | install-success metric emitted as JSON artifact nightly; claim-lint scans the label | nightly beta survey on 3 OS; support matrix + limitations claiming exactly what CI proves |

## Decision-rule notes

- **ADR-8 (deletion budget):** this phase *removes* the unsigned/never-attached release path, removes
  the broken SLSA wiring, removes npm drift by fixing publication, and replaces hand-maintained
  changelog/known-limitations staleness with generated artifacts. Net surface added is release
  tooling (scripts/tests/docs), not product surface.
- **ADR-9 (performance):** no runtime code path is added to the boot sequence: channel detection runs
  only inside `xr update`/`xr uninstall`. Startup budgets untouched; `hot-path-lint` proves it.
- **ADR-11 (compatibility):** npm/git/binary layouts keep working; channel delegation is additive
  detection. No data migration. Installer fallback (binary → source) is preserved, now *verified*.
- **Rejected alternatives:**
  - *GoReleaser adoption* — rejected (R1: XR is Bun-based; would add a second build authority).
  - *Per-binary detached signatures as the primary unit* — rejected in favor of signing `SHA256SUMS`
    (R2 pattern; one identity, all artifacts) while *also* signing tarball + SBOM.
  - *`.rpm`/Snap channels* — rejected this phase: cannot be validated to the "supported = validated"
    bar without rpm/snapcraft toolchains; honestly deferred with a dated plan.
  - *Publishing via long-lived secrets everywhere* — rejected: OIDC keyless (cosign, npm trusted
    publishing, SLSA) is least-privilege; only GHCR/tap pushes use repo-scoped tokens with least perms.
  - *Claiming "triple-OS validated" from this branch* — rejected (Art. IX.4): the expanded parity
    jobs ship in this workflow; a GA/support-tier claim upgrades only after the jobs run green on
    the platform, which the support matrix states explicitly.

## Phase 0–8 non-regression commitments (test at exit)

`bun run ci` full chain green; full `bun test` green; golden-path green; `perf:gate` unaffected
(no hot-path changes); `claim-lint`/`release:check` extended and green; `supply-chain` suites green.
