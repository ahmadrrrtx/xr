# Phase 27 — shell polish: study notes

Written before any code, from reading the tree at `72727dc`. Several of the phase brief's
premises are out of date — that is the point of this file, so the plan and the PR can say what is
真正 new and what already shipped.

## 1 · What the brief assumed vs what is actually in the tree

| Brief says | Reality (verified) | Consequence |
| --- | --- | --- |
| "`tauri-plugin-global-shortcut` is NOT yet added — you will add it" | **Already registered** in `lib.rs` setup and in `Cargo.toml` (`tauri-plugin-global-shortcut = "2"`). | Nothing to add for the plugin itself. |
| "HUD ⌘+Space was planned; verify where HUD toggle is bound and move it into the global-shortcut plugin (Rust side)" | Already Rust-side: `commands/hud.rs` registers `Cmd+Space` → `Alt+Space` (macOS) / `Alt+Space` → `Ctrl+Shift+Space` (Win/Linux) with conflict fallback, a persisted override (`xr.hud.shortcut`), a conflict flag, live re-binding (`hud_set_shortcut`) and position memory validated against monitors. | Do not rewrite. Only **screenshot-and-ask** is genuinely missing. |
| Push-to-talk is new | Already registered: `commands/settings.rs::init_ptt` — macOS `Cmd+.` → `Alt+Shift+P`, Linux `Ctrl+.` → `Alt+Shift+P`, emits `ptt:pressed` / `ptt:released`, hold semantics owned by the frontend (`voice/`), override key `xr.ptt.shortcut`. | Keep; add nothing except registering it in the new shortcut inventory. |
| "the updater `check_update` IPC command" exists in `lib.rs` | **It does not exist.** `lib.rs` has no `check_update`; the frontend calls `@tauri-apps/plugin-updater` JS directly from `UpdatesTab.tsx`. | The Rust command has to be written — and it is needed anyway for channels (see below). |
| Settings → Updates card with channel selector + auto-install toggle is P27 work | **Already shipped** (`UpdatesTab.tsx`): version card, `lastChecked` relative time, Check button, Stable/Beta/Nightly segmented control, auto-install toggle, skip-this-version. | P27 adds what is missing: real channel→endpoint wiring, release-notes modal, progress, pending-restart banner, OS notification, dev-mode skip. |
| Settings → Shortcuts panel with Record buttons is P27 work | **Already shipped** (`ShortcutsTab.tsx`): in-app + global rows, capture-phase recorder, live conflict detection, reset-all. | P27 only needs the "shortcuts unavailable" help text (Wayland/portal). |
| "iterate Runs storage (SQLite) where status is running/planning, set status=killed" | **There is no runs table.** `commands/runs.rs` says so explicitly: the registry lives in the webview (`runsStore`/`brainStore`), `list_runs()` returns `Vec::new()`, and `brainStore` persists to localStorage (`xr.brain`). `RunStatus` already includes `'killed'`, and `brainStore`'s persist `merge` currently settles interrupted runs to **`completed`** — optimistic and wrong after a crash. | The killed-marking must happen where the data is: make the hydration crash-aware and let the recovery screen attribute it ("App was interrupted"). No SQLite work. |
| Tray "3 menu items" | `tray.rs` builds **2** (`Show XR`, `Quit XR`) with the marketing tooltip "the AI agent you can actually trust". | Full menu, tooltip and badge are genuinely new — and the tooltip change is required by the honesty rule. |
| `set_dock_menu`, Jump List (`set_user_tasks`) | **Neither API exists in Tauri 2.12** (`grep` over the crate source). | Documented as blocked-on-upstream, with the exact API shape needed; the menu-item registry is built so a dock menu becomes a one-file change. |
| Loopback CSP mentions `ws://127.0.0.1:*` | The live CSP is `connect-src ipc: http://ipc.localhost http://127.0.0.1:*` — **no `ws://`**. | Left exactly as-is. Adding `ws://` would *widen* the policy; the brief's own acceptance line says "CSP unchanged". |
| "OS theme detection via Windows registry + WM_SETTINGCHANGE" | Tauri already surfaces `RunEvent::WindowEvent { event: WindowEvent::ThemeChanged(theme) }` on all three platforms (tao handles registry/`WM_SETTINGCHANGE`, `NSAppearance`, portal). | Use the host's event instead of hand-rolled FFI: less code, fewer platforms to get wrong, and it fires on Linux too (which the brief's registry plan did not). |

