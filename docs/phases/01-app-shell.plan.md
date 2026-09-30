# Phase 1 — App Shell · Implementation Plan

> Build contract: `docs/SCREEN-BRIEFS.md` §GLOBAL APPLICATION SHELL, `docs/IMPLEMENTATION-PLAN.md` §PHASE 1,
> `docs/DESIGN-SYSTEM.md` (components/motion/a11y), `docs/THEME-SYSTEM.md` (5 themes + adaptation table).
> Everything below extends the Phase 0 scaffold — nothing Phase 0 shipped is removed.

## Research summary (Step 2)

1. **cmdk v1** — composable `Command.Input/List/Group/Item/Empty`; built-in ↑↓ + Ctrl+N/P navigation and ARIA
   combobox; shadcn wraps it in a Dialog for overlay + focus trap. Global `⌘K` listener calls `preventDefault()`.
2. **Tauri v2 frameless chrome** — `data-tauri-drag-region` on the topbar, traffic lights/window controls are plain
   buttons invoking the existing Phase 0 Rust commands (least-privilege `core:window:*` permissions — pattern
   confirmed in the wild). Double-click on the drag region maximizes natively. No extra plugin needed.
3. **Page transitions** — `AnimatePresence mode="wait"` + `motion.div` keyed on `location.pathname` around the
   router outlet. Exit = fade 80ms; enter = fade + 8px rise, spring(380, 28). Reduced motion = opacity only.
4. **Sonner** — `<Toaster position="bottom-right" />` styled via `toastOptions.classNames` per part and per
   variant (success/error/warning left-border accents) using our CSS vars; no `richColors`; colors follow
   `data-theme` automatically because everything resolves through `var(--*)`.
5. **Hotkeys** — custom `useHotkeys` hook (single `window` keydown listener, modifier-combo matching,
   `preventDefault` on match). No mousetrap/react-hotkeys-hook dependency.
6. **Sidebar** — fixed 72/240px widths (drag-to-resize explicitly skipped), width animated with
   Framer `spring(380, 28)`.
7. **Radix** — repo convention is the unified `radix-ui` package; `Popover` + `Command` wrappers are vendored in
   the existing shadcn-v4 file style.
8. **Tauri Store** — `@tauri-apps/plugin-store` already in deps and registered in Rust; needs the `store:default`
   capability. `Store.load('settings.json')` + `get/set`. The store is the durable source inside Tauri;
   `localStorage` stays as the synchronous pre-paint source (theme-init.js) and browser fallback — both are
   written on every change (write-through).

## Files

### New
| File | Purpose |
|---|---|
| `desktop/src/components/brand/Logo.tsx` | Temporary inline-SVG logo — `icon` (28px X + cyan core) and `full` (X + "XR" Orbitron wordmark) variants. Replaced by the real SVG in Phase 2. |
| `desktop/src/components/brand/MiniAvatar.tsx` | Temporary 28px sentinel avatar — black circle, two cyan almond eye slits, cyan chest dot. ≤20 SVG lines. Replaced in Phase 2. |
| `desktop/src/components/layout/PageTransition.tsx` | `AnimatePresence mode="wait"` wrapper around the outlet, keyed on pathname; reduced-motion aware. |
| `desktop/src/components/layout/WalletWidget.tsx` | Wallet icon + static `$5.00` + green health dot; navigates to `/budget`. |
| `desktop/src/components/layout/MicButton.tsx` | 32px button → Sonner "Voice coming in Phase 15". |
| `desktop/src/components/layout/NotificationBell.tsx` | Bell + red "3" badge → 360px popover (empty state, header, footer → /runs). |
| `desktop/src/components/layout/UserMenu.tsx` | Avatar → dropdown (Profile / Switch workspace / Settings / Check for updates / Quit). |
| `desktop/src/components/layout/UserCard.tsx` | Expanded-sidebar bottom user card (24px avatar, name, "Personal" badge). |
| `desktop/src/components/cmdk/CommandPalette.tsx` | cmdk dialog: Commands + Go to screen + Ask XR groups, empty state, shortcut hints. |
| `desktop/src/components/ui/popover.tsx` | shadcn v4 popover primitive (unified `radix-ui` package). |
| `desktop/src/components/ui/command.tsx` | shadcn v4 command primitive (cmdk wrapper, XR tokens). |
| `desktop/src/stores/sidebar.ts` | `useSidebarStore` — collapsed (default true), forced-below-960px, Tauri Store persistence. |
| `desktop/src/stores/ui.ts` | `useUIStore` — platform, palette open state, persisted user display name. |
| `desktop/src/hooks/useHotkeys.ts` | Modifier-combo keydown hook with preventDefault. |
| `desktop/src/lib/persistent-store.ts` | Tauri Store (`settings.json`) load/get/set helpers + localStorage write-through fallback. |
| `desktop/previews/implementation/phase-01/*.png` | Step 6 screenshots. |

