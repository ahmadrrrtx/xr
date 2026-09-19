# Blueprint Status — what is implemented, what is not (2026-09-18)

OBSERVED against `main` @ merge of PR #114 + this PR. Every "done" line cites its
merge commit/PR; every "not done" line states where it lives in the backlog.
Nothing here is aspirational — surfaces without engine routes are labelled ABSENT.

## Delivered (merged)

| Workstream | Status | Evidence |
|---|---|---|
| Phase 1–3 gates (repo hygiene, P0/P1 fixes, honesty) | DONE | PRs #98–#101, verified on main before Phase 4 (user ordering rule) |
| Phase 5 hardening (satellite extractions, tree ceiling) | DONE | PR #102 → `0d7c5cc` |
| Phase 6 design system + 6 mockup screens (01–04 rails/home/work/editor) | DONE | PRs #103–#108 |
| Trust Center v1 (queue/modes/audit/budgets/network/permissions/shield) | DONE | PR #109; rebuilt to mockup 08 in this PR |
| Settings surface | DONE | PR #110 |
| CF-1 lock (claim-lint + truth gate) | DONE | PR #111 → `5a0caf4` |
| SEC-01/02 MCP + skill contract pinning | DONE | PR #112 → `5f53389` |
| Voice: offline STT/TTS pipeline + daemon surface + full-screen UI + docked orb | DONE | PR #113 → `93c0310`; models ~91 MB on-device, zero cloud |
| Multi-agent page (mockup 05): engine view composer + control verbs + live DAG board | DONE | PR #114 → `1107ff9` |
| Library (mockup 07): category rail, official badges, health/enable, detail provenance, MCP pins, plugin grants | DONE v1 Phase 3/6; mockup-faithful rebuild (Integrations tab, prompt chips, health labels) in this PR |
| Trust Center (mockup 08): approval sheets w/ engine diff previews, scoped always-allow, chain badge, burn bar | DONE in this PR |

## Added in this PR (engine-side, real)

- `POST /api/control/permissions/grant {scope, revoke?}` — standing computer-use
  grants (persisted `~/.xr/control-permissions.json`, gate-enforced, audited).
  Powers "Always allow (scope…)" on approval sheets + revoke in Permissions.
- `GET /api/budget` → `burn {monthUsd, monthlyCap, burnPct}` — engine computes
  the percentage (SEC-07: shell never derives budget math).

## Backlog status (updated 2026-09-18, msg-14 batch)

| Item | State | Note |
|---|---|---|
| Multi-agent steer / approve-in-page | **SHIPPED** | `POST /api/agents/workflows/{id}/steer` (engine `delegateTask`, audited handoff; allowed on running/paused/awaiting_review/blocked, else 409) and `POST /api/agents/workflows/{id}/review` (engine `reviewTask`: approve → completed + dependents unblocked via `dependencyApproved`; request-changes → blocked + `changes_requested` + blockedReason). Teams page renders both panels from engine affordances — never faked. |
| Trust-mode switch (Careful/Balanced/Autonomous) | **SHIPPED** | `POST /api/trust/mode` persists to `~/.xr/trust-mode.json` (audited); `src/control/trust-mode.ts` `approvalForMode()` is read by the capabilities policy gate on EVERY decision (`policyTrace` records it). careful widens approvals (dangerous perms + mid/high tiers); balanced = tool-declared; autonomous relaxes base flags but NEVER high/critical tiers or dangerous perms. Mode cards in Trust → Modes are live. |
| Control cockpit consolidation | **SHIPPED** | `GET /api/control/cockpit` composes control status + pending approvals + standing permissions + triggers + active mode in ONE engine call; Trust screen gains a Cockpit tab that only renders it (SEC-07 preserved). |
| Native (Tauri) matrix parity | BACKLOG P4 | Web shell is first-class; native shells remain reference builds (sandbox cannot validate native toolchains — honest backlog, not silently dropped). |
| Skill template gallery | **SHIPPED** | `GET /api/agents/templates` — the deterministic planner templates composed from a real `compileWorkflowPlan` probe per `WorkflowKind` (roles/steps/summary, engine-owned sample goals). Library → Skills → Templates renders the gallery; "Run sample" creates a real workflow run. |
| Voice: semantic end-of-turn classifier | **SHIPPED** | Two-stage endpointing: acoustic tail (`minSilenceMs`) + semantic stage (`src/voice/endpointing.ts` `looksIncomplete` — trailing conjunction/preposition/filler/comma extends the tail once to `maxSilenceMs`; terminal punctuation processes immediately; fail-open). `VoiceSession` probes a provisional transcript mid-tail; `ServerVad` accepts `setPartial()`. `settings.endpointing.semantic` (default true) toggles the stage. 9 unit tests pin the classifier + tails. |

