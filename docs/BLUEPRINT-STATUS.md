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

## NOT implemented (backlog, honest labels)

| Item | State | Note |
|---|---|---|
| Multi-agent steer / approve-in-page | ABSENT engine-side | No engine route exists; page shows review/approval STATE only (real store). Never faked. Next: control-cockpit consolidation. |
| Trust-mode switch (Careful/Balanced/Autonomous) | ABSENT engine-side | Presets displayed with an explicit honesty note; effective posture = per-action approvals. Ships with control-cockpit consolidation. |
| Control cockpit consolidation | BACKLOG P4 | Single pane for control/status+pending+permissions+triggers. |
| Native (Tauri) matrix parity | BACKLOG P4 | Web shell is first-class; native shells remain reference builds. |
| Skill template gallery | ABSENT engine-side | Marketplace shows bundled + configured registries only; empty registries reported honestly. |
| Voice: semantic end-of-turn classifier | BACKLOG | VAD endpointing + barge-in shipped; partial-utterance classifier not. |

## Known flakes (CI, unrelated to product code)

- macOS `/api/overview` <500ms budget; Windows approvals-durable exit-124 (pre-existing since `0d7c5cc`); Windows runner queue 40+ min; reliability-spawn 12-writer stress under concurrent CI load (rerun green).

## Verification surface (this PR)

- Headless UI 15/15 PASS (Library: tabs/cards/rail/badges/provenance/Run/health; Trust: subnav/chain/burn/modes/honesty/grant+revoke round-trip). Shots: `shots/l-1-library.png`, `shots/t-1-approvals.png`, `shots/t-2-permissions.png`.
- Live daemon round-trips: grant 400 bad scope / 200 valid / revoke 200.
