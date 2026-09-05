# XR 5.3 — Developer Integration Guide — Personal and Business Operating Layer

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Goal

A developer must be able to add a business capability without creating a new orchestration, authorization, persistence, or audit model.

## Platform Contracts (Use, Don't Recreate)

- **Workflow:** `src/workflow/engine.ts`, `types.ts` — canonical workflow definitions, versioned, hash, entry nodes, 14 node kinds, state machine, human decisions.
- **Execution:** `src/execution/service.ts` — universal action envelope, idempotency, lease, checkpoint, recovery, budget, approval, dry-run.
- **Trust:** `src/trust/service.ts` — risk classification tier0-3, authority grants, placement, credential scoping, verification, cleanup.
- **Intelligence:** `src/intelligence/service.ts` — capability catalog, routing, local-only policy, fallback, explainable decision.
- **Context:** `src/context/service.ts` — context packages tiers instructions/data/quarantine, trust, consent, provenance, retrieval, injection, compression, policy.
- **Capability:** `src/capabilities/service.ts` — common descriptors, effective authority, dependency inspection, discovery, certification tests, install/update/disable/rollback.
- **Business Core:** `src/business/core/*` — database, audit (hash chain), bus, RBAC, organization, pipeline, contacts.

## Adding a Business Capability — Step by Step

### 1. Define Journey (if new outcome-oriented journey)

Edit `src/business/core/journeys.ts`:

```ts
{
  id: 'my-new-journey',
  name: 'My Journey',
  category: 'sales_followup', // or other
  description: '...',
  trigger: { kind: 'event', eventType: 'custom.event' },
  context: { tiers: ['instructions','data'], includeUserMemory: false, maxItems: 15, locality: 'private', sensitivityMax: 'internal' },
  workflow: { definitionId: 'my-journey-v1', version: 1, nodes: [ {id:'trigger',kind:'trigger',...}, ... ], capabilities: ['business:my.capability'], authority: { requiredRole: 'member', requiresApproval: false } },
  outcomes: { metrics: ['my_metric'], verifiedOutcomeType: 'my_outcome', costBudget: { maxUsd: 0.10, maxTokens: 5000, maxDurationMs: 20000 }, successCriteria: ['record created'] },
  artifacts: ['document'],
  privacy: 'private',
  version: 1, active: true, createdAt: new Date().toISOString(),
}
```

### 2. Workflow Template

`src/business/core/workflow-templates.ts` auto-generates template from journey. Or define custom template:

```ts
const def: WorkflowDefinition = {
  definitionId: 'my-journey-v1',
  version: 1,
  name: 'My Journey',
  description: '...',
  nodes: [
    { id: 'trigger', kind: 'trigger', triggerKind: 'event', eventType: 'custom.event', dependencies: [], ... },
    { id: 'validate', kind: 'deterministic', handler: 'my.validate', dependencies: ['trigger'], ... },
    { id: 'create_record', kind: 'business_record', module: 'my_module', operation: 'create', entity: 'my_entity', dependencies: ['validate'], reversible: true, ... },
    { id: 'notify', kind: 'notification', channels: ['dashboard','cli'], severity: 'info', message: 'Done', recipients: [{kind:'role',id:'member'}], dependencies: ['create_record'], ... },
    { id: 'complete', kind: 'completion', outcome: 'success', message: 'Completed', dependencies: ['notify'], ... },
  ],
  entryNodeIds: ['trigger'],
  active: true,
  tags: ['sales_followup','my-new-journey'],
  ...
};
```

Publish via `BusinessOperatingLayer` or `WorkflowEngine.publishDefinition`.

### 3. Record Mutation

Never direct DB. Use canonical contract:

```ts
const proposal = biz.recordMutations.propose({
  orgId, workspaceId,
  module: 'my_module',
  entity: 'my_entity',
  data: { id, ... },
  operation: 'create',
  actor: { kind: 'user', id: memberId },
  source: { kind: 'workflow', id: definitionId },
  evidence: [{ kind: 'artifact', id: artifactId }],
  contextPackageIds: [ctxPkgId],
});
biz.recordMutations.commit({ mutationId: proposal.mutationId, executor: { kind: 'user', id: memberId }, policyDecision: { decision: 'allowed', reason: '...', by: 'policy' } });
```

### 4. Artifact / Evidence

```ts
const artifact = biz.artifacts.createArtifact({
  workspaceId, orgId,
  contract: { kind: 'document', name: 'my-doc' },
  content: markdown,
  provenance: { actor: { kind: 'user', id }, sources: [{ kind: 'business_record', id }], contextPackageIds, executionRefs: [execId] },
  linkedRecords: [{ module: 'my_module', entity: 'my_entity', id }],
  sensitivity: 'internal',
});
biz.outcomes.attachArtifact(outcomeId, artifact.artifactId);
```

