# Phase 1 — App Shell

> Branch: `phase/1-app-shell` · Plan: `docs/phases/01-app-shell.plan.md` (spec, research, verification table)
> Builds on Phase 0 (merged in #137). Screenshots: `previews/implementation/phase-01/`.

## What landed

The permanent production shell that stays across every screen:

- **Sidebar** — collapsible 72px ↔ 240px (Framer spring 380/28), collapsed by default, persisted.
  14 nav items in the fixed order from the screen briefs, active item with the 4px accent left bar
  + 10% accent wash, Lucide icons at 1.5px (2px active), collapsed-only tooltips (200ms,
  theme-adaptive), static green budget-health dot, user card + rotating `PanelLeft` collapse
  toggle in expanded mode, nav region scrolls only when the viewport is short (logo/user stay pinned).
- **Topbar** — 52px drag region: screen title (macOS traffic-light inset), centered cmdk trigger
  pill (h-9, rounded-full, max 480px, ⌘K chip), wallet widget ($5.00 + green dot → Budget),
  mic (honest Phase 15 toast), notification bell (red "3" badge, 360px popover with empty state +
  Control Room footer), sentinel avatar (temp Phase 1 SVG) → user dropdown
  (Profile / Switch workspace / Settings / Check for updates / Quit XR).
- **Command palette** — cmdk in a themed 640px dialog: Commands (⌘N / ⌘, / ⌘B / ⌘⇧T with shortcut
  chips), Go to screen (all 14), Ask XR ("Ask: {query}" — Phase 4 toast), empty state,
  ↑↓ / Ctrl+N/P navigation, Esc/outside close, auto-focus on open.
- **Page transitions** — `AnimatePresence mode="wait"` keyed on pathname: 80ms fade-out,
  220ms fade + 8px rise in, `prefers-reduced-motion` → opacity only.
- **Keyboard shortcuts** — ⌘K palette · ⌘B sidebar · ⌘N new chat · ⌘. voice · ⌘⇧T theme cycle ·
  ⌘, settings — all via a tiny custom `useHotkeys` hook (no new dependency).
- **Persistence upgraded** — theme + sidebar + display name write-through to the Tauri Store
  (`settings.json`, `store:default` capability added); localStorage stays as the pre-paint
  flash-guard and browser fallback. Works in both shell and browser preview.
- **Platform-aware chrome** — macOS traffic lights (12px dots, 8px apart, 20px inset);
  Windows/Linux 46px caption cluster flush right with clearance for the action cluster;
  nothing rendered in the browser preview.

## Verification

- typecheck / eslint / production build / cargo check + clippy -D warnings + cargo test 3/3 — all green
- Headless Chromium suite: **51/51 checks**, zero console errors
- All 5 themes pixel-verified against `docs/THEME-SYSTEM.md` (body backgrounds match exactly)
- Responsive: force-collapse below 960px (manual expand allowed), nav scroll under 700px height
- Persistence survives reload (theme + sidebar + name)

## Out of scope (by contract)

Feature screen interiors (Phase 0 placeholders unchanged) · real Logo/Avatar SVGs (Phase 2 —
temporary inline X + mini sentinel used) · global HUD window (Phase 5) · notification backend
(Phase 12) · budget data (Phase 13) · voice (Phase 15) · drag-to-resize sidebar.

## Notable fixes made while building

- Radix `asChild` triggers require ref-capable children on React 18 — user-menu triggers now
  render as plain DOM buttons inside `UserMenu`.
- Vendored `DialogOverlay` converted to `forwardRef` (Radix's portal clones children with refs —
  was emitting a console error on every palette open).
- `useThemeShortcut` retired (same behavior via `useHotkeys`); tooltip primitive now uses the
  per-theme `--tooltip-bg/--tooltip-fg` tokens from the theme adaptation table.
