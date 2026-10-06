# Phase 16 — Voice Theater: study notes

## What the theater is (and is not)

- A second **render target** for the Phase 15 voice state. The main window
  keeps the only `VoiceController` (`desktop/src/voice/session.ts`), the only
  `AudioContext`, STT/TTS streaming, barge-in, approvals and the wake word.
  The theater window never touches the engine; it only listens to events and
  sends intents back (`theater:*`).
- Brand refs: `uploads/XR AVATAR .png` (glossy black egg helmet, two almond
  cyan eye slits — no pupils, smooth cyan chest sphere, cyan plasma trails
  sweeping up from the shoulders). `docs/DESIGN-SYSTEM.md` §6.1/6.2 (states
  table), §8 (theater visual language: `--xr-void` `#03070D`, rings emanate
  from the chest core, eyes at ~40 % from top, transcript glass bottom),
  `docs/THEME-SYSTEM.md` rule 7 (theater is the cinematic exception — always
  deep space regardless of theme). `SCREEN-BRIEFS.md` OV-2.

## Repo reality (main @ `d53a9e1`)

| Brief assumes | What exists |
| --- | --- |
| `TheaterStage`, `AvatarBust`, star field | Nothing. `screens/Voice/components/theater.tsx` is a `MiniTheater` (Phase 15 placeholder) with an **Immersive mode** toggle that only toasts "Phase 16". |
| Avatar art | `components/brand/art.ts` (generated — never hand-edit) exposes `AVATAR_LAYERS` (6 ink + 11 cyan traced layers), `AVATAR_HALO`, `AVATAR_VIEWBOX.full = "38 28 455 458"`. Bbox probe: left eye ≈ ellipse (200,133) rx 21 ry 8; right eye ≈ (294,133) rx 20 ry 9; chest core ≈ (264,333) r 22; helmet ≈ centre (252,107). `Avatar.tsx` already overlays state glows (`brandGlow`, `SpeakingRings` from the figure centre — wrong source for the theater, rings must come from the chest core). |
| Multi-window | `hud.html` + `orb.html` are **static** windows in `tauri.conf.json` (`visible:false`). Workspaces (`commands/workspaces/spawn.rs`) show the **on-demand** `WebviewWindowBuilder` + `WebviewUrl::App` pattern, `decorations(false)`, bounds persistence via RunEvent hooks. Capabilities are per-window files (`capabilities/{hud,orb,workspace}.json`). |
| Global shortcut | `commands/hud.rs::init` + `commands/orb.rs` are the candidate-loop pattern (user override → primary → fallback), `ShortcutState::Pressed` only, `super::settings::ShortcutRegistration { shortcut, conflict }` for live re-binding, `hud::unregister_all` on Exit. `lib/shortcuts.ts` `GlobalOwner = 'hud'|'orb'|'ptt'` + `ShortcutsTab` SETTERS/INFOS maps. |
| Context menus | `orb.rs` `menu_ids` + `menu_action_for` (unit-tested) + `app.on_menu_event` — Tauri 2.12 pushes global menu listeners into a `Vec`, so a second module can register its own handler (verified in `tauri/src/manager/menu.rs`). |
| IPC today | `session.ts::broadcastState` already emits `voice:state-changed {state, active}` (consumed by `orb.rs` `VoiceActiveState`). No transcript / level / approval / error / mute events yet. `useVoiceIpc` (AppShell) listens for `ptt:*`, `orb:*`. |
| Settings | Engine owns `desktop.theaterImmersive` / `chatMicTarget` (`src/voice/types.ts`), mirrored into `settingsStore.voice`. Rust cannot read engine settings → window prefs the shell needs (bounds, fullscreen, second display, captions, always-on-top, close-stops-voice) live in the Tauri Store `settings.json` under `xr.theater.*` (same file the orb/HUD use; `persistent-store.ts` mirrors to localStorage for the browser). |
| Karaoke | Engine `tts` events carry `text + wav` — no per-word timestamps (Piper via sherpa-onnx has no alignment). The desktop decodes the wav (`AudioBuffer.duration` is known before playback) → a **character-weighted time sweep** scheduled in the main window produces `voice:tts-word {index,total,text}`; `tts_stop`/barge-in cancels it. |

## Constraints that shape the design

- Size gate: unwaived modules ≤ 800 lines, tree ceiling 145,500 (≈350 LOC
  headroom at Phase 15 → raise with a dated reason + ADR note is **not**
  allowed casually; keep the theater lean, no new runtime deps).
- Root `bun test` in CI has no desktop `node_modules`: pure logic goes in
  `desktop/src/lib/theaterCore.ts` with relative-import-only tests
  (`test/desktop/theater-core.test.ts`), like `orbCore.ts`.
- 2 GB sandbox, no Rust toolchain: Rust is written against the exact idioms
  of `orb.rs` / `hud.rs` / `spawn.rs` and verified by CI (clippy `-D warnings`).
- Browser dev seam: when `!isTauri()` the same bus runs on a
  `BroadcastChannel('xr-voice-theater')` so the theater page can be opened as
  a second tab (`/theater.html`) and driven by the main window — this is also
  how the Playwright screenshots are produced.
- Copy rules: minimal, sentence case, no marketing; red only for the error
  eyes (4 s) — approval is warning yellow; "Needs your approval" / "Hmm,
  something went wrong." are the only subtitles.

## Decisions

1. **One bus, two transports** (`src/theater/bus.ts`): `emit(name, payload)` /
   `listen(name, cb)` → Tauri events in the shell, BroadcastChannel in the
   browser. Levels are pumped at ≤30 fps only while a theater has announced
   `theater:ready` and until `theater:close`.
2. **Snapshot on ready**: the theater may open mid-session, so `theater:ready`
   makes the main window re-send state, transcript, approval, mute and the
   captions preference in one `voice:snapshot` event (plus the individual
   events afterwards).
3. **Avatar**: reuse the traced brand bust (`AVATAR_LAYERS`) as the base and
   add theater overlays at the measured coordinates — eyes (brightness,
   narrowing, blink, look-shift, 4 s red), a perfect-circle chest core with
   radial glow, speaking rings from the core, an inward mic ring, orbit dots
   around the helmet, a warning shield, a mute slash. Levels drive the core /
   mic ring through refs + one rAF (no React re-render per tick).
4. **Window**: on-demand `theater` webview (`theater.html`), 900×700, min
   600×400, frameless, `#03070D`, reused when it exists (show + focus), bounds
   / fullscreen / always-on-top persisted in the Store, second-display pref
   honoured when a second monitor exists, Esc = leave fullscreen then close.
   Closing never stops voice unless `xr.theater.closeStopsVoice` is on.
5. **Launch points**: `⌥⌘V` (fallback `⌥⇧V`), Voice settings toggle "Open in
   immersive theater" (session start → theater), "Open on second display when
   available", `Start voice session →`, orb menu "Voice theater", chat mic
   when immersive. The theater's gear → focus main + `/voice`.
