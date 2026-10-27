# XR Desktop

**XR — the AI agent you can actually trust.**

Tauri v2 + React 18 + TypeScript + Tailwind v4 (Oxide) + shadcn/ui shell.
The desktop shell bundles its governed XR engine; it does not require a globally installed CLI. Renderer build success is not native installer/signing validation. See the current [release progress](../docs/release/PROGRESS.md) for executed checks and blockers.

## Quick start

```bash
bun install --frozen-lockfile  # desktop dependencies; also install root dependencies from repository root
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
Both native and development engine launches use **`~/.xr-desktop`**, or an
absolute `XR_DESKTOP_HOME`. They ignore the CLI's `XR_HOME`; no old CLI data or
credentials are implicitly copied, changed or deleted. macOS/Linux engine
credentials additionally use a **per-home OS-store service**, not CLI's global
`xr` service. Moving the desktop home changes that service: re-enter keys rather
than assume an OS-store backup moved with files. Explicitly attaching to an
external engine deliberately shares that endpoint's configuration/policy.

### First-run and provider state

Choose a local, explicitly discovered/registered model or save the chosen
hosted provider key through the engine broker. Startup/catalog inspection works
offline. Saving does not probe the vendor unless requested. A saved credential
is **not** successful authentication, reachability or agent validation. Auto
shows an offline, constraint-based preview and requires acceptance of one
qualified target; it does not enable provider roaming or cross-provider failover.
No catalog entry is claimed benchmark-recommended without evidence.

New keys are never written to generic JSON or localStorage. The engine reports
OS-store vs **AES-GCM sealed-file fallback**; that fallback has a nearby key and
does not protect against whole-home compromise. Legacy plaintext desktop copies
are removed in place only after storage acknowledgment; failure is actionable,
not a completed setup. Rotate keys previously stored by older versions; cleanup
cannot erase backups. Removing a provider waits for credential-backend
acknowledgment and cannot revoke vendor-side keys/environment/other installs.
Historical native keychain reads/deletes are restricted to old desktop provider
accounts; new native legacy writes are disabled in favor of the engine broker.

The root engine ledger is the shared admission authority for every surface.
Desktop monthly/daily/request settings can be explicitly applied to it; automatic
chat synchronization can only tighten limits, never raise a newer engine cap.
A desktop guard is additional, not an alternative engine/provider selector.
Interrupted/unknown monetary usage is unavailable, not invented $0; invoices,
premiums, hardware and power are not guaranteed by an estimated USD threshold.

## Your data: export, import, recovery

**What Settings → General → Export contains.** The desktop app's own data
folder (the OS app-data dir for `ai.rrrtx.xr`): `xr.db` (conversations,
workspaces, the Shield audit chain, budget history), `settings.json` and
`approvals.json`. The database is copied with a consistent SQLite snapshot
(`VACUUM INTO`), so recent changes still in the write-ahead log are included.

**What it does not contain.** The desktop XR engine's separate home (`~/.xr-desktop`, or `XR_DESKTOP_HOME`):
the engine's own `xr.db` (agent memory, runs, CLI sessions), its config and
logs, and provider keys stored in the OS keychain. To back up engine data,
copy that engine home while XR is closed (`xr context export` exports
context items only). OS-store keys must be re-entered on a new machine. The sealed-file fallback contains both ciphertext and its nearby key; protect any whole-home backup as sensitive material. CLI engine data remains in `~/.xr`/`XR_HOME`, separately. Legacy plaintext settings/backups may still require rotation even after in-place cleanup.

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

## Candidate validation and development cache

Current1.1.1-rc.1 is developer-preview source, not a signed/public native release.
The renderer/type/lint and standalone engine checks were executed on Linux;
actual native GUI/IPC/OS-keychain/install/cross-version update checks require
platform runners. See the [candidate report](../docs/release/RELEASE_CANDIDATE_REPORT.md)
and [commands/evidence scope](../docs/release/VERIFICATION_COMMANDS.md).

`dev:tauri`'s `--if-missing` engine step now checks source/scripts/lock/Bun/target
fingerprint and the binary digest, not existence alone. A stale/damaged cache is
rebuilt; this is not publisher authentication. No global CLI is needed.

Unpriced hosted/custom requests need a sourced/operator-declared tariff even
with USD thresholds disabled; an unknown price is not a free provider. Merge
capability/tariff declarations into existing config rather than replacing saved
state, and do not call declared tool support authentication/agent validation.
Existing software/model hardware costs are not invented from token fees.