### Modified
| File | Change |
|---|---|
| `src/components/layout/Sidebar.tsx` | Full rewrite per brief §5.2: 72↔240 animated widths, 14 items in fixed order, active 4px left bar, tooltips (collapsed), budget dot, user card, collapse button, sticky top/bottom + scrollable middle below 700px viewport height. |
| `src/components/layout/Topbar.tsx` | Full rewrite per brief §5.3: title/breadcrumbs, centered cmdk pill, wallet/mic/bell/avatar right, Windows/Linux controls right, macOS lights left (via existing WindowControls, refined). |
| `src/components/layout/WindowControls.tsx` | Refine: macOS lights 20px from left/8px gaps/12px dots (already close); Windows/Linux cluster 40px tall flush-right with hover glyphs; hidden in browser. |
| `src/components/layout/AppShell.tsx` | Wrap `<Outlet/>` in `PageTransition`; `<TooltipProvider>`; mount `CommandPalette`, `<Toaster/>` (or in App). |
| `src/App.tsx` | Global overlays: TooltipProvider, Toaster, CommandPalette, useHotkeys registrations, dev welcome toast. |
| `src/stores/theme.ts` | Persistence → write-through `lib/persistent-store` (Tauri Store primary, localStorage fallback/flash-guard). |
| `src/hooks/useThemeShortcut.ts` | Retired — superseded by `useHotkeys` registrations (file deleted). |
| `src/screens/Settings/_dev/ThemeToggle.tsx` | Kept (honest dev affordance) — re-skinned minimally to match new primitives if needed. |
| `src/styles/themes.css` | Add tooltip semantic tokens (`--tooltip-bg`, `--tooltip-fg`) per theme adaptation table. |
| `src-tauri/capabilities/default.json` | Add `store:default` permission. |
| `docs/phases/01-app-shell.plan.md` | This file. |
| Root `package.json` | Only if the typecheck/test surface needs a Phase 1 entry (no script changes expected). |

### Deleted
- `src/hooks/useThemeShortcut.ts` (superseded; behavior preserved via `useHotkeys`).

## Components breakdown

- **Logo** (`variant: 'icon' | 'full'`) — two silver diagonal strokes (metal sweep gradient) crossing as an X,
  3px cyan core dot at the intersection. `full` adds "XR" in Orbitron 20px `text-accent`, tracking 0.04em.
- **Sidebar** — `motion.aside` width 72↔240 (spring 380/28). Top: Logo (24px from top). Middle: nav (14 items,
  fixed order from `lib/nav.ts`). Bottom: UserCard (expanded only) + collapse button (`PanelLeft`, rotates
  180°). Active item: `bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]` + 4px left accent bar
  (28px tall collapsed / 24px expanded, `rounded-r`, absolute left-0, centered). Budget item gets a 6px
  status dot (static green). Collapsed items: 44px squares. Expanded: 40px rows, 14px labels. Tooltips
  (collapsed only, 200ms delay, side="right", theme-adaptive via `--tooltip-bg/--tooltip-fg`, arrow enabled).
- **Topbar** — 52px, `bg-bg-void`, sticky, drag region. Left: screen title (18px semibold; macOS inset for
  traffic lights). Center: cmdk pill (h-9, rounded-full, max-w-[480px], Search icon, placeholder, ⌘K mono chip).
  Right: WalletWidget · MicButton · NotificationBell · UserAvatar(28px). Windows/Linux: window controls
  flush-right (controls move to the far right; actions keep 8px clearance).
