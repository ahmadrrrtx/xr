# Phase 4 — Trust feel, voice & control visuals, native GA steps

Status: implemented 2026-09-20 (shell + engine verified here; Rust compile-pending in CI).
Branch `phase2/elite-workstation`.

Diffed against the upstream base first: the avatar state machine, waveform
canvas (real analyser levels), tray, autostart opt-in and updater runbook
already existed upstream. Phase 4 therefore implemented the TRUE gaps:

| Plan line | Delivered | Surface |
|---|---|---|
| PTT as a designed control | hold-to-talk `PT` control (pointer + Enter hold); idle→start/stop, live→mute-release; real session/mute actions | `Voice.tsx`, `prism2.css` (`13-voice-ptt.png`) |
| Approval-interrupt bar | voice approval bar gains **barge in** + **decide now** (navigates to Trust; work keeps running) | `Voice.tsx`, `main.tsx` |
| Presence glow/eye treatment | per-state CSS filter treatment over the OFFICIAL renders (amber approval, red error, green success, violet working) — filters, never redrawn | `prism2.css` |
| Control cockpit | STOP now ALWAYS visible (idle banner included; denies pendings via engine `/control`), acting-indicator derived from audited event recency (5 s) | `ControlRoom.tsx` (`14-control-stop-always.png`) |
| Notification actions | OS notification Confirm/Deny for approvals via `@tauri-apps/plugin-notification` action types; decision lands in `/approvals/:id/decision`; graceful no-op outside the packaged app | `tauri-bridge.ts`, `AppShell.tsx` |
| Tray actions | tray New task / Pending approvals now emit `xr-tray-action`; shell navigates Work / Trust (Rust emit = compile-pending) | `lib.rs`, `main.tsx` |
| Deep links `xr://` | `tauri-plugin-deep-link` registered (`plugins.deep-link.desktop.schemes=["xr"]`), `register_all()` in setup; shell maps `xr://<area>` to nav (compile-pending) | `Cargo.toml`, `tauri.conf.json`, `lib.rs`, `main.tsx` |
| SEC-06 win32 approval transport parity | `src/util/child-channel.ts`: named pipe (`\\.\pipe\xr-ctrl-<pid>`) on win32 / unix socket elsewhere via the same `net` code; bounded timeouts, fail-CLOSED (timeout/connect-error ⇒ denial); wired into `runCommand` cancellation (parallel with OS kill, never blocking) and into `xr agent` children (`XR_CONTROL_CHILD=1`, parity with A-19 Ctrl+C) | engine TS, `test/execution/child-channel.test.ts` (5 tests, run on every OS in CI) |
| Updater provisioning runbook | verified complete upstream (`docs/release/UPDATER.md`) | — |

## Verification (this sandbox)

- `tsc + vite` green; full suite **3,368 pass / 19 skip / 0 fail** (3,387 ran —
  +5 SEC-06 channel tests).
- Captures `audit/screens3/13` (voice PTT + presence glow, honest OFFLINE
  provider chip) and `14` (Control Room with Stop always visible).
- Rust edits (tray emit, deep-link plugin) are additive and follow the exact
  patterns already shipped in this file (autostart/notification plugins);
  **no Rust toolchain exists in this sandbox**, so they are compile-pending
  in the repo's per-OS CI matrix — flagged, not hidden.

## DoD notes

- Voice conversation with work-preserving interrupt: barge-in + interrupt bar
  wired to engine routes; mic hardware unavailable headless, so the listening
  loop itself remains covered by the engine's voice corpus tests.
- Stop-drill: `/control` verb path exercised by existing control tests + the
  always-visible Stop verified on-screen.
- Per-OS native matrix green in CI: requires the repo's Windows/mac runners —
  outside this sandbox; the parity tests shipped here run on all of them.
