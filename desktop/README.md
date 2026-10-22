# XR Desktop

**XR — the AI agent you can actually trust.**

Tauri v2 + React 18 + TypeScript + Tailwind v4 (Oxide) + shadcn/ui shell.
Phase 0 scaffold: app chrome (sidebar + topbar + custom window controls),
14 placeholder routes, and the full 5-theme system (XR Native / Graphite /
Midnight / Paper / Arctic).

## Quick start

```bash
bun install          # dependencies
bun run engine       # XR engine for the browser preview (writes .xr-dev/token for the proxy)
bun run dev          # Vite dev server (browser preview) → http://127.0.0.1:5173
bun run dev:tauri    # native shell (requires Rust toolchain; compiles the engine sidecar first)
```

The browser preview talks to the engine through the Vite proxy (`/api/v1` →
`http://127.0.0.1:3141`, token injected server-side). If the engine is not
running, the app shows an "Engine not running" banner; its **Start engine**
button launches `bun run engine` from the dev server (`POST /__xr/engine/start`,
loopback callers only unless paired). Chat needs a provider: a local Ollama
with at least one model, or an API key saved in Settings → Models.

The native shell spawns the compiled engine (`src-tauri/binaries/xr-engine-<triple>`)
itself — one spawn mechanism, port 0, token read from the engine's banner.

## Your data: export, import, recovery

**What Settings → General → Export contains.** The desktop app's own data
folder (the OS app-data dir for `ai.rrrtx.xr`): `xr.db` (conversations,
workspaces, the Shield audit chain, budget history), `settings.json` and
`approvals.json`. The database is copied with a consistent SQLite snapshot
(`VACUUM INTO`), so recent changes still in the write-ahead log are included.

**What it does not contain.** The XR engine's home (`~/.xr`, or `XR_HOME`):
the engine's own `xr.db` (agent memory, runs, CLI sessions), its config and
logs, and provider keys stored in the OS keychain. To back up engine data,
copy the `~/.xr` folder while XR is closed (`xr context export` exports
context items only). Keys must be re-entered on a new machine.

**Import** checks the archive before touching anything: unsafe paths, size
limits, and `PRAGMA integrity_check` on every database. A damaged or foreign
file is an error ("Import failed — your data is unchanged"). A valid import
is staged and applied when XR restarts, before any database is opened. Your
previous data moves to `.import-backup-<timestamp>/` inside the data folder
(the two most recent are kept).

**A damaged database** no longer stops the app from starting. The file is
moved to `xr.db.corrupt-<timestamp>` (never deleted), a fresh database is
created, and the app tells you what happened.

## Window permissions (IPC allow-list)

Each window can call only the native commands its own code uses. The lists
are generated from each window's import graph into
`src-tauri/capabilities/ipc-*.json` (`bun run desktop:ipc-acl --write`; CI
checks they are current). The HUD palette, the Orb and the Theater never get
data import/export/reset, keychain, path-opening, security-policy or update
commands. Workspace windows run the main bundle without import/export/reset.
Release builds have no web inspector. `reveal_path` only opens XR's own
folders, and it reveals executables instead of running them.

## Scripts

`dev` · `engine` · `dev:tauri` · `build` · `build:tauri` · `sidecar` · `typecheck` · `lint` · `format`

## Docs

Master design docs live in [`../docs/`](../docs/) — `DESIGN-SYSTEM.md`,
`THEME-SYSTEM.md`, `SCREEN-BRIEFS.md`, `DEEP-DIVE-ARCHITECTURE.md`,
`IMPLEMENTATION-PLAN.md`. This phase's plan: `../docs/phases/00-scaffold.plan.md`.

License: MIT (repo root `LICENSE`).
