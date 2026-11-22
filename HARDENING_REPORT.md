# XR stabilization & release-readiness hardening — final report

Repository `ahmadrrrtx/xr` (`@rrrtx/xr`) · 2026-11-19 → 2026-11-22 · label: **Public beta** (unchanged).
This report is rebuilt from [`HARDENING_LOG.md`](HARDENING_LOG.md), the evidence ledger. Every claim below points to a
commit, a test, or a CI run listed there. Anything not verified is marked as such.

## Outcome

- **Audit items:** B1–B20 and C1–C16 are fixed, already fixed at HEAD (with a lock-in test) or documented. Each code
  fix has a regression test that failed on the old code and passes on the new. C17 and C18 were assigned to no
  phase and are not covered.
- **Every phase ended green:** all six required checks passed on each phase head, and on 8 consecutive `main` runs.
- **Release: XR Preview 4 (`1.2.0-preview.4`) exists as a verified PRIVATE draft** on GitHub (tag
  `v1.2.0-preview.4` on `f2569d0`, release 454793101, 33 assets).
  - [Release run 45076830475](https://github.com/ahmadrrrtx/xr/actions/runs/45076830475) passed end to end: gates,
    four builds, assembly, cosign keyless signing, SLSA level-3 provenance, `verify-release.ts`, the draft and its
    asset-completeness gate.
  - [Desktop run 45076830152](https://github.com/ahmadrrrtx/xr/actions/runs/45076830152) built **unsigned**
    installers (owner decision): Windows x64 and arm64, macOS arm64 and x64 (ad-hoc sealed), and Linux `.deb`,
    `.rpm` and `.AppImage`. All seven desktop journeys passed, and it attached the installers with a cosign-signed
    `DESKTOP-SHA256SUMS` and a verified build-provenance attestation.
- **Nothing is public yet.** Publishing to GitHub and npm is the owner's step (see "Still open for the owner").
- **Two earlier preview tags were withdrawn** (`v1.2.0-preview.2`: NEW-12; `v1.2.0-preview.3`: NEW-17). Neither
  published anything; both are listed in `channels.withdrawnTags` and documented.
- **The label stays "Public beta":** launch gate XR-LAUNCH-012 needs 10 consecutive green `main` runs, and other
  gates are not green.

## Phases

Phases ran strictly in order: fix, local verification, commit, push, all six required checks green, then the next phase.
Run IDs for every head are in the ledger (`HARDENING_LOG.md` → "Phase ledger").

| Phase | Scope | Green head | CI-fix attempts |
|---|---|---|---|
| 0 | Recon and baseline (4972 pass / 29 skip / 0 fail) | `2b93d33` | 0 |
| 1 | Voice crash chain: B1, B15, B19, B20 | `97bd3b4` | 2 |
| 2 | Downloads: B2, B3/C2, B12 | `341e5b1` | 0 |
| 3 | Budget truth: B4, B5, B6, NEW-1 | `8bfc6ea` | 4 (4th owner-authorised) |
| 4 | Accounting: B7, B10, B18 | `8dd647a` | 0 (one rerun, NEW-10) |
| 5 | State performance: B8, B9, B11, B14 (+ size ceiling raise) | `9195707` | 4 (4th owner-authorised) |
| 6 | Daemon and workspace safety: B13, B17, C13 | `928e609` | 0 |
| 7 | Security sweep: C3–C8, lock-ins, C16 | `d1f7f6d` | 0 |
| 8 | CI policy, merge of PR #215, three green `main` runs | `23090ee`, `4ea49e2`, `1397292` | 1 (NEW-3) |
| 9 | Docs: CHANGELOG section, launch-gate evidence | `6a53e67` | 0 |
| 10 | Release: B16 (with C1) | `f2569d0` (PR #225, `main` run 8) + tag `v1.2.0-preview.4` | 6 (4th–6th owner-authorised) |
| 11 | This report | — | — |

## Defect register (audit items)

Status words follow the log: `fixed` = code + regression test + green CI; `already-fixed-at-HEAD` = verified in the
existing code, with a lock-in test; `documented` = a documentation correction; `not covered` = no phase addressed it.
Every fix's regression test failed on the old code and passes on the new (R2); the per-item R2 evidence is in the
phase sections of the log.

| ID | What was wrong | Fix | Regression test | Status |
|---|---|---|---|---|
| B1 | A voice download failure became an unhandled rejection; a non-Error throw or a throwing subscriber crashed the daemon | `6fe87e8` | `test/voice/crash-chain.test.ts` | fixed |
| B2 | Model downloads had no stall timeout, no deadline and no automatic retry | `7219c23` | `test/voice/download-resilience.test.ts` | fixed |
| B3 / C2 | Hugging Face URLs followed `resolve/main`; integrity was byte size only | `7219c23` (pinned commits, sha256 while streaming) | `test/voice/models.test.ts`, `test/voice/download-resilience.test.ts` | fixed |
| B4 | Price facts covered only OpenAI, Anthropic and Google, so most hosted presets' defaults were unpriced; every governor refusal was reported as a budget stop | `d0cebb3` (11 hosted defaults priced from official pages, 9 stale or nonexistent defaults moved to current models; a distinct `unpriced` stop) | `test/cost-budget-truth.test.ts` | fixed (Hugging Face and Bedrock defaults stay unpriced: known limitations, NEW-2) |
| B5 | Past `staleAt`, every price became unavailable | `d0cebb3` (last-known rates flagged `stale`; refusal is opt-in) | `test/cost-budget-truth.test.ts` | fixed |
| B6 | `monthly_cap: 0` silently blocked everything | `d0cebb3` (`confirmBlockAll` required) | `test/cost-budget-truth.test.ts` | fixed |
| B7 | Estimated and provider-reported spend were mixed without a rule | `acdd8da` (one documented rule: admission counts all spend, reporting separates it) | `test/state/accounting-truth.test.ts` | fixed |
| B8 / B14 | The audit chain was verified twice per `Store`, and a new `Store` was built per call | `94474b7` (single verifier, checkpoint) | `test/state/state-performance.test.ts` | fixed |
| B9 | No index for the spend window queries | `94474b7` (two additive indexes) | `test/state/state-performance.test.ts` | fixed |
| B10 | Reservations had no heartbeat; long tasks could lose theirs | `acdd8da` (ALTER-guarded `last_heartbeat_at`) | `test/state/accounting-truth.test.ts` | fixed |
| B11 | `getStore(id)` forced the workspace id `default` | `94474b7` | `test/state/state-performance.test.ts` | fixed |
| B12 | The tar extractor was synchronous and mis-parsed pax, GNU long names and base-256 sizes | `7219c23` | `test/voice/tar.test.ts` | fixed |
| B13 | The chat route's history bound was duplicated, and an audit write after `done` could emit a failure after success | `a63ad32` | `test/one-agent/chat-route.test.ts` | fixed |
| B15 | A second download request rejected inside a detached promise | `6fe87e8` (typed admission) | `test/voice/crash-chain.test.ts` | fixed |
| B16 (with C1) | `v1.1.0` shipped only 5 unsigned desktop bundles; no verifiable CLI release existed | Phase 10 (see Outcome) | `test/release/*` | fixed: a verified private draft (`v1.2.0-preview.4`); public promotion is the owner's |
| B17 | Deleting a workspace removed a database that another process could have open | `a63ad32` (migration lock + liveness probe) | `test/state/workspace-delete.test.ts` | fixed |
| B18 | The first-step cost estimate priced everything at the output rate | `acdd8da` | `test/cost.test.ts` | fixed |
| B19 | The wasm recognizer stream leaked on error paths | `6fe87e8` (`try/finally`) | `test/voice/crash-chain.test.ts` | fixed |
| B20 | Auto TTS selection probed the native binding twice | `6fe87e8` | `test/voice/crash-chain.test.ts` | fixed |
| C3 | Obfuscated shell commands (decoders piped into a shell, `eval` of a decode) passed the guard | `dba65dc` | `test/security/obfuscation.test.ts` | fixed |
| C4 | Plugin isolation (probed with escape tests; found NEW-5) | `c3a6e09` | `test/plugins/worker-escape.test.ts` | fixed |
| C5 | Secret-store health in `xr doctor` | already in place (lock-in `dcf954d`) | `test/security/secret-keychain.test.ts` | already-fixed-at-HEAD |
| C6 | Audit-key theft and offline anchors were undocumented | `dcf954d` | — (`docs/security/AUDIT-EVIDENCE.md`) | documented |
| C7 | `KNOWN_LIMITATIONS.md` contradicted the default-off env hydration | `dcf954d` (row 4 corrected) | claim-lint | fixed |
| C8 | Untrusted-content scanning missed obfuscated injections | `dba65dc` | `test/security/obfuscation.test.ts` | fixed |
| C9–C12, C14, C15 | Covered by lock-in tests already present, re-checked green in Phase 7: tar `..`/symlink/hardlink rejection; stranger silence in the Telegram, Discord and WhatsApp bots; private and raw-IP egress; approver identity | — | named in the Phase 7 section of the log | already-fixed-at-HEAD |
| C13 | Cookie-authenticated mutations without an allowed Origin | already in place | `test/daemon/origin-host-guard.test.ts` | already-fixed-at-HEAD |
| C16 | Dependency audit | `dcf954d` (live audits of all lockfiles; build-only advisories documented with expiring ignores) | Supply Chain gate | documented |
| C17, C18 | — | — | — | **not covered** (assigned to no phase in the preserved plan) |

The mission file itself is not in the repository; the log never restates C1's original wording, which always travelled
with B16. The row above describes what was delivered for the pair.

## New defects found during the work

| ID | What | Fix | Status |
|---|---|---|---|
| NEW-1 | `checkBudget` compared a percentage with fractions (95% warning at ~1% spend); a 0 cap divided by zero | `d0cebb3` | fixed |
| NEW-2 | The AWS Bedrock default maps to a retired Claude id, so it stays unpriced | — | open, documented in the known limitations |
| NEW-3 | Windows CLI journey: in binary mode the installer's `Move-Item -Force` failed while the file was briefly in use ("being used by another process"); in npm mode `xr status` failed once after `xr update`, cause unknown | binary `8d1b98b` (`Move-XrItemWithRetry`) | binary fixed; npm mode open |
| NEW-4 | One `test/environment` test fails only when the whole directory runs in one Bun process | — | pre-existing, logged only |
| NEW-5 | The plugin worker loader passed a `file://` string, so every "isolated" plugin fell back to the in-process VM | `c3a6e09` | fixed |
| NEW-6 | The overview route waited on `git status` with a cold cache | `beebd2c` | fixed |
| NEW-7 | The Windows desktop shell aborted at startup (Tauri builds windows before the setup hook) | `fdee0b2` | fixed |
| NEW-8 | Desktop shell-test timeout (isolation probes on the boot path) | `dac8ba4` | fixed |
| NEW-9 | The first PowerShell 7 process on the Ubuntu runner can take more than 15 s | `d75a553` | fixed |
| NEW-10 | windows-latest WebDriver session intermittently not created | — | open (its first occurrence got R7's one rerun) |
| NEW-11 | Retired npm 3.x versions carry deprecation messages pointing at `@beta`, so Channel Live is red | — | owner-blocked; the owner chose to leave it |
| NEW-12 | The release gates ran without the Linux isolation the Truth gate provisions | `aac7944` | fixed (held on the preview.3 tag run) |
| NEW-13 | The asset-completeness gate could not find a draft release | `bf261ef` | fixed (the preview.4 release job found the draft and passed L-010) |
| NEW-14 | The windows-arm64 release build | `275be64` | fixed (held on the preview.3 tag run) |
| NEW-15 | macOS launcher-test fixture race (PID file written before the TERM trap) | `0ca9015` | fixed |
| NEW-16 | Windows signing takes a `.pfx`, which CAs no longer issue | — | owner action, only for a signed stable tag |
| NEW-17 | `verify-release` could not read the Sigstore bundle that slsa-github-generator v2.1.0 writes | `0f0d378` | fixed (`verify-release.ts` passed on the preview.4 tag run) |
| NEW-18 | RUSTSEC-2026-0592 (published 2026-11-22) in the locked `url 2.5.8` | `367288e` | fixed (Supply Chain green on PR #225 and `main`) |

## Launch gates (`docs/release/launch-gates.json`)

None was marked green without evidence. Current state:

- `fixed-unverified`: XR-LAUNCH-001, 002, 003, 004, 005, 006, 007, 009, 010.
- `in-progress`: XR-LAUNCH-008 (desktop signing, notarization and signed updater; previews now ship unsigned by owner
  decision, so signing stays owner-blocked for a stable tag), XR-LAUNCH-011 (hardware evidence), XR-LAUNCH-012
  (release gates; it asks for 10 consecutive green `main` runs, and there are 8).
- `open`: PHASE-3-REAUDIT (a fresh launch re-review).

## Owner decisions and actions

Decided by the owner during the work (each is a row in the log's adaptations table):

- Size ceiling raised by 500 to 177,000 lines (2026-11-19). Giant waived files still may not grow.
- Phase 10 version choice delegated (2026-11-19) → the 1.2.0-preview line.
- Fourth CI-fix attempts for Phases 3 and 5 (2026-11-20); fourth, fifth and sixth for Phase 10 (2026-11-21/22).
- Merge of PR #215; tags only for a verified private draft; `v1.2.0-preview.2` and `v1.2.0-preview.3` withdrawn,
  never reused, deleted or moved.
- The two missing required checks were added to ruleset 19119579 by the owner in the web UI (the agent's API call
  was refused with 403).
- `npm deprecate` for the five retired 3.x versions (NEW-11): left as is.
- **Unsigned preview installers** (2026-11-21): no budget for certificates. Previews ship unsigned Windows installers
  and an ad-hoc sealed macOS app; stable tags still require signing.

Still open for the owner:

1. **Promote the private draft** when ready: Actions → Release → Run workflow with `publish=true`. That also publishes
   to npm through OIDC. This session cannot do either (403).
2. **After a preview is public:** prepend the SUPERSEDED note to the v1.1.0 release.
3. **Free Windows signing later:** apply to SignPath Foundation once Preview 4 has some public use
   (`docs/release/DESKTOP_SIGNING.md`).
4. **Optional:** `npm deprecate` fixes for NEW-11 (`bun run npm:ghosts -- --print-commands`), a Tauri updater key.

## Not covered or not verified

- C17 and C18: assigned to no phase.
- Gate XR-LAUNCH-012: 8 of the 10 consecutive green `main` runs it requires.
- `docs/release/TEST-BASELINE.json` was not refreshed (R6 keeps tests to per-directory batches).
- Nothing ran on physical hardware: every desktop and CLI journey ran on CI runners. The Gatekeeper "Open Anyway"
  path and SmartScreen "Run anyway" were not exercised on a real machine.
- The draft's `SHA256SUMS`, `DESKTOP-SHA256SUMS` and cosign bundles were verified by the tag runs themselves (the
  sign job's fail-closed re-verification, `verify-release.ts`, the desktop job's cosign verification and attestation
  check). They were not re-downloaded and re-checked from this sandbox, because release-asset downloads are
  unreachable here.

## Process notes

- R7 held throughout: every CI-fix attempt beyond three was owner-authorised, recorded as a HALT section with the
  decision needed, and resumed only after the owner's answer.
- One process deviation: Phases 6–7 were pushed early on `07ee114` while Phase 5 was red. They were reverted at once
  (`6221984`, `a5504ce`, `536b661`, `bccb51b`) and re-landed in order.
- Tags: a tag always runs its own commit's workflow, so a failed tag can never pass. The two failed preview tags were
  withdrawn through `channels.withdrawnTags` and documented, never moved or deleted.
- From this sandbox, job logs, artifacts and release assets are unreachable (blob storage). Failures were diagnosed
  through the job-steps and annotations APIs, the advisory databases, and the owner reading a log once.

## How to verify

```bash
bun install --frozen-lockfile
bun run typecheck && bun run release:check && bun run channel:check && bun run claim-lint && bun run changelog:check
for d in release supply-chain voice state security plugins daemon; do bun test "test/$d"; done   # one directory per process
gh run list --branch main --limit 20          # required checks on main
gh release list --limit 10                    # the private draft (needs push access to see drafts)
GH_TOKEN="$(gh auth token)" bun run scripts/release-assets-check.ts --tag v1.2.0-preview.4
```

Downloads of a release are checked with `SHA256SUMS` and its cosign bundle, as described in
[`docs/release/VERIFYING_RELEASES.md`](docs/release/VERIFYING_RELEASES.md); desktop installers with
`DESKTOP-SHA256SUMS`, as described in [`docs/release/DESKTOP_SIGNING.md`](docs/release/DESKTOP_SIGNING.md).
