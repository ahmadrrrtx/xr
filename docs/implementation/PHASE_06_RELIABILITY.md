# Phase 06 — Reliability / Recovery / Durable Execution

**Status:** implemented · **Base:** `7b667b0` (Phase 05 merge) · **Date:** 2026-08-16
**Pre-change snapshot:** `docs/implementation/PHASE_06_CURRENT_RELIABILITY_PATH.md`

XR must behave like ONE durable agent: if it says "running", it knows its state;
if it says "recovering", it has a verified path; if it says "cancelled", it
performed the cancellation; if it retries, it knows retrying is safe; if it
cannot recover safely, it says so.

Phase 06 closes the forensic gap ledger (G1–G14 in the pre-change snapshot)
WITHOUT creating parallel systems: one checkpoint manager, one recovery manager,
one idempotency store, one ProviderGateway fallback chain.

---

## 1. Reliability architecture

```
                     ┌─────────────────────────────────────────────┐
 surface (CLI/daemon)│              ExecutionService               │
   xr run / chat ───►│  lifecycle · checkpoints · leases · retry   │
                     └────┬────────────┬───────────────┬───────────┘
                          │            │               │
               CheckpointManager  LeaseManager  RecoveryManager
               (execution_       (execution_   (execution_recoveries,
                checkpoints,      leases)       execution_cancellations,
                execution_                      environment_attachments)
                maintenance)                          │
                          │                          hooks (Phase 06):
               IdempotencyStore                verifyAuditChain()
               (idempotency_slots,             validateAuthority()
                claim-first, WS store)         verifyRecoveryBasis()
                          │
              retry-classification.ts   ◄── ONE taxonomy for the runtime
              (classifyError / decideRetry / backoff / budgets)
                          │
       ProviderError kinds · ProviderAbortError · SQLITE codes · tool codes
```

Everything durability-related lives under `src/execution/` (fabric) and
`src/state/idempotency.ts` (slots). The taxonomy module
`src/execution/retry-classification.ts` is the single classification authority;
call sites must not hand-roll retry logic from message strings.

## 2. Lifecycle state machine

Canonical honest lifecycle for a long-running task:

```
task_accepted → plan_recorded → policy_admitted → env_admitted →
step_started → step_completed / model_turn_completed / tool_call_completed →
review_checkpoint_reached → cleanup_completed
```

- States: `created → planned → awaiting_policy → (awaiting_approval) →
  authorized → queued → running → observing → succeeded` (+ failure branches).
- Every transition is explicit in `TRANSITIONS` (state-machine.ts); invalid
  transitions throw `InvalidExecutionTransitionError` (Step 4 pinned by tests:
  cancelled→observe, succeeded→start, created→start all rejected).
- Failure branch: `running → fail → failed`, or `failed → reconcile`, or
  honest escalation to `reconciliation_required` when a non-idempotent action
  failed with unknown side-effect status.
- Crash branch: durable state stays at its last persisted value; on restart,
  discovery classifies it (Section 9). Phase 06 added the missing durable
  `persist()` on the `start` transition so a mid-effect crash is classifiable
  as `running` (side effects possible) instead of masquerading as `queued`.
- Cancellation branch: `cancellation_requested → cleanup_completed → cancelled`
  with `sideEffectPossible` recorded honestly (Section 8).
- Phase 06 fix: reconciliation outcomes now transition `queued → start → fail`
  (previously fired `fail` from `queued`, an invalid transition that left
  records stuck mid-lifecycle with a failed outcome).

## 3. Checkpoint guarantees

- Checkpoints are metadata snapshots; they NEVER mutate execution state.
- Written at every lifecycle boundary by the fabric: task_accepted,
  plan_recorded, policy_admitted, **env_admitted (new)**, step_started,
  model_turn_completed / tool_call_completed / step_completed,
  cancellation_requested, **cleanup_completed (new)**, recovery_decided.
- **Payload integrity (G2 fix):** oversize payloads are replaced by a bounded,
  VALID JSON truncation envelope preserving `state/outcome/attempt` — never a
  sliced JSON string. Readers tolerate legacy corrupt rows (`__invalid_payload`)
  instead of throwing.
