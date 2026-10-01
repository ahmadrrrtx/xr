# Phase 6 — Companion Orb · Plan

**Goal (docs/IMPLEMENTATION-PLAN.md §PHASE 6, docs/SCREEN-BRIEFS.md §OV-3):** the
floating orb always visible on the desktop — listens, responds, opens XR. A dedicated
120×120 frameless transparent always-on-top Tauri window renders the existing Phase 2
`<CompanionOrb />` SVG at 80px, is draggable with native `startDragging()`, remembers
its position (with off-screen reset), offers a **native OS** right-click context menu,
syncs its 7 states with app activity, auto-sleeps after 30 minutes of inactivity, and
toggles via a global ⌥⌘O shortcut. Shows only after onboarding completes.

## 0. Research summary (Step 2)

1. **Drag + clicks:** official pattern is a JS `mousedown` listener calling
   `getCurrentWindow().startDragging()`; the known bug (tauri#10767) is that drag
   hand-offs can swallow `mouseup`/focus. We therefore use a **movement-threshold
   drag**: `startDragging()` only fires once the press moves >4px — stationary
   presses always deliver normal `click` events on every platform.
2. **Double-click:** detected on `mousedown` via `e.detail === 2` (the documented
   Tauri titlebar trick) — the second press of a double-click never starts a drag.
3. **Native context menu:** `tauri::menu::{Menu, MenuItem, PredefinedMenuItem}`;
   the `ContextMenu` trait provides `menu.popup(window)` which pops **at the
   cursor** — exactly the right-click position. Selections arrive on
   `AppHandle::on_menu_event` (verified against the tauri 2.12.0 source); ids are
   `orb-`-prefixed so they can't collide with the tray menu's ids.
4. **Position memory:** `WindowEvent::Moved(PhysicalPosition)` on the orb window;
   saves are rate-limited (≥1.5s apart) plus a final flush on hide/exit. All math
   in **physical px** (hud.rs convention); the 24px default margin is converted via
   the monitor's `scale_factor` so it reads 24pt on any DPI.
5. **Off-screen protection:** no monitor-change event exists in Tauri v2 — we
   revalidate reachability against `available_monitors()` on: orb show, app
   second-instance, and the main window's `ScaleFactorChanged` (display-change
   proxy), same `MonitorRect` overlap test as hud.rs.
6. **Floating level:** `alwaysOnTop: true` maps to NSFloatingWindowLevel on macOS;
   `skipTaskbar` hides from Windows/Linux taskbar (all windows share the Dock icon
   on macOS); `focus: false` + `acceptFirstMouse: true` keep the orb non-activating
   on show while still receiving clicks (a click still briefly activates XR on
   macOS — accepted v1 limitation, prompt OOB §6).
7. **Glow dimming:** the theme system already exposes `--avatar-glow-strength`
   (xr-native 8px … paper/arctic 0px). The orb always renders in XR Native
   signature colors; a new `--orb-glow-intensity` (set from the existing
   `palette:theme-change` broadcast — no new IPC) scales it: 1.0 for
   xr-native/midnight/graphite, 0.6 for paper/arctic.
8. **State sync:** JS `emit()` broadcasts to every webview (Phase 5), so the main
   window emits `orb:set-state` and the orb receives it directly — no Rust
   forwarding hop. Rust-side events (`orb:voice-requested` …) use `emit_to("main")`.

## 1. Files

**Created**
- `desktop/orb.html` — third Vite entry; hardcoded `data-theme="xr-native"` (the
  orb is a branded desktop presence, not a themed surface); no font preload, no
  theme-init.js — the smallest possible document.
- `desktop/src/orb/main.tsx` — entry: `createRoot(#orb-root)` + globals.css only.
- `desktop/src/orb/App.tsx` — `OrbApp`: state machine, IPC listeners, pointer
  classification (click / double-click / drag / right-click), inactivity sleep
  timer, entrance animation, `role="button"` + live `aria-label`.
- `desktop/src/lib/orb.ts` — typed IPC bridge (hud.ts pattern): browser no-ops,
  `orbShow/Hide/Toggle`, `orbSetState`, `orbEmitClicked`, `orbContextMenu`,
  `isOrbWindow()`, glow map.
- `desktop/src/lib/orbCore.ts` — pure, alias-free logic for the root test tier:
  state validation, glow-intensity map, sleep-timer config (incl. dev override
  `xr.orb.sleepMs`), double-click window constants.
- `desktop/src/hooks/useOrb.ts` — `useOrbIpc()` for the MAIN window: reacts to
  `orb:clicked` (toast + 2s listening feedback), `orb:voice-requested`,
  `orb:approvals-requested`.
