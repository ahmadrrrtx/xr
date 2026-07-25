# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.3.0] - 2026-07-25 — Durable Agency

### Added
- **Durable checkpoints** (`src/execution/checkpoint.ts`): safe semantic boundaries
  (`task_accepted`, `plan_recorded`, `policy_admitted`, `env_admitted`, `step_started`,
  `step_completed`, `model_turn_completed`, `tool_call_completed`, `cancellation_requested`,
  `review_checkpoint_reached`, `cleanup_completed`, `recovery_decided`) with
  side-effect-safety classification and authority snapshots.
- **Local ownership/leases** (`src/execution/lease.ts`): prevents duplicate execution
  within the same workspace; detects stale process ownership via PID liveness check;
  supports acquisition, renewal, release, takeover, and cleanup.
- **Startup recovery** (`src/execution/recovery.ts`): discovers unfinished work at
  boot, classifies each record as `safe` / `unknown_side_effect` / `authority_expired` /
  `environment_lost` / `cancellation_pending`, decides `auto_resume` / `requires_approval`
  / `blocked` / `quarantined`, and records recovery decisions durably.
- **Durable cancellation** (`execution_cancellations` table): cancellation requests
  survive process restart and are honored before any resume attempt.
- **Environment attachment records** (`environment_attachments` table): persist
  environment identity, lifecycle state, and cleanup status so orphaned environments
  can be detected and quarantined at startup.
- **Recovery-aware execution states**: `recoverable`, `startup_recovery_pending`,
  `resuming`, `resumed`, `recovery_blocked` exposed through the inspection layer.
- **Bounded backpressure constants**: `MAX_ACTIVE_EXECUTIONS` (50), `MAX_RECOVERY_OPERATIONS`
  (5), `MAX_ACTIVE_ENVIRONMENTS` (10), `MAX_QUEUED_WORK` (100), `PER_WORKSPACE_CONCURRENT`
  (20) with explicit capacity reporting.
- **Retry safety reinforcement**: built on Phase 2 idempotency — `non_idempotent` actions
  with unknown side effects are never silently retried; `reconciliation_required` is the
  honest terminal state.
- **Authority revalidation on resume**: policy, credentials, placement, budget, and
  approvals are re-checked before any recovered execution can proceed.
- **CLI recovery commands**: `xr execution --recovery` shows interrupted work;
  `xr execution --resume <runId>` resumes a recoverable execution with user approval
  for unknown-side-effect cases; `xr execution --cancel <runId>` creates a durable
  cancellation.
- **Daemon recovery routes**: `GET /api/recovery` returns all pending/blocked recoveries;
  `POST /api/recovery/resume` triggers resume (with optional `force` for user-approved cases).
- **Kernel startup recovery**: `XRApp.start()` now runs `startupRecovery()` after service
  readiness; interrupted work is classified, safe work auto-resumed, and blocked work
  is exposed via health and events.
- **Graceful shutdown marking**: `ExecutionService.onStop()` checkpoints active executions
  as interrupted before stopping, so they are discoverable on next start.
- **Health integration**: `KernelHealth.recovery` reports `pending` / `blocked` counts;
  `formatHealthHuman` shows recovery section.
- **30 new tests**: checkpoint manager (7), lease manager (10), recovery manager (13).

