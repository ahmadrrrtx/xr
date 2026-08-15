# Phase 06 — Final Reliability Report

**Phase:** XR Phase 06 — Reliability / Recovery / Durable Execution
**Baseline commit:** `7b667b0` (main, Phase 05 merge) · **Phase 00 baseline merge:** `4540e74`
**Environment:** Bun 1.3.14 · Node v20.20.2 · Linux x64
**Companion docs:** `PHASE_06_CURRENT_RELIABILITY_PATH.md` (pre-change snapshot), `PHASE_06_RELIABILITY.md` (design)

---

## BEFORE (state at 7b667b0)

Existing reliability mechanisms (all preserved):

| Mechanism | Location |
|---|---|
| CheckpointManager, safe kinds, bounded payloads, authority snapshots | src/execution/checkpoint.ts |
| Execution state machine, terminal/runnable/in-flight sets | src/execution/state-machine.ts |
| LeaseManager (PID liveness, takeover) | src/execution/lease.ts |
| RecoveryManager (discovery, classification, durable cancellation, env attachments) | src/execution/recovery.ts |
| Claim-first idempotency slots | src/state/idempotency.ts |
| Startup recovery + banner | src/core/app.ts |
| Provider error normalization + retryable kinds | src/providers/errors.ts |
| Request guard (bounded timeout, cancel attribution) | src/providers/request-guard.ts |
| Bounded fallback chain (primary → fallback → local) | src/providers/fallback-chain.ts |
| Cooperative SIGINT cancellation (exit 130, second-force) | src/commands/run-agent.ts |
| Crash-injection harness for persistence | test/reliability/crash-injection* |

Known gaps carried in (forensic ledger G1–G14): no canonical retry taxonomy;
checkpoint payload could persist invalid JSON; `env_admitted` /
`cleanup_completed` never written; no prune scheduler; resume claimed without
checkpoint verification; audit-chain / authority not consulted by recovery;
cancellation never reached tools/subprocesses; banner overclaimed; `xr status`
had no unresolved-work section and `xr execution` was unwired; `recovery.status.get`
lacked RPO/RTO; flat retry backoff with no taxonomy; malformed response/tool-call
handling unclassified and untested; fabric acquired no workflow leases; no DB
failure taxonomy.

## AFTER (this phase)

### Strengthened mechanisms
- **Checkpoints:** valid-JSON bounded payloads; unknown kinds rejected; corrupt
  rows tolerated on read; `verifyCheckpoint()`; `pruneDetailed()` returns real
  counts, protects unacknowledged-cancellation evidence; maintenance metadata
  table. New boundaries written: `env_admitted`, `cleanup_completed`.
- **Recovery:** `verifyRecoveryBasis()` gate — NO resume claim before a
  checkpoint is loaded + validated; audit-chain hook blocks all auto-resume
  (`audit_chain_broken`); authority revalidation hook (`authority_expired`);
  corrupted checkpoints block (`checkpoint_invalid`); startup recovery measures
  and persists its own duration (honest RTO).
- **Fabric:** persist-on-start (crash windows classify honestly); workflow lease
  gating (in-process liveness + cross-process durable lease,
  `WORKFLOW_LEASE_HELD`); canonical `decideRetry()` with bounded budget/backoff
  replacing flat retry; reconciliation transitions made state-machine-legal
  (`start → fail`); retries keep the SAME idempotency key.
- **Leases:** stale takeover fixed (dead row removed before re-insert — crashed
  work was previously unrecoverable due to the UNIQUE constraint).
- **Cancellation:** `ToolContext.signal`; runCommand kills subprocesses on
  abort with honest `cancelled` attribution; shell tool audits
  `shell.cancelled`; isolated-runner limitation documented in-tool.
- **Providers:** `malformed_response` kind + factory (secret-redacting);
  openai-compat chat() rejects invalid JSON / missing choices honestly; SSE
  garbage lines skipped without corrupting the stream.
- **Tools:** shell/git mutations reclassified `unknown_unsafe` (never
  auto-idempotent); malformed tool calls (unknown tool, non-object args)
  rejected pre-execution with audit.
- **CLI/UX:** honest banner (discovery ≠ recovery); `xr status` Durable Work
  section (+JSON); `xr execution` actually wired (loader + route + catalog +
  boot profile); `recovery.status.get` returns per-state counts + honest RPO/RTO.
- **Scheduler:** daily checkpoint pruning background job (durable due-check,
  audited, crash-proof).

### New mechanisms
- `src/execution/retry-classification.ts` — ONE taxonomy (retry/side-effect/
  recoverability), `classifyError`, `isRetryable`, `decideRetry`, bounded
  backoff + budgets, DB failure classification.
- `src/execution/status-summary.ts` — read-only unresolved-work summary.
- `src/commands/execution.ts` `ExecutionCommand` — CLI registration.

## Test matrix (Scenario / Expected / Actual / Status)

