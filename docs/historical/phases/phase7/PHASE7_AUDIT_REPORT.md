# XR Phase 7 — Mandatory Repository Audit Report

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Baseline:** XR 4.5.0 (Phase 6 — Knowledge and Context OS)
**Target:** XR 5.0.0 (Phase 7 — Agent and Workflow OS)
**Status:** Phase 6 verified green (935/941 tests pass, typecheck clean)

---

## 1. Current Workflow Graph/State Inventory

| Asset | Location | Current State |
|---|---|---|
| Workflow types | `src/agents/types.ts` | WorkflowRecord, WorkflowTask, WorkflowStatus (8 states), TaskStatus (9 states) |
| Workflow compiler | `src/agents/planner.ts` | Deterministic graph compilation for 7 workflow kinds |
| Multi-agent runtime | `src/services/multi-agent-service.ts` | Execute/resume/cancel/delegate/synthesize with dependency tracking |
| Workflow persistence | `src/state/repos/workflow-repo.ts` | Thin facade over WorkspaceStore |
| Workflow events | `src/core/event-bus.ts` | In-memory typed events for task lifecycle |

**Gap:** No canonical node types (all tasks are agentic). No versioning. No human-specific nodes.

## 2. Automation Trigger/Action Inventory

| Asset | Location | Capability |
|---|---|---|
| Cron scheduler | `src/automation/cron.ts` | Natural-language schedules (daily/weekly/hourly/interval) |
| Webhook sender | `src/automation/webhook.ts` | Egress-gated POST with allowlist |
| Business automation | `src/business/modules/automation/engine.ts` | Event/schedule/webhook triggers, 10 step types, retry/skip/stop error handling |
| Workflow templates | `src/templates/workflows/` | 11 JSON templates (sales, support, marketing, etc.) |

**Gap:** Automation engine is separate from multi-agent service. No unified trigger model.

## 3. Agent Task Inventory

| Category | Count | Location |
|---|---|---|
| Core agents | 11 | `src/agents/registry.ts` (supervisor through security-checker) |
| Specialist agents | 12 | Optional — full_stack through support_ops |
| Agent permissions | 10 flags | writeFiles, shell, network, plugins, mcp, memoryRead, memoryWrite, computerControl, secrets, destructiveExec |
| Workflow kinds | 7 | general, research, build, refactor, security, automation, business |

## 4. Human Approval/Review Inventory

| Mechanism | Location | Detail |
|---|---|---|
| Task reviewState | `src/agents/types.ts` | not_required, pending, approved, changes_requested, rejected |
| Task approvalState | `src/agents/types.ts` | not_required, pending, approved, denied |
| requiresReview flag | `src/agents/types.ts` | Boolean on WorkflowTask |
| Review inference | `src/services/multi-agent-service.ts` | Pattern matching on reviewer output text |
| Control approvals | `src/control/` | classify→preview→approve→audit pipeline |
| Policy decisions | `src/execution/types.ts` | PolicyDecision union type with approval states |

**Gap:** No dedicated human approval node. Reviews are inferred from agent output text. No expiry, no explicit reviewer identity binding.

## 5. Artifact/Context/Execution Linkage

| Link Type | Location | Mechanism |
|---|---|---|
| Execution→Workflow | `src/execution/types.ts` | ExecutionId.workflowId, taskId |
| Context→Execution | `src/context/types.ts` | ContextLinks.runId, workflowId, taskId |
| Task→Output | `src/agents/types.ts` | AgentExecutionOutput with artifacts array |
| Execution→Artifact | `src/execution/types.ts` | ExecutionArtifact with ref and kind |
| Context Package | `src/context/service.ts` | ContextPackage with grant, tiers, rejected |

## 6. Retry/Idempotency/Compensation

| Feature | Location | Status |
|---|---|---|
| Task retry | `src/agents/types.ts` | retryCount, maxRetries per task |
| Resume retry | `src/services/multi-agent-service.ts` | Failed tasks get retry+1 on resume |
| Idempotency | `src/execution/types.ts` | 4-class system, idempotencyKey field |
| Duplicate detection | `src/execution/repository.ts` | findCompletedByIdempotencyKey |
| Step retry | `src/business/modules/automation/engine.ts` | onError: retry with retryCount |
| Compensation | — | **Not implemented** |

## 7. Version/Migration Analysis

| Component | Version | Notes |
|---|---|---|
| Execution adapter | `xr-4.3.0` | In execution/types.ts |
| Context policy | `xr-4.5.0/context-v1` | In context/types.ts |
| Workflow definitions | None | No versioning exists |
| Workflow migration | None | No migration support |

## 8. API/UX Impact Matrix

| Surface | Current | Phase 7 Change |
|---|---|---|
| CLI: `xr agents` | plan, run, status, stop, resume, delegate, review, synthesize, inspect, list | Add: `workflow create`, `workflow publish`, `workflow run`, `workflow approve`, `workflow review`, `workflow inspect`, `workflow history`, `workflow cancel --force` |
| Daemon: `/api/agents` | GET list, GET workflows/:id | Add: `/api/workflows` CRUD, approval routes |
| Dashboard | Workflow status via agents routes | Add workflow inspector, approval queue |

## 9. File-by-File Implementation Proposal

### New Files (Phase 7 core)

| File | Purpose |
|---|---|
| `src/workflow/types.ts` | Canonical workflow node types, states, versioning |
| `src/workflow/nodes.ts` | Node factory functions (deterministic, agentic, human, etc.) |
| `src/workflow/state-machine.ts` | Workflow state transition validation |
| `src/workflow/versioning.ts` | Definition versioning and migration |
| `src/workflow/engine.ts` | Canonical workflow execution engine |
| `src/workflow/repository.ts` | Versioned workflow persistence |
| `src/workflow/human-gate.ts` | Human approval/review persistence and expiry |
| `src/workflow/compensation.ts` | Compensation/rollback metadata |
| `src/workflow/inspection.ts` | Inspection and history views |
| `src/workflow/index.ts` | Public exports |

### Modified Files

| File | Change |
|---|---|
| `src/agents/types.ts` | Add node type discriminant, extend states |
| `src/services/multi-agent-service.ts` | Route execution through canonical workflow engine |
| `src/automation/cron.ts` | Submit triggers through workflow substrate |
| `src/business/modules/automation/engine.ts` | Compile business automations to workflow nodes |
| `src/daemon/routes/agents.routes.ts` | Add workflow CRUD + approval routes |
| `src/commands/agents.ts` | Add workflow commands |
| `src/core/providers.ts` | Register workflow engine provider |
| `src/core/tokens.ts` | Add workflow tokens |
| `src/state/repos/workflow-repo.ts` | Extend for versioned definitions |
| `src/state/workspace-store.ts` | Add workflow definition tables |

### Test Files

| File | Purpose |
|---|---|
| `test/workflow/types.test.ts` | Node types, state transitions |
| `test/workflow/engine.test.ts` | Engine execution |
| `test/workflow/versioning.test.ts` | Version migration |
| `test/workflow/human-gate.test.ts` | Approval/review lifecycle |
| `test/workflow/integration.test.ts` | End-to-end with agents, automation |

## 10. Later-Phase Items Deferred

- Visual workflow editor (Phase 9+)
- Remote/distributed workflow execution (Phase 11)
- Environment interaction nodes (Phase 8)
- Enterprise tenancy/control plane (Phase 12)
