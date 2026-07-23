# XR 4.1 — Unified Execution Fabric

XR 4.1 introduces one canonical execution contract for every consequential
action in XR. After this phase, every agent step, tool call, control action,
MCP call, plugin/skill operation, workflow task, research operation, and
business action shares the same lifecycle, policy gating, observation,
outcome, and inspection model.

## Canonical lifecycle

```
Intent → Plan → Policy Decision → Placement → Action → Observation → Evidence/Artifact → Outcome
```

Each stage is distinct and typed. "Plan" is not authority; "Action" only
runs after a PolicyDecision permits it.

## Execution states

`created → planned → awaiting_policy → awaiting_approval → authorized →
queued → running → observing → (succeeded | partially_completed | failed |
cancelled | timed_out | denied | budget_blocked | unavailable |
reconciliation_required)`

Invalid transitions are rejected deterministically by
`src/execution/state-machine.ts`. No action runs before authorization;
no new action runs after cancellation/terminal.

## Key concepts

- **Identity:** `runId`, `correlationId`, `workspaceId`, optional
  `sessionId`/`workflowId`/`taskId`, `attempt`, `actor`, `capability`,
  `placement`.
- **Intent/Plan:** requested goal vs. proposed steps. Plan ≠ authority.
- **PolicyDecision:** `allowed | denied | requires_approval |
  approval_granted | approval_denied | approval_expired | budget_blocked |
  budget_raised | unavailable | cancelled | expired`.
- **Placement:** `in_process` (Phase 2, current local execution) with an
  explicit extension boundary for future worker/container/remote
  placements. **Phase 2 in-process placement does NOT provide Phase 3
  isolation.**
- **Action:** a single attempted operation with validated input metadata,
  idempotency class, timeout, and authorization reference.
- **Observation:** returned output/transport status; bounded payloads only.
- **Evidence/Artifact:** provenance records and durable outputs.
- **Cost:** estimated vs. actual; tokens, provider/model, charged exactly
  once.
- **Outcome:** `succeeded | failed | partially_completed | cancelled |
  timed_out | denied | budget_stopped | unavailable | awaiting_approval |
  reconciliation_required | dry_run_simulated`.

## Idempotency

Every action declares one of: `naturally_idempotent`, `idempotent_with_key`,
`non_idempotent`, `unknown_unsafe`. The fabric refuses to silently retry
non-idempotent actions when side-effect status is unknown; such outcomes
are recorded as `reconciliation_required` so the user can resolve ambiguity
honestly.

Caching: when an action with an `idempotencyKey` completes successfully,
subsequent executions with the same key return the prior result without
replaying the side effect.

## Cancellation and timeout

Cancellation is cooperative. The fabric sets a flag that the action's
`run(ctx)` can observe via `ctx.isCancelled()`. When an action cannot be
forcibly cancelled (JavaScript has no universal thread interruption), the
outcome is honest about whether a side effect may have occurred.

Timeouts race the action; if the action was mid-flight when the deadline
fires, the outcome is `timed_out` with `sideEffectUnknown: true`, blocking
automatic retry.

## Retry

Retry is opt-in via `isRetryable(err, attempt)`. The fabric only retries
when idempotency permits it and the side-effect is known to be safe.
Each retry is a new `attempt` under the same `correlationId`.

## Persistence

Execution records are persisted to `execution_records` in the workspace
SQLite store (additive migration, no destructive changes). Payloads are
truncated/redacted; no raw secrets or unlimited prompts/responses are
stored. Persistence failure never fabricates a success outcome — the
outcome is downgraded to `reconciliation_required` when durability fails.

## Kernel registration

The fabric is a workspace-scoped service registered via
`ExecutionServiceProvider` under `Tokens.Execution`. It depends on the
workspace store and audit repo, and participates in the lifecycle (cancels
in-flight executions on shutdown).

## Adapters

Adapters wrap existing action paths without replacing them:

- `adapters/tool-adapter.ts` — wraps `Tool.run()` for core/plugin/MCP tools.
- `adapters/agent-adapter.ts` — wraps `runAgent()` so each model turn and
  tool call produces a canonical record.
- `adapters/control-adapter.ts` — wraps `control.Action` execution with
  risk/approval correlation.
- `adapters/mcp-adapter.ts` — wraps MCP tools/resources/prompts.
- `adapters/plugin-adapter.ts` and `adapters/domain-adapter.ts` — wrap
  consequential plugin/skill, research, and business operations.
- `adapters/workflow-adapter.ts` — correlates multi-agent workflow tasks.

Existing `AgentResult`, `ToolResult`, `ActionResult`, MCP results,
plugin/skill results, and workflow records remain compatible; canonical
execution records are additive.

## Inspection / History

Use `ExecutionRepo.query({ workspaceId, ...filters })` for safe summaries.
The CLI command `xr executions` (or `xr execution <runId>`) prints
bounded summaries. All summaries are secret-free.

## Phase 3+ non-goals (explicit)

Phase 2 does NOT provide:

- Container/VM/Firecracker/gVisor isolation
- Cryptographic agent identity
- New security policy engine
- Event sourcing / replay
- Remote execution backends
- Automatic model/provider routing
- Memory redesign or progressive compression
- Visual workflow editor
- Multi-tenant cloud control plane

These are scheduled for later phases. XR 4.1 documents explicitly that
in-process execution is not a security sandbox.

## Files

- `src/execution/types.ts` — canonical types
- `src/execution/errors.ts` — structured execution errors
- `src/execution/state-machine.ts` — transition validation
- `src/execution/service.ts` — `ExecutionService` (the fabric)
- `src/execution/repository.ts` — SQLite persistence + redaction
- `src/execution/inspection.ts` — safe summaries for UX
- `src/execution/adapters/` — adapters for every existing action surface
- `src/core/providers.ts` — `ExecutionServiceProvider`
- `src/core/tokens.ts` — `Tokens.Execution`
- `src/state/workspace-store.ts` — additive `execution_records` table
