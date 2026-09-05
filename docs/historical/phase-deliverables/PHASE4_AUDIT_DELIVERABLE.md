# XR 4.3 Durable Agency — Pre-Implementation Audit

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../README.md); for what changed since, see [`docs/HISTORY.md`](../../HISTORY.md).


**Date:** 2026-07-25  
**Baseline:** XR 4.2.0 at commit `eed9fde`  
**Auditor:** Implementation Agent  
**Status:** Complete — ready for Phase 4 implementation  

---

## SECTION A: Baseline Verification

### A.1 Repository Checkout
- **Branch:** `main`
- **Commit:** `eed9fde54ab97e0bf59c71c0cfd2ec0a86c2ebe5`
- **Package:** `@rrrtx/xr` @ `4.2.0`
- **Bun:** 1.3.14
- **TypeScript:** 5.9.3

### A.2 Prior-Phase Validation

| Gate | Result | Notes |
|---|---|---|
| `bun install` | ✅ Clean | 8 packages, 186ms |
| `bun run typecheck` | ✅ Pass | No errors |
| `bun test` | ✅ 682/684 pass | 2 failures are OS-sandbox dependent (namespace/bubblewrap not available in container) |
| Phase 1 kernel | ✅ Pass | Lifecycle, service registry, workspace isolation all verified |
| Phase 2 execution | ✅ Pass | State machine, repository, service, adapters all verified |
| Phase 3 trust/isolation | ✅ 98% pass | 2 sandbox-dependent tests fail in this environment but pass where backends exist |

**Conclusion:** Baseline is healthy. The 2 test failures are environment-specific (container without OS namespace support), not code defects. Phase 4 may proceed.

---

## SECTION B: Volatile-State Inventory

### B.1 Execution Service (`src/execution/service.ts`)

| State | Location | Volatility | Risk on Restart |
|---|---|---|---|
| `live` Map (runId → ExecutionRecord) | Memory | **Volatile** | Lost — in-progress executions disappear |
| `cancelFlags` Map (runId → {cancelled, reason}) | Memory | **Volatile** | Lost — cancellation requests vanish |
| `listeners` Set | Memory | **Volatile** | Lost — streaming clients disconnected |
| ExecutionRecord.history transitions | Dual (memory + persisted via `persist()`) | Partially volatile | Safe if `persist()` called; lost if crash between transitions |

### B.2 Agent Loop (`src/core/agent.ts`)

| State | Location | Volatility | Risk on Restart |
|---|---|---|---|
| `messages[]` (conversation) | Memory | **Volatile** | Completely lost |
| `stepIdx` | Memory | **Volatile** | Loop position lost |
| `governor` (CostGovernor) | Memory | **Volatile** | Budget state lost |
| `sessionId` | Memory | **Volatile** | Session identity lost |
| `extraToolMap` | Memory | **Volatile** | Tool registry references lost |
| Provider connection | Memory | **Volatile** | In-flight call silently dropped |
| Session store writes | SQLite (via sessionStore) | **Durable** | Step records persist |
| Cost store writes | SQLite (via costStore) | **Durable** | Cost records persist |
| Audit store writes | SQLite (via auditStore) | **Durable** | Audit trail persists |

### B.3 Multi-Agent Service (`src/services/multi-agent-service.ts`)

| State | Location | Volatility | Risk on Restart |
|---|---|---|---|
| Workflow execution loop (`executeWorkflow`) | Memory (while loop) | **Volatile** | Loop position lost |
| `record.cancellationState` | Persisted via workflow store | **Durable** (but not checked at startup) | Cancellation survives but not honored on restart |
| `record.status` | Persisted | **Durable** | Status survives |
| `task.status` | Persisted | **Durable** | Task status survives |
| In-flight `runTask` promises | Memory | **Volatile** | Tasks silently abandoned |

### B.4 Trust Environments

| State | Location | Volatility | Risk on Restart |
|---|---|---|---|
| EnvironmentManager internal state | Memory (via manager) | **Volatile** | Active environments lost |
| AuthorityRegistry active grants | Memory | **Volatile** | All grants vaporized |
| EnvironmentInfo (pid, state) | Memory | **Volatile** | Running process references lost |
| Environment lifecycle state | Only in-memory | **Volatile** | Unknown child process status on restart |

