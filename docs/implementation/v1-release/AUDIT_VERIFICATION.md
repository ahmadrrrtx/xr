# XR v1 — Audit Verification Matrix

**Verification owner:** Plan Owner (Principal Architecture / Release Gatekeeper)
**Verified baseline commit:** `6b9cb599aebbe8d8de8b100370c3a6434c3240e0` (`main`, merge of PR #204)
**Baseline date:** 2026-11-01 (Asia/Karachi)
**Supplied audit under verification:** `XR_Release_Readiness_Audit_and_Roadmap.md` (external reviewer, 2026-11-01)
**Evidence location:** [`EVIDENCE_LOG.md`](EVIDENCE_LOG.md) (chronological), this file (per-finding)

> **Status vocabulary** (six allowed values): `CONFIRMED` · `PARTIALLY CONFIRMED` ·
> `NOT REPRODUCED` · `DISPROVEN` · `UNVERIFIED`.
> A finding is **never** `CONFIRMED` because a README says so, an agent claims it,
> or a test file merely exists. Every verdict below cites a path, a command, or a
> recorded environment limitation.

---

## 0. How to read this document

The supplied audit mixes four different kinds of statement, and the plan must not
treat them identically:

| Kind | Example in the audit | What verification can establish |
|---|---|---|
| Repository **fact** | "README documents 26 provider presets" | Whether the repository still says/behaves that way at this commit |
| **User-reported symptom** | "Windows desktop turns black during onboarding" | Whether a cause is present in code; whether it reproduces on that OS |
| **Diagnostic hypothesis** | "the black screen is a Tauri startup failure" | Whether the hypothesis is supported, contradicted, or untestable here |
| **Recommendation** | "replace the fragile wizard with a resumable state machine" | Whether a gap exists — not whether the recommendation is the only fix |

Most P0 audit rows are **symptoms without a reproduction**. This matrix therefore
records, for each row, the *strongest evidence actually obtainable* and refuses to
promote an untested platform symptom into a confirmed defect.

**Environment constraints that bound every "UNVERIFIED" below** (recorded once, cited
by ID in the table): Linux x64, 2 CPU, 1.9 GiB RAM, no swap; **no** Windows host, **no**
macOS host, **no** display server for native Tauri GUI, **no** OS keychain daemon
(`secret-tool` absent — the engine printed its documented file-fallback warning),
**no** paid provider credentials, **no** admin rights to fetch GitHub Actions job logs.
See `EVIDENCE_LOG.md` §1.

---

## 1. Verification lead: the audit is stale for the provider and demo-data findings

Three of the audit's most severe user-reported symptoms were **already repaired on
`main` before the audit was written**, in commits dated 2026-11-01:

| Repair commit | What it changed |
|---|---|
| `49112b16` — "fixes 2026-11-01: … full 26-provider engine catalog in the app …" | `desktop/src/engine/providerCatalog.ts` + engine `GET /api/v1/providers` metadata enrichment |
| `65492a23`, `136c5734`, `4f8b6f2d` | desktop installer/bundle pipeline dispatch records |
| `d2c6d8a2` — "make every PR lane green — 4 real breaks + the 2026-11-01 OSV advisory wave" | CI lane repair |

The audit's own scope note says it is "a public-repository and architecture review, not
a hands-on reproduction". It is accurate as an architecture review, but its
**provider-count** and **fake-data** claims no longer describe this commit. That is a
material discrepancy and it changes the phase ordering (see `MASTER_PLAN.md` §D/§F).

---

## 2. Verified audit matrix

### AUD-001 — Windows desktop black screen during onboarding

| Field | Value |
|---|---|
| Original claim | On a clean Windows install the desktop opens, then turns black during onboarding. |
| Verification status | **UNVERIFIED** (root cause); **CONFIRMED as a defect class** (no onboarding-level error boundary) |
| Evidence | `desktop/src/App.tsx:167` wraps the router in `<ErrorBoundary>`; there is **no** boundary inside `OnboardingWizard` (`desktop/src/screens/Onboarding/index.tsx`), so a throw in any of the 10 step components unwinds to the app-level boundary. `OnboardingScreen`/`OnboardingGate` return `null` while `isOnboardingComplete()` is pending (`OnboardingScreen.tsx:28,51`) — a `null` render is indistinguishable from a black window if the promise never settles. `desktop/src/lib/detect.ts` is statically imported by 4 onboarding steps and dynamically imported by `StepDownload.tsx` (Vite warns `[INEFFECTIVE_DYNAMIC_IMPORT]`, build log in `EVIDENCE_LOG.md` E-07), so the step that is meant to lazy-load a heavy detection module actually loads it eagerly on first paint. Issue #183 (open, `windows-latest`) records a Windows-only failure in `test/daemon/builder-routes.test.ts:293` (`findFreePort`/`Bun.serve` seam) — a different subsystem, so it does **not** explain a renderer black screen. |
| Reproduction | **Not reproducible here**: no Windows host, no display server for a native Tauri webview. Renderer-level reproduction was not attempted because the reported symptom (black window) differs from a renderer exception, which would render the ErrorBoundary UI. |
| Root cause | **Unknown.** Three candidates remain live and are *distinguishable by evidence the executor must collect*: (a) uncaught renderer throw in an onboarding step, (b) `isOnboardingComplete()` never settling → permanent `null` render, (c) sidecar/Tauri webview resource-path failure on Windows leaving an empty document. |
| Scope | Windows (reported); the `null`-render window and the missing wizard boundary are cross-platform. |
| Severity | **Release-blocking** (clean-install journey cannot complete). |
| Dependencies | `desktop/src/screens/Onboarding/*`, `desktop/src/stores/onboarding.ts`, `desktop/src-tauri/src/engine.rs`, `desktop/src/lib/detect.ts`. |
| Proposed remedy | Decompose in `XR-P02`: per-step error boundary + a bounded, observable readiness state machine for onboarding; make the `checking` render a real "Starting…" surface instead of `null`; then require native Windows evidence before closing. |
| Regression test | Renderer test that each onboarding step is wrapped by a boundary and that a thrown step renders a recoverable card, not a blank document; a test that `isOnboardingComplete()` has a timeout path. |
| Plan disposition | **IMPLEMENT** — split from the audit's "fix the black screen" into verifiable code-level causes + an evidence requirement for the OS-level claim. |

### AUD-002 — Linux install succeeds but desktop reports engine not connected

| Field | Value |
|---|---|
| Original claim | Linux install completes; the desktop then says the engine is not connected. |
| Verification status | **PARTIALLY CONFIRMED** — lifecycle design verified sound; the *user-visible failure path* is under-specified; one concrete contract gap found. |
| Evidence | Sidecar design is real and well-defended: `desktop/src-tauri/src/engine.rs:124` spawns the bundled sidecar with `serve --port 0 --parent-pid <shell pid>`, parses the daemon banner (`✓ Listening on http://127.0.0.1:<port>`, `Token: <48 hex>`) via `engine_state.rs:43`, and contains the child (`Job Object` on Windows `win.rs`, `PR_SET_PDEATHSIG` on Linux `unix.rs`, parent-watch on macOS). Engine home is **deliberately independent**: `desktop_home.rs:5` → `~/.xr-desktop` (or an absolute `XR_DESKTOP_HOME`), and `engine.rs:144` forces `XR_HOME` to it. Failure is reported honestly, not faked: `engine_link` returns `spawned:false` plus a reason, and `EngineDownBanner.tsx` shows Retry / Start engine / Diagnostics with the last error. **Contract gap:** the desktop performs **no API/schema version negotiation** — `desktop/src/engine/transport.ts` contains no `apiVersion`/compat handshake (grep: zero matches), and no UI surface shows the engine's version even though `GET /api/v1/health` returns `apiVersion:"v1"` (`src/daemon/routes/meta.routes.ts:45`). A stale sidecar paired with a newer renderer therefore degrades silently instead of showing an actionable incompatibility. |
| Reproduction | Engine boot verified live on Linux: `bun run src/index.ts serve --port 47831` → honest banner, unauthenticated request returns **401**, authenticated `GET /api/v1/providers` returns **200 with 26 providers** (E-05, E-06). The *desktop→sidecar* link cannot be exercised here (needs a native webview). |
| Root cause | Not one cause. The "not connected" symptom is consistent with (i) a genuinely failed sidecar spawn whose reason the user does not read, (ii) an unconditionally shown banner whose wording overstates the failure, (iii) version skew with no negotiation. Only (iii) is proven present. |
| Scope | Linux reported; containment mechanisms and the version gap are cross-platform. |
| Severity | **Release-blocking** (first-run blocked), but the subsystem is healthier than the audit implies. |
| Dependencies | `engine.rs`, `engine_state.rs`, `desktop/src/stores/engineStore.ts`, `desktop/src/components/engine/EngineDownBanner.tsx`, `desktop/src/engine/transport.ts`, `src/daemon/routes/meta.routes.ts`. |
| Proposed remedy | `XR-P01`: add an explicit startup handshake (engine build/schema id + supported contract version), surface `Starting/Ready/Degraded/Disconnected/Failed(reason)` with the version, and add capability negotiation that fails **closed and actionable** on mismatch. Do not redesign the sidecar. |
| Regression test | Contract test: a sidecar reporting an incompatible schema version makes the desktop show a blocking, actionable state (not a spinner, not "connected"); a sidecar that never prints a banner yields a bounded timeout with the captured stderr tail. |
| Plan disposition | **IMPLEMENT** (`XR-P01`), with the audit's blanket "fix the lifecycle" narrowed to the verified gaps. |

### AUD-003 — UI shows only ~4 providers despite many configured (incl. custom endpoints)

| Field | Value |
|---|---|
| Original claim | Only about four providers appear although many presets and custom OpenAI-compatible endpoints were configured. |
| Verification status | **DISPROVEN** for the current commit as stated (catalog); **PARTIALLY CONFIRMED** for a narrower, different defect — the *configured* provider list is not engine-derived. |
| Evidence | (1) Engine truth: `PRESETS` contains **26** entries — 16 hosted + 10 local (`src/providers/presets.ts`, counted by executing the module: E-04). (2) Live API: authenticated `GET /api/v1/providers` at runtime returned **200, 26 rows** with `description`, `docsUrl`, `baseUrl`, `authType`, `keyless`, `knownModels`, `hasKey`, `authOk`, `healthy`, `authState`, `healthState` (E-06). (3) Desktop catalog: `desktop/src/engine/providerCatalog.ts:206` **derives** the "Add a provider" list from the engine response, grouped Hosted/Local/Custom, and is consumed by `desktop/src/screens/Settings/tabs/ModelsTab.tsx:107`. (4) Pinned tests pass at HEAD: `test/providers/offline-listing.test.ts` (3 pass, 251 assertions) and `test/desktop/provider-catalog.test.ts` (6 pass) (E-08). **However:** the *configured* provider list rendered in Settings (`providers` at `ModelsTab.tsx:299`) comes from the **desktop settings store** (`models.providers`, `settingsStore.ts:34-46`, default `[]` at `settingsStore.ts:199`) and is written **only** by this dialog (`ModelsTab.tsx:197,219`). No code path mirrors the engine's configured providers into it, and `engineKnowsProvider()` fails **open** when the engine is down (`desktop/src/engine/providers.ts:33-36`). Also, when the engine is unreachable the catalog shows a 10-entry `FALLBACK_IDS` list flagged `degraded`, and onboarding falls back to a **5-entry** list (`StepModelSetup.tsx:31-38`). The user-reported "~4 providers" matches none of these exactly but is closest to an offline/engine-down render — which is itself evidence that the engine link (AUD-002) is the upstream cause. |
| Reproduction | Catalog count reproduced live (26). Desktop rendering not runnable (no webview). Configured-list divergence established by static call-graph inspection (no `update('models', {providers})` caller outside the two dialogs). |
| Root cause | **Two sources of truth for "which providers exist for me":** the engine's preset/connection state (authoritative for the catalog) and the desktop settings store (authoritative for the configured rows). The gate `desktop:sink-lint` and the 26-provider tests do not cover this join. |
| Scope | Cross-platform (pure renderer/store logic). |
| Severity | **Release-blocking** (provider setup is the core of first-run). |
| Dependencies | `desktop/src/engine/providerCatalog.ts`, `desktop/src/stores/settingsStore.ts`, `desktop/src/engine/providers.ts`, `desktop/src/screens/Settings/tabs/ModelsTab.tsx`, `src/daemon/routes/providers.routes.ts`. |
| Proposed remedy | `XR-P03`: make the engine the single owner of "configured providers"; render the Settings list from engine state (`configured` vs `preset` vs `custom`), keep presentation metadata local, and fail **closed** on an unknown provider id. Preserve, do not replace, the existing catalog module. |
| Regression test | A test that a provider configured engine-side appears in the desktop list without any desktop write; a test that `engineKnowsProvider()` refuses to answer `true` when the engine list is unavailable. |
| Plan disposition | **IMPLEMENT** (`XR-P03`), narrower than the audit's "reconcile everything". |

### AUD-004 — Onboarding has nonfunctional/decorative elements; no terms or privacy acceptance

| Field | Value |
|---|---|
| Original claim | Onboarding has nonfunctional visual elements, no clear terms/privacy acceptance, incomplete install feedback, and a voice picker whose sample cannot be heard. |
| Verification status | **PARTIALLY CONFIRMED.** Terms/privacy acceptance: **CONFIRMED absent**. Voice preview: **CONFIRMED to preview a different voice than it configures** (the reported "cannot be heard" cause is `UNVERIFIED`). Install feedback: **DISPROVEN** for the model-download step. Success predicate: **CONFIRMED absent.** |
| Evidence | **Terms/privacy (CONFIRMED):** grep for `termsAccepted\|privacyAccepted\|acceptTerms\|consentVersion` across `desktop/src/` returns **zero** matches; `grep -rn "terms\|privacy\|consent" desktop/src/screens/Onboarding/*.tsx` returns **zero** matches. Step 2 (`StepPromise.tsx:23`) gates Continue on a checkbox labelled "understood" over three marketing promises ("Local-first", "Private by default", "Nothing leaves this device without your explicit permission") — that is a *pledge*, not a versioned acceptance record, and no timestamp/version is persisted. There is no `TERMS`/`EULA`/`PRIVACY` document at repo root (`docs/privacy/` contains only `MEMORY.md`). **Voice (CONFIRMED, different cause):** `StepVoice.tsx:30` previews with **the OS Web Speech engine**, `new SpeechSynthesisUtterance(SAMPLE[id] ?? …)`; the voice it *persists* is a **Piper engine id** (`piper-kusal` etc.). The user therefore hears a different voice from the one being configured — a real honesty defect. Whether "no audio at all" is caused by Tauri webview `speechSynthesis` being unavailable is **UNVERIFIED** here (no display/audio). **Install feedback (DISPROVEN):** `StepDownload.tsx:11` streams **real NDJSON progress from Ollama's pull API** with completion/error states and a retry path. **Success predicate (CONFIRMED absent):** `StepAllSet.tsx` contains no engine/health/provider assertion; `finishOnboarding()` persists choices and flips the flag, so the wizard reaches "done" whether or not the engine is healthy, and note `OnboardingGate` (not a health check) is what routes the user into the app. |
| Reproduction | Static inspection only for the UI; no display server. Engine-side readiness (`/api/v1/health`) was exercised live (E-06). |
| Root cause | Onboarding was built as a *narrative* (promises + preferences) with persistence, not as a *state machine with success predicates*; voice preview was wired to a convenient-but-different engine. |
| Scope | All platforms. |
| Severity | **Release-blocking** — the audit is right that shipping without a consent record is not releasable, and it is a truthfulness defect (AUD-011). |
| Dependencies | `desktop/src/screens/Onboarding/*`, `desktop/src/stores/onboarding.ts`, `desktop/src/stores/engineStore.ts`, `src/voice/models.ts`, `src/daemon/routes/onboarding.routes.ts`. |
| Proposed remedy | `XR-P02`: add a versioned terms/privacy/data-flow acceptance step with persisted `{version, acceptedAt}` (re-openable from Settings); replace the "understood" checkbox semantics with real acceptance; add an explicit success predicate (engine healthy + provider configured-or-consciously-skipped); make the voice sample use the **engine** TTS path or label the preview honestly as an approximation with a working failure state. |
| Regression test | Acceptance is persisted with a version and blocks completion until accepted; a wizard run with a deliberately unhealthy engine cannot report success; voice preview either plays engine audio or renders the labelled stand-in — never an unlabelled substitute. |
| Plan disposition | **IMPLEMENT** (`XR-P02`); add the legal-document *content* as an explicit owner decision (`DECISIONS.md` D-004). |

### AUD-005 — UI displays apparently fake/pre-populated budget, logs, brain-cell or other runtime data

| Field | Value |
|---|---|
| Original claim | The UI shows fake or pre-populated budget, logs, "brain cell" or other runtime data. |
| Verification status | **DISPROVEN at this commit** (the seed path exists but is debug-only and the production bundle is proven clean). |
| Evidence | The historical defect is real and already repaired: `desktop/src-tauri/src/seed_purge.rs:1` documents that earlier builds wrote ~220 spend rows, a 204-entry audit chain and three demo skills into `xr.db` on first launch; releases no longer seed. Gate logic: `demo_data_enabled()` = `cfg!(debug_assertions) && XR_DEMO_DATA=1` (`seed_purge.rs:29-35`). Renderer equivalents are gated: `desktop/src/budget/api.ts:322` (`import.meta.env.DEV && VITE_XR_DEMO_DATA==='1'`), `desktop/src/lib/llm.ts:141-156` (mock LLM requires `VITE dev` + `localStorage['xr.dev.mockLLM']='1'`). `desktop/src/brain/demo.ts:21` falls back to a canned run **only** when no provider answers, and labels it `"Demo run (no model configured)"`. **Production-bundle proof (this verification):** `cd desktop && bun run build` → exit 0 (E-07), then `scripts/desktop-seed-gate.ts` → `OK — 7 seed probes absent from desktop/dist` (E-09). Budget screen reads the engine/governor (`budgetStore.ts:4`) not a fixture. `grep -rin "brain cell"` → **zero** matches (the metric does not exist). |
| Reproduction | Build + gate executed here; result recorded in `EVIDENCE_LOG.md`. |
| Root cause | N/A at HEAD — historical, already fixed. Residual risk: an **installed** pre-fix home could still carry seed rows; `seed_purge.rs` is exactly the idempotent cleanup for that and runs on every open. That cleanup path is covered by Rust unit tests but **not** by an end-to-end test on a real seeded database in this environment. |
| Scope | Cross-platform; residual risk only for upgrades from old builds. |
| Severity | Would be release-blocking; currently **not a blocker**. |
| Dependencies | `desktop/src-tauri/src/seed_purge.rs`, `scripts/desktop-seed-gate.ts`, `desktop/src/budget/api.ts`, `desktop/src/lib/seedPurge.ts`. |
| Proposed remedy | `XR-P04`: add a *regression* that builds a deliberately seeded database, opens it through the real startup path, and asserts the rows are gone and the UI's numbers come from the surviving ledger. Keep the seed gate in CI. |
| Regression test | Seed → purge → empty dashboard, End-to-end, in the desktop test lane. |
| Plan disposition | **IMPLEMENT (narrowly)** — convert "it's already fixed" into a pinned guarantee; do not rebuild the data layer. |

### AUD-006 — Permissions for file opening and other machine capabilities incomplete or invisible

| Field | Value |
|---|---|
| Original claim | Permissions for file opening and other machine capabilities are incomplete or not visible. |
| Verification status | **PARTIALLY CONFIRMED.** Enforcement is real and engine-side; **visibility/policy UX** is the gap, and `reveal_path` is deliberately narrow. |
| Evidence | Engine-side gating is genuinely below the UI: `src/execution/service.ts:1046-1103` refuses a capability that requires approval unless a real approval arrives (`requires_approval` → `denied` with `code:"approval_unavailable"` when the gate cannot ask), records `execution.approval_requested/granted/denied` in the audit chain, and the tool table assigns `requiresApproval` per tool (`src/tools/files.ts:33`, `src/tools/git.ts:67`). Capability policy lives in `src/capabilities/{policy,grant,authorize,request}.ts`. OS opening is intentionally restricted: `desktop/src-tauri/src/reveal_policy.rs:1` allows only XR-owned roots, opens **inert** extensions in the default app, and merely *reveals* everything else ("a webview bug must not be able to execute a binary via the OS opener"). There is a `Shield` screen and `desktop:ipc-acl` gate (`package.json`), so capability *inventory* is machine-checked. The gap the audit names — the user cannot see or steer the whole capability set in one place, and per-capability scopes are not presented as policy decisions — is consistent with the code: capability UI is distributed across `Shield`, `Settings`, and approval modals. |
| Reproduction | Engine approval-denial path is exercised by the existing suite (`test/security/`, `test/trust/`, `test/capabilities/` segments all green in E-12). Renderer permission surfaces not executable here. |
| Root cause | Enforcement exists; **presentation and scope-granting** were never consolidated. No UI-only permission system exists — the audit's fear is not realized, so the fix is a read/view over the real policy engine. |
| Scope | All platforms (enforcement); shell-specific for OS opener and sandbox. |
| Severity | High (trust), release-relevant but not a data-loss class by itself. |
| Dependencies | `src/capabilities/*`, `src/security/{guard,filesystem,shield}.ts`, `desktop/src/screens/Shield/*`, `desktop/src/components/approvals/ApprovalModal.tsx`, `src/daemon/routes/capabilities.routes.ts`. |
| Proposed remedy | `XR-P05`: a single capability/permission surface driven by `GET /api/v1/capabilities` showing effective policy, scope and last decision, with grant/revoke that writes through the engine's grant API. **No new policy engine.** |
| Regression test | Contract test: a capability granted in the UI changes the engine's decision for the *exact* action and nothing else; revoking it denies with an audit row. |
| Plan disposition | **IMPLEMENT** (`XR-P05`). |

### AUD-007 — Chat lacks live task progress, artifact shelf/preview, reliable file opening

| Field | Value |
|---|---|
| Original claim | Chat does not provide clear live task progress, an artifact shelf/preview, or a reliable way to open generated files. |
| Verification status | **CONFIRMED** for artifacts (no artifact concept in Chat at all). Task progress: **PARTIALLY CONFIRMED** (rich events exist engine-side; the Chat composer lacks a stage/timeline view). |
| Evidence | **Artifacts (CONFIRMED):** `grep -rn "artifact" desktop/src/screens/Chat/` → **zero** matches; `desktop/src/screens/Chat/components/` contains no artifact panel. There is **no generic artifacts API**: the only `artifact` route in the whole daemon is `business.artifacts.list` (`src/daemon/routes/business.routes.ts:224`, `stability:"experimental"`), and no `ArtifactRecord` type exists anywhere (`grep ArtifactRecord src/ desktop/src/` → zero). The engine has an **artifact *verifier*** for multi-agent missions (`src/services/multi-agent-orchestration.ts:210` `buildArtifactManifest()`; README:461) — verification of *claimed* files, not a persisted artifact library. **Progress (PARTIALLY CONFIRMED):** the event stream is real and tested — `test/api/chat-stream.test.ts` proves ordered token deltas, `provider_ready` before first token, `tool_call`→`tool_result`→continuation, truthful error events, one `[DONE]`, and mid-turn cancellation (E-12, 15 tests). The Chat surface renders streaming text, `ToolCallCard`, `TurnErrorCard` and a streaming cursor — but has no explicit stage/timeline affordance for planned→running→verifying. |
| Reproduction | Artifact absence is a static fact; streaming verified by the engine test suite (green). |
| Root cause | Two different meanings of "artifact" were conflated in the product: the multi-agent *verifier* was never extended into a **persisted artifact record + UI**. |
| Scope | All platforms. |
| Severity | **Release-blocking** for the Chat promise; the audit is right that this is the largest missing user-facing capability. |
| Dependencies | `src/state/` (schema/migrations), `src/daemon/routes/*` (new versioned route), OpenAPI contract (`docs/api/openapi.json` + `scripts/generate-openapi.ts`), generated client (`src/clients/daemon-client.generated.ts`), `desktop/src/screens/Chat/*`, `src/security/filesystem.ts`, `desktop/src-tauri/src/reveal_policy.rs`. |
| Proposed remedy | `XR-P06`: a **new, additive** `ArtifactRecord` (id, run/session/agent, workspace-relative path, MIME, size, content hash, created/updated, verification state) persisted on file-producing tool outcomes, exposed via a versioned read API, rendered in Chat + a global library, with a sandboxed preview and a reveal/open path that reuses `reveal_policy`. Verification is *earned*: a record whose file is missing or whose hash differs is shown as such. |
| Regression test | A run that writes a file yields exactly one verified record; after restart the record and preview still resolve; a record pointing outside the workspace is refused; a claimed-but-absent artifact renders as failed, never as success. |
| Plan disposition | **IMPLEMENT** (`XR-P06`), and it is a *new capability*, so it is gated behind the truthfulness phases. |

### AUD-008 — No automations UI / scheduled tasks unreachable from the desktop

| Field | Value |
|---|---|
| Original claim | The user wants scheduled automations (and other capabilities); the product does not expose them. |
| Verification status | **CONFIRMED.** |
| Evidence | The engine scheduler is real: `src/automation/triggers.ts` (`TriggerService`, durable pause flag, in-flight abort map, `setInterval` loop), wire into the daemon at `src/daemon/server.ts:836`, contract entries `triggers.list/create/pause/get` (`src/daemon/routes/contract.ts:322-343`), routes at `src/daemon/routes/triggers.routes.ts`. **The desktop cannot reach any of it:** `grep -rn "triggers\|/api/v1/triggers" desktop/src/` → **one** match, an unrelated sentence in `screens/Voice/components/sections.tsx:244`. There is no Automations screen in `desktop/src/router.tsx`, and `src/automation/` has exactly one test file (`test/automation/triggers.test.ts`). |
| Reproduction | Static: route table vs. desktop route table + client call-site grep. |
| Root cause | Engine capability shipped without a surface; the parity gate (`platform:parity:check`) checks *test* distribution, not *surface* coverage. |
| Scope | All platforms. |
| Severity | High — feature promised in README, unreachable in the shipping surface. **Not** release-blocking if honestly documented; release-blocking if the release notes claim automations. |
| Dependencies | `src/automation/*`, `src/daemon/routes/triggers.routes.ts`, `desktop/src/router.tsx`, `desktop/src/stores/*`, budget governor. |
| Proposed remedy | `XR-P07`: an Automations surface over the existing endpoints (list/create/pause/resume/history + global stop), with the automation run going through the **same** runner/budget/approval path, and honest `next run`/`last result` from persisted state. |
| Regression test | Create a schedule in the UI → it appears engine-side; pause-all stops fires; a fire that exceeds budget is refused by the shared governor, not a local check. |
| Plan disposition | **IMPLEMENT** (`XR-P07`) after truthfulness; document as deferred if P07 slips. |

### AUD-009 — CI supply-chain failure and Windows lifecycle issue #183

| Field | Value |
|---|---|
| Original claim | A scheduled Supply Chain workflow failed 2026-10-28; issue #183 records a Windows lifecycle failure; recheck at the release commit. |
| Verification status | **PARTIALLY CONFIRMED, and materially out of date.** Live recheck at `6b9cb599` (2026-11-01) shows **two failing workflows the audit does not mention**, and Supply Chain **passing**. |
| Evidence | GitHub API, branch `main`, `head_sha=6b9cb599…`: `CI` → success; `Clean-Machine Journey` → success; `Channel Install Tests` → success; `npm Pack Smoke` → success; **`Supply Chain` → success**; **`Cross-Platform CI` → failure**; **`Desktop App (Tauri packaging)` → failure**. Failed jobs: `Cross-Platform CI` → `macOS — full parity (typecheck + suite + golden path)` step `Full unit suite for this OS`; `Desktop App` → `Desktop journey — linux-x64 on ubuntu-22.04` and `… ubuntu-24.04` step `Journey`, plus the two aggregate gate jobs. (E-14.) Job **logs are not retrievable** — the logs endpoint returned `403 Must have admin rights to Repository` (E-15), so root cause for both is **UNVERIFIED**. On the same SHA the *Linux* suite passed locally (**5119 pass / 0 fail / 41 skip, 473/473 files**, E-12), which narrows the `Cross-Platform` failure to macOS and/or runner-environment, and the local `desktop` renderer build passed (E-07) so the Desktop journey failure is *not* a renderer compile break. Issue #183 remains **open** and concerns `test/daemon/builder-routes.test.ts:293` on `windows-latest` (`findFreePort`/`Bun.serve`), a pre-existing Phase-17 path. |
| Reproduction | Suite reproduced green on Linux; the two failing CI jobs are not reproducible without macOS runners / admin log access. |
| Root cause | **Unknown** for both. Recorded as the highest-priority "investigate first" item for `XR-P00`/`XR-P09`. |
| Scope | macOS parity; Linux desktop packaging journey. |
| Severity | **Release-blocking** — a red native lane on the integration commit is disqualifying regardless of what a local Linux run shows. |
| Dependencies | `.github/workflows/cross-platform.yml`, `.github/workflows/desktop-app.yml`, `scripts/parity-suite-runner.sh`, `scripts/journey/*`, `test/quarantine.json`. |
| Proposed remedy | `XR-P09` (release evidence): reproduce on the real runners, capture the failing segment/test names via the runner's own `::error::` annotations, fix or quarantine **with the owner's expiry policy**, and re-run to green at the tagged candidate. |
| Regression test | The failing case must gain a test that fails for the same reason locally/natively before the fix, and the lane must be green at the candidate SHA. |
| Plan disposition | **INVESTIGATE + GATE** (`XR-P09`); no code change until the cause is observed. |

### AUD-010 — AGENTS.md/Constitution governance is instruction-only

| Field | Value |
|---|---|
| Original claim | Prompt instructions cannot stop an agent from changing code and tests together; enforce through GitHub, CODEOWNERS, CI and review. |
| Verification status | **DISPROVEN as stated — CORRECTED.** The audit's *recommendation* (enforce through the platform, not prompts) stands, and part of it is already implemented. My first-pass verdict of "worse than stated" was wrong on the facts; see the correction row below. |
| Evidence | `AGENTS.md` carries hard, CI-enforced rules and `CODEOWNERS` exists with per-subsystem owners. The enforcement substrate **does exist**, via **repository rulesets** (not legacy branch protection): `GET /repos/ahmadrrrtx/xr/rulesets` → `id=19119579, name="main protection", enforcement=active, target=branch, condition refs/heads/main`. Rules in force (`E-32`): `deletion`, `non_fast_forward`, `pull_request` (approvals=0, `require_code_owner_review=false`, `allowed_merge_methods=[merge,squash,rebase]`, `dismiss_stale_reviews_on_push=false`), and `required_status_checks` = **`Quality Gate` ×2 (duplicated entry)** with `strict_required_status_checks_policy=false`. `bypass_actors: []`. Independent confirmation from a real push: direct `git push origin main` was **rejected** with `GH013 … Changes must be made through a pull request · 2 of 2 required status checks are expected` (`E-33`). **Genuine residual gaps** (not the ones the audit described): (a) zero required approvals and `require_code_owner_review=false`, so a PR can be self-approved and merged in one step, making the `CODEOWNERS` protection nominal; (b) only one aggregate check is required — the `Cross-Platform gate` and `Desktop gate` are not; (c) `strict_required_status_checks_policy=false` lets a stale branch merge without re-running against the new base; (d) `dismiss_stale_reviews_on_push=false`; (e) `test/quarantine.json` — a genuine control — runs in a job that is not required. |
| Reproduction | Ruleset API read (`E-32`) + a rejected push attempt (`E-33`). The legacy `GET /branches/main` read in `E-16` reported `protected: false` **while this ruleset was active** — that endpoint does not report rulesets. |
| Root cause | Not "governance was never enforced" — it *is* enforced. The drift is narrower: the required-check set covers only the `ci.yml` aggregate, review enforcement is switched off, and bypass-free PR-only policy has no review depth. |
| Scope | Repository/process, not product code. |
| Severity | **Medium** (downgraded from release-blocking). Enforcement exists; approval depth and native-lane coverage are the gaps. |
| Dependencies | GitHub repository settings (admin), `CODEOWNERS`, `.github/workflows/{ci,cross-platform,desktop-app}.yml`. |
| Proposed remedy | `XR-P00` (narrowed to D-022 + new D-023): set `required_approving_review_count` ≥ 1 and `require_code_owner_review=true`; add `Cross-Platform gate` and `Desktop gate` to required checks **once green** (they are red at `6b9cb599`); consider `strict_required_status_checks_policy`; fix the duplicated `Quality Gate` entry. **Do not** rebuild what already works. |
| Regression test | Not code-testable; verification is a recorded API read showing protection enabled with a named required-check set, plus a negative test (a deliberately red PR cannot merge). |
| Plan disposition | **IMPLEMENT (governance, owner-approved)** (`XR-P00`). |

### AUD-011 — Claims/documents exceed tested evidence

| Field | Value |
|---|---|
| Original claim | Documentation must not claim functionality unsupported by the implementation; the candidate report marks native/signing items BLOCKED/NOT RUN. |
| Verification status | **PARTIALLY CONFIRMED.** The *release identity* claims are honest; some **document files are corrupted** and one **provider claim is stale**. |
| Evidence | Honest claims verified: `README.md:32` says "Status: Developer preview … a preview label does not imply native-platform or signing validation"; `README.md:43-45` says install channels serve `1.0.0` while `1.1.1-rc.1` is in development; `release.manifest.json` sets `stability:"developer-preview"`, `publicVersion:"1.0.0"`, and registers `v1.1.0` as a **withdrawn** tag. Live registry state **matches** the manifest: GitHub latest release = `v1.1.0` (5 assets, not prerelease); npm `dist-tags.latest = 1.0.0` (E-13, E-17). `docs/release/RELEASE_CANDIDATE_REPORT.md:16` states "**Disposition: NOT READY** for public preview or stable publication", with macOS/Windows/native GUI/keychains/install/update **NOT RUN** and signing **BLOCKED**. **Corruptions (CONFIRMED):** a number-fusion defect corrupted prose in at least 8 release doc sets — `RELEASE_CANDIDATE_REPORT.md` has 11 fused tokens (e.g. `across10mandatory surfaces`, `returned **v1.1.0, not prerelease,5assets**`, `.15versioned categories,5smoke`), `docs/release/PROGRESS.md` 21, `V1-RELEASE-LEDGER-2026-10-28.md` 6. `docs/release/1.1.1-rc.1/known-limitations.md:6` says "Stable public defaults remain1.0.0". **Stale claim (CONFIRMED):** `README.md:594` states "**4,972 pass / 29 skip / 0 fail across 450 files** … measured … at `a2b6a735`", while the measured baseline at this HEAD is **5,119 pass / 41 skip / 0 fail across 473 files** — the published number is a *stale, lower* baseline, which the repo's own "claims need evidence" rule makes a bug. |
| Reproduction | Numbers reproduced locally (E-12); registry read live (E-13/E-17); corruption counted by regex scan (E-18). |
| Root cause | (i) A text-corruption bug in the document-authoring step that no gate detects — `claim-lint` checks *claims*, not *readability*; (ii) the test-baseline surface is refreshed manually ("refresh step: RELEASING.md §1g") so it drifted as tests were added. |
| Scope | Documentation/claims; affects trust, not runtime. |
| Severity | High for release credibility; a stale *understated* baseline is a wrong claim in the honest direction, but the corrupt prose is a real release-artifact defect. |
| Dependencies | `scripts/claim-lint.ts`, `docs/release/TEST-BASELINE.json`, `README.md` marker block, all `docs/release/**`. |
| Proposed remedy | `XR-P08`: repair the corrupted documents (content-preserving), add a **documentation integrity gate** that fails on number-word fusion, and wire the test-baseline line to a generated/stamped value so it cannot drift. |
| Regression test | A gate test with a corrupted specimen must fail; a correct specimen must pass; the README baseline must equal the measured run it cites. |
| Plan disposition | **IMPLEMENT** (`XR-P08`). |

### AUD-012 — Release-engineering claims: clean install, upgrade/uninstall, signing, SBOM

| Field | Value |
|---|---|
| Original claim | These are the gates that decide releasability; most are BLOCKED/NOT RUN. |
| Verification status | **CONFIRMED (as a gap).** |
| Evidence | The repo *has* the machinery: `release:verify` (`scripts/verify-release.ts --strict`), `sbom` (CycloneDX), `channel:check`, `write-sums`, `tag-npm-invariant`, `scripts/journey/*`, `clean-machine` workflow, `DESKTOP_SIGNING.md`, `docs/release/support-targets.json`. The candidate report marks: production signing/provenance **BLOCKED**, macOS/Windows/native GUI/keychain/install/update **NOT RUN** (`RELEASE_CANDIDATE_REPORT.md`, §2 table). This environment adds the same limits (no certs, no Windows/macOS). `DEVELOPER ID`/Authenticode material is an owner prerequisite. **Also confirmed:** no `TERMS`/`EULA`/`PRIVACY` document exists, and `docs/privacy/` holds only `MEMORY.md`, so a privacy notice cannot be *referenced* by onboarding even if AUD-004's UI were built. |
| Reproduction | Not possible here for signing/notarization; `bun run release:verify --strict` locally would fail closed on missing owner material — recorded as **expected-blocked**, not run in full to avoid ambiguity. |
| Root cause | Owner-supplied credentials and native runners are genuinely absent; this is inherited risk, not a defect. |
| Scope | Windows/macOS signing; all-platform clean install/upgrade. |
| Severity | **Release-blocking** for a *public stable* claim; acceptable for a **limited developer preview** only if the limitation is stated in the exact words of `known-limitations.md`. |
| Dependencies | Owner: Apple Developer ID + notarization, Windows Authenticode, updater keys, package-registry accounts; CI: native runners. |
| Proposed remedy | `XR-P09`: produce the platform evidence matrix from *actual runs at the candidate SHA*, and require the platform table to say `Verified / Limited / Experimental / Not run / Blocked` per surface. |
| Regression test | N/A (release process); the gate is the recorded evidence pack. |
| Plan disposition | **GATE** (`XR-P09`); owner decisions D-002/D-003. |

---

## 3. Additional defects found during independent inspection (not in the supplied audit)

Stable IDs `XRD-nnn` are used from here on and are **distinct** from `AUD-nnn`.

### XRD-001 — No client↔engine contract/version negotiation (release-blocking)

**Status:** CONFIRMED · **Severity:** release-blocking · **Owner phase:** `XR-P01`
`desktop/src/engine/transport.ts` has no version handshake (zero matches for
`apiVersion|schemaVersion|contractVersion|minEngine`), while the engine advertises
`apiVersion:"v1"` at `src/daemon/routes/meta.routes.ts:45`. Combined with an
**independent** desktop engine home (`desktop_home.rs`), an upgraded app can pair with a
stale sidecar from a previous install and issue requests the old engine does not
understand. Failure mode is degraded-but-silent, which the audit's own "engines must
declare supported capabilities" requirement forbids. **Remedy:** explicit handshake +
actionable incompatibility state + a bounded repair path (respawn bundled sidecar).
**Regression:** mismatch ⇒ blocked UI with a reason; match ⇒ ready.

### XRD-002 — Two competing desktop provider models (configured list vs. engine state)

**Status:** CONFIRMED · **Severity:** release-blocking · **Owner phase:** `XR-P03`
Detail in AUD-003. Additionally `engineKnowsProvider()` (`engine/providers.ts:33`)
returns `providerId !== 'custom'` when the engine list is null — a **fail-open** default
in a path that decides whether a secret may be written to the engine broker. That
contradicts AGENTS.md rule 2 (fail-closed) for a credential-adjacent check.

### XRD-003 — Duplicate "Models" implementation in the desktop (drift risk)

**Status:** CONFIRMED · **Severity:** high (maintainability + inconsistent truth) · **Owner phase:** `XR-P03`
Two independently evolved ~630-line screens render provider/model configuration:
`desktop/src/screens/Settings/tabs/ModelsTab.tsx` (639 lines, engine-catalog-driven,
`keyStorage`, engine broker) and `desktop/src/screens/Budget/components/ModelsTab.tsx`
(621 lines, price-registry-driven, its own `openai`/`anthropic` descriptors at :59/:67,
its own `updateSettings('models', …)` write at :169). They are mounted by different
screens (`Settings/index.tsx:40`, `Budget/index.tsx:26`) and **write the same settings
key**. This is exactly the "duplicate source of truth" the audit warns about, and the
audit did not detect it. **Remedy:** converge on the engine-driven implementation; keep
one write path. **Do not** merge blindly — the Budget view has price/context chips the
Settings view lacks; the shared core must be extracted, not one screen deleted.

### XRD-004 — Onboarding can reach "All set" with no working engine or provider

**Status:** CONFIRMED · **Severity:** release-blocking · **Owner phase:** `XR-P02`
`StepAllSet.tsx` asserts nothing; `finishOnboarding()` persists choices and flips the
flag; `OnboardingGate` gates on that flag only. A fresh user with a dead engine and no
provider key completes the wizard and lands in a shell whose every action fails. The
audit's "the first-run wizard must not proceed to ready until required capabilities are
healthy" is therefore **confirmed as missing in code**, not just as a policy wish.

### XRD-005 — Onboarding is not resumable and its completion state is a single boolean

**Status:** CONFIRMED · **Severity:** high · **Owner phase:** `XR-P02`
`desktop/src/stores/onboarding.ts` persists the durable subset and `onboardingComplete`;
there is no per-step checkpoint, no partial-configuration record and no recovery path for
a crash mid-download (the download step's Ollama pull is not resumable across app death).
The audit's resumability requirement is unimplemented.

### XRD-006 — Governance enforcement is real but shallow: no required review, one aggregate check

**Status:** **CONFIRMED — as corrected** (originally mis-stated as "`main` is unprotected") ·
**Severity:** medium · **Owner phase:** `XR-P00`

> **Correction notice (2026-11-01).** This entry originally read *"`main` is unprotected; no
> required checks"* and called it release-blocking. That was **wrong**. The error came from
> trusting `GET /repos/{owner}/{repo}/branches/main`, whose `protected: false` field
> **does not report repository rulesets**. A real `git push origin main` was rejected, which
> is what exposed it (`E-33`). The refutation is kept here rather than deleted because the
> same wrong conclusion would be reached by any agent using the same endpoint.

What is actually in force: an active ruleset `main protection` (id 19119579) with
`deletion`, `non_fast_forward` and `pull_request` (0 approvals, no code-owner review)
plus one required status check, `Quality Gate` (listed twice). `bypass_actors: []`.

The residual, verified gaps are: **no required approvals / no code-owner review** (the
`CODEOWNERS` file is therefore documentation, not enforcement); **only the `ci.yml`
aggregate is required**, so the two currently-red native lanes would not block a merge
once the aggregate is green; no strict status-check policy; and the duplicated entry
suggests the ruleset was configured by hand.

Consequence for *this plan*: `XR-P00` is still first, but its governance item shrinks from
"build protection" to "deepen it" — and the phase's real centre of gravity becomes
**`XRD-013`** (five gates invoked by no workflow), which `Quality Gate` cannot cover
because `ci.yml` never runs them.

### XRD-007 — Corrupted release documents (number/word fusion)

**Status:** CONFIRMED · **Severity:** high · **Owner phase:** `XR-P08`
At least 8 release documents carry fused tokens (`across10mandatory`,
`remain1.0.0`, `15versioned`). This is *not* a display artifact: the bytes on disk are
wrong, and one statement (`returned **v1.1.0, not prerelease,5assets**`) is a
release-fact sentence whose meaning is damaged. No existing gate catches it.

### XRD-008 — Stale published test baseline in README

**Status:** CONFIRMED · **Severity:** medium (honesty) · **Owner phase:** `XR-P08`
`README.md:594` publishes `4,972 pass / 29 skip / 0 fail across 450 files` at
`a2b6a735`; measured at `6b9cb599`: **5,119 / 41 / 0 across 473 files**. The claim is
sourced and dated, so it is not a lie — but it is presented as the current evidence line
and the repo's own rule 1 makes drift a bug. `docs/release/TEST-BASELINE.json` is the
machine-readable counterpart that `scripts/baseline-inventory.ts` and the README line
must agree on.

### XRD-009 — Two competing planning regimes already exist in `docs/`

**Status:** CONFIRMED · **Severity:** medium (governance/context hazard) · **Owner phase:** `XR-P00` (this deliverable)
`docs/IMPLEMENTATION-PLAN.md` (67 KB, "XR IMPLEMENTATION PLAN — v1.0 Final … One agent per
phase"), `docs/IMPLEMENTATION_PLAN.md` (35 KB, "Launch Implementation Plan & Tracker"),
`docs/implementation/*` (12 phase reports for a *different* phase numbering),
`docs/release/IMPLEMENTATION_PLAN.md`, and `docs/release/V1-RELEASE-LEDGER-2026-10-28.md`
(the most recent, most accurate ledger) all describe phase systems. A fresh execution
agent asked to "follow the plan" would find four. **Disposition:** this plan becomes the
single authority at `docs/implementation/v1-release/`, explicitly **supersedes** nothing
by deletion — it *links* the prior ledgers as historical and states the precedence rule
(D-005). This is recorded rather than resolved by rewriting history.

### XRD-010 — Automation engine has no surface and one test file

**Status:** CONFIRMED · **Severity:** medium · **Owner phase:** `XR-P07`
See AUD-008. Additional facet: `src/automation/` ships a scheduler with a 15 s tick
wired at boot (`server.ts:836-837`) and a durable pause flag, but the *desktop* cannot
pause or observe it, and only `test/automation/triggers.test.ts` covers it — no
restart-recovery, timezone/DST or duplicate-delivery test exists (the audit asks for
exactly these).

### XRD-011 — Voice preview configures a different engine than it plays

**Status:** CONFIRMED · **Severity:** medium (honesty) · **Owner phase:** `XR-P02`
See AUD-004. `StepVoice.tsx:30,63` previews with Web Speech while persisting a Piper
engine id; the fallback text ("the OS engine previews the tone") is a partial disclosure
that does not say *a different voice* will be used.

### XRD-012 — `docs/privacy/` has no data-flow notice, so consent cannot cite one

**Status:** CONFIRMED · **Severity:** high (blocks AUD-004's fix) · **Owner phase:** `XR-P02`
`docs/privacy/` contains only `MEMORY.md`. Any "privacy notice" added to onboarding would
have to be invented by the implementer, which this plan forbids. Requires an owner-authored
(or owner-approved) document, decision D-004.

---

### XRD-013 — "CI-enforced" gates: five of them run in no workflow, and one **fails at HEAD**

**Status:** CONFIRMED · **Severity:** release-blocking (governance) · **Owner phase:** `XR-P00`
**Discovered:** during verification of the new plan documents (the plan itself was
initially written from `AGENTS.md`'s description of the battery, then checked against
`.github/workflows/`).

`AGENTS.md` declares "**Full gate battery (must be green before a PR)** → `bun run ci`" and
labels the rules "CI-enforced, do not bypass". Measured reality:

| Gate in the `bun run ci` battery | Run by a workflow? | Where |
|---|---|---|
| `typecheck`, `release:check`, `claim-lint`, `baseline:inventory`, `api:schema:check`, `client:check`, `api:compat`, `boundaries`, `size-gate`, `hot-path-lint`, `security:check`, `desktop:ipc-acl`, `desktop:coverage`, `support-matrix`, `ci:policy` | **yes** | `ci.yml` / `release.yml` |
| `ownership:check` | **yes** — invoked as `scripts/ownership-map.ts --check` | `ci.yml` job `unit-tier` |
| `platform:parity:check` | **yes** — invoked as `scripts/platform-parity.ts --validate` | `cross-platform.yml:71`, `release.yml:77` |
| **`placeholder-lint`** | **NO** | — |
| **`desktop:sink-lint`** | **NO** | — |
| **`ci-capability-gate`** | **NO** | — |
| **`website:marketplace:check`** | **NO** | — |
| **`changelog:check`** | **NO** — `release.yml:209` runs the generator with `--write`, never the `--check` gate | — |

> **Correction (2026-11-01, same session).** The first version of this finding listed
> **seven** unenforced gates and wrongly included `ownership:check` and
> `platform:parity:check`. A second pass matched the gates against the *command forms
> actually used in workflows* rather than against the npm script name, and both are
> enforced (under different invocations, in different workflows). The verified count is
> **five** unenforced gates: `placeholder-lint`, `desktop:sink-lint`, `ci-capability-gate`,
> `website:marketplace:check`, `changelog:check`. The correction is recorded rather than
> silently absorbed because the original method — grepping for the npm script name — was
> the flaw, and any executor repeating it will make the same mistake. Evidence: `E-29`.

And the battery is **red at the verified commit**: run against a pristine worktree of
`6b9cb599` (a separate `git worktree`, untouched files), `bun run changelog:check` exits
**1**:

```
[changelog] FAIL — no CHANGELOG.md entry for 1.1.1-rc.1.
Releases are evidence-bound: run `bun run changelog:generate` at release time (Art. XIX/XXII).
```

`release.yml` *generates* the changelog at release time (`scripts/changelog.ts --version
"$V" --write`), so the failure is arguably a **sequencing** design choice — but that is
precisely the problem: `AGENTS.md` tells every contributor and agent to run `bun run ci`
before a PR, and that command cannot succeed at this commit. A contributor following the
documented rule is blocked, and a contributor who ignores it is following the de-facto
rule that CI enforces only 15 of 22 gates.

Two distinct defects are therefore proven: **(i)** five documented gates are unenforced,
so e.g. a renderer raw-HTML sink (`desktop:sink-lint`), a placeholder in the website
(`placeholder-lint`), or a parity regression (`platform:parity:check`) could land
unblocked; and **(ii)** the documented battery is not runnable green at HEAD, which
undermines the "must be green before a PR" contract for every phase in this plan.

**Remedy.** `XR-P00` (bootstrap) wires the five gates into `ci.yml`; `XR-P08` decides the
`changelog:check` sequencing (either generate the entry for the in-development identity,
or document that the gate belongs to the release workflow and remove it from the
contributor battery). **Neither action may weaken a gate** — the only permissible
outcomes are "run it" or "explicitly re-scope it, in writing, with the owner's approval".

**Regression test.** A gate-inventory test (`test/architecture/`) asserting that every
script named in the `ci` script string is invoked by at least one workflow — the classic
"the gate list and the workflow list cannot drift" check.

---

## 4. Audit claims that could **not** be verified and must not be treated as facts

| Claim | Why it cannot be verified here | What would close it |
|---|---|---|
| Windows black screen root cause | No Windows host; no native GUI | A Windows runner with the shell's stderr tail + renderer crash log at the failing step (`XR-P02` requirement) |
| Linux "engine not connected" as *observed* | No native webview / display server | A Linux desktop launch recording with the Diagnostics card + sidecar stderr |
| Voice sample "cannot be heard" | No audio device; no webview | Native run with `speechSynthesis` availability and engine TTS path logged |
| Cross-Platform macOS lane failure cause | Job logs require admin (`403`) | Failing segment/test names from the runner's `::error::` annotations, or owner-run fetch |
| Desktop App journey failure cause | Same | Same |
| Supply-chain / signing integrity | No certs, no release credentials | Owner-run `release:verify --strict` at the tag |
| Any live provider behavior | No paid credentials | Bounded, consented live canaries (`XR-P09`), never inferred from fixtures |

---

## 5. Verification coverage summary

| Supplied finding | Verdict |
|---|---|
| AUD-001 Windows black screen | UNVERIFIED (cause) / CONFIRMED (no step boundary, `null` render) |
| AUD-002 Linux engine not connected | PARTIALLY CONFIRMED (no version negotiation; lifecycle itself sound) |
| AUD-003 Only ~4 providers shown | DISPROVEN as stated; PARTIALLY CONFIRMED as a different defect |
| AUD-004 Onboarding defects, no terms/privacy, voice | PARTIALLY CONFIRMED (terms/privacy + voice identity + no success predicate; install feedback DISPROVEN) |
| AUD-005 Fake/pre-populated runtime data | DISPROVEN at HEAD (debug-gated; bundle proven clean); upgrade path needs a regression |
| AUD-006 Permissions incomplete/invisible | PARTIALLY CONFIRMED (enforcement real; presentation absent) |
| AUD-007 Chat progress/artifacts/file opening | CONFIRMED for artifacts; PARTIALLY CONFIRMED for progress |
| AUD-008 Automations | CONFIRMED |
| AUD-009 CI failures | PARTIALLY CONFIRMED, **out of date** (two *new* failing workflows) |
| AUD-010 Governance instruction-only | **DISPROVEN as stated** — a ruleset is active and blocks direct pushes; the real gap is review depth (0 approvals, no code-owner review) and missing native-lane checks |
| AUD-011 Claims exceed evidence | PARTIALLY CONFIRMED (identity honest; docs corrupted; baseline stale) |
| AUD-012 Signing/install/upgrade gates | CONFIRMED (as inherited, owner material absent) |

**New defects discovered:** 13 (`XRD-001 … XRD-013`), of which **6 are release-blocking**
(XRD-001, XRD-002, XRD-004, XRD-006, XRD-007, XRD-013) and the rest are high/medium.

**Baseline quality gates at `6b9cb599` (this sandbox):** `release:check`, `channel:check`,
`claim-lint`, `placeholder-lint`, `desktop:sink-lint` → **PASS**; root `tsc --noEmit` →
**PASS**; `tsc -p desktop/tsconfig.json` → **PASS**; `desktop && vite build` → **PASS**;
`desktop-seed-gate` → **PASS (7 probes absent)**; Linux parity suite → **5,119 pass /
0 fail / 41 skip, 473/473 files, exit 0**. Two CI workflows are **red on the same SHA**
(E-14) and are not reproducible here.

---

*This matrix is the authoritative finding record. Any later change to a verdict must be
made here first, with a dated evidence entry in `EVIDENCE_LOG.md`, and recorded as a
decision in `DECISIONS.md`.*