- **CommandPalette** — 640px, `rounded-xl`, `bg-bg-ink` + `border-subtle`, backdrop blur 20px, XR-Native glow
  (accent-glow shadow) vs plain shadow in Paper/Arctic (token-driven). Input row: Logo icon 24px + cmdk.Input
  (16px, borderless). Groups: Commands (New chat ⌘N, Open Settings ⌘,, Toggle Sidebar ⌘B, Cycle Theme ⌘⇧T),
  Go to screen (all 14 with icons), Ask XR ("Ask: {query}" — appears when input non-empty; toast "Chat command
  coming in Phase 4"). Empty state: "No results — press Enter to ask XR". Esc closes (Dialog). Focus returns on
  close.
- **PageTransition** — see research #3.
- **WalletWidget / MicButton / NotificationBell / UserMenu** — per brief §5.3/5.8/5.9. Static data only.

## Stores

- `useSidebarStore` — `{ collapsed, forced, setCollapsed, toggle, setForced }`. Default `collapsed: true`
  (brief: icon-only on launch). Persisted via write-through (Tauri Store `sidebar.collapsed` + localStorage key
  `xr.sidebar.collapsed`).
- `useUIStore` — `{ platform, setPlatform, paletteOpen, setPaletteOpen, userName, setUserName }`. `userName`
  persisted the same way (default "You").
- `useThemeStore` — unchanged API; persistence swapped to write-through helper. `theme-init.js` keeps reading
  localStorage (flash guard). Tauri Store value wins on async hydration (only applies if it differs).

## Tauri / Rust

- No new commands. Existing: `minimize_window`, `toggle_maximize`, `close_window`, `get_platform`,
  `theme_changed`. `plugin-os` JS `platform()` used via `resolvePlatform()` (already).
- Capabilities: add `store:default` (plugin already registered in Rust since Phase 0).
- `cargo check` + `clippy -D warnings` + tests re-run locally (Rust toolchain reinstalled in sandbox).

## Keyboard shortcuts (all via `useHotkeys`, all `preventDefault`)

| Combo | Action |
|---|---|
| `⌘/Ctrl + K` | Toggle command palette |
| `⌘/Ctrl + B` | Toggle sidebar |
| `⌘/Ctrl + N` | New chat → navigate `/chat` + toast "New chat — chat logic coming in Phase 4" |
| `⌘/Ctrl + .` | Mic → toast "Voice coming in Phase 15" |
| `⌘/Ctrl + Shift + T` | Cycle theme (all 5) |
| `⌘/Ctrl + ,` | Navigate `/settings` |
| `Esc` | Close overlays (Dialog/Dropdown/Popover handle natively; palette Esc wired via Dialog) |

## Platform differences

- macOS: traffic lights (12px, 8px gap, 20px from left) → title inset `ml-[84px]`.
- Windows/Linux: min/max/close cluster flush-right, 40px tall; title `ml-6`; right-side actions keep 8px gap
  from controls. Topbar stays 52px (brief: keep for simplicity).
- Browser (no Tauri): no window controls, no traffic-light inset; everything else identical.

## Edge cases

- Viewport `<960px` → sidebar forced collapsed (auto re-forces on resize; ⌘B still works but re-collapses while
  under the breakpoint). `matchMedia('(max-width: 959px)')` listener in AppShell.
- Viewport height `<700px` → nav middle becomes `overflow-y-auto`; logo + user/collapse stay sticky.
- cmdk: modal Dialog = focus trapped; page scroll continues underneath (brief: no scroll lock); outside click +
  Esc close; focus returns to trigger on close.
- Dropdowns/popovers: outside click, Esc, item select all close (Radix defaults).
- Reduced motion: transitions become opacity-only; sidebar width animates instantly (no spring); tooltips fine.
- Sidebar tooltips hidden in expanded mode; budget dot stays in both modes.
- Wallet text hidden below content-width threshold (`lg:` breakpoint utility on the label span; icon-only below).

## Manual test checklist (Step 6 gate)

1. `bun install` clean → `bun run typecheck` 0 errors → `bun run lint` 0 errors → `bun run build` green.
2. `cargo check` + `clippy -D warnings` + `cargo test` green.
3. Sidebar: 14 items in order, Chat active on launch (cyan left bar), collapse default, tooltips at 200ms
   (collapsed only), budget dot, user card (expanded), collapse button rotates, width animates 72↔240.
4. Every icon routes; active bar follows; page transition fades (no slide sideways).
5. Topbar: title tracks route; cmdk pill centered; wallet → /budget; mic → toast; bell → popover empty state;
   avatar → dropdown (Settings navigates; Quit closes window in Tauri; placeholders toast).
6. ⌘K palette: groups render, ↑↓/Ctrl+N/P navigate, Enter selects, Esc + outside click close, "Ask: …" appears
   with input, empty state correct.
7. Shortcuts: ⌘B / ⌘K / ⌘N / ⌘. / ⌘⇧T (cycles all 5) / ⌘, all work; browser defaults suppressed.
8. All 5 themes: sidebar/topbar/pill/tooltip/palette/toast all token-correct (no hardcoded hex in components).
9. Resize 900px → force-collapse; 1400px → expandable. Height 600px → nav scrolls, top/bottom sticky.
10. Persistence: theme + sidebar + name survive reload (localStorage in browser; Tauri Store in shell).
11. Screenshots ×7 saved to `previews/implementation/phase-01/`.

## Out of scope (explicit)

Feature screen interiors (chat/brain/etc. stay Phase 0 placeholders) · real Logo/Avatar SVGs (Phase 2) · global
HUD floating window (Phase 5) · notification backend (Phase 12) · voice (Phase 15) · real budget data (Phase 13)
· drag-to-resize sidebar · splash/onboarding · any new runtime dependency.

## Verification results (Step 6 — all green)

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | ✓ 286 packages, no lockfile changes (zero new deps) |
| `bun run typecheck` | ✓ 0 errors |
| `bun run lint` (eslint, react-hooks v7 strict) | ✓ 0 errors (2 fixes during dev: ref-current-in-render, set-state-in-effect) |
| `bun run build` (tsc + vite) | ✓ 647 kB js / 208 kB gzip (framer-motion + sonner + cmdk added) |
| `cargo check` / `clippy -D warnings` / `cargo test` | ✓ clean / clean / 3-3 (capabilities change verified) |
| Headless Chromium suite (`verify.mjs`) | **51/51 PASS**, zero console errors |
| Theme pixel truths (body bg) | xr-native rgb(3,7,13) · graphite rgb(74,74,74) · midnight rgb(13,20,34) · paper rgb(237,230,217) · arctic rgb(255,255,255) — all match docs/THEME-SYSTEM.md |

Suite highlights: 14 nav items in fixed order · active 4px accent bar follows route · collapsed-only
tooltips at 200 ms · ⌘B 72↔240 spring · user card + wordmark in expanded mode · wallet → /budget ·
mic → toast · bell popover (empty state + footer → /runs) · avatar dropdown (Settings → route,
Quit) · ⌘K palette (auto-focus, 4 commands + 14 screens + Ask XR, filter, Enter select, Esc) ·
⌘⇧T cycles all 5 · force-collapse <960 px (manual expand allowed) · nav scrolls at short viewport
with pinned top/bottom · theme + sidebar persist across reload (write-through Tauri Store + localStorage).

## Issues found during verification + resolutions

1. **Radix asChild + custom trigger components** — `DropdownMenuTrigger asChild` needs to attach a
   ref to its child; the original avatar/user-card triggers were plain function components
   (React 18 → no ref forwarding) so the dropdown silently never opened. Fixed by rendering the
   trigger button inside `UserMenu` itself (plain DOM element).
2. **Vendored `dialog.tsx` DialogOverlay ref warning** — Radix `DialogPortal` renders each child
   through `Portal asChild` (ref clone); the vendored overlay wrapper was not forwardRef →
   "Function components cannot be given refs" console error on every palette open. Fixed by
   converting `DialogOverlay` to `React.forwardRef` (documented in-file).
3. **Dev server crash (ENOSPC inotify)** — running `cargo check` created ~40k files under
   `src-tauri/target`; the file watcher exhausted the sandbox's inotify limit. Raised
   `fs.inotify.max_user_watches` and cleaned 7.6 GB of target artifacts (excluded from snapshots).
