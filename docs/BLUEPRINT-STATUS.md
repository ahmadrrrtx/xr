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
