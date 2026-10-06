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

## Scripts

`dev` · `engine` · `dev:tauri` · `build` · `build:tauri` · `sidecar` · `typecheck` · `lint` · `format`

## Docs

Master design docs live in [`../docs/`](../docs/) — `DESIGN-SYSTEM.md`,
`THEME-SYSTEM.md`, `SCREEN-BRIEFS.md`, `DEEP-DIVE-ARCHITECTURE.md`,
`IMPLEMENTATION-PLAN.md`. This phase's plan: `../docs/phases/00-scaffold.plan.md`.

License: MIT (repo root `LICENSE`).
