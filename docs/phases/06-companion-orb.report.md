# Phase 6 — Companion Orb · Implementation Report

Branch `phase/6-companion-orb` (based on merged `main` @ PR #143). Plan:
`docs/phases/06-companion-orb.plan.md`.

## What shipped

**A second always-on-top Tauri window** (`desktop/orb.html` entry → 3.4 kB JS +
react/globals chunks, no router/chat/shiki in its graph) hosting the orb:

- **Window** — 120×120, frameless, transparent, skip-taskbar, always-on-top,
  bottom-right by default (24pt margin, scale-aware, per-monitor reachability
  clamp). Position persists across restarts (400 ms-tick debouncer thread +
  flush on exit; falls back to the default corner if the saved spot is
  unreachable).
- **7 states** — idle / listening / thinking / speaking / waiting-approval /
  error / sleeping, rendered by the Phase-1 `CompanionOrb` SVG at 80 px inside
  a 120 px hit target. `chatStore.runGeneration` drives thinking → speaking →
  idle (error on failure); palette quick-ask shares the same helper.
- **Interactions** — single click = `listening` preview (~2 s) + `orb:clicked`
  seam; double click = open/focus main; press+move >4 px arms OS-level drag
  (clicks never swallowed); right-click pops the native menu (Open XR · Start
  Voice Session · Pending Approvals · Settings… · Hide Orb · Quit XR) and is
  `preventDefault`-ed in the webview.
- **Sleep** — 30 min without interaction → `sleeping` (eyes close, breathing
  slows); any pointer/state event wakes it. Dev override `xr.orb.sleepMs`.
- **Sync** — `xr-orb-seam` CustomEvent bus in DEV for e2e; `orb:set-state`
  wins over local previews. Glow follows the theme broadcast
  (`--orb-glow-intensity` 1.0 / 0.6); colors stay XR Native black+cyan.
- **Toggle** — global shortcut pair (macOS: Alt+⌘O, others: Alt+Ctrl+O; +
  Alt+ShiftO fallback) and `orb:toggle` from the app. Settings gate
  (`xr.orb.showOrb`) respected at startup (default on) and via the settings
  screen; onboarding completion gates first show; orb ping-pong preview on the
  onboarding final step.
- **Palette/dev** — `Cycle Orb States` dev command (dev-only), quick-ask drives
  the orb, chat streaming drives the orb.

**Rust** (`src-tauri/src/commands/orb.rs`, 7 commands + init): window
lifecycle, position memory, corner math, native menu (id → action mapping is a
unit-tested pure function), shortcut registration, single-instance arg
validation (`--hide-orb`), capability file `capabilities/orb.json`.

## Plan deviations (all benign)

1. `orb.html` lives at `desktop/` root (vite multi-entry requires HTML at
   project root — same pattern as `hud.html`; plan said `src/orb/orb.html`).
2. Dev seam event renamed `xr-orb-seam` (plan: `xr-orb-emit`).
3. Plan's `orb:double-clicked` event became an `orb_open_main` command
   (the webview can't focus another window directly).
4. `aria-haspopup="menu"` (React typings reject `"context menu"`).
5. Dropped the `xr.orb.clickPreviewMs` dev override — the constant is
   dev-overridable via the seam; `sleepMs` + `devState` remain.

## Verification (all local, pre-PR)

| Gate | Result |
|---|---|
| `tsc --noEmit` (root + desktop) | clean |
| `eslint .` | clean |
| `vite build` (3 entries) | ✓ — orb entry 3.38 kB, imports only react+globals; no router/chat/shiki |
| `cargo check` / `cargo clippy --all-targets -- -D warnings` | clean |
| `cargo test --lib` | 11/11 (5 new orb tests: shortcut pair, corner math ×scale, reachability, position choice, menu-id mapping) |
| Root lane `bun test` | 3417 tests / 339 files, 0 fail (19 platform skips) |
| `test/desktop/` | 30/30 (11 new orb-core units) |
| Playwright e2e (orb.html + main-app contexts) | 37/37 — 7 states render (wave rings, orbit dots, shield, red overlay eyes, sleeping slits), live aria-labels, click preview + revert, double-click seam, right-click prevented + seam, drag suppresses click, sleep/wake, glow per theme (0.6/1.0) + resolved 8 px glow filter, transparent body, chat + quick-ask drive thinking→speaking→idle, dev command cycles, zero page errors |

**Bug the e2e caught & fixed:** the first click within 400 ms of launch was
misclassified as a double-click (`performance.now()` starts near 0 at page
load vs. a zero-initialized `lastClickAt` ref) — now sentinel-initialized, so
launch-adjacent clicks are always single clicks.

## Screenshots

`previews/implementation/phase-06/`: 01 idle on desktop · 02 listening ·
03 thinking · 04 speaking · 05 waiting-approval · 06 error · 07 sleeping ·
08 context menu (spec render of the real `build_menu` labels — native menu
pops on-device) · 09 dragging (simulated ghost→drop) · 10 chat-sync (real
main-window streaming capture with the orb overlaid). Orb captures are real
browser screenshots (transparent, PIL-verified); backdrops/compositing are
labeled as simulated.

## Known limitations (by design, v1)

- Native-only behaviors (real OS drag, native menu popup, always-on-top
  z-order, Dock behavior, global shortcut registration) verified on Ahmad's
  machine — headless sandbox can't run the native shell.
- Push-to-talk voice (Phase 15), Approvals UI (Phase 7 — menu item emits the
  request event only), menubar/tray orb mode (Phase 27), hover tooltip
  (needs a separate tooltip window — deferred), non-activating NSPanel.
