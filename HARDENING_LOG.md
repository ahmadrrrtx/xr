# XR stabilization & release-readiness hardening — running log

Mission brief: external audit, defects **B1–B20** and security findings **C1–C18**.
Every line below is either evidence (command output, commit, test path, CI run URL) or is
explicitly marked as not verified. Status words: `fixed` (code + regression test + green CI),
`fixed-unverified` (code + test, CI pending), `already-fixed-at-HEAD` (verified in current code,
lock-in test added where missing), `owner-blocked`, `out-of-scope-feature`, `open`.

## Adaptations forced by repository reality (read first)

| Brief assumption | Reality at `main` @ `cd21cd5` (2026-11-19) | What this log does |
|---|---|---|
| Work on branch `hardening/stabilize` | This session is bound to branch `arena/68fa6c7d-xr`; creating/pushing another branch is not permitted here | All phases land on `arena/68fa6c7d-xr`, one PR to `main` |
| Repo is at 1.1.0; Phase 10 bumps to 1.1.1 | `release.manifest.json` identity is **1.2.0-preview.1** ("XR Preview 1", `public-beta`); `channels.publicVersion` is 1.0.0; v1.1.0 is a documented withdrawn tag (`docs/release/1.1.0/WITHDRAWN.md`). A 1.1.1 tag would sort **below** the current identity, and versions are stamped from the manifest (`bun run release:stamp`), never hand-edited in `package.json` | Phase 10 is held for an explicit owner decision (see Phase 10 section); nothing is tagged or published without it |
| Line numbers from the audit | Several items have moved or were already fixed (C13, B13 history bound); each item was re-verified against HEAD below | Recon table records the HEAD state per item |
| Size discipline not mentioned | `bun run size-gate`: tree **176,055 / 176,500 LOC (99.7%)**, waived giants may never grow (`workspace-store.ts` +10 lines of room, `interfaces/shell/app.ts` +0, `core/agent.ts` +17) | Fixes are written line-neutral where they touch waived giants; any ceiling move is a reasoned, dated comment in `scripts/size-gate.ts` (the repo's own mechanism) and needs maintainer sign-off |
| Tree ceiling 176,500 would not hold Phases 3–7 | Measured: Phase 1 +143, Phase 2 +156 (local); Phases 3–7 estimated at +250–450 against 146 remaining | **Owner (ahmadrrrtx) approved +500 → 177,000 on 2026-11-19** in this session. It lands as its own dated, reasoned commit in `scripts/size-gate.ts` (the gate's documented mechanism) together with Phase 5, the first phase whose tree exceeds 176,500 (planned for the start of Phase 3; Phases 3 and 4 fit under the old ceiling, at 176,424 and 176,480), docs markers re-stamped; waived giants still may not grow; each phase's measured LOC is logged |
| Phase 10 version choice | 1.1.1 would sort below the current 1.2.0-preview.1 identity | **Owner delegated the choice on 2026-11-19.** Decision: release **1.2.0-preview.2** through `release.manifest.json` + `bun run release:stamp` + the existing release workflow, only if every required check and the workflow's own gates are green and the full asset suite is produced; npm only via OIDC, desktop signing owner-blocked; otherwise nothing is published and Phase 10 records why |
| R7: three CI-fix attempts per phase, then halt | Phase 3 halted on 2026-11-20 after three attempts, with every targeted failure fixed and one intermittent left (NEW-9) | **Owner (ahmadrrrtx) authorised one fourth Phase 3 attempt on 2026-11-20** (the NEW-9 PowerShell fix as proposed: telemetry and update check off, 15 s bound unchanged) and kept every other rule: Phases 4–11 have the normal three attempts each, one rerun per first-occurrence flake, a repeat is a defect |
| R7 again: Phase 5 halted after three attempts | NEW-7 (the desktop shell aborts at startup) was root-caused on the third attempt; the fix was ready but would have been a fourth | **Owner (ahmadrrrtx) authorised one fourth Phase 5 attempt on 2026-11-20** (the NEW-7 fix as proposed) and again kept every other rule: Phases 6–11 have the normal three attempts each |
| Merging PR #215 and pushing a release tag | Both change shared state that is hard to undo; the brief lists the merge (Phase 8) and the release (Phase 10) | **Owner (ahmadrrrtx) approved on 2026-11-21:** merge PR #215 with a merge commit once Phase 7 is green (done: `23090ee`); in Phase 10, push tag `v1.2.0-preview.2` for a verified PRIVATE draft only; the SUPERSEDED note on v1.1.0 is applied only once 1.2.0-preview.2 is public |

## Phase 0 — NOTES (exact commands)

- Toolchain: Bun **1.4.2** (`.bun-version`, `packageManager: bun@1.4.2`; installed from the npm
  `@oven/bun-linux-x64@1.4.2` tarball because GitHub release assets are unreachable from this sandbox).
- Install: `bun install --frozen-lockfile` (root, 94 packages) and `cd desktop && bun install --frozen-lockfile --ignore-scripts`
  (typecheck includes `desktop/tsconfig.json`, so desktop deps are required).
- Typecheck: `bun run typecheck` = `scripts/typecheck-preflight.ts && tsc --noEmit && tsc -p desktop/tsconfig.json`.
- Truth gates: `bun run claim-lint`, `bun run release:check`, `bun run channel:check`, `bun run changelog:check`.
- Contract: `bun run api:schema:check` / `api:schema:generate`, `bun run client:check` / `client:generate`, `bun run api:compat`.
- Architecture: `bun run boundaries` (dependency-cruiser), `bun run size-gate`, `bun run hot-path-lint`, `bun run ownership:check`.
- Fast loop: `bun run unit-tier`. Whole battery: `bun run ci`.
- Test layout: `bunfig.toml` sets `root = "test"` and preloads `test/helpers/suite-tmp.ts`; `test/` mirrors
  `src/` (e.g. `test/voice`, `test/state`, `test/daemon`, `test/security`, `test/trust`, `test/providers`,
  `test/core`) plus top-level `test/*.test.ts`. 567 test files.
- CI lanes (`.github/workflows/ci.yml`): typecheck, truth-gate, baseline, website, vscode-extension,
  test-core (parity runner, excludes security/trust/capabilities/reliability/e2e-blackbox), test-security,
  test-reliability-spawn, test-e2e-blackbox, boundaries, api-contract, a11y, profiling, mutation-gate,
  perf-gate, unit-tier → aggregated by **Quality Gate**. Advisory: quarantine, e2e-blackbox-proof.
- Required checks (`.github/required-checks.json`): Quality Gate, Cross-Platform gate, Supply Chain gate,
  npm Pack Smoke gate, Desktop gate (bundles + latest.json + journey), Clean-Machine Journey gate.
- Swap: 4 GiB swapfile enabled in the sandbox (3.8 GiB RAM).

## Phase 0 — baseline (local, `main` @ `cd21cd5`)

| Check | Result |
|---|---|
| `bun run typecheck` | exit 0 (44 s) |
| `bun run claim-lint` | exit 0 — "no unsupported claims · 20 evidenced claims · v1.2.0-preview.1" |
| `bun run size-gate` | pass — 176,055 of 176,500 LOC |
| `bun test test/voice test/voice.test.ts test/voice-presets.test.ts` | 82 pass / 0 fail |
| `bun test test/state` | 62 pass / 0 fail |
| `bun test test/core` | 121 pass / 0 fail |
| `bun test test/providers` | 141 pass / 0 fail |
| `bun test test/cost.test.ts test/cost-adversarial.test.ts` | 11 pass / 0 fail |
| `bun test test/daemon` | 379 pass / 0 fail |
| `main` CI on `cd21cd5` | required workflows green: CI 44418953400, Cross-Platform 44418953490, Supply Chain 44418953504, npm Pack Smoke 44418953439, Journey 44418953396, Desktop App 44418953399. Non-gating red: Channel Live 44418953446, Real-Device Matrix 44425842301 |

## Recon — every item re-verified against HEAD

| ID | HEAD state (evidence) |
|---|---|
| B1 | **Confirmed.** `voice.routes.ts` `void s.downloader.start(entries).finally(...)` has no `.catch`; `native.ts` catch does `(e as Error).message.slice(0, 80)`; `VoiceSession.emit` loops subscribers without try/catch; no `unhandledRejection` handler anywhere in `src/` |
| B2 | **Confirmed.** `VoiceDownloader.fetchFile` has no stall timeout, no deadline, no automatic retry (resume only on the next manual attempt) |
| B3 | **Confirmed.** Every Hugging Face URL uses `resolve/main`; integrity is byte-size only |
| B4 | **Confirmed.** `model-facts.json` prices 9 of 11 rows (openai/anthropic/google only); `agent.ts` maps every governor refusal to `stopped:"budget"` and fires `fail` with hard-coded "budget ceiling reached; no raise granted" |
| B5 | **Confirmed.** `staleAt: 2027-02-11T00:00:00Z`; `priceFor` returns UNAVAILABLE when `!modelFactsFresh(now)` |
| B6 | **Confirmed.** `BudgetManager.getConfig()` defaults `monthly_cap: 10.0`; per-task `maxUsd` 0 = disabled, global `monthly_cap` 0 = block-all |
| B7 | To verify in Phase 4 (`getSpendForPeriod` sums `usd` regardless of `usage_source`) |
| B8 / B14 | **Confirmed.** `Store` constructor: `this.verifyChain().valid ? null : (this.verifyChain().brokenAt ?? null)`; `WorkspaceManager.getStore` builds a new `Store` per call |
| B9 | **Confirmed.** No index on `cost_events(created_at)` / `cost_events(session_id)` |
| B10 / B18 | To verify in Phase 4 (reservation TTL sweep; first-step estimate uses output rate only — confirmed in `governor.ts`) |
| B11 | **Confirmed.** `getStore(id)` → `new Store(ctx.dbPath)` → legacy path branch forces `workspaceId = "default"` |
| B12 | **Confirmed.** `extractNpmTarball`: sync `gunzipSync`, ignores pax (`x`/`g`) and GNU (`L`) long names, base-256 sizes parse as NaN |
| B13 | **Partly stale.** The 24 turns / 24k chars bound exists in `src/core/agent-history.ts` (the route pre-filters to 64). Confirmed: `result.finalMessage.slice(0, 200)` runs in the audit write AFTER the terminal `done` frame; a throw there emits `GENERATION_FAILED` after success |
| B15 | **Confirmed.** Route checks `busy()` then `start()` re-checks and throws `download-busy` |
| B16 | **Confirmed.** Release `v1.1.0` assets: 5 desktop bundles only; npm dist-tags `latest=1.0.0`, `beta=1.0.0-beta.1` |
| B17 | **Confirmed.** `deleteWorkspace` unlinks DB + `rmSync` root with no lock or liveness check |
| B19 | **Confirmed.** `recognize()` frees the stream only on the success path (and never on the unreadable-wav early return) |
| B20 | **Confirmed.** `tts.ts` `selectEngine` auto branch calls `loadNativeVoice` twice |
| C13 | **Already fixed at HEAD.** `server.ts` `originAllowed` (Phase 4 · T5) refuses cookie-authenticated mutating requests without an allowed Origin; covered by `test/daemon/origin-host-guard.test.ts` |
| C7 | **Confirmed drift.** `KNOWN_LIMITATIONS.md` row 4 says keys "remain hydrated into process.env"; `src/security/env-compat.ts` is default-OFF (row 30 documents the default correctly) |
| NEW-1 | **New defect.** `BudgetManager.checkBudget` compares `percentUsed` (0–100, see `getStatus`) with fractions 0.95/0.8/0.5, so "95% of monthly cap used" fires at ~1% spend; `monthly_cap: 0` divides by zero |

## Phase ledger

| Phase | Commit(s) | CI run(s) | Status |
|---|---|---|---|
| 0 — recon/baseline | `2b93d33` | CI [44499926066](https://github.com/ahmadrrrtx/xr/actions/runs/44499926066) ✓ · Cross-Platform [44499925774](https://github.com/ahmadrrrtx/xr/actions/runs/44499925774) ✓ · Supply Chain [44499925608](https://github.com/ahmadrrrtx/xr/actions/runs/44499925608) ✓ · npm Pack Smoke [44499925659](https://github.com/ahmadrrrtx/xr/actions/runs/44499925659) ✓ · Journey [44499926003](https://github.com/ahmadrrrtx/xr/actions/runs/44499926003) ✓ · Channel Install [44499925804](https://github.com/ahmadrrrtx/xr/actions/runs/44499925804) ✓ · Desktop App [44499925653](https://github.com/ahmadrrrtx/xr/actions/runs/44499925653) ✓ | **done** — all 6 required checks pass on PR #215 (82 checks pass, 1 skipped by design: "Real channel installs of the public version") |
| 1 — voice crash chain (B1 B15 B19 B20) | `6fe87e8` (+ CI diagnostics `f13a309` `42e13ec` `515a3bd`) | head `97bd3b4`: CI [44629362347](https://github.com/ahmadrrrtx/xr/actions/runs/44629362347) ✓ · Cross-Platform [44629362352](https://github.com/ahmadrrrtx/xr/actions/runs/44629362352) ✓ · Desktop App [44629362192](https://github.com/ahmadrrrtx/xr/actions/runs/44629362192) ✓ · Journey [44629362281](https://github.com/ahmadrrrtx/xr/actions/runs/44629362281) ✓ · npm Pack Smoke [44629362260](https://github.com/ahmadrrrtx/xr/actions/runs/44629362260) ✓ · Supply Chain [44629362046](https://github.com/ahmadrrrtx/xr/actions/runs/44629362046) ✓ · Channel Install [44629362279](https://github.com/ahmadrrrtx/xr/actions/runs/44629362279) ✓ | **done**: all 6 required checks pass on one head (82 pass, 1 skipped by design) |
| 2 — downloads (B2 B3/C2 B12) | `7219c23` (+ log `341e5b1`) | head `341e5b1`: CI [44636377949](https://github.com/ahmadrrrtx/xr/actions/runs/44636377949) ✓ · Cross-Platform [44636377917](https://github.com/ahmadrrrtx/xr/actions/runs/44636377917) ✓ · Desktop App [44636377958](https://github.com/ahmadrrrtx/xr/actions/runs/44636377958) ✓ · Journey [44636378005](https://github.com/ahmadrrrtx/xr/actions/runs/44636378005) ✓ · npm Pack Smoke [44636377856](https://github.com/ahmadrrrtx/xr/actions/runs/44636377856) ✓ · Supply Chain [44636377919](https://github.com/ahmadrrrtx/xr/actions/runs/44636377919) ✓ · Channel Install [44636377864](https://github.com/ahmadrrrtx/xr/actions/runs/44636377864) ✓ | **done**: all 6 required checks pass (82 pass, 1 skipped by design) |
| 3 — budget truth (B4 B5 B6 NEW-1) | `d0cebb3` (+ CI fixes `7b4b719`, `beebd2c`, `dac8ba4`, `d75a553`; diagnostics `d46ee7b`) | head `8bfc6ea`: CI [44780370623](https://github.com/ahmadrrrtx/xr/actions/runs/44780370623) ✓ · Cross-Platform [44780370742](https://github.com/ahmadrrrtx/xr/actions/runs/44780370742) ✓ · Desktop App [44780370923](https://github.com/ahmadrrrtx/xr/actions/runs/44780370923) ✓ · Clean-Machine Journey [44780370700](https://github.com/ahmadrrrtx/xr/actions/runs/44780370700) ✓ · npm Pack Smoke [44780370889](https://github.com/ahmadrrrtx/xr/actions/runs/44780370889) ✓ · Supply Chain [44780370632](https://github.com/ahmadrrrtx/xr/actions/runs/44780370632) ✓ · Channel Install [44780370922](https://github.com/ahmadrrrtx/xr/actions/runs/44780370922) ✓. History: the Phase 3 CI sections below (four CI-fix attempts, the fourth owner-authorised) | **done**: all 6 required checks pass on one head (84 pass, 1 skipped by design) |
| 4 — accounting (B7 B10 B18) | `acdd8da` | head `8dd647a`: CI [44792959241](https://github.com/ahmadrrrtx/xr/actions/runs/44792959241) ✓ · Cross-Platform [44792959329](https://github.com/ahmadrrrtx/xr/actions/runs/44792959329) ✓ · Desktop App [44792959554](https://github.com/ahmadrrrtx/xr/actions/runs/44792959554) ✓ · Clean-Machine Journey [44792959439](https://github.com/ahmadrrrtx/xr/actions/runs/44792959439) ✓ · npm Pack Smoke [44792959392](https://github.com/ahmadrrrtx/xr/actions/runs/44792959392) ✓ · Supply Chain [44792959372](https://github.com/ahmadrrrtx/xr/actions/runs/44792959372) ✓ · Channel Install [44792959409](https://github.com/ahmadrrrtx/xr/actions/runs/44792959409) ✓ (the `db3ee5f` run: NEW-10, rerun) | **done**: all 6 required checks pass on one head (84 pass, 1 skipped by design) |
| 5 — state performance (B8 B9 B11 B14) + ceiling raise | `94474b7` (raise `3609352`; CI fix `6381ac0`; diagnostics `c6b4030`, `a3eb0fb`; NEW-7 fix `fdee0b2`) | head `9195707`: CI [44887694266](https://github.com/ahmadrrrtx/xr/actions/runs/44887694266) ✓ · Cross-Platform [44887694147](https://github.com/ahmadrrrtx/xr/actions/runs/44887694147) ✓ · Desktop App [44887694249](https://github.com/ahmadrrrtx/xr/actions/runs/44887694249) ✓ · Clean-Machine Journey [44887694111](https://github.com/ahmadrrrtx/xr/actions/runs/44887694111) ✓ · npm Pack Smoke [44887694137](https://github.com/ahmadrrrtx/xr/actions/runs/44887694137) ✓ · Supply Chain [44887694173](https://github.com/ahmadrrrtx/xr/actions/runs/44887694173) ✓ · Channel Install [44887694190](https://github.com/ahmadrrrtx/xr/actions/runs/44887694190) ✓. History: the Phase 5 CI sections below (four CI-fix attempts, the fourth owner-authorised) | **done**: all 6 required checks pass on one head (85 pass, 1 skipped by design) |
| 6 — daemon and workspace safety (B13 B17 C13) | `a63ad32` | head `928e609`: CI [44890244897](https://github.com/ahmadrrrtx/xr/actions/runs/44890244897) ✓ · Cross-Platform [44890244913](https://github.com/ahmadrrrtx/xr/actions/runs/44890244913) ✓ · Desktop App [44890244875](https://github.com/ahmadrrrtx/xr/actions/runs/44890244875) ✓ · Clean-Machine Journey [44890244883](https://github.com/ahmadrrrtx/xr/actions/runs/44890244883) ✓ · npm Pack Smoke [44890244866](https://github.com/ahmadrrrtx/xr/actions/runs/44890244866) ✓ · Supply Chain [44890244847](https://github.com/ahmadrrrtx/xr/actions/runs/44890244847) ✓ · Channel Install [44890244867](https://github.com/ahmadrrrtx/xr/actions/runs/44890244867) ✓ | **done**: all 6 required checks pass on one head (85 pass, 1 skipped by design) |
| 7 — security sweep (C3–C8, lock-ins, C16) | `dba65dc` `c3a6e09` `dcf954d` | head `d1f7f6d`: CI [44892794288](https://github.com/ahmadrrrtx/xr/actions/runs/44892794288) ✓ · Cross-Platform [44892794304](https://github.com/ahmadrrrtx/xr/actions/runs/44892794304) ✓ · Desktop App [44892794282](https://github.com/ahmadrrrtx/xr/actions/runs/44892794282) ✓ · Clean-Machine Journey [44892794346](https://github.com/ahmadrrrtx/xr/actions/runs/44892794346) ✓ · npm Pack Smoke [44892794255](https://github.com/ahmadrrrtx/xr/actions/runs/44892794255) ✓ · Supply Chain [44892794294](https://github.com/ahmadrrrtx/xr/actions/runs/44892794294) ✓ · Channel Install [44892794245](https://github.com/ahmadrrrtx/xr/actions/runs/44892794245) ✓ | **done**: all 6 required checks pass on one head (85 pass, 1 skipped by design) |
| 8 — CI: actionlint, required-check names, merge, 3 green `main` runs | merge `23090ee` (PR #215) | `main` run 1 on `23090ee`: in progress | in-progress |

## Phase 1 — voice crash chain (B1, B15, B19, B20) · commit `6fe87e8`

| ID | Fix | Regression test (`test/voice/crash-chain.test.ts` unless noted) | Status |
|---|---|---|---|
| B1 | `describeThrown()` (new `src/util/thrown.ts`) is total for any thrown value and replaces `(e as Error).message.slice(…)` in the native probe; `VoiceSession.deliver()`/`emit()` isolate a throwing subscriber (audited once, `voice.subscriber.error`); a bundle's `done` promise never rejects (an inner throw becomes a terminal `status:"error"` record, `voice.download.failed`); a failing post-download reconfigure is contained (`voice.download.reconfigure_failed`); `installProcessGuards()` (new `src/daemon/process-guards.ts`) records an unhandled rejection as `daemon.unhandled_rejection` instead of letting it kill the daemon — installed in `serve()`, released in `stop()` | "thrown values of any shape…", "native probe survives a non-Error throw…" (string, number), "VoiceSession.emit isolates subscribers", "a bundle's completion promise never rejects" (3 tests), "process-level guard" (3 tests, child processes; one is a control showing the original crash) | fixed-unverified |
| B15 | `VoiceDownloads.start()` is synchronous and returns a typed admission: `{started:true, done}` or `{started:false, reason:"busy", current}` — it no longer rejects with `download-busy` inside the route's detached promise. The route maps `!started` to the unchanged 409 body `{error:"download-busy", download}` (no API contract / generated-client change, R9) | "concurrent download starts get a typed busy result" (fails on old code: `start()` rejected). The HTTP test "two concurrent POSTs: one 200, one typed 409" is a **contract lock-in**, not the R2 proof: it passes on old code too, because the old route's `busy()` check and `start()` ran in one synchronous turn (verified by running it against the `2b93d33` sources) | fixed-unverified |
| B19 | `recognize()` frees the wasm stream in `try/finally` | "the wasm recognizer stream is freed on every path" (3 tests) | fixed-unverified |
| B20 | `selectEngine` auto branch probes the native loader once (`nativeProbe()`, injectable `nativeLoader`) | "auto TTS selection probes the native binding once…" | fixed-unverified |

- **Deliberate contract change (B15):** `start()` changed from `Promise<void>` that rejects on busy to a
  synchronous typed result. `test/voice/download-bundle.test.ts` asserted the old rejection
  (`rejects.toThrow('download-busy')`); it was **converted** to assert the typed busy result plus that the first
  bundle still completes — the same behaviour checked at the new contract, not weakened.
- **R2 evidence:** with the six touched `src/` files reverted to `2b93d33` (`git stash push -- <files>`), the first
  15 crash-chain tests gave 5 pass / 10 fail. The 5 that pass on old code are the new-module unit tests, the B19
  success path and the control test that demonstrates the original crash; every defect test fails.
- **Local verification:** `bun test test/voice test/voice.test.ts test/voice-presets.test.ts` 98 pass / 0 fail
  (baseline 82 + 16); `bun test test/daemon` 379 pass / 0 fail; `bun run typecheck` exit 0; `bun run claim-lint` ✓;
  `bun run boundaries` 0 errors (1 warning, `no-orphans: src/cost/pricing-types.ts`, identical on `main`).
- **Size:** tree 176,055 → 176,198 (+143) of 176,500. `daemon/server.ts` 873 → 876 (waiver 878): +3 lines for
  the guard import, install and release. No other waived module touched.

### Phase 1 CI — Clean-Machine Journey failure on `3f0f839`

- Failed job: **`CLI journey — npm on windows-latest`**, step `Journey`, annotation "Process completed with exit
  code 1". The other 17 CLI journeys (including npm on windows-11-arm, binary on windows-latest, and npm/binary on
  every Linux and macOS runner) and both Docker journeys passed. CI (Quality Gate), Supply Chain, npm Pack Smoke
  and Channel Install passed on the same head.
- The raw job log and the `journey-evidence-cli-npm-windows-latest` artifact are served from
  `*.blob.core.windows.net`, which this sandbox cannot reach, so the exact failing journey step is unknown.
- Phase 1 changes nothing on that lane's path (npm pack → global npm install → launch → one-shot agent run →
  `xr update` → uninstall): the voice modules are not loaded and the process guard is only installed by
  `serve()`. Over the previous 25 journey runs this job never failed (earlier journey failures were gate-only).
- R7 allows one flaky rerun, but the rerun API returns `403 Resource not accessible by integration` for this
  token (`gh run rerun` and `POST …/rerun-failed-jobs`). The rerun is therefore this docs-only commit, which
  re-runs every workflow on a new head. If the same job fails again it is treated as a defect, not a flake.

### Phase 1 CI — second journey failure on `55fa18a` (now treated as a defect, NEW-3)

- [44510462453](https://github.com/ahmadrrrtx/xr/actions/runs/44510462453): this time **`CLI journey — binary on
  windows-latest`** failed (npm on windows-latest passed). Its `Journey` step failed after 25 s (passing runs take
  33–40 s). The first failure (npm, run 44508641214) came after 85 s (passing runs take 92–120 s). Both are late in the
  journey, where `update` and `uninstall --purge` run; Windows-only, intermittent, and a different channel each time.
- Same head: **Cross-Platform [44510462269](https://github.com/ahmadrrrtx/xr/actions/runs/44510462269) passed on
  Linux, macOS and Windows full parity** (typecheck + whole suite + golden path), so the Phase 1 code itself runs on
  Windows. CI, Supply Chain, npm Pack Smoke and Channel Install also passed.
- R7: a repeat failure is a defect, not a flake. It is logged as **NEW-3 (open)**: "windows-latest CLI journey fails
  intermittently in its late steps". The raw log is unreachable from here, so CI-fix attempt **1 of 3** for Phase 1 is
  diagnostic: `scripts/journey/cli-journey.ts` now also emits the failing step, its message and the runner image as a
  GitHub `::error` annotation, which `GET /repos/{owner}/{repo}/check-runs/{id}/annotations` returns. The same edit
  makes that catch block total (`(e as Error).message.slice` threw on a non-Error). No assertion, retry or timeout
  changed.

### Phase 1 CI on `c67285d` — journey green; one macOS timing failure

- Green: CI [44512363457](https://github.com/ahmadrrrtx/xr/actions/runs/44512363457), Supply Chain
  [44512363535](https://github.com/ahmadrrrtx/xr/actions/runs/44512363535), npm Pack Smoke
  [44512363745](https://github.com/ahmadrrrtx/xr/actions/runs/44512363745), Channel Install
  [44512363511](https://github.com/ahmadrrrtx/xr/actions/runs/44512363511), and **Clean-Machine Journey
  [44512363760](https://github.com/ahmadrrrtx/xr/actions/runs/44512363760), all 18 CLI journeys including both
  windows-latest ones**. NEW-3 did not recur, so it stays open as an intermittent with annotations in place.
- Cross-Platform [44512365989](https://github.com/ahmadrrrtx/xr/actions/runs/44512365989): Linux and Windows full parity
  passed. **macOS** failed one test, read from the check annotations:
  `test/perf/daemon-routes.test.ts` "/api/overview stays lightweight (< 500 ms CI tolerance)" took 659 ms. That route
  shells out to `git` and touches no Phase 1 code (no voice, and the process guard is installed only by `serve()`, not
  by the `makeHandler` the test uses). The identical Phase 1 code passed the same test on every OS on `55fa18a`, and
  the runner reported macOS capacity constraints. Treated as a first-occurrence timing flake; the threshold is not
  touched (R1). This docs commit is its rerun; a repeat is a defect.

### Phase 1 CI on `85cf8b0` — 5 of 6 required checks green; Desktop failed before the journey ran

- Green: Quality Gate (CI [44516596852](https://github.com/ahmadrrrtx/xr/actions/runs/44516596852)), Cross-Platform gate
  ([44516596688](https://github.com/ahmadrrrtx/xr/actions/runs/44516596688); Linux, macOS and Windows full parity, so the
  macOS timing failure did not recur), Clean-Machine Journey gate
  ([44516596947](https://github.com/ahmadrrrtx/xr/actions/runs/44516596947); all CLI journeys, including both windows-latest),
  Supply Chain gate, and npm Pack Smoke gate.
- Desktop App [44516596994](https://github.com/ahmadrrrtx/xr/actions/runs/44516596994): all bundles built.
  `Desktop journey — linux-x64 on ubuntu-24.04` failed in step 5, **"WebDriver prerequisites (Linux — WebKitWebDriver +
  Xvfb + tauri-driver)"**, after 20 minutes with exit code **100** (apt-get's failure code). The journey itself
  never started, and the macOS arm64 journey was queued on runner capacity and then cancelled. This is infrastructure,
  not XR code. Both the rerun and the dispatch APIs return 403 for this token, so this docs commit re-runs CI.
- Still outstanding for Phase 1: **one completed Desktop gate** on Phase 1 code. Earlier Desktop runs on `3f0f839`,
  `55fa18a` and `c67285d` were superseded before finishing. Phase 1 stays fixed-unverified until a single head has all
  six required checks green.

### Phase 1 CI on `6ab3a1c` (docs-only head)

- Green: Supply Chain, npm Pack Smoke, Channel Install. Red in CI [44524275761](https://github.com/ahmadrrrtx/xr/actions/runs/44524275761):
  - **Accessibility** failed at "Install Playwright chromium (headless)", a browser download; no XR code ran.
  - **Truth gate** failed in `bun run security:check` with only "exit code 1" visible. The same Phase 1 code passed this
    gate on every earlier head, and locally the online dependency audit passes (35 + 286 production packages, 0 findings).
- CI-fix attempt **2 of 3** for Phase 1 (diagnostic): `scripts/verify-security.ts` now emits each FAIL/BLOCKED/NOT RUN
  stage (name, status, exit code, detail) as a GitHub `::error` annotation, readable via the check-run API. No stage,
  threshold or exit semantics changed.

### Phase 1 CI on `42e13ec`

- Green: Quality Gate (CI [44525744871](https://github.com/ahmadrrrtx/xr/actions/runs/44525744871); the Truth gate and Accessibility jobs that failed on
  `6ab3a1c` passed), Clean-Machine Journey [44525744702](https://github.com/ahmadrrrtx/xr/actions/runs/44525744702), npm Pack Smoke
  [44525744852](https://github.com/ahmadrrrtx/xr/actions/runs/44525744852), Supply Chain [44525744758](https://github.com/ahmadrrrtx/xr/actions/runs/44525744758), Channel Install [44525744779](https://github.com/ahmadrrrtx/xr/actions/runs/44525744779).
- Red, Cross-Platform [44525744774](https://github.com/ahmadrrrtx/xr/actions/runs/44525744774): Linux and macOS passed. Windows full parity failed one test,
  `test/reliability/agent-benchmark.test.ts` "all15 actual verifiers pass…": the benchmark child exited 1, and which
  scenario failed is not visible. The same test passed on Windows with identical Phase 1 code on `55fa18a`, `c67285d`
  and `85cf8b0`.
- Red, Desktop App [44525744690](https://github.com/ahmadrrrtx/xr/actions/runs/44525744690): `Desktop journey — windows-x64 on windows-latest` failed in its
  `Journey` step after 89 s (exit 1, no detail). The Linux and macOS desktop journeys passed. On `85cf8b0` the Windows
  desktop journey had passed, and Linux failed at its apt prerequisites.
- Required checks on Phase 1 code so far (green / red; superseded runs not counted):

  | Check | Green | Red (cause) |
  |---|---|---|
  | Quality Gate | 5 | 1 (`6ab3a1c`: Playwright browser download; `security:check` unknown) |
  | Cross-Platform gate | 2 | 2 (macOS route timing; Windows agent benchmark) |
  | Supply Chain gate | 6 | 0 |
  | npm Pack Smoke gate | 6 | 0 |
  | Clean-Machine Journey gate | 3 | 2 (Windows CLI journey: npm, then binary) |
  | Desktop gate | 0 | 2 (Linux apt exit 100; Windows journey). Each OS's journey has passed at least once |
- No red check points at Phase 1 code (voice, process guard, download admission), but no single head has had all six
  green either. Diagnostics in this commit (no assertion, threshold, timeout or retry changed): the desktop journey
  emits its failing step as a check annotation, and the agent-benchmark test names the failing scenarios in its error.

### Phase 1 CI on `97bd3b4` — all six required checks green (Phase 1 done)

CI [44629362347](https://github.com/ahmadrrrtx/xr/actions/runs/44629362347), Cross-Platform [44629362352](https://github.com/ahmadrrrtx/xr/actions/runs/44629362352) (Linux, macOS and Windows full
parity), Desktop App [44629362192](https://github.com/ahmadrrrtx/xr/actions/runs/44629362192) (bundles, `latest.json` and all desktop journeys), Clean-Machine
Journey [44629362281](https://github.com/ahmadrrrtx/xr/actions/runs/44629362281), npm Pack Smoke [44629362260](https://github.com/ahmadrrrtx/xr/actions/runs/44629362260), Supply Chain
[44629362046](https://github.com/ahmadrrrtx/xr/actions/runs/44629362046) and Channel Install [44629362279](https://github.com/ahmadrrrtx/xr/actions/runs/44629362279) all passed; `gh pr checks 215` shows 82
pass and 1 skipped by design. The intermittent Windows failures seen on earlier heads (NEW-3) did not recur; NEW-3
stays open, with step annotations in the CLI journey, desktop journey and agent benchmark. Three diagnostic commits were
made along the way and no assertion, threshold, timeout or retry was changed.

## Phase 2 — downloads (B2, B3/C2, B12) · commit `7219c23`

| ID | Fix | Regression test | Status |
|---|---|---|---|
| B2 | New `src/voice/fetch-file.ts`: a stall watchdog (30 s with no byte, headers included), a hard per-file deadline across attempts (15 min; `XR_VOICE_FILE_DEADLINE_MS`), and 3 bounded retries with exponential backoff that resume the `.part` with `Range`. A terminal failure deletes the `.part` and the bundle reports `status:"error"`; a user cancel keeps the `.part`. 5xx/408/429/network errors retry; other 4xx do not | `test/voice/download-resilience.test.ts` against a **local `Bun.serve` fixture**: stall → abort → `Range` resume; a trickling server hits the deadline; 503 ×4 bounded ("gave up after 4 attempts"); 404 not retried; 502 → success; cancel during a stall keeps the `.part` | fixed-unverified |
| B3 / C2 | Every Hugging Face URL is pinned to a commit SHA (6 repos), and all 30 catalogue files carry a sha256 verified **while streaming** (a resumed prefix is hashed first). `bytes` is the progress total plus a cheap early refusal | `models.test.ts` "B3: every URL is an immutable revision and every file has a pinned sha256"; download-resilience: same-size corrupt bytes are refused with nothing installed or stranded; a corrupt resumed prefix restarts once from zero | fixed-unverified |
| B12 | New `src/voice/tar.ts`: async gunzip (threadpool) and async writes; pax `x` path/size, GNU `L` long names, base-256 sizes; an entry size past the archive is refused; `g`/`K` are consumed and never applied. The `..`/symlink/hardlink rejection is kept exactly, plus a resolved-path containment check. `writeFully` loops short writes | `test/voice/tar.test.ts`: 6 new-behaviour tests and 3 lock-ins (plain/prefix `..`, pax/GNU `..`, symlink/hardlink/fifo/dir); `writeFully` unit tests | fixed-unverified |

- **Pins and hash provenance** (2026-11-19). Revisions come from `https://huggingface.co/api/models/<repo>/revision/main`:
  STT `e8add537…`, lessac (espeak data) `83f74707…`, kusal `54090df5…`, kristin `6fdc6824…`, ryan `2784cf0f…`,
  amy `79936839…`.
  - LFS weights (7): sha256 = the `lfs.oid` from `/api/models/<repo>/tree/<sha>`.
  - Non-LFS files (13 espeak, 4 `.onnx.json`, 3 distinct `tokens.txt`): bytes fetched through the GitHub blob API,
    `git hash-object` equal to the HF tree `oid` and size equal to the catalogue, then `sha256sum`.
  - npm runtime: the downloaded tarball's sha512 equals the registry `dist.integrity` and its sha1 equals `dist.shasum`.
  - Result: 30/30 files backed (23 by bytes, 7 by first-party LFS records), 0 unbacked. The values live in
    `src/voice/models.ts`.
- **Real-artifact check:** the new extractor's output for `sherpa-onnx-1.13.8.tgz` is byte-identical to GNU `tar` (13/13 files).
- **R2:** with `src/voice/models.ts` reverted to the Phase 1 version (the new modules left on disk), 14 of the 28
  touched tests fail. The 14 that pass are the lock-ins (by design), behaviours the old code already had (404 not
  retried, cancel keeps `.part`), and the unit tests of the new `writeFully`.
- **Local verification:** voice 118/0 (98 + 20), daemon 379/0, typecheck 0, claim-lint ✓, boundaries 0 errors.
- **Size:** tree 176,198 → 176,354 (+156); `models.ts` 366 → 312, `fetch-file.ts` 124, `tar.ts` 86. No waived module touched.

### Phase 2 CI on `341e5b1` — all six required checks green (Phase 2 done)

- Green on the first push, every workflow: CI [44636377949](https://github.com/ahmadrrrtx/xr/actions/runs/44636377949), Cross-Platform [44636377917](https://github.com/ahmadrrrtx/xr/actions/runs/44636377917), Desktop App [44636377958](https://github.com/ahmadrrrtx/xr/actions/runs/44636377958), Clean-Machine Journey [44636378005](https://github.com/ahmadrrrtx/xr/actions/runs/44636378005), npm Pack Smoke [44636377856](https://github.com/ahmadrrrtx/xr/actions/runs/44636377856), Supply Chain [44636377919](https://github.com/ahmadrrrtx/xr/actions/runs/44636377919), Channel Install [44636377864](https://github.com/ahmadrrrtx/xr/actions/runs/44636377864).
  No CI-fix attempt used.
- This note was added late, with the Phase 8 evidence; the phase ledger row already carries these links.

## Phase 3 — budget truth (B4, B5, B6, NEW-1) · commit `d0cebb3`

| ID | Fix | Regression test (`test/cost-budget-truth.test.ts` unless noted) | Status |
|---|---|---|---|
| B4 | 11 hosted defaults priced in `model-facts.json` from official pages, each with `price.source` (table below). 9 stale or nonexistent defaults moved to current models; Perplexity's base URL moved to its Orchestrator API. A distinct **`unpriced`** stop state end to end: the governor decision and `ProviderBudgetAdmissionError` carry `code:"unpriced"`, and the agent then returns `stopped:"unpriced"`, emits stream status `unpriced_stopped`, offers **no** budget raise, and fires the task `fail` event with the decision's **own** reason (the hardcoded "budget ceiling reached; no raise granted" is gone). CLI `describeStop`, TUI, desktop chat, the multi-agent `honestStopCheck` (which counted an unpriced worker as success), the workflow runtime (which treated `unpriced` as success), `ux-status` and the `finishReason` contract description are updated. Bots render `finalMessage` plus `stopped`, so they show `unpriced` with the real reason | table-driven test over all 16 hosted `PRESETS`; agent runs: price refusal → `unpriced`, no raise, task reason = decision reason; genuine budget stop → task reason = decision reason; CLI and supervisor wording | fixed-unverified |
| B5 | `priceFor` past `staleAt` keeps the last-known rates flagged `stale`; `XR_STALE_PRICE_FACTS=refuse` is the operator's explicit opt-in to refusal. A `pricing.facts_stale` audit event fires on every governed request, a one-time admission warning appears in the run, and `xr doctor` shows a "Model price facts" check | B5 group (stale → available + flagged; refuse opt-in; one-time notice; doctor) | fixed-unverified |
| B6 | `POST /api/budget/set` refuses `monthlyCap: 0` without `confirmBlockAll: true` (new optional contract field; OpenAPI regenerated, typed client unchanged). Dashboard and onboarding ask before saving 0, and the desktop's local-only mode sends the confirmation. Onboarding copy states the $10 default is already in force; `xr budget status` and `xr doctor` say whether the cap is XR's default or explicit. `docs/budget-semantics.md` is the single place for what 0 means (global = block-all, per-task = no cap) | B6 group (HTTP 400 without the flag, 200 with it; default/explicit wording) | fixed-unverified |
| NEW-1 | `BudgetManager.checkBudget` compared `percentUsed` (0–100) with fractions, so "95% of monthly cap used" fired at ~1% spend; a 0 cap divided by zero | NEW-1 group | fixed-unverified |

**Hosted preset defaults and their official price sources** (USD per MTok, fetched 2026-11-19)

| Preset | Default model | In / Out | Source |
|---|---|---|---|
| groq | `openai/gpt-oss-20b` | 0.075 / 0.30 | console.groq.com/docs/model/openai/gpt-oss-20b |
| google | `gemini-3.8-flash` | 0.75 / 3.75 (until 2026-12-31) | unchanged |
| deepseek | `deepseek-flash` (was `deepseek-chat`, no longer listed) | 0.30 / 1.20 (peak; off-peak half) | api-docs.deepseek.com/quick_start/pricing |
| cerebras | `gpt-oss-120b` (was `cerebras/csm-8b`, not served) | 0.35 / 0.75 | cerebras.ai/pricing |
| openrouter | `anthropic/claude-sonnet-5.5` (claude-3.5-sonnet has 0 endpoints) | 2 / 10 | openrouter.ai/api/v1/models/…/endpoints |
| together | `openai/gpt-oss-120b` (Llama-3.3-70B-Turbo not served) | 0.15 / 0.60 | docs.together.ai/docs/serverless/models |
| mistral | `mistral-small-2603` (dated id; `-latest` alias not priced) | 0.15 / 0.60 | docs.mistral.ai/models/mistral-small-4-0-26-03 |
| fireworks | `accounts/fireworks/models/gpt-oss-120b` | 0.15 / 0.60 | docs.fireworks.ai/serverless/pricing |
| sambanova | `gpt-oss-120b` (Llama-3.1-70B not listed) | 0.22 / 0.59 | cloud.sambanova.ai/plans/pricing |
| huggingface | `meta-llama/Llama-3.1-8B-Instruct` | **unpriced** — the router bills each routed provider's own rate | huggingface.co/docs/inference-providers/pricing |
| openai | `gpt-6-luna` | 0.10 / 0.50 | unchanged |
| anthropic | `claude-sonnet-5-5` | 2 / 10 | unchanged |
| cohere | `command-r-plus-08-2024` (still Live) | 2.50 / 10 | cohere.com/pricing (legacy-model FAQ) |
| xai | `grok-4.7` (was `grok-2-latest`, not listed) | 2 / 6; ≥200k input ×2 | docs.x.ai/developers/models |
| perplexity | `perplexity/glm-5.3-flash` (Sonar models retired; Orchestrator API) | 0.15 / 0.50 | docs.perplexity.ai/docs/orchestrator/models |
| bedrock | `claude-3-sonnet` | **unpriced** — see NEW-2 | — |

- **NEW-2 (open):** the Bedrock default maps to a retired `anthropic.claude-3-sonnet-20240229-v1:0`. The current
  `anthropic.claude-sonnet-5-5` is invocable only through `us.`/`eu.`/`global.` inference profiles, which
  `src/providers/native/bedrock.ts` cannot address. Changing the default needs adapter work and AWS-credentialed
  verification, so it is not changed blind; the preset stays unpriced (stops as `unpriced`) and is in known-limitations.
- The 11 pre-existing facts were not re-verified today, so the file-wide `verifiedAt`/`staleAt` are unchanged and only
  `version` moved to `2026-11-19.1`.
- **R2** (a probe run against a detached worktree at the Phase 2 head vs this commit):

  | Defect | Old | New |
  |---|---|---|
  | B4 unpriced hosted defaults | 13 of 16 | 2 of 16 (huggingface, bedrock) |
  | B4 unpriced run | `stopped: "budget"`, task reason "budget ceiling reached; no raise granted" | `stopped: "unpriced"`, task reason = the refusal's own text |
  | B5 price past `staleAt` | unavailable (every paid run blocked) | available, flagged stale |
  | B6 `POST /api/budget/set {monthlyCap: 0}` | HTTP 200 | HTTP 400 `confirm-block-all` |
  | NEW-1 1% of the cap spent | warning "95% of monthly cap used" | no warning |
- **Converted tests:** these are deliberate contract changes, not weakened assertions.
  - `native-continuation` (B5): stale is now available and flagged; the refusal is still asserted under the opt-in.
  - `pricing-v1.json`: `registry-expired` → `registry-stale-keeps-last-known-rates` at $0.0006.
  - `selection-accounting`: the catalog quote at the stale date is $0.0006; `tighteningPatch` to 0 now sends `confirmBlockAll`.
  - `offline-onboarding-budget`: tighten-only to 0 is now 400 without the flag and 200 with it, which is stronger.
  - `dashboard-split`: re-pinned `aef98f81…` → `9b158be1…`, proven to be the only delta by reverting three files.
- **Converted verifier:** `scripts/agent-benchmark-runner.ts` scenario A11 asserted an unavailable USD rate stops as
  `budget`. It now asserts `unpriced`, keeping the guarantee that matters (`provider.calls === 0`: nothing is sent).
  Found by the local `security:check` (`agent-smoke` and `test/reliability/agent-benchmark.test.ts`).
- **NEW-4 (pre-existing, logged only):** `test/environment/service.test.ts` "never-execute-risky refuses…" fails
  (`blocked` vs `denied`) when the whole `test/environment` directory runs in one Bun process. It fails identically on
  the Phase 1 head, and passes alone and in CI's parity runner.
- **Size:** tree +65; `agent.ts` 1198 → 1200 (waiver 1215); `shell/app.ts` line-neutral.

### Phase 3 CI on `5103ae5` — two red workflows; CI-fix attempt 1 of 3

- Green: CI [44641444320](https://github.com/ahmadrrrtx/xr/actions/runs/44641444320), Supply Chain [44641444307](https://github.com/ahmadrrrtx/xr/actions/runs/44641444307), npm Pack Smoke
  [44641444311](https://github.com/ahmadrrrtx/xr/actions/runs/44641444311), Channel Install [44641444261](https://github.com/ahmadrrrtx/xr/actions/runs/44641444261) and Clean-Machine Journey
  [44641444293](https://github.com/ahmadrrrtx/xr/actions/runs/44641444293) (NEW-3 did not recur).
- **Desktop App [44641444363](https://github.com/ahmadrrrtx/xr/actions/runs/44641444363):** the Linux Rust job passed `cargo check` and `clippy -D warnings` but
  failed `cargo test` (exit 101); the Windows `cargo test` job failed too. The Rust shell reads two Phase 3 files through
  `include_str!`: `model-facts.json` and the shared vector file. `shared_dated_pricing_vectors` priced the B5 vector
  `registry-stale-keeps-last-known-rates` as unavailable, because the native governor (`governor.rs` `priced_at`) still
  returned NaN past `staleAt`. That is a real gap in the Phase 3 fix, not a test problem: past the review date the
  desktop's native admission would still have refused every paid call. **Fix `7b4b719`:** the native governor applies
  the engine's rule (last-known rates; `XR_STALE_PRICE_FACTS=refuse` opts into refusal) and mirrors the Grok 4
  long-prompt tier. The shared vectors gain both sides of that tier, so TS and Rust are pinned together. The same commit
  reads the engine's opt-in through `globalThis.process?.env`: the desktop webview imports `src/cost/pricing.ts` and has
  no `process` global outside a Vite build. Its new test fails on the Phase 3 code with "undefined is not an object
  (evaluating 'process.env')". Rust cannot be built here (R6), so CI verifies the Rust side; the expected values were
  cross-checked with a line-by-line mirror of `priced_at` (0.0006, 0.405998, 0.812).
- **Cross-Platform [44641444350](https://github.com/ahmadrrrtx/xr/actions/runs/44641444350):** Linux and Windows passed. macOS failed only "/api/overview stays
  lightweight (< 500 ms)", at 861 ms. That is the second failure on this branch (659 ms on `c67285d`), and the same test
  failed on other branches (685 ms in run [43937582977](https://github.com/ahmadrrrtx/xr/actions/runs/43937582977), 509 ms in run
  [43889333388](https://github.com/ahmadrrrtx/xr/actions/runs/43889333388)). Under R7 a repeat flake is a defect: **NEW-6**. The route awaited `git rev-parse` and
  `git status --porcelain` (a working-tree walk) on the request path whenever its 5 s cache was cold. Locally the cold
  route takes about 19 ms and about 4 ms with git pre-warmed, so git is roughly 80% of it; on hosted Windows the same wait
  is why that platform's bound is 2 s. **Fix `beebd2c`:** the overview never waits on git. `observeGitSummary` reports
  `pending` while one background probe runs, serves the last summary while it refreshes, and keeps the legacy
  `{ branch: "no git" }` value as `unavailable`. The 500 ms bound is unchanged. R2: against the old route the new
  held-probe test sees the response held for more than 1 s.
- Both fixes go out in one push: CI-fix attempt 1 of 3 for Phase 3. Local verification: typecheck 0; perf 129/0, daemon
  379/0, api 116/0, observability and ux 112/0, desktop 702/0, scripts and architecture 88/0, `daemon.test` and
  `cost-budget-truth` 54/0; claim-lint, boundaries (the pre-existing warning only), api:schema, ownership, hot-path and
  ci:policy clean. Tree 176,419 → 176,423 of 176,500.

### Phase 3 CI on `fb3163f` — 6 of 7 green; Windows desktop journey failed (NEW-7); CI-fix attempt 2 of 3

- Green: CI [44726307269](https://github.com/ahmadrrrtx/xr/actions/runs/44726307269), **Cross-Platform [44726307211](https://github.com/ahmadrrrtx/xr/actions/runs/44726307211)** (macOS passed the unchanged
  500 ms overview bound with NEW-6 in place), Clean-Machine Journey [44726307146](https://github.com/ahmadrrrtx/xr/actions/runs/44726307146), npm Pack Smoke
  [44726307303](https://github.com/ahmadrrrtx/xr/actions/runs/44726307303), Supply Chain [44726307091](https://github.com/ahmadrrrtx/xr/actions/runs/44726307091), Channel Install [44726307374](https://github.com/ahmadrrrtx/xr/actions/runs/44726307374).
- Desktop App [44726307130](https://github.com/ahmadrrrtx/xr/actions/runs/44726307130): **both Rust jobs passed** (Linux `cargo check`, `clippy -D warnings` and
  `cargo test`; Windows `cargo test`), so the B5 parity fix `7b4b719` holds on the native side. All five bundles built, the
  linux, darwin-x64, darwin-arm64 and windows-arm64 desktop journeys passed and `latest.json` assembled. Only
  **Desktop journey — windows-x64** failed, in `launch`: "the app's engine sidecar never answered /api/v1/health within
  60 s [exit running; output: (none)]". The webview had rendered; the bracket is tauri-driver's output, so the failure
  says nothing about the sidecar itself.
- **NEW-7 (open):** this is the second Windows x64 desktop journey failure on this branch (`42e13ec` failed in the same
  step after 89 s, before the launch annotation existed). The journey passed on `2b93d33`, `85cf8b0`, `97bd3b4` and
  `341e5b1`, and in every run on `main` and the other branches since 2026-11-13 (about 15 runs). The failing heads share
  only Phase 1 code with the passing heads `97bd3b4` and `341e5b1`. Before `serve` binds, the sidecar runs nothing
  unbounded that Phase 1–3 touched: the Phase 1 guard only registers an `unhandledRejection` listener, and secret
  warm-up is capped at 5 s. The launch step runs the installed `xr-engine --version` before the GUI starts, so a
  first-execution antivirus scan should already be paid. That leaves a slow or stuck sidecar, or the journey's
  `Get-NetTCPConnection` port probe not seeing it, and the old message cannot tell these apart.
- **Attempt 2 (`d46ee7b`), diagnostics only:** no assertion, bound, timeout, retry or polling change. A launch failure
  now reports the number of OS port probes, the slowest probe, the last port and health result and the last probe output,
  plus the shell's own `engine_link` view (reachable, spawned, port, token presence, reason, containment, stderr tail).
  The token is never copied, and a unit test runs the webview script against a fake `engine_link` that returns one.
  This push is also the rerun. If NEW-7 recurs, the message names the cause; that would be attempt 3, the last
  before R7's halt.

### Phase 3 CI on `8b2b1a3` — 5 of 6 required checks green; one first-occurrence PowerShell timeout (rerun)

- Green: **Desktop App [44734448535](https://github.com/ahmadrrrtx/xr/actions/runs/44734448535)** (both Rust jobs, all five bundles, all seven desktop journeys
  **including windows-x64**, `latest.json`), Cross-Platform [44734448356](https://github.com/ahmadrrrtx/xr/actions/runs/44734448356), Clean-Machine Journey
  [44734448426](https://github.com/ahmadrrrtx/xr/actions/runs/44734448426), npm Pack Smoke [44734448510](https://github.com/ahmadrrrtx/xr/actions/runs/44734448510), Supply Chain [44734448635](https://github.com/ahmadrrrtx/xr/actions/runs/44734448635),
  Channel Install [44734448523](https://github.com/ahmadrrrtx/xr/actions/runs/44734448523). NEW-7 did not recur; it stays open as an intermittent, and the new
  diagnostics will name its cause if it does.
- Red: CI [44734448320](https://github.com/ahmadrrrtx/xr/actions/runs/44734448320), job `test / core`, one test:
  `test/release/windows-installers-negative.test.ts` "missing or duplicate installer inputs fail closed: empty". The
  script under test had already printed its expected refusal ("result FAIL - exactly one MSI and one NSIS installer are
  required"), but the PowerShell 7 process on the Ubuntu runner did not exit within the test's 15 s `spawnSync` bound
  (`ETIMEDOUT`). It is the first `pwsh` start in that process. Nothing in Phases 1–3 touches PowerShell, the installer
  script or `test/release`, and the identical test passed on every earlier head of this branch. The same test failed the
  same way on another branch on 2026-11-13 (run [43441796218](https://github.com/ahmadrrrtx/xr/actions/runs/43441796218), `release/audit-fixes`). It is treated as
  a first-occurrence flake on this branch: this docs-only commit is its one rerun (reruns through the API are refused
  with 403), the 15 s bound is not touched (R1), and a repeat is a defect.

### Phase 3 CI on `9bb1010` — 5 of 6 required checks green; one first-occurrence timeout in a desktop shell test (rerun)

- Green: **CI [44741467463](https://github.com/ahmadrrrtx/xr/actions/runs/44741467463)** (the PowerShell test passed on rerun), Cross-Platform
  [44741467474](https://github.com/ahmadrrrtx/xr/actions/runs/44741467474), Clean-Machine Journey [44741467621](https://github.com/ahmadrrrtx/xr/actions/runs/44741467621), npm Pack Smoke
  [44741467477](https://github.com/ahmadrrrtx/xr/actions/runs/44741467477), Supply Chain [44741467475](https://github.com/ahmadrrrtx/xr/actions/runs/44741467475), Channel Install [44741467534](https://github.com/ahmadrrrtx/xr/actions/runs/44741467534).
- Red: Desktop App [44741467604](https://github.com/ahmadrrrtx/xr/actions/runs/44741467604). In the Linux Rust job, `cargo check`, `clippy` and `cargo test` passed;
  the following "Shell tests" step failed one test, `test/desktop/full-engine-catalog.test.ts`: its fixture child died
  on `TimeoutError: The operation timed out.`, the 3 s client timeout of one of its loopback requests. Bundles and
  journeys were then skipped. The head differs from `8b2b1a3`, where the same job and test passed, only in this log.
  The test has no earlier failure in the last 60 Desktop App runs. Timing each request of that fixture locally gives
  the same profile on `9bb1010` and on the base `cd21cd5`. The slowest request is `POST /providers/custom`, the first
  one that starts the app container: 255–321 ms on `9bb1010` against 344–486 ms on the base, so it is not a regression.
  It is treated as a first-occurrence flake: this docs-only commit is its one rerun, the 3 s bound is not touched
  (R1), and a repeat is a defect.

### Phase 3 CI on `789cc47` — the desktop shell-test timeout repeated (NEW-8); CI-fix attempt 3 of 3

- Green: CI [44743964232](https://github.com/ahmadrrrtx/xr/actions/runs/44743964232), Cross-Platform [44743963987](https://github.com/ahmadrrrtx/xr/actions/runs/44743963987), Clean-Machine Journey
  [44743964197](https://github.com/ahmadrrrtx/xr/actions/runs/44743964197), npm Pack Smoke [44743963937](https://github.com/ahmadrrrtx/xr/actions/runs/44743963937), Supply Chain [44743963934](https://github.com/ahmadrrrtx/xr/actions/runs/44743963934),
  Channel Install [44743964158](https://github.com/ahmadrrrtx/xr/actions/runs/44743964158).
- Red: Desktop App [44743964067](https://github.com/ahmadrrrtx/xr/actions/runs/44743964067), the same test as on `9bb1010`
  (`test/desktop/full-engine-catalog.test.ts`, `TimeoutError`). Under R7 a repeat is a defect: **NEW-8**.
- **Evidence:** the fixture child's request log is part of the check annotation on both heads. Health, the three
  version handshakes, `/providers` and `/providers/catalog` each answered in 0–5 ms. The next request,
  `POST /providers/custom`, never answered within the 3 s client timeout. It is the first request that boots the app
  container (`agentExecutor.ensureApp()`).
- **Cause:** kernel init (`TrustService.onInit`) awaited `EnvironmentManager.init()`, which ran every isolation probe
  one after another: `docker info` (8 s budget, then `podman info`), and the bwrap and unshare self-checks (5 s plus
  10 s budgets). A slow `docker info` on hosted runners is already documented in
  `test/trust/adapters-risk.test.ts`. CI's `test / core` lane runs the same test and passed on both heads. Only the
  desktop job installs the WebKit packages, which bring bubblewrap and so the extra bwrap self-check.
- **Reproduced locally:** with a stand-in `docker` that takes 4 s, the old code fails this exact test with the same
  `TimeoutError` after 3.45 s, and the fixed code passes in 0.7 s.
- **Fix `dac8ba4`:** the probes run concurrently and concurrent callers share one detection run. Kernel init only starts
  detection. `evaluate()` awaits it before any placement decision, so decisions only ever see completed detection and
  fail closed exactly as before. `ensureReady()` is unchanged, and every synchronous reader (`xr trust`, `/api/trust`)
  already calls it first. The new `test/trust/detection-off-boot-path.test.ts` covers this, and both of its tests fail
  on the old code. No bound was changed: the fixture's 3 s timeout and every probe budget stand.
- Local verification: typecheck 0; trust 144/0, execution 155/0, core and one-agent 140/0, desktop 702/0, daemon 379/0,
  perf 129/0, reliability 109/0, security 420/0, context 316/0, phase0 and phase2 273/0, api, observability and ux
  228/0, bots and voice 244/0, research, cloud and state 174/0, capabilities and control 169/0, architecture 135/0;
  boundaries, claim-lint, ownership, hot-path and ci:policy clean. Tree 176,423 → 176,424 of 176,500.
- **This is Phase 3's third and last CI-fix attempt (R7).** Attempts so far: 1 `7b4b719` + `beebd2c`, 2 `d46ee7b`,
  3 `dac8ba4`. The `9bb1010` and `789cc47` pushes were reruns for first-occurrence flakes. If this head is not fully
  green because of a fix that did not hold, work stops here with this log as the report.

### Phase 3 CI on `1f15f51` — NEW-8 fix held; two Windows failures; R7 attempt limit reached

- Green: **Desktop App [44748738547](https://github.com/ahmadrrrtx/xr/actions/runs/44748738547)**: the Linux Rust job's shell tests, including
  `full-engine-catalog`, passed, as did both Rust jobs, all five bundles, all seven desktop journeys and `latest.json`.
  The NEW-8 fix held. Also green: CI [44748738514](https://github.com/ahmadrrrtx/xr/actions/runs/44748738514), npm Pack Smoke [44748738442](https://github.com/ahmadrrrtx/xr/actions/runs/44748738442), Supply
  Chain [44748738678](https://github.com/ahmadrrrtx/xr/actions/runs/44748738678), Channel Install [44748738515](https://github.com/ahmadrrrtx/xr/actions/runs/44748738515) and the non-gating OS sandbox
  workflow [44748738597](https://github.com/ahmadrrrtx/xr/actions/runs/44748738597), which ran because `src/runtime/trust` changed.
- Red, Cross-Platform [44748738656](https://github.com/ahmadrrrtx/xr/actions/runs/44748738656): Linux and macOS passed. Windows failed one test,
  `test/reliability/migration-race.test.ts` "16 processes opening one fresh DB → 0 migration races, 0 lost writes":
  the workers reported 314 of 320 writes. This is SQLite contention between 16 processes on the Windows runner; the
  test touches only `src/state`. Nothing on this head changed `src/state` (NEW-8 is in `src/runtime/trust`, and the
  workers boot no kernel). This test has no earlier failure in the last 60 Cross-Platform runs: a first-occurrence flake.
- Red, Clean-Machine Journey [44748738499](https://github.com/ahmadrrrtx/xr/actions/runs/44748738499): **NEW-3 again** (third occurrence, after `3f0f839` and
  `55fa18a`), `CLI journey — npm on windows-latest`. The Phase 1 annotation now names the step: in `update`, after
  `xr update --yes`, `xr --version` reported N+1 but `xr status --json` exited 1. The exit code comes from the required
  installation checks (`platform`, `bun`, `package-manager`, `config`, `audit`). The 300-character tail in the
  annotation does not show which one failed. The other 17 CLI journeys passed.
- **R7 status:** Phase 3 has used its three CI-fix attempts (`7b4b719` + `beebd2c`, `d46ee7b`, `dac8ba4`). Each targeted
  failure has stayed fixed on every later head: the Rust shared pricing vector, the macOS overview bound, the Windows
  desktop journey (no recurrence) and the catalog timeout. Every required check has passed on Phase 3 code, but never
  all six on one head (`8b2b1a3` 5/6, `9bb1010` 5/6, `789cc47` 5/6, `1f15f51` 4/6). No fourth fix is made: NEW-3 stays
  open, and nothing is changed for the `migration-race` flake.
- This docs-only commit is the one rerun R7 allows for the first-occurrence `migration-race` failure. If its head
  comes back with all six required checks green, Phase 3 meets its acceptance rule and NEW-3 stays open with its
  diagnostics, as after Phase 1. Otherwise work halts at Phase 3, with this log as the report, until the owner decides.

### Phase 3 CI on `a0943a7` — every job that ran passed; two macOS arm64 jobs never got a runner

- Green: CI [44755775953](https://github.com/ahmadrrrtx/xr/actions/runs/44755775953), **Cross-Platform [44755775530](https://github.com/ahmadrrrtx/xr/actions/runs/44755775530)** (Windows `migration-race`
  passed on its rerun), npm Pack Smoke [44755775704](https://github.com/ahmadrrrtx/xr/actions/runs/44755775704), Supply Chain [44755775420](https://github.com/ahmadrrrtx/xr/actions/runs/44755775420), Channel
  Install [44755775735](https://github.com/ahmadrrrtx/xr/actions/runs/44755775735) and OS sandbox (non-gating) [44755775502](https://github.com/ahmadrrrtx/xr/actions/runs/44755775502).
- Clean-Machine Journey [44755776155](https://github.com/ahmadrrrtx/xr/actions/runs/44755776155): every CLI and Docker journey that ran passed, **including npm on
  windows-latest** (NEW-3 did not recur). The gate is red because `CLI journey — binary on macos-15` was cancelled with
  "The job was not acquired by Runner of type hosted even after multiple attempts", next to GitHub's notice that
  macOS arm64 runners were capacity-constrained. No step of that job ran.
- Desktop App [44755775736](https://github.com/ahmadrrrtx/xr/actions/runs/44755775736): both Rust jobs, all five bundles, `latest.json` and six of the seven desktop
  journeys passed. `Desktop journey — darwin-arm64 on macos-15` was never acquired by a runner either (same message),
  so the native-validation and Desktop gates are red.
- No test failed on this head. Both red gates are runner allocations that never happened, not verdicts on the code,
  and reruns through the API are refused (403). This docs-only commit re-requests them. It is not a CI-fix attempt:
  nothing is changed and nothing is retried in code.

### Phase 3 CI on `8d29f9e` — PowerShell timeout repeated (NEW-9); work halted under R7

- Green: **Desktop App [44762916089](https://github.com/ahmadrrrtx/xr/actions/runs/44762916089)** (every job, all seven desktop journeys), **Cross-Platform
  [44762915982](https://github.com/ahmadrrrtx/xr/actions/runs/44762915982)**, **Clean-Machine Journey [44762915978](https://github.com/ahmadrrrtx/xr/actions/runs/44762915978)** (every CLI and Docker journey,
  macOS included this time), npm Pack Smoke [44762915998](https://github.com/ahmadrrrtx/xr/actions/runs/44762915998), Supply Chain [44762916094](https://github.com/ahmadrrrtx/xr/actions/runs/44762916094),
  Channel Install [44762916002](https://github.com/ahmadrrrtx/xr/actions/runs/44762916002), OS sandbox (non-gating) [44762916082](https://github.com/ahmadrrrtx/xr/actions/runs/44762916082).
- Red: CI [44762916079](https://github.com/ahmadrrrtx/xr/actions/runs/44762916079), job `test / core`, the same test as on `8b2b1a3`:
  `test/release/windows-installers-negative.test.ts` "missing or duplicate installer inputs fail closed: empty". This
  time `pwsh` printed nothing before the test's 15 s `spawnSync` bound (`ETIMEDOUT`). On `8b2b1a3` it had printed the
  expected refusal and then not exited. Under R7 a repeat is a defect: **NEW-9 (open)**, "the first PowerShell 7
  process on the Ubuntu `test / core` runner can take more than 15 s to start or exit". The script exits within a
  second of starting when the bundle folder is empty, and nothing in Phases 1–3 touches PowerShell, that script or
  `test/release`. The candidate fix, unproven because this sandbox has no `pwsh`, is to start the test's `pwsh` with
  `POWERSHELL_TELEMETRY_OPTOUT=1` and `POWERSHELL_UPDATECHECK=Off`. That removes PowerShell's start-up and exit network
  calls (telemetry, update check) without touching the 15 s bound or anything the test asserts.

## HALT — Phase 3, under R7 (2026-11-20)

- **Rule:** R7 allows three CI-fix attempts per phase, then a halt with a report. Phase 3 used its three: (1) `7b4b719`
  and `beebd2c` (B5 native-governor parity; NEW-6 overview never waits on git), (2) `d46ee7b` (NEW-7 desktop-journey
  diagnostics), (3) `dac8ba4` (NEW-8 isolation probes off the boot path). A fourth change, for NEW-9, is not made
  without the owner.
- **Every fix held.** None of the failures each attempt targeted came back on any later head: the Rust shared pricing
  vector, the macOS `/api/overview` bound, the Windows desktop journey and the desktop catalog timeout.
- **Required checks on Phase 3 code** (green / red; one head may count in several rows):

  | Check | Green heads | Red heads (cause) |
  |---|---|---|
  | Quality Gate | `5103ae5` `fb3163f` `9bb1010` `789cc47` `1f15f51` `a0943a7` | `8b2b1a3` `8d29f9e` (NEW-9) |
  | Cross-Platform gate | `fb3163f` `8b2b1a3` `9bb1010` `789cc47` `a0943a7` `8d29f9e` | `5103ae5` (NEW-6, fixed), `1f15f51` (Windows `migration-race`, did not recur) |
  | Supply Chain gate | all eight | none |
  | npm Pack Smoke gate | all eight | none |
  | Clean-Machine Journey gate | `5103ae5` `fb3163f` `8b2b1a3` `9bb1010` `789cc47` `8d29f9e` | `1f15f51` (NEW-3), `a0943a7` (no runner) |
  | Desktop gate | `8b2b1a3` `1f15f51` `8d29f9e` | `5103ae5` (B5 parity, fixed), `fb3163f` (NEW-7), `9bb1010` `789cc47` (NEW-8, fixed), `a0943a7` (no runner) |

- **Closest heads:** on `a0943a7` every job that ran passed (two macOS arm64 jobs never got a runner). On `8d29f9e`, five
  of six required checks passed, and NEW-9 failed the sixth.
- **Open defects:** NEW-2 (Bedrock default model), NEW-3 (Windows CLI journey, late `update` step: `xr status --json`
  exit 1), NEW-7 (Windows desktop journey sidecar health), NEW-9 (PowerShell start-up on Linux). The last three are
  intermittent and now carry diagnostics.
- **Not pushed:** Phases 4–7 are implemented, verified locally and committed locally on top of this head: accounting,
  the size-gate raise, state performance, daemon/workspace, and the three security commits. They wait for the owner's
  decision. R7 forbids pushing a later phase while this one is red.
- **Owner decision needed:** authorise a fourth Phase 3 attempt (the NEW-9 candidate fix above) and say how reruns for
  runner and infrastructure flakes count from here, or stop the run at Phase 3.

## RESUMED — owner decision (2026-11-20); Phase 3 CI-fix attempt 4 (owner-authorised)

- **Decision:** the owner authorised one fourth Phase 3 attempt, exactly the NEW-9 fix proposed in the halt report, and
  kept every other rule. Phases 4–11 have the normal three CI-fix attempts each, one rerun per first-occurrence flake,
  and a repeat flake is a defect. Recorded in the adaptations table.
- **Fix `d75a553` (NEW-9):** every PowerShell child of `test/release/windows-installers-negative.test.ts` now starts
  through one helper, with `POWERSHELL_TELEMETRY_OPTOUT=1` and `POWERSHELL_UPDATECHECK=Off`. These are the two PowerShell
  features that reach the network at start-up and exit. Unchanged: the 15 s `spawnSync` bound, the 25 s test budgets,
  the arguments (`-NoProfile -File …`) and every assertion. No other test changed.
- **Regression test:** a stand-in `pwsh` (POSIX shell script) prints what it was started with. The new test requires
  `1|Off|-NoProfile -File x.ps1` even when the parent sets other values, and it runs where real PowerShell is missing
  (including this sandbox, where the five real-PowerShell tests skip). **R2:** started with the old file's exact spawn
  options, the same stand-in sees neither setting (`||-NoProfile -File x.ps1`). Whether the real start-up is now fast
  enough on the hosted runner can only be shown by CI.
- Local verification: typecheck 0; `test/release` 315 pass / 16 skip / 0 fail; claim-lint, ci:policy and the
  platform-parity manifest are clean; tree unchanged at 176,424 (test-only change).
- **Rule for this head:** if it fails because a Phase 3 fix did not hold, Phase 3 halts for good. A new
  first-occurrence flake gets its one rerun. Once one head has all six required checks green, Phase 3 is done and Phase 4
  is pushed next.

### Phase 3 CI on `8bfc6ea` — all six required checks green (Phase 3 done)

- Green, every workflow: CI [44780370623](https://github.com/ahmadrrrtx/xr/actions/runs/44780370623), Cross-Platform [44780370742](https://github.com/ahmadrrrtx/xr/actions/runs/44780370742), Desktop App
  [44780370923](https://github.com/ahmadrrrtx/xr/actions/runs/44780370923), Clean-Machine Journey [44780370700](https://github.com/ahmadrrrtx/xr/actions/runs/44780370700), npm Pack Smoke
  [44780370889](https://github.com/ahmadrrrtx/xr/actions/runs/44780370889), Supply Chain [44780370632](https://github.com/ahmadrrrtx/xr/actions/runs/44780370632), Channel Install [44780370922](https://github.com/ahmadrrrtx/xr/actions/runs/44780370922),
  and the non-gating OS sandbox workflow [44780370648](https://github.com/ahmadrrrtx/xr/actions/runs/44780370648). `gh pr checks 215`: 84 pass, 1 skipped by
  design (`Verified desktop assets — PRIVATE draft only`, which runs on tags only).
- **NEW-9** passed on the hosted runner: `test / core`, which runs the PowerShell installer suite on Ubuntu, is green. It
  stays fixed-unverified: one green run shows the fix in place, not that the intermittent is gone.
- The halt of 2026-11-20 is resolved by the owner's decision and this head. Phase 3 needed four CI-fix attempts:
  `7b4b719` + `beebd2c` (B5 native parity, NEW-6), `d46ee7b` (NEW-7 diagnostics), `dac8ba4` (NEW-8) and `d75a553`
  (NEW-9, owner-authorised).
- Carried forward as open intermittents with diagnostics: NEW-3 (Windows CLI journey `update` step) and NEW-7 (Windows
  desktop journey sidecar health). NEW-2 (Bedrock default) stays open as a documented limitation.
- Next: Phase 4 is pushed on top of this head (one phase per push; R7's three attempts apply again).

## Phase 4 — accounting (B7, B10, B18) · commit `acdd8da`

| ID | Fix | Regression test | Status |
|---|---|---|---|
| B7 | One documented rule (`docs/budget-semantics.md`, option (a) of the brief): admission (`getSpendForPeriod`) keeps counting **all** recorded spend, estimates included, so a provider that omits usage can never overshoot a cap. Reporting separates it: `spendBreakdown()` (cost-repo, via the store's query passthrough) feeds `GET /api/budget` `usage.monthEstimatedUsd` and `xr budget status` (`monthlyEstimatedSpend`). Voice TTS/STT spend was already recorded as `usage_source='estimated'` and is now reported as such | `test/state/accounting-truth.test.ts` B7: admission counts both; breakdown and `/api/budget` separate them | fixed-unverified |
| B10 | `reservations.last_heartbeat_at`: an idempotent, additive ALTER guard in `migrate()`, so it runs before the startup sweep (+1 line in the waived store). `ReservationRepo.heartbeat()` renews an active row (never revives a settled or expired one). The sweep, at store open and before every admission, expires only rows whose `COALESCE(last_heartbeat_at, created_at)` is older than the TTL. The governor runs an unref'd self-clearing timer, three renewals per TTL, while a reservation is open | accounting-truth B10: a 130 s step that keeps renewing survives a 120 s-TTL sweep while a silent one expires (injected clock); no revival after settle; the governor's real timer renews and stops on release; an older DB gains the column additively and reopening is idempotent | fixed-unverified |
| B18 | The governor's per-step estimate prices input and output at their own rates. A first step uses a 1500 + 500 prior (not 2000 at the output rate). A later step uses the last step's growth (last input + last output re-sent as input, plus a reply like the last) with the running average only as a floor, which also covers resumed runs. The authoritative per-request admission in `model-accounting.ts` already priced the real prompt bound | `test/cost.test.ts`: growing context is refused before an overshoot; a first step under a $0.05 cap at $1/$50 is admitted | fixed-unverified |

- **R2** (probe against a detached worktree at the Phase 3 commit):

  | Defect | Old | New |
  |---|---|---|
  | B10 live 130 s step after the sweep | expired (no heartbeat API) | active |
  | B18 next step would overshoot $0.0475 | admitted | refused before sending |
  | B18 first step, $0.05 cap at $1/$50 | refused | admitted |
  | B7 `usage.monthEstimatedUsd` | absent | $0.10 |
- **Converted test:** `test/cost.test.ts` "governor blocks the next step before exceeding the token ceiling" assumed
  the average-based estimate ("est next ~500" after a 400 + 100 step). The same strict-boundary guarantee is kept at a
  1100-token ceiling; the original 1000-token scenario is exactly the overshoot B18 now refuses.
- **Observation (not changed):** `GET /api/budget` `burn.monthlyCap` reports 0 when nothing is persisted although
  the $10 default is in force. That surface is outside the brief's B6 list and desktop logic reads it, so it is logged
  here rather than changed.
- **Local verification:** state 67/0, cost 44/0, phase6 89/0, phase0 217/0, core 121/0, daemon 379/0, services 28/0,
  execution 155/0, context 316/0; typecheck 0; claim-lint ✓; boundaries 0 errors; API schema, client and ownership in sync.
- **Size:** tree +56 → 176,480, still under the original 176,500 ceiling; `workspace-store.ts` +1 (2541/2550).

### Phase 4 CI on `db3ee5f` — 6 of 7 green; Windows x64 desktop journey could not open a WebDriver session (NEW-10, rerun)

- Green: CI [44786241315](https://github.com/ahmadrrrtx/xr/actions/runs/44786241315), Cross-Platform [44786241503](https://github.com/ahmadrrrtx/xr/actions/runs/44786241503), Clean-Machine Journey
  [44786241443](https://github.com/ahmadrrrtx/xr/actions/runs/44786241443), npm Pack Smoke [44786241379](https://github.com/ahmadrrrtx/xr/actions/runs/44786241379), Supply Chain [44786241493](https://github.com/ahmadrrrtx/xr/actions/runs/44786241493),
  Channel Install [44786241535](https://github.com/ahmadrrrtx/xr/actions/runs/44786241535), OS sandbox (non-gating) [44786241461](https://github.com/ahmadrrrtx/xr/actions/runs/44786241461).
- Red: Desktop App [44786241411](https://github.com/ahmadrrrtx/xr/actions/runs/44786241411). Both Rust jobs, all five bundles, `latest.json` and six of the seven
  desktop journeys passed. **Desktop journey — windows-x64** failed in `launch` at `WebDriver POST /session`: "session not
  created: DevToolsActivePort file doesn't exist". msedgedriver never received the WebView2 debug port, so no XR window
  was ever driven.
- **Why this is not Phase 4 code:** Phase 4 touches no desktop, shell or webview file (accounting in `src/cost` and
  `src/state` only). The error is the documented WebView2 limitation the workflow already works around: Runtime 150
  and later ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in an elevated host. The workaround is an HKLM
  `AdditionalBrowserArguments` policy scoped to `xr-desktop.exe` (actions/runner-images#14738,
  MicrosoftEdge/WebView2Feedback#5645), added in PR #214, the commit this branch started from. This head shows the
  policy does not always take effect.
- **Classification, stated plainly:** this exact error is a first occurrence on this branch, logged as **NEW-10 (open)**:
  "windows-latest WebDriver session intermittently not created (WebView2 debug-port policy not applied)". It gets R7's
  one rerun, as this docs-only commit, and no Phase 4 attempt is used. The job itself has now failed at launch on three
  of the eleven heads where it ran on this branch: `42e13ec` (cause unknown, before the diagnostics), `fb3163f` (NEW-7:
  the webview rendered, then the sidecar did not answer `/health` within 60 s) and this head (NEW-10). It passed on
  every run seen on `main` and the other branches. **Any further failure of this job in Phase 4, with either symptom,
  is treated as a repeat and gets a real CI-fix attempt.**

### Phase 4 CI on `8dd647a` — all six required checks green (Phase 4 done)

- Green, every workflow: CI [44792959241](https://github.com/ahmadrrrtx/xr/actions/runs/44792959241), Cross-Platform [44792959329](https://github.com/ahmadrrrtx/xr/actions/runs/44792959329), Desktop App
  [44792959554](https://github.com/ahmadrrrtx/xr/actions/runs/44792959554) (the windows-x64 desktop journey included: NEW-10 did not recur), Clean-Machine Journey
  [44792959439](https://github.com/ahmadrrrtx/xr/actions/runs/44792959439), npm Pack Smoke [44792959392](https://github.com/ahmadrrrtx/xr/actions/runs/44792959392), Supply Chain [44792959372](https://github.com/ahmadrrrtx/xr/actions/runs/44792959372),
  Channel Install [44792959409](https://github.com/ahmadrrrtx/xr/actions/runs/44792959409), OS sandbox (non-gating) [44792959470](https://github.com/ahmadrrrtx/xr/actions/runs/44792959470). `gh pr checks 215`:
  84 pass, 1 skipped by design.
- Phase 4 used no CI-fix attempt: one docs-only rerun, for the first occurrence of NEW-10. NEW-7 and NEW-10 stay open
  as Windows desktop-journey intermittents.
- Next: Phase 5 with the ceiling raise, which it needs (176,528 > 176,500). It was re-verified locally on this base:
  typecheck 0; state 72/0, core and one-agent 140/0, daemon 379/0, security 420/0, context 316/0, reliability 109/0,
  scripts and architecture 88/0, trust and cost 184/0; claim-lint clean.

## Size-gate raise · commit `3609352`

`TREE_CEILING` 176,500 → 177,000 with the owner's sign-off (2026-11-19), as a dated, reasoned comment in
`scripts/size-gate.ts` listing each phase's measured cost. It lands before Phase 5, the first phase that needs it.
`bun run scripts/size-gate.ts --stamp-docs` re-stamped the three `XR:TREE-CEILING` markers (README, security
KNOWN_LIMITATIONS, the frozen 1.1.0 excerpt; marker contents only). The pin in
`test/scripts/size-gate-merge-contract.test.ts` ("the existing owner-approved hardening ceiling") moved with it and
still pins an exact value. No waived giant grew.

## Phase 5 — state performance and identity (B8, B9, B11, B14) · commit `94474b7`

| ID | Fix | Regression test (`test/state/state-performance.test.ts`) | Status |
|---|---|---|---|
| B8 / B14 | New `src/state/audit-verify.ts` is the single chain verifier. Construction calls it **once** (no double `verifyChain()`). The first open of a database in a process is a full pass and records the verified head as an in-memory checkpoint. Later opens verify only rows after it (a rewritten or missing checkpoint row fails over to a full pass) and schedule one background full pass. Explicit verification (`verifyChain`, `chainStatus`, `xr audit verify`, TUI audit export) stays a full pass. Unparseable `detail` now counts as a break instead of throwing. `workspace-store.ts` shrank 2541 → 2518. The TUI reads the open-time result on boot, refresh and switch | 20k audit + 20k cost rows: the first open is one full pass of 20,000 rows and a later open reads 0 rows, all inside a generous bound; a recent row edited after the checkpoint is caught at open and appends are refused; an **old** row edited behind the checkpoint is caught by the background pass and by explicit verify | fixed-unverified |
| B9 | `idx_cost_events_created` and `idx_cost_events_session` (`CREATE INDEX IF NOT EXISTS`, additive) | both exist, reopening is idempotent, and `EXPLAIN QUERY PLAN` for the spend window uses `idx_cost_events_created` | fixed-unverified |
| B11 | `WorkspaceManager.getStore(id, { fresh? })` opens `new Store(id, dbPath)` with the real workspace id (the path-only form forced `"default"`). It caches one instance per database, reopens a closed one, `fresh: true` gives an independent instance, and `deleteWorkspace` closes and evicts the cached handle | real id; same cached instance; fresh and closed handling | fixed-unverified |

- **Deviation from the brief's wording (documented):** construction does not start from the chain's own last signed
  checkpoint. That signature can only be trusted against the signing key, which is not loaded at construction
  (keychain I/O), and the public key embedded in the chain is exactly what a forger would rewrite. The trusted start
  is therefore this process's own last verified head, kept in memory. The first open per process is a full pass, and
  edits behind the checkpoint are caught by the background and explicit full passes, so tamper detection is not
  weakened (both cases are tested). Rows written under the wrong workspace id before B11 are not rewritten (R9).
- **R2** (probes against a detached worktree at the Phase 4 commit):

  | Defect | Old | New |
  |---|---|---|
  | B8 three later constructions of a healthy 20k-row chain | 68 / 72 / 107 ms (full pass each time) | 102 ms (first open) / 8 / 8 ms |
  | B14 one construction of a broken chain | 2 `verifyChain()` passes | 1 open-time pass (`verifyChain()` 0×); break detected |
  | B9 `cost_events` indexes | none | both |
  | B11 `getStore()` workspace id / reuse | `default`, new instance per call | real id, cached instance |
- **Local verification:** 29 audit-related test files 187/0; state 72/0, context 316/0, core 121/0, daemon 379/0,
  security 420/0, trust 142/0, reliability 109/0, cli 262/0, phases 0/1/2/4/6/8 all 0 fail; typecheck 0; claim-lint ✓.
- **Size:** tree +48 → 176,528 of 177,000; `workspace-store.ts` 2541 → 2518; `shell/app.ts` line-neutral.

### Phase 5 CI on `c1112b7` — Windows failed the B11 store-cache test; CI-fix attempt 1 of 3

- Green: CI [44799038778](https://github.com/ahmadrrrtx/xr/actions/runs/44799038778), Clean-Machine Journey [44799038792](https://github.com/ahmadrrrtx/xr/actions/runs/44799038792), npm Pack Smoke
  [44799038710](https://github.com/ahmadrrrtx/xr/actions/runs/44799038710), Supply Chain [44799038752](https://github.com/ahmadrrrtx/xr/actions/runs/44799038752), Channel Install [44799038727](https://github.com/ahmadrrrtx/xr/actions/runs/44799038727),
  OS sandbox (non-gating) [44799038678](https://github.com/ahmadrrrtx/xr/actions/runs/44799038678). Desktop App [44799038685](https://github.com/ahmadrrrtx/xr/actions/runs/44799038685) was still running
  when this fix was pushed.
- Red: Cross-Platform [44799038762](https://github.com/ahmadrrrtx/xr/actions/runs/44799038762). Linux and macOS passed. Windows failed
  `test/state/state-performance.test.ts` "getStore opens a workspace with its real id, returns one cached instance, and
  honours fresh/closed" at `expect(wm.deleteWorkspace(id)).toBe(true)` (received `false`).
- **Cause:** a Phase 5 test bug. The test opened an independent store (`getStore(id, { fresh: true })`) and never closed
  it. Linux and macOS unlink an open SQLite file; Windows refuses, so `deleteWorkspace` hit its `catch` and returned
  `false`. A fresh instance is its caller's to close (the manager tracks and closes only its cached instance). On
  POSIX the old test was really deleting a database another handle still had open, which is the B17 hazard Phase 6
  fixes.
- **Fix `6381ac0` (attempt 1 of 3):** the test closes its fresh instance before deleting the workspace. The assertion is
  unchanged. Phase 6 then turns deleting a still-open workspace into an explicit refusal (`WorkspaceInUseError`) and
  rewords this line's comment. Local: `test/state` 72/0.

### Phase 5 CI on `c0249f3` — Windows B11 fix held; NEW-7 recurred with a clearer picture; CI-fix attempt 2 of 3

- Green: **Cross-Platform [44801051112](https://github.com/ahmadrrrtx/xr/actions/runs/44801051112)** (Windows passed the B11 store-cache test: the fix held), CI
  [44801051197](https://github.com/ahmadrrrtx/xr/actions/runs/44801051197), Clean-Machine Journey [44801051151](https://github.com/ahmadrrrtx/xr/actions/runs/44801051151), npm Pack Smoke
  [44801051341](https://github.com/ahmadrrrtx/xr/actions/runs/44801051341), Supply Chain [44801051246](https://github.com/ahmadrrrtx/xr/actions/runs/44801051246), Channel Install [44801051523](https://github.com/ahmadrrrtx/xr/actions/runs/44801051523),
  OS sandbox (non-gating) [44801051346](https://github.com/ahmadrrrtx/xr/actions/runs/44801051346).
- Red: Desktop App [44801051295](https://github.com/ahmadrrrtx/xr/actions/runs/44801051295), only **Desktop journey — windows-x64**, in `launch`. This is NEW-7's
  symptom. The diagnostics from `d46ee7b` now give the picture: the webview had rendered; then for 60 s no `xr-engine`
  process listened on any port (47 OS port probes, slowest 448 ms, all empty); and when the journey asked the shell for
  its own view, WebDriver answered "invalid session id: session deleted as the browser has closed the connection". So
  **the whole app went away soon after rendering**, taking its job-contained sidecar with it. That fits both NEW-7
  observations (`fb3163f`, here) and probably NEW-10 (an app that dies at launch leaves msedgedriver no
  DevToolsActivePort file). Only windows-x64 is affected; windows-arm64 passes on every head.
- **Not Phase 5 code:** Phase 5 touches no desktop, shell or webview file. On this branch the job has now failed on
  four of thirteen heads; on `main` and the other branches it passed on every run seen. Why the app goes away is still
  unknown, and a real fix needs that answer. Rust cannot be built or run here (R6).
- **Attempt 2 (`c6b4030`), diagnostics only:** no assertion, bound, timeout, retry or polling change. A failed launch
  now also reports the shell's own lifecycle log lines (`<desktop home>/logs/shell.log`: session start, engine up or
  down with its reason, clean exit), whether the crash flag is still down, and on Windows which
  `xr-desktop`/`xr-engine`/`msedgewebview2` processes are alive and any Application Error records for them
  (application, exception code, faulting module). Everything is filtered and redacted under the rule the Windows
  installer journey already follows: no raw logs, tokens or environment leave the runner. Unit tests cover the filter
  and the redaction (they caught a bearer-token redaction bug before the push).
- This push is also the rerun. If NEW-7 recurs, the message should name the crash. Attempt 3 is then a real fix, the
  last before R7's halt.

### Process deviation on `07ee114` (2026-11-20) — Phases 6–7 pushed early by mistake, reverted

- **What happened:** the NEW-7 diagnostics (`c6b4030`) and their log entry (`07ee114`) were committed on top of the
  local, unpushed stack instead of on top of the pushed head `c0249f3`. So the push `c0249f3..07ee114` also carried the
  Phase 6 commit `aa3c044` and the Phase 7 commits `4045865`, `9c28812` and `e44d4d4` while Phase 5 was still red. That
  breaks the one-phase-per-push rule.
- **Repair:** force-pushing is forbidden (R4), so the four commits were reverted right away, newest first, in the next
  push: `6221984` (P7c), `a5504ce` (P7b), `536b661` (P7a) and `bccb51b` (P6). The head's tree is now exactly `c0249f3`
  plus the diagnostics and this log, verified with `git diff --stat c0249f3 HEAD`. The CI runs that started on the
  combined head `07ee114` are superseded and are not counted as evidence for any phase.
- Phase 5 remains the phase under test, at CI-fix attempt 2 of 3. Phases 6 and 7 are re-applied unchanged, one phase per
  push, after Phase 5 is green. Their content is identical to the reverted commits.

### Phase 5 CI on `2cb5404` — NEW-7 again, now with the shell's view; CI-fix attempt 3 of 3

- Green: CI [44809374499](https://github.com/ahmadrrrtx/xr/actions/runs/44809374499), Cross-Platform [44809374591](https://github.com/ahmadrrrtx/xr/actions/runs/44809374591), Clean-Machine Journey
  [44809374528](https://github.com/ahmadrrrtx/xr/actions/runs/44809374528), npm Pack Smoke [44809374727](https://github.com/ahmadrrrtx/xr/actions/runs/44809374727), Supply Chain [44809374522](https://github.com/ahmadrrrtx/xr/actions/runs/44809374522),
  Channel Install [44809374748](https://github.com/ahmadrrrtx/xr/actions/runs/44809374748), OS sandbox (non-gating) [44809374461](https://github.com/ahmadrrrtx/xr/actions/runs/44809374461).
- Red: Desktop App [44809374497](https://github.com/ahmadrrrtx/xr/actions/runs/44809374497), only **Desktop journey — windows-x64**, in `launch`. The `c6b4030`
  evidence: the webview had rendered; no `xr-engine` listened during 60 s (45 probes); the WebDriver session was gone
  because "the browser has closed the connection"; **no shell log and no crash flag** in the journey's desktop home;
  **no XR, engine or WebView2 process alive**; **no Application Error record**. So the app ended quietly, without a crash
  record and without a survivor.
- **What the code says** (Tauri 2.12.0 source, read through the GitHub API): `setup()` builds the configured windows
  **before** it runs the app's setup hook, so the page loads while setup runs (the XR-WIN-BOOT-001 race in `lib.rs`).
  An unmanaged `State<T>` command argument returns an error to JavaScript; only a direct `state::<T>()` call panics.
  XR's direct calls are all on states that are managed early, created lazily, or used on user action, and nothing in
  setup before its first log line (`session start`) can plausibly panic. So either setup ended earlier than its first
  log line in a way not yet visible, or the WebDriver-launched app did not inherit `XR_DESKTOP_HOME` and wrote its log
  elsewhere. The desktop code on this branch is unchanged from `main` on every startup path: Phase 3 changed only
  chat-frame handling, the budget sync flag and the native pricing table.
- **Attempt 3 (`a3eb0fb`), diagnostics only:** no assertion, bound, timeout, retry or polling change. The CI workflow
  audits process creation and termination on its throwaway Windows runner, next to the existing HKLM WebView2 policy.
  A failed launch now reports every start and exit status of `xr-desktop`, `xr-engine` and `msedgewebview2` (Security
  4688/4689: names and exit codes only), and looks for the shell log in the default desktop home too. A passing launch
  records whether the shell log landed in the journey's desktop home. The patterns were checked against sample event
  messages.
- **This is Phase 5's third and last attempt.** Phase 5's own fix held on Windows (attempt 1). If this head is not
  fully green, work halts under R7, and the exit statuses go to the owner.

### Phase 5 CI on `0445a89` — NEW-7's cause found: the shell aborts (0xC0000409) during startup

- Green: CI [44815440715](https://github.com/ahmadrrrtx/xr/actions/runs/44815440715), Cross-Platform [44815440745](https://github.com/ahmadrrrtx/xr/actions/runs/44815440745), Clean-Machine Journey
  [44815440770](https://github.com/ahmadrrrtx/xr/actions/runs/44815440770), npm Pack Smoke [44815440648](https://github.com/ahmadrrrtx/xr/actions/runs/44815440648), Supply Chain [44815440712](https://github.com/ahmadrrrtx/xr/actions/runs/44815440712),
  Channel Install [44815440587](https://github.com/ahmadrrrtx/xr/actions/runs/44815440587), OS sandbox [44815440578](https://github.com/ahmadrrrtx/xr/actions/runs/44815440578) and Workflow Audit
  [44815440574](https://github.com/ahmadrrrtx/xr/actions/runs/44815440574) (both non-gating).
- Red: Desktop App [44815440538](https://github.com/ahmadrrrtx/xr/actions/runs/44815440538), only the windows-x64 desktop journey. The process audit gave the answer:
  `audit events=852: exit msedgewebview2 0x0 x8, exit xr-desktop 0xC0000409 x1, exit xr-engine 0x0 x1, start msedgewebview2
  x8, start xr-desktop x1, start xr-engine x1`. **`xr-desktop.exe` ended with 0xC0000409**, the Windows fail-fast status
  of a Rust abort (a panic that cannot unwind through a native callback). The single `xr-engine` start and clean exit
  is the journey's own `xr-engine --version` call, so the shell never reached its sidecar spawn: it died before setup's
  first lines ran (no shell log, no crash flag, as observed).

## HALT — Phase 5, under R7 (2026-11-20)

- **Rule:** three CI-fix attempts per phase, then halt. Phase 5 used: (1) `6381ac0`, the B11 test closes its fresh store
  on Windows (held: Cross-Platform green ever since); (2) `c6b4030`, launch evidence; (3) `a3eb0fb`, process exit
  statuses. No fourth change is pushed without the owner.
- **Root cause of NEW-7 (and very likely NEW-10)**, a desktop-shell defect that predates this branch (the startup code
  is unchanged from `main`). `tauri.conf.json` creates three windows at startup (`main`, `hud`, `orb`). Tauri 2.12.0
  builds every configured window **before** it runs the app's `setup` hook (`crates/tauri/src/app.rs`, `fn setup`), and
  creating the hud and orb webviews pumps messages. So the main page, which loads first, can dispatch its bootstrap
  IPC before the first line of XR's `setup`. That IPC includes `updates_state`, which calls `app.state::<UpdatesState>()`,
  and the recovery commands, which read `RecoveryState` directly. XR-WIN-BOOT-001 manages those states at the **top of
  setup**, which is still too late on this path. A direct `state()` on an unmanaged type panics ("state() called before
  manage()"), and inside the WebView2 callback the panic aborts the process with 0xC0000409. The comment's own
  real-world capture names this exact site: "UpdatesState, inside CreateWebViewEnvironmentWithOptionsInternal → abort".
  It is timing-dependent, so it shows only on slow starts, here the windows-x64 runner since about 2026-11-19.
- **Proposed fix (ready locally, not pushed):** manage the five in-memory states (`RecoveryState`, `UpdatesState`,
  `DataHealth`, `SpawnState`, `ScreenshotState`) on the `tauri::Builder`, next to the engine state, so they exist before
  any window does; setup no longer manages them. All five are pure in-memory defaults, and `DataHealth`'s later manage
  is already idempotent. The regression test is a structural guard in `test/desktop` that fails on the current code.
  Rust cannot be built here (R6), so CI proves the change.
- **Owner decision needed:** authorise a fourth Phase 5 attempt (this fix), or stop at Phase 5. Phases 6–7 stay as saved
  patches until Phase 5 is green.

## RESUMED — owner decision (2026-11-20); Phase 5 CI-fix attempt 4 (owner-authorised)

- **Decision:** the owner authorised one fourth Phase 5 attempt, exactly the NEW-7 fix proposed in the halt report, and
  kept every other rule (Phases 6–11: three attempts each). Recorded in the adaptations table.
- **Fix `fdee0b2` (NEW-7):** `RecoveryState`, `UpdatesState`, `DataHealth`, `SpawnState` and `ScreenshotState` are managed
  on the `tauri::Builder`, next to the engine state, so they exist before Tauri builds the `main`, `hud` and `orb`
  windows. Setup no longer manages them; `DataHealth`'s later manage was already guarded by `try_state`. These are the
  only types the bootstrap commands read through a panicking `state::<T>()`, and all five are pure in-memory defaults.
  Comments in `lib.rs` and `data_health.rs` now say where they are managed.
- **Regression test:** `test/desktop/startup-state-order.test.ts` checks that each of the five is managed on the Builder
  and never first inside setup, that `main` is configured to exist at startup, and that every direct `state()` read in
  `updates.rs` and `recovery.rs` is of one of them. **R2:** 5 of its 7 tests fail on the previous `lib.rs`. The shell
  change itself can only be built and proven by CI (R6); the windows-x64 desktop journey is the proof.
- Local verification: `test/desktop` 709/0; typecheck 0; claim-lint, ownership and the platform-parity manifest clean;
  tree unchanged (176,528).
- **Rule for this head:** if NEW-7 recurs, Phase 5 halts for good. A new first-occurrence flake gets its one rerun. Once
  one head has all six required checks green, Phase 5 is done and Phase 6 is pushed next.

### Phase 5 CI on `c3b2db1` (halt-report head) and `9a5f011` (NEW-7 fix) — fix proven on Windows; one macOS flake (rerun)

- **`c3b2db1`** (docs only, no fix) came back with every workflow green, the windows-x64 desktop journey included. NEW-7
  is intermittent and did not fire on that run. That green does not show the race is gone, so Phase 5's acceptance is
  taken on a head that also proves the fix.
- **`9a5f011`** (NEW-7 fix `fdee0b2`): **Desktop App [44885245441](https://github.com/ahmadrrrtx/xr/actions/runs/44885245441) green**. The new `lib.rs` passed `cargo
  check`, `clippy -D warnings` and `cargo test` on Linux and Windows, and all seven desktop journeys passed, windows-x64
  included. Also green: CI [44885245369](https://github.com/ahmadrrrtx/xr/actions/runs/44885245369), Clean-Machine Journey [44885245414](https://github.com/ahmadrrrtx/xr/actions/runs/44885245414), npm Pack
  Smoke [44885245427](https://github.com/ahmadrrrtx/xr/actions/runs/44885245427), Supply Chain [44885245361](https://github.com/ahmadrrrtx/xr/actions/runs/44885245361), Channel Install
  [44885245453](https://github.com/ahmadrrrtx/xr/actions/runs/44885245453), and the non-gating OS sandbox [44885245357](https://github.com/ahmadrrrtx/xr/actions/runs/44885245357) and Workflow Audit
  [44885245380](https://github.com/ahmadrrrtx/xr/actions/runs/44885245380).
- Red: Cross-Platform [44885245422](https://github.com/ahmadrrrtx/xr/actions/runs/44885245422), macOS only. `test/cli/npm-runtime-launcher.test.ts` "a termination
  signal sent to the launcher is forwarded to its child" missed its single 4 s deadline, which covers Node start-up,
  the child writing its PID and the forwarded SIGTERM's trap. No phase touches the launcher, `bin/` or `test/cli`, and
  the test has no earlier failure in the last 60 Cross-Platform runs. It is treated as a first-occurrence flake: this
  docs-only commit is its one rerun, the 4 s bound is not touched (R1), and a repeat is a defect. This is not a CI-fix
  attempt. The rerun was held back until Desktop App on `9a5f011` finished, so the NEW-7 proof was not cancelled.

### Phase 5 CI on `9195707` — all six required checks green (Phase 5 done)

- Green, every workflow: CI [44887694266](https://github.com/ahmadrrrtx/xr/actions/runs/44887694266), Cross-Platform [44887694147](https://github.com/ahmadrrrtx/xr/actions/runs/44887694147), Desktop App [44887694249](https://github.com/ahmadrrrtx/xr/actions/runs/44887694249), Clean-Machine Journey [44887694111](https://github.com/ahmadrrrtx/xr/actions/runs/44887694111), npm Pack Smoke [44887694137](https://github.com/ahmadrrrtx/xr/actions/runs/44887694137), Supply Chain [44887694173](https://github.com/ahmadrrrtx/xr/actions/runs/44887694173), Channel Install [44887694190](https://github.com/ahmadrrrtx/xr/actions/runs/44887694190), and the non-gating
  OS sandbox [44887694122](https://github.com/ahmadrrrtx/xr/actions/runs/44887694122) and Workflow Audit [44887694112](https://github.com/ahmadrrrtx/xr/actions/runs/44887694112). `gh pr checks 215`: 85 pass,
  1 skipped by design. The macOS launcher test passed on its rerun.
- **NEW-7 fix `fdee0b2`:** the windows-x64 desktop journey passed on both heads that carry it (`9a5f011`, `9195707`). It
  stays fixed-unverified: the cause is removed structurally and pinned by a test, but the race was intermittent, so two
  green runs are evidence, not proof. NEW-10 (WebDriver session not created) has the same likely cause and stays open
  until the journey stays green.
- Phase 5 needed four CI-fix attempts: `6381ac0` (B11 test on Windows), `c6b4030` and `a3eb0fb` (NEW-7 diagnostics),
  `fdee0b2` (NEW-7 fix, owner-authorised). The Phase 6–7 commits pushed early by mistake (`07ee114`) were reverted and are
  re-applied now, one phase per push.
- Next: Phase 6, re-verified locally on this base: typecheck 0; state 75/0, daemon 379/0, one-agent and core 143/0, cli
  262/0, api 116/0, context 316/0, security 420/0, phase0, phase1 and phase2 286/0, phase4, phase6 and phase8 132/0;
  claim-lint, API schema and ownership clean; tree 176,582.

## Phase 6 — daemon and workspace safety (B13, B17, C13) · commit `a63ad32`

| ID | Fix | Regression test | Status |
|---|---|---|---|
| B13 | `chat.routes.ts`: the replayed history is bounded by `boundedHistory()` from `core/agent-history.ts`, the single definition of "newest 24 turns / 24k chars" that the loop also applies (the route's own `.slice(-64)` is gone). The `chat.message` audit is written **before** the terminal frame and reads `(finalMessage ?? "")`, so a missing `finalMessage` or a failing audit can never put `GENERATION_FAILED` after `done`; the client always sees exactly one terminal frame. `boundedHistory`'s declared type narrowed to the user/assistant turns it returns | `test/one-agent/chat-route.test.ts`: no `finalMessage` → one terminal frame (`done`), audited with `output: ""`; a throwing audit → one terminal frame (`GENERATION_FAILED`), never after `done`; 100 × 1.5k-char turns → ≤ 24 turns and ≤ 24k chars reach the loop, newest kept | fixed-unverified |
| B17 | `WorkspaceManager.deleteWorkspace`: under the database's cross-process migration lock, `databaseIdle()` (new `src/state/db-liveness.ts`, connecting through `openDatabase`, the one sanctioned factory, so the single-writer invariant holds) asks SQLite to leave WAL mode, which it refuses while any connection in any process (this one included) holds the database; the OS drops those locks when a process dies, so the probe is crash-proof and needs no side files. A live workspace throws `WorkspaceInUseError` (the active workspace gets a "switch first" message; `xr workspace delete` prints it, exit 4, nothing deleted). A free workspace's database is moved to a tombstone under `~/.xr/.deleted-workspaces/` while the lock is held; the workspace directory (which holds the open lockfile, and Windows cannot rename it while open) and the tombstone are removed after release. Unknown ids now return `false` instead of being provisioned and "deleted" | `test/state/workspace-delete.test.ts`: a second **process** holding the store blocks deletion, all rows survive, and deletion succeeds once it exits (no tombstone left); the active workspace open in this process is refused with the switch-first message; unknown and `default` ids return `false` and create nothing | fixed-unverified |
| C13 | Already fixed before this branch: cookie-authenticated mutations require an allowed `Origin` (`originAllowed` in `src/daemon/server.ts`); bearer requests are exempt | pre-existing lock-ins in `test/daemon/origin-host-guard.test.ts`: session POST with an evil or missing Origin → 403, same-origin (any loopback spelling) → 200, bearer exempt for every verb | fixed (pre-existing) |

- **R2:** with the Phase 5 `chat.routes.ts`/`agent-history.ts`, all 3 B13 tests fail and the 5 existing route tests
  pass. A probe against a worktree at the Phase 5 commit: old `deleteWorkspace` returned `true` while another process
  was writing and the database file was gone (silent data loss), and deleting an unknown id returned `true`. New: it
  throws `WorkspaceInUseError` with the file intact, and an unknown id returns `false`.
- **Behaviour change (documented):** deleting the workspace that is currently active from the CLI is now refused with
  "switch first (xr workspace use default)", because the command's own kernel holds that database open. Before, POSIX
  deleted it under the open handle and Windows failed with a misleading "not found".
- **Local verification:** daemon 379/0, state 75/0, one-agent 22/0, core 121/0, cli 262/0, api 116/0, context 316/0,
  e2e-blackbox 102/0, security 420/0, phases 0/1/2/4/6/8 all 0 fail; typecheck 0; claim-lint ✓; boundaries 0 errors;
  API schema/client and ownership in sync (no API change).
- **Size:** tree 176,528 → 176,582 (+54) of 177,000; no waived module touched.

### Phase 6 CI on `928e609` — all six required checks green (Phase 6 done)

- Green on the first push, every workflow: CI [44890244897](https://github.com/ahmadrrrtx/xr/actions/runs/44890244897), Cross-Platform [44890244913](https://github.com/ahmadrrrtx/xr/actions/runs/44890244913), Desktop App [44890244875](https://github.com/ahmadrrrtx/xr/actions/runs/44890244875), Clean-Machine Journey [44890244883](https://github.com/ahmadrrrtx/xr/actions/runs/44890244883), npm Pack Smoke [44890244866](https://github.com/ahmadrrrtx/xr/actions/runs/44890244866), Supply Chain [44890244847](https://github.com/ahmadrrrtx/xr/actions/runs/44890244847), Channel Install [44890244867](https://github.com/ahmadrrrtx/xr/actions/runs/44890244867), and
  the non-gating OS sandbox [44890244910](https://github.com/ahmadrrrtx/xr/actions/runs/44890244910) and Workflow Audit [44890244850](https://github.com/ahmadrrrtx/xr/actions/runs/44890244850).
  `gh pr checks 215`: 85 pass, 1 skipped by design. No CI-fix attempt used.
- Windows full parity passed `test/state/workspace-delete.test.ts`, the Windows file-locking risk flagged before the
  push: a child process holding the database, then a tombstone rename and delete after it exits.
- The windows-x64 desktop journey passed for the third consecutive head with the NEW-7 fix.
- Next: Phase 7 (three commits), re-verified locally on this base: typecheck 0; security 452/0, plugins 91/0, phase0
  217/0, research and trust 220/0, context 316/0, daemon 379/0, state 75/0, reliability 109/0, one-agent and core 143/0,
  cli 262/0; claim-lint, boundaries (0 errors), API schema, ownership and hot-path clean; tree 176,635 of 177,000.

## Phase 7 — security sweep (C3–C8, lock-ins, C16) · commits `dba65dc` `c3a6e09` `dcf954d`

| ID | Fix | Regression test | Status |
|---|---|---|---|
| C3 | `guard.ts` shell patterns now judge (a) a decoder piped into a shell (`base64/base32/basenc/xxd/openssl … \| [sudo] [path/](ba\|z\|da\|k\|c\|tc)sh`), (b) `eval` / `sh -c` / `source` of a decoding substitution (`$( )`, `<( )`, backticks; `printf` hex/octal escapes; Python `exec(base64.b64decode(…))`), and (c) the command after `expandShellVars()` substitutes simple `NAME=value` assignments into later `$NAME`/`${NAME}` uses (chained, three rounds), so `X=rm; $X -rf /` is caught as "recursive delete, via shell variables". Still a heuristic: the OS sandbox stays the boundary, as the module header says | `test/security/obfuscation.test.ts`: 13 obfuscated commands blocked with the right label; 6 controls allowed (`base64 -d` without exec, `X=hello; echo $X`, `eval "$(ssh-agent -s)"`, …); expansion unit test | fixed-unverified |
| C8 | `scanUntrusted` also scans a de-obfuscated copy: NFKC (full-width), HTML entities, percent escapes, hidden characters, Cyrillic/Greek homoglyphs, markup and spacing between letters, and printable base64 runs. Callers only frame or warn on a flag, so higher recall cannot block a flow | same file: 9 obfuscated injections flagged; plain injections flagged exactly as before (the direct `scanUntrusted` lock-in); benign prose, printable base64 and Cyrillic text not flagged | fixed-unverified |
| C4 + **NEW-5** | **NEW-5 (found by the C4 probes):** `loadPluginInWorker` passed `new URL(…).href`, a `file://` *string* that `node:worker_threads` rejects, so every "isolated" plugin silently fell back to the in-process VM (audit `plugin.worker_fallback`). Behind that, a successful activation called `worker.removeAllListeners()`, so any worker invocation would have timed out. Fixed: the worker gets a filesystem path, and success keeps the message listener (only `fail()` detaches and terminates) | `test/plugins/worker-escape.test.ts`: 10 escape probes run **inside the worker** (asserted: no `plugin.worker_fallback`): constructor / async / generator constructor chains, dynamic `globalThis` keys, computed `require`, dynamic `import()`, `worker_threads.parentPort`, stack-trace callsite walking, sloppy-mode `this`, host prototype chain. Mutation check: exposing a `process` stand-in in the realm makes 2 probes fail | fixed-unverified |
| C5 | Already in place: `xr doctor`'s "Secret store" row (`secretStoreHealth`) warns on the file vault, fails in strict keychain mode, warns on leftovers and points at `xr repair` | existing tests in `test/security/secret-keychain.test.ts`, plus a new lock-in for the explicit `XR_SECRET_BACKEND=file` opt-in | fixed (pre-existing) |
| C6 | `docs/security/AUDIT-EVIDENCE.md`: "If the signing key is stolen" (what a key holder can and cannot forge, the response: re-key, replace backups, re-anchor) and "Offline anchors" (the existing `file://` sink on removable or write-once media, and the manual comparison; automatic comparison against an external anchor file is stated as not built) | docs only | documented |
| C7 | `KNOWN_LIMITATIONS.md` row 4 said provider keys "remain hydrated into `process.env`"; the code (`isOffValue`, `hydrateProviderEnv`) and row 30 say that happens only with `XR_SECRETS_ENV_COMPAT=1` (off by default). Row 4 now says so | claim-lint and the release docs tests | fixed |
| C16 | Live `bun audit` of all six lockfiles: root (100), cloud (130), desktop (494), tools (241): 0 advisories. `mobile/` and `website/` each carry moderate advisories in build-only tooling (glob GHSA-3g3m-2fjr-6pw4, minimatch GHSA-g3hv-75wg-m249) that `bun audit fix` cannot patch within semver (parents pin `glob@^11` and `minimatch@^10.2.2`; fixes are new majors). Recorded as KNOWN_LIMITATIONS row 32; lockfiles unchanged; vendored picomatch stays documented (row 31) | `scripts/audit-deps.sh` PASS (35 + 286 production packages) | documented |

- **Lock-ins already present** (re-checked, all green): tar `..`/symlink/hardlink rejection (`test/voice/tar.test.ts`,
  `models.test.ts`); stranger/unpaired silence in all three bots (`test/telegram/phase24.test.ts` "an unknown user gets
  NO reply…", `test/discord` "an unpaired DM is ignored in silence", `test/whatsapp` "a stranger is ignored in total
  silence"); private and raw-IP egress (`test/research/url-guard.test.ts`, `test/phase0/policy-gate-adversarial.test.ts`);
  approver identity (`test/daemon/approver-identity.test.ts`); direct `scanUntrusted` (new, above).
- **R2:** against the Phase 6 guard, 0 of 13 obfuscated commands were blocked and 0 of 9 obfuscated injections flagged
  (new: 13/13, 9/9). Against the old worker loader, all 10 C4 tests fail (silent fallback).
- **Local verification:** security 452/0, plugins 91/0, phase0 217/0, research 76/0, context 316/0, daemon 379/0,
  state 75/0, reliability 109/0 (single-writer invariant included), one-agent 22/0, core 121/0, cli 262/0; typecheck 0;
  claim-lint ✓; boundaries 0 errors; API schema/client, ownership, hot-path and placeholder lints clean.
- **Size:** tree 176,582 → 176,635 (+53) of 177,000; no waived module touched.

### Phase 7 CI on `d1f7f6d` — all six required checks green (Phase 7 done)

- Green on the first push, every workflow: CI [44892794288](https://github.com/ahmadrrrtx/xr/actions/runs/44892794288), Cross-Platform [44892794304](https://github.com/ahmadrrrtx/xr/actions/runs/44892794304), Desktop App [44892794282](https://github.com/ahmadrrrtx/xr/actions/runs/44892794282), Clean-Machine Journey [44892794346](https://github.com/ahmadrrrtx/xr/actions/runs/44892794346), npm Pack Smoke [44892794255](https://github.com/ahmadrrrtx/xr/actions/runs/44892794255), Supply Chain [44892794294](https://github.com/ahmadrrrtx/xr/actions/runs/44892794294), Channel Install [44892794245](https://github.com/ahmadrrrtx/xr/actions/runs/44892794245),
  and the non-gating OS sandbox [44892795008](https://github.com/ahmadrrrtx/xr/actions/runs/44892795008) and Workflow Audit [44892794287](https://github.com/ahmadrrrtx/xr/actions/runs/44892794287). `gh pr checks 215`: 85 pass,
  1 skipped by design ("Real channel installs of the public version"). No CI-fix attempt used.
- All seven desktop journeys passed; windows-x64 passed for the fourth consecutive head that carries the NEW-7 fix.

## Phase 8 — CI: actionlint, required-check names, merge, `main` runs

- **actionlint:** enforced on every PR and every push to `main`. The Truth gate in `ci.yml` runs "Workflow lint
  (actionlint + shellcheck, pinned)" (XR-LAUNCH-032; version and sha256 pinned). It passed on every phase head, most
  recently `d1f7f6d` (CI [44892794288](https://github.com/ahmadrrrtx/xr/actions/runs/44892794288)), next to "Gate changelog:check (XR-P08/D-026)". A local run is not possible:
  the binary is only distributed as a GitHub release asset, which this sandbox cannot download.
- **Required-check names:** `bun run ci:policy` → "OK — 6 required checks, 22 workflows": every name in
  `.github/required-checks.json` matches a job name. **Gap, owner action:** the active ruleset "main protection"
  (id 19119579) enforces 4 of the 6 (Quality Gate, Cross-Platform gate, Supply Chain gate, npm Pack Smoke gate).
  Desktop gate (bundles + latest.json + journey) and Clean-Machine Journey gate are declared but not enforced.
  Rulesets are repository settings (this session's token cannot even read branch protection), so nothing is changed
  from here.
- **Merge:** with the owner's approval (adaptations table), PR #215 was marked ready and merged on 2026-11-21 at
  11:14:41 UTC with a merge commit pinned to the Phase 7 green head (`gh pr merge 215 --merge --match-head-commit
  d1f7f6d…`). The result is `23090ee`, with parents `cd21cd5` and `d1f7f6d`. A merge commit keeps the per-defect
  conventional commits, which `scripts/changelog.ts` reads (`git log --no-merges`).
- **What counts as a green `main` run:** all six required checks pass on one push to `main`. Non-gating workflows are
  reported alongside and do not count either way.
- **How the runs are produced:** every merge to `main` starts one run of each push workflow, and `main` runs queue
  instead of cancelling (`cancel-in-progress` is false on `main`). `workflow_dispatch` is not available to this
  session (403), so runs 2 and 3 come from two small evidence PRs from this branch. Each is merged only after the
  previous `main` run has finished green.
- **`main` run 1, `23090ee`:** in progress when this was written: CI [44898171204](https://github.com/ahmadrrrtx/xr/actions/runs/44898171204), Cross-Platform [44898171045](https://github.com/ahmadrrrtx/xr/actions/runs/44898171045), Desktop App [44898171222](https://github.com/ahmadrrrtx/xr/actions/runs/44898171222), Clean-Machine Journey [44898171078](https://github.com/ahmadrrrtx/xr/actions/runs/44898171078), npm Pack Smoke [44898171035](https://github.com/ahmadrrrtx/xr/actions/runs/44898171035), Supply Chain [44898171079](https://github.com/ahmadrrrtx/xr/actions/runs/44898171079), Channel Install [44898171046](https://github.com/ahmadrrrtx/xr/actions/runs/44898171046).
- **NEW-11 (pre-existing, logged only; owner action):** Channel Live is not a required check. It asks the public
  registries whether every claimed channel serves `channels.publicVersion` (XR-LAUNCH-001). It failed on this push
  ([44898171263](https://github.com/ahmadrrrtx/xr/actions/runs/44898171263)) in "Claimed channels serve the public version" (steps `channel:live` and "README channel claims
  match the live registries"). It has failed on every run since at least 2026-11-16, including `main` at `cd21cd5`:
  push [44418953446](https://github.com/ahmadrrrtx/xr/actions/runs/44418953446) and nightly runs [44544636564](https://github.com/ahmadrrrtx/xr/actions/runs/44544636564) and [44750652238](https://github.com/ahmadrrrtx/xr/actions/runs/44750652238).
  - A local `bun run channel:live` shows the npm cause: the retired versions 3.0.0, 3.0.1, 3.0.2, 3.0.3 and 3.1.5
    outrank `latest` 1.0.0, and their deprecation messages point to `@beta`, not `@latest`.
  - Fixing that needs `npm deprecate` with publish rights, so it is OWNER-BLOCKED; `bun run npm:ghosts --
    --print-commands` prints the five commands.
  - The other five claimed channels cannot be checked from this sandbox (TLS interception), so whether they fail too
    is unknown. The three install jobs in the same run passed (install.sh on macOS and Ubuntu, install.ps1 on Windows).
- **Gate XR-LAUNCH-012** asks for 10 consecutive green `main` runs; it stays in progress.

### Phase 8 CI on `365ea49` (PR #216) — Clean-Machine Journey red: NEW-3 again, now with its cause; CI-fix attempt 1 of 3

- Red, Clean-Machine Journey [44898444685](https://github.com/ahmadrrrtx/xr/actions/runs/44898444685): **`CLI journey — binary on windows-latest`**, step `Journey`. The
  annotation names the step: "installer N+1 exit 1: … Downloading compiled binary v1.2.1-journey.1
  (xr-windows-x64.exe) Move-Item: install.ps1:297 … The process cannot access the file because it is being used by
  another process." The other 19 journeys passed. The same tree passed this journey in `main` run 1
  ([44898171078](https://github.com/ahmadrrrtx/xr/actions/runs/44898171078)), so the failure is intermittent.
- **Classification:** the fourth occurrence of NEW-3 ("windows-latest CLI journey fails intermittently in its late
  steps", after `3f0f839`, `55fa18a` and `1f15f51`), so a defect, not a flake. It blocks Phase 8: PR #216 is not
  merged while a declared required check is red, even though the ruleset does not enforce this one.
- **Cause:** in `Install-XrBinary`, the new binary is run once as `.partial-<name>` (`& $partial --version`) and then
  moved over the installed one with `Move-Item -Force`. PowerShell's `FileSystemProvider.MoveFileInfoItem`
  (PowerShell/PowerShell, `src/System.Management.Automation/namespaces/FileSystemProvider.cs`) reports the error of
  its *first* `MoveTo` even when the `-Force` fallback fails, and a held destination would surface as "already
  exists". A sharing violation (32) therefore means the **source** was still held: the binary run a moment earlier,
  while Windows tears the exited image down or real-time antivirus reads the new file. The same fallback deletes the
  installed binary before its second move fails, so on the old code a failed update also lost the installed binary.
- **Fix** `8d1b98b`: both moves of the downloaded binary go through `Move-XrItemWithRetry`. It retries only an
  `IOException` carrying a sharing or lock violation (32, 33), up to 30 × 500 ms, then rethrows the original error.
  Any other error (access denied, a missing file) still stops the install at once.
- **Regression tests** in `test/release/installer-powershell.test.ts`:
  - Static, every OS: `Install-XrBinary` has no bare `Move-Item`, and the helper's budget, error filter and rethrow are
    pinned. **R2:** with `install.ps1` from `365ea49`, both fail; with the fix, both pass.
  - Executed under PowerShell (`test/release/installer-move-controls.ps1`): 2 controls on every host (an unheld
    replace; a missing source fails at once). On Windows, 4 more hold the new binary the way a scanner can (readers
    allowed, delete and rename refused). The negative control shows that a plain `Move-Item` under that hold fails
    with the CI journey's error code 32 (the old code). The retry waits a 1.5 s hold out, with and without an
    installed binary in place. A hold longer than the budget ends in the original sharing violation, with the new
    binary kept.
- **Local verification:** `test/release` 317/0 (17 skipped: the PowerShell-executed tests, since this sandbox has no
  PowerShell), install-container and journey tests 43/0, typecheck 0, claim-lint ✓, ownership ✓, `release:check` and
  `channel:check` in sync. Size unchanged at 176,635 (installer scripts and tests are outside the counted tree).
- **`main` run 1 (`23090ee`)** at the time of this commit: 5 of 6 required checks green, Desktop App still running.
- **R7:** Phase 8 CI-fix attempt **1 of 3**.
