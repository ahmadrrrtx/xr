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
| 1 — voice crash chain (B1 B15 B19 B20) | `6fe87e8` (+ CI diagnostics `f13a309` `42e13ec` `515a3bd`) | head `97bd3b4`: CI [44629362347](https://github.com/ahmadrrrtx/xr/actions/runs/44629362347) ✓ · Cross-Platform [44629362352](https://github.com/ahmadrrrtx/xr/actions/runs/44629362352) ✓ · Desktop App [44629362192](https://github.com/ahmadrrrtx/xr/actions/runs/44629362192) ✓ · Journey [44629362281](https://github.com/ahmadrrrtx/xr/actions/runs/44629362281) ✓ · npm Pack Smoke [44629362260](https://github.com/ahmadrrrtx/xr/actions/runs/44629362260) ✓ · Supply Chain [44629362046](https://github.com/ahmadrrrtx/xr/actions/runs/44629362046) ✓ · Channel Install [44629362279](https://github.com/ahmadrrrtx/xr/actions/runs/44629362279) ✓ | **done**: all 6 required checks pass on one head (82 pass, 1 skipped by design) |
| 2 — downloads (B2 B3/C2 B12) | `7219c23` (+ log `341e5b1`) | head `341e5b1`: CI [44636377949](https://github.com/ahmadrrrtx/xr/actions/runs/44636377949) ✓ · Cross-Platform [44636377917](https://github.com/ahmadrrrtx/xr/actions/runs/44636377917) ✓ · Desktop App [44636377958](https://github.com/ahmadrrrtx/xr/actions/runs/44636377958) ✓ · Journey [44636378005](https://github.com/ahmadrrrtx/xr/actions/runs/44636378005) ✓ · npm Pack Smoke [44636377856](https://github.com/ahmadrrrtx/xr/actions/runs/44636377856) ✓ · Supply Chain [44636377919](https://github.com/ahmadrrrtx/xr/actions/runs/44636377919) ✓ · Channel Install [44636377864](https://github.com/ahmadrrrtx/xr/actions/runs/44636377864) ✓ | **done**: all 6 required checks pass (82 pass, 1 skipped by design) |
| 3 — budget truth (B4 B5 B6 NEW-1) | `d0cebb3` (+ CI fixes `7b4b719`, `beebd2c`, `dac8ba4`; diagnostics `d46ee7b`) | head `5103ae5`: Cross-Platform ✗ (macOS `/api/overview` 861 ms → NEW-6), Desktop App ✗ (Rust shared pricing vector: B5 parity gap). Head `fb3163f`: 6 of 7 green; Desktop App ✗ only on the windows-x64 desktop journey (→ NEW-7). Head `8b2b1a3`: 6 of 7 green incl. Desktop App [44734448535](https://github.com/ahmadrrrtx/xr/actions/runs/44734448535); CI [44734448320](https://github.com/ahmadrrrtx/xr/actions/runs/44734448320) ✗ only on a first-occurrence PowerShell start-up timeout (unrelated test). Head `9bb1010`: 6 of 7 green incl. CI [44741467463](https://github.com/ahmadrrrtx/xr/actions/runs/44741467463); Desktop App [44741467604](https://github.com/ahmadrrrtx/xr/actions/runs/44741467604) ✗ only on a first-occurrence 3 s client timeout in a desktop shell test (unrelated). Rerun pushed. Head `789cc47`: 6 of 7 green; Desktop App [44743964067](https://github.com/ahmadrrrtx/xr/actions/runs/44743964067) ✗ on the same timeout again (→ NEW-8). CI-fix attempt 3 of 3 pushed. Head `1f15f51`: Desktop App [44748738547](https://github.com/ahmadrrrtx/xr/actions/runs/44748738547) ✓ (NEW-8 fix held), CI ✓; Cross-Platform [44748738656](https://github.com/ahmadrrrtx/xr/actions/runs/44748738656) ✗ (Windows `migration-race`, first occurrence), Journey [44748738499](https://github.com/ahmadrrrtx/xr/actions/runs/44748738499) ✗ (NEW-3 again). **R7 attempt limit reached**; docs-only rerun pushed | fixed-unverified |

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
