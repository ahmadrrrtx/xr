# ADR-0020 — Progressive disclosure, honest readiness, real undo, truthful badges

- **Status:** accepted (Phase 8 · T4)
- **Owner:** daemon/dashboard + test/ux · **Review:** 2026-08-03

## Context
Pre-Phase-8 the dashboard showed all 26 panels to every first-run user, said
nothing about whether the system actually worked, offered no way back from a
misclick, and colored capability states inconsistently (TUI header painted
`plan` violet while the composer chip painted every mode cyan). Power-user
density had silently become the default first-run experience.

## Decision
1. **Progressive disclosure**: the sidebar collapses to a "Start here" area
   (Home, Chat, Models, Settings — real nav clones, one dispatcher) with the
   five governed areas behind `aria-expanded` toggles; state persists
   per-browser (`xr.nav.areas.v1`, localStorage — never server-side), and any
   panel reached via palette/shortcut auto-reveals its area so nothing is
   unreachable.
2. **Honest readiness**: a `role=status` banner on the home panel computed
   LIVE from `/api/overview`, `/api/models`, `/api/context` — verdicts
   `Degraded` (audit chain invalid), `Setup required` (local route, no model
   running), `Your call needed` (pending memory consent), `Ready`,
   `Unreachable` (daemon error) — each actionable verdict routes to the
   owning panel. Degraded beats Ready; readiness is never a static string.
3. **Undo as infrastructure, not UI garnish**: dashboard mutations
   (approve/revoke memory) record before-images in the UndoLedger;
   `POST /api/v1/context/undo` restores the EXACT prior row (data, never
   authority) and is itself an append-only ledger op. Empty ledger is an
   honest 404; double-undo refuses cleanly.
4. **Standardized capability badges**: exactly four states —
   `works-now` / `setup-required` / `experimental` / `unsupported-here` —
   derived from real lifecycle+certification data, each carrying its WHY as
   a tooltip; one canonical `modePaint(mode)` maps agent→cyan, plan→violet,
   ask→dim across every TUI surface (header, composer, session rows), always
   redundant with the mode word.
5. **Measurability with honest scope**: `scripts/first-task-survey.ts` runs
   N=20 fresh-machine install→first-answer attempts (CI-gated ≥0.95,
   measured 20/20, p50 385 ms) as an AUTOMATED PROXY; `scripts/sus.ts` is the
   canonical 10-item SUS instrument with mathematically pinned scoring. Both
   explicitly do NOT substitute for the pending human studies (`docs/ux/`),
   per honesty exception E-1.

## Consequences
- First-run and power-user needs are both served: density is one toggle away
  and remembers you; discovery never breaks keyboard or palette paths.
- "It works" statements on the dashboard are computable and falsifiable.
- UX claims split cleanly into machine-verified (gated) and human-verified
  (protocol recorded, study pending, never claimed).

## Tests
`test/ux/` 40 tests (disclosure statics, undo route+ledger evidence, SUS
math, mode-colour) + visual evidence in `docs/ux/evidence/`; nightly CI job
`first-task-survey`.
