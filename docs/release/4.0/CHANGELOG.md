# XR 4.0.0 — Runtime Kernel

**Release Date:** 2026-07-22
**Codename:** Runtime Kernel
**Previous:** XR 3.1.6 (Baseline Integrity)

## Summary

XR 4.0 is a structural stabilization release that makes the runtime
trustworthy, observable, and safe to extend. No new user-facing features.
The kernel provides stable contracts for lifecycle, service ownership,
workspace rebinding, background services, health diagnostics, and error
handling.

## What's New

### Runtime Kernel

- **Explicit lifecycle state machine** with 10 states: `UNINITIALIZED`,
  `BOOTSTRAPPING`, `READY`, `STARTING`, `RUNNING`, `SWITCHING_WORKSPACE`,
  `DEGRADED`, `SHUTTING_DOWN`, `STOPPED`, `FAILED`. Validated transitions
  with deterministic idempotent behavior.

- **Structured kernel error taxonomy** (`src/core/errors.ts`) with 20+
  machine-parseable error codes. All errors extend `KernelError` and carry
  safe, serializable context metadata. No secrets in error output.

- **Kernel health model** (`src/core/health.ts`) providing structured health
  snapshots consumable by tests, CLI, and daemon APIs. Distinguishes
  `healthy`, `degraded`, `failed`, `stopped`, `starting`, and `switching`
  states.

- **`XRApp.getHealth()`** — cheap, pure health snapshot builder.

### Service Registry Enhancements

- **Kernel scope metadata** (`process`, `workspace`, `task`, `ephemeral`)
  on every registered service for diagnostics.

- **Owner metadata** tracking which provider registered each service.

- **Workspace-scoped stale protection** — stale services cannot be resolved
  after workspace switch, preventing use-after-close bugs.

- **Workspace rebinding protocol** — `markWorkspaceScopedStale()`,
  `beginRebinding()` / `endRebinding()` for safe workspace transitions.

- **Dependency cycle detection** — `detectDependencyCycles()` inspects
  the full dependency graph.

- **Inspection snapshot** — `inspectionSnapshot()` returns a non-side-effectful
  view of all registered services.

### Background Service Enhancements

- **Owner tracking** — every job declares an `owner` (service token or provider).

- **Workspace association** — jobs can be bound to a workspace and stopped
  during workspace switch.

- **Duplicate prevention** — re-registering a job ID safely replaces the old job.

- **Cancellation** — `cancelJob()` prevents restart without re-registration.

- **Failure counting** — consecutive failure tracking with automatic stop after
  5 failures.

- **Health reporting** — `getHealth()` returns aggregate counts; `listJobs()`
  returns per-job status.

### Workspace Switch Safety

- Full error handling with failure recovery at every step.
- Runtime enters `FAILED` state on switch failure (not silent partial state).
- Old store is closed before new store is opened.
- Background jobs are stopped and restarted correctly.
- `WorkspaceSwitchFailedError` records the exact failure step.

### New Events

- `kernel.failed` — emitted when the runtime enters a failed state.
- `workspace.switch_failed` — emitted with from/to/step on switch failure.

## Test Coverage

- **546 tests** across 47 test files (82 new tests)
- New test files:
  - `test/core/errors.test.ts` — kernel error taxonomy
  - `test/core/lifecycle.test.ts` — lifecycle state machine
  - `test/core/health.test.ts` — health model
  - `test/core/registry-v2.test.ts` — enhanced registry features
  - `test/core/background-services.test.ts` — background service lifecycle

## Backward Compatibility

- All existing CLI commands, flags, and output formats preserved.
- `XRKernel` facade maintained with deprecation annotations.
- All service tokens preserved.
- No database schema changes.
- No configuration schema changes.
- Workspace data fully compatible.
- Daemon API additive only.

## Known Limitations

- Event bus is in-memory only (no durable event sourcing — Phase 2+).
- Single-process runtime only (no distributed execution — Phase 2+).
- No automatic model selection (Phase 2).
- No agent isolation or containers (Phase 3).
- Health model does not perform network or disk I/O checks.

## Files Changed

### New Files
- `src/core/errors.ts` — kernel error taxonomy
- `src/core/health.ts` — kernel health model
- `docs/RUNTIME_KERNEL_ARCHITECTURE.md` — architecture guide
- `docs/MIGRATION_GUIDE_3.1.6_TO_4.0.md` — migration guide
- `docs/CHANGELOG_4.0.md` — this file
- `test/core/errors.test.ts`
- `test/core/lifecycle.test.ts`
- `test/core/health.test.ts`
- `test/core/registry-v2.test.ts`
- `test/core/background-services.test.ts`

### Modified Files
- `src/core/app.ts` — lifecycle state machine, health, workspace safety
- `src/core/kernel.ts` — forwards new XRApp methods
- `src/core/lifecycle.ts` — new states, transitions, hook results
- `src/core/service-registry.ts` — scope, stale, rebinding, inspection
- `src/core/services.ts` — owner, workspace, cancellation, failure tracking
- `src/core/event-bus.ts` — new kernel events
- `src/core/providers.ts` — kernel scope metadata on all providers
- `src/core/tokens.ts` — (no functional change, type imports only)
- `src/core/version.ts` — version 4.0.0
- `package.json` — version 4.0.0
- `test/daemon.test.ts` — version string update
- `test/baseline/doctor.test.ts` — version string update
