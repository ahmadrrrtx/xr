# Phase 5 — HUD Command Palette · Implementation Report

Branch `phase/5-hud-palette` (based on `fix/main-ci-red` — carries PR #142's main-branch CI
repairs so Phase 5's CI starts green). Plan: `docs/phases/05-hud.plan.md`.

## What shipped

**Shared command palette** (`src/components/palette/`) — one component, two contexts:
- **In-app (⌘K):** Radix Dialog overlay, backdrop click-close, focus trap + focus restore,
  topbar pill and ⌘K both open it (Phase-1 trigger preserved, now driving the real palette).
- **HUD window:** second config-declared Tauri window (`hud.html` Vite entry): 640×480,
  frameless, transparent, always-on-top, skip-taskbar, hidden at boot, `macOSPrivateApi`
  enabled (+ cargo feature) for macOS transparency. CSS glass (`backdrop-blur(20px)
  saturate(1.4)`, per-theme `--bg-glass`/`--glass-shadow` tokens, solid fallback via
  `@supports`).

**Registry** (`src/lib/paletteCommands.ts` + pure `src/lib/paletteQuery.ts`): Commands
(New chat ⌘N · Toggle Sidebar ⌘B · Cycle Theme ⌘⇧T · Open Settings ⌘, · Voice ⌘. toast ·
Budget · Pause agents toast · Clear history toast), Chats (6 most recent, relative-time
subtitles), Agents (Coder/Researcher/Writer/Analyst → new chat + toast), Workspaces
(create toast), Settings (open/shortcuts/about/updates + dev-only Reset onboarding, Brand
Book, Test Notification). `keepOpen` semantics for theme cycling (watch the glass change).
History: last 10 selections persisted, pinned as a "Recent" group on empty query.

**Fuzzy search:** cmdk with a custom filter (prefixes must be invisible to scoring — the
built-in can't do that): substring=1.0, subsequence 0.4–0.9 with contiguity boost, AND
semantics, keyword matching. Unit-proven in `test/desktop/palette-query.test.ts` (14 tests).

**Prefix filters:** `/` commands · `@` agents · `?` web-search stub (toast) · `>` dev
commands (compiled out of prod builds). Backspace-on-empty closes (Raycast parity).

**Quick-ask:** unmatched query ≥3 chars → single "Ask XR" row (commands always outrank
asking — ⌘1 means the first command). Streams the mock LLM answer in-palette (avatar, XR
label, streaming caret, stick-to-bottom), Stop button, "Open in chat" persists the Q&A as
a real session and navigates (fixing the already-active-session reload along the way).
Escape layers: stop stream → close (window-capture interceptor preempts Radix's escape).

**⌘1–⌘9 quick-select:** dispatches Home/(N−1)×ArrowDown/Enter on the cmdk root — follows
cmdk's own score order by construction.

**Global shortcut (Rust, `commands/hud.rs`):** platform defaults (macOS `Cmd+Space`,
fallback `Alt+Space`; Win/Linux `Alt+Space`, fallback `Ctrl+Shift+Space`), user override
read from `settings.json` (`xr.hud.shortcut`), conflict → fallback + `palette:shortcut-failed`
+ conflict banner in the palette (what actually registered, via `hud_shortcut_info`).
Pressed-only guard (macOS double-fire). Explicit `unregister_all()` on `RunEvent::Exit`.

**Window behavior:** position memory (`xr.hud.position`, validated against current monitor
bounds — unplugged display re-centers; unit-proven), drag by the input row
(`data-tauri-drag-region` + `startDragging` fallback), blur → auto-hide unless streaming,
fresh state + session re-hydration on every show, reset on hide.

**IPC:** commands `hud_show/hide/toggle/navigate/run_main_command/notify_sessions_changed/
shortcut_info`; events `palette:theme-change` (broadcast from `theme_changed` — live
theme sync across windows), `palette:navigate`, `palette:execute-command`,
`hud:sessions-changed`, `palette:request-theme`. Theme bootstraps pre-paint in both
windows via the shared `theme-init.js` (same origin → shared localStorage).

## Verification (all local, pre-PR)

| Gate | Result |
|---|---|
| `tsc --noEmit` (root + desktop) | clean |
| `eslint .` | clean |
| `vite build` (both entries) | ✓ — HUD chain verified free of chat-screen/shiki leakage |
| `cargo clippy --all-targets -- -D warnings` | clean (fresh ACL build) |
| `cargo test --lib` | 6/6 (3 new hud tests: shortcut pairs, reachability, position choice) |
| Core lane (`parity-suite-runner.sh linux`) | 271/271 files, exit 0 |
| `test/desktop/` | 19/19 (14 new palette-query + 5 sink-lint incl. renderer walk) |
| Playwright e2e (in-app + hud.html contexts) | 31/31 — open/close, focus, groups, fuzzy, ⌘1, prefixes, quick-ask stream/stop/open-in-chat, escape layers, backspace, arrows loop, theme cycling, pill, recent group, HUD standalone render + stream, zero page errors |

## Screenshots

`previews/implementation/phase-05/`: 01 in-app palette · 02 searching · 03 quick-ask ·
04 HUD entry · 05 HUD streaming · 06 conflict banner (dev override mock — the banner is
the real component, the flag is forced) · 07 five-theme grid.

## Known limitations (by design, v1)

- Quick-ask uses mockLLM (Phase 14 swaps the body — the palette only calls `streamChat`).
- No web search (`?` is a toast stub — Phase 18).
- Standard window focus on HUD show (true non-activating NSPanel needs the 3rd-party
  `tauri-nspanel` — revisit with Phase 6); no native macOS vibrancy (CSS glass everywhere
  is the one cross-platform path).
- Primary-monitor centering / saved position (no cursor-follow); no Settings UI for the
  shortcut (persisted + read; UI in Phase 8).
- Global-shortcut behavior and window ops need a desktop session — covered by Rust unit
  tests + code paths; the palette itself is fully covered in the browser contexts.
