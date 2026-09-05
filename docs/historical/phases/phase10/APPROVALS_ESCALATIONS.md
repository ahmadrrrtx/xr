# XR 5.3 — Human Attention — Approvals / Escalations

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Requirement (Spec 6.6)

Define meaningful escalation:

- What requires approval
- What can be auto-executed
- What requires review
- What is informational
- How notifications are grouped/deferred
- What uncertainty is shown

Avoid approval fatigue and silent consequential automation.

## Classification (ApprovalEscalationService.classifyAttention)

| Action | Requires | Severity | Reason |
|--------|----------|----------|--------|
| External write (send invoice, external API, public KB publish) | approval | critical | External side effect irreversible |
| High-value finance >$5k, deal move >$10k | approval | warning | Financial risk |
| Sensitive data (HR salary, transcript, credentials) | approval | critical | Privacy |
| Low confidence <0.7 agentic output | review | warning | Uncertainty |
| Delete operation | review | warning | Reversible but consequential |
| Low-risk create/update internal, confidence >0.7 | auto | info | Fast path |
| KPI update, forecast recalculated, task completed | informational | info | Activity feed |

## Approval Flow

- Workflow human_approval node creates ApprovalRequest via ApprovalEscalationService
- Request includes: kind approval|review, title, description, severity, channels dashboard/cli/webhook/email/telegram, recipients user|role|webhook_url, evidence, artifacts, recordMutationId, contextShown { packageIds, summary, uncertainty { confidence, reasons } }, status pending, expiresAt
- Dashboard work queue shows card with evidence, expiry 2h-24h, approval level standard/elevated, budget impact, uncertainty badge
- CLI `xr business approvals list` or `work-queue` JSON
- Decision via `decide(approvalId, { decidedBy, outcome: approved|denied|changes_requested|rejected|expired, comment? })` → updates status, decidedAt, persists
- Workflow engine resumes via submitHumanDecision which links to execution record, policy decision, audit
- If denied, workflow stops or compensates, outcome marked failed
- Expiry: `expireStale()` marks expired approvals, workflow enters expired, partially_completed, or compensation_required

## Grouping / Deferral to Avoid Fatigue

- Group by workspace + severity + kind (e.g., warning:approval)
- Defer non-critical 5min window, max 20 per group
- Provide "approve all similar" for same type low-risk
- Batch notifications per workspace per 5min
- Dashboard shows counts, not spam

## Uncertainty Display

- Confidence score 0-1
- Trust scores from research sources
- Evidence coverage (how many sources)
- Contradictions detected
- Policy reason (why approval required)
- Budget impact

Example card:

```
Title: Approve high-value deal move: Big Deal $15k
Severity: warning
Requested by: user sales_director
Evidence: deal-123, pipeline-456
Artifacts: forecast-report
Context: High-value deal progression, value $15k > threshold $10k
Uncertainty: confidence 0.85, 0 contradictions
Expires: 2h
Recipients: role manager
Channels: dashboard cli
```

## Channels

- dashboard: work queue UI, right rail inspector
- cli: `xr business work-queue`
- webhook: POST to registered URL
- email/telegram: optional, configured per workspace

## Implementation

`src/business/core/approval-escalation.ts`:

- `createRequest(params)` → generates approvalId, now, expiresAt, persists to `biz_approvals`
- `decide(approvalId, { decidedBy, outcome, comment })` → checks expiry, updates status, persists
- `listPending(workspaceId, { limit, severity, kind })`
- `listByWorkflowRun(workflowRunId)`
- `getRequest(approvalId)`
- `expireStale()` → marks expired
- `getWorkQueue(workspaceId)` → pendingApprovals, pendingReviews, criticalCount, grouped

Table `biz_approvals`: approval_id, kind, org_id, workspace_id, workflow_run_id, node_id, requested_by_kind, requested_by_id, title, description, severity, channels JSON, recipients JSON, evidence JSON, artifacts JSON, record_mutation_id, context_summary, context_package_ids JSON, uncertainty JSON, status, decision JSON, expires_at, created_at, decided_at. Indexes workspace, run, status.

## Integration with Workflow Engine

- Human nodes in workflow templates create approval requests
- Workflow run pauses awaiting human input (state awaiting_approval / awaiting_review)
- `submitHumanDecision` resumes run
- Policy decision recorded in `WorkflowPolicyDecision`

## Testing

- Create, list, decide approval with expiry
- Classify attention avoids fatigue (auto vs approval vs review vs info)
- Work queue grouping
- Expiry handling
- Approval required for high-value finance, external writes
