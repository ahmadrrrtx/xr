# Phase 17 — Builder: study notes

## What actually exists on `main` (vs. the brief)

The brief assumes `Workbench.tsx`, `Editor.tsx`, `DiffViewer.tsx` and
`PtyTerminal.tsx` with CodeMirror 6 + xterm already in the desktop tree. On
`main` they do not exist: they belong to the earlier "v2 operator" desktop
(`origin/feat/v2-operator-phase2`, Sept 2026) that the Phase 0–16 rebuild
replaced. `desktop/src/screens/Builder/index.tsx` is a `PlaceholderScreen`,
`/builder/:workspaceId?` is already routed, and neither `@codemirror/*` nor
`@xterm/*` is in `desktop/package.json`.

What DID survive, and is reused as-is or extended:

| Piece | Where | Reuse |
| --- | --- | --- |
| Scope-enforced file browser (`insideRoot`, porcelain parsing, text sniff, approval-gated `files.write`) | `src/daemon/routes/files.routes.ts` | helpers reused; the Builder gets project-rooted siblings |
| Hunk ids + subset patch builder | `src/daemon/hunks.ts` | diff review ids, patch assembly |
| Real PTY (`Bun.spawn({terminal})`, caps, kill on disconnect / daemon exit) | `src/daemon/pty-sessions.ts`, `terminal.routes.ts` | terminal pane; dev-server spawning follows the same lifecycle rules |
| Durable approvals + structured previews + policy gate | `src/control/approval-store.ts`, `control/preview.ts`, `security/guard.ts` | every Builder mutation |
| Engine chat with `context` (system prompt) and `mode` | `chat.routes.ts`, `desktop/src/engine/chat.ts`, `stores/chatStore.ts` | Builder chat = chatStore turn with `mode:'ask'` + builder context |
| Desktop approval bridge (modal, remember rules, Shield gate) | `desktop/src/engine/approvals.ts`, `lib/approvalEvents.ts` | SSE `approval_required` frames from builder routes |
| Phase 10 workspaces (Rust xr.db; `path`, `kind`, `stack`) | `desktop/src/stores/workspaceStore.ts`, `lib/workspace-db.ts` | the Builder opens a workspace's `path` |
| Brain run recorder, budget governor, Runs projection | `brainStore.beginEngineRun`, `budget/api.ts`, `runs/core.ts` (agent "Builder" → kind `builder`) | cross-surface accounting |
| Resizer (persisted, double-click reset) | `desktop/src/components/Resizer.tsx` | the three dividers |
| Palette / cmdk, context menu, select, tooltip, kbd | `components/ui/*`, `components/palette` | quick open, tree menu, target selector |
| Old v2 components (ported, not copied blindly) | `git show origin/feat/v2-operator-phase2:desktop/src/components/{Editor,DiffViewer,PtyTerminal}.tsx` | CM6 wiring, PTY SSE loop |

## Decisions

1. **CodeMirror 6, not Monaco** (brief). Packages added to `desktop/`:
   `@codemirror/{state,view,language,commands,search,lint,autocomplete,lang-javascript,lang-json,lang-css,lang-html,lang-markdown,lang-python,lang-rust,lang-yaml}`,
   `@lezer/{highlight,common}`, `@xterm/{xterm,addon-fit}`. All MIT; loaded in
   the lazy Builder chunk only. Root `bun.lock` (supply-chain scans) is untouched.
2. **Project root ≠ engine cwd.** Every existing file/terminal route is rooted
   at the daemon's `process.cwd()`. Builder routes are rooted at a *registered
   project*: `POST /api/builder/projects {path}` validates (exists, directory,
   not `/`, not `$HOME`, not `XR_HOME`), realpaths it, audits
   `builder.project.opened` and returns a stable id (sha1 of the realpath).
   Every later path is `insideRoot(project.root, rel)` — `..`, absolute and
   symlink escapes answer 400.
3. **Mutations stream** (`POST … → SSE`): `approval_required` → the desktop
   bridges it through the Phase 7 modal (remember rules work) → `applied` /
   `denied` / `error` → `[DONE]`. Same framing as `/api/terminal/run`.
4. **Consent scope.** Builder approvals carry `args.scope = "<project name> (Builder)"`;
   the desktop's `resourceOf` prefers `scope`, so "Always allow · Write a file ·
   my-app (Builder)" is ONE rule per project instead of one per file. The
   preview still shows the exact path, bytes and diff.
5. **Diff apply is engine-owned**: parse the unified diff (`hunks.ts`), apply the
   selected hunks in-process with context matching (exact → offset search ±200
   lines, whitespace-insensitive fallback), refuse with a conflict report when a
   hunk does not fit, back up the original to `XR_HOME/builder-backups/<project>/`
   and return `{content, mtimeMs, backupId}`; `undo` restores a backup (also
   approval-gated — it is a write).
