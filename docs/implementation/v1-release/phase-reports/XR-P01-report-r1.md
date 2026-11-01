# XR-P01 — Engine contract, readiness and recovery truth — executor report (r1)

**Role of this document.** Executor's evidence report for prompt
`phase-prompts/XR-P01-r1-4adcec2.md`. It does not mark the phase accepted; the
Plan Owner rules. Status claimed: `IMPLEMENTATION_REPORTED`.

**Branch / base.** `phase/P01-engine-readiness`, rebased onto the owner-merged
`main@5c73faa9` (PR #207: P00 acceptance docs D-024…D-026 + this prompt;
docs-only over the prompt's nominal baseline `4adcec2` — product tree
identical to `4adcec2`, `git diff 4adcec2 5c73faa` is 4 doc files).
Implementation commits (oldest first): `d2e546bc` daemon, `23c221bf`
transport, `7ed4e47a` state machine + consumers, `24f34a0c` banner,
`b3db69c2` diagnostics, `bf6081d0` tests, `0ff86cbe` size-waiver correction.
This report + docs land in a final commit; the PR names the true head.

---

## 1. What was built (§4, in order)

### 4.1 Daemon (additive, session-gated only)

`GET /api[/v1]/meta/version` now returns the legacy four fields **plus**:

| Field | Source (single authority) |
|---|---|
| `contractVersion: 1` | `ENGINE_CONTRACT_VERSION` — `src/daemon/routes/contract-engine.ts`, re-exported by `contract.ts` (see deviation D1) |
| `minDesktopVersion: "0.2.0"` | `MIN_DESKTOP_VERSION` — same module; `0.2.0` is the first desktop speaking contract 1 (`desktop/src/lib/appMeta.ts` / tauri.conf train) |
| `schemaVersion: 12` | `LATEST_SCHEMA_VERSION` — `src/state/migrations.ts:707` (derived from `MIGRATIONS`; executed: `= 12`). **Included** because the authority exists. |
| `capabilities: string[]` | Derived once from `fullApiOps()` operation ids (sorted, de-duplicated, cached) in `meta.routes.ts` — never a hand list; per-request cost is replaying the cached array. |

**API_CONTRACT choice (prompt asked for an explicit statement).** Executor
finding: `meta.version.get` was **already registered** — in
`contract-mobile.ts` (deliberately, per the `contract.ts` size-waiver plan),
spread into `API_CONTRACT`. E-38's statement that the op is "absent from
`API_CONTRACT` (hence from OpenAPI)" is therefore **wrong in that detail**;
corrected as E-47. Consequences: (a) no new registration was needed — my
first attempt added a duplicate key that the later `...MOBILE_CONTRACT`
spread silently overwrote; removed in `0ff86cbe`; (b) I updated the existing
entry's summary to describe the handshake and regenerated
`docs/api/openapi.json` + `src/clients/daemon-client.generated.ts` with
`bun run api:schema:generate` / `bun run client:generate` (the only diff is
that one summary line in each artifact — verified with `git diff`).

**Health endpoints are untouched**: `git diff origin/main -- src/daemon/routes/system.routes.ts src/daemon/server.ts test/daemon/origin-host-guard.test.ts` is empty (AC2).

### 4.2 Desktop transport (`desktop/src/engine/transport.ts`)

- **Bounded requests**: `ENGINE_REQUEST_TIMEOUT_MS = 10_000` (exported). An
  explicit `AbortController` timer bounds the wait for response **headers**;
  the timer is cleared once headers arrive so SSE bodies (chat, builder
  events, voice, WhatsApp QR — the signal-passing callers) stream under the
  caller's own signal, never guillotined mid-stream. Our timeout ⇒
  `EngineDown('timeout')` (new distinct kind); caller aborts still propagate
  as raw `AbortError`.
