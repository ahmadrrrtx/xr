# Accessibility Conformance Record — XR Control Center

**Last updated:** 2026-08-02 · **Build under test:** 7.0.1 + Phase-8 branch (Phase 8 · T3)
**Standard:** WCAG 2.2 Level AA · **Status:** `automated-verified · manual-pass-pending-human`

> Art. X honesty rule: this file distinguishes what was _machine-verified_
> from what still needs a human pass. Nothing below claims conformance from
> automation alone, and no human result here was synthesized by an agent.

---

## 1. Automated verification (runs in CI every PR — `a11y` job)

| Gate | Evidence | Result |
|---|---|---|
| axe-core sweep, zero violations, tags `wcag2a/wcag2aa/wcag21aa/wcag22aa` | `test/a11y/browser-axe.test.ts` — sign-in page, dashboard, **all 26 panels**, palette-open modal | ✅ green on this build (13/13 tests, 2026-08-02, Playwright chromium headless, real daemon) |
| Formatted computed contrast (every text token ≥4.5:1 vs every surface; UI boundaries ≥3:1) | `test/a11y/contrast.test.ts` (9/9) — includes regression pin that the old `--muted #475569` (2.2–2.6:1) is rejected | ✅ |
| Structural contracts (skip link first, one `<main>`, labelled nav, all inputs labelled, decorative SVGs hidden, dialog semantics, live regions, 24px targets, reduced-motion, focus indicator placement) | `test/a11y/static.test.ts` (21/21) | ✅ |
| Server auth contract (browsers → accessible page, API → JSON 401, bootstrap unchanged) | `test/a11y/auth-server.test.ts` (7/7) | ✅ |
| Real keyboard flows (skip→main, nav Enter→panel focus, aria-current sync, palette trap/Esc-return, letter shortcuts, seeded session-row bridge) | `test/a11y/browser-axe.test.ts` keyboard block | ✅ |

## 2. Manual / human verification

| Pass | Status | Record |
|---|---|---|
| Keyboard walkthrough (procedure: MANUAL-TESTING.md §2) | ✅ **scripted-equivalent verified by agent** via real-browser key events (Playwright `keyboard.press`, not synthetic DOM events) on 2026-08-02; a human re-walk is still prescribed per release | scripted run logs in `browser-axe.test.ts` output |
| Screen-reader pass (NVDA/VoiceOver/Orca) | ⏳ `pending-human` — **no human AT pass has been performed on this build and none is claimed.** Procedure ready: MANUAL-TESTING.md §3. This is the standing exception recorded in `docs/phase8/04-ARCHITECTURE-VALIDATION.md` (E-1). | — |
| 200% zoom / text spacing / reduced motion / forced colors | ⏳ `pending-human` (reduced-motion rule is machine-verified present) | — |
| Color-only meaning check | ✅ machine-reviewable: every status dot is paired with text ("Ready"/"Offline"/counts); flagged items: none | |

## 3. New WCAG 2.2 criteria — engineering notes

| SC | Where addressed |
|---|---|
| 2.4.11 Focus Not Obscured (AA) | panels/main programmatic focus + `scroll-margin-block` guard; no sticky overlays cover content in normal flow |
| 2.5.7 Dragging Movements (AA) | **No dragging interactions exist** in the Control Center (verified: no dragstart/draggable in markup or client) — criterion not applicable, no alternative needed |
| 2.5.8 Target Size Minimum (AA) | 24px minimum enforced on toggles, chips, msg actions, badge-x, palette items, nav items (CSS gate in tests) |
| 3.2.6 Consistent Help (A) | Help mechanism is constant: `?`-key / ⌘K palette + the same "Change model / Press ? for command search" hint row pinned at the bottom of the nav on every screen |
| 3.3.7 Redundant Entry (A) | No flow re-asks previously entered information (settings save in place; token entered exactly once per session) |
| 3.3.8 Accessible Authentication (AA) | Paste-friendly token page: labelled password field, paste never blocked, Show/Hide toggle, announced error; no CAPTCHA, no cognitive puzzle — ever |

## 4. Honest scope statement

- Conformance **testing scope** = the dashboard shell, all 26 panels, the
  command palette, toasts, and the sign-in page.
- Automated + scripted-keyboard evidence supports **AA engineering
  conformance of the covered surface**; full conformance language awaits the
  human screen-reader + zoom pass above (process, not code).
- The TUI is out of scope for *this* record (its mode-colored presentation
  and keyboard model are terminal-native; see Phase 8 · T4 docs).
