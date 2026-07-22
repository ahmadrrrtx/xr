# XR 3.1.6 — Baseline Integrity Release

XR 3.1.6 is a Phase 0 release. It does not add the XR 4.0 Runtime Kernel or later roadmap architecture. The release makes the current XR repository more truthful, measurable, diagnosable, and releasable.

## What changed

- Version advanced from `3.1.5` to `3.1.6` with codename `Baseline Integrity`.
- Added source-derived repository inventory artifacts.
- Added support matrix with verified/not-tested/optional classifications.
- Added baseline validation and measurement scripts.
- Improved `xr doctor --json` with a stable schema containing version, environment, workspace/database status, redacted config status, health checks, and required-failure summary.
- Added daemon health version/binding/auth metadata while preserving open health and token-protected API behavior.
- Fixed Docker default command to use the documented container port `7842`.
- Added release checklist, migration/rollback notes, and Phase 0 audit/design documentation.

## Compatibility

- Package name remains `@rrrtx/xr`.
- CLI bin remains `xr` via `bin/xr.cjs`.
- Workspace SQLite compatibility is unchanged; no destructive migration is introduced by 3.1.6.
- Provider configuration, manual provider selection, memory consent behavior, budget controls, daemon localhost/token auth, plugin/skill/MCP surfaces, and install entrypoints are preserved.

## Known limitations

- Linux x64 with Bun 1.3.14 is the verified environment for this artifact. macOS/Windows require the same validation before being called verified.
- Local model runtimes and browser/voice/desktop-control integrations are optional and environment-dependent.
- The daemon/dashboard is local and process-local. It is not a remote enterprise control plane.
- The event bus is in-memory notifications, not durable event sourcing.
- Security approval/audit behavior is meaningful but not container/VM isolation.
- The top-level `website/` directory is the marketing site; the runtime dashboard is implemented under `src/daemon/`.

## Validation

Run:

```bash
bun install --frozen-lockfile
bun run baseline:validate
bun run baseline:measure
```

See `VALIDATION_REPORT.md` and `BASELINE_MEASUREMENTS.md` in this directory for release evidence.
