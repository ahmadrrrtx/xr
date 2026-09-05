# XR 5.3 — Business Workflow Integration — Canonical Workflow Engine

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Design Invariant

The graph controls sequencing. Agent output is evidence, not authority. Business modules must NOT create bespoke orchestration or policy engines. Use canonical workflow engine.

## Workflow Node Types (14 kinds from src/workflow/types.ts)

- trigger, deterministic, agentic, human_approval, human_review, tool_action, wait_timer, branch, join, artifact_output, business_record, notification, completion, compensation

## Integration Pattern

```
Intent/Trigger → Context Package → Workflow Definition (versioned, hash) → Node execution (deterministic/agentic/human) → Execution Record with Trust Classification → Artifact Output with Provenance → Business Record Mutation via Record Authority Contract → Audit hash chain → Outcome measurement → Failure/Recovery
```

Current bespoke `automation/engine.ts` is deprecated and wraps canonical engine where supported. Operating layer publishes 8 workflow templates:

- personal-knowledge-v1
- developer-project-v1
- research-evidence-v1
- customer-support-v1
- sales-deal-v1
- meeting-doc-v1
- scheduling-v1
- finance-invoice-v1

Each template created via `createWorkflowTemplateForJourney` with:

- deterministic content hash (FNV-1a)
- entryNodeIds
- nodes with retry { maxAttempts, backoffMs }, timeout, cost, tags
- versioned, active, publishedAt

Published via WorkflowEngine.publishDefinition.

Execution:

```ts
const run = await workflowEngine.startRun(definitionId, version, { initiatedBy: { kind: 'user', id, workspaceId }, resolvedParameters: input, tags: [category, id] });
await workflowEngine.executeRun(run.runId);
```

State machine validates transitions: draft → published → queued → running → waiting / awaiting_approval / awaiting_review / paused / failed / completed, etc.

Human decisions persist with full audit context: evidenceShown, requestedAt, decidedAt, expiresAt.

## Business Module Integration

Modules expose clear operations using canonical workflow nodes:

- CRM: contact.create via business_record node, evidence artifact contact source, execution record lease on contactId, RBAC via authority boundaries
- Sales: deal.move via business_record node with previous value for reversibility, approval for high-value via human_approval node, notification via notification node
- Projects: project.create via business_record, milestone creation deterministic, plan doc via artifact_output
- Documents: create doc via business_record + artifact_output with provenance linking to meeting transcript, task records
- Meetings: meeting notes via artifact_output with sensitivity confidential, provenance meetingId
- Scheduling: calendar check deterministic, availability branch, approval organizer, create meeting business_record, invite notification
- Finance: invoice draft deterministic, approval finance manager, create invoice business_record, send invoice tool_action tier2 requires elevated approval + credential scoping
- Support: ticket triage deterministic classify, lookup contact tool_action, escalate notification, suggest KB agentic, review human_review, assign business_record

All use:

- ExecutionBridge: recordExecution, lease acquisition, idempotency check, trust classification
- RecordMutationService: propose → policy → approval → commit → audit → reversible
- ArtifactEvidenceService: create artifact with provenance, link to record, verify hash
- ApprovalEscalationService: human nodes
- AuthorityBoundaryService: RBAC + workspace isolation
- LocalPrivacyService: locality enforcement

## Outcome Measurement

OutcomeTracker links workflow run to outcome, records changes, artifacts, evidence, cost/time, metrics. Verified outcome requires all nodes completed, artifacts hashed, audit valid.

## Failure/Restore

- CheckpointManager saves authority snapshot, side-effect safety
- LeaseManager prevents duplicate mutation
- RecoveryManager classifies safe auto_resume vs requires_approval, cancellation
- Compensation nodes attempt reverse
- Idempotency keys prevent duplicate record mutation

## CLI / Daemon

- CLI `xr business journeys start <id>` triggers workflow via operating layer, which calls workflow engine if available
- Daemon `/api/business/journeys/:id/start` same
- Dashboard shows active workflows, node states, human decisions, artifacts, cost

## No Visual Workflow Editor

Workflow definitions remain code/JSON, versioned, no UI editor per Phase 10 scope (Phase 11+ deferred).

## Testing

- workflow/engine.test.ts 8 tests green
- execution/service.test.ts 12 tests green
- operating-layer.test.ts end-to-end journeys using canonical engine fallback
