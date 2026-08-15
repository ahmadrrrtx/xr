# Phase 06 — CURRENT Reliability Path (pre-change snapshot)

**Captured:** 2026-08-15 · **Commit:** `7b667b0` (Phase 05 merge, main) · **Bun:** 1.3.14 · **Node:** v20.20.2

This document records the reliability architecture **as it exists before Phase 06
changes**, per Step 1 of the Phase 06 specification. All file references verified
against the working tree at the commit above.

---

## 0. Pre-flight baseline (measured)

| Check | Result |
|---|---|
| `git status --short` | clean |
| `git rev-parse HEAD` | `7b667b0df4c9249ff2f90c7b2b425b9f2687b37f` |
| Phase 00 baseline merge | `4540e74` (chore/phase00-baseline) |
| Phase 05 commit / merge | `30e4542` / `7b667b0` |
| `bun run typecheck` | PASS |
| `bun run boundaries` | PASS — 0 violations (546 modules, 1793 deps) |
| `bun test` | **3140 pass / 19 skip / 0 fail** (3159 tests, 256 files, 119.05 s) |

---

## 1. Checkpoint system — `src/execution/checkpoint.ts`

Single `CheckpointManager` over table `execution_checkpoints` (migrated idempotently).

- **Safe-kind taxonomy**
  - `ALWAYS_SAFE_KINDS`: `task_accepted`, `plan_recorded`, `policy_admitted`,
    `env_admitted`, `review_checkpoint_reached`, `cleanup_completed`, `recovery_decided`.
  - `IDEMPOTENCY_DEPENDENT_KINDS`: `step_started`, `step_completed`,
    `model_turn_completed`, `tool_call_completed`.
  - `isSideEffectSafe(kind, idempotency)` — safe when always-safe, or
    idempotency-dependent with `naturally_idempotent` / `idempotent_with_key`.
    `cancellation_requested` is **conservatively unsafe** (correct per spec).
- **`createCheckpoint(record, kind, extra?)`** — best-effort (returns `null` on
  persistence failure; never crashes the run). Captures:
  - `authoritySnapshot`: `{ policyVersion: trust.classification.classifierVersion, placement, credentialRefs, checkedAt }`
  - `environmentRef`, `executionState`, bounded `progressSummary` (2000 chars).
  - Payload bound: `JSON.stringify(payload).slice(0, MAX_CHECKPOINT_PAYLOAD_CHARS)`
    (8000 chars). **Weakness found:** slicing a JSON string can persist *invalid
    JSON*, which then throws on `rowToCheckpoint` read.
- **Reads:** `getLatestCheckpoint(runId)`, `getCheckpoints(runId, limit=50)`,
  `getLatestWorkflowCheckpoints(workflowId)` (limit 100).
- **`pruneCheckpoints()`** — deletes checkpoints of executions in terminal states
  (`succeeded, failed, cancelled, timed_out, denied, budget_blocked,
  reconciliation_required`) older than `CHECKPOINT_RETENTION_MS` (7 days),
  `LIMIT 1000`. **Gaps found:** always returns 0 (never reports deletions); no
  scheduler exists; does not protect runs with unacknowledged durable
  cancellations / pending recovery.

`DURABILITY_BOUNDS` (src/execution/types.ts): retention 7 d, payload 8000 chars,
lease TTL 5 min, `MAX_RECOVERY_RETRIES` 3, `RECOVERY_TIMEOUT_MS` 30 s.

## 2. Execution service — `src/execution/service.ts` ("the Fabric", XR 4.3)

Owns the canonical `execute()` lifecycle and constructs `CheckpointManager`,
`LeaseManager`, `RecoveryManager` over the execution repo's raw DB.

Lifecycle checkpoints currently created: `task_accepted` → `plan_recorded` →
`policy_admitted` → `step_started` → (`model_turn_completed` |
`tool_call_completed` | `step_completed`) per capability kind.
**Gaps found:** `env_admitted` and `cleanup_completed` kinds are defined but never
created; no checkpoint between trust-gate environment admission and execution.

- **Claim-first idempotency (Phase 1 · T5):** when `opts.idempotencyKey` is set
  and idempotency ≠ naturally_idempotent: repo lookup for a prior completed run
  with same key → replay without side effect; else `IdempotencyStore.claim()`
  BEFORE the effect. Completed slot → replay; crashed-pending + non-idempotent →
  `requires_reconciliation`, never re-run; settled post-effect via
  `settleIdempotencySlot` (complete / fail / requireReconciliation).
