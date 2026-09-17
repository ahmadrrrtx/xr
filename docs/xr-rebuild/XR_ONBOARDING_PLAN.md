# XR — Onboarding & First-Launch Plan

> Heritage: `xr onboarding` wizard + daemon onboarding routes [OBSERVED]; problems: form-like, terminal-bound, no "meet XR" (UX Audit).

## 1. Sequence (desktop first launch)
1. **MEET XR** — avatar hero + tagline + 3-sentence promise (local-first / BYOK / audited). One button: "Set up XR".
2. **HOW WILL YOU USE XR?** — cards: Code & build / Research & analyze / Operate & automate / General assistant. Chooses defaults (suggested skills, modes, workspace type) — all changeable later.
3. **MODELS & PROVIDERS** — two paths: Local-first (detect runtimes, recommend model by hardware [OBSERVED local/recommend]) or Cloud (provider cards, key paste → keyring) or Hybrid (router default). Test button per choice.
4. **WORKSPACE** — pick folder or start scratch; explains workspace = memory+permissions scope.
5. **PERMISSIONS & MODE** — Mode picker (Careful/Balanced/Autonomous) w/ plain-language consequence table; category blocks for computer control shown; everything changeable in Trust Center.
6. **OPTIONAL CAPABILITIES** — 3-5 suggested skills for chosen path + optional MCP starters (e.g., filesystem) w/ permission previews; skippable.
7. **TEST XR** — guided first task (path-specific, e.g., "explain this folder" / "plan a hello-world") executed live w/ visible tool timeline + one approval moment (teaches trust UX by experience).
8. **READY** — Home appears w/ continue card = the test run; "what XR knows about you so far" memory peek (transparency).

## 2. Rules
- Never re-run onboarding after completion; Settings→General→"Replay setup" for changes; provider-only changes via Model Center deep link.
- Every step skippable w/ safe defaults (Careful, local-first, no optional installs).
- Failure paths: no provider → local install guide or offline demo mode (engine introspection tasks w/o model? no: clear messaging + retry); folder denied → scratch workspace.
- Time budget: <10 min to READY incl. test task (product success criterion).

## 3. Every-launch intentionality
- Home greets w/ state, not ceremony: readiness strip + continue cards; presence orb subtle idle breath.
- Update moments: "what's new" sheet (changelog-derived, claim-lint heritage) once per version.

## 4. CLI/TUI parity
- `xr onboarding` remains for headless; shares engine onboarding state routes [OBSERVED] so desktop and CLI never double-ask.

## 5. Phasing
P2: full sequence w/ test task. P4: voice introduction optional step. P5: team/enterprise presets via satellites.