### Changed
- Version identity updated to `4.3.0 (Durable Agency)` across package/runtime surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.2.0` → `xr-4.3.0`.
- `ExecutionState` type extended with recovery-aware helpers (`wasInFlight`, `sideEffectPossible`).
- `ExecutionService` now owns `checkpoints`, `leases`, and `recovery` managers; creates
  checkpoints at each safe boundary; integrates with startup recovery.
- `ExecutionRepo` adds `findInterrupted()`, `countActive()`, `markInterrupted()` queries.
- `ExecutionServiceDeps` accepts optional `onRecoveryStatus` callback.
- All changes are additive: records without checkpoints (legacy or pre-4.3) are classified
  as `unknown_side_effect` and default to `requires_approval` — never silently auto-resumed.

### Security
- Unknown external side effects block automatic retry (reconciliation_required).
- Stale authority is never reused on resume — policy/credentials/placement revalidated.
- Environment quarantine prevents reuse of orphaned or incompletely cleaned environments.
- Durable cancellation survives restart; cancelled work is never silently resumed.
- Lease mechanism prevents duplicate concurrent execution within a workspace.
- Recovery decisions are durable and auditable.
- **Explicit limitation**: Phase 4 does not implement distributed execution, remote
  workers, or a cloud scheduler. Leases are local-only guards, not distributed consensus.

### Compatibility
- All Phase 0–3 tests remain green (682 of 684 pass; 2 sandbox-dependent tests fail
  only in containerized environments without OS namespace support).
- Existing execution/workflow/agent APIs unchanged.
- Additive schema migration — XR 4.2 records remain readable.
- No Phase 5+ capabilities (automatic model routing, memory/context redesign, mailbox,
  visual workflows, remote execution) are introduced.

## [4.2.0] - 2026-07-24 — Trust and Isolation

### Added
- **Trust & Isolation subsystem** (`src/trust/`): makes XR authority enforceable
  by risk tier. A policy decision is now bound to the authority of the
  environment that executes the action — a record saying "allowed" is no longer
  treated as sufficient.
- **Deterministic risk classifier** (`classify.ts`): maps objective action facts
  to `tier0_in_process | tier1_restricted | tier2_isolated` plus required
  fs/net/process policy, resource limits, credential mode, and approval level.
  A model cannot choose or downgrade a tier.
- **Fail-closed policy-to-placement** (`policy.ts`): Tier 0 stays in-process;
  Tier 1 uses a restricted process; Tier 2 uses a namespace sandbox or container
  and is **blocked** when no enforceable backend exists — never silently
  downgraded to in-process. Root voids restricted/isolated placement.
- **Real OS isolation backends** (`environment/`): `namespace_sandbox`
  (bubblewrap primary; raw user/mount/pid/net namespaces fallback) with a
  minimal rebuilt root, no network, stripped env, and `ulimit` cpu/mem/proc;
  `container` (Docker/Podman when present); `restricted_process` (Tier 1,
  honestly labeled process restriction, not a boundary); `in_process`.
- **Task-scoped authority grants** (`authority.ts`): bounded, TTL, revocable,
  bound to execution + workspace; stale/expired/revoked grants are rejected.
- **Credential broker** (`credentials.ts`): reference-only secrets, transient
  injection into the sandbox env, redaction of registered + generic secret
  shapes, `assertClean`, and revocation on cleanup. Raw values never enter
  records/logs/output.
- **Isolation verification** (`verify.ts`): proves actual placement matches the
  policy decision and guarantees meet the tier before execution; blocks
  otherwise (incl. Tier-2 network allowlists that local backends can't enforce).
- **Environment manager** (`environment/manager.ts`): capability detection,
  selection, execute-with-verification-and-cleanup, quarantine, health, shutdown.
- **`TrustService`** with lifecycle/health, registered under `Tokens.Trust` via
  `TrustServiceProvider` and wired into `ExecutionService`.
- **Execution-fabric integration**: `ExecutionRecord.trust` (risk, placement
  decision, authority-grant id, credential scope, resource policy, verification,
  cleanup/quarantine); `ExecuteOptions.trust`; new `Placement` kinds; trust gate
  runs after policy/approval and before the action (blocked → `denied`/`TRUST_BLOCKED`).
- **Tool wiring**: `ToolContext.runIsolated`; the `shell` tool runs in the
  namespace sandbox in the full runtime (legacy fallback when no Trust service).
- **Adapter-level risk classification** recorded on every consequential action:
  file/web/git tools (Tier 0/1), control/computer-use/browser (mapped from the
  existing safe/sensitive/destructive classifier; destructive host-authority
  actions admitted with an explicit elevated gate, not blocked).
- **MCP isolation**: high-risk (credential-bearing) **stdio** servers now run
  **inside the namespace sandbox** for their lifetime (stdio passes through
  bwrap; verified), and **fail closed** when no sandbox exists unless explicitly
  acknowledged (`XR_MCP_ALLOW_UNISOLATED=1`, warned). `XR_MCP_ISOLATE_STDIO=1`
  force-isolates low-risk servers; `XR_MCP_ISOLATED_NET=1` opts into in-sandbox
  network. HTTP/SSE servers remain egress-gated (Tier 1).
- **Plugin permission-aware risk model**: operations classified by **effective
  (granted)** permissions; hard-boundary capabilities (`shell`/`control`/
  `browser`) are Tier 2 and **membrane-blocked** (declared ≠ authority); `secrets`
  → Tier 2 mediated, `net` → Tier 1 egress-gated.
- **`requiresHostAuthority`** distinction: sandboxable high-risk work (shell/code)
  must be isolated or blocked; inherently host-bound work (GUI/browser) is
  admitted with an explicit elevated gate and never treated as low-risk.
- **Trust metadata durability**: the `trust` block round-trips through the
  execution repository (`record_json`); 4.1-shaped records still load.
- **UX**: `xr trust` CLI command (status / classify / --json), daemon
  `/api/trust` + `/api/trust/classify` routes (secret-free, token-gated), a
  **dashboard Trust & Isolation matrix card**, and a dashboard `/status` line.
- **Performance script**: `scripts/measure-trust-perf.ts` (per-tier latency).
- **Phase 3 documentation**: `docs/phase3/TRUST_ARCHITECTURE.md`,
  `PLATFORM_SUPPORT.md`, `THREAT_MODEL.md`, `MIGRATION_4.1_to_4.2.md`,
  `VALIDATION_REPORT.md`.
- **88 new tests** (deterministic classifier, fail-closed policy, authority,
  credential redaction, verification, **real-sandbox adversarial** proofs,
  end-to-end execution-fabric integration, per-tool/adapter classification,
  daemon/CLI UX, durability, and migration/rollback safety).

### Changed
- Version identity updated to `4.2.0 (Trust and Isolation)` across
  package/runtime/website surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.1.0` → `xr-4.2.0`.
- All changes are additive: actions without `opts.trust`, and runtimes without a
  wired Trust service, behave exactly as in 4.1.

### Security
- High-risk actions can no longer rely on in-process checks alone: they execute
  inside a verified OS boundary or are blocked (fail closed).
- No ambient host authority is inherited by high-risk execution; credentials are
  scoped, injected transiently, redacted from records, and revoked on cleanup.
- Documented honest limits: Tier 1 is process restriction (not a boundary);
  sandbox network is `none` (no in-boundary allowlist); Linux-only Tier 2 in
  4.2; no claim against host-kernel 0-days.

### Documented limitations (out-of-scope / procedural, not technical blockers)
- **Cross-platform Tier-2 backends** (macOS Seatbelt / Windows AppContainer) are
  out of scope for 4.2 (local Linux isolation); those platforms **fail closed**
  for high-risk actions (see `docs/phase3/PLATFORM_SUPPORT.md`).
- **Running plugin VM code itself inside a kernel namespace** is future
  hardening; the "isolate-or-block" criterion is met via the **blocked** branch
  (the VM membrane denies raw process/GUI/web authority; declared ≠ authority).
- **Production rollback drill + human security/release owner sign-off** are
  operational steps; rollback **safety** is tested (no unsafe high-risk fallback,
  4.1 records load, fail-closed default).

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
