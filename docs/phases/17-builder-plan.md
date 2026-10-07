# Phase 17 — Builder: plan

Branch `phase/17-builder` · PR vs `main` · no self-merge.

## Engine (`src/daemon/`)

| File | Purpose |
| --- | --- |
| `builder-projects.ts` | project registry (path → id), validation, realpath; recursive `fs.watch` with debounce; pure helpers (`projectIdFor`, `rejectRoot`). |
| `builder-patch.ts` | pure unified-diff apply: `applyHunks(content, hunks)` with exact / offset / whitespace-insensitive matching, conflict report; backup naming. |
| `dev-servers.ts` | detection matrix (`detectProject(root)` pure over a file list), `DevServerRegistry` (spawn/stop/status/log ring + listeners, ready-URL parser, free-port probe), stopped on daemon stop + process exit. |
| `routes/builder.routes.ts` | all routes below, contract ids `builder.*`. |
| `routes/contract.ts`, `routes/schemas.ts` | contract entries + zod bodies; `docs/api/openapi.json` + generated client regenerated. |
| `routes/terminal.routes.ts` | `terminal.pty.open` accepts `projectId` → cwd resolves against that project root. |
| `routes/chat.routes.ts` | `context` cap 4 000 → 24 000. |

Routes (all under `/api/builder`, v1 mount `/api/v1/builder`):

| Method · path | Kind | Notes |
| --- | --- | --- |
| `POST /projects` `{path,name?}` | JSON | register/open; returns `{id,name,root,git}` |
| `GET /projects/:id/tree` | JSON | full tree (heavy dirs skipped, 4 000 entries cap), git badges, branch/dirty |
| `GET /projects/:id/file?path=` | JSON | text read (512 KB), `mtimeMs` |
| `POST /projects/:id/file/write` `{path,content,baseMtimeMs?}` | SSE | approval `write_file` (scope rule) → `applied{mtimeMs}` |
| `POST /projects/:id/file/create` `{path,kind}` | SSE | approval `write_file` (empty) / `mkdir` |
| `POST /projects/:id/file/rename` `{from,to}` | SSE | approval `rename_file` |
| `POST /projects/:id/file/delete` `{path}` | SSE | approval `delete_file` (dir → recursive, stated in preview) |
| `POST /projects/:id/apply-diff` `{path,patch,hunkIds?,baseMtimeMs?}` | SSE | parse → select hunks → dry-run apply → approval `patch` → backup → write → `applied{content,mtimeMs,backupId,applied,skipped}`; conflict → `error{conflict:[…]}` |
| `POST /projects/:id/undo` `{backupId}` | SSE | approval `write_file` → restore backup |
| `GET /projects/:id/git` | JSON | `{branch,dirty,files:{rel:status},ahead?}` |
| `GET /projects/:id/dev-server` | JSON | `{running,starting,url,port,pid,readyMs,kind,cmd,needsInstall,pm,log:[…]}` |
| `POST /projects/:id/dev-server/start` `{cmd?}` | SSE | policy gate + approval `shell` → spawn → `started{pid}` (logs via events) |
| `POST /projects/:id/dev-server/stop` | JSON | kill |
| `POST /projects/:id/dev-server/install` | SSE | approval `shell` (`<pm> install`) → streams `log` until `exit` |
| `GET /projects/:id/events` | SSE | `dev-server:log|ready|exit|status`, `fs:changed{paths}` |
| `POST /projects/:id/diagnostics` `{path,content}` | JSON | project TypeScript `transpileModule`; `{available,reason?,diagnostics}` |

Tests: `test/daemon/builder-routes.test.ts` (sandbox escapes, tree, write with
approval + remember-free flow, apply-diff clean/conflict/undo, detect matrix,
ready-line parser, project validation).

## Desktop (`desktop/src/`)

