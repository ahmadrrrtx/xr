# Phase 27 — shell polish: plan

Branch `phase/27-shell-polish`. Targets, in the order they will be built, each one compile-verified
before the next. Scope decisions follow `27-shell-polish-notes.md` (§1 of that file is the
reality check; three of the brief's premises were already shipped, two APIs do not exist).

## Rust modules

| module | new/changed | owns |
| --- | --- | --- |
| `src-tauri/src/tray.rs` | **rewrite** | the full always-alive menu, state (approval count, spend today, engine health, agents paused), platform icons from `icons/tray/`, badge via `set_title` (macOS) / overloaded icon (Win) / dot (Linux), tooltip `XR — running on your machine`, click policy per OS, live refresh. Emits `xr-tray-action`. |
| `src-tauri/src/menus.rs` | **new** | macOS app menu (App/File/Edit/View/Window/Help) via `MenuBuilder` + `PredefinedMenuItem`; slim menu elsewhere; `set_as_app_menu()`; a single id→action table shared with the tray; dock menu *prepared* (see gaps). Emits `xr-menu:<id>`. |
| `src-tauri/src/shortcuts.rs` | **new** | the shortcut inventory (hud/orb/ptt/theater + new screenshot-ask): registers screenshot-ask with per-OS default + fallback, reports one machine-readable state used by Settings ("registered / conflict / unavailable"), and is the one place that answers "what does this OS currently hold". |
| `src-tauri/src/screenshot.rs` | **new** | region capture per OS (`screencapture -i` / PowerShell `Add-Type` snip / `grim`, `gnome-screenshot`, `spectacle`, `import`), writes a temp PNG, emits `xr-global-screenshot` with the path, deletes it after the webview acks. `CREATE_NO_WINDOW` on Windows (W-1). |
| `src-tauri/src/updater.rs` | **new** | channels → endpoints; `check_update` / `download_update` / `install_update` / `update_state`; progress events `xr-update:<stage>`; pending-restart persistence; dev-mode skip; the honest unprovisioned error; `skip_version`. Uses `UpdaterBuilder::endpoints` so the channel is real at runtime. |
| `src-tauri/src/crash.rs` | **new** | dirty flag (`~/.xr/crash-dirty.json` → app-data dir), written after the sidecar spawn, cleared only after `stop_sidecar` returned; `crash_state` / `crash_resolve` / `simulate_crash` / `crash_report` (stderr tail + last 100 KB of logs, redacted: home → `$HOME`, tokens/keys → `[redacted]`), and the manual `mailto:` hand-off. Zero telemetry: nothing is sent by this code. |
| `src-tauri/src/theme.rs` | **new** | OS theme bridge: reads the host's `WindowEvent::ThemeChanged`, keeps the current value, emits `xr-os-theme`; `subscribe_os_theme` returns the current value for first paint. |
| `src-tauri/src/lib.rs` | **changed** | wire the modules; `CloseRequested` on `main` → hide (real exit only through tray/menu Quit → after `stop_sidecar`); keep W-1/2/3/5/6 + SEC-12 exactly as they are. |
| `src-tauri/src/engine.rs` | **unchanged** | containment, banner parsing, stderr tail, probe cache. |
| `src-tauri/tauri.conf.json` | **changed** | `msix` bundle target (if the bundler supports it — checked, see gaps), Flatpak manifest lives outside, main-window macOS chrome: `hiddenTitle` only (no `Overlay`; decorations stay on so traffic lights are real). |

## Frontend

| file | owns |
| --- | --- |
| `src/lib/native.ts` | the bridge the brief names: `onTrayAction`, `onMenuAction`, `onGlobalShortcut` (hud/ptt/screenshot), `onUpdateEvent`, `onOsTheme`, `onCrashState`; typed, browser-safe no-ops. |
| `src/lib/updaterClient.ts` | thin wrapper over the Rust updater commands (check/download/install/state) with progress, so the UI never touches the plugin directly. |
| `src/components/shell/UpdateModal.tsx` | release-notes modal (markdown, 8000-char cap, "view full notes" — reuses `lib/markdown.tsx`), progress bar, Install & restart / Later / Skip this version. |
| `src/components/shell/UpdateBanner.tsx` | 36 px persistent strip: "XR v{version} downloaded — Restart to install". |
| `src/components/shell/CrashRecovery.tsx` | pre-router recovery screen: sigil, calm copy, Resume / Start fresh / Send report (+ "what data?" modal), "Start without local engine" when the previous spawn failed. |
| `src/screens/Settings/tabs/UpdatesTab.tsx` | add channel→Rust wiring, modal trigger, pending banner state, OS notification, dev-mode skip; keep the existing honest "not provisioned" copy. |
| `src/screens/Settings/tabs/ShortcutsTab.tsx` | surface the new availability state (Wayland/portal help) + the screenshot-ask row. |
| `src/stores/brainStore.ts` | crash-aware hydration: interrupted runs become `killed` with the recovery note instead of `completed`. |
| `src/App.tsx` | mount banner + recovery gate; theme bridge into `prefs`. |

## Scripts, packaging, docs

- `scripts/generate-tray-icons.ts` — dependency-free: decodes the master sigil PNG (node:zlib
  inflate + PNG unfilter), box-filters down to the tray sizes, derives the macOS Template mask
  (alpha from luminance, black body), and writes PNGs + a PNG-compressed `.ico`. Outputs
  `desktop/src-tauri/icons/tray/`; verified by rendering the generated files in a preview page.
- `packaging/flatpak/ai.rrrtx.xr-desktop.yml` + `ai.rrrtx.xr-desktop.metainfo.xml` (Flathub-ready),
  `docs/linux/PACKAGING.md` for the local build.
- Docs: `docs/release/UPDATER.md` (UI wiring + channels), `docs/release/SUPPORT_MATRIX.md`,
  `docs/security/CRASH-RECOVERY.md`, README line.
- CI: the existing `shell-check` job already runs `cargo check` + `clippy -D warnings` + `cargo test`
  on Linux and `shell-test-windows` on Windows; P27 adds the new unit tests to those runs (no
  workflow structure change needed) and documents what runs where.

## Verification plan (what will actually be proven, and how)

1. `cargo check --all-targets` + `cargo clippy --all-targets -- -D warnings` + `cargo test --lib`
   after every module (Linux, real).
2. Root: `bunx tsc --noEmit`, `bun run ci`, `bun test` — unchanged gates must stay green.
3. Boot the real binary under Xvfb with the compiled sidecar: prove the sidecar spawns, the dirty
   flag is written, SIGKILL leaves it set, the next boot reports the crash, single-instance
   focuses the first instance, and Quit clears the flag. This is the strongest evidence available
   without a Mac or a Windows box.
4. Icons: generate, then open the outputs in a preview image.
5. Mockups for the visuals that need a real OS: tray menu (macOS + Windows + Linux), update modal,
   pending banner, recovery screen, Settings cards → `/home/user/previews/implementation/phase-27/`
   + `desktop/previews/implementation/phase-27/`.
6. Anything not provable here (traffic-light positions, MSIX install, Flatpak build, Jump List,
   dock menu) is listed as unverified in the PR, with the reason.

## Known gaps, decided up front

- **Dock menu and Jump List**: Tauri 2.12 exposes neither. Not faked. The menu-item registry is
  built so both become a small addition; the PR states the upstream API shape needed.
- **NSPanel HUD**: not exposed either; HUD keeps `always_on_top` (the brief allows this).
- **Touch Bar**: skipped as the brief permits.
- **Traffic-light inset**: `hiddenTitle: true` + traffic lights is a config change I can make, but
  the pixel position cannot be verified here — reported as configured-but-unverified.
