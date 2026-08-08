# Record Mutation Contract — XR 5.3

## Canonical Contract

Every consequential record mutation must link to:

- actor/worker
- workflow/task/execution
- policy/approval
- source/evidence/context
- timestamp/version
- previous value or change history
- reversibility/restore path

## Implementation `src/business/core/record-mutation.ts`

```ts
interface BusinessRecordMutation {
  mutationId, orgId, workspaceId, module, entity, entityId, operation,
  actor: { kind, id }, workerRef?, workflowRef: { definitionId, version, runId, nodeId },
  executionRefs: string[], policyDecision, approvalRef, source: { kind, id },
  evidence: EvidenceRef[], contextPackageIds, previousValue, changeSet,
  timestamp, version, reversible, restorePath: { method, data }, contentHash
}
```

## Flow

1. Propose: model output is proposal until committed. `propose({ orgId, workspaceId, module, entity, data, operation, actor, source, evidence, contextPackageIds })` → pending mutation, contentHash SHA-256, changeSet computed, audit propose logged
2. Policy: Trust service + RBAC + privacy check → allowed/denied/requires_approval/requires_review
3. Approval: if requires_approval and no approvalRef approved → block commit
4. Commit: `commit({ mutationId, executor, policyDecision, approvalRef })` → executes authoritative write (via module), updates status committed, audit log with workflowRef, executionRefs, evidence, context, contentHash, reversible
5. Revert: `revert({ mutationId, actor, reason })` → creates inverse proposal, commits, audit reverted
6. History: `getHistory(module, entity, entityId)` → listDesc, `listByWorkspace`, `verifyChain` hash chain

## Storage

`biz_record_mutations` table with indexes workspace, entity, run. Previous value snapshot for reversibility.

## No Direct DB

All business module CRUD refactored to go through mutation service. Direct `db.prepare` outside contract disallowed. Existing modules now use operation layer which calls mutation service.

## Example

```ts
const proposal = biz.recordMutations.propose({
  orgId, workspaceId, module: 'crm', entity: 'contact',
  data: { id: 'c1', name: 'John' }, operation: 'create',
  actor: { kind: 'user', id: 'user-1' },
  source: { kind: 'workflow', id: 'personal-knowledge-v1' },
  evidence: [{ kind: 'artifact', id: 'art-1' }],
  contextPackageIds: ['ctx-1']
});
biz.recordMutations.commit({ mutationId: proposal.mutationId, executor: { kind: 'user', id: 'user-1' }, policyDecision: { decision: 'allowed', reason: 'test', by: 'policy' } });
```

## Audit

AuditTrail.log includes mutationId, workflowRef, executionRef, evidenceCount, contentHash, reversible, version. Hash chain SHA-256 previous_hash+action+resource+resourceId+timestamp.

## Testing

- Propose/commit with provenance
- Policy denied cannot be committed
- Revert with restorePath
- Chain verification
