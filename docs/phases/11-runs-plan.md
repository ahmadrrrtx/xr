# Phase 11 · Runs / Control Room — implementation plan

Branch: `phase/11-control-room` (from `main`).

## Data model (`desktop/src/brain/types.ts`)
- `RunStatus = 'running' | 'completed' | 'failed' | 'killed' | 'waiting'`
- `RunSummary { id, shortId, title, agent, agentKind, workspace?, workspaceId?, model, status, startedAt, endedAt, durationMs, tokensIn, tokensOut, costUsd, errorSummary?, surface, archived? }`
- `AgentKind = 'chat' | 'builder' | 'research' | 'voice' | 'background'`, `RunSurface = AgentKind | 'cli'`.
- `BrainUpdate` gains `run-status` (waiting/killed transitions) so other windows see the yellow dot.

## Pure core (`desktop/src/runs/`)
- `core.ts` — `applyFilters(runs, filter, search, range, now)`, `sortRuns(list, sort, now)`, `aggregate(runs, now)`, `surfaceCounts`, `runDuration(run, now)`, `toCsv(rows, now)`, `toJson(rows)`, `fmtStarted(ts, now)`, `exportFilename(ext, now)`, `chartRunsPerHour/CostPerDay/TokensByModel`. Unit-tested from the root tier.
- `seed.ts` — `seedMockHistory(now, opts?)` deterministic (`rngFrom('xr-runs-seed-v1')`), 5 canned Brain flavours + ~60 generated; `seedStress(n)` dev-only 10k generator.
- `events.ts` — `RunEvent` union (`run-started | run-updated | run-completed | run-failed | run-killed | run-waiting`) + `summaryFromRun(run)` projection (agentKind/surface inferred from agent + title).

## Store (`desktop/src/stores/runsStore.ts`)
State: `runs`, `order` (ids by startedAt desc, maintained incrementally), `statusFilter`, `search`, `dateRange`, `sort`, `chartsOpen`, `selectedId`, `loading`, `error`, `clock`, `listVersion`, `recentlyChanged` (id → kind + ts for flash/shake), `stopDialog` (`null | {kind:'all'} | {kind:'one', id}`).
Actions per brief §2: `load`, `tick`, `applyEvent`, `upsertFromBrain`, `setStatusFilter`, `setSearch`, `setDateRange`, `setSort`, `toggleCharts`, `select`, `requestKill`, `requestKillAll`, `kill`, `killAll`, `retry`, `archive`, `exportCsv`, `exportJson`, `startDemoRun`, `seedStress` (dev), `reseed` (dev).
Selectors: `useFilteredIds()` (memo on listVersion/filter/sort/search/range/clock-bucket), `useRunsStats()`, `useInProgressCount()` (topbar).
Bridge module `runs/bridge.ts`: `initRunsBridge()` — brainStore subscription, Tauri listeners, global ticker (500 ms on `/runs`, 2 s elsewhere while in progress). Called once from `AppShell`.

## Rust (`desktop/src-tauri/src/commands/runs.rs`)
- `list_runs() -> Vec<RunSummary>` (empty: the TS seed is the Phase 11 source; the shape is the Phase 14 contract).
- `cancel_run(app, id)` → emits `run:cancelled { ids:[id], reason }`.
- `bulk_cancel_runs(app, ids, reason)` → one `run:cancelled` with all ids.
- Unit tests for payload shaping. Registered in `lib.rs` + `commands/mod.rs`.

## Screen (`desktop/src/screens/Runs/`)
- `index.tsx` — layout shell: sticky header (title row + filter row + surface chips), stats bar, table, charts; URL params (`status`, `action=stop-all`); screen-scoped keys (`/ ↑ ↓ Enter Space ← → Delete S E C R Esc 1–5`, `⌘⇧.`); empty/loading/error/filter-empty states; StopDialog host.
- `components/`: `Header.tsx` (title, StopAllButton, FilterTabs, SearchInput, RangeSelect, ExportMenu, ChartsToggle, DemoRunButton), `SurfaceChips.tsx`, `StatsBar.tsx` (tween numbers), `RunsTable.tsx` (react-window `List`, ARIA grid, sticky header, sortable headers w/ aria-sort), `RunRow.tsx` (memo; status icon, id w/ copy, title, agent chip, workspace, model, started, duration tick, tokens, cost, actions; context menu + ⋯ menu), `StopDialog.tsx` (AlertDialog, reason textarea), `Charts.tsx` (RunsPerHour bar, CostPerDay area, TokensByModel donut, totals line), `EmptyState.tsx`, `SkeletonRows.tsx`.
- `ui/alert-dialog.tsx`, `ui/context-menu.tsx` (shadcn-style wrappers over `radix-ui`).

## Cross-surface wiring
- `lib/nav.ts`: `runs` → label "Control Room", icon `Activity`, moved above Shield.
- `components/layout/Topbar.tsx`: `ActivityDot` (left of bell) — pulsing when in progress, tooltip "N runs in progress", click → `/runs?status=running`.
- `lib/paletteCommands.ts`: "Control Room: Stop all runs" (`/runs?action=stop-all`), "Control Room: View running", "Control Room: View failed runs", "Go to Control Room".
- `stores/brainStore.ts`: `loadRun` summary path; `run-status` emits on waiting/killed; `run:cancelled` Tauri listener → `stopRun`.
- `stores/chatStore.ts`: first `tool_call` of a turn starts (or reuses) a short demo run so a row exists; `ToolCallCard.openTrace` unchanged.
- `screens/Brain/index.tsx`: completion summary gets "See all runs →"; index "Recent runs" reads from runsStore (newest 10) so both directions agree.
- `screens/WorkspaceLanding.tsx`: "Open Control Room →" link in the runs strip.
- `styles/themes.css`: per-theme `--chart-1..6`, `--agent-*` tokens; `styles/globals.css`: row flash/shake/strike keyframes, running tint, light-theme solid running border, reduced-motion fallbacks.
- `App.tsx` / `AppShell.tsx`: `initRunsBridge()` once.

## Test
- `bun run typecheck`, `bun run lint`, `bun test test/desktop/runs-core.test.ts`, sink-lint.
- Playwright (chromium) against `vite dev`: seed renders (~64 rows), tabs/counts, search, range, sort, demo run → live row at top + tick + waiting (approval modal) + completion, kill one, STOP ALL, export CSV/JSON (file content), keyboard map, charts, 5 themes, reduced motion, 10k stress scroll, topbar dot, palette commands, empty state (`?seed=none` dev param).
- Screenshots → `previews/implementation/phase-11/` (+ copy to `/home/user/previews/implementation/phase-11/`).

## PR
`feat(runs): control room with live virtualized table, emergency stop, charts, export` — summary, screenshots, test steps, out-of-scope, @ahmadrrrtx. No self-merge.
