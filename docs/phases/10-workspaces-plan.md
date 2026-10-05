# Phase 10 · Workspaces — implementation plan

Branch: `phase/10-workspaces` (from `main`).

## Rust (`desktop/src-tauri/`)
- `Cargo.toml`: + `trash = "5"`.
- `src/commands/workspaces/mod.rs` (+ submodules where noted):
  - `model.rs` — `Workspace`, `WorkspaceKind` (serde camelCase), `WindowBounds`, `WorkspacePatch`.
  - `migrations.sql` — `workspaces` table + pinned index (embedded via `include_str!`, idempotent DDL, run in `init` like `chat.rs`).
  - `db.rs` — `WorkspaceDb(Mutex<Connection>)` on the same `xr.db`; `init(app)` registered in `lib.rs` setup.
  - `scaffold.rs` — `scaffold_workspace(path, template_id, name)` → writes hand-written starter files per template (web/python/research/custom); returns file list.
  - `clone.rs` — `check_git_available`, `clone_git_workspace(url, path, name, window)` streams `workspace:clone-progress` `{percent,received,total,stage}` via `window.emit` (git CLI `--progress`, stderr parsing; friendly errors: git missing / bad url / not a repo); post-clone `detect_stack`.
  - `spawn.rs` — `spawn_workspace_windows(ids)` → `WebviewWindowBuilder` per id (label `workspace-<uuid>`, `WindowUrl::App("#/workspaces/<id>")`, frameless, saved bounds or 40px cascade), emits `workspace:windows-launched {opened, failed}`; bounds map + flush-on-close wiring (RunEvent).
  - commands: `list_workspaces` (with per-path `path_exists` stat), `get_workspace`, `create_workspace`, `update_workspace`, `delete_workspace(delete_files)` (trash::delete when true), `reveal_in_finder` (opener), `pick_folder` (dialog), `move_workspace_window`, `detect_stack`, `duplicate_workspace` (metadata copy).
- `lib.rs`: module + init + handler registration; RunEvent bounds flush; capabilities `default.json` windows += `"workspace-*"`.

## Frontend (`desktop/src/`)
- `workspaces/types.ts` — types + `workspaceTypeLabel/Gradient/Icon` + stack chip color map.
- `workspaces/templates.ts` — 6 templates (web/python/research/custom/git/scratch) with scaffoldPlan.
- `lib/workspace-db.ts` — `WorkspaceDb` interface + Tauri impl + **browser dev-seam** (localStorage, simulated clone progress, honest multi-window toast) mirroring `chat-db.ts`.
- `stores/workspaceStore.ts` — state (workspaces, loading, filter, search, viewMode, multiSelect, selectedIds, clone progress) + actions per brief §4; viewMode/filter/templateStripCollapsed persisted to settingsStore.
- `screens/Workspaces/index.tsx` — screen: header (title, New, multi-window toggle, view toggle), sub-header (search + filter chips), `TemplateStrip`, grid/list, `+` card, empty/loading/error states, launch bar, screen keydown (`/`, ⌘N, arrows, Enter, P, M, A, Esc, Shift+click range).
- `components/workspaces/` — `WorkspaceCard.tsx` (gradient strip, icon, star/checkbox, chips +N, hover actions, menu, path-missing badge), `WorkspaceListRow` (list mode), `TemplateStrip.tsx` (drag-scroll + arrows + inline git-clone expansion), `LaunchBar.tsx` (glass bar, slide-up), `NewWorkspaceModal.tsx` (3 steps incl. clone progress), `WorkspaceMenu.tsx`, `RenameDialog.tsx`, `DeleteDialog.tsx` (checkbox trash-files), `StackChips.tsx`, `SkeletonCard.tsx`.
- `screens/WorkspaceLanding.tsx` — route `/workspaces/:id`: hero + quick-action grid (Chat live; Builder/Research/Files/Memory grayed "Coming soon"; Settings opens workspace settings), runs strip ("No runs yet"), delete with confirm.
- `lib/nav.ts` — icon `LayoutGrid`; move workspaces to position 2 (under Chat, above Brain).
- `components/layout/Topbar.tsx` — `Workspaces · {name}` breadcrumb on `/workspaces/:id`.
- `styles/themes.css` — per-theme `--ws-{web,python,research,custom,git,scratch}-{from,to}` (+ `--ws-star` for light themes).
- palette: "Go to Workspaces", "New Workspace", "Open {name}" per workspace.

## Test (brief §15)
- Frontend via vite preview + Playwright (dev-seam): CRUD, templates (metadata), filters/search, grid/list persist, multi-select + launch bar (honest dev toast), landing, rename/delete dialogs, keyboard, skeletons, 5 themes, reduced motion.
- Rust: local `cargo check`/`clippy` if env ready (background install running); else CI.
- Real Tauri multi-window + real git clone: NOT verifiable in sandbox (no display/webkit) → PR note + exact test steps for review.
- Screenshots → `previews/implementation/phase-10/`.

## PR
Summary + screenshots + how-to-test + out-of-scope + @ahmadrrrtx. No self-merge.