## Known flakes (CI, unrelated to product code)

- macOS `/api/overview` <500ms budget; Windows approvals-durable exit-124 (pre-existing since `0d7c5cc`); Windows runner queue 40+ min; reliability-spawn 12-writer stress under concurrent CI load (rerun green).

## Verification surface (this PR)

- Headless UI 15/15 PASS (Library: tabs/cards/rail/badges/provenance/Run/health; Trust: subnav/chain/burn/modes/honesty/grant+revoke round-trip). Shots: `shots/l-1-library.png`, `shots/t-1-approvals.png`, `shots/t-2-permissions.png`.
- Live daemon round-trips: grant 400 bad scope / 200 valid / revoke 200.

## Phase 1 (2026-09-19) — foundation, shell truth & onboarding (this push)

OBSERVED-first delivery per the Phase-0 forensic audit (`xr-deliverables/00-FORENSIC-AUDIT.md`
in the workstation; summary mirrored here). Every line below is engine-backed.

| Item | State | Evidence |
|---|---|---|
| BUG-1 chat error truth | **SHIPPED** | `chatStream` now surfaces the engine's JSON `error` body verbatim (was bare `502 chat`); Work error line gains Retry/Dismiss over the real last task |
| BUG-2 actionable splash | **SHIPPED** | engine-down splash says "unreachable" (not "starting"), shows `xr serve` hint + Retry now |
| Onboarding flow | **SHIPPED** | 8-step first-run over `/onboarding/status|provider|complete`, `/providers/set`, `/workspaces/switch`, `/trust/mode`, `/chat` (test); keys POST straight to the engine secret store and are dropped from renderer state; re-runnable from Settings + palette |
| Command palette | **SHIPPED** | ⌘K/Ctrl+K overlay: navigation verbs, new task, voice, re-run onboarding + live engine search (skills index, sessions); ↑↓/↵/esc |
| Toast bus | **SHIPPED** | change-detection over real `/approvals` + `/sessions` (new pending approvals, run completed/failed/stopped); local `xr-toast` event for shell actions; never invents events |
| Missing button grammar | **SHIPPED** | `.chipbtn`/`.ghostbtn` defined (were used unstyled) |
| a11y | partial | `prefers-reduced-motion` honored for phase-7 motion; full sweep stays P3 |
| Windows hang (KNOWN_LIMITATIONS #21) | narrowed + guarded | D4a probe isolates `approvalInsert`/`audit` synchronous writes with on-disk markers (next win32 run names write-path vs timer-setup); new timer-hygiene regression pins zero leaked pollers/timers on every OS (11/11 pass Linux). Root-cause fix lands when the win32 marker run returns — protocol unchanged |

## Phase 2 (2026-09-19) — core work experience (this push)

| Item | State | Evidence |
|---|---|---|
| Projects screen | **SHIPPED** | engine-managed workspaces over `GET /workspaces`, `POST /workspaces/create|switch`; per-workspace run activity from live sessions; shell never invents roots |
| Git panel (Workspace) | **SHIPPED** | NEW engine routes `GET /git/status|log` (argv-only, root-scoped) + `POST /git/stage|commit` riding the SAME durable approval store as files.write (medium/high tiers, audited); traversal probe `../../etc/passwd` → 400; empty commit message → schema 400 |
| Run changed-files review | **SHIPPED** | Runs → Files tab derives touched paths from the run's OWN tool-call records; per-path live engine `git diff`; honest fallback when no data |
| Code splitting | **SHIPPED** | route-level `React.lazy`; main chunk 1.02 MB → 263.6 kB; CodeMirror isolated in Workspace chunk |
| Gates | green | desktop tsc, vite build, root tsc, api:schema/client/compat (153 ops), boundaries (609 modules), ownership, claim-lint |

### CI follow-up (same push cycle, 2026-09-19)
- **reliability-spawn root cause:** the legacy DDL block ran outside the cross-process migration lock; concurrent fresh openers surfaced `SQLITE_LOCKED`, which the busy-retry classifier did not cover → one lost write at 16-process stress. Fix: legacy `migrate()` now serialized under `withMigrationLock` (per-process re-entrant), and `isBusy()` classifies `SQLITE_LOCKED`/`table is locked` as retryable. 5/5 under CPU starvation locally; reliability 66/66.
- **size-gate waivers:** regenerated client (809→829, four git ops) and workspace-store (+10) re-waived with owner/reason/review per the register's contract.

## Phase 3 · Memory + Research + capability clarity (2026-09-19)

| Item | State | Evidence |
|---|---|---|
| Memory screen | **SHIPPED** | `GET /memory` entries with content/category/scope/source/tags/importance/expiry + engine health; search via `GET /memory/search`; forget via `DELETE /memory/{id}` and confirm-gated forget-all (`DELETE /memory/all`) — all engine-audited; shell never synthesizes memories (empty state says so) |
| Research workspace | **SHIPPED** | job list/detail over `GET /research/jobs[/{id}]` (3 s poll), start via `POST /research/search`, cancel via `POST /research/jobs/{id}/cancel`; answer/sources/citations and the engine's OWN error string rendered verbatim — no simulated progress |
| Skills provenance | **SHIPPED** | bundled vs `virtual pack` chips from the engine's `source` field on both card and detail |
| Plugin install CTA | **SHIPPED** | Plugins tab lists the real `GET /plugins/catalog` with honest CLI-first copy (`xr plugins install <id>`, signed allowlist, approval-gated) — no fake in-app install button |
| Automations surface | **SHIPPED** | Library → Automations tab over the real trigger scheduler (`GET /triggers`, `POST /triggers/pause-all`); reflects actual pauseAll/inflight/triggers |
| Nav + palette | **SHIPPED** | Research and Memory in sidebar NAV and ⌘K palette; lazy-loaded routes |
| Gates | green | desktop tsc + vite build; full `bun run ci` (typecheck, tests, api-compat 153 ops, boundaries 609 modules, size-gate, ownership 181 areas, marketplace); unit-tier 267 tests/1314 ms; reliability 66/66; phase suites 69/69 |

## Phase 4 · Model Center + Control Room + voice state polish (2026-09-19)

| Item | State | Evidence |
|---|---|---|
| Model Center | **SHIPPED** | engine-owned: `GET /models` (runtime detection + hardware), `POST /models/test` live probe w/ latency chip, `POST /models/select`, `GET /providers` (+`/capabilities?id=`), default+fallback pair via `POST /providers/set`; ONE unambiguous active hero (LOCAL → CLOUD FALLBACK); BYOK keys written ONLY through `/onboarding/provider` (engine secret store; shell never retains); honest amber banner when no local runtime runs |
| Control Room | **SHIPPED** | live feed from `/control/events` audit (action/why/risk chips), pending approvals w/ Approve/Deny over the durable store, standing-grants manager over `/control/permissions/grant`, trust-mode chip from cockpit |
| Control verbs (NEW engine) | **SHIPPED** | `src/control/pause.ts` durable pause (env-overridable path, audited) honored per-action in `runAction` BEFORE permissions/execution; `POST /control/pause {paused}` + `{stop:true}` (= pause + deny ALL pending through the same durable store); cockpit/status expose `paused`; contract metadata + regenerated openapi/client (829→835, waiver updated) |
| Voice polish | **SHIPPED** | engine voice state machine extended: `planning`/`tool` (from the real execution envelope via pipeline `onPhase`) and `success`; shell avatar machine adds `approval`/`error`/`offline` overlays from engine events/SSE; full 12-state pill set, ring/orb glows for every state (no redraws) |
| Tests (DoD) | green | `test/control/pause-stop.test.ts` (pause skips+audits runAction, resume re-opens, stop denies pending durably) · `test/voice/session-states.test.ts` (extended vocabulary emission, barge-in-while-speaking → tts_stop + listening, onPhase wiring) · failover already covered by `test/intelligence/failover-cpr.test.ts` |
| Gates | green | desktop tsc + vite build; full `bun run ci` (3314 tests, api-compat 154 ops, boundaries, size-gate, ownership, claim-lint, marketplace); unit-tier 1295 ms; reliability 66/66; phase suites 69/69 |

## Phase 5 · production hardening (2026-09-19)

| Item | State | Evidence |
|---|---|---|
| Updater wiring | **SHIPPED (inert until provisioned)** | `tauri-plugin-updater` registered + `check_update` command (honest error unprovisioned); `scripts/generate-updater-keys.ts` (raw-32B ed25519 pubkey → conf, private key stdout-only); `scripts/make-updater-manifest.ts` + guarded `updater-manifest` CI job (tag-only, skips on zero signatures); bundle job passes optional `TAURI_UPDATER_KEY`; runbook `docs/release/UPDATER.md`; dry-run test `test/release/updater-manifest.test.ts` |
| Autostart + OS notifications | **SHIPPED (opt-in)** | `tauri-plugin-autostart`/`-notification` + commands; Settings toggles (autostart only in packaged app — stated honestly); web host falls back to Notification API when permitted; AppShell 10 s engine-polled notifier (approval due / run done) fires only when opted in |
| Audit export (signed bundle) | **SHIPPED** | `GET /api/audit/export` composes the SAME signed report as `xr audit export` (hash chain + sha256 sig + verifier); Trust → Audit "export signed bundle" downloads + verifies in-shell via WebCrypto |
| Cold-start perf | **MEASURED** | `perf:gate` PASSED (version 24 ms warm / budget 150; dashboard 3.9 ms; retrieval 27 ms); route-level lazy since Phase 2 (main chunk 264 kB) |
| kill-9 recovery drill | **GREEN** | pre-existing SIGKILL mid-write WAL drill (`test/reliability/crash-injection.test.ts`) + golden-path restart/uninstall semantics re-run green this phase |
| golden-path | **GREEN** | install → answer → audit chain → restart recovery → uninstall: 18 checks, chainValid true |
| Satellites optional + parity | **DOCUMENTED/CHECKED** | satellites labelled OPTIONAL enterprise in PRODUCTION_READINESS; `platform:parity:check` green in ci |
| a11y final | **GREEN in CI lanes** | `test/a11y/*` (axe/contrast/static); new screens carry roles/labels |
| QA matrix 3-OS | **PUBLISHED** | PRODUCTION_READINESS Phase-5 addendum: per-OS EXERCISED rows + honest BACKLOG labels for provision-gated native UX |
| 11 adjectives | **EVIDENCED** | PRODUCTION_READINESS addendum table, every row artifact-cited, bounds stated |
| Final re-audit | **PUBLISHED** | `xr-deliverables/03-FINAL-RE-AUDIT-REPORT.md` — 27 sections, observed-first, bounds stated per section |
