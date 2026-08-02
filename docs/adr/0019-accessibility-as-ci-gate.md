# ADR-0019 — Accessibility as an enforced gate, WCAG 2.2 AA, honestly scoped

- **Status:** accepted (Phase 8 · T3)
- **Owner:** daemon/dashboard + test/a11y · **Review:** 2026-08-03

## Context
The control center grew 26 panels with no keyboard map, UA-default greys that
failed contrast, icon-only buttons without names, and no focus discipline —
invisible regressions for sighted mouse users, total exclusion for everyone
else. Constitution Art. X forbids claiming conformance from automated checks
alone.

## Decision
1. **WCAG 2.2 AA as the engineering target**, implemented in the dashboard
   primitives (tokens, focus, landmarks, labels, live regions, targets:
   `styles.ts`, `markup.ts`, `client-script.ts`) and in the daemon's
   sign-in page (`src/daemon/auth-page.ts` — 2.4.9/3.3.8 accessible
   authentication: no CAPTCHA/cognitive puzzles, paste allowed).
2. **Automated half in CI**: `test/a11y/browser-axe.test.ts` runs
   axe-core (wcag2a/2aa/21aa/22aa tags) through real Playwright chromium over
   the auth page, **all 26 panels**, and the open palette — zero violations
   required; plus contrast math in `contrast.test.ts` (real WCAG relative-
   luminance computation, not color-pair spot checks), structural invariants
   in `static.test.ts`, and real keyboard flows (focus handoff, palette
   traps, skip link, Enter/Space bridges).
3. **Manual half never fabricated**: `docs/a11y/MANUAL-TESTING.md` defines
   the keyboard/screen-reader/zoom procedure; `docs/a11y/CONFORMANCE.md`
   records HONEST scope — automated-verified items green, screen-reader and
   200% zoom passes marked *pending human verification* (Phase-8 honesty
   exception E-1). Claiming full conformance from automated results alone is a
   Constitution violation, and this ADR makes that permanent.
4. **Authoring discipline persists**: `docs/a11y/AUTHORING.md` is required
   reading for new UI, so the gate holds as the dashboard grows.

## Consequences
- Accessibility regressions block merges (CI job `a11y`,
  `XR_A11Y_REQUIRE_BROWSER=1` makes browser absence a failure in CI; local
  constrained environments opt out ONLY via `XR_A11Y_SKIP_BROWSER=1`).
- The conformance record can never overstate itself by accident: automated and
  manual statuses are recorded separately.
- New WCAG 2.2 criteria (2.4.11 focus-not-obscured via scroll-margin,
  2.5.8 24×24 minimum targets, 3.3.8 accessible auth) are test-pinned.

## Tests
`test/a11y/` 50 tests (21 static + 9 contrast + 7 auth-server + 13 live
browser); CI job `a11y`.