| File | Purpose |
| --- | --- |
| `engine/builder.ts` | typed client for the routes above (`engineJson`, SSE reader with approval bridging). |
| `lib/builderCore.ts` | PURE: language id, fuzzy match + highlight, MRU tab order, pane clamps/persist shape, `file:line` link parsing, diff-block extraction from markdown, console-line classification, key map. Root-tested (`test/desktop/builder-core.test.ts`). |
| `stores/builderStore.ts` | project, tree, tabs/buffers/dirty, selection, git, panes, preview/dev-server state, console lines, terminal visibility. |
| `lib/cmTheme.ts`, `styles/themes.css` | CM6 theme + highlight style from tokens; per-theme `--syn-*` palette (5 themes, ≥4.5:1). |
| `screens/Builder/index.tsx` | route → lazy `BuilderScreen`; workspace lookup, empty/not-found states. |
| `screens/Builder/components/BuilderTopBar.tsx` | breadcrumb, branch chip, target select, sync dot, Save/Push/Deploy. |
| `…/ChatPane.tsx` | compact thread over `chatStore` (builder session per workspace), diff cards, file:line links, composer. |
| `…/DiffCard.tsx` | per-hunk accept/reject, Apply / Explain / Copy, undo toast. |
| `…/EditorPane.tsx`, `…/CodeEditor.tsx`, `…/TabBar.tsx`, `…/StatusBar.tsx`, `…/QuickOpen.tsx` | CM6 multi-file editor, tabs (dirty dot, middle-click, Ctrl+Tab MRU), ⌘P, status bar, diagnostics, goto-line flash, diff gutter flash. |
| `…/FileTree.tsx` | tree (expand/collapse, git badges, context menu, single/double click, active bar, live refresh). |
| `…/PreviewPane.tsx`, `…/ConsolePanel.tsx` | URL bar, nav, device sizes, status chip, iframe, install/start flows, console (dev-server output). |
| `…/TerminalPane.tsx` | xterm + PTY (`projectId`), Ctrl+`. |
| `components/layout/*`, `lib/paletteCommands.ts`, `screens/WorkspaceLanding.tsx`, `components/workspaces/WorkspaceCard.tsx` | launch points. |
| `stores/chatStore.ts` | `surfaceContext` seam (builder text + agent "Builder" + budget surface `builder`). |
| `budget/types.ts` | `SpendSurface` + `'builder'`. |
| `engine/wire.ts` | `resourceOf` prefers `scope`; tool meta for `patch`, `rename_file`, `mkdir`. |
| `src-tauri/tauri.conf.json` | CSP `frame-src http://localhost:* http://127.0.0.1:*`. |

## Order of work

1. Engine: registry + patch + dev-servers + routes + contract + tests.
2. Desktop deps, `builderCore` + tests, store, API client.
3. Editor (CM6 theme, tabs, quick open, status bar, diagnostics), file tree.
4. Chat pane (diff cards, apply/undo, links), top bar, preview + console, terminal.
5. Launch points, shortcuts, palette, Orb/HUD, docs, screenshots, gates, PR.

## Acceptance checklist

- [ ] `/builder/:wsid` opens; breadcrumb; not-found + no-workspace states.
- [ ] 3 panes, persisted sizes, ⌘1/2/3, double-click reset.
- [ ] Real tree, badges, context menu actions, live refresh.
- [ ] Editor: highlighting per language, tabs, ⌘P, ⌘S, auto-save, dirty close confirm, Ctrl+Tab MRU, middle-click.
- [ ] Chat streams real engine turns with builder context; file:line links jump + flash.
- [ ] Diff cards: per-hunk accept/reject, Apply via engine, undo, conflicts surfaced.
- [ ] Preview: detect → install → start → Ready chip → iframe; reload / external / device widths; stop/restart; killed on close.
- [ ] Console (dev-server output) + Terminal (PTY, Ctrl+`).
- [ ] Diagnostics squiggles + hover.
- [ ] Top bar: Save works, Push/Deploy toast "coming", branch chip, sync dot.
- [ ] Cross-surface: Brain run tagged Builder, Runs row, Budget spend `builder`, approvals via modal.
- [ ] 5 themes, reduced motion, a11y, TS strict, lint, console clean, sandbox escapes rejected.
