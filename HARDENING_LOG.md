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
| Tree ceiling 176,500 would not hold Phases 3–7 | Measured: Phase 1 +143, Phase 2 +156 (local); Phases 3–7 estimated at +250–450 against 146 remaining | **Owner (ahmadrrrtx) approved +500 → 177,000 on 2026-11-19** in this session. It lands as its own dated, reasoned commit in `scripts/size-gate.ts` (the gate's documented mechanism) at the start of Phase 3, docs markers re-stamped; waived giants still may not grow; each phase's measured LOC is logged |
| Phase 10 version choice | 1.1.1 would sort below the current 1.2.0-preview.1 identity | **Owner delegated the choice on 2026-11-19.** Decision: release **1.2.0-preview.2** through `release.manifest.json` + `bun run release:stamp` + the existing release workflow, only if every required check and the workflow's own gates are green and the full asset suite is produced; npm only via OIDC, desktop signing owner-blocked; otherwise nothing is published and Phase 10 records why |

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
| 1 — voice crash chain (B1 B15 B19 B20) | `6fe87e8` (+ log `3f0f839`) | head `3f0f839`: CI [44508641467](https://github.com/ahmadrrrtx/xr/actions/runs/44508641467) ✓ · Supply Chain [44508641404](https://github.com/ahmadrrrtx/xr/actions/runs/44508641404) ✓ · npm Pack Smoke [44508641445](https://github.com/ahmadrrrtx/xr/actions/runs/44508641445) ✓ · Channel Install [44508641208](https://github.com/ahmadrrrtx/xr/actions/runs/44508641208) ✓ · Clean-Machine Journey [44508641214](https://github.com/ahmadrrrtx/xr/actions/runs/44508641214) ✗ — see "Phase 1 CI" below; re-run on the next head | fixed-unverified |

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
