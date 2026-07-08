# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
