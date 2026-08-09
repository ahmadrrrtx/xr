# XR 4.0 → 4.1 Migration Guide

XR 4.1 (Unified Execution Fabric) is backward compatible with XR 4.0.
There are no breaking API changes to public types (`AgentResult`,
`ToolResult`, `ActionResult`, MCP results, plugin/skill results, workflow
records). All Phase 0/Phase 1 tests continue to pass.

## What's new

- A new `execution_records` table is created automatically on first run.
  The migration is additive; existing tables and records are not modified.
- The runtime now exposes an `ExecutionService` (`Tokens.Execution`)
  workspace-scoped service that provides the canonical execution contract.
- Model calls, tool calls, control actions, MCP calls, and workflow tasks
  now produce canonical execution records correlated by session/workflow.
- `xr execution` CLI command inspects execution history.

## Rollback

To roll back to XR 4.0:

1. Stop the XR daemon (`xr daemon stop` or equivalent).
2. Reinstall XR 4.0: `bun add -g @rrrtx/xr@4.0.0` (or npm equivalent).
3. Your existing XR 4.0 data (sessions, audit log, cost events, workflows,
   memory, research, business) remains intact. The `execution_records`
   table is ignored by XR 4.0 and can be dropped if desired (`DROP TABLE
   execution_records;`) — but dropping it is NOT necessary for 4.0 to run.

## Back up before migration

```bash
cp ~/.xr/xr.db ~/.xr/xr.db.before-4.1.bak
```

Rollback is the reverse: stop 4.1, restore the backup file, restart 4.0.

## Compatibility notes

- Existing audit entries are preserved. The fabric emits additional audit
  events (`execution.created`, `execution.outcome`, etc.) correlated via
  existing `session_id` — it does NOT duplicate audit or cost events.
- Cost is still charged exactly once per model/tool operation. Adapters
  route through existing cost governors and prevent double-charging.
- Approval gates are preserved. The fabric records normalized policy
  decisions alongside existing approval flows; it does not bypass them.
- Egress allowlists, control risk classification, plugin/skill
  permissions, and MCP fail-closed behavior are unchanged.

## Adapter migration for custom tools/services

If you are implementing a new tool or service and want it to flow through
the fabric, use the `ExecutionService.execute()` API:

```ts
const rec = await execution.execute({
  workspaceId: "default",
  actor: { kind: "user", source: "cli" },
  intent: { summary: "my action", origin: { kind: "user", source: "cli" } },
  capability: { kind: "core_tool", name: "my_tool" },
  placement: { kind: "in_process" },
  idempotency: "naturally_idempotent",
  inputSummary: JSON.stringify({ ...safeArgs }),
  approve: async (req) => promptUser(req),  // only if approval needed
  checkBudget: () => budgetGovernor.checkBeforeStep(),
  audit: (event, detail) => auditStore.audit(event, detail, sessionId),
  run: async (ctx) => {
    // do work; call ctx.recordUsage, ctx.addEvidence, ctx.addArtifact,
    // ctx.progress, and observe ctx.isCancelled()
    return { summary: "done", transportOk: true };
  },
});
```

Existing tools that implement the `Tool` interface from `src/core/types.ts`
automatically flow through the fabric when invoked via adapters.