| Scenario | Expected | Actual | Status |
|---|---|---|---|
| A — normal execution | completed, audit valid, checkpoints at boundaries | `state=succeeded`, chain valid, task_accepted/policy_admitted/tool_call_completed present | ✅ PASS (golden suite) |
| B — provider failure (503) | bounded recovery, continue | retry verdict `retry`, attempt 2 succeeds, retryCount=1 | ✅ PASS |
| Provider timeout | retryable classification | `ProviderAbortError(timeout)` → retryable; cancelled stays distinct | ✅ PASS |
| C — tool failure (SQLITE_BUSY) | classify → retry when safe | transient retried once then succeeds; PATH_ESCAPE never retried | ✅ PASS |
| D — cancellation | request → cleanup → checkpoint → cancelled, side-effect honesty | cancelled + cleanup_completed checkpoint + durable cancel + `sideEffectUnknown=true` | ✅ PASS |
| Ctrl+C → provider | AbortSignal reaches transport | guardedRequest → `ProviderAbortError(cancelled)`, not timeout | ✅ PASS |
| Ctrl+C → tool/subprocess | child killed, audited cancelled | runCommand `error:"cancelled"` <3s; `shell.cancelled` audited | ✅ PASS |
| E — crash (SIGKILL child) | interrupted discovered, honest classification | discovery finds ex_crash_child; `unknown_side_effect` / `requires_approval` for non-idempotent running crash | ✅ PASS (real process) |
| F — duplicate side effect | exactly once | effect count stays 1; retry → `RECONCILIATION_REQUIRED`, no re-run; keyed variant converges | ✅ PASS (real process) |
| G — corrupted checkpoint | BLOCKED, never resumed | `checkpoint_invalid` → `recovery_blocked`; resume refused | ✅ PASS |
| G2 — corrupted audit chain | BLOCKED | `audit_chain_broken` blocks all auto-resume | ✅ PASS |
| Authority mismatch on resume | blocked, no privilege escalation | `authority_expired` via snapshot revalidation | ✅ PASS |
| Lease contention (same workflow) | second owner rejected | in-process + cross-process both → `WORKFLOW_LEASE_HELD`, effect never runs twice | ✅ PASS |
| Pruning | bounded, protective, real counts, never crashes runtime | 1000/batch (5000 rows in 6 runs, ~2ms each); active + unack-cancel protected; missing tables tolerated | ✅ PASS |
| Checkpoint ordering | tool → checkpoint → completion claim | instrumented event order asserted | ✅ PASS |
| Malformed provider response | classified, no fake success, no state corruption | `malformed_response` non-retryable; SSE garbage skipped | ✅ PASS |
| Malformed tool call | NON_RETRYABLE, policy enforced, honest error | unknown tool / invalid args rejected pre-execution, audited | ✅ PASS |
| DB failure taxonomy | busy=transient, corrupt=never-retry-loop | SQLITE_BUSY retryable; SQLITE_CORRUPT/IOERR non-retryable | ✅ PASS |
| Retry key stability (step 40) | same logical key across retries | one slot after 2 attempts; later duplicate replays | ✅ PASS |
| Recovery discovery performance (<5 s) | 40 interrupted records <5000 ms | 66–84 ms measured, persisted for RTO | ✅ PASS |
| RPO/RTO honesty | zeroDataLoss=false, measured RTO | contract test asserts both | ✅ PASS |
| `xr status` unresolved work | honest counts | CLI smoke: interrupted=1 / needs-approval=1 shown | ✅ PASS |

## Measured numbers

| Metric | Result |
|---|---|
| Startup recovery discovery+classification (40 executions) | **66–84 ms** (budget 5000 ms) |
| Checkpoint prune (5000 rows) | 5 × 1000 batches, **2–3 ms/batch**, 12 ms total |
| Full suite wall time | ~117 s (260 files) |

## Regression results

| Gate | Baseline (7b667b0) | After Phase 06 |
|---|---|---|
| `bun run typecheck` | PASS | PASS |
| `bun run boundaries` | PASS (546 modules / 1793 deps) | PASS (548 modules / 1804 deps) |
| `bun test` | 3140 pass / 19 skip / 0 fail | **3231 pass / 19 skip / 0 fail** (3250 tests, 262 files, 119.7 s) |

Net: **+91 passing tests, zero regressions** across Phases 00–05 (persistence
crash-injection, RPO/RTO drill, API contract, execution fabric, provider
gateway, streaming, security, a11y, golden path all green in the same run).

No Phase 00–05 behavior regressed. Two pre-existing gate encodings required
Phase-06-aware updates (documented, intent preserved): the size-gate waiver
register (service.ts +261, catalog.ts +20 — owned plan updated) and the Phase-5
"adapter-only" test (re-encoded from "zero kernel edits" to "no kernel file
routes the synthetic provider", because Phase 06 is mandated kernel reliability
work, while Art. VII's actual intent — provider routing stays in adapters — is
still enforced).

## Remaining issues (actual)

None blocking. Verified-open items are all documented limitations, not defects:
isolated environments are not mid-command cancellable (Trust API has no signal
input); MCP/plugin transports define no cancellation; crash-window 1/2
non-idempotent effects reconcile conservatively (at-most-once by design).

## Deferred (actual)

- True mid-step continuation on resume (today: verified-boundary re-execution).
- AbortSignal plumbing into the Trust environment runner (needs environment API
  change; documented limitation in-tool until then).
- Distributed lease protocol (single-node PID leases remain the documented scope).
