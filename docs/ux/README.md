# XR UX Program — Design Architecture

**Status:** PHASES 0–3 COMPLETE (Research · Audit · Design System · IA) ·
**PHASES A–G + RELEASE-READINESS COMPLETE (2026-08-13)** — full `bun run ci`
green (2937 pass / 13 skip / 0 fail), golden path green, no fake UI, honest
future labels. Deliverables: [RELEASE-READINESS.md](RELEASE-READINESS.md)
(mission §40 report) + `docs/release/UX-CANDIDATE-RELEASE-NOTES.md`.
Remaining: maintainer-held publish (signed tag, npm OIDC) per
`docs/release/RELEASING.md` + the chromium browser-axe sweep in CI.
Phase log: [12-implementation-roadmap.md](12-implementation-roadmap.md).

This directory is the design authority for the XR UI/UX transformation
(2026-08-13). It complements — never replaces — the runtime truth surfaces:
`docs/audits/*` (audit ledger), `docs/ux/FIRST-TASK.md` + `SUS.md`
(first-task/SUS protocols), and the evidence screenshots in `docs/ux/evidence/`.

## Read order

1. **[01-product-ux-audit.md](01-product-ux-audit.md)** — what exists, what's
   excellent (protect), and the 12 findings that drive the work (F-1…F-12).
2. **[02-competitive-research.md](02-competitive-research.md)** — BORROW /
   AVOID / INVENT patterns from Claude Code, ChatGPT, OpenCode, Cursor, etc.
3. **[03-user-personas.md](03-user-personas.md)** — P1–P5 and traceable
   requirements.
4. **[04-information-architecture.md](04-information-architecture.md)** — one
   mental model: ASK / SEE / CONTROL; GUI↔TUI↔CLI grammar.
5. **[05-user-flows.md](05-user-flows.md)** — the ten core flows, grounded in
   runtime paths.
6. **[06-design-system.md](06-design-system.md)** — canonical tokens (brand
   pixel-verified).
7. **[07-visual-direction.md](07-visual-direction.md)** — precision, calm,
   glassmorphism policy.
8. **[08-motion-system.md](08-motion-system.md)** — minimal, state-explaining,
   reduced-motion-safe.
9. **[09-accessibility.md](09-accessibility.md)** — WCAG 2.2 AA target +
   keyboard/live-region contract.
10. **[10-component-architecture.md](10-component-architecture.md)** — the
    reusable component inventory (no-build SPA constraint).
11. **[11-ui-state-model.md](11-ui-state-model.md)** — every state, every
    surface, honest data.
12. **[12-implementation-roadmap.md](12-implementation-roadmap.md)** —
    dependency-ordered phases A–G with the per-phase gate and phase log.
13. **[DESIGN-REVIEW.md](DESIGN-REVIEW.md)** — what changes / what doesn't /
    risks / migration.

Research notes: `research/` (terminal tech, 3D/avatar, ui-ux-pro-max
evaluation, brand asset pixel analysis).

**Phase 12 (XR 3.x UX Unification):**
[XR_UX_ARCHITECTURE.md](XR_UX_ARCHITECTURE.md) (principles, shared state,
shortcuts, status vocabulary) and [SURFACE_PARITY.md](SURFACE_PARITY.md)
(CLI / TUI / Chat / Dashboard capability matrix).

## Non-negotiables (all docs agree)

- Official logo/avatar are authoritative — never redrawn.
- No fake UI — every control maps to a real runtime path.
- No runtime rewrite — UI is a control layer over `AgentService.execute`.
- No hardcoded product logic — read registries/config/routes.
- Performance over spectacle; a11y is not optional.
