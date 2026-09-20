# Phase 2 — Elite Workstation Pass (implementation record)

> Branch `phase2/elite-workstation` · commit `e4198ca` · 2026-09-20.
> Approved at the human gate after audit v2 (`/home/user/audit/XR_ELITE_AUDIT_AND_MASTER_PLAN.md` in the audit sandbox; findings F-1…F-11).
> Verification: `tsc --noEmit && vite build` green · full core suite **3,363 pass / 19 skip / 0 fail** (142.97 s) · live captures in `audit/screens2/` (onboarding dark, home, work, workspace pre/post drag, library+research, runs, trust, palette).

## What shipped (finding → change)

| Finding | Change | Evidence |
|---|---|---|
| F-1 light first-run | First-run theme default = dark; onboarding step 1 gains an Appearance choice (Dark / Light / Match system), persisted via prefs; light parity kept (designed shadows, not inversion) | `prefs.ts`, `Onboarding.tsx`, prism2 §F-4; capture 00 |
| F-2 competitor-mashup hero | Onboarding hero now official logo lockup + avatar on a dark aura tile only. `HERO_SRC` remains in the brand registry for cinema-zone surfaces (placement decision per D-05) | `Onboarding.tsx`; capture 00 |
| F-5 ad-hoc icons | `components/icons.tsx` v1: 24 px grid, 1.5 stroke, rounded caps; rail + presence consume it | icons.tsx, AppShell |
| F-6 13-item rail | Rail = Home, Work, Workspace, Multi-agent, Library, Team runs, Trust + Settings; voice becomes presence (orb + mic). Folded surfaces: Research → Library tab; Models → Library→Integrations; Memory → Work inspector tab; Control → Trust cockpit; all areas remain one ⌘K away via AREA_LABELS | AppShell, Library, Work; captures 03–07, 10 |
| F-7 inspector tabs | + Approvals (decisions observed this run), Artifacts (write/edit paths observed from the stream), Memory (engine peek, lazy-loaded) | Work.tsx; honest empties |
| F-9 private poller | Work approvals now subscribe to the shared poll hub; cost read on run-end + on Cost-tab open | Work.tsx |
| — spatial workspace | Draggable, persisted splitters (explorer ⟷ mid ⟷ agent rail, editor ⟷ terminal) via CSS variables so small-window media queries still collapse correctly | Workspace.tsx, prism2; captures 08/09 (drag proven) |
| — feedback system | Composer draft autosave (restore after crash, clear on send); viewport drop zone with accepted-type rejection toast | Work.tsx, prism2 |
| — motion law | Press feedback scale(0.97) on pills/buttons with ease-out tokens; reduced-motion respected on the new drop-zone animation | prism2 §motion |

## Invariants honored
- Boundary law (SEC-07): shell still renders + forwards only; no risk/policy/budget math in renderer.
- No fake UI: Approvals/Artifacts tabs show only observed stream facts; empties say so.
- No engine/backend changes; no new dependencies in the product (icons are local TS).
- Git discipline: audit-only tooling (playwright dev dep) excluded from the commit; benchmark/json churn restored.

## Residual → Phase 3
- Omni palette live search over models/MCP/projects/chats (F-8).
- Agents board v2 (edges/burn/failure halos over TeamView), inline MCP drift card, statusbar budget meter (F-11).
- Context menus per object class; Runs export.
- Then P4 (voice/control visuals + native GA) and P5 (light pass, i18n, real-device matrix) per Master Plan v2.
