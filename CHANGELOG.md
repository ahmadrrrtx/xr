# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.5] - 2026-07-09

### Added
- **Final dashboard consistency pass**: overview cards now wire real security and local-runtime data into Mission Control instead of leaving placeholder values.
- **Live chat header runtime label**: dashboard chat now reflects the active provider/model instead of static copy.
- **Expanded TUI quick commands**: added shell-friendly access patterns for `/home`, `/palette`, `/notifications`, and `/quick`.
- **Release prep notes**: final 3.1 polish workstream documented in a dedicated release note.

### Changed
- **System Status panel** now shows real provider health and real local runtime state.
- **Dashboard overview** now surfaces security score and local runtime summary from live APIs.
- **XR 3.1 polish track documentation** is now reflected in the changelog for clearer release history.

## [3.1.4] - 2026-07-09

### Added
- **Runtime & Research Cockpit Pass**: upgraded Models and Research panels into live Mission Control surfaces.
- **Local runtime APIs**: added dashboard-safe runtime inspection, selection, and smoke-test endpoints.
- **Research read APIs**: added dashboard-friendly recent/latest research endpoints and session detail fetches.
- **TUI summary ergonomics**: `/budget`, `/models`, and `/research` now provide immediate shell-side summaries.

## [3.1.3] - 2026-07-09

### Added
- **Budget & Usage Cockpit Pass**: Mission Control now includes a dedicated budget surface with spend controls, recent cost events, and provider/model usage views.
- **Budget APIs**: added backend routes for live budget/usage snapshots and dashboard-driven setting updates.

## [3.1.2] - 2026-07-09

### Added
- **Sessions Mission Control Pass**: dashboard now exposes recent sessions, execution steps, audit detail, and recent research runs as a first-class product surface.
- **Session detail APIs**: added local endpoints for session lookup, step history, and session-scoped audit inspection.

## [3.1.1] - 2026-07-09

### Added
- **Provider & Workspace Mission Control Pass**: dashboard can now create/switch workspaces and edit provider routing directly.
- **Workspace persistence**: active workspace selection now survives relaunches.

## [3.1.0] - 2026-07-09

### Added
- **Fullscreen XR shell by default**: `xr` now opens a dedicated terminal workspace instead of a lightweight help-first posture.
- **Dedicated onboarding flow**: `xr onboarding` now routes to the product onboarding experience directly.
- **Richer Mission Control backend**: overview, provider, workspace, and config surfaces now return live product state suitable for dashboard use.
- **Offline-safe website preview improvements**: local branding assets and fewer remote preview dependencies.

## [3.0.0] - 2026-07-08

### Added
- **Unified XR Kernel (`XRKernel`)**: Central dependency injection container (`Container`), event-driven backbone (`EventBus`), and sequential boot sequence coordinator (`LifecycleManager`).
- **Workspace Model (`WorkspaceManager`)**: Multi-tenant data segregation partitioning local SQLite connections and `.env` overlays under `~/.xr/workspaces/`.
- **Background Service Manager (`BackgroundServiceManager`)**: Out-of-band threat scanner (LOLBins/LOLBAS), budget governor, and memory prune loop.
- **`/api/agents` & `/api/agents/workflows/:id` Routes**: Deployed missing endpoints on the local daemon server for real-time workflow tracking on the Vercel dashboard.
- **`WorkspaceCommand`**: Implemented `xr workspace [list|create|use|delete]` commands on the CLI.

### Fixed
- **Pipeline Statistics Query Bug**: Patched SQLite syntax error in `src/business/core/pipeline.ts` won/lost calculations.
- **CI Test Suite Compatibility**: Added `XR_CONTROL_FORCE_TEST` bypass flag in `src/control/service.ts` to allow local-first dry-run test flows in sandboxed test runs.
- **Ecosystem MCPAssertion Compatibility**: Aligned boxed client strings with direct primitive comparisons.

### Changed
- Config Migration Schema updated to v12 (Voice Stack + Core OS compatibility).