- **Handshake**: `engineHandshake()` — once per endpoint link, `GET
  /meta/version` → `evaluateEngineContract(payload, APP_VERSION)` (pure,
  exported). Typed `EngineIncompatible` with reasons
  `missing-contract-version | contract-too-old | contract-too-new |
  desktop-too-old`; desktop supports contract range `[1,1]`
  (`DESKTOP_MIN/MAX_ENGINE_CONTRACT`). **No `contractVersion` field ⇒
  `legacy`, never inferred from the package version.** Successful outcomes
  are cached per link; failures are not (next poll re-asks); link
  loss/reset/re-pair clears the cache (`resetEngineHandshake`,
  `resetEngineLink`, `pairFromUrl`).
- `EngineHealth` trimmed to exactly `{ok, ts}`; the dead
  `name/version/host/binding/auth` fields (E-39) are deleted — grep showed
  their only consumer was the structurally-null `engineVersion()` path.

### 4.3 Readiness state machine (`desktop/src/stores/engineStore.ts`)

`EngineStatus = 'starting'|'ready'|'degraded'|'disconnected'|'failed'` with
`failureReason: 'unauthorized'|'incompatible'|'crashed'|'timeout'|'unreachable'|null`
(set iff `failed`). **One** transition function:

```
nextEngineState(probe, elapsedMs, handshake) → {status, failureReason}
```

Verified rules (tests §4 below): `ready`/`degraded` require an `ok` probe
**and** an observed handshake (open-probe 200 alone ⇒ `starting`); legacy ⇒
`degraded`; `ENGINE_BOOT_DEADLINE_MS = 30_000` bounds `starting` — silent
past it ⇒ `failed(timeout)` and the store captures the sidecar stderr tail
via the existing Rust `engine_logs_tail` (no Rust change); a shell-observed
spawn failure (`endpoint.reason`) ⇒ `failed(crashed)`; 401 on the gated
handshake ⇒ `failed(unauthorized)`. Poll cadence: 15 s usable / 3 s
otherwise. `engineVersion()` now reads the handshake (real value).

**D-008 mapping + consumer census** (mine, §3.4: 25 files import
`useEngineStore`; 19 files held true engine-status comparisons; raw
`status ===` scan = 293 hits, mostly other stores, left alone):

| Old | New | Sites |
|---|---|---|
| `'unknown'`, `'checking'` | `'starting'` | store init/transitions; DiagnosticsTab label/dot |
| `'up'` (reachability gates) | `isEngineUsable(status)` = ready‖degraded | ModelChip, ShellBridge, Brain/index, EngineLedgerCard, EngineBudgetSummary (×4), ModelPicker (×4), ModelSelect, ProviderConfigModal (gate), audit.ts, approvals.ts, runsStore, demo.ts, useVoice (transition), onboarding `setDefault` |
| `'up'` (credential writes) | `status === 'ready'` **only** | onboarding key save; ProviderConfigModal engine-broker key save — a secret is never handed to a `degraded` (contract-unobserved) engine |
| `'down'` | `'disconnected'` | banner, Composer, chatStore hard-down |
| `'unauthorized'` | `'failed'` (+reason) | banner, Composer, chatStore hard-down (any `failed` blocks send) |
| test casts `'down'/'up' as never` | `'disconnected'/'ready'`, casts dropped | `frontend-stores.test.ts:33,43,56` (assertions unchanged) |

