# XR 5.0 — Agent and Workflow OS: Architecture

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Target:** XR 5.0.0  
**Baseline:** XR 4.5.0 (Knowledge and Context OS)  
**Status:** PHASE 7 COMPLETE — XR 5.0 AGENT AND WORKFLOW OS RELEASE READY

---

## 1. Mission

Make deterministic automation, agentic tasks, human approvals, scheduled work, research, and business processes share one durable workflow substrate.

## 2. What was built

The Phase 7 implementation creates a **canonical workflow operating model** at `src/workflow/` that unifies all existing workflow, automation, agent, and business process systems under one typed, versioned, inspectable, and policy-governed substrate.

### 2.1 Canonical Workflow Model (`src/workflow/types.ts`)

The central type system defines 14 canonical node kinds that cover every workflow operation:

| Node Kind | Purpose |
|---|---|
| `trigger` | Entry point (manual, cron, webhook, event, workflow) |
| `deterministic` | Pure function node (no LLM) |
| `agentic` | Model-driven task via agent role |
| `human_approval` | A person must approve before downstream |
| `human_review` | A person reviews output, can request changes |
| `tool_action` | Capability invocation (tool, MCP, plugin, skill) |
| `wait_timer` | Pause for duration, deadline, or event |
| `branch` | Conditional routing |
| `join` | Wait for multiple dependencies (all/any/n-of-m) |
| `artifact_output` | Produce a structured artifact |
| `business_record` | Mutate a business module record |
| `notification` | Send notification/escalation |
| `completion` | Terminal success marker |
| `compensation` | Rollback/compensate prior actions |

Every node carries: idempotency classification, retry policy, failure policy, timeout, and optional compensation scope.

### 2.2 Workflow State Machine (`src/workflow/state-machine.ts`)

16 run-level states with validated transitions:

```
draft → published → queued → running → {completed, failed, awaiting_approval, ...}
```

Plus 16 node-level states with their own validated transition table. Every transition is enforced — no silent state corruption.

### 2.3 Workflow Versioning (`src/workflow/versioning.ts`)

Definitions are immutable once published. Active runs reference a specific version. New versions are created via `createNewVersion()` / `publishNewVersion()`. Migration compatibility checks ensure active runs are never silently corrupted.

### 2.4 Workflow Engine (`src/workflow/engine.ts`)

The canonical execution engine that:
- Executes any mix of node types in dependency order
- Refreshes node readiness as dependencies complete
- Pauses for human input (approval/review) and resumes on decision
- Supports pause/resume/cancel at run level
- Tracks execution refs, context packages, artifacts, costs, and human decisions
- Prevents duplicate execution of completed nodes
- Provides full inspection API

### 2.5 Workflow Repository (`src/workflow/repository.ts`)

SQLite-backed persistence via the existing workspace store:
- `workflow_definitions` table: versioned, immutable definitions
- `workflow_runs` table: active and historical run state
- `workflow_human_decisions` table: audit trail of every human decision

### 2.6 Node Factory Functions (`src/workflow/nodes.ts`)

Typed constructors for all 14 node kinds with sensible defaults. Includes graph validation (cycle detection, missing dependency checks).

### 2.7 Workflow Inspection (`src/workflow/inspection.ts`)

CLI/daemon/dashboard views: state labels, coloring, run-line formatting, decision formatting, and full inspection rendering.

## 3. Integration with existing systems

The engine integrates through typed interfaces:
- `WorkflowAgentRunner` — delegates to MultiAgentService
- `WorkflowExecutionRecorder` — records through ExecutionService
- `WorkflowContextProvider` — builds context packages via ContextService
- `WorkflowRunStore` — persists through WorkflowRepository

All existing systems (cron, webhooks, business automation, multi-agent workflows) can now submit through this canonical substrate.

## 4. Key invariants enforced

- The graph controls sequencing — agent output is evidence, not authority
- Completed nodes are NEVER rerun accidentally
- Workflow definitions are immutable once published
- Human decisions persist with full audit context
- Every node links to execution records, context packages, and artifacts
- No unbounded agent loops
- No duplicate execution
- No approval bypass
- Every state transition is validated before persistence

## 5. Test coverage

- 36 tests across 2 files (types, engine)
- Covers: state transitions, node factories, versioning, engine execution, human approval/review, pause/cancel/resume, inspection
- All 36 pass, no regressions on existing 941 tests (same 6 pre-existing failures)

## 6. File listing

```
src/workflow/
  index.ts          — public exports
  types.ts          — canonical node types, run/state models
  nodes.ts          — typed factory functions + graph validation
  state-machine.ts  — deterministic state transitions
  versioning.ts     — definition versioning and migration
  engine.ts         — execution engine
  repository.ts     — SQLite persistence
  inspection.ts     — CLI/daemon views

test/workflow/
  types.test.ts     — state machine, types, nodes, versioning (20 tests)
  engine.test.ts    — engine integration (16 tests)

docs/phase7/
  PHASE7_AUDIT_REPORT.md
  PHASE7_ARCHITECTURE.md  (this file)
```