- `desktop/src-tauri/src/commands/orb.rs` — window ops + position memory +
  native menu + shortcut + events (+ unit tests).
- `desktop/src-tauri/capabilities/orb.json` — `windows: ["orb"]`,
  `core:default` + `core:window:allow-start-dragging` (same shape as hud.json).
- `test/desktop/orb-core.test.ts` — unit tests for orbCore.
- `docs/phases/06-companion-orb.plan.md` (this file) + `06-companion-orb.report.md`.

**Modified**
- `desktop/vite.config.ts` — +`orb: resolve(projectRoot, 'orb.html')` entry.
- `desktop/src-tauri/tauri.conf.json` — +orb window (below).
- `desktop/src-tauri/src/commands/mod.rs` — +`pub mod orb;`.
- `desktop/src-tauri/src/lib.rs` — `orb::init` in setup, `orb_*` commands in the
  handler (menu events are registered inside `orb::init` via
  `app.on_menu_event`). Exit cleanup already covered: `hud::unregister_all`
  unregisters every global shortcut, orb's included.
- `desktop/src/styles/globals.css` — `body.orb` transparent chrome, 120×120,
  user-select none, overflow hidden.
- `desktop/src/styles/themes.css` — orb glow scaling
  (`--avatar-glow-strength: calc(… × var(--orb-glow-intensity))` + halo opacity
  rule). No new color literals.
- `desktop/src/components/brand/CompanionOrb.tsx` — one attribute: the halo
  circle gains `className="xr-orb-halo"` (so its opacity can scale). Everything
  else untouched.
- `desktop/src/stores/chatStore.ts` — stream lifecycle → orb state
  (thinking → speaking → idle / error).
- `desktop/src/components/palette/CommandPalette.tsx` — quick-ask streams also
  drive the orb (same helper, two lines).
- `desktop/src/screens/Onboarding/index.tsx` — after `finishOnboarding()` →
  `orbShow()`.
- `desktop/src/components/layout/AppShell.tsx` — mount `useOrbIpc()`.
- `desktop/src/lib/paletteCommands.ts` — dev-only "Cycle Orb States" command.

**Deviations from the prompt's file list (deliberate, HUD-pattern):**
`src/orb/orb.html` → `desktop/orb.html` (Vite multi-entry needs the HTML at the
project root, exactly like `hud.html` in Phase 5); `src/hooks/useOrbPosition.ts`
→ folded into Rust (`commands/orb.rs`) + `lib/orb.ts`, because Rust owns windows
and the store — a JS position hook would duplicate the validated hud.rs logic.

## 2. Orb window config (`tauri.conf.json > app.windows`)

```json
{
  "label": "orb",
  "url": "orb.html",
  "title": "XR Orb",
  "width": 120, "height": 120, "minWidth": 120, "minHeight": 120,
  "resizable": false, "decorations": false, "transparent": true,
  "alwaysOnTop": true, "skipTaskbar": true, "visible": false,
  "focus": false, "shadow": false, "acceptFirstMouse": true
}
```
Transparency on macOS rides the existing `macOSPrivateApi: true` +
`macos-private-api` feature from Phase 5. `shadow: false` — the halo/glow is
painted by the SVG, not the OS.

## 3. Default position, position memory, off-screen reset

- First launch: primary monitor, **24 logical px** (× `scale_factor`) from the
  right and bottom edges — `default_corner(monitor, scale)`.
- On every show: `choose_position(saved, monitors, primary)` — reuse the hud.rs
  reachability test (overlap with any monitor); unreachable/default → bottom-right
  of the primary.
- `WindowEvent::Moved` → rate-limited store save (`xr.orb.position` = `[x, y]`,
  physical px) + final flush on hide and on exit.
- Revalidate on: orb show, second-instance focus, main `ScaleFactorChanged`.

## 4. IPC surface

**Events (broadcast unless noted)**
- `orb:set-state` `{ state: AvatarState }` — main → orb (chat/quick-ask streams).
- `orb:clicked` — orb → main (single click; main shows the Phase 15 toast).
- `orb:double-clicked` — orb → Rust (shows + focuses main; also resets sleep).
- `orb:context-menu` — orb → Rust (`orb_show_context_menu` command instead; the
  menu pops at the cursor, so no coordinates travel).
- `orb:show` / `orb:hide` — Rust → all (after window ops, for state cleanup).
- `orb:voice-requested` / `orb:approvals-requested` — Rust → main
  (`emit_to("main")`; v1 toasts, Phase 7/15 wire the real surfaces).

**Commands (Rust)**
- `orb_show` / `orb_hide` / `orb_toggle` — window ops; hide/toggle persist
  `xr.orb.showOrb` (default `true`) so relaunches respect the user's choice.
