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
| 0 — recon/baseline | (this file) | pending | in progress |
