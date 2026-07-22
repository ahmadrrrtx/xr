# XR 3.1.6 → 4.0 Migration Guide

## Summary

XR 4.0 (Runtime Kernel) is a backward-compatible structural stabilization release.
No user-facing behavior changes. No data migration required. No configuration changes
required.

## What Changed

### Internal (developer-facing)

| Component | Change | Breaking? |
|-----------|--------|-----------|
| `RuntimeState` enum | Added `STARTING`, `SWITCHING_WORKSPACE`, `DEGRADED`, `FAILED` states | No — existing states unchanged |
| `ServiceRegistry` | Added `kernelScope`, `owner`, `stale` metadata fields | No — additive |
| `BackgroundServiceManager` | Added owner tracking, workspace association, failure counting | No — additive |
| `XRApp` | Added `getHealth()`, `getState()`, `isReady()`, `isBootstrapped()`, `isStarted()` | No — additive |
| `XRKernel` | Forwards new `XRApp` methods | No — additive |
| `EventBus` | Added `KernelFailed`, `WorkspaceSwitchFailed` events | No — additive |
| `LifecycleManager` | Added `enterWorkspaceSwitch()`, `exitWorkspaceSwitch()`, `markDegraded()`, `getHookResults()` | No — additive |
| New: `src/core/errors.ts` | Structured kernel error taxonomy | No — new file |
| New: `src/core/health.ts` | Kernel health snapshot model | No — new file |
| Lifecycle hook errors | Now wrapped in `LifecycleHookFailedError` (original error is `cause`) | Minor — `error.message` changes |

### User-facing

| Surface | Change | Impact |
|---------|--------|--------|
| Version string | `3.1.6` → `4.0.0` | Display only |
| Codename | `Baseline Integrity` → `Runtime Kernel` | Display only |
| `xr doctor --json` | Version field updated | JSON consumers see `4.0.0` |
| Daemon `/api/health` | Version field updated | API consumers see `4.0.0` |

## Data Safety

- **No database schema changes.** Existing workspace databases open unchanged.
- **No configuration schema changes.** Existing `config.json` files load without modification.
- **No workspace path changes.** Existing workspace directories and database paths are preserved.
- **No secret changes.** Provider keys and environment variables are unchanged.

## Workspace Compatibility

Existing workspaces (including the `default` workspace) open under XR 4.0 exactly
as they did under 3.1.6. If a workspace has an invalid state, XR reports a repair
path rather than silently rewriting it.

## CLI Compatibility

All existing CLI commands, flags, and output formats are preserved. The `xr doctor`
and `xr status` commands now expose richer kernel health information but maintain
backward-compatible JSON schemas.

## Daemon Compatibility

- Localhost binding: unchanged
- Token authentication: unchanged
- Health endpoint response: additive (new version field)
- Dashboard HTML: additive (new health display)

## Deprecations

| API | Status | Replacement |
|-----|--------|-------------|
| `XRKernel.VERSION` | Deprecated, kept for compat | Use `CORE_VERSION` from `src/core/version.ts` |
| `XRKernel.container` | Deprecated, kept for compat | Use `XRKernel.registry` |
| `XRKernel.services` | Deprecated, kept for compat | Use `XRKernel.backgroundServices` |

## Rollback

To roll back to XR 3.1.6:

1. `git checkout 874760e` (the Phase 0 baseline commit)
2. `bun install --frozen-lockfile`
3. `bun test` to verify

No data rollback is needed — 4.0 does not modify workspace databases.

## Breaking Change in Error Wrapping

The `LifecycleManager` now wraps lifecycle hook errors in `LifecycleHookFailedError`
(a subclass of `KernelError`). The original error is available via `error.cause`.

If your code catches lifecycle errors and checks `error.message` for exact string
matches against the original hook error, update to check `error.cause.message`:

```typescript
// Before
try { await lifecycle.init(); }
catch (e) { if (e.message === "my error") ... }

// After
try { await lifecycle.init(); }
catch (e) {
  const original = e.cause ?? e;
  if (original.message === "my error") ...
}
```

This only affects code that directly catches lifecycle init/start errors and
inspects the message string. Most code does not do this.