### B.5 Daemon/Clients

| State | Location | Volatility | Risk on Restart |
|---|---|---|---|
| SSE connections | Memory | **Volatile** | Disconnected |
| In-flight HTTP requests | Memory | **Volatile** | Dropped |
| TUI/CLI state | Memory | **Volatile** | Terminal lost |

---

## SECTION C: Durable-State Inventory

### C.1 What IS Persisted

| Entity | Storage | Schema Table | Field Count |
|---|---|---|---|
| ExecutionRecord | SQLite `execution_records` | `record_json` (JSON blob) + indexed columns | 18+ columns |
| WorkflowRecord | SQLite `agent_workflows` | JSON-like persistence | Via workspace store |
| WorkflowTask | SQLite `agent_tasks` | JSON-like persistence | Via workspace store |
| Session steps | SQLite `steps` | Normalized rows | Full |
| Audit events | SQLite `audit_log` | Normalized rows | Full |
| Cost events | SQLite `cost_events` | Normalized rows | Full |
| Memory entries | SQLite `memory` | Normalized rows | Full |
| Session summaries | SQLite `session_summaries` | Normalized rows | Full |
| Workspace config | File system + SQLite | Mixed | Full |

### C.2 What is NOT Persisted (Gaps)

| Gap | Impact |
|---|---|
| Checkpoints at safe boundaries | Cannot resume an agent mid-loop |
| Ownership/lease records | No protection against duplicate execution |
| Recovery decisions | No durable record of what was decided |
| Durable cancellation | Cancellation requests lost on restart |
| Environment attachment records | Cannot reattach or detect orphaned environments |
| Progress/partial results beyond final | Intermediate work lost |
| Attempt lineage beyond retryCount | Parent/child attempt relationships fragile |

---

## SECTION D: Checkpoint Map

### D.1 Current Safe Boundaries (Implicit)

| Boundary | Where | What's Saved |
|---|---|---|
| Session creation | `runAgent` start | Session record + audit event |
| Each model turn | `provider.chat()` | Step record + cost event |
| Each tool invocation | `tool.run()` | Step record + audit event |
| Session completion/error | `runAgent` end | Final status + audit |
| Execution record finalization | `service.finalize()` | Full ExecutionRecord |

### D.2 Required New Checkpoints

| Checkpoint | When | Purpose |
|---|---|---|
| TASK_ACCEPTED | Agent task begins | Records intent + identity |
| PLAN_RECORDED | Workflow plan compiled | Records planned steps |
| POLICY_ADMITTED | Policy/budget approved | Records authorization |
| ENV_ADMITTED | Environment ready | Records placement + grant |
| STEP_STARTED | Before model/tool call | Records what's about to happen |
| STEP_COMPLETED | After model/tool call | Records outcome + evidence |
| CANCELLATION_REQUESTED | Cancel requested | Durable cancel record |
| CANCELLATION_ACKNOWLEDGED | Cancel confirmed | Records cancel outcome |
| REVIEW_REACHED | At review gate | Records review state |
| CLEANUP_COMPLETED | After cleanup | Records cleanup result |
| RECOVERY_DECIDED | Recovery decision made | Durable recovery record |

---

## SECTION E: Side-Effect/Retry/Recovery Matrix

| Action Type | IdempotencyClass | Safe Retry? | Unknown Side Effect | Recovery Rule |
|---|---|---|---|---|
| model_call | non_idempotent | ❌ | Provider may have executed | Reconciliation required |
| read_file | naturally_idempotent | ✅ | N/A | Safe auto-resume |
| write_file | non_idempotent | ❌ (except with key) | May have written partial file | Check file state, require approval |
| shell (idempotent_cmd) | idempotent_with_key | ✅ (same key) | May have executed | Reconcile or verify |
| shell (destructive) | non_idempotent | ❌ | Unknown | BLOCK — reconciliation required |
| mcp_tool | varies | Per tool contract | Unknown | Per tool contract |
| plugin_operation | varies | Per plugin contract | Unknown | Per plugin contract |
| control_action | varies | Per action type | May have occurred | Per action type |
| browser_action | non_idempotent | ❌ | Unknown | BLOCK — reconciliation required |
| git_operation | naturally_idempotent | ✅ | N/A | Safe auto-resume |
| web_fetch | non_idempotent | ❌ | May have fetched | Safe auto-resume (read-only) |

