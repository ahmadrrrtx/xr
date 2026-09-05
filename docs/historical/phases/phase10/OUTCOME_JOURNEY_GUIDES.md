# XR 5.3 — Outcome-Oriented Journey Guides

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Journey Definition Schema

Each journey defines:

- trigger/intent
- context package
- workflow version
- agent/deterministic/human nodes
- capabilities
- authority and approvals
- artifacts/records
- verified outcome
- cost/time
- audit/provenance
- failure/recovery

## 8 Representative Journeys

### 1. Personal Knowledge/Task Management — `personal-knowledge-capture`

- **Trigger:** Intent "capture notes" or CLI `xr business journeys start personal-knowledge-capture`
- **Context:** tiers instructions+data, includeUserMemory true, maxItems 15, locality private, sensitivity confidential
- **Workflow `personal-knowledge-v1`:** trigger → deterministic parse → agentic summarize → human_review → business_record create tasks → artifact_output doc → completion. Parallel key tasks.
- **Capabilities:** tasks.create, documents.create, context.package.build, intelligence.local
- **Authority:** Task creation auto low priority, review high/critical. Doc auto. No external writes.
- **Artifacts:** Document artifact + tasks records + evidence source notes
- **Outcome:** Document created, N tasks, linked to project if detected, provenance intact, cost $0.10, <30s
- **Failure:** Retry agentic once, human review expiry 24h → partially completed, compensation delete tasks if requested, checkpoint per node

CLI:

```bash
xr business journeys start personal-knowledge-capture --workspace ws1 --input '{"notes":"- [ ] Follow up client\n- [ ] Update plan\nMeeting Q4 goals"}' --json
```

### 2. Developer/Project Execution — `developer-project-delivery`

- Trigger: project.created event or CLI
- Context: project template, existing tasks, local-private
- Workflow: validate → create milestones → agentic plan doc → human_approval owner → activate → tool_action create docs folder → completion
- Authority: manager+, plan approval owner, $0.20
- Outcome: Project active, milestones, plan doc artifact

CLI:

```bash
xr business journeys start developer-project-delivery --input '{"projectName":"XR Demo","description":"..."}'
```

### 3. Research/Evidence/Reporting — `research-evidence-report`

- Trigger: "research X" intent
- Context: instructions+data+quarantine (web untrusted), local hybrid
- Workflow: deterministic plan queries → agentic search+rank → agentic extract+synthesize → artifact_output report → human_review → business_record KB article → completion
- Capabilities: research search/synthesize, knowledge.create, context.provenance
- Authority: Research auto, KB public requires review
- Outcome: Report artifact with citations, KB draft, trust score, sources count, $0.50
- Audit: Sources preserved, provenance hash

CLI:

```bash
xr business journeys start research-evidence-report --input '{"topic":"XR 5.3 competitive analysis"}'
```

### 4. Customer/CRM/Support — `customer-support-triage`

- Trigger: ticket.created
- Context: contact history, KB, private PII
- Workflow: deterministic classify SLA → tool lookup contact → branch urgent → notification escalate → agentic suggest KB → human_review → business_record assign → notification → completion, wait_timer SLA
- Capabilities: support.triage, contacts.read, context.retrieval, notification
- Authority: Triage auto, urgent support role, external email approval
- Outcome: Assigned, SLA tracked, KB attached, first response time measured

### 5. Sales/Follow-up — `sales-deal-progression`

- Trigger: deal.created/moved or CLI deals move
- Context: deal, contact, pipeline
- Workflow: validate transition → check required fields → branch value>threshold → human_approval manager high-value >10k → move deal → calc forecast → notify owner → tool_action follow-up task/invoice if won → completion
- Authority: Low auto, high-value manager approval, invoice >5k finance approval
- Outcome: Stage moved, forecast updated, follow-up task, invoice proposal, $0.05
- Failure: Lease on dealId prevents duplicate, compensation revert stage

CLI:

```bash
xr business journeys start sales-deal-progression --input '{"dealId":"deal-123","stageId":"qualified"}'
```

### 6. Projects/Meetings/Documents — `project-meeting-to-doc`

- Trigger: meeting.ended
- Context: transcript, attendees, related project, restricted sensitivity
- Workflow: deterministic parse transcript → agentic summary → artifact_output notes doc → human_review organizer → business_record create tasks → update meeting notes → completion
- Capabilities: meetings.read, documents.create, tasks.create
- Authority: Doc auto, tasks review high priority
- Outcome: Notes doc artifact, tasks, meeting linked, provenance transcript
- Privacy: transcript local-only, private routing

### 7. Scheduling/Communication — `scheduling-meeting-coordination`

- Trigger: "schedule meeting" intent
- Context: calendar, contacts, timezone, private
- Workflow: deterministic check availability → branch conflict → notification propose times → human_approval confirm → business_record create meeting → notification invite → artifact_output agenda → completion, wait_timer expiry
- Capabilities: calendar.check, meetings.create, notification
- Authority: Attendee workspace access check, external calendar sync requires approval (deferred)
- Outcome: Meeting scheduled, calendar events, invites, measured time

### 8. Finance/Operations — `finance-invoice-from-deal`

- Trigger: deal.won event
- Context: deal, contact, finance settings, confidential
- Workflow: validate → draft invoice → human_approval finance manager >5k → create invoice → tool_action send invoice external write elevated approval → completion
- Capabilities: finance.create_invoice, finance.send_invoice (external)
- Authority: Draft auto, send elevated approval + credential scoping
- Outcome: Invoice created, sent if approved, linked to deal, reversible cancel

## Verified Outcome Contract

Each journey produces `VerifiedOutcome`: outcomeId, journeyId, workflowRunId, recordsChanged, artifacts, evidenceRefs, metrics, cost (est/actual, tokens, duration), verifiedAt, reversibility.

Stored in `biz_outcomes`, query via:

```bash
xr business outcomes list --workspace ws1 --json
xr business outcomes show <outcomeId> --json
```

## Cost/Time Tracking

Via execution records + workflow cost aggregation. Each execution recorded via ExecutionBridge with durationMs. OutcomeTracker aggregates.

## Failure/Recovery

- Checkpoint per node (CheckpointManager)
- Lease prevents duplicate (LeaseManager)
- Recovery classification safe auto_resume vs requires_approval (RecoveryManager)
- Idempotency keys (e.g., `deal.move:<dealId>:<stageId>`) prevents duplicate mutation
- Compensation nodes revert prior actions

## CLI & Daemon

- CLI: `xr business journeys list`, `start`, `show`, `outcomes list/show`, `work-queue`
- Daemon: `/api/business/journeys`, `/api/business/journeys/:id/start`, `/api/business/outcomes`, `/api/business/outcomes/:id`

## Dashboard

Outcome-centered views without ERP-clone: work queues, active workflows, worker status, approvals, records changed, evidence/artifacts, cost/time, failures/recovery, audit/provenance. Progressive disclosure.

See BUSINESS_WORKFLOW_INTEGRATION.md for node details.
