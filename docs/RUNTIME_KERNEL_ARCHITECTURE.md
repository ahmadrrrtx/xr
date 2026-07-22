# XR 4.0 Runtime Kernel — Architecture Guide

## Overview

XR 4.0 introduces a stable, observable **Runtime Kernel** — the platform layer that
every future capability (Unified Execution Fabric, remote execution, team messaging)
builds on top of. The kernel does not add user-facing features. It makes the existing
runtime structurally trustworthy.

## Composition Root

**`XRApp`** (`src/core/app.ts`) is the single canonical runtime composition root.

- Constructs all infrastructure: `ServiceRegistry`, `EventBus`, `CommandRegistry`,
  `LifecycleManager`, `WorkspaceManager`, `BackgroundServiceManager`.
- Owns the provider list and orchestrates the deterministic
  `bootstrap → start → shutdown` sequence.
- Exposes `getHealth()` for structured diagnostics.

**`XRKernel`** (`src/core/kernel.ts`) remains as a **backward-compatible facade**
over `XRApp`. Existing consumers (`CLI router`, workspace command, kernel tests)
continue to work unchanged. New code should use `XRApp` / `ServiceRegistry` /
`Tokens` directly.

## Service Registry

The `ServiceRegistry` (`src/core/service-registry.ts`) is a typed, token-based DI
container. Services are registered under typed `ServiceToken<T>` keys and resolved
with full type safety.

### Registration Methods

| Method | Scope | Description |
|--------|-------|-------------|
| `registerValue(token, instance, opts?)` | value | Pre-constructed instance |
| `registerSingleton(token, factory, opts?)` | singleton | Lazy, memoized factory |
| `registerTransient(token, factory, opts?)` | transient | Fresh instance per resolve |

### Registration Options

```typescript
interface RegisterOptions {
  dependsOn?: ServiceToken<unknown>[];  // lifecycle dependency ordering
  lifecycle?: boolean;                  // participates in lifecycle hooks
  description?: string;                 // human-readable description
  kernelScope?: "process" | "workspace" | "task" | "ephemeral";  // XR 4.0
  allowOverride?: boolean;              // suppress duplicate detection
  owner?: string;                       // provider that owns this service
}
```

### Dependency Ordering

Services with `lifecycle: true` are topologically sorted by `dependsOn` before
`onInit` / `onStart` / `onStop` are called. Cycles are detected at bootstrap time.

### Workspace Rebinding

Services with `kernelScope: "workspace"` are marked stale before a workspace
switch and re-registered against the new workspace store. The registry tracks
workspace-scoped tokens and supports the rebinding protocol:

```
registry.markWorkspaceScopedStale()
registry.beginRebinding()
  // providers re-register workspace services
registry.endRebinding()
```

### Stale Service Protection

After `markWorkspaceScopedStale()`, calling `resolve()` on a stale token throws
and `tryResolve()` returns `undefined`. This prevents use-after-close bugs.

## Lifecycle State Machine

The `LifecycleManager` (`src/core/lifecycle.ts`) owns a formal state machine:

```
UNINITIALIZED → BOOTSTRAPPING → READY → STARTING → RUNNING
                                                  ↕
                                               DEGRADED
                                                  ↓
                              SWITCHING_WORKSPACE ←→ RUNNING
                                                  ↓
                              SHUTTING_DOWN → STOPPED → (re-bootstrap)
                                                  ↑
                                              FAILED
```

### States

| State | Meaning |
|-------|---------|
| `UNINITIALIZED` | No providers registered |
| `BOOTSTRAPPING` | Providers registering, init hooks running |
| `READY` | Bootstrap complete, ready to start |
| `STARTING` | Start hooks running |
| `RUNNING` | Fully operational |
| `SWITCHING_WORKSPACE` | Workspace transition in progress |
| `DEGRADED` | Optional services unavailable, required services functional |
| `SHUTTING_DOWN` | Stop hooks running |
| `STOPPED` | Fully stopped |
| `FAILED` | Unrecoverable failure |

### Transition Rules

- Every transition is validated against an allow-list.
- Invalid transitions throw `LifecycleTransitionError`.
- `init()` is idempotent when already READY or RUNNING.
- `start()` is idempotent when already RUNNING.
- `stop()` is idempotent when already STOPPED.
- A failed hook during init/start transitions to FAILED.
- Stop hooks are fail-soft (errors logged, not thrown).

### Hook Results

`getHookResults()` returns a trace of every lifecycle hook invocation with
success/failure, timing, and error details. This powers health diagnostics.

## Kernel Error Taxonomy