---

## SECTION F: Workflow Restart Analysis

### Current Behavior
- `resumeWorkflow()` resets failed/cancelled tasks to ready/pending
- Increments `retryCount`
- Re-enters `executeWorkflow()` while loop
- Does NOT check if the process was restarted
- Does NOT check if tasks were in "running" state (side-effect unknown)
- Does NOT revalidate authority/credentials

### Required Behavior
- On startup, discover workflows with status=running
- Classify each running task:
  - If completed before crash → mark completed
  - If pre-action → reset to ready (safe)
  - If in-action with unknown side effect → mark reconciliation_required
  - If post-action (observation collected) → verify outcome, mark completed
- Revalidate authority/credentials for resumed workflows
- Do NOT blindly replay running tasks

---

## SECTION G: Environment Restart/Reattachment Analysis

### Current Behavior
- Environments are created and destroyed per-action
- No persistent environment identity across process boundaries
- Cleanup is triggered in finally block of `TrustService.evaluate()`
- If process dies during cleanup, environment may be orphaned

### Required Behavior
- Persist environment identity (backendId, placement, tier, workspaceId)
- On startup, discover environment records
- Attempt reattachment for still-valid environments
- Quarantine unreattachable or stale environments
- Never reuse an environment with unknown child process state
- Track cleanup status: pending/succeeded/partial/failed/quarantined

---

## SECTION H: Lease/Ownership Analysis

### Current State
- No ownership/lease mechanism exists
- Two concurrent XR processes could execute the same workflow
- No stale-owner detection

### Required Design
- Simple local ownership record keyed by runId/workflowId
- Owner identity: processId + runtimeInstanceId
- Acquired at execution start, released at finalize
- Stale detection: if owner processId no longer exists, lease is stale
- Startup recovery acquires lease before resuming any work
- Lease prevents duplicate execution within the same workspace

---

## SECTION I: Schema/Migration Proposal

### New Tables Required

```sql
-- Checkpoints: safe semantic boundaries
CREATE TABLE IF NOT EXISTS execution_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workflow_id TEXT,
  task_id TEXT,
  checkpoint_kind TEXT NOT NULL,       -- task_accepted, step_started, step_completed, etc.
  side_effect_safe INTEGER NOT NULL,  -- 1 = safe to auto-resume, 0 = requires intervention
  authority_snapshot TEXT,            -- JSON: policy/credentials valid-at time
  environment_ref TEXT,               -- environmentId if attached
  progress_summary TEXT,
  payload_json TEXT NOT NULL,         -- full checkpoint data
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_records(run_id)
);

CREATE INDEX IF NOT EXISTS idx_cp_run ON execution_checkpoints(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_workflow ON execution_checkpoints(workflow_id, created_at DESC);

-- Ownership/lease records
CREATE TABLE IF NOT EXISTS execution_leases (
  lease_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,          -- 'execution' | 'workflow' | 'task'
  target_id TEXT NOT NULL,            -- runId | workflowId | taskId
  workspace_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_instance_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER,
  released_at INTEGER,
  release_reason TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_lease_target ON execution_leases(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_lease_workspace ON execution_leases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lease_stale ON execution_leases(stale, acquired_at);

-- Recovery decisions
CREATE TABLE IF NOT EXISTS execution_recoveries (
  recovery_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  recovery_action TEXT NOT NULL,      -- auto_resumed | requires_approval | blocked | quarantined
  classification TEXT NOT NULL,       -- safe | unknown_side_effect | authority_expired | env_lost
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,           -- 'system' | 'user'
  decided_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_target ON execution_recoveries(target_type, target_id);

-- Durable cancellation requests
CREATE TABLE IF NOT EXISTS execution_cancellations (
  cancellation_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  acknowledged_at INTEGER,
  side_effect_possible INTEGER NOT NULL DEFAULT 0,
  final_state TEXT                     -- cancelled | reconciliation_required
);

CREATE INDEX IF NOT EXISTS idx_cancel_target ON execution_cancellations(target_type, target_id);

-- Environment attachment records
CREATE TABLE IF NOT EXISTS environment_attachments (
  attachment_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  placement TEXT NOT NULL,
  tier TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,       -- created|starting|ready|running|stopping|stopped|failed|quarantined
  pid INTEGER,
  created_at INTEGER NOT NULL,
  last_known_at INTEGER NOT NULL,
  cleanup_state TEXT,                  -- not_required|succeeded|partial|failed|pending
  quarantined INTEGER NOT NULL DEFAULT 0,
  quarantine_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_env_exec ON environment_attachments(execution_id);
CREATE INDEX IF NOT EXISTS idx_env_ws ON environment_attachments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_env_state ON environment_attachments(lifecycle_state);
```