- Unknown checkpoint kinds are rejected at write time.
- `verifyCheckpoint()` validates structure (kind, runId, timestamps, payload
  shape, authority snapshot fields) — the recovery gate uses it.
- Ordering invariant (Step 7, pinned by test):
  `TOOL EXECUTION → CHECKPOINT WRITE → COMPLETION CLAIM`. A durable tool
  completion claim without its checkpoint is impossible in the fabric path.

## 4. Retry taxonomy (canonical)

`src/execution/retry-classification.ts`:

| Class | Members |
|---|---|
| RETRYABLE | network timeout, connection reset, provider 503/overload, 429 (with retry-after), transient DB busy/locked, structured `ETIMEDOUT/ECONNRESET/…` |
| NON_RETRYABLE | invalid API key / 401, model unavailable / 404, malformed request, malformed provider response, malformed tool call, path escape, secret leak, policy denial, trust block, budget, corruption, cancellation, **unknown (conservative default)** |

Classification is structured-first: `ProviderError.kind`,
`ProviderAbortError.kind` (cancelled vs timeout), KernelError/execution codes,
SQLite codes (`SQLITE_BUSY/LOCKED` vs `SQLITE_CORRUPT/NOTADB/IOERR`), with a
small documented message fallback for bare transport errors. Unknown errors are
NON_RETRYABLE — retrying unknown failures is how side effects get duplicated.

## 5. Side-effect taxonomy

`IdempotencyClass` on every action:

- `naturally_idempotent` — reads/pure lookups (read_file, list_dir, git_status,
  git_diff, git_log, fetch_url, web_search, …)
- `idempotent_with_key` — content-converging writes (write_file, delete_file)
- `non_idempotent` — model calls, workflow tasks, external charges
- `unknown_unsafe` — everything unproven: **shell**, git mutations
  (commit/push/pull/stash/branch), computer_control, clipboard writes, MCP
  tools, plugin operations, control/business actions

Phase 06 change (Step 43): shell and git mutations moved from
`idempotent_with_key` to `unknown_unsafe` — arbitrary command semantics cannot
be proven repeatable, so they fail closed (no silent retry; crash → approval).
Full inventory: Section 6.

## 6. Idempotency design

One store (`src/state/idempotency.ts`, table `idempotency_slots`), claim-first:

```
request → derive key → claim slot (INSERT, state=pending) BEFORE the effect
  · completed slot      → replay cached result, effect NOT re-run
  · pending slot        → crashed predecessor:
      – non_idempotent/unknown → requireReconciliation, NEVER re-run
      – idempotent_with_key    → re-run allowed (converges, SAME key)
  · absent              → execute → persist result → complete
```

- Keys are deterministic and scope-stable: adapters derive
  `kind:name:hash(tool|sortedArgs)`; the fabric-level key for a run is whatever
  the caller passes — retries keep the SAME runId and SAME key (Step 40, pinned
  by test), never minting a new identity per attempt.
- Persistence ordering: the slot is INSERTed before the effect and settled only
  after the outcome is known, so a crash can never be mistaken for completion.
- The fabric also replays prior completed EXECUTION records by key
  (`findCompletedByIdempotencyKey`) with `duplicateOf` provenance.

## 7. Lease semantics

`execution_leases` (UNIQUE per target): acquisition is atomic; liveness is
PID-checked (`kill(pid,0)`, EPERM=alive); same instance renews; another live
owner rejects; dead owner → stale takeover when allowed.

Workflow protection (Step 25), two gates:
1. **In-process:** live in-flight records with the same workflowId reject new
   executions (`WORKFLOW_LEASE_HELD`) — one runtime cannot race itself.
2. **Cross-process:** durable lease over the shared DB rejects other runtimes.
Leases release in `finally`; a crash leaves the lease unreleased and
stale-detectable — the designed takeover path, never silent double execution.
Phase 06 fix: stale takeover now removes the dead row before re-inserting
(previously the UNIQUE constraint made crashed work permanently unrecoverable).

## 8. Cancellation propagation

