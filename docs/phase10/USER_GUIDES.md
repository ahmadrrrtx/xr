# XR 5.3 — User Guides — Personal and Business Operating Layer

## Overview

XR 5.3 runs durable, governed, evidence-linked intelligent work for individuals, developers, researchers, operators, and organizations. Outcomes, not internal agent theater.

Users see:

- What work was requested
- What XR changed
- Which records/documents/artifacts were produced
- What evidence supports it
- What requires approval
- What failed or remains uncertain
- What it cost/took
- How to undo/restore where possible
- Which worker/role acted

## Quick Start

### Initialize Business OS

```bash
xr business init
xr business status
```

### List Outcome-Oriented Journeys

```bash
xr business journeys list
xr business journeys list --json | jq
```

8 journeys:

- personal-knowledge-capture
- developer-project-delivery
- research-evidence-report
- customer-support-triage
- sales-deal-progression
- project-meeting-to-doc
- scheduling-meeting-coordination
- finance-invoice-from-deal

### Start a Journey

```bash
# Personal knowledge capture
xr business journeys start personal-knowledge-capture --workspace ws1 --input '{"notes":"- [ ] Follow up client\nMeeting Q4 goals"}'

# Developer project delivery
xr business journeys start developer-project-delivery --input '{"projectName":"My Project"}'

# Research evidence report
xr business journeys start research-evidence-report --input '{"topic":"Market analysis"}'

# Sales deal progression
xr business journeys start sales-deal-progression --input '{"dealId":"deal-123","stageId":"qualified"}'

# Finance invoice from deal
xr business journeys start finance-invoice-from-deal --input '{"dealId":"deal-123","contactId":"contact-456"}'
```

Each start returns runId, outcomeId, journey.

### Outcomes — Verified Measurable Results

```bash
xr business outcomes list --workspace ws1
xr business outcomes show <outcomeId>
xr business outcomes show <outcomeId> --json
```

Shows:

- Title, summary, status pending/verified/failed/reverted
- Records changed (module/entity/id/operation)
- Artifacts (with hash, sensitivity, provenance)
- Evidence refs
- Metrics (tasks_created, document_created, etc)
- Cost: estimated vs actual USD, tokens in/out, duration ms
- Verified at, by
- Failure reason if failed
- Reversibility / restore path

### Work Queue — Approvals / Escalations

```bash
xr business work-queue
xr business approvals
xr business approvals --json
```

Shows grouping by severity:kind, pending counts, critical count, evidence, uncertainty.

To approve:

```bash
xr business approvals decide <approvalId> approved --comment "LGTM"
xr business approvals decide <approvalId> denied --comment "Need more info"
```

Human attention defined:

- Requires approval: high-value finance >$5k, deal >$10k, external write (send invoice), sensitive data, public KB publish
- Auto: low-value deal moves, low priority tasks, document drafts, research search
- Review: research synthesis, meeting summary, worker proposal
- Info: KPI update, forecast recalculated, task completed

### AI Worker Status

```bash
xr business workers list
xr business workers list --json
xr business workers inspect <workerId>
xr business workers disable <workerId> --reason "budget exceeded"
xr business workers enable <workerId>
```

Inspection shows effective authority, budget used/remaining, risk tier, allowed workflows, data access, escalation.

Workers have narrow authority:

- sales_director only contacts/deals/documents, single-workspace, budget $0.50/day
- financial_analyst local-only private, only invoices/expenses
- hr_manager restricted sensitivity, local-only

Disabled workers cannot execute, credentials revoked, audit preserved.

### Artifacts & Evidence

```bash
xr business artifacts --workspace ws1
```

Each artifact has content hash, provenance actor/sources/context/execution, linked records, sensitivity, location.

Verification:

```bash
xr business outcomes show <outcomeId> --json | jq .artifactsDetail
```

### Privacy — Local/Private Operation

```bash
xr business privacy --workspace ws1
```

Modes:

- local: no cloud transfer
- private: no restricted data cloud transfer, confidential requires approval
- hybrid: allows cloud with policy

Sensitive domains (HR salary, meeting transcript, credentials) operate locally/private where supported. Cloud transfer requires policy/consent.

### Audit & Provenance

```bash
xr business audit verify --workspace ws1 --org org1
xr business audit verify --json
```

Integrity: hash chain, mutation chain, outcomes count.

Tamper-evident and exportable.

### Cost/Time

- Outcome cost tracked via execution records
- Budget per worker enforced
- Show via outcomes list and `xr business status`

### Undo/Restore

Where reversible, restore path stored:

```bash
xr business mutations --workspace ws1
```

History via `getHistory(module, entity, entityId)` and revert via `recordMutations.revert(mutationId, actor, reason)`.

### Daemon / Dashboard

- Dashboard: http://localhost:3141 (token required)
- API: 
  - GET /api/business/status
  - GET /api/business/journeys
  - POST /api/business/journeys/:id/start
  - GET /api/business/outcomes
  - GET /api/business/outcomes/:id
  - GET /api/business/approvals
  - POST /api/business/approvals/:id/decide
  - GET /api/business/artifacts
  - GET /api/business/workers
  - GET /api/business/workers/:id
  - POST /api/business/workers/:id/disable|enable
  - GET /api/business/mutations
  - GET /api/business/privacy/:workspaceId

JSON mode for non-TTY, machine readable.

Progressive disclosure: dashboard shows summary counts, drill into details via API/CLI.

Accessibility: keyboard operation, non-TTY JSON, screen-reader friendly output via output.ts theme.

### Examples — Full Flows

#### Personal Knowledge Capture → Tasks

1. Capture notes: `xr business journeys start personal-knowledge-capture --input '{"notes":"- [ ] Task A"}'`
2. Check outcome: `xr business outcomes show <outcomeId>`
3. Verify tasks created in projects module
4. Artifact doc created with provenance meeting notes

#### Sales Deal → Invoice

1. Create deal via CRM
2. Move deal: `xr business journeys start sales-deal-progression --input '{"dealId":"...","stageId":"qualified"}'`
3. If high-value, approval created → `xr business work-queue` → approve
4. When deal won event triggers finance-invoice journey → invoice draft, approval for send if >$5k → approve → invoice sent, linked to deal

#### Research → KB

1. `xr business journeys start research-evidence-report --input '{"topic":"Competitor X"}'`
2. Artifact report with citations, evidenceRefs
3. KB article draft created
4. Review via work-queue if public visibility

### Support

- `xr business help` for all subcommands
- `xr doctor --json` for diagnostics
- `xr business status --json` for machine health

No ERP-clone: users see outcomes, not internal theater.
