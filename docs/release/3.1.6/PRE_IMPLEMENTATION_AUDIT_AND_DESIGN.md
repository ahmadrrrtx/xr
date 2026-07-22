# XR 3.1.6 Phase 0 — Pre-Implementation Audit and Design Review

Date: 2026-07-22

## Inspected paths

- Root/package/release: `package.json`, `bun.lock`, `.gitignore`, `tsconfig.json`, `CHANGELOG.md`, `MIGRATION.md`, `README.md`.
- CI/deployment/install: `.github/workflows/ci.yml`, `Dockerfile`, `docker-compose.yml`, `install.sh`, `install.ps1`, `src/install/system.ts`.
- Entrypoints/runtime: `bin/xr.cjs`, `src/index.ts`, `src/cli/*`, `src/core/*`, `src/state/*`, `src/config/*`.
- Daemon/dashboard: `src/daemon/server.ts`, `src/daemon/dashboard.ts`, `src/daemon/routes/*`.
- Providers/local: `src/providers/*`, `src/local/*`.
- Security/cost/control: `src/security/*`, `src/cost/*`, `src/control/*`.
- Plugins/skills/MCP: `src/plugins/*`, `src/skills/*`, `src/mcp/*`, `plugins/*`, `skills/*`.
- Tests: `test/**/*.test.ts` and focused fixture directories.
- Required external reports supplied in `/home/user/uploads`: deep audit, OSINT report, architecture understanding report, competitive strategy, master roadmap, and execution program.

## Verified facts

- Repository cloned from `https://github.com/ahmadrrrtx/xr` on branch `main`, commit `450263690fd0e9f6e649e20b635be95450d2136c` at audit time.
- Package identity before implementation: `@rrrtx/xr` version `3.1.5`, bin `xr -> ./bin/xr.cjs`, package manager `bun@1.3.14`, engine `bun >=1.3.0`.
- Dependency install with Bun 1.3.14 and `--frozen-lockfile` succeeded.
- Typecheck succeeded before changes: `bun run typecheck`.
- Version sync succeeded before changes: `bun run set-version:check`.
- Test suite succeeded before changes: 458 tests passed across 40 files.
- CLI fast paths exist in `src/cli/router.ts` for version/help/shell/serve.
- Runtime bootstrap is `XRApp`/`XRKernel` with typed `ServiceRegistry`, lifecycle manager, workspace manager, in-memory event bus, and service providers.
- Workspace state uses Bun SQLite through `src/state/workspace-store.ts`; default DB path is under `XR_HOME` (`~/.xr` unless overridden), while `WorkspaceManager` provisions workspace directories.
- Daemon binds `127.0.0.1`, leaves `/api/health` open, and requires local bearer/query token for all other routes.
- Runtime dashboard is implemented as inline HTML in `src/daemon/dashboard.ts`; top-level `website/` exists in this checkout as a separate marketing site.
- Provider/local runtime registration exists for local OpenAI-compatible runtimes and BYOK cloud providers. Required tests do not need provider credentials.
- Security/audit/control tests verify meaningful approval, audit, budget, and redaction behavior, but this is not container/VM isolation.

## Discrepancies and baseline failures found

- Version/docs still described XR 3.1.5 Helios; the requested release is 3.1.6 Baseline Integrity.
- CI comments mentioned an older Bun packageManager pin even though `package.json` says `bun@1.3.14`.
- `xr doctor --json` returned checks but lacked a stable top-level Phase 0 report contract with version, environment, workspace/database, redacted config, and required-failure summary.
- `/api/health` returned basic health only; it did not expose version/binding/auth metadata useful for baseline daemon smoke checks.
- Dockerfile exposed/documented port 7842 while default `xr serve` listened on 3141. Compose mapped 7842, so the default container command was inconsistent.
- Repository lacked generated source-derived inventory, support matrix, validation report, baseline measurement report, and release checklist for 3.1.6.
- Windows/macOS and installer validation were not proven in the Linux audit environment and must not be claimed verified.

## Unsupported assumptions

- Presence of platform branches does not prove macOS/Windows support.
- Presence of provider presets does not prove a provider is usable without user credentials or a local runtime.
- Existing security controls do not provide OS-kernel, VM, or container isolation.
- The in-memory event bus is not durable event sourcing.
- The marketing `website/` is not the local runtime dashboard.

## Proposed Phase 0 changes

