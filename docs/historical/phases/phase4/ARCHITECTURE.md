# XR 4.3 — Durable Agency Architecture

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Version:** 4.3.0  
**Date:** 2026-07-25  
**Previous:** XR 4.2.0 (Trust and Isolation)

## Overview

Durable Agency makes long-running XR work survive process failure and interruption without losing task identity, authority context, execution history, or outcome integrity.

The governing rule is: **XR may resume known-safe work automatically, but it must never repeat an unknown external side effect merely because a process restarted.**

## Architecture

### 1. Durable State Model

XR 4.3 introduces a clear distinction between volatile and durable state across three new persistence tables:

| Table | Purpose |
|---|---|
| `execution_checkpoints` | Safe semantic boundaries for resume |
| `execution_leases` | Ownership guards preventing duplicate execution |
| `execution_recoveries` | Durable records of recovery decisions |
| `execution_cancellations` | Cancellation requests that survive restart |
| `environment_attachments` | Environment lifecycle tracking for recovery |

### 2. Checkpoint Manager (`src/execution/checkpoint.ts`)

Checkpoints are created at **safe semantic boundaries only** — never at every token or internal function call:

| Checkpoint Kind | When Created | Safe to Auto-Resume? |
|---|---|---|
| `task_accepted` | Execution record created | ✅ Always |
| `plan_recorded` | Workflow plan compiled | ✅ Always |
| `policy_admitted` | Policy/budget approved | ✅ Always |
| `env_admitted` | Environment provisioned | ✅ Always |
| `step_started` | Immediately before action | ⚠️ Depends on idempotency |
| `step_completed` | Action completed, observation known | ⚠️ Depends on idempotency |
| `model_turn_completed` | Model call succeeded | ⚠️ Depends on idempotency |
| `tool_call_completed` | Tool completed | ⚠️ Depends on idempotency |
| `cancellation_requested` | Cancel was asked for | ❌ Conservative |
| `review_checkpoint_reached` | At review gate | ✅ Always |
| `cleanup_completed` | Environment cleaned up | ✅ Always |
| `recovery_decided` | Recovery decision made | ✅ Always |

### 3. Lease Manager (`src/execution/lease.ts`)

Local ownership guards using (targetType, targetId) UNIQUE constraint:
- **Acquisition**: atomic `INSERT` — only one live process per target
- **Renewal**: same-owner returns existing lease with refreshed expiry
- **Stale detection**: `process.kill(pid, 0)` checks if owner is alive
- **Takeover**: stale lease can be taken over by new process
- **Release**: explicit on completion; unreleased on crash → stale

### 4. Recovery Manager (`src/execution/recovery.ts`)

#### Classification
```
interrupted record
    ↓
has durable cancellation? → YES → blocked (cancellation_pending)
    ↓ NO
was in-flight? → NO → auto_resume (safe)
    ↓ YES
has safe checkpoint? → YES → auto_resume (safe)
    ↓ NO
idempotent action? → YES → auto_resume (safe)
    ↓ NO
→ requires_approval (unknown_side_effect)
```

#### Recovery Actions
- **auto_resume**: safe to resume automatically (pre-action state, idempotent, or safe checkpoint)
- **requires_approval**: needs user to confirm (unknown side effect on non-idempotent action)
- **blocked**: cannot resume (cancellation pending, expired authority, quarantined env)
- **quarantined**: environment must be cleaned before any action

### 5. Startup Recovery

1. `XRApp.start()` → after service readiness → `ExecutionService.startupRecovery()`
2. Acquire recovery lease (prevents duplicate recovery)
3. Query `execution_records` for active states (queued, running, observing, awaiting_*)
4. Classify each record
5. Record recovery decisions durably
6. Auto-resume safe work
7. Notify user of blocked/approval-required items via health + events
8. Release recovery lease

### 6. Durable Cancellation

Cancellation requests are persisted to `execution_cancellations`:
- `requestCancellation()` → durable record created
- `acknowledgeCancellation()` → marks acknowledged with side-effect status
- On startup: cancellation records checked BEFORE any resume attempt
- Honest tracking: `sideEffectPossible: true` when action was running at cancel time

### 7. Backpressure

Bounded concurrency limits prevent resource exhaustion:

| Constant | Value |
|---|---|
| `MAX_ACTIVE_EXECUTIONS` | 50 |
| `MAX_RECOVERY_OPERATIONS` | 5 |
| `MAX_ACTIVE_ENVIRONMENTS` | 10 |
| `MAX_QUEUED_WORK` | 100 |
| `PER_WORKSPACE_CONCURRENT` | 20 |

### 8. Integration Points

| Subsystem | Integration |
|---|---|
| `ExecutionService` | Checkpoints at each lifecycle phase; lease acquisition |
| `XRApp` | Startup recovery in `start()`; graceful shutdown marking |
| `KernelHealth` | Recovery pending/blocked counts |
| CLI | `xr execution --recovery`, `--resume`, `--cancel` |
| Daemon | `GET /api/recovery`, `POST /api/recovery/resume` |

## Crash-Window Handling

| Window | Behavior |
|---|---|
| Before action starts | Auto-resume from last safe checkpoint |
| During model call | Mark reconciliation_required (unknown response) |
| After model call, before checkpoint | Detect missing checkpoint, mark recovery needed |
| During tool call | Mark side_effect_unknown |
| After tool, before outcome write | Detect missing outcome, check for evidence |
| During checkpoint write | Idempotent checkpoint; recover from previous |
| During environment cleanup | Detect incomplete cleanup, quarantine env |
| After cancel request, before ack | Honor durable cancel on restart |
| During retry creation | Detect partial retry, reconcile |
| During workflow task transition | Classify task correctly on restart |

## Explicit Limitations

- **Local only**: leases are single-process guards, not distributed consensus
- **No distributed workers**: Phase 11 (future) only
- **No automatic unsafe retry**: non-idempotent + unknown side effect = blocked
- **No Phase 5 capabilities**: no model routing, no memory redesign, no mailbox
- **Platform boundary**: lease stale detection uses `process.kill(pid, 0)` (POSIX); Windows fallback treats unknown PIDs as dead