```
SIGINT (1st) → runController.abort() → agent-service → envelope → agent loop
  ├─ loop checkpoints: before each step, after each model turn, between tools
  ├─ provider transport: chat()/chatStream() receive the signal (request-guard
  │  reaches the socket; attribution stays honest: cancelled ≠ timeout)
  └─ tools (Phase 06 new): ToolContext.signal
       ├─ shell (compat path): runCommand kills the child, audits
       │  `shell.cancelled`, reports cancelled (never success/timeout)
       └─ isolated-runner path: DOCUMENTED LIMITATION — the Trust environment
          API has no AbortSignal input; the command runs to its own timeout and
          cancellation lands at the loop's next checkpoint. XR does not pretend
          the environment stopped.
SIGINT (2nd) → force exit 130.
```

Semantics preserved: `cancellation_requested` is NOT side-effect-safe — a cancel
during an external mutation cannot prove the effect was avoided
(`record.cancellation.sideEffectPossible` + durable cancellation row carry that
truth; recovery honors unacknowledged cancellations first).

## 9. Startup recovery

`XRApp.start() → runStartupRecovery() → ExecutionService.startupRecovery()`:

```
recovery lease (no duplicate recovery across processes)
  → discover interrupted records (queued/running/observing/awaiting_*)
  → classify each (order): durable cancellation → audit-chain gate →
    checkpoint validity gate → authority gate → pre-flight safety →
    safe checkpoint → idempotency + crash-state analysis
  → record decisions durably → resume ONLY verified-safe work
  → quarantine dirty environments → release lease
  → persist measured duration for honest RTO reporting
```

Classification outputs: `auto_resume` / `requires_approval` / `blocked`, with
classifications `safe`, `unknown_side_effect`, `cancellation_pending`,
`environment_lost`, `authority_expired`, **`checkpoint_invalid` (new)**,
**`audit_chain_broken` (new)**.

**Checkpoint before resume claim (Step 5):** `resumeRecoverable()` calls
`recovery.verifyRecoveryBasis(record)` — load latest checkpoint → structural
validation → audit-chain gate → authority gate → side-effect safety of the
boundary. A failed basis is recorded as `blocked` and audited; `startupRecovery`
reports `recovery_blocked` for it. "Resumed" is only claimed after this passes.

Banner (Step 36): reports discovery honestly — `N recovered from a verified
checkpoint / N awaiting approval / N blocked`. The word "recovered" appears only
for executions actually resumed.

## 10. Crash recovery

Crash windows (Step 27) and XR's answer:

| Window | Durable evidence | Recovery behavior |
|---|---|---|
| 1. before tool exec | record queued→running persisted, slot pending | non_idempotent: reconciliation (cannot prove absence); keyed: re-run converges |
| 2. during tool exec | state running persisted (Phase 06 fix), slot pending | same as 1; sideEffectPossible=true |
| 3. after tool, before checkpoint | slot pending, checkpoint absent | idempotency slot decides (replay/converge/reconcile) |
| 4. after checkpoint, before completion | checkpoint present, slot pending | classify via checkpoint safety + slot |
| 5. after completion | record succeeded, slot completed | duplicates replay, effect never re-runs |

Real-process tests (SIGKILL child + parent restart over the same SQLite file)
pin windows 1–5, including the flagship duplicate-side-effect scenario: crash
after a non-idempotent effect → restart → second execution with the same key →
effect count stays 1, outcome `RECONCILIATION_REQUIRED`, audit chain intact.

## 11. Pruning policy

`CheckpointManager.pruneDetailed()` (bounded, never throws):
- eligibility: execution in terminal state AND checkpoint older than
  `CHECKPOINT_RETENTION_MS` (7 days) AND no unacknowledged durable cancellation
  (reconciliation evidence is protected);
- batch cap 1000 rows per invocation; real deletion count returned;
- required recovery checkpoints of active/unresolved runs are never eligible
  (terminal-state filter);
- scheduler: `checkpoint_pruner` background job (hourly tick, daily due-check
  via durable `checkpoint_prune_last_at` metadata; restarts neither repeat nor
  forget it). Prune started/completed/failed are audited with counts only
  (never payloads). A prune failure can never crash the runtime.

## 12. Provider failure behavior