| File | Why it changes | Exact responsibility after change | Dependencies | Migration impact | Risk |
|---|---|---|---|---|---|
| `package.json` | Release version/scripts | Version 3.1.6 and Phase 0 validation scripts | Bun | None | Low |
| `.bun-version` | Tool pin clarity | Documents Bun 1.3.14 for local/CI tools | Bun | None | Low |
| `src/core/version.ts` | Runtime version | Single stamped runtime identity | `scripts/set-version.ts` | None | Low |
| `scripts/set-version.ts` | Website identity consistency | Check/stamp version, codename, displayVersion | Node/Bun fs | None | Low |
| `src/baseline/status.ts` | Stable diagnostic helpers | Summary/redaction/runtime/workspace/config contracts | Existing install/config types | None | Low |
| `src/commands/doctor.ts` | Baseline diagnostics | Stable JSON schema and required-failure exit code | Existing services | None | Medium: output shape additive |
| `src/install/system.ts` | Required-failure exit behavior | Nonzero exit code for required health failures | Baseline summary helper | None | Low |
| `src/daemon/routes/system.routes.ts` | Daemon smoke evidence | Version/binding/auth metadata in health | Existing version module | None | Low |
| `Dockerfile` | Port consistency | Default daemon port matches exposed/mapped 7842 | Docker/Bun | None | Low |
| `scripts/baseline-inventory.ts` | Reproducible inventory | Source-derived inventory JSON/MD | Existing catalog/presets | None | Low |
| `scripts/validate-baseline.ts` | Release validation | Local-only validation report JSON/MD | Bun | None | Low |
| `scripts/measure-baseline.ts` | Baseline measurements | Deterministic local smoke measurements | Bun | None | Low |
| `test/baseline/status.test.ts` | Unit coverage | Redaction, summary, workspace/config serialization | Bun test | None | Low |
| `test/baseline/doctor.test.ts` | CLI diagnostic regression | `doctor --json` schema/no secret leakage | Bun test | None | Low |
| `test/daemon.test.ts` | Health contract update | Assert health version/binding/auth metadata | Bun test | None | Low |
| `docs/release/3.1.6/*` | Release artifacts | Audit/design, inventory, support, validation, measurements, notes/checklist | Scripts | None | Low |
| `CHANGELOG.md`, `MIGRATION.md`, `README.md` | User truth | 3.1.6 release, migration, support/diagnostics pointers | Docs | None | Low |
| `website/src/*` | Version truth | Marketing site version strings | Existing website | None | Low |

Audited but not changed unless a later diff shows otherwise: broad core runtime files, provider implementations, security approval logic, store schema, plugin/skill/MCP runtime internals, install shell scripts. They were reviewed for Phase 0 evidence but not redesigned.

## Architecture design review

### Baseline artifact structure

Release artifacts live under `docs/release/3.1.6/`:

- `PRE_IMPLEMENTATION_AUDIT_AND_DESIGN.md`
- `INVENTORY.md` / `inventory.json`
- `SUPPORT_MATRIX.md`
- `VALIDATION_REPORT.md` / `validation-report.json`
- `BASELINE_MEASUREMENTS.md` / `baseline-measurements.json`
- `RELEASE_CHECKLIST.md`
- `RELEASE_NOTES.md`
- `ROLLBACK.md`

### Supported-environment representation

Support status is represented as documented table rows plus source-derived inventory statuses. Claims are limited to commands/evidence in the current environment. Optional integrations are not required for core validation.

### Validation command contract

- `bun run baseline:inventory` writes inventory artifacts and exits nonzero on generation failure.
- `bun run baseline:validate` runs local-only required gates and writes validation artifacts; optional checks are explicit `skip` rows with reasons.
- `bun run baseline:measure` runs deterministic smoke measurements in isolated `XR_HOME`; it exits nonzero if a measured required scenario fails.

### Health/diagnostic output contract

`xr doctor --json` emits schemaVersion 1:

- `version`
- `environment`
- `platform`
- `workspace`
- `config` (safe/redacted; secret presence only)
- `summary`
- `checks`

Required failures (`platform`, `bun`, `package-manager`, `config`, `audit`) set process exit code 1. Optional local runtime/provider/browser/voice/control warnings do not fail core baseline by default.

### Measurement format and storage

Measurements are JSON for automation and Markdown for release review in `docs/release/3.1.6/`. Each scenario records command, samples, median, p95, min/max, successes/failures, and peak observed RSS for the measurement process.

### Release/version contract

`package.json` remains ultimate source, stamped into `src/core/version.ts` and website identity by `scripts/set-version.ts`. `bun run set-version:check` is the CI/release gate.

### Migration/rollback contract

3.1.6 introduces no destructive database migration. Upgrade requires backup of `XR_HOME`; rollback restores the previous code/package and pre-upgrade data backup.

### Documentation truth policy

Docs must distinguish current verified implementation from roadmap intent. Unsupported platform/provider/security claims are either removed, labeled optional/experimental/not tested, or placed in known limitations.

### Compatibility classification format

Inventory/support artifacts use: stable, supported, supported with optional dependency, experimental, legacy compatibility, internal, broken/unverified, deprecated, not tested.

### CI gate order

Install from lockfile → typecheck → tests → version sync → inventory generation. Optional provider/browser/Docker/OS-specific checks remain separate.

### Failure reporting/exit behavior

Scripts and `doctor` use nonzero exit codes for required failures and structured JSON/Markdown with command, status, duration, and remediation/skips.

## Alternatives considered

- Add a new observability/telemetry subsystem: rejected as Phase 11+ scope.
- Redesign lifecycle/kernel for diagnostics: rejected as Phase 1 scope.
- Make cloud providers/local models required in validation: rejected because Phase 0 local baseline must not require credentials/network.
- Use an external inventory/benchmark library: rejected to avoid Phase 0 dependency changes.

## Security review

Diagnostics report only secret presence (`set`/`unset`) and redacted values. Daemon continues localhost binding and token protection except open health. Docker docs preserve localhost host binding. No production path bypasses approval/budget/security checks.

## Performance impact

Runtime impact is negligible outside `doctor`; new scripts run only when invoked. `doctor --json` already performed health checks, and the added summary/status serialization is local and bounded.

## Migration impact

No schema change and no public CLI command removal. `doctor --json` is additive at the top level; existing `checks` remains present.

## Deferred later-phase issues

- Runtime Kernel redesign / unified execution fabric.
- Durable event sourcing.
- Container/VM agent isolation.
- Automatic intelligence routing engine.
- Memory/context architecture redesign.
- Workflow/visual editor and enterprise control plane.
- Provider expansion beyond current presets.
- Full macOS/Windows support claims until validation runs prove them.
