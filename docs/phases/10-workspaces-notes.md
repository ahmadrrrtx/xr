# Phase 10 · Workspaces — study notes

## Environment reality (sandbox)
- No Rust toolchain at session start → installing rustup + webkit2gtk-4.1/gtk3/rsvg/ayatana-appindicator dev deps in background for local `cargo check`. If local check proves infeasible (2 cores / 1.9GB RAM), CI's "Rust shell — cargo check + clippy" + "tauri bundle" jobs are the compile authority.
- No display, no webkit at runtime → **cannot launch real Tauri windows here**. Multi-window spawn is verified by: (a) compile + clippy clean, (b) unit logic review, (c) honest PR note + test instructions for Ahmad. Browser dev-seam covers all UI behavior (grid, modal, multi-select, launch bar, landing) via Playwright.
- `git` CLI available in sandbox → git-clone code path testable in the browser dev-seam simulation; real CLI path compile-checked.
- Reference image `previews/09-workspaces.png` does **not** exist on disk (checked repo + workspace) → text brief (SCREEN-BRIEFS §SCREEN 3 + build brief §18 aesthetic notes) is authoritative.

## Existing code facts (studied)
- **Route** `/workspaces` exists → `src/screens/Workspaces/index.tsx` = `PlaceholderScreen`. Need to add `/workspaces/:id` (WorkspaceLanding) to `src/router.tsx`.
- **NAV_ITEMS** (`src/lib/nav.ts`): `workspaces` entry already present (3rd: chat, brain, workspaces; Folder icon, phase 10). Brief wants it directly under Chat and above Brain → swap positions; icon → `LayoutGrid`.
- **Topbar title** resolves from NAV_ITEMS by first path segment (`src/components/layout/Topbar.tsx useScreenTitle`) — add `workspaces` + runId-style suffix handling for `/workspaces/:id` ("Workspaces · {name}").
- **DB pattern** (`src-tauri/src/commands/chat.rs`): `ChatDb(Mutex<Connection>)` Tauri state, `init(app)` in setup hook, idempotent `CREATE TABLE IF NOT EXISTS` via `execute_batch` — "no migration framework at this scale". Follow with `WorkspaceDb` opening the **same** `xr.db` (WAL handles two connections).
- **Frontend contract mirror** (`src/lib/chat-db.ts`): interface + Tauri-invoke impl + localStorage browser mirror. Follow with `src/lib/workspace-db.ts` — gives full UI testability in Playwright without the shell.
- **Capabilities**: `default.json` grants only to `"main"`. App-defined commands need no grants (dialog/opener invoked Rust-side). Spawned windows get labels `workspace-<uuid>`; add `"workspace-*"` to `default.json` windows so core:default applies.
- **tauri.conf.json**: main window frameless (`decorations: false`), 1280×800, min 960×600. Spawned windows: same frameless; default 1280×800, saved bounds per workspace.
- **Plugins already present**: tauri-plugin-dialog, tauri-plugin-fs, tauri-plugin-opener, tauri-plugin-shell. **Add**: `trash` crate (v5). Git via `std::process::Command` (CLI, friendly "git not found" error; git2 deferred per brief).
- **Invoke handler**: `lib.rs generate_handler![...]` — append `commands::workspaces::*`.
- **Multi-window in Tauri v2**: `tauri::WebviewWindowBuilder::new(app, label, WindowUrl::App("#/workspaces/<id>".parse()))` — no extra crate features needed for multiple top-level windows.
- **Window bounds persistence**: Rust `RunEvent::WindowEvent` (Moved/Resized) for `workspace-*` labels → in-memory map (no DB spam) → flush to DB on window close (CloseRequested/Destroyed) and on app exit. Acceptance only requires save-on-close + cascade-on-next-launch.
- **Palette**: `src/components/palette/*` is the live palette (Phase 5, `usePaletteStore`); commands registered via the palette items model — inspect `PaletteResults`/item registration when wiring.
- **Settings persistence**: `src/stores/settingsStore.ts` (Phase 8) — persist `workspaces.viewMode`, `workspaces.filter`, `workspaces.templateStripCollapsed` there.
- **Brain screen** (Phase 9) is the structural template: sticky header + content, screen-level keydown listener, `isTauri` dev seams, `useTweenNumber`, etc.
- **Design tokens**: Tailwind v4 + `themes.css` per-theme vars (`--bg-*`, `--accent`, `--accent-glow`, `--cat-*`). Add `--ws-<kind>-from/to` gradient pairs per theme (saturated dark, desaturated graphite, muted watercolor paper/arctic). Glow only xr-native + midnight (existing `--accent-glow` convention: transparent in paper/arctic/graphite — reuse for card glow).
- **Reduced motion**: `useReducedMotion` (framer) + `html[data-motion]` + MotionConfig in App.tsx (`reduceMotion ? 'always' : 'user'`).
- **Sonner** toasts app-wide; confirm dialogs = `src/components/settings/dialogs.tsx ConfirmDialog` (Radix, role=alertdialog) + shadcn AlertDialog available in `src/components/ui/`.