- **Retry loop:** bounded `maxAttempts` (≤ `EXECUTION_BOUNDS.MAX_ATTEMPTS`),
  fixed `retryBackoffMs` (default 100 ms — no exponential backoff/jitter),
  retries only when idempotency permits, side-effect is not unknown, and
  `opts.isRetryable?.(err, attempt)` passes. No canonical runtime-wide
  `isRetryable(error)` — classification is caller-supplied.
- **Cancellation:** in-memory `cancelFlags` + 5 ms watchdog inside
  `runWithGuards`; `cancel(runId, reason)` persists durable cancellation +
  `cancellation_requested` checkpoint. `CancellationUnsupportedError` rejects the
  run; outcome records `sideEffectPossible` honestly (running/observing).
- **`onStop()`** marks live executions interrupted + requests cancellation.
- **`markInterrupted(runId)`** → `recovery_decided` checkpoint + repo update.
- **`startupRecovery(workspaceId)`** — takes a `recovery` lease (60 s TTL),
  discovers interrupted records (`repo.findInterrupted`), classifies each,
  records decisions, auto-resumes `auto_resume` records via
  `resumeRecoverable(force)`, quarantines dirty environments, releases lease.
  **Gap found:** resume claim happens from classification alone; no checkpoint
  load/verification gate before claiming resume.
- **`getRecoveryStatus` / `getRecoveryPending`** feed CLI + daemon route.

## 3. State machine — `src/execution/state-machine.ts`

Explicit `(state, event) → next` table; invalid transitions throw
`InvalidExecutionTransitionError`. Terminal/runnable/in-flight/side-effect
state sets exported. **Gap found:** recovery-related events (`interrupt`,
`mark_recoverable`, `begin_resume`, `resume_complete`, `block_recovery`,
`checkpoint`) are declared in the `Event` union but have **no table entries**,
i.e. they are dead vocabulary; interruption is applied by direct repo update.

## 4. Leases — `src/execution/lease.ts`

`LeaseManager`: UNIQUE(target_type,target_id); acquire checks existing lease →
released (re-insert), stale PID dead (`process.kill(pid,0)` ESRCH; EPERM treated
alive) → takeover when allowed, same instance → renew, live other owner → null.
`holdsLease`, `release`, `getWorkspaceLeases`, `cleanup`. Used today for:
startup-recovery lock (`recovery` target). **Gap found:** per-workflow execution
leases are not acquired by the fabric's `execute()` path.

## 5. Recovery — `src/execution/recovery.ts`

`RecoveryManager` over tables `execution_recoveries`, `execution_cancellations`,
`environment_attachments`.

- `discoverUnfinished(workspaceId)` — states queued/running/observing/
  awaiting_approval/awaiting_policy/authorized, ordered, LIMIT 200.
- `classify(record)` order: durable cancellation first (blocked) →
  pre-flight state → safe checkpoint → idempotency + crash-state analysis →
  quarantine → no-checkpoint unknown → default safe. **Gap found:** checkpoint
  validity is never verified (corrupt payload passes); audit-chain and
  authority-snapshot validity are not consulted.
- `recordDecision`, `requestCancellation`, `acknowledgeCancellation`,
  environment attachment lifecycle, `buildStatus` (RecoveryStatus for UX).
- Recovery states vocabulary (types.ts): running / checkpointed / interrupted /
  startup_recovery_pending / recoverable / resuming / resumed / paused /
  cancellation_requested / recovery_blocked.

## 6. Idempotency store — `src/state/idempotency.ts`

Claim-first slots (`idempotency_slots`, migration 1): `claim → run effect →
complete`. States: pending / completed / failed / requires_reconciliation.
Cross-process safe via UNIQUE key + single-writer gate. Crash-injection tested
at persistence level (`test/reliability/crash-injection/idempotency-crash.ts`).
**Gap found:** no canonical key-derivation shared with the fabric for the agent
loop path (adapter-level only).

## 7. Adapters — `src/execution/adapters/`

`tool-adapter.ts` derives `idempotencyKey = kind:name:hash(tool|sortedArgs)`
(Bun.hash w/ FNV-1a fallback) when `defaultIdempotency()` says
`idempotent_with_key` (write_file, delete_file, shell). Reads →
naturally_idempotent; model_call/workflow_task → non_idempotent; MCP/plugin/
control/business → **unknown_unsafe** (conservative). Approval map mirrors tool
`requiresApproval`.

## 8. Provider reliability — Phase 04/05

- `src/providers/errors.ts`: `ProviderError` with kinds (authentication_failure,
  rate_limit, timeout, unavailable, invalid_request, model_unavailable,
  unsupported_capability, provider_overload, network_failure, context_length,
  content_policy_refusal, unknown_provider_failure) and per-kind `retryable`
  default; `normalizeProviderError`; secret redaction in `toSafeJson`.
