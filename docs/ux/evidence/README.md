# Phase 8 · T4 visual evidence

Captures of the T4 surfaces on a fresh XR_HOME (2026-08-03), produced by a
real headless-chromium pass through the real sign-in flow against the real
daemon. **Regenerate:** `bun run scripts/ux/visual-proof.ts` (requires
`bunx playwright install chromium`). These complement — never replace — the
structural tests in `test/ux/` and the zero-violation axe sweep in
`test/a11y/browser-axe.test.ts`.

| File | Shows |
|---|---|
| `t4-dashboard-readiness.png` | The honest readiness banner computed live on a fresh machine: **Setup required** — "the active route is a local model but no local model is running yet", with the one action that fixes it. |
| `t4-sidebar-disclosure-default.png` | Progressive disclosure default: only **Start here** expanded; all five governed areas collapsed behind accessible toggles. |
| `t4-sidebar-disclosure-open.png` | An area toggle opened by the user (state persists per-browser). |
| `t4-capabilities-badges.png` | Standardized capability badges from real lifecycle data on a 153-capability store: **WORKS-NOW** (green, enabled+verified), **SETUP-REQUIRED** (amber, discovered integrations), each with a WHY tooltip; the target area auto-revealed on navigation. |
| `t4-memory-undo.png` | The first-class **↶ Undo last change** surface on Durable Memory, next to destructive actions (restores data, never authority). |