- `orb_get_position` → `{x, y}` · `orb_set_position(x, y)` — validated + saved.
- `orb_show_context_menu` — pops the native menu on the orb window at the cursor.

**Startup gate (Rust, in `orb::init`):** show the orb only when
`xr.onboarding.complete === true` AND `xr.orb.showOrb !== false`.

## 5. Native context menu (right-click)

`Open XR` (`orb-open`) · `Start Voice Session` (`orb-voice`) ·
`Pending Approvals` (`orb-approvals`) · — · `Settings…` (`orb-settings`) ·
`Hide Orb` (`orb-hide`) · — · `Quit XR` (`orb-quit`)

- open/voice/approvals/settings: surface + focus main; settings additionally
  `emit_to("main", "palette:navigate", "/settings")` (the Phase 5 route event).
- voice/approvals also emit their `*-requested` events (v1 toasts).
- hide: `orb_hide` (persists `showOrb: false`).
- quit: `app.exit(0)`.

## 6. Pointer behavior (orb webview)

- `mousedown` left: record press; `e.detail === 2` → double-click action (emit
  `orb:double-clicked`), no drag. Otherwise arm drag.
- first move >4px while pressed → `startDragging()` (movement-threshold; click
  events are never swallowed).
- `click` (only when no drag started): single click → orb plays `listening`
  locally for 2s (dev override `xr.orb.clickPreviewMs`), emits `orb:clicked`,
  returns to idle. v1 toast in the main window: "Push-to-talk voice arrives in
  Phase 15."
- `contextmenu`: `preventDefault()` + `orb_show_context_menu()` (native menu).
- Any interaction resets the sleep timer.

## 7. States, sleep, sync

- State machine in the orb webview; incoming `orb:set-state` wins over the local
  click preview; `error` auto-reverts to `idle` after ~2.5s (the SVG's error
  animation is a finite 2s flash).
- Sleep: 30 min without interaction/state changes → `sleeping` (component pauses
  ring rotation + slows breathing itself). Any interaction/event → `idle`.
  Dev override: `xr.orb.sleepMs` (used by tests to shorten).
- Chat sync (`chatStore.runGeneration`): stream opens → `thinking`; first token →
  `speaking`; done/stopped → `idle`; error → `error`. Quick-ask (palette) uses
  the same helper.
- Glow: orb listens to the existing `palette:theme-change` broadcast → sets
  `--orb-glow-intensity` (1.0 / 0.6). Colors stay XR Native black+cyan always.

## 8. Animation & performance

- Entrance once per app start: scale 0.6→1 + fade, 300ms spring (framer-motion).
- All orb motion is SVG/CSS transforms (GPU); sleeping pauses the ring. No
  canvas, no particles, no timers beyond the sleep/idle clocks. The entry bundle
  excludes router/chat/shiki (verified in the build report).

## 9. Accessibility

- Orb wrapper: `role="button"`, `aria-label="XR Companion, {state}"` (live),
  `aria-haspopup="context menu"`. Keyboard focus is never trapped (no focusable
  children; the window takes focus on click only — accepted macOS limitation).
- Reduced motion: already honored inside CompanionOrb (static frame, no rings).

## 10. Test checklist

1. `bun install` clean; 2. `tsc` (both tsconfigs) zero errors; 3. eslint zero;
4. `cargo check` + `cargo clippy -D warnings` + `cargo test` (orb position/corner
   math, menu ids, shortcut pairs); 5. root lane `bun test` (orb-core units);
6. Playwright (browser, orb.html entry): 7 states render (incl. wave rings,
   sleeping ring pause), aria-label updates, single click → listening preview +
   `orb:clicked` seam, double-click seam, right-click → contextmenu prevented +
   command seam, sleep after shortened timer + wake, entrance animation settles,
   glow var switches with theme broadcast; 7. vite build — all three entries, orb
   chunk free of router/chat/shiki; 8. desktop suite green.
   Native-only behaviors (real drag, OS menu, always-on-top, Dock behavior) are
   verified on Ahmad's machine — headless sandbox can't run the native shell.

## 11. Out of scope (v1)

Real voice/mic (Phase 15) · Approvals UI (Phase 7 — menu item + toast only) ·
menubar/tray orb mode (Phase 27) · auto-avoid fullscreen apps · click bounce
animation · orb sounds · **hover tooltip "Hey, Ahmad — I'm here"** (OV-3 lists
it, but a 120×120 window physically cannot host an above-the-orb tooltip; needs
a separate tooltip window — deferred, noted for a later polish pass) ·
non-activating NSPanel (tauri-nspanel).
