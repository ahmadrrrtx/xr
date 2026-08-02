# Manual Accessibility Testing — XR Control Center

WCAG 2.2 AA is **not** verifiable by automation alone. axe-core detects
roughly 30–50% of issues; the rest requires human keyboard, screen-reader,
and zoom testing. This file is the procedure. Results go in `CONFORMANCE.md`.

**Constitution Art. X (honesty):** a conformance claim requires both the
automated gate (`test/a11y/*`, CI `a11y` job) AND a dated manual record below.
An agent must never fabricate human results — record status as
`pending-human` if no human pass exists for the current build.

---

## 1. Setup

```bash
bun install
bun run serve          # note the printed token
# open http://127.0.0.1:7331/ in a real browser (Chrome/Edge, Firefox, Safari)
```

Zoom to 100%, window ≥ 1280×800 unless the step says otherwise.

## 2. Keyboard walkthrough (no mouse; ~15 min)

| # | Step | Keys | Expected | SC |
|---|---|---|---|---|
| 1 | First tab stop | `Tab` | Skip link appears, fully visible (not clipped) | 2.4.1, 2.4.11 |
| 2 | Follow skip link | `Enter` | Focus moves to main content; next `Tab` enters nav or topbar | 2.4.1 |
| 3 | Traverse nav | `Tab` ×26 | Every nav button shows a visible focus ring; order follows reading order | 2.4.3, 2.4.7 |
| 4 | Activate a section | `Enter` | Panel swaps; focus moves into the panel (screen reader announces context) | 2.4.3 |
| 5 | Reverse | `Shift+Tab` ×N | Order reverses symmetrically, no dead stops | 2.4.3 |
| 6 | Palette | `Ctrl+K` | Dialog opens, focus in search; `Tab` never escapes the dialog; `Esc` returns focus to where you were | 2.1.2, 2.4.3 |
| 7 | Palette arrows | type text, `↑/↓`, `Enter` | Selection moves, activedescendant announces, Enter runs the command | 2.1.1 |
| 8 | Every interactive card/row | `Tab` to it, `Enter`/`Space` | Same as click (run detail opens, market card inspects, tool card expands) | 2.1.1 |
| 9 | Forms (settings) | `Tab` through fields | Each field announces its label; toggles announce state; no keyboard trap | 3.3.2, 2.1.2 |
| 10 | Focus never lost | watch the ring | There is NEVER a tab stop with no visible indicator | 2.4.7 |
| 11 | Sign-in page | fresh profile/incognito, open URL | Token field labelled; paste works (Ctrl+V); Show toggle works by keyboard; errors announce | 3.3.8 |

## 3. Screen-reader pass (human required, ~30 min)

Perform with at least ONE of: **NVDA** (Windows), **VoiceOver** (macOS,
`⌘F5`), **Orca** (Linux). Repeat critical flows only:

1. Land on the sign-in page → hear: page title, the alert (`role="alert"`),
   the token field label, and instructions.
2. Sign in → hear the skip link on first Tab; follow it; hear "main".
3. Nav → hear "Mission navigation, landmark"; each item announced as a
   button; the current one announced "current page".
4. Trigger a toast (e.g. Refresh state) → hear it announced WITHOUT moving
   focus (polite). Trigger an error toast → announced assertively (`alert`).
5. Palette → "Command palette dialog"; typing filters options; arrows read
   option names; Esc closes.
6. Panels → headings read; the system-health matrix values announced with
   their labels; cards do not read raw SVG garbage (decorative SVGs hidden).

Notes template (paste into CONFORMANCE.md):

```
- Date / build / tester's SR + browser + OS
- Steps done / skipped
- Defects found (with repro) or "none"
```

## 4. Vision pass (human required, ~10 min)

1. **200% zoom** (Ctrl + `+`): no content clipped, no two-dimensional scroll,
   all features reachable (SC 1.4.10).
2. **Text spacing override** (bookmarklet/extension: line-height 1.5×,
   letter-spacing 0.12em, word-spacing 0.16em, paragraph 2em): nothing lost
   or overlapped (SC 1.4.12).
3. **Reduced motion** (OS setting on): palette/toast animations become
   instant (SC 2.3.3-adjacent; our `prefers-reduced-motion` block).
4. **High-contrast/forced-colors** (Windows HCM): controls remain
   distinguishable; focus visible (best-effort, non-blocking).
5. Color-only information: statuses (green/amber/red dots) always accompany
   text ("Ready", "Offline"…) — verify no meaning is color-only (SC 1.4.1).

## 5. What automation already covers (do not re-test manually)

- axe-core zero-violations sweep of all 26 panels + sign-in + palette-modal
  (CI `a11y` job, tags wcag2a/2aa/21aa/22aa)
- Contrast ratios of every token pair (computed, `contrast.test.ts`)
- 24px target sizes of known-small controls (CSS assertions)
- Live-region roles, labels on all inputs, dialog semantics (static tests)
- Real keyboard event flows (Playwright; skip link, focus handoff, trap)

## 6. Logging defects

File as GitHub issues with the `a11y` label, link the SC, and (if it blocks
a principle) update CONFORMANCE.md to `open-defect` immediately — never hold
a conformance claim over a known defect.