6. **Dev server = engine child process** (`src/daemon/dev-servers.ts`):
   `Bun.spawn` with piped stdio, `FORCE_COLOR=0 BROWSER=none`, one per project,
   SIGTERM → 2 s → SIGKILL **of the whole process tree** (`proc-tree.ts`:
   `npm run dev` is only a wrapper around `sh -c vite`; signalling the top pid
   alone orphaned the real listener with its port — found in the smoke run,
   regression-tested in `test/daemon/proc-tree.test.ts`), killed on daemon
   stop and on `process.exit`. Ready
   detection parses the first `http://localhost:PORT`-style URL from stdout;
   "Ready in N ms" is measured by the engine. Detection matrix: vite → next →
   react-scripts → generic `dev`/`start` script → Cargo → Django/Flask → static
   `index.html` (python http.server on a free port ≥ 8000). Node projects with
   no `node_modules` report `needsInstall` + the lockfile's package manager.
7. **TS diagnostics**: the engine imports the PROJECT's own
   `node_modules/typescript` (never bundled into the sidecar; the engine has one
   runtime dependency) and runs `transpileModule` with `reportDiagnostics` for
   syntax diagnostics. In-editor, a Lezer syntax-error linter covers every
   language instantly. No LSP (brief §17).
8. **Preview iframe sandbox** keeps `allow-same-origin` (plus scripts/forms/
   popups/modals): the dev server is a different origin from the app, so it
   cannot reach XR chrome either way, while an opaque origin would break
   `localStorage`, HMR websockets and most user apps. Tauri CSP gains
   `frame-src http://localhost:* http://127.0.0.1:*`.
9. **Console panel = dev-server stdout/stderr** colour-coded (log/warn/error
   heuristics). Cross-origin iframe console injection is not possible without
   a proxy; the brief allows this fallback.
10. **Chat context budget**: `chat.routes` capped `context` at 4 000 chars; the
    Builder needs the active file excerpt, so the cap becomes 24 000 (the
    desktop bounds builder context to ~12 KB; the budget governor meters it).

## Guardrails carried over

- Copy stays calm: "Ready in 2.3s", "Couldn't apply cleanly", no celebration.
- Red only for diagnostics/errors and the stop button while streaming.
- No engine write without a human decision (D-01); XR never auto-applies.
- Root `src/` size gate: engine additions ~1.1k LOC → `TREE_CEILING` raised with a dated reason.
- Desktop tests in `test/desktop/*` use relative imports only (CI root has no desktop node_modules).

## Smoke run (Playwright against `vite preview` + the real engine)

Flow exercised end to end on a scratch Vite+TS project with no `node_modules`:
open workspace → tree → open file → "Install dependencies?" → **Approve**
(real `npm install`, streamed to the console) → auto-start → **Approve** →
"Ready in 384ms" + live iframe → **Apply diff** from the chat → **Approve** →
file reloads, gutter flash, "Applied 1 hunk to style.css · Undo", HMR shows
the red button → ⌘P quick open → typed edit → 1 s auto-save → **Approve**
(write_file) → Saved → Ctrl+` terminal → **Approve** (shell) → `ls src`.
Zero console errors, zero page errors, both XR Native and Paper.
Screenshots: `previews/implementation/phase-17/`.

Fixed because the run found them:

- `engineFetch` already carries `/api/v1`; the Builder client double-prefixed
  it (every call 404 "not found").
- `allowShellExec` is **off by default**, so install/dev-server/terminal were
  silently refused by the Shield gate (no modal is shown for a policy block).
  `BuilderDenied` now carries `blocked` + the gate's reason; the Builder toasts
  "Install blocked by XR Shield — shell execution is disabled in Security
  Settings · Open Shield" (Constitution VII.3: a downshift is explained). A
  human "Deny" in the modal stays silent, as before.
- Status chip said "Ready in Ready in 407ms".
- Stopping the dev server left vite listening (see Decision 6).
- Tabs squeezed to one glyph in a narrow editor; `node_modules`/`.git` rows
  are now visibly secondary; console timestamps always faintly visible.

## Follow-ups (not in this PR)

- **Voice edits routed through the Builder when it is focused.** Voice turns
  run engine-side (`pipeline.processText`); a per-surface handoff needs an
  engine seam, not a desktop patch.
- **Overridable Builder chords.** `lib/shortcuts.ts` rows are bound app-wide
  by AppShell and recorded in Settings; the Builder's ⌘P/⌘S/⌘1-3/⌘⇧A… are
  screen-local and fixed. ⌘⇧P lists them in-app. Making them overridable
  means a `builder` scope the shell must *not* bind.
