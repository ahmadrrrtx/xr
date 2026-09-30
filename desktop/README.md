# XR Desktop

**XR — the AI agent you can actually trust.**

Tauri v2 + React 18 + TypeScript + Tailwind v4 (Oxide) + shadcn/ui shell.
Phase 0 scaffold: app chrome (sidebar + topbar + custom window controls),
14 placeholder routes, and the full 5-theme system (XR Native / Graphite /
Midnight / Paper / Arctic).

## Quick start

```bash
bun install          # dependencies
bun run dev          # Vite dev server (browser preview) → http://127.0.0.1:5173
bun run dev:tauri    # native shell (requires Rust toolchain)
```

## Scripts

`dev` · `dev:tauri` · `build` · `build:tauri` · `typecheck` · `lint` · `format`

## Docs

Master design docs live in [`../docs/`](../docs/) — `DESIGN-SYSTEM.md`,
`THEME-SYSTEM.md`, `SCREEN-BRIEFS.md`, `DEEP-DIVE-ARCHITECTURE.md`,
`IMPLEMENTATION-PLAN.md`. This phase's plan: `../docs/phases/00-scaffold.plan.md`.

License: MIT (repo root `LICENSE`).