## 2 · What I verified about the Tauri 2.12 APIs I intend to use

Confirmed present in `~/.cargo/registry/src/*/tauri-2.12.0` and `tauri-plugin-updater-2.13.1`:

- Tray: `title()`, `set_title()`, `tooltip()`, `set_tooltip()`, `icon()`, `set_icon()`,
  `icon_as_template()`, `set_icon_with_as_template()`, `set_menu()`, `show_menu_on_left_click()`.
- Menu: `MenuBuilder`/`SubmenuBuilder`/`CheckMenuItem`, `PredefinedMenuItem::{separator, copy, cut,
  paste, select_all, undo, redo, minimize, maximize, fullscreen, hide, hide_others, show_all,
  close_window, quit, about, services, bring_all_to_front}`, `Menu::set_as_app_menu()`,
  `App::set_menu()`.
- Updater: `UpdaterExt::updater_builder()` → `UpdaterBuilder::{endpoints, pubkey, on_before_exit,
  restart_after_install, timeout}`, `Update::{download(on_chunk, on_finish), install(bytes),
  version, body, current_version}` — so **runtime channel endpoints are real**, not a config-time
  fiction.
- Tray icon images: `Image::from_bytes`, `Image::from_path`.

Not present (so not attempted): `set_dock_menu`, `set_user_tasks`/JumpList, Touch Bar, NSPanel.

## 3 · W-invariants to preserve (audit list for every diff)

- **W-1** `CREATE_NO_WINDOW` on the Windows sidecar spawn — `engine.rs` sets it; nothing in P27
  spawns a console process except the screenshot helper, which must set the same flag.
- **W-2** Job Object `KILL_ON_JOB_CLOSE` assigned to the child; `stop_sidecar` closes the job first.
- **W-3** `single_instance` registered **first** in the builder chain; callback shows/focuses.
- **W-5** stderr tail bounded and surfaced (`StderrTail`).
- **W-6** reachability probe cached 1.5 s (`ProbeCache`).
- **SEC-12** `PR_SET_PDEATHSIG` armed between fork and exec on Linux; `--parent-pid` passed on all
  platforms; SIGTERM first, then SIGKILL after the grace period.

Anything Phase 27 adds must not move the sidecar spawn off the main thread (the Linux
parent-death signal binds to the spawning thread), must not clear the dirty flag before the
sidecar has actually stopped, and must not exit the process before `stop_sidecar` runs.

## 4 · Environment notes (what can be proven where)

- This sandbox is Linux-only, headless, with no macOS/Windows machine attached. Steps 4–6 of the
  brief's ritual ask for a manual matrix on three OSes; the honest substitute is:
  real `cargo check` + `clippy -D warnings` + `cargo test` on Linux, the real binary booted under
  Xvfb (sidecar spawn, crash flag, single-instance), the full Node/TS suite, and HTML mockups for
  the visual deliverables (the Phase 26 precedent). Anything that cannot be proven here is named
  as unproven rather than implied proven.
- Toolchain: `rustc 1.99.0`, `cargo 1.99.0`, clippy installed, webkit2gtk-4.1 + libsoup-3 +
  libayatana-appindicator3 present. `cargo check --all-targets` on the untouched tree: **exit 0**
  (2m33s). `cargo test --lib`: **86 passed / 0 failed**.