- `src/providers/request-guard.ts`: `guardedRequest` — bounded timeout (default
  120 s, config/env override), caller AbortSignal composition, honest attribution
  (`ProviderAbortError` kind = cancelled | timeout; caller abort wins).
- `src/providers/fallback-chain.ts`: bounded primary → fallbackProvider → local
  chain, policy-aware (`allowFallback`), auditable explanation.
- `src/providers/gateway.ts` + `openai-compat.ts`: `chat()` / `chatStream()` SSE
  parsing (`data:` lines, `[DONE]`). **Gap found:** malformed SSE lines are
  skipped, but there is no canonical classification for structurally invalid
  responses/JSON in the reliability layer; no tests.

## 9. Cancellation path (current)

`xr run` (src/commands/run-agent.ts): first SIGINT → `runController.abort()` +
"stopping at the next step"; second SIGINT → `process.exit(130)`.
Signal flow: run-agent → `AgentService.runTask(overrides.signal)` →
`runEnvelope(context.signal)` → `runAgentLoop(deps.signal)`:
- checked before each step and between tool calls (`isCancelled()`);
- passed into `provider.chat` / `chatStream` options (request guard reaches socket);
- **NOT passed to tools** (`tool.run(args, toolCtx)`; `ToolContext` has no
  `signal`). Shell compat path uses `runCommand` (src/util/process.ts) which has
  a timeout kill but no AbortSignal support. Isolated-runner path (Trust
  service) has no cancellation input at all.
- Fabric path: cooperative watchdog only; underlying action cannot be aborted.

## 10. Startup recovery + UX

`XRApp.start()` → `runStartupRecovery()` (src/core/app.ts): resolves the
Execution service, runs `startupRecovery(workspaceId)`, emits `recovery.pending`,
prints banner. **Honesty gap found:** banner says *"XR recovered N interrupted
execution(s)"* even when work was only discovered/classified/blocked — it must
only claim recovery that actually happened. Banner points users to `xr status`,
which **does not exist as a command**; the real command is `xr execution
[--recovery|--resume|--cancel]` (src/commands/execution.ts).

Daemon route `recovery.status.get` (`/api/recovery`, system.routes.ts) returns
pending list + `{pending, blocked, safeToResume}` summary. **Gap found:**
contract advertises RPO/RTO but the handler returns neither.

## 11. Background jobs infra

`BackgroundServiceManager` (src/core/services.ts): interval jobs with owner,
workspace binding, failure counting, restart-on-workspace-switch.
`XRApp.registerCoreBackgroundJobs()` currently registers only
`security_monitor`. **No pruning job exists.**

## 12. Existing test coverage (reliability domain)

- `test/execution/`: state-machine, repository, service (409 L), checkpoint
  (157 L), recovery (216 L), lease (118 L), cancellation (168 L), adapters.
- `test/reliability/`: crash-injection matrix (child-process SIGKILL at write
  boundaries for audit/session/idempotency/workflow/migration/vault),
  idempotency slots, single-writer, concurrency-stress, migration-race,
  rpo-rto (backup/restore drill, RTO budget 2 s), provider canaries,
  audit-chain-extra, store-edge, golden-path.
- Gaps per forensic audit: no retry-taxonomy tests, no fabric-level crash +
  duplicate-side-effect test, no checkpoint-pruning scheduler tests, no
  corrupted-checkpoint/audit-chain recovery tests, no cancellation-propagation
  to tools test, no malformed-response classification tests.

## 13. Gap ledger carried into Phase 06

| # | Gap | Spec step |
|---|---|---|
| G1 | No canonical `isRetryable`/failure taxonomy outside provider kinds | 2, 12, 13, 42 |
| G2 | Checkpoint payload can persist invalid JSON (slice truncation) | 6 |
| G3 | `env_admitted`, `cleanup_completed` checkpoints never created | 7 |
| G4 | No prune scheduler; prune returns 0; unprotected runs | 31–33 |
| G5 | Resume claimed from classification only (no checkpoint verification) | 5, 22, 24 |
| G6 | Audit-chain integrity not consulted by recovery | 23, 47 |
| G7 | Authority snapshot not validated on resume | 24, 49 |
| G8 | Cancellation does not reach tools / subprocesses | 15, 18 |
| G9 | Banner overclaims; `xr status` missing | 36, 37 |
| G10 | `recovery.status.get` lacks honest RPO/RTO + state counts | 34, 35 |
| G11 | Retry backoff is flat; no bounded exponential/deadline helper | 38, 39 |
| G12 | Malformed provider response / tool call classification untested | 29, 30 |
| G13 | Fabric does not acquire per-workflow execution leases | 25 |
| G14 | DB failure taxonomy absent (busy/locked vs corrupt) | 28 |