Untouched non-engine statuses include OnboardingScreen's own `'checking'`
(onboarding store), palette/voice/download states (grep-verified: the only
surviving `'checking'` engine-adjacent hits are that store's own).

### 4.4 Diagnostics (`desktop/src/engine/diagnostics.ts` + DiagnosticsTab + banner)

Allow-list construction only. The complete field universe is exported as
`DIAGNOSTICS_FIELDS`: `generatedAt, appVersion, engineVersion,
contractVersion, readiness, endpointVia, endpointPort, endpointReason,
consecutiveFailures, lastError, stderrSource, stderrTail`. The builder
takes no token-typed input — a cast-smuggled `token` field cannot enter the
output (specimen test). The stderr tail is treated as untrusted and
redacted line-by-line (`Authorization`, `Bearer …`, `?token=`/`api_key=`,
`token:=`, `sk-…`, and the daemon token's exact 48-hex shape). Outside
Tauri the bundle states `stderrSource: not-available-outside-tauri` instead
of faking a tail. Surfaces: banner **Copy diagnostics** button;
DiagnosticsTab **Copy diagnostics** button with an honest manual-copy
fallback (bundle rendered) when the clipboard refuses; DiagnosticsTab also
gains the negotiated **Contract** row and the five-state label set
(including `Failed (reason)`).

### Banner (EngineDownBanner)

Per-state title/detail/action copy for `degraded`, `disconnected`
(≥2 failures, as before), and each `failed(reason)`; `data-status` /
`data-reason` attributes added; `via: 'sidecar'|'dev-proxy'` behaviour
preserved (`canStart` rule unchanged).

## 2. Evidence (commands actually run, this machine, Bun 1.4.2 pinned)

```
§3.3 live probe (before AND after; isolated XR_HOME, token from token-file, value never printed)
  before: health 200 {ok,ts} · meta 401 anon / 200 {version,host,lan,deviceName}
  after : health 200 {ok,ts} · meta 401 anon / 200 {…legacy four…, contractVersion:1,
          minDesktopVersion:"0.2.0", schemaVersion:12, capabilities:[292 op ids…]}
bun test (7 adjacent files §10.2)          → 94 pass / 0 fail            EXIT 0
bun run api:schema:check / client:check / api:compat → 0 / 0 / 0
bun run typecheck (preflight + root tsc + desktop tsc) → EXIT 0
boundaries / placeholder-lint / claim-lint / desktop:sink-lint /
  hot-path-lint / security:check / size-gate → all EXIT 0
segmented parity (scripts/parity-suite-runner.sh linux, excl. e2e-blackbox)
  → 5146 pass / 0 fail / 41 skip / 476 files, executed 476/476          EXIT 0
  (= E-41 baseline 5122/0/41/474 + exactly the 24 new P01 tests in 2 new files)
bun run changelog:check                    → EXIT 1  (D-020; resolved by D-026 → XR-P08)
fail-before: product paths reverted to origin/main, tests kept
  → meta test fails ONLY on the new fields (behavioral); readiness file
    fails to load (new exports absent); suite restored → 24/0. 
negative: one consumer reverted to `status === 'up'` → desktop tsc EXIT 2
  (TS2367 no-overlap); restored, md5 verified.
every other `bun run ci` sub-gate run individually → EXIT 0
  (release:check, channel:check, platform:parity:check, ci-capability-gate,
   ownership:check, website:marketplace:check, baseline:inventory*)
  *inventory artifacts regenerated by the check were removed, not staged.
`bun run ci` as a whole was NOT run green and is NOT claimed green:
  its monolithic `bun test` is substituted by the segmented runner per the
  prompt, and `changelog:check` remains EXIT 1 (owner terrain, D-026).
```

## 3. Acceptance mapping

| ID | Verdict (executor) | Pointer |
|---|---|---|
| P01-AC1 | PASS | §2 live probe (after) + meta test field assertions; legacy four unchanged in test |
| P01-AC2 | PASS | empty diff on system.routes/server/pinning test; guard test in meta file; origin-host-guard green in 94/0 |
| P01-AC3 | PASS | type decl in engineStore; mapping table §1; surviving old-literal engine comparisons: 0 (grep §2; 2 onboarding-store hits are that store's own) |
| P01-AC4 | PASS | `nextEngineState` reachability + no-handshake-no-ready tests (readiness file) |
| P01-AC5 | PASS | legacy evaluator + store tests: `degraded`, message names restart/update, never `ready` |
| P01-AC6 | PASS (logic) / tail capture native-`Not run` | deadline tests pure + store; `ENGINE_BOOT_DEADLINE_MS=30_000`, `ENGINE_REQUEST_TIMEOUT_MS=10_000`; tail fetch uses existing `engine_logs_tail`; the Tauri IPC leg itself is `Not run` (no native shell here) |
| P01-AC7 | PASS | `EngineIncompatible` reasons end-to-end in store tests; `failed(unauthorized)` ≠ `failed(crashed)` test |
| P01-AC8 | PASS | specimen: 5 planted secrets absent, exact label allow-list asserted, smuggled-field case |
| P01-AC9 | PASS | `bun run typecheck` EXIT 0; census table §1; negative stale-`'up'` → tsc EXIT 2 |
| P01-AC10 | PASS | four checks EXIT 0; regenerated via `api:schema:generate`, `client:generate`, `desktop:ipc-acl --write` (module-count descriptions only; zero ACL grant changes) |
| P01-AC11 | PASS | diff stat in PR; the only src-tauri files are the 3 generated capability JSONs (description counts); **no `.rs` file changed** |
| P01-AC12 | PASS | 5146/0/41/476 vs 5122/0/41/474 (Δ = +24 tests, +2 files, both mine) |
| P01-AC13 | PASS (as disclosure) | §2: `bun run ci` not claimed green; sole red sub-gate `changelog:check` EXIT 1 (D-020/D-026 → XR-P08); all other sub-gates enumerated EXIT 0 |
| P01-AC14 | PASS | §5 Not run list |

## 4. Deviations & discoveries (all disclosed, none silently absorbed)

- **D1 — constants' home.** Prompt places the constant in `contract.ts`;
  that file is size-waiver-capped with a documented "two lines per phase,
  entries in your own contract-<phase>.ts" plan. Constants live in
  `contract-engine.ts`, re-exported from `contract.ts` (+2 lines exactly,
  waiver register updated with reason — the register's own process, as in
  Phases 21/30/2.4/RC-608). First parity run caught this (size-gate FAIL);
  fixed in `0ff86cbe`, full parity re-run green.
- **D2 — E-38 correction (E-47).** `meta.version.get` was already in
  `API_CONTRACT` via `contract-mobile.ts`; the "hence absent from OpenAPI /
  registry skips it" claim does not hold. The §0 relocation decision itself
  (session-gated endpoint, health untouched) is unaffected.
- **D3 — Store-level `crashed` via Tauri invoke is not unit-covered** (needs
  the native `engine_link`); the transition is covered in the pure-function
  tests and the probe classification is code-reviewed against
  `engine.rs`'s `spawned:false + reason` shape. Recorded, not hidden.
- **D4 — dom-shim latent bug fixed.** `document.createElement` lacked a
  `style` object; react-dom's import-time vendor probe crashed
  (`style is not an Object`) whenever a shim-importing test file loaded
  before the first sonner consumer — order-dependent, latent at baseline
  (proven: shim-only probe + frontend-stores fails at `4adcec2`). One-line
  shim fix; full segment deterministic afterwards.
- **D5 — Baseline moved by owner action.** Started preflight at `4adcec2`;
  owner instructed PR #207 be made green and merged first (Windows parity
  port-49777 collision — a flake in `test/perf` dashboard test on a
  docs-only PR; fixed by rerunning the failed job, no code change; merged
  once all 4 required aggregates were green). Branch rebased onto
  `5c73faa9`; product tree vs `4adcec2` identical.
- Decision recorded as **D-027 (PROPOSED)**: contract constants home +
  API_CONTRACT finding + capabilities derivation choice. Numbering note:
  prompt anticipated D-024+; PR #207 took D-024…D-026, so D-027 is next.

## 5. Not run (explicit)

Native Windows behaviour; native macOS behaviour; any on-display desktop
renderer session (banner/DiagnosticsTab rendering is covered by store-level
logic tests + typecheck only — no screenshot is claimed as evidence); the
Tauri IPC leg of `engine_logs_tail`/`engine_restart`; audio; live provider
calls; `cargo check`/Tauri build (no Rust changed; `git diff` proves it);
monolithic `bun run ci` (segmented runner substituted; `changelog:check`
EXIT 1 is D-020/D-026, scheduled to XR-P08 — not fixed here, per scope).

## 6. Reproduction / revert

Additive and reversible: remove the four payload fields, the handshake, and
restore the five-value status union via the inverse of the §1 mapping
table. No migration, no protocol change, no spawn-argument change. The
state-machine migration is its own commit (`7ed4e47a`) for unit
review/revert.