## Design decisions
1. **Label scheme** `workspace-<uuid>` (not `workspace:<id>`) → clean capability wildcard `workspace-*`.
2. **Scaffolder**: hand-written files (offline, instant) per brief §2 — no npm/bun invocation. Web template writes package.json/vite.config.ts/src/main.tsx/src/App.tsx/src/index.css/index.html with an XR-themed starter + "Run bun install" README note.
3. **Dev-seam** (non-Tauri): localStorage store under key `xr.workspaces.dev.v1`; scaffold = metadata only (no disk); clone = simulated progress (stages at ~600ms intervals) then row created with `stack: ['Git']` + honest "simulated in browser" note in the workspace `stack`? No — keep stack honest: simulated clone gets stack `[]` + toast noting the browser seam. Multi-window in dev-seam: honest toast "Multi-window launches need the desktop shell."
4. **Undo on delete (nice-to-have per plan §approval test)**: Sonner toast with an Undo action that re-inserts the row (DB-only delete keeps files, so Undo is always safe when deleteFiles=false; when deleteFiles=true, no Undo — honest).
5. **Path missing**: `list_workspaces` returns rows; a cheap `check_workspace_paths` Rust command stats each path (batch) → frontend marks missing. Dev-seam: paths always "present" (browser has no FS); the card badge + Locate flow is still testable via a dev flag? Keep it simple: Tauri-only feature; UI state exists and is coded, screenshots use a forced-missing dev param if needed.
6. **Search `/`** (not ⌘F — collides with browser find, per brief). Screen-scoped keydown like Brain.
7. **Duplicates**: metadata-only duplicate is dishonest per brief → implement real folder copy in Rust? `fs_extra` dep is heavy-ish but small… Brief: "Implement real filesystem copy via fs_extra if simple — required to pass is the metadata duplicate is honest about not copying files." Decision: metadata duplicate + toast "Copied as 'X (copy)' (files not copied yet)" — honest, no new dep, passes.
8. **Templates array** mirrored between TS (`src/workspaces/templates.ts`) and Rust scaffolder (match by template_id string).
9. **Sorting**: pinned DESC, last_opened_at DESC (NULL last) — same as SQL index.
10. **Workspace window URL**: `WindowUrl::App` with `#/workspaces/<id>`; app boots normally (same index.html), route param scopes the landing. Window-scoped chrome = Phase 29 (per brief).

## Risks
- Tauri v2 API drift (WebviewWindowBuilder, WindowUrl::App) — compile-checked by CI if local check unavailable.
- `trash` crate version/features — pin `trash = "5"`, API: `trash::delete(path)`.
- Linux capability wildcard `workspace-*` — verify against Tauri v2 capability docs; fallback: register each spawned label dynamically? (Tauri v2 does support wildcards in capabilities — confirmed pattern in tauri docs examples.)
- rusqlite two-connection WAL on same file — standard, fine.
