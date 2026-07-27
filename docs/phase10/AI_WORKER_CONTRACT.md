# XR 5.3 — AI Worker Contract — Governed AI Workers

**Version:** XR 5.3.0 Work  
**Scope:** Defines narrow authority for AI workers per spec 6.2

## Principles

An AI worker is NOT a free-form autonomous agent with broad organizational access. It is a scoped, governed worker.

## Required Declarations (per spec 6.2)

Each worker must declare:

- **Role/Identity:** `role` (e.g., `sales_director`), `identity` (workerId, name, avatar, version). Example: sales_director v1.
- **Organization/Workspace Scope:** `organization: { orgId, workspaceIds, scope: single-workspace | multi-workspace | org-read }`. No worker accesses workspace outside its list unless org-read and RBAC allows.
- **Allowed Workflows:** `allowedWorkflows: string[]` list of definitionIds it may execute. Example: sales_director → `['sales-deal-v1','finance-invoice-v1','personal-knowledge-v1']`. Attempt to execute other workflow returns denied.
- **Context Scope:** `contextScope: { tiers, maxItems, allowUserMemory, allowWorkspaceMemory, sensitivityMax }`. Example: hr_manager sensitivityMax=restricted, maxItems 10, tiers instructions+data only.
- **Capabilities/Tools:** `capabilities: CapabilityDescriptor[]` from capability ecosystem, `toolScope: { mode: allowlist, tools: string[] }`. No ambient tools.
- **Model/Provider Scope:** `providerScope: { allowedProviders, allowedModels, routingPolicy, locality }`. Example: financial_analyst local-only, locality private, allowedProviders ['ollama','local'].
- **Budget:** `budget: { maxUsdPerTask, maxUsdPerDay, maxTokensPerTask, maxStepsPerTask }`. Enforced via BudgetService + worker tracker. Example: $0.20/task, $1/day.
- **Risk/Placement:** `risk: { maxTier: tier0|tier1|tier2|tier3, allowedPlacements, requiresHostAuthority }`. Workers with maxTier tier0 cannot execute tier2 external writes.
- **Approval/Review Requirements:** `approval: { autoAllowedActions, requiresApprovalActions, requiresReviewActions, approvalExpiryMs }`. Example: sales_director auto allowed contacts:create but requires approval for deals:move_to_won_high_value.
- **Data Access:** `dataAccess: { resources, fieldLevel?, crossWorkspace }`. Resources like `['contacts','deals']`. Field-level masks salary etc.
- **Success/Outcome Criteria:** `successCriteria: { outcomeMetrics, evidenceRequired, humanReviewRequiredFor }`. Example: deal_moved, forecast_updated.
- **Escalation Rules:** `escalation: { channels, severityThreshold, groupWindowMs, recipients }`. Channels dashboard/cli/webhook, grouping 5min window, recipients role owner.
- **Revocation/Disable Behavior:** `revocation: { disableRemovesAuthority, revokeCredentialsOnDisable, auditOnDisable }`. Disabled worker cannot execute; credentials revoked; audit entry written; no silent authority restoration.

## Effective Authority

Effective authority = declared ∩ policy ∩ grants - denied.

Computed via `WorkerGovernanceService.inspect(workerId)` and `capabilities/authority.ts`. Inspection returns:

- effectiveAuthority: resource -> actions
- activeExecutions
- recentOutcomes
- pendingApprovals
- budgetStatus { remainingUsd, remainingTokens, pctUsed }
- riskStatus { currentTier, placement, blocked }

## Enable/Disable

- Disable sets `enabled=false`, `disabledAt`, `disabledReason`, revokes credential refs, quarantines running executions, writes audit with previous hash.
- Enable clears disabled state.
- Disablement must not grant broader authority or silently revert committed records.

## Model Output is Proposal

All worker-generated record mutations go through `record-mutation.ts`:

1. Propose (evidence attached)
2. Policy check (trust service + privacy + RBAC)
3. Approval if required
4. Commit to authoritative table
5. Audit with workflow/execution/context/evidence

No direct DB mutation outside contract.

## Budget Enforcement

- Per-task and per-day USD/tokens enforced via BudgetService + `biz_worker_authority.budget.usedUsdToday`.
- `recordUsage(workerId, { usd, tokens })` increments.
- When budget exceeded, `canExecuteWorkflow` returns denied.

## Example Profiles

See `src/business/core/worker-contract.ts` narrowDefaultsForRole:

- ceo_advisor: org-read, 3 workflows read-only, confidential max, local-first, $2/day, tier0, approval for any write.
- sales_director: single-workspace, 3 workflows, internal, $0.50/day, auto contacts:create but approval high-value.
- financial_analyst: local-only, private, restricted to invoices/expenses, approval for send.
- hr_manager: local-only, private, restricted sensitivity, only employees/time_off.

## Security Checks

- Unauthorized record access/mutation denied via AuthorityBoundaryService.
- Worker escalation via ApprovalEscalationService when risk tier > maxTier or confidence low.
- Context leakage prevented via LocalPrivacyService sensitivity checks.
- Credential exposure prevented via trust/credential contracts (task_scoped refs).
- Cross-workspace leakage denied unless crossWorkspace true and deployer has access.
- Cloud transfer policy enforced.

## Developer Guide

To add a new worker:

```ts
const definition = { role: 'custom_role', name: 'Custom', capabilities: [...], ... };
const worker = biz.workers.deployWorker(workspaceId, definition, { orgId, deployerMemberId });
const profile = biz.workerGovernance.createProfile({ workerId: worker.id, role: definition.role, orgId, workspaceIds: [workspaceId], deployerMemberId });
```

To inspect:

```bash
xr business workers list --workspace ws1 --json
xr business workers inspect <workerId> --json
```

To disable:

```bash
xr business workers disable <workerId> --reason "budget exceeded"
```

Audit trail preserves all enable/disable events with hash chain.

## Testing

Unit tests in `test/business/operating-layer.test.ts`:

- Create profile with narrow authority
- Enable/disable revokes authority and audits
- Budget enforcement
- Risk tier enforcement
- Cross-workspace leakage prevention

Integration tests verify worker cannot exceed declared authority in complete journeys.

No placeholders, no unbounded autonomy.

## Deferrals

No remote/cloud/hybrid control plane, no multi-tenant distributed infra, no autonomous high-stakes decisions without human gates.
