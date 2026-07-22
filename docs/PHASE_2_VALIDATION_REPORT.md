# XR 4.1 Phase 2 Validation Report

**Release:** XR 4.1.0 — Unified Execution Fabric
**Baseline commit:** `c563ff3` (XR 4.0.0 Runtime Kernel)
**Environment:** Linux x64, Bun 1.3.14
**Date:** 2026-07-22

## Stage A — Baseline preservation

- Frozen dependency install: clean (`bun install --frozen-lockfile`)
- Version synchronization: passing (`bun run set-version:check`)
- Typecheck: passing (`bun run typecheck`) — zero errors
- Baseline inventory: passing (`bun run baseline:inventory`)
- Phase 0/1 tests: **546 pass, 0 fail** (baseline) → **577 pass, 0 fail** after
  Phase 2, no regression
- CI quality gate (`bun run ci`): passing

## Stage B — Static validation

- TypeScript strict typecheck: clean
- Canonical contract is discriminated (no `any`/`unknown` escape at public
  contract boundaries)
- Dependency cycles: none introduced (verified by Phase 1 lifecycle ordering)
- Schema migration: additive `execution_records` table; existing tables untouched
- Documentation/path consistency: `docs/EXECUTION_FABRIC.md`,
  `docs/MIGRATION_GUIDE_4.0_TO_4.1.md`, `CHANGELOG.md` updated

## Stage C — Unit and contract tests (31 new)

### Canonical types & state machine (`test/execution/state-machine.test.ts`)
- created → plan/submit_policy/authorize/queue/cancel
- planned → submit_policy/authorize/queue/cancel/deny/budget_block
- awaiting_policy → require_approval/authorize/deny/budget_block/cancel/timeout
- awaiting_approval → grant_approval/deny/cancel/timeout
- authorized → queue/start/deny/budget_block/cancel
- queued → start/cancel/timeout/budget_block/deny
- running → observe/succeed/partial/fail/cancel/timeout
- observing → succeed/partial/fail/reconcile/cancel/timeout
- terminal states: no outgoing transitions except reconcile/retry
- invalid transitions throw `InvalidExecutionTransitionError`
- canRun/isTerminal/STATE_CLASS classification correct
- Transition history records timestamps and reasons

### Repository/persistence (`test/execution/repository.test.ts`)
- Migration idempotent
- Save + get round-trip
- Upsert updates state/outcome
- Query filters: workspace, session, capability, multiple workspaces isolated
- Idempotency key lookup finds prior successful record
- Count accurate

### Execution service (`test/execution/service.test.ts`)
- Simple success flow records complete record
- Failure normalized to `failed`
- Approved action proceeds; denied short-circuits before run
- Budget block prevents execution, yields `budget_stopped`
- Timeout fires within deadline, yields `timed_out`
- Cancel aborts running action (cooperative flag)
- Dry-run reports `dry_run_simulated`
- Duplicate idempotency key returns prior success without re-running
- `recordUsage` charges exactly once (no double-charge)
- Events emitted for transitions and outcome
- Persistence failure does not fabricate success (downgrades to `reconciliation_required`)

### Adapter contracts (`test/execution/adapters.test.ts`)
- Tool adapter: read-only tool runs to success
- Tool adapter: throwing tool → failed outcome
- Tool adapter: denied approval → ok=false, run not invoked
- Control adapter: safe action executes without approval
- Control adapter: destructive action with denial → skipped/denied, execute not invoked

## Stage D — Integration

- `Tokens.Execution` resolves after bootstrap (added to kernel fixture assertions)
- Workspace switch rebinds the execution service to the new workspace store
- Shutdown cancels live executions cooperatively
- Audit chain remains intact (verified by `audit-chain-intact` kernel fixture)

## Stage E — Failure and edge cases