### 5. Execution Bridge

```ts
const exec = await biz.executionBridge.executeBusinessAction({
  orgId, workspaceId,
  module: 'my_module', entity: 'my_entity', entityId: id,
  operation: 'create',
  actor: { kind: 'user', id },
  inputSummary: 'Create my entity',
  capability: { kind: 'business', name: 'my_module.create' },
  idempotencyKey: `my_module:create:${id}`,
  workflowRef: { definitionId, runId, nodeId: 'create_record' },
});
```

Lease prevents duplicate, idempotency returns same executionId.

### 6. Authority / RBAC

```ts
const check = biz.authority.checkAccess({ memberId, workspaceId, orgId, resource: 'my_resource', action: 'create', dataSensitivity: 'internal' });
if (!check.allowed) throw new Error(check.reason);
if (check.requiresApproval) { biz.approvals.createRequest({...}); throw... }
```

Worker delegated:

```ts
const workerCheck = biz.authority.checkWorkerAuthority({ workerProfile, deployerMemberId, workspaceId, resource, action });
```

### 7. Privacy

```ts
const privacyCheck = biz.privacy.checkPrivacy({ workspaceId, orgId, resource: 'my_resource', sensitivity: 'confidential', operation: 'external_write', target: { isCloud: true } });
if (!privacyCheck.allowed) throw...
if (privacyCheck.requiresApproval) create approval...
```

### 8. Outcome

```ts
const outcome = biz.outcomes.createPending({ journeyId, journeyCategory, workflowRunId: runId, workspaceId, orgId, title, summary, costBudget });
biz.outcomes.recordChange(outcome.outcomeId, { module, entity, id, operation });
biz.outcomes.attachArtifact(outcome.outcomeId, artifactId);
biz.outcomes.updateCost(outcome.outcomeId, { actualUsd, tokensIn, tokensOut, durationMs });
biz.outcomes.verify(outcome.outcomeId, { verifiedBy: memberId });
```

### 9. AI Worker Contract

To add worker capability narrowing:

Edit `src/business/core/worker-contract.ts` narrowDefaultsForRole or create new role definition in `ai-workers/index.ts` WORKER_DEFINITIONS, then governance profile auto-narrows.

Example new role `custom_analyst`:

```ts
{
  role: 'custom_analyst',
  allowedWorkflows: ['my-journey-v1'],
  contextScope: { tiers: ['instructions','data'], maxItems: 10, sensitivityMax: 'internal' },
  dataAccess: { resources: ['my_resource'], crossWorkspace: false },
  ...
}
```

### 10. Tests

Add to `test/business/operating-layer.test.ts`:

- Record mutation propose/commit
- Outcome lifecycle
- Worker governance narrow
- Authority check
- Artifact provenance
- Approval classification
- Privacy enforcement
- Execution bridge idempotency
- End-to-end journey

### 11. CLI / Daemon

CLI auto-picks new journey via `journeys list`. No extra CLI code needed if journey defined. For custom module commands, add to `src/commands/business.ts` subcommand.

Daemon auto-exposes via `/api/business/journeys` static list. For custom routes, add to `src/daemon/routes/business.routes.ts` using `route({ id, path, method, handle })`.

### 12. Dashboard

Dashboard reads journeys via `/api/business/journeys`. New journey appears automatically. For custom outcome view, dashboard HTML already has generic rendering; no need to modify unless new artifact kind.

## Anti-Patterns (Do NOT)

- Do NOT create second identity system — use existing RBAC/business foundations
- Do NOT bypass RBAC, approval, budget, context, trust, execution — always via authority, privacy, execution bridge
- Do NOT let model output directly mutate authoritative records — propose → commit
- Do NOT add modules for feature count — only if missing primitive blocks verified journey
- Do NOT implement Phase 11 remote/cloud/hybrid control plane
- Do NOT add new workflow engine — use canonical
- Do NOT create disconnected business output formats — use artifact/provenance

## References

- `src/business/core/operating-layer.ts` central orchestrator
- `src/business/core/journeys.ts` journey definitions
- `src/business/core/workflow-templates.ts` template generation
- `src/business/core/record-mutation.ts` authority contract
- `src/business/core/worker-contract.ts` governance
- `src/business/core/artifact-evidence.ts` artifacts
- `src/business/core/approval-escalation.ts` human attention
- `src/business/core/local-privacy.ts` privacy
- `src/business/core/execution-bridge.ts` execution fabric
- `docs/phase10/*.md` guides
