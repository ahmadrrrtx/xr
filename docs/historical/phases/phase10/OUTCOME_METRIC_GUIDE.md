# Outcome / Metric Definition Guide — XR 5.3

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## VerifiedOutcome

```ts
interface VerifiedOutcome {
  outcomeId, journeyId, journeyCategory, workflowRunId, workspaceId, orgId,
  status: pending|verified|partial|failed|reverted,
  title, summary,
  recordsChanged: { module, entity, id, operation }[],
  artifacts: artifactIds, evidenceRefs,
  metrics: OutcomeMetric[],
  cost: { estimatedUsd, actualUsd, tokensIn, tokensOut, durationMs },
  verifiedAt, verifiedBy, failureReason,
  reversibility: { reversible, restorePath },
  createdAt, updatedAt
}

interface OutcomeMetric { name, value: number|string, unit?, target? }
```

## Metrics per Journey

- personal-knowledge-capture: tasks_created, document_created, duration_ms
- developer-project-delivery: project_active, milestones_created, plan_doc_created
- research-evidence-report: sources_count, evidence_blocks, report_citations, kb_published
- customer-support-triage: ticket_assigned, sla_tracked, kb_suggested, first_response_ms
- sales-deal-progression: deal_stage_moved, forecast_updated, followup_created, invoice_proposed
- project-meeting-to-doc: notes_doc_created, tasks_created_from_transcript, meeting_updated
- scheduling-meeting-coordination: meeting_scheduled, calendar_events_created, invites_sent, scheduling_duration_ms
- finance-invoice-from-deal: invoice_created, invoice_sent, total_value, linked_to_deal

## Cost/Time

- Budget per journey: maxUsd 0.05-0.50, maxTokens 2000-15000, maxDurationMs 20000-120000
- Actual tracked via ExecutionBridge execution records + OutcomeTracker.updateCost
- Metrics via addMetric
- Stats via getStats(workspaceId): total, verified, failed, pending, totalCost, avgDurationMs

## Verification

- Verified when all nodes completed, artifacts hashed, audit valid
- `verify(outcomeId, { verifiedBy, metrics })` → status verified, verifiedAt, verifiedBy
- `fail(outcomeId, reason)` → status failed
- `revert(outcomeId, restorePath)` → status reverted

## CLI

```bash
xr business outcomes list --workspace ws1 --json
xr business outcomes show <outcomeId> --json
```

Shows recordsChanged, artifacts with hash, evidence, cost, metrics, verifiedBy, failureReason, reversibility.

## Daemon

GET /api/business/outcomes, GET /api/business/outcomes/:id returns artifactsDetail + approvals.

## Testing

Create pending, recordChange, attachArtifact/evidence, updateCost, addMetric, verify, getStats.