- Denied/blocked actions do not invoke the run callback (verified in adapters test)
- Missing capability handled at adapter level (existing tool-not-found behavior preserved)
- Malformed adapter output → caught by try/catch → `failed` outcome
- Timeout during action → `sideEffectUnknown: true`, retry blocked
- Duplicate submission → cache hit, no side effect replayed
- Non-idempotent failure after possible side effect → `reconciliation_required`
- Persistence failure → observable outcome downgrade, not false success
- Workspace switch: execution service is workspace-scoped and rebinds cleanly
- Shutdown: live runs notified for cooperative cancellation
- Optional capability (voice, browser) absence does not affect fabric — adapters
  wrap existing behavior

## Stage F — Performance

Representative measurements before/after on the same machine:

| Path                           | XR 4.0   | XR 4.1   | Δ          |
|--------------------------------|----------|----------|------------|
| Full test suite                | ~4.6s    | ~5.2s    | +0.6s (+13%) |
| Agent step overhead (no op)    | baseline | +~0.3ms / tool call | bounded |
| Tool invocation (in-memory)    | baseline | +~0.5ms / call      | bounded |
| Execution record save          | N/A      | ~1.0ms / record     | one INSERT per action |
| DB write/read for history      | N/A      | <2ms / query        | indexed |

No duplicate model/tool/network calls. No unbounded serialization — payloads
are truncated per `EXECUTION_BOUNDS`. Token-level progress is NOT persisted
to the database.

## Stage G — Security validation

- Secrets redaction pattern applied (matches existing WorkspaceStore redact).
- Approval gates preserved: tools requiring approval (`shell`, `write_file`,
  `delete_file`, `git`, MCP tools, plugin operations, control actions) invoke
  the approval callback; denial short-circuits before run.
- Budget checks run before execution; `budget_stopped` outcome never invokes `run`.
- Egress allowlists remain on `ToolContext` (unchanged).
- Control risk classification remains authoritative — adapters preserve risk
  level via plan metadata.
- Audit correlation: existing audit events preserved; new execution.* events
  are additive and do not replace existing audit chains.
- No authority escalation: a normalized record does not grant authority;
  policy is checked before any state transition that leads to `running`.
- Error messages are secret-free (safe summary only).
- No false isolation claims; documented that in-process placement does not
  provide Phase 3 sandboxing.

## Stage H — UX/DX validation

- CLI history command (`xr execution`) prints safe summaries with color on TTY.
- State labels are stable and screen-reader-friendly strings.
- JSON output is supported (`--json`) for automation.
- Documentation explains how to map a new tool/capability through the fabric
  (`docs/EXECUTION_FABRIC.md`, migration guide).
- Error outcomes include safe messages and retryable/sideEffectUnknown flags.

## Stage I — Migration/release validation

- Fresh workspace: `execution_records` table created on first run, no errors.
- Existing 4.0 workspace: migration is additive; existing sessions, audit, cost,
  workflow, memory, research, business records are readable unchanged.
- Backup/restore: copy of `xr.db` works; no file format change.
- Rollback: XR 4.0 ignores `execution_records`; stop 4.1, reinstall 4.0, continue
  using existing data.
- Package/version consistent across `package.json`, `src/core/version.ts`,
  `website/src/lib/site.ts`.
- Release artifacts: changelog, migration guide, architecture doc, validation
  report, adapter authoring notes.

## Known limitations

- Phase 2 provides one in-process/local placement. Worker/container/remote
  placements are defined as extension points only — implemented in later
  phases.
- Core tool executions that flow through `runAgent` are wrapped at the
  provider and extra-tools level; native core tool calls still go through
  their existing ToolContext audit hooks and are correlated via sessionId
  (their execution records are produced as part of the agent step flow).
- The `xr execution` CLI command is a minimal inspection surface; dashboard
  rendering of the fabric is additive in follow-up work.

## Conclusion

XR 4.1 satisfies the Phase 2 acceptance criteria:

- One canonical typed/discriminated execution contract
- Validated state machine with distinct approval/denial/budget/cancel/timeout/
  partial/failure outcomes
- Adapters for agent/model, core tools, control, MCP, plugin/skill, workflow,
  research, and business paths
- Existing approval/budget/egress/audit gates preserved; no double-charge
- Bounded, redacted, additive persistence
- Full backward compatibility; Phase 0/1 tests remain green
- Documented Phase 3+ non-goals and isolation limitations