Phase 04/05 ProviderGateway remains the ONLY provider path:
- kinds classified in `ProviderError` (retryable set: rate_limit, timeout,
  unavailable, provider_overload, network_failure); Phase 06 adds
  `malformed_response` (non-retryable vs same provider; fallback chain may try
  a different provider — that is a different operation, not a retry).
- request-guard bounds every call (default 120 s, config/env override) and keeps
  cancelled/timeout attribution honest.
- Fallback chain stays bounded primary → fallbackProvider → local; the
  reliability layer consumes it, never replaces it. After side effects, recovery
  consults checkpoint/idempotency state instead of re-running workflows.
- Fabric retry integration: `decideRetry()` gates retries — error class +
  side-effect class + idempotency + bounded budget (≤5 attempts absolute,
  120 s default deadline, bounded exponential backoff with ±20% jitter,
  retry-after honored as floor). Caller `isRetryable` predicates can veto, never
  override the safety gates.

## 13. Tool failure behavior

- Tools failing with transient classified errors (e.g. SQLITE_BUSY) may retry
  within budget IF the operation is side-effect-safe; otherwise no retry.
- Tool failures with unknown side-effect status on non-idempotent operations →
  `reconciliation_required`, slot marked, surfaced to the operator.
- Malformed tool calls (Step 30): unknown tool → `tool.blocked`
  (reason `unknown_tool`); non-object arguments → rejected BEFORE execution with
  `tool.malformed_call` audit. Both are deterministic, NON_RETRYABLE, and never
  mutate session state. Path escapes / secret leaks remain blocked by the
  security layer and classify NON_RETRYABLE.

## 14. Audit behavior

Audited (counts/identifiers only — never payloads/secrets): execution.created,
execution.retry, execution.retry_decision (verdict+category+code),
execution.lease_rejected, execution.reconciliation_required,
execution.recovery_blocked, execution.startup_recovery (discovered+durationMs),
checkpoint.prune_started/completed/failed, tool.blocked, tool.malformed_call,
shell.cancelled. Audit-chain integrity is a recovery hard boundary
(`verifyAuditChain` hook): a broken chain blocks all auto-resume.

## 15. Security behavior

Recovery cannot bypass PolicyEngine/ApprovalGate/path safety/secret scanning:
- authority snapshots are revalidated on resume (Step 24/49) — a checkpoint
  recorded under policy X grants nothing after policy rotates; the hook returns
  `authority_expired → blocked`;
- unacknowledged durable cancellations block resume ahead of everything;
- corrupted checkpoints block (never resume garbage);
- pruning never deletes evidence needed for reconciliation;
- secret redaction applies to provider error messages and the malformed-response
  factory.

## 16. RPO (honest)

Model: **checkpoint per lifecycle boundary.** Worst-case data loss on crash =
work performed since the last completed boundary (one step/tool turn). XR does
NOT claim zero data loss; `recovery.status.get` reports
`rpo.zeroDataLoss: false` with the boundary list.

## 17. RTO (honest)

Model: startup discovery + classification on next boot, bounded budget 5 s.
The ACTUAL measured duration of the last startup recovery is persisted
(`startup_recovery_last_duration_ms`) and reported by `recovery.status.get`
(measured: ~66 ms for 40 interrupted executions with checkpoints).

## 18. Known limitations

1. **Isolated environments are not cancellable mid-command** — the Trust
   service API has no AbortSignal input; cancellation lands at the next loop
   checkpoint. Documented in-tool; never reported as stopped when it is not.
2. **MCP/plugin operations** receive no signal today (their transports define
   none); they classify `unknown_unsafe` and recover via approval, not retry.
3. **Browser/computer-control tools** cannot be interrupted mid-action;
   same approval-based recovery applies.
4. Crash-window 1/2 cannot PROVE absence of an effect for non-idempotent
   operations — the slot was claimed before the effect, so XR conservatively
   reconciles. That is the at-most-once contract, not a bug.
5. Single-node scope: leases protect one host's processes (PID liveness), not
   distributed deployments (out of scope; documented since XR 4.3).
6. Recovery auto-resume resets records to `queued` — full mid-step continuation
   (true "resume inside a step") is future work; today's resume = safe
   re-execution from a verified boundary.
