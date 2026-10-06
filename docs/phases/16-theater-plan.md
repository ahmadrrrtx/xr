# Phase 16 — Voice Theater: plan

Branch `phase/16-theater` · PR vs `main` · no self-merge.

## Files

| Area | File | Purpose |
| --- | --- | --- |
| Entry | `desktop/theater.html`, `desktop/src/theater/main.tsx` | 4th Vite input (`rollupOptions.input.theater`), `#theater-root`, cinematic override. |
| Bus | `desktop/src/lib/theater.ts` | `emitTheater`/`listenTheater` (Tauri events or a `BroadcastChannel` in the browser) + the window helpers (`theaterOpen/Close/Toggle/IsOpen`, fullscreen, drag, context menu). |
| Pure | `desktop/src/lib/theaterCore.ts` | avatar state (`theaterStateFor`), karaoke timeline (`wordTimeline`/`activeWordIndex`), star counts (`starCounts`/`isLowEnd`), transcript trimming, key map, event names/keys. Root-tested (21). |
| Stage | `desktop/src/theater/App.tsx` (`TheaterStage`) | layout, drag strip, controls, keys, a11y announcements, persistence of captions/fullscreen. |
| Stars | `desktop/src/theater/StarField.tsx` | canvas, 3 layers, parallax, sparks, pause when hidden, reduced motion, low-end probe. |
| Avatar | `desktop/src/components/brand/AvatarBust.tsx` | traced bust + theater overlays, 7 states, levels via refs. |
| Panels | `desktop/src/theater/panels.tsx` | `TranscriptPanel` (karaoke, captions toggle), `ApprovalCard`, `ErrorLine`. |
| Main link | `desktop/src/voice/theaterLink.ts` (mounted by `useVoice`) | main-window side: store → `voice:*` events, 30 fps level pump while open, karaoke sweep from `voice.onTts`, `theater:*` intents → `voice` controller, snapshot reply to `theater:ready`, "close stops voice" + docked hand-off. |
| Rust | `src-tauri/src/commands/theater.rs`, `capabilities/theater.json`, `lib.rs` | window lifecycle, Store, shortcut, context menu, commands. |
| Settings | `lib/shortcuts.ts`, `lib/settingsApi.ts`, `Settings/tabs/ShortcutsTab.tsx` | `theater` global owner (`alt+mod+v`). |
| Voice screen | `screens/Voice/components/sections.tsx`, `Chat/components/Composer.tsx`, `layout/MicButton.tsx` | immersive + second-display toggles, "Open theater", Start → theater when immersive, chat mic / topbar mic open the theater when immersive. |
| Docs/tests | `docs/phases/16-theater-*.md`, `test/desktop/theater-core.test.ts`, `previews/implementation/phase-16/` | |

## IPC contract

main → theater (all payloads JSON, levels ≤ 30 fps):

| Event | Payload |
| --- | --- |
| `voice:state-changed` | `{ state, active }` (existing) |
| `voice:snapshot` | `{ state, active, muted, captions: Caption[], approval, error, showTranscripts }` (reply to `theater:ready`) |
| `voice:transcript` | `{ captions: Caption[] }` (last 8, oldest first) |
| `voice:level` | `{ mic, out }` 0..1 |
| `voice:tts-word` | `{ id, index, total, text }` — `index === total` ⇒ done |
| `voice:approval` | `{ id, tool, reason } \| null` |
| `voice:error` | `{ message }` |
| `voice:mute-changed` | `{ muted }` |

theater → main: `theater:ready`, `theater:close`, `theater:toggle-mute`,
`theater:toggle-listen`, `theater:approve {id}`, `theater:deny {id}`,
`theater:open-settings`. Rust → theater: `theater:toggle-subtitles` (context
menu). Rust → main: `theater:close` (CloseRequested), `theater:toggle-mute`,
`palette:navigate "/voice"` (menu → Settings).

As built: the shortcut toggles the window in Rust directly (no main-window
round trip); the browser dev tab (`vite preview`) swaps Tauri events for a
`BroadcastChannel` and `window.open`, so every IPC path is exercisable
without the shell.

## Rust surface

Commands: `theater_open`, `theater_close`, `theater_toggle`, `theater_is_open`,
`theater_focus_main`, `theater_set_always_on_top`, `theater_show_context_menu`,
`theater_shortcut_info`, `theater_set_shortcut`. (No pref commands: the
renderer reads/writes its own prefs through the shared settings store.)
Store keys (`settings.json`): `xr.theater.bounds {x,y,w,h}` (logical px,
written at CloseRequested / app exit, reused only while still on a display),
`xr.theater.fullscreen`, `xr.theater.alwaysOnTop`, `xr.theater.secondMonitor`
(read by Rust); `xr.theater.captions`, `xr.theater.closeStopsVoice` (renderer
only); `xr.theater.shortcut` (user override).
Shortcut: `Alt+CommandOrControl+V` → fallback `Alt+Shift+V`.
Menu ids `theater-minimize | theater-always-on-top | theater-mute |
theater-subtitles | theater-settings | theater-close`.

## Order of work

1. `theaterCore.ts` + tests (reducer, timeline, star plan, key map).
2. `bus.ts`, `theater.html`, `main.tsx`, Vite input, `App.tsx`, `StarField`,
   `AvatarBust`, `panels.tsx` — verify in the browser via `vite preview`.
3. Main-window link + launch points + settings owner.
4. Rust window/shortcut/menu + capability + lib.rs registration.
5. Screenshots (speaking / approval / thinking, reduced motion), gates,
   PR with test steps.

## Acceptance checklist (from the brief)

- [x] `⌥⌘V` toggles a 900×700 frameless `#03070D` window (fallback `⌥⇧V`) — Rust, CI-compiled; not run on a desktop here.
- [x] `vite build` emits `theater.html` next to `index/hud/orb`.
- [x] Drag strip, dbl-click maximise, 5 controls (minimize / mute / fullscreen / settings / close).
- [x] 3-layer star field: count ∝ area, pauses when hidden, static under reduced motion, −70 % on low-end.
- [x] 7 avatar states driven by IPC; levels via refs; 280 ms transitions.
- [x] Transcript glass panel, karaoke sweep, captions toggle persisted (T key) — browser round trip verified.
- [x] Approval card → `theater:approve|deny` decides the Phase 15 approval.
- [x] Space / M / F / Esc / T; Tab order; cyan focus ring; `aria-live`.
- [x] Close keeps voice running (unless "close stops voice").
- [x] Bounds / fullscreen / captions persist; second-display preference with fallback (Rust unit tests cover placement).
- [x] Native context menu (6 items); all launch points; instance reuse.
- [x] Red only on error eyes for 4 s; minimal copy; TS strict; console clean.