---

## SECTION J: API/UX Impact Matrix

| Surface | New/Changed | Impact |
|---|---|---|
| CLI `xr execution list` | Add `--recovery` filter | Show interrupted/recovering work |
| CLI `xr execution resume <id>` | New command | Resume a recoverable execution |
| CLI `xr execution cancel <id>` | Enhanced | Durable cancellation |
| CLI `xr execution status <id>` | Enhanced | Show recovery state, checkpoint progress |
| CLI `xr workflow resume <id>` | Enhanced | Recovery-aware resume |
| Daemon `GET /api/execution/:id` | Enhanced response | Include recovery state, checkpoints |
| Daemon `POST /api/execution/:id/resume` | New endpoint | Resume execution |
| Daemon `POST /api/execution/:id/cancel` | Enhanced | Durable cancel |
| Daemon SSE | Enhanced events | Recovery events |
| Dashboard | New recovery view | Show interrupted work, recovery status |
| TUI status bar | Enhanced | Show recovery pending count |

---

## SECTION K: Failure-Injection Test Matrix

| Crash Window | Test Name | Expected Behavior |
|---|---|---|
| Before action starts | crash-pre-action | Auto-resume from last checkpoint |
| During model call | crash-during-model | Mark reconciliation_required (unknown response) |
| After model call, before checkpoint | crash-post-model | Detect missing checkpoint, mark recovery needed |
| During tool call | crash-during-tool | Mark side_effect_unknown |
| After tool, before outcome write | crash-post-tool | Detect missing outcome, check for evidence |
| During checkpoint write | crash-during-checkpoint | Idempotent checkpoint; recover from previous |
| During environment cleanup | crash-during-cleanup | Detect incomplete cleanup, quarantine env |
| After cancel request, before ack | crash-cancel-unacked | Honor durable cancel on restart |
| During retry creation | crash-during-retry | Detect partial retry, reconcile |
| During workflow task transition | crash-workflow-transition | Classify task correctly on restart |
| Double process startup | crash-double-startup | Lease prevents duplicate execution |
| During lease renewal | crash-lease-renewal | Stale lease detected, takeover safe |

---

## SECTION L: Deferred Phase 5+ Issues

These are explicitly NOT implemented in Phase 4:

1. **Automatic model routing** — Phase 5 only
2. **Multimodal routing** — Phase 5 only
3. **Memory/context redesign** — Phase 6 only
4. **Progressive compression tiers** — Phase 6 only
5. **Visual workflow editor** — Phase 8/9 only
6. **Remote execution / distributed workers** — Phase 11 only
7. **Multi-tenant cloud control plane** — Phase 12 only
8. **Enterprise compliance features** — Phase 12 only
9. **Mailbox/team messaging system** — Phase 7 only (unless minimal recovery handoff required)
10. **Provider/model performance routing** — Phase 5 only
11. **New model classes** — Phase 5 only
12. **Browser/voice/vision expansion** — Phase 8 only
