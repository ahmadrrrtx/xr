# Phase 5 — HUD Command Palette · Plan

Status: PLANNED → implementing. Branch `phase/5-hud-palette` (off `fix/main-ci-red`, which carries
the main-branch CI repairs in PR #142 — Phase 5 starts from a green base).

## 0. Research summary (Step 2)

1. Tauri v2 windows: declare a second entry in `app.windows` (unique label, `visible:false`) —
   created at launch, webview loads while hidden, shown via `WebviewWindow.getByLabel('hud')`.
   Duplicate labels panic. Relative `url: "hud.html"` resolves against `devUrl` in dev and
   `frontendDist` in prod.
2. Events: JS `emit()` broadcasts to every webview + Rust listeners; `emitTo(label, …)` targets
   one; plain `listen()` in a webview receives all events of that name. Rust side: `AppHandle::listen_any`
   catches webview-emitted events.
3. Global shortcut: register in Rust (`app.global_shortcut().on_shortcut(s, handler)`); registration
   failure returns `Err` → fall back. Handler must check `ShortcutState::Pressed` (avoids the
   macOS double-fire release event). Explicit `unregister_all()` on `RunEvent::Exit` (macOS keeps
   hotkeys until reboot otherwise; plugin cleans on process exit, explicit cleanup is belt+braces).
4. macOS transparency requires `"macOSPrivateApi": true` in `tauri.conf.json` **and** the
   `macos-private-api` cargo feature on the `tauri` crate; `body` must be `background: transparent`
   or the window renders opaque. True non-activating NSPanel (Spotlight-class, never steals focus)
   needs the 3rd-party `tauri-nspanel` plugin — out of scope for v1; standard window + focus-on-show
   is accepted (documented limitation).
5. Capabilities are per-window lists: `hud` needs its own capability file (windows: ["hud"]) or it
   cannot invoke commands/listen. Custom app commands work for any window covered by a capability.
6. cmdk: `<Command.Group>` auto-hides via the `hidden` **attribute** (not unmount) — author CSS
   `[cmdk-group][hidden]{display:none!important}` because Tailwind classes on the group would
   otherwise override the UA stylesheet. Built-in fuzzy scoring + keyword support is sufficient
   (no fuse.js). `Command.Empty` renders when zero items match.
7. cmdk exposes no "select Nth visible item" API — ⌘1–9 is implemented by dispatching synthetic
   Home/(ArrowDown ×N−1)/Enter keydowns on the Command root, which follows cmdk's own score order
   by construction.
8. Raycast/Arc/Linear conventions worth copying: keyboard-first (no hover-only actions), shortcut
   hints right-aligned, recent items first, backspace-on-empty closes, Escape layers (stop stream →
   close), result groups with uppercase micro-headers.
9. Theme sync across webviews: both windows share one origin → shared `localStorage`, so
   `theme-init.js` pre-paint works in `hud.html` unchanged; live sync rides the existing
   `theme_changed` Rust command (extended to broadcast to the hud webview).
10. Position memory: Rust reads/writes `settings.json` via tauri-plugin-store (same file the
    frontend uses); on show, a saved position is used only if it intersects a current monitor's
    bounds, else re-center (handles unplugged monitors).

## 1. Files

Created:
- `desktop/src/components/palette/CommandPalette.tsx` — shared palette (used in-app + HUD), prop `embedded: boolean`.
- `desktop/src/components/palette/PaletteInput.tsx` — 56px input row: Logo/Avatar 24px, input, ESC badge; drag region in HUD mode.
- `desktop/src/components/palette/PaletteResults.tsx` — cmdk List + Empty + groups.
- `desktop/src/components/palette/PaletteItem.tsx` — icon/title/subtitle/shortcut-chip row.
- `desktop/src/components/palette/PaletteQuickAsk.tsx` — in-palette streaming answer + Stop / Open in chat.
- `desktop/src/components/palette/PaletteFooter.tsx` — hint line + (HUD) Open XR.
- `desktop/src/hooks/usePalette.ts` — open/close/toggle + ⌘K binding (in-app), reset-on-open, escape layering, ⌘1–9 dispatch helper.
- `desktop/src/stores/paletteStore.ts` — open, mode (`commands|quick-ask`), query, history (last 10 ids), quickAsk {question, answer, status}.
- `desktop/src/lib/paletteCommands.tsx` — command registry `buildPaletteCommands({ isHud })` → static commands + dynamic Chats/Agents/Workspaces/Settings groups.
- `desktop/src/lib/hud.ts` — tiny IPC wrapper for HUD-window actions (`hudNavigate`, `hudClose`, `hudToggle`, `hudRequestTheme`, `runMainCommand`) — no-ops in browser preview.
- `desktop/hud.html` — second Vite entry (same CSP, `#hud-root`, `theme-init.js`).
- `desktop/src/hud/main.tsx` + `desktop/src/hud/App.tsx` — minimal HUD shell: theme, transparent body, `<CommandPalette embedded={false} />`, blur→auto-hide, Escape→hide window, sessions hydration on show.
- `desktop/src-tauri/src/commands/hud.rs` — shortcut registration + fallback, show/hide/toggle with position memory + on-screen validation, `hud_navigate`, `hud_toggle_sidebar`, event plumbing; Rust unit tests.
- `desktop/src-tauri/capabilities/hud.json` — hud window capability.
- Tests: `test/desktop/palette-commands.test.ts` (registry/prefix/threshold logic), `test/desktop/palette-e2e.spec.ts` (in-app Playwright flows).

Modified:
- `desktop/src-tauri/tauri.conf.json` — +hud window entry, `+macOSPrivateApi: true`.
- `desktop/src-tauri/src/lib.rs` — wire `commands::hud::init`, exit cleanup (unregister shortcuts), `hud_*` in invoke_handler, RunEvent loop.
- `desktop/src-tauri/src/events.rs` — `theme_changed` also broadcasts `palette:theme-change` to the hud webview.
- `desktop/src-tauri/Cargo.toml` — `tauri` features += `macos-private-api`.
- `desktop/vite.config.ts` — multi-page input (`index.html`, `hud.html`).
- `desktop/src/components/cmdk/CommandPalette.tsx` — replaced by a thin re-export of the shared palette (App.tsx import path unchanged).
- `desktop/src/styles/globals.css` — hud body transparency, `[cmdk-group][hidden]`, glass surface class.
- `desktop/src/components/layout/AppShell.tsx` — listens for `palette:theme-change`/`palette:execute-command`/`hud:sessions-changed` (HUD-originated cross-window effects).

Unchanged: `src/router.tsx` (palette is an overlay, not a route).

## 2. HUD window config

```json
{
  "label": "hud",
  "url": "hud.html",
  "title": "XR HUD",
  "width": 640, "height": 480,
  "minWidth": 480, "minHeight": 200,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "visible": false,
  "focus": false,
  "shadow": false,
  "center": true,
  "acceptFirstMouse": true
}
```
- `app.macOSPrivateApi: true` (+ cargo feature) for macOS transparency.
- No native `windowEffects` vibrancy in v1: CSS `backdrop-filter: blur(20px) saturate(1.4)` +
  per-theme translucent bg is the one cross-platform path (Linux compositor-dependent; solid
  fallback reads fine at ≥0.88 alpha). macOS vibrancy can be layered on later without UI change.
- NSPanel/non-activating: **out of scope v1** (3rd-party plugin) — window takes focus on show,
  hides on blur. Documented in limitations.
- Position: saved `[x,y]` in `settings.json` (`xr.hud.position`) on hide; on show reused only if
  it intersects a current monitor, else centered on primary. Draggable via the input row
  (`data-tauri-drag-region`; the input/logo themselves are not drag regions).

## 3. Global shortcut

- Default per platform (read `xr.hud.shortcut` from settings.json first — user override wins):
  - macOS: `Cmd+Space` → fallback `Alt+Space`
  - Windows/Linux: `Alt+Space` → fallback `Ctrl+Shift+Space`
- Registered in Rust at setup; on failure the fallback is registered and `xr.hud.shortcutConflict`
  is written to settings.json → next palette open surfaces a one-line warning item ("HUD shortcut
  fell back to X — change it in Settings"), plus a dev log line.
- Handler toggles: visible → hide (save position); hidden → position + show + focus.
- `RunEvent::Exit` → `unregister_all()`.
- macOS double-fire guard: only act on `ShortcutState::Pressed`.

## 4. IPC events / commands

Rust commands (invoked from webviews): `hud_navigate(route)`, `hud_close()`, `hud_show()`,
`hud_toggle()`, `hud_toggle_sidebar()`, `hud_shortcut_info()` → { shortcut, fallbackUsed, conflict }.
Events:
- `hud:toggle` / `hud:show` / `hud:hide` — JS↔Rust window ops (commands preferred; events emitted
  after state changes so both webviews can react).
- `palette:theme-change { theme }` — Rust → all webviews (from `theme_changed`); each window
  applies it to its own DOM + store.
- `palette:navigate { route }` — Rust → main webview (from `hud_navigate`); AppShell navigates.
- `palette:execute-command { id }` — HUD → Rust → main webview (e.g. `toggle-sidebar`).
- `hud:sessions-changed` — Rust → main webview after HUD created/changed chat data; main
  sessionsStore reloads.
- `palette:shortcut-failed { shortcut }` — Rust → webviews on registration conflict.
- Deferred: `palette:quick-ask-stream`/`-token` (v1 streams inside the HUD webview via mockLLM
  directly — no cross-window streaming needed until the engine moves to Rust in Phase 14).

## 5. Command registry shape

```ts
interface PaletteCommand {
  id: string;                    // stable, used for history
  group: 'commands' | 'chats' | 'agents' | 'workspaces' | 'settings';
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  shortcut?: string;             // platform-rendered hint
  keywords?: string[];
  action: () => void | Promise<void>;
  devOnly?: boolean;
}
```
Actions are context-aware: `buildPaletteCommands({ isHud })` returns commands whose navigation
actions either run locally (in-app: router) or via `hudNavigate()` (HUD: Rust shows+focuses main,
emits `palette:navigate`, hides HUD).

## 6. Default commands

**Commands**: New Chat (MessageSquare, ⌘N) · Toggle Sidebar (PanelLeft, ⌘B) · Cycle Theme (Palette,
⌘⇧T — works in both windows; Rust broadcasts) · Open Settings (Settings, ⌘,) · Start Voice Session
(Mic, ⌘. → toast "Voice ships in Phase 15") · Show Budget (Wallet) · Pause All Agents (OctagonX →
toast "Pause ships in Phase 13") · Clear Chat History (Trash2 → toast "coming soon").
**Chats** (dynamic): top 6 recent sessions from sessionsStore (HUD hydrates its own store instance
via chat_db — same SQLite backend), icon MessageCircle, subtitle relative time, action → open
`/chat/:id`.
**Agents** (static): Coder, Researcher, Writer, Analyst → toast "Agents ship in Phase 19 — opening
a chat with {name}" + new chat session.
**Workspaces**: "Create workspace" → toast "Workspaces ship in Phase 10".
**Settings**: Open Settings · Keyboard Shortcuts (placeholder toast) · About XR · Check for Updates
(toast "Phase 27") · dev-only: Reset Onboarding · Open Brand Book (`/__brand`) · Test Notification.
Dev commands render only with `import.meta.env.DEV` (also `>` prefix).

## 7. Quick-ask behavior

- Trigger: query ≥3 chars after prefix strip AND no command matches (cmdk Empty state reached) →
  an "Ask XR" item renders top-of-list (`Ask XR: “{query}”`). Enter/click starts quick-ask.
- `paletteStore.quickAsk = { question, answer, status }`; mockLLM `streamChat` (30–60ms/token,
  same provider-shaped contract as chat); results collapse; answer area shows mini Avatar + "XR"
  label, 14px/1.5 pre-wrap text + streaming caret (Phase 4 cursor), max-h 240px, auto-stick to bottom.
- Footer: Stop (abort) while streaming; "Open in chat →" always — creates a session, saves the user
  message + streamed answer via chat_db, navigates (`/chat/:id`); in HUD additionally emits
  `hud:sessions-changed` so main's sidebar refreshes.
- Escape layers: streaming → stop; else close. Clearing the query returns to command mode.
- History boost: none beyond order (recent sessions first in Chats; recent selections pinned as a
  "Recent" group when query is empty) — documented v1 limitation.

## 8. Animation

- Palette open: opacity 0→1, scale 0.96→1, 220ms spring (stiffness 400, damping 30). Close:
  160ms, scale →0.98. (Framer Motion; Radix exit animation in-app.)
- Item stagger on open: 40ms/item, y 8→0, 160ms — capped at first 8 items, skipped under
  `prefers-reduced-motion` (fade only) and skipped while typing (only on open).
- Selection color change: 100ms. Theme change while open: instant via CSS vars.
- No bounce/overshoot.

## 9. Edge cases

- Duplicate HUD windows: impossible — config-declared single window; no runtime creation.
- HUD opened before main webview loaded: `hud_navigate` shows main + emits; AppShell listener
  registered at mount (post-splash) — navigation event before listener → also stash route in
  Rust and main picks it up on `hud:hello` handshake (v1: main is always running after onboarding).
- Monitor unplugged: saved position validated against current monitor bounds → re-center.
- Streaming + blur: HUD does NOT auto-hide while streaming (finish or stop first).
- Screen readers: cmdk combobox/listbox/option roles kept; ESC badge aria-hidden; groups labeled.
- Reduced motion: fades only.
- Keyboard layouts: shortcut hints render ⌘ on macOS, Ctrl+/Alt+ elsewhere (`usePlatform`).
- Fast typing: <100 items, no virtualization needed; registry rebuilt via useMemo on [sessions, open].
- Backspace on empty query closes (Raycast parity).
- Triple-Esc: dev-only debug toast (version, window label, theme, platform) for 2s.

## 10. Test checklist

Unit (`bun test`): registry group membership; prefix parsing (/ @ ? >); quick-ask threshold
(≥3 chars + no matches); platform shortcut labels; history pinning order; hud.ts browser no-ops.
Playwright (in-app, Linux mod=Control): ⌘K open/close; backdrop click close; fuzzy filter; ↑↓ loop;
Enter selects; ⌘1 quick-select; / and @ prefixes; ? web-search toast stub; quick-ask stream + stop +
open-in-chat (session created with both messages); theme cycle from palette; topbar pill opens
palette; focus restored after close.
Rust (`cargo test`): shortcut default/fallback choice per platform; position validation
(on/off-screen); conflict flag path (mock store).
Manual/sandbox-verified: cargo check + clippy -D warnings, tsc, eslint, vite build (both entries),
bun tauri dev boot (HUD window hidden, shortcut toggles — described in report; global-shortcut
behavior needs a desktop session, covered by code paths + Rust tests).
CI: full parity lanes green on the PR (branch carries PR #142's main fixes).

## 11. Out of scope

- Real LLM quick-ask (mockLLM only — Phase 14 swaps the body).
- Web search (`?` prefix → toast only — Phase 18).
- Workflow/agent runs from palette (toasts — later phases).
- Companion Orb (Phase 6) and Voice Theater (Phase 16) — HUD sets the multi-window pattern only.
- File search / shell commands; multi-monitor cursor-follow; true NSPanel non-activating vibrancy
  (tauri-nspanel) — revisit with Phase 6.
- Settings UI for the custom shortcut (Phase 8 Settings screen; key is persisted + read now).
