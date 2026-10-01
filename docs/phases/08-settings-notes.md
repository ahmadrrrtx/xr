# Phase 8 — Settings · Study Notes (mental model)

One page. What exists, what's missing, what I reuse. Written after the Step-0 study pass.

## What already exists (do NOT rebuild)

| Concern | Where | Notes |
|---|---|---|
| 5-theme system | `stores/theme.ts` + `styles/themes.css` + `public/theme-init.js` | `ThemeId = xr-native\|graphite\|midnight\|paper\|arctic`, `html[data-theme]`, pre-paint via localStorage `xr.theme`. **No `system` mode yet.** |
| Persistence pattern | `lib/persistent-store.ts` | Write-through: Tauri Store `settings.json` + localStorage. Keys already in that store: `xr.theme`, `xr.sidebar.collapsed`, `xr.user.name`, `xr.hud.shortcut`, `xr.hud.shortcutConflict`. |
| Settings nav | `lib/nav.ts` | `settings` is already one of the 14 nav items (last position, `Settings` icon, `/settings`, phase 8). |
| `⌘,` → /settings | `AppShell.tsx` `useGlobalHotkeys` | Also `mod+k` palette, `mod+b` sidebar, `mod+n` new chat, `mod+shift+t` cycle theme, `mod+.` (voice placeholder toast). Consumed via `hooks/useHotkeys.ts` (combo strings like `mod+k`). |
| Placeholder screen | `screens/Settings/index.tsx` (11 lines) + `_dev/ThemeToggle.tsx` | PlaceholderScreen + theme toggle. Replace/absorb. |
| Cross-window event pattern | `events.rs::theme_changed` → broadcasts `palette:theme-change` to ALL windows; `usePaletteIpc` (both windows) syncs theme store | The exact pattern to clone for `settings:changed`. |
| HUD global shortcut + user override + conflict fallback | `commands/hud.rs` | Reads `xr.hud.shortcut` from the Store at init; primary+fallback per OS (`Cmd+Space`/`Alt+Space` mac, `Alt+Space`/`Ctrl+Shift+Space` else); `hud_shortcut_info()` exposes what registered. **Clone for orb + PTT.** |
| Orb shortcut | `commands/orb.rs` | Hardcoded `Alt+CommandOrControl+O` (fallback `Alt+Shift+O`) — needs the hud-style override. `lib.rs` RunEvent::Exit → `hud::unregister_all` tears ALL globals down. |
| Ollama | `commands/ollama.rs` (`ollama_pull` NDJSON stream → `ollama://pull-progress` events) + `system.rs::detect_ollama` (GET /api/tags) + `detect_system` (RAM via sysinfo) | Onboarding `StepModelPull`/`StepMicSetup`/`StepVoice` already render pull progress, mic volume meter (Web Audio RMS bars), and TTS (speechSynthesis). Reuse all three in the Voice + Models tabs. |
| Tauri plugins (ALL pre-wired in `lib.rs`) | autostart, clipboard, deep-link, dialog, fs, global-shortcut, notification, os, shell, single-instance, store, **stronghold (Argon2id)**, updater | Capabilities gate only JS guest calls; custom Rust commands need no capability (proven Phases 5–7). JS `@tauri-apps/plugin-updater` needs `updater:default` in capabilities — the ONLY new permission. |
| Rust data locations | `chat.rs`: SQLite at `app_data_dir/xr.db` | Data folder to reveal = Tauri app data dir (deviation from brief's `~/xr` — the app never used `~/xr`). |
| UI kit | `components/ui/*`: badge button card checkbox command dialog dropdown-menu input popover separator skeleton switch tabs tooltip | Monolithic `radix-ui` package → Select + Slider primitives available **without new npm deps**. No `select.tsx`/`slider.tsx` yet — add styled wrappers. |
| Sounds | Phase 7 locked **no sounds** for approvals | Phase 8 adds sound *settings*; default OFF (see plan deviations), synthesized via WebAudio (no asset files). |
| OS notifications | `commands/approvals.rs::send_os_notification` | Reuse for the "Test" button in Notifications tab. |
| Version | `src-tauri/tauri.conf.json` `version: 0.2.0` | Import as JSON in Vite for About/Updates. |

## Integration points (what Phase 8 plugs into)

- `AppShell.useGlobalHotkeys` — swap hardcoded combos for resolver output (`lib/shortcuts.ts` = defaults ⊕ `xr.shortcuts` overrides).
- `AppShell.usePersistedSettings` / `App.tsx` boot — hydrate `settingsStore` alongside theme/sidebar/name; apply appearance effects (density/font/glass/glow) to `<html>` via `lib/appearance.ts`.
- `usePaletteIpc` (main + HUD) and the orb entry — add a `settings:changed` listener so all three windows re-apply appearance.
- `lib/approvalEvents.ts` + `stores/notificationStore.ts` — route every toast/OS-notification/sound through `lib/notificationPolicy.ts` (master toggle, per-event, style, quiet hours, sounds).
- `lib/paletteCommands.ts` — settings deep links already exist (`/settings/about`, `/settings/updates`…) → make hash routes (`#about`) work with them.
- Chat boot ("Open to" setting) — `sessionsStore` knows the last session.

## Gaps I must build (nothing exists yet)

`stores/settingsStore.ts` · `lib/i18n.ts` (no i18n at all — infra + settings-surface strings only) · `lib/shortcuts.ts` · `lib/appearance.ts` · `lib/notificationPolicy.ts` · `lib/settingsApi.ts` · all of `components/settings/*` · the whole two-pane screen + 9 tabs · `commands/settings.rs` (keychain/reveal/export/clear/reset/open_url/restart/autostart/storage stats) · `ui/select.tsx` + `ui/slider.tsx` · theme `system` mode (+ `theme-init.js`) · density/typography/glass/glow CSS vars · licenses generator · tests + e2e.

## Brand guardrails (from DESIGN-SYSTEM + prior phases)

Lucide @1.5px · no hardcoded hex outside themes.css (use tokens: `text-accent`, `bg-bg-ink`, `border-subtle`…) · radius-md 8 / lg 12 / xl 16 · glow only via `--accent-glow` (transparent in Paper/Arctic → glow off "just works" there) · copy: short, calm, sentence case, no exclamation marks · Orbitron display / Inter body / JetBrains Mono code · sidebar rows 32–40px with 4px accent bar pattern (match `Sidebar.tsx`).

## Implementation log (Phase 8 build — post-plan)

**Frontend (all gates green: tsc, eslint, vite build)**
- `screens/Settings/index.tsx` — two-pane shell, 180px sidebar (search + 5 groups + arrow-key tablist), hash routing `#tab`, AnimatePresence spring 300/26 + 80ms opacity, General shows hero "Settings" title.
- 9 tabs in `screens/Settings/tabs/`: General (profile avatar ≤1.5MB dataURL, autostart w/ revert-on-fail, openTo, model/fallback, budget auto/2/5/10/20/50/custom 1–200, locale, Data export/import/clear/reset), Appearance, Notifications (master + 7 event kinds + quiet hours + OS test + `osEnabled` channel flag + volume), Models (12-provider catalog, ProviderConfigModal w/ keychain→local-insecure fallback + real list-models ping, 6 capability defaults = store's chat/coding/embeddings/vision/stt/tts, Ollama detect + RAM-tuned pull w/ live `ollama://pull-progress` id-filtered progress), Shortcuts (capture-phase recorder, modifier rule, conflict detect, global rebind via hud/orb/ptt Rust set commands, reset), Voice (mic detect + 5s RMS meter + gain, TTS voices + rate, PTT global rebind, wake-word/always-listen persisted-but-Phase-15), Privacy (locked local/encryption rows, storageStats, telemetry, PII patterns, Shield→Phase 12, delete-conversations via chatDb loop, resetApp typed-DELETE), Updates (RelativeTime interval pattern, plugin-updater graceful dev catch, channels, install+relaunch), About (Logo full 120, licenses dialog from generated `src/data/licenses.ts` — 395 entries, devtools toggle, data folder/config reveal).
- `lib/settingsApi.ts` — typed bridge for every Phase 8 Rust command + browser no-op fallbacks; `lib/shortcuts.ts` + SHORTCUTS registry (9 chords) + `formatTauriChord`; `lib/appMeta.ts`; `lib/i18n.ts` (en + ur, settings surface keys); `lib/notificationPolicy.ts` (master→event→quiet-hours→`shouldOsNotify`/`shouldSound`); `hooks/useSettingsSync.ts` (load + `settings:changed` listener; mounted AppShell + HudApp, NOT orb — bundle budget).
- Integration: App.tsx MotionConfig reducedMotion + boot load + hydrateLocale; AppShell hotkeys now resolve via `effectiveCombo(id, overrides)` + new `focus-composer` (mod+l → `#xr-composer` on Composer textarea); Sidebar iconSize s/m/l→16/20/24; UserMenu Profile → `/settings#general`; paletteCommands 9 settings deep links (hash form); approvalEvents.sendNotification routes OS + sound through the policy.
- React-compiler lint rules (`set-state-in-effect`, TDZ, prefer-const) forced two clean patterns: ConfirmDialog/ProviderConfigModal reset via Radix content-unmount (inner body component), RelativeTime derives label from interval-ticked `now` state.
- **Parallel edit_file calls to the SAME file race and clobber each other** (lost 3 import edits twice this phase). Always sequence edits per file.

**Rust** — `commands/settings.rs` (~26 commands), hud/orb runtime rebind commands, `init_ptt` in desktop setup, keyring 3 + zip 4 deps, `updater:default` capability. API facts: pull events carry `id` (not model) — filter by the u32 the invoke returns; `detect_ollama` lives in system.rs, `ollama_pull` in ollama.rs; `readSettingJSON` takes 1 arg (no default).

**Pending** — cargo check → clippy -D warnings → cargo test → screenshots/e2e (playwright absent) → push branch → PR.