All kernel errors extend `KernelError` (`src/core/errors.ts`) which carries:

- `code`: stable, machine-parseable error code (e.g. `SERVICE_NOT_FOUND`)
- `message`: human-readable, actionable description
- `context`: safe metadata (service ID, state, workspace, job ID)
- `cause`: original Error (standard Error property)

Error codes are grouped:

| Category | Codes |
|----------|-------|
| Lifecycle | `INVALID_LIFECYCLE_TRANSITION`, `DUPLICATE_BOOTSTRAP`, `START_BEFORE_BOOTSTRAP` |
| Registry | `SERVICE_NOT_FOUND`, `DEPENDENCY_CYCLE`, `MISSING_DEPENDENCY`, `STALE_SERVICE` |
| Workspace | `WORKSPACE_SWITCH_FAILED`, `WORKSPACE_NOT_FOUND` |
| Background | `BACKGROUND_JOB_NOT_FOUND`, `BACKGROUND_JOB_DUPLICATE` |
| Runtime | `RUNTIME_NOT_READY`, `RUNTIME_FAILED` |

## Health & Diagnostics

`XRApp.getHealth()` returns a `KernelHealth` snapshot:

```typescript
interface KernelHealth {
  timestamp: number;
  status: "healthy" | "degraded" | "failed" | "stopped" | "starting" | "switching";
  runtimeState: string;
  version: { version, codename, display };
  bootstrapped: boolean;
  started: boolean;
  services: ServiceHealthEntry[];      // readiness per service
  backgroundJobs: BackgroundJobHealthEntry[];  // job state per job
  workspace: WorkspaceHealthEntry;     // active workspace, store state
  config?: ConfigHealthEntry;          // config warnings
  errors?: KernelErrorContext[];       // accumulated errors
  summary?: string;                    // one-line human summary
}
```

### Health Status Derivation

| Condition | Status |
|-----------|--------|
| Runtime STOPPED or UNINITIALIZED | `stopped` |
| Runtime FAILED | `failed` |
| Runtime SWITCHING_WORKSPACE | `switching` |
| Runtime BOOTSTRAPPING or STARTING | `starting` |
| Any required service failed | `failed` |
| Any optional service degraded | `degraded` |
| All services ready | `healthy` |

Health never claims the system is healthy when a required store/service is
unavailable.

## Workspace Lifecycle

Workspace switching (`XRApp.switchWorkspace(id)`) follows a safe sequence:

1. Stop workspace-bound background jobs
2. Get old store reference (before marking stale)
3. Mark workspace-scoped services stale
4. Close old store
5. Activate new workspace in WorkspaceManager
6. Re-run workspace-scoped providers (register + init)
7. Refresh lifecycle participants
8. Restart background jobs

At any step, failure is caught, the runtime enters FAILED state, the error is
recorded, and a `WorkspaceSwitchFailedError` is thrown. Old workspace data is
never silently reused.

## Background Services

`BackgroundServiceManager` (`src/core/services.ts`) manages interval-based jobs:

- Each job has `id`, `name`, `intervalMs`, `run()`, `owner?`, `workspaceId?`
- Duplicate registration replaces the old job (safe replacement)
- Jobs track failure count and last error
- After 5 consecutive failures, the job stops scheduling
- `cancelJob()` prevents restart without re-registration
- `stopWorkspaceJobs()` stops only workspace-bound jobs (for switch)
- `getHealth()` returns aggregate counts

## Provider Model

Providers (`src/core/providers.ts`) declare services and their dependencies.
Each provider has:

- `id`: unique identifier
- `register(ctx)`: synchronous registration
- `init?(ctx)`: optional async initialization
- `workspaceScoped?`: whether to re-run on workspace switch

The default provider order:

1. State → Config → Providers → Budget → Plugins → MCP → Skills
2. Agent → MultiAgent → Shield → Business

## Token Catalog

All service tokens are declared in `src/core/tokens.ts`. Never declare ad-hoc
tokens elsewhere. Tokens are type-safe and carry their service type.

## Adding a Service

1. Create the service class implementing `LifecycleHook` (optional)
2. Add a `ServiceToken<T>` to `tokens.ts`
3. Create or update a `ServiceProvider` in `providers.ts`
4. Register with `ctx.registry.registerSingleton(token, factory, { dependsOn, lifecycle, kernelScope, owner })`
5. Add tests

The bootstrap sequence never needs to change.

## Phase 1 Non-Goals

- No unified execution fabric (Phase 2)
- No model/provider routing redesign
- No agent isolation or containers
- No durable event sourcing
- No remote/distributed infrastructure
- No new business modules
- No database schema migration
