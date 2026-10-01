# Phase 8 — Settings · Plan

Branch `phase/8-settings` from `main` @ `e014e8d`. Spec: prompt §Phase 8 + `docs/SCREEN-BRIEFS.md` SCREEN 14. Study notes: `08-settings-notes.md`.

## §0 Scope decisions & deviations (read first)

1. **Data folder = Tauri app data dir**, not `~/xr` (the app has never used `~/xr`; SQLite + stores live in `app_data_dir`). `reveal_data_folder` opens the real dir.
2. **Rust `get_settings`/`set_setting`** — implemented, but the UI's primary write path stays the proven JS write-through (`persistent-store.ts`), which also works in the browser preview. Rust `set_setting` validates + writes + broadcasts for future agent-side use; the settings store calls `settings_changed` (Rust broadcast to all webviews) after every write. No dual-maintenance of the Store file format.
3. **API keys** — OS keychain via the `keyring` crate (macOS Keychain / Windows Credential Manager / Linux Secret Service). When the OS keychain is unavailable (headless Linux dev), the key is stored in the Tauri Store under `xr.providerKeys` **with an explicit `insecure` flag**, and the UI shows a persistent warning badge ("Stored without OS keychain"). Keys never sit in `xr.settings`. Stronghold stays reserved for Phase 12 (it already has Argon2 wiring in `lib.rs`).
4. **Body font default = 14px** (options 12–16), not the brief's 13px — the shipped app's body is 14px; changing the default would reflow every earlier phase. Documented as an intentional deviation.
5. **Sounds default OFF.** Phase 7 locked "no sounds" for approvals; Phase 8 builds the sound *infrastructure* (settings, policy gate, WebAudio-synthesized chime — no asset files) but ships it muted by default. OS notification sounds remain OS-controlled.
6. **Theme "Match system"** — new `ThemePreference = ThemeId | 'system'`; `system` resolves via `matchMedia('(prefers-color-scheme)')` → `xr-native` (dark) / `arctic` (light), resolved again on OS change; `public/theme-init.js` extended to resolve it pre-paint; the Rust broadcast always carries the *resolved* ThemeId (events.rs validation unchanged).
7. **i18n** — new minimal module (infra + settings-surface strings + RTL for `ur`). Full-app translation is a later phase; the dropdown is real and swaps the Settings surface instantly.
8. **PTT global shortcut** — `mod+.` is currently a Phase-15 toast placeholder. Phase 8 registers it as a real *global* shortcut (re-registrable, conflict-aware, `xr.ptt.shortcut`), firing a `ptt:pressed` broadcast; the in-app toast placeholder remains until Phase 15.
9. **Ollama download modal** reuses the Phase-3 pull machinery (`ollama_pull` + `ollama://pull-progress` + StepModelPull rendering logic).
10. **Test-connection pings are real and free**: OpenAI-compatible → `GET {base}/models` with Bearer; Anthropic → `GET /v1/models` with `x-api-key`; Gemini → `GET /v1beta/models?key=`; Ollama → `GET /api/tags`. 200 = connected, 401/403 = auth failed, transport error = unreachable. (ureq, 5s timeout.)
11. **Updater** — JS plugin check with `updater:default` capability; unsigned dev builds surface "Up to date" gracefully (catch → note). Channel segmented control persists; it gates nothing until signed updates exist (labelled).
12. **Reset flow** — typed `DELETE` confirm → Rust `reset_app(wipe_conversations)` clears `xr.*` store keys (+ optionally `xr.db`, approvals store, onboarding flag) → `app.restart()`.
13. **Export/Import** — real zip of the app data dir via the `zip` crate (save/open dialogs Rust-side; no extra capabilities needed).
14. Hash routing uses `#general`-style hashes on `/settings` (deep links + reload persistence). Palette commands deep-link to them.

## §1 Files

**New (frontend)**
- `src/stores/settingsStore.ts` — typed Zustand store: `{ profile, startup, defaults, appearance, models, shortcuts, notifications, voice, privacy, updates, about }` + `load()/set(path,value)/reset()/hydrate()`; persists whole object at `xr.settings` (write-through); calls `settings_changed` broadcast after each write; theme/user/sidebar remain owned by their existing stores (settings UI drives them — no second source of truth).
- `src/lib/i18n.ts` — LOCALES (en/ur/es/fr/zh), `t()`, `setLocale()`, RTL handling, persisted `xr.locale`.
- `src/lib/shortcuts.ts` — default registry (in-app + global), override resolution, chord formatting (⌘⇧K vs Ctrl+Shift+K), capture-from-KeyboardEvent, conflict detection.
- `src/lib/appearance.ts` — applies density/font-size/glass/glow/reduced-motion to `<html>` (data-density, `--fs-body`, data-glass, data-glow, data-motion) — shared by main/HUD/orb.
- `src/lib/notificationPolicy.ts` — master/per-event/style/quiet-hours/sounds gate consumed by `approvalEvents` + `notificationStore` callers.
- `src/lib/settingsApi.ts` — typed invoke wrappers (browser no-ops/fallbacks).
- `src/components/settings/` — `SettingsSidebar` `SettingsSection` `SettingRow` `Toggle` `Segmented` `Slider` `ThemeSwatch` `SearchInput` `Kbd` `TimeInput` `ConfirmDialog` `ProviderCard` `ProviderConfigModal` `ShortcutRow` `ShortcutRecorder` (+ `index.ts`).
- `src/screens/Settings/` — `index.tsx` (shell + hash routing + search + tab switch motion) + `tabs/{General,Appearance,Models,Shortcuts,Notifications,Voice,Privacy,Updates,About}Tab.tsx`.
- `src/components/ui/select.tsx`, `src/components/ui/slider.tsx` — styled radix (monolithic `radix-ui` pkg, no new deps).
- `desktop/scripts/generate-licenses.ts` + generated `src/data/THIRD_PARTY_LICENSES.json` (committed).

