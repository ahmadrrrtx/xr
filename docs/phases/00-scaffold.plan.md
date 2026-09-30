# Phase 0 — Repo Cleanup + Scaffold Plan

**Agent:** Phase 0 scaffold agent · **Date:** 2026-09-30 · **Status:** executing
**Source of truth:** `docs/DESIGN-SYSTEM.md`, `docs/THEME-SYSTEM.md`, `docs/SCREEN-BRIEFS.md`, `docs/DEEP-DIVE-ARCHITECTURE.md`, `docs/IMPLEMENTATION-PLAN.md` (PRE-PHASE section).

---

## 0. Reality vs. brief — decisions locked with Ahmad

The agent brief assumed a bare repo at `/home/user/xr` with the app at root. The actual
repo (`ahmadrrrtx/xr` @ `710d00e`, PR #136) is a mature monorepo:

- **Root** = XR engine/CLI (`@rrrtx/xr` 1.0.0): 46-dir `src/`, skills, plugins, tests, CI gates.
- **`desktop/`** = old "V2 Operator" Tauri v2 app: React 19, no Tailwind, no shadcn/ui,
  no router, IBM Plex/Space Grotesk fonts, 19 screens — **contradicts the new master plan stack**.
- Master docs in the workspace: only 5 of 12 exist (missing: SCREEN-MAP, MASTER-PLAN,
  MASTER-BUILD-PROMPT, ALL-TOOLS-LIST, V2-BLUEPRINT, SIMPLE-GUIDE, REVIEW).

**Ahmad's decisions (2026-09-30):**
1. New scaffold **replaces `desktop/` in-place** (design system itself references `desktop/public/fonts/`).
2. Old desktop app is preserved on a **`legacy/desktop-v2` git branch**, then removed from the working tree.
3. Root engine/CLI **untouched except** the minimal wiring that keeps CI green after `desktop/` is replaced.
4. Rust: install toolchain in sandbox and **`cargo check`** the new shell (full bundle verified on Ahmad's machine).

## 1. Research summary (Step 2 findings)

- Tauri v2 plugin install = `bun tauri add <name>` (auto) or manual: cargo crate + `@tauri-apps/plugin-*` npm pkg + init in `lib.rs`. We wire manually with pinned versions (sandbox determinism): tauri 2.12.0, tauri-build 2.7.0, plugins at current 2.x.
- Tailwind v4 theme = CSS-first: `@import "tailwindcss"` + **`@theme inline { --color-x: var(--x) }`** so utilities emit `var(--x)` and `[data-theme]` attribute swaps cascade instantly (confirmed by Tailwind team discussions #15199/#15600). No `tailwind.config.js`.
- shadcn/ui on Vite: `components.json` + `bunx shadcn@latest add <component>`; components are vendored source (MIT). New-York/neutral tokens will be remapped onto XR tokens so all 11 components are theme-aware.
- Custom titlebar: `decorations: false` + `data-tauri-drag-region` on the 52px topbar + custom traffic lights (macOS layout) / min-max-close (Win/Linux) calling `getCurrentWindow()`; app-defined Rust commands need no capability grants; `data-tauri-drag-region` needs `core:window:allow-start-dragging`.
- Fonts: woff2 only, `font-display: swap`, `crossorigin` preload of first-paint faces, variable fonts (1 file per family), OFL licenses + SHA256SUMS manifest shipped in-repo.
- Transparent/always-on-top windows verified possible for the future orb (`transparent`, `decorations: false`, `alwaysOnTop`, `skipTaskbar`) — not built this phase.
- Licenses: every dep MIT / Apache-2.0 / ISC / SIL-OFL. No AGPL, no CC-BY-NC.
- Version reality check: React 18.3.1 (brief mandates 18), Vite 8.x, TS 5.x (7.0 is the new Go build — too bleeding-edge for the ecosystem; pinned ~5.9), tailwindcss 4.3.x, react-router-dom 7.18.x, zustand 5, TanStack Query 5, eslint 9/10 + typescript-eslint 8.

## 2. Files

### Created (inside `desktop/` unless noted)
- `desktop/package.json`, `desktop/bun.lock`, `desktop/tsconfig.json`, `desktop/vite.config.ts`
- `desktop/index.html`, `desktop/public/theme-init.js` (pre-paint theme, CSP-safe)
- `desktop/public/fonts/` — inter-latin-wght.woff2, jetbrains-mono-latin-wght.woff2, orbitron-latin-700-normal.woff2 + OFL licenses + SHA256SUMS
- `desktop/public/favicon.svg` (simple cyan X placeholder mark)
- `desktop/src/main.tsx`, `App.tsx`, `router.tsx`
- `desktop/src/styles/globals.css`, `desktop/src/styles/themes.css` (all 5 themes + `@theme inline` mapping + shadcn aliases + traffic-light vars)
- `desktop/src/stores/theme.ts` (Zustand: current theme, set, cycle, localStorage)
- `desktop/src/lib/utils.ts` (cn), `desktop/src/lib/tauri.ts` (isTauri, platform, window controls, theme emit)
- `desktop/src/hooks/usePlatform.ts`, `desktop/src/hooks/useThemeShortcut.ts`
- `desktop/src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `WindowControls.tsx`, `ErrorBoundary.tsx`
- `desktop/src/components/ui/` — shadcn: button, input, card, dialog, tooltip, dropdown-menu, switch, tabs, separator, skeleton, badge
- `desktop/src/components/brand/.gitkeep` (Phase 2)
- `desktop/src/screens/{Chat,Brain,Workspaces,Builder,Research,Agents,SkillsStore,Shield,Runs,Memory,Budget,Integrations,Voice,Settings}/index.tsx`
- `desktop/src/screens/Settings/_dev/ThemeToggle.tsx` (dev theme cycler UI)
- `desktop/src-tauri/` — `Cargo.toml`, `tauri.conf.json`, `build.rs`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`, `src/commands/mod.rs`, `src/commands/window.rs`, `src/events.rs`, `src/tray.rs`, `icons/` (preserved from old app — generated from the official avatar render per D-05)
- `desktop/.eslintrc` → `eslint.config.js`, `prettier.config.js`, `components.json`, `.vscode/extensions.json`, `README.md` (<30 lines)
- `desktop/previews/refinement/00-scaffold-app-shell.png`, `desktop/previews/implementation/phase-00/*.png`
- Root: `docs/phases/00-scaffold.plan.md` (this file) + 5 master docs copied into `docs/`

### Modified (root, minimal wiring only — each documented in the PR)
1. `package.json` — `typecheck`: point second leg at new `desktop/tsconfig.json`; remove `desktop:fonts-check` + `desktop:brand-check` from `ci` chain and as scripts (they encode the retired design-system-v3 rules: IBM Plex fonts, `src/assets/fonts` layout, Inter ban — all superseded by the new master docs). `desktop:sink-lint` (generic XSS sink gate) **kept**.
2. Delete `scripts/desktop-fonts-check.ts`, `scripts/desktop-brand-check.ts` (git history + `legacy/desktop-v2` preserve them).
3. Delete old-app root tests: `test/desktop/{boot,brand-check,countdown,fonts-check,poll}.test.ts` (they import deleted old desktop modules). `test/desktop/sink-lint.test.ts` kept if fixture-based (verify).
4. `.github/workflows/ci.yml` — typecheck step description only (it runs `bun run typecheck`).
5. `.github/workflows/desktop-app.yml` — leave as-is: cargo check/clippy `-D warnings`/test/tauri-action stay authoritative for the new shell; sidecar steps still pass without `externalBin` (engine builds + smoke-tests independently; re-attached in Phase 14).
6. Root `README.md` — add a short pointer block to `docs/` master docs + `desktop/` (no rewrite).
7. `.gitignore` — unchanged (already covers `desktop/src-tauri/target`, `desktop/dist`, `desktop/node_modules`, `gen/schemas`).

### Deleted
- Entire old `desktop/` tree except `src-tauri/icons/` (brand icons preserved) — recoverable on `legacy/desktop-v2`.

## 3. Folder structure (produced)

```
xr/
├── docs/                     # engine docs (existing) + master docs (new) + phases/
├── desktop/
│   ├── public/fonts/         # woff2 + OFL + SHA256SUMS
│   ├── public/favicon.svg
│   ├── src/
│   │   ├── screens/…14 dirs…/index.tsx
│   │   ├── components/{ui,brand,layout}/
│   │   ├── stores/theme.ts
│   │   ├── hooks/
│   │   ├── lib/{utils,tauri}.ts
│   │   ├── styles/{globals,themes}.css
│   │   ├── App.tsx  main.tsx  router.tsx
│   ├── src-tauri/
│   │   ├── src/{main.rs, lib.rs, commands/{mod,window}.rs, events.rs, tray.rs}
│   │   ├── capabilities/default.json
│   │   ├── icons/            # preserved official-render icons
│   │   ├── Cargo.toml  tauri.conf.json  build.rs
│   ├── package.json  tsconfig.json  vite.config.ts  components.json
│   ├── eslint.config.js  prettier.config.js  index.html
│   ├── .vscode/extensions.json  README.md  previews/
├── (engine/CLI at root — untouched)
```

## 4. Components

- **AppShell**: `h-screen flex-col`; Topbar (52px) → row(Sidebar 72px, `<Outlet/>` scroll region p-6).
- **Sidebar**: 72px, `bg-bg-ink`, right `border-subtle`; "XR" wordmark (`font-display text-accent`); 14 nav buttons in fixed order (MessageCircle, Brain, Folder, Hammer, Search, Rocket, ShoppingBag, ShieldCheck, Clock, Database, Wallet, Plug, Mic, Settings), 20px icons @1.5 stroke, 44px hit targets, active `text-accent`, idle `text-secondary`, hover `text-primary`, `aria-label` + `title`.
- **Topbar**: 52px `bg-bg-void`, `border-b border-subtle`, drag region; left screen name (18px semibold, offset for traffic lights); right Wallet/Mic/Bell 32px ghost buttons + 28px avatar circle with cyan dot.
- **WindowControls**: platform-aware — macOS traffic lights (12px circles, 20px inset, centered in 52px) / Windows+Linux right-side min/max/close (40px tall). Hidden in plain browser. Calls Rust commands via `invoke` (fallback to `@tauri-apps/api/window`).
- **Placeholder screens**: centered card `bg-bg-ink border border-subtle rounded-lg p-8 max-w-md mx-auto my-20` — icon, name (24px bold), "Coming in Phase N" (text-tertiary caps), 1-line description.
- **Settings**: placeholder + dev `ThemeToggle` (5 swatch buttons + active label + shortcut hint).
- **ErrorBoundary**: class boundary, minimal themed fallback, `console.error` retained.

## 5. Zustand stores

`useThemeStore` only: `{ theme: ThemeId, setTheme(id), cycleTheme() }`; persists to `localStorage['xr.theme']`; applies `document.documentElement.dataset.theme`; `THEMES`/`THEME_LABELS` exported. Pre-paint apply via `public/theme-init.js` (no FOUC, CSP-safe).

## 6. Tauri commands (src-tauri/src/commands/window.rs)

`minimize_window`, `toggle_maximize`, `close_window`, `get_platform` (+ `emit_theme_changed` helper in `events.rs`). Capability grants: `core:default`, `core:window:allow-start-dragging`, `core:window:allow-minimize|toggle-maximize|close`, `os:default`. All 14 plugins compiled + initialized in `lib.rs` (permissions granted later per-phase). Tray: minimal "Show XR"/"Quit" with preserved icon.

## 7. Theme CSS approach

`themes.css`: `:root, html[data-theme="xr-native"]` + 4 more `html[data-theme=…]` blocks with the FULL token set from `xr-THEME-SYSTEM.md` (23 tokens each). Then one `@theme inline` maps every token into Tailwind (`bg-bg-void`, `text-accent`, `border-subtle`, `font-mono`, `font-display`, radii 4/8/12/16). shadcn semantic vars (`--background`, `--foreground`, `--primary`, `--ring`, …) aliased onto XR tokens per theme so all shadcn components adapt. Traffic-light colors as CSS vars. Transition: `background-color/color/border-color/box-shadow 200ms ease` (no transform/opacity), disabled under `prefers-reduced-motion`.

## 8. Fonts

Inter variable latin (covers 400–700), JetBrains Mono variable latin (400–500), Orbitron 700 static — woff2 from @fontsource (SIL OFL), shipped with licenses + SHA256SUMS. `@font-face` + `font-display: swap` in themes.css; `<link rel="preload" crossorigin>` for Inter + Orbitron (first paint); JBM lazy.

## 9. Verification checklist — RESULTS (2026-09-30)

| # | Check | Result |
|---|---|---|
| 1 | `bun install` clean (desktop + root) | ✅ |
| 2 | `tsc --noEmit` zero errors (desktop + via root `typecheck`) | ✅ |
| 3 | `eslint .` zero errors/warnings | ✅ |
| 4 | `prettier --write` stable, no drift | ✅ |
| 5 | `vite build` succeeds (TS + bundler clean) | ✅ 314 KB js / 43 KB css |
| 6 | All 14 routes render; nav click-through; active icon cyan | ✅ headless Chromium, 23/23 automated checks |
| 7 | `Cmd/Ctrl+Shift+T` cycles all 5 themes, wraps, persists | ✅ automated |
| 8 | No unthemed surfaces; per-theme chrome colors distinct | ✅ pixel-sampled screenshots match each theme's `--bg-void` exactly |
| 9 | Resize 960→1600 px: sidebar constant 72px, no h-scroll | ✅ automated |
| 10 | Zero console errors/warnings; zero failed requests; favicon ok | ✅ |
| 11 | Inter + JetBrains Mono + Orbitron load (`document.fonts.check`) | ✅ |
| 12 | Rust: `cargo check --all-targets` · `clippy -D warnings` · `test --lib` 3/3 | ✅ on Linux + webkit2gtk 4.1 (3 fixes surfaced and applied) |
| 13 | Root gates: `typecheck` · `desktop:sink-lint` (42 files, 0 violations) · `claim-lint` · `release:check` · `bun test` 3372 pass / 0 fail · ownership map regenerated | ✅ |
| 14 | 5 theme screenshots → `previews/implementation/phase-00/` | ✅ |

Not verifiable in this sandbox (needs a native desktop): clicking the real window
controls and the full `tauri build` installer matrix — the window-control commands
compile and the CI `desktop-app.yml` lane (cargo check/clippy/test + 3-OS bundle)
runs on the PR.

## 10. Out of scope (explicit)

Chat logic, avatar SVG, logo SVG, splash, onboarding, HUD, command palette wiring, Companion Orb, real settings, real backend/engine wiring, data persistence beyond theme localStorage, Zustand stores beyond theme, glow/heavy animation, Tailwind v3, Electron, Google Fonts CDN, AGPL deps.
