# XR 4.3 Durable Agency — Architecture Design

## 1. Durable State Model

Distinction between durable intent, plan, execution, checkpoints, attempts, environment, authority, observation, outcome, and recovery:

| Concept | Durable? | Store In | Purpose |
|---|---|---|---|
| Durable Intent | ✅ | ExecutionRecord.intent | What was asked |
| Durable Plan | ✅ | ExecutionRecord.plan | What was planned |
| Durable Execution | ✅ | execution_records + checkpoints | The canonical record |
| Durable Checkpoint | ✅ | execution_checkpoints (new) | Safe resume boundary |
| Durable Attempt | ✅ | ExecutionRecord.id.attempt | Which try |
| Durable Environment Attachment | ✅ | environment_attachments (new) | Can we reattach? |
| Durable Authority Snapshot | ✅ | checkpoint payload | Was authority valid then? |
| Durable Observation | ✅ | ExecutionRecord.observation | What was observed |
| Durable Artifact Ref | ✅ | ExecutionRecord.artifacts | What was produced |
| Durable Outcome | ✅ | ExecutionRecord.outcome | How it ended |
| Recovery Decision | ✅ | execution_recoveries (new) | What was decided |
| User Intervention | ✅ | Via recovery records | What user chose |

## 2. Checkpoint Model

Checkpoints at safe semantic boundaries:

| Checkpoint Kind | When | Side-Effect Safe? | Auto-Resume? |
|---|---|---|---|
| task_accepted | Agent task begins | ✅ (no action yet) | Yes |
| plan_recorded | Workflow plan compiled | ✅ (no action yet) | Yes |
| policy_admitted | Policy/budget approved | ✅ (no action yet) | Yes |
| env_admitted | Environment provisioned | ✅ (no action yet) | Yes |
| step_started | Immediately before action | ⚠️ (action not yet confirmed) | Yes (replay action) |
| step_completed | Action completed, observation known | ✅ (outcome known) | Yes |
| model_turn_completed | Model call succeeded | ✅ (response captured) | Yes |
| tool_call_completed | Tool completed | Depends on idempotency | Per idempotency class |
| cancellation_requested | Cancel was asked for | N/A | Honor cancel always |
| review_checkpoint_reached | At review gate | ✅ (no action) | Yes |
| cleanup_completed | Environment cleaned up | ✅ (resources released) | Yes |
| recovery_decided | Recovery decision made | ✅ (decision recorded) | Yes |

## 3. Recovery State Machine

States:
- running — normal execution
- checkpointed — checkpoint written, may resume
- interrupted — process died, recovery needed
- startup_recovery_pending — discovered at startup, not yet classified
- recoverable — can auto-resume
- resuming — recovery in progress
- resumed — recovery successful
- paused — user paused
- cancellation_requested — cancel asked for
- cancelled — cancel confirmed
- failed — execution failed
- retryable — can retry safely
- reconciliation_required — side-effect unknown, user must decide
- recovery_blocked — cannot resume (authority, env, policy)
- completed — done

Transitions:
```
interrupted → startup_recovery_pending  (on discovery at startup)
startup_recovery_pending → recoverable  (safe to resume)
startup_recovery_pending → reconciliation_required  (unknown side effects)
startup_recovery_pending → recovery_blocked  (expired authority, lost env)
recoverable → resuming  (begin recovery)
resuming → resumed  (recovery complete)
resumed → running  (back to normal)
```

## 4. Startup Recovery Sequence

1. Migration — ensure new tables exist
2. Discovery — query execution_records for running/queued/authorized states
3. Lease acquisition — prevent duplicate recovery
4. Classification — for each active record:
   a. Check for checkpoint → determine last safe boundary
   b. Check for durable cancellation → honor if present
   c. Check environment state → reattach or quarantine
   d. Classify recoverability (auto/approval/blocked)
5. Authority revalidation — re-check policy/credentials
6. Decision persistence — record recovery decision
7. Resume safe work — only auto-resumable items
8. Notify user — expose blocked/approval-required items
9. Release recovery lease

## 5. Lease/Ownership Model

Simple local lease:
- owner_pid: process.pid
- owner_instance_id: random UUID per process
- acquired_at: timestamp
- expires_at: optional, for stale detection
- released_at: set on normal release
- stale detection: check if owner_pid process exists
- Lease acquisition is atomic via INSERT OR IGNORE
- Prevents duplicate execution within same workspace

## 6. Retry Model

Build on Phase 2 idempotency:
- naturally_idempotent → safe retry always
- idempotent_with_key → safe retry with same key
- non_idempotent → NO retry if side-effect unknown
- unknown_unsafe → NO retry, reconciliation required
- Authority must be revalidated before retry
- Environment must be recreated/reattached
- Budget must still be available

## 7. Cancellation Model

Durable cancellation flow:
1. Cancel requested → write to execution_cancellations table
2. If process alive → attempt to stop action
3. If acknowledged → mark acknowledged in table
4. If side effect possible → mark side_effect_possible
5. On restart → check cancellations table FIRST
6. If cancelled + side_effect_possible → reconciliation_required
7. If cancelled + no side effect → mark cancelled

## 8. Backpressure Model

Bounded local limits:
- MAX_ACTIVE_EXECUTIONS: 50
- MAX_RECOVERY_OPERATIONS: 5
- MAX_ACTIVE_ENVIRONMENTS: 10
- MAX_QUEUED_WORK: 100
- PER_WORKSPACE_CONCURRENT: 20
- Exceeding limits → queued state, visible in status

## 9. Persistence and Retention

- Checkpoints: retain for active + 7 days after terminal
- Leases: auto-expire; cleanup stale on startup
- Recovery records: retain forever (auditable)
- Cancellations: retain while execution record exists
- Environment attachments: retain while execution record exists
- Bounded payloads: EXECUTION_BOUNDS apply

## 10. Authority Revalidation Model

On resume:
1. Re-evaluate policy (current rules, not stale snapshot)
2. Re-check workspace permissions
3. Re-check credentials (may have expired)
4. Re-check placement/isolation availability
5. Re-check budget remaining
6. Re-check approvals (may have expired)
7. If any check fails → recovery_blocked
8. A prior authorization is NOT automatically valid after restart