**New (Rust)**
- `src-tauri/src/commands/settings.rs` — `settings_changed` (validate+broadcast), `get_settings`, `set_setting` (validated), `keychain_get/set/delete` (keyring; error → frontend insecure fallback), `reveal_data_folder`, `reveal_path`, `export_all_data` (zip), `import_data` (unzip), `clear_cache`, `storage_stats`, `reset_app`, `open_url`, `restart_app`, `get_autostart`/`set_autostart`, `set_devtools_enabled`, `test_provider_connection`, PTT shortcut registration (`ptt_set_shortcut`, `ptt_shortcut_info`, `xr.ptt.shortcut` + fallback + `ptt:pressed` broadcast).

**Edited**
- `stores/theme.ts` (+ system preference), `public/theme-init.js` (system resolve pre-paint).
- `styles/globals.css` — density vars + `[data-density]` row hooks, `--fs-body`, `[data-glass='off'] .xr-glass`, `[data-glow='off'] { --accent-glow: transparent }`, `[data-motion='reduced']` CSS transition kill.
- `App.tsx` — `<MotionConfig reducedMotion>` from settings; hydrate settingsStore at boot.
- `AppShell.tsx` — hotkeys resolved from overrides; "Open to" boot navigation; density hook classes.
- `components/layout/Sidebar.tsx` — `xr-density-row` hooks (row heights react to density); `Topbar.tsx` breadcrumb "Settings"; `UserMenu.tsx` "Settings…" item (verify/patch).
- `hooks/usePalette.ts` + `src/orb/*` + `src/hud/*` — `settings:changed` listener → `applyAppearanceEffects` in every window.
- `lib/approvalEvents.ts`, `stores/notificationStore.ts` (policy gate), `lib/paletteCommands.ts` (hash deep links), `screens/Chat/components/Message.tsx` (density hook class, minimal).
- Rust: `commands/mod.rs`, `lib.rs` (register new handlers), `commands/orb.rs` (shortcut override + `orb_shortcut_info`), `Cargo.toml` (+`keyring` 3, +`zip`), `capabilities/default.json` (+`updater:default`).
- Replace `screens/Settings/index.tsx` (placeholder) — `_dev/ThemeToggle` absorbed into the Appearance tab in dev.

## §2 Key mechanics

- **Rows/cards**: `SettingRow` (44px min, 12×14 padding, divider, hover `bg-hover/60`) + `SettingsSection` (13px uppercase tertiary header → card `bg-bg-ink`/`bg-card` border-subtle radius-lg). No inline row markup in tabs.
- **Tab switch**: 80ms fade + 4px y-slide, spring 300/26. **Toggles**: 40×22 pill, 18px thumb, spring 380/26. **Modals**: scale 0.96→1 spring 280. All honor reduced-motion (fades only).
- **Shortcut recorder**: pulsing cyan border (static under reduced motion), Esc cancels, captures modifiers cross-platform, conflict → inline red warning + Replace/Cancel; globals re-register through Rust with Spotlight-style fallback + clear error if the OS owns the chord; saved chords persist and apply on next boot (Rust reads `xr.hud/orb/ptt.shortcut` at init — same as the existing hud pattern).
- **Notification policy**: `canNotify(kind)` = master ∧ event-toggle ∧ (quiet hours ⇒ kind ∈ {approval, error}); style Banner=4s/Alert=sticky/None; sounds via one WebAudio chime when enabled.
- **settings:changed** payload = `{ key, value }` JSON; every window re-applies appearance + i18n; theme rides the existing `palette:theme-change` channel (no double-broadcast).

## §3 Tests

- **Bun units** (`test/desktop/settings-*.test.ts`): store defaults + persistence roundtrip; i18n locale registry + t() fallback + RTL; shortcuts registry/resolution/formatting/capture/conflicts; notificationPolicy truth table incl. quiet hours; appearance effect application (jsdom-lite: attribute assertions).
- **Rust units** (`settings.rs::tests`): set_setting validation (unknown path rejected, bad types rejected); keychain fallback error path; storage_stats paths; autostart toggling (state, not OS); ptt chord parse.
- **E2E (Playwright, browser preview)**: boots, 9 tabs render, sidebar search filters, hash deep link + reload persistence, theme swatch switches whole app instantly + persists, density/font/glass/glow apply, ⌘, opens settings, General profile edit persists, notifications master toggle dims tab, shortcuts record + conflict, provider add/config modal + masked key, typed-DELETE confirm gating, 5 themes render, no console errors.
- **Gates**: root `bun test`, `bun run typecheck` (root + desktop), `eslint .`, `vite build` (3 entries), `cargo check`+`clippy -D warnings`+`test` in src-tauri.

## §4 Screenshots (previews/implementation/phase-08/)

01 general · 02 appearance (6 swatches) · 03 models+config modal · 04 shortcuts (recording state) · 05 notifications · 06 voice (volume meter) · 07 privacy · 08 updates · 09 about · 10+ Paper/Arctic/Graphite/Midnight variants of General+Appearance. Reference AI mock: `/home/user/previews/implementation/phase-08/settings-xr-native.png` (generated, not committed).

## §5 Out of scope (prompt §18)

Full LLM orchestration (P14) · cloud sync/accounts (P30) · model browser (P14) · budget enforcement (P13) · Shield proxy UI (P12) · multi-workspace (P10) · Voice Theater (P16) · team/SSO (P30) · marketplace (P20) · mobile (P28). All stubs are honest links/toasts labelled with their phase.
