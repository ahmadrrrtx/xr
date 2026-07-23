# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.1.0] - 2026-07-22 — Unified Execution Fabric

### Added
- **Canonical execution contract** (`src/execution/`): one typed lifecycle for every
  consequential action (intent → plan → policy → placement → action → observation →
  evidence/artifact → outcome).
- **Bounded state machine** (`src/execution/state-machine.ts`) validating all
  transitions deterministically, with distinct states for approval, budget block,
  cancellation, timeout, partial completion, and reconciliation.
- **`ExecutionService`** registered workspace-scoped under `Tokens.Execution` via the
  Phase 1 kernel. Coordinates policy/approval/budget, timeout, cancellation,
  retry, idempotency/caching, cost charging, and persistence without duplicating
  existing gates.
- **`ExecutionRepo`** with additive `execution_records` table (redacted/truncated
  payloads, workspace/session/workflow indexes, bounded history).
- **Adapters** for agent/model turns, core tools, control/computer actions, MCP
  tools/resources/prompts, plugin/skill operations, workflow tasks, research and
  business actions — all preserving existing `AgentResult`/`ToolResult`/
  `ActionResult` compatibility.
- **Idempotency model**: `naturally_idempotent | idempotent_with_key |
  non_idempotent | unknown_unsafe` with duplicate suppression and honest
  reconciliation for unknown side effects.
- **Cancellation/timeout/retry semantics** cooperative and honest — never silently
  retries non-idempotent actions when side effects are unknown.
- **Safe inspection** (`src/execution/inspection.ts`) and `xr execution` CLI
  command for bounded secret-free execution history.
- **Phase 2 documentation**: `docs/EXECUTION_FABRIC.md`,
  `docs/MIGRATION_GUIDE_4.0_TO_4.1.md`, validation report.

### Changed
- Version identity updated to `4.1.0 (Unified Execution Fabric)` across
  package/runtime/website surfaces.
- Workspace store migration adds `execution_records` and its indexes additively;
  no existing data is modified.
- Execution events are added to the existing audit log (correlated, not
  duplicated).

### Compatibility
- All Phase 0/1 tests remain green (546 → 577 passing with 31 new fabric tests).
- Existing agent, tool, control, MCP, plugin, skill, workflow, research, and
  business APIs are unchanged at the type level; canonical records are additive.
- Cost is charged exactly once per operation; no duplicate model/tool calls.

### Security
- Existing approval, budget, egress, audit, plugin/MCP permission gates are
  preserved — the fabric records and correlates them, never bypasses them.
- Execution records redact secrets and bound payloads; no credentials, full
  prompts, arbitrary binary data, or full browser pages are persisted.
- **Explicit limitation**: in-process execution is not a Phase 3 sandbox. Phase 3
  Trust and Isolation adds enforceable isolation for high-risk operations.

## [4.0.0] - 2026-07-22 — Runtime Kernel
- Stable XR 4.0 Runtime Kernel baseline (commit `c563ff3`); see Phase 1
  validation report.

## [3.1.6] - 2026-07-22

### Added
- **Phase 0 verified baseline artifacts** under `docs/release/3.1.6/`: source-derived inventory, support matrix, validation report, baseline measurements, release notes, release checklist, audit/design review, and rollback guide.
- **Baseline validation scripts**: `baseline:inventory`, `baseline:validate`, and `baseline:measure` for reproducible local release evidence.
- **Stable doctor JSON schema** (`schemaVersion: 1`) reporting version, environment, workspace/database status, redacted configuration, summary, and health checks.
- **Daemon health metadata**: `/api/health` now includes version, localhost binding, and auth-policy metadata for smoke validation.
- **Bun tool pin file** `.bun-version` set to `1.3.14`.

### Changed
- Version identity updated to `3.1.6 (Baseline Integrity)` across package/runtime/website surfaces.
- `xr doctor` and system status set a nonzero exit code when required baseline checks fail, while optional provider/local-runtime/browser/voice/control warnings remain non-fatal.
- Docker default command now starts `xr serve --port 7842`, matching the exposed and compose-mapped port.
- Documentation now distinguishes current verified implementation from roadmap intent, including process-local runtime, in-memory event bus, local daemon/dashboard, and security/isolation limitations.

### Compatibility
- No workspace database schema migration is introduced by 3.1.6.
- Public package name, bin name, existing CLI command names, daemon token behavior, provider configuration, memory consent behavior, budget checks, and plugin/skill/MCP compatibility are preserved.

### Known limitations
- Linux x64 with Bun 1.3.14 is the verified environment for this release artifact; macOS/Windows require separate validation before being claimed verified.
- Cloud providers, local model runtimes, browser automation, voice, and desktop control remain optional/environment-dependent.
- XR 4.0 Runtime Kernel, durable event sourcing, container/VM isolation, unified execution fabric, and enterprise control-plane architecture are explicitly deferred.

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
