# XR 5.3 — Personal and Business Operating Layer — Architecture Design

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../README.md); for what changed since, see [`docs/HISTORY.md`](../../HISTORY.md).

**Baseline:** XR 5.2.0 Capability Ecosystem (Phase 9 green)  
**Target:** XR 5.3.0  
**Date:** 2026-07-27  
**Scope:** Outcome-oriented journeys, governed AI workers, authoritative records, artifacts/evidence, organization boundaries, human escalation, local/private operation, CLI/daemon/dashboard.

---

## 6.1 Outcome-Oriented Journeys

We select 8 representative journeys, one per domain, fully productionized. Each journey defines per spec:

### Journey Definition Schema (to be implemented in `journeys.ts`)
```ts
interface JourneyDefinition {
  id: string; // e.g. "personal-knowledge-capture"
  name: string;
  category: "personal" | "developer" | "research" | "customer" | "sales" | "projects" | "scheduling" | "finance";
  description: string;
  trigger: TriggerSpec; // intent: voice, CLI, event, schedule, manual, webhook
  context: ContextPackageSpec; // tiers, inclusion, locality
  workflow: WorkflowSpec; // definitionId, version, nodes, capabilities, authority
  outcomes: OutcomeSpec; // verified outcome, cost/time budget, success criteria
  audit: AuditSpec; // provenance, artifacts, approval linkage
  failure: FailureSpec; // recovery, compensation, rollback
  privacy: PrivacySpec; // local/private enforcement
}
```

#### Journey List

1. **Personal Knowledge/Task Management — `personal-knowledge-capture`**
   - **Trigger:** User intent: "capture meeting notes and create follow-up tasks" → CLI `xr biz journey start personal-knowledge-capture` or voice intent or manual.
   - **Context Package:** Tiers: `instructions` (user memory + workspace rules), `data` (recent meetings, projects, contacts), `quarantine` (none). Locality: local-private. Include user memory true, include recent artifacts 5.
   - **Workflow Version:** `personal-knowledge-v1` — Nodes: trigger → deterministic (parse notes, extract tasks) → agentic (summarize, suggest tags, research optional) → human_review (user confirms tasks) → business_record (create tasks) → artifact_output (document) → completion. Parallel key: tasks.
   - **Capabilities:** Required: `business:tasks.create`, `business:documents.create`, `context:package.build`, `intelligence:routing.local`. Tools: file, memory, skill.
   - **Authority/Approvals:** Task creation auto for low priority, requires review for high/critical priority. Document creation auto. No external writes.
   - **Artifacts/Records:** Document artifact (meeting notes), tasks records (business_record nodes), evidence: source meeting notes.
   - **Verified Outcome:** Document created, N tasks created, linked to project if detected, provenance chain intact.
   - **Cost/Time:** Budget maxUsd $0.10, maxSteps 8, maxTokens 8000. Time < 30s local.
   - **Audit/Provenance:** Every task mutation links actor=user, workflow=personal-knowledge-v1 runId, executionRefs, contextPackageId, previousValue null, reversible via task delete.
   - **Failure/Recovery:** If agentic node fails, retry once. If human review expired (24h), workflow enters awaiting_review expired → partially completed, compensation: delete created tasks if user requested. Checkpoint per node.

2. **Developer/Project Execution — `developer-project-delivery`**
   - Trigger: `project.created` event or CLI `xr biz projects add` with flag `--journey`.
   - Context: tiers: instructions (project template), data (existing tasks, milestones), local-private.
   - Workflow `developer-project-v1`: trigger → deterministic (validate project fields) → branch (if tasks present) → deterministic (create milestones) → agentic (generate project plan doc, optional research best practices) → human_approval (owner approves plan) → business_record (update project status active) → tool_action (skill: create docs folder) → completion.
   - Capabilities: `business:projects.create`, `business:tasks.create`, `business:documents.create`, `capability:skill.execute`.
   - Authority: Project creation requires role manager+. Plan approval requires owner. Budget $0.20.
   - Outcome: Project active, milestones created, plan doc artifact, tasks linked.
   - Failure: Checkpoint after approval, recovery via project repo. Duplicate trigger guarded by lease on projectId.

3. **Research/Evidence/Reporting — `research-evidence-report`**
   - Trigger: User intent "research X and produce evidence report" → CLI `xr biz research <topic>` or `xr research` existing command but now via journey.
   - Context: tiers instructions + data (knowledge base) + quarantine (web sources untrusted). Use research engine's evidence ledger.
   - Workflow `research-evidence-v1`: trigger → deterministic (plan queries) → agentic (search + ranking via research engine) → agentic (extract + synthesize) → artifact_output (report markdown) → human_review (reviewer approves) → business_record (create knowledge article) → completion.
   - Capabilities: `research:search`, `research:synthesize`, `business:knowledge.create`, `context:provenance`.
   - Authority: Research auto, KB article creation requires review if visibility public.
   - Outcome: Report artifact with citations, KB article draft, trust score, sources count.
   - Cost: $0.50 max, tokens 15000, time <2min.
   - Audit: All sources preserved, provenance hash, previous value null, reversible delete article.

4. **Customer/CRM/Support — `customer-support-triage`**
   - Trigger: `ticket.created` event (support inbound) or contact created.
   - Context: data (contact, history, KB), local-private for PII.
   - Workflow `customer-support-v1`: trigger → deterministic (classify priority, check SLA policy) → tool_action (lookup contact) → branch (if urgent) → notification (escalate to support role) → agentic (suggest KB articles via context retrieval) → human_review (agent approves suggestion) → business_record (update ticket status + assign) → notification (inform contact channel?) → completion. Includes wait_timer for SLA.
   - Capabilities: `business:support.triage`, `business:contacts.read`, `context:retrieval`, `control:notification`.
   - Authority: Triage auto, assignment requires support role if urgent, external communication (email) requires approval.
   - Outcome: Ticket assigned, SLA tracked, KB suggestions attached, satisfaction field set later, measurable first response time.
   - Failure: If SLA timer expires → escalate, recovery via notification retry.

5. **Sales/Follow-up — `sales-deal-progression`**
   - Trigger: `deal.created` or `deal.moved` or CLI `xr biz deals move`.
   - Context: deal, contact, pipeline, recent activities.
   - Workflow `sales-deal-v1`: trigger → deterministic (validate stage transition) → deterministic (check required fields) → branch (value > threshold) → human_approval (manager approves high-value move to closed_won) → business_record (move deal) → deterministic (calculate forecast) → notification (owner) → tool_action (create follow-up task or invoice if closed_won) → completion.
   - Capabilities: `business:deals.move`, `business:finance.create_invoice`.
   - Authority: Low-value auto, high-value (>10k) requires manager approval, invoice creation requires finance approval if >5k.
   - Outcome: Deal stage moved, forecast updated, follow-up task created, invoice proposal if won, cost minimal ($0.05).
   - Failure: Lease on dealId prevents duplicate move, compensation: revert stage move via previous value.

6. **Projects/Meetings/Documents — `project-meeting-to-doc`**
   - Trigger: `meeting.ended` event or manual.
   - Context: meeting transcript, attendees, related project.
   - Workflow `meeting-doc-v1`: trigger → deterministic (parse transcript, extract action items) → agentic (generate notes summary) → artifact_output (meeting notes doc) → human_review (organizer reviews) → business_record (create tasks for action items) → business_record (update meeting notes) → completion.
   - Capabilities: `business:meetings.read`, `business:documents.create`, `business:tasks.create`.
   - Authority: Doc creation auto, task creation requires review for high priority.
   - Outcome: Notes doc artifact, tasks created, meeting linked.
   - Privacy: Meeting transcript highly sensitive → local-only routing, context scope private.

7. **Scheduling/Communication — `scheduling-meeting-coordination`**
   - Trigger: "schedule meeting with X" intent or CLI `xr biz meetings add --journey`.
   - Context: calendar events, contacts, workspace timezone.
   - Workflow `scheduling-v1`: trigger → deterministic (parse attendees, check availability via calendar) → branch (conflict?) → notification (propose times) → human_approval (organizer confirms) → business_record (create meeting) → notification (invite attendees) → artifact_output (agenda doc if needed) → completion. Includes wait_timer for response expiry.
   - Capabilities: `business:calendar.check`, `business:meetings.create`, `control:notification`.
   - Authority: Meeting creation requires attendee workspace access check, notification auto, external calendar sync would require approval (deferred).
   - Outcome: Meeting scheduled, calendar events created, invites notified, measured scheduling time.
   - Failure: If approval expired, compensate delete meeting draft.

8. **Finance/Operations (where existing sufficient) — `finance-invoice-from-deal`**
   - Trigger: `deal.won` event (from sales journey) or manual `xr biz invoices add --dealId`.
   - Context: deal, contact, finance settings, currency.
   - Workflow `finance-invoice-v1`: trigger → deterministic (validate deal value, contact) → deterministic (create invoice draft) → human_approval (finance manager approves if >5k or if customer new) → business_record (create invoice) → tool_action (send invoice external write → requires elevated approval) → completion.
   - Capabilities: `business:finance.create_invoice`, `business:finance.send_invoice` (external).
   - Authority: Draft auto, send requires elevated approval + credential scoping.
   - Outcome: Invoice created, sent (if approved), linked to deal, measurable total, reversible via cancel.
   - Failure: If approval denied → invoice remains draft, error chain recorded. Checkpoint before external write.

Each journey includes explicit idempotency keys (e.g., `deal.move:<dealId>:<stageId>`), lease targets, checkpoint safety classification.

---

## 6.2 AI Worker Contract

Per spec, each worker declares narrow authority.

### Worker Authority Profile Schema (`worker-contract.ts`)
```ts
interface WorkerAuthorityProfile {
  role: WorkerRole; // ceo_advisor etc
  identity: { workerId: string; name: string; avatar?: string; version: number };
  organization: { orgId: string; workspaceIds: string[]; scope: "single-workspace" | "multi-workspace" | "org-read" };
  allowedWorkflows: string[]; // e.g. ["sales-deal-v1", "customer-support-v1"]
  contextScope: { tiers: ("instructions"|"data"|"quarantine")[]; maxItems: number; allowUserMemory: boolean; allowWorkspaceMemory: boolean; sensitivityMax: "public"|"internal"|"confidential"|"restricted" };
  capabilities: CapabilityDescriptor[]; // from capability ecosystem: { kind, name, owner, declared authority }
  toolScope: { mode: "allowlist"; tools: string[] }; // tools allowed
  providerScope: { allowedProviders: string[]; allowedModels: string[]; routingPolicy: "local-only"|"local-first"|"cost-constrained"|"manual"; locality: "local"|"private"|"hybrid" };
  budget: { maxUsdPerTask: number; maxUsdPerDay: number; maxTokensPerTask: number; maxStepsPerTask: number };
  risk: { maxTier: RiskTier; allowedPlacements: PlacementKind[]; requiresHostAuthority: boolean };
  approval: { autoAllowedActions: string[]; requiresApprovalActions: string[]; requiresReviewActions: string[]; approvalExpiryMs: number };
  dataAccess: { resources: string[]; fieldLevel?: Record<string, string[]>; crossWorkspace: boolean };
  successCriteria: { outcomeMetrics: string[]; evidenceRequired: boolean; humanReviewRequiredFor: string[] };
  escalation: { channels: NotificationChannel[]; severityThreshold: "info"|"warning"|"critical"; groupWindowMs: number; recipients: NotificationRecipient[] };
  revocation: { disableRemovesAuthority: boolean; revokeCredentialsOnDisable: boolean; auditOnDisable: boolean };
  status: { enabled: boolean; disabledReason?: string; disabledAt?: number; lastActiveAt?: number; budgetUsedToday: number };
}
```

### Governance Enforcement

- **Inspection:** `GET /biz/workers/:id/authority` returns effective authority = declared ∩ policy ∩ grants - denied, using `capabilities/authority.ts` effective authority function.
- **Enable/disable:** Disabling sets enabled false, revokes credential refs via CredentialVault, writes audit entry with previous hash, quarantines any running executions via LeaseManager.
- **Budget:** Per-task and per-day USD/tokens enforced via existing `budget-service.ts` + worker budget tracker in `biz_worker_authority`.
- **Escalation:** When worker encounters uncertainty > threshold or risk tier > maxTier, notifies via NotificationNode and pauses workflow awaiting human review.
- **Data Access:** Context retrieval filters by sensitivityMax and fieldLevel; cross-workspace denied unless org-read scope and RBAC passes.
- **Model Output is Proposal:** All worker-generated record mutations go through `record-mutation.ts` propose → approval → commit, never direct DB.

### Worker Definitions Migration
Existing 8 workers mapped:
- ceo_advisor → org-read, 6 workflows read-only, context sensitivity confidential, local-first, budget $1/day $0.20/task, maxTier safe, placements in_process only, approval for any write.
- sales_director → single-workspace, workflows sales-deal-v1, finance-invoice-v1, context internal, budget $0.50/day etc.
- Others similarly narrowed.

No worker gets `*` permissions; each gets minimal resources.

---

## 6.3 Business Record Authority

### Canonical Mutation Contract

```ts
interface BusinessRecordMutation {
  mutationId: string;
  orgId: string;
  workspaceId: string;
  module: string;
  entity: string;
  entityId: string;
  operation: "create"|"update"|"delete";
  actor: { kind: "user"|"worker"; id: string };
  workerRef?: string; // if worker
  workflowRef?: { definitionId: string; version: number; runId: string; nodeId: string };
  executionRefs: string[]; // ExecutionRecord ids
  policyDecision?: { decision: "allowed"|"denied"|"requires_approval"; reason: string; by: string };
  approvalRef?: { decisionId: string; decidedBy: string; outcome: string };
  source: { kind: "user_input"|"workflow"|"automation"|"integration"|"worker_proposal"; id?: string };
  evidence: EvidenceRef[]; // citations, context items, artifact ids
  contextPackageIds: string[];
  previousValue?: Record<string, unknown>; // full previous snapshot for reversibility
  changeSet: Record<string, { before: unknown; after: unknown }>;
  timestamp: number;
  version: number; // monotonic per entity
  reversible: boolean;
  restorePath?: { method: string; data: Record<string, unknown> };
  contentHash: string; // SHA-256 of mutation content for integrity
}
```

### Flow

1. **Propose:** Model output / worker / automation calls `record-mutation.propose(data)` → creates mutation in `pending` state, evidence attached, no DB write to authoritative table yet.
2. **Policy Check:** Trust service classifies, RBAC checks, capability effective authority checks, privacy checks.
3. **Approval:** If requires_approval/review, creates HumanDecision via workflow human nodes, stored in `biz_approvals` + workflow repo.
4. **Commit:** Upon allowed/approved, writes to authoritative table inside transaction, also writes to `biz_record_mutations` + `biz_audit` + execution record + artifact linkage. Generates previousValue snapshot.
5. **Audit:** AuditTrail.log includes workflowRef, executionRef, contextPackageIds, evidenceRefs, changeSet, hash chain.
6. **Reversibility:** If reversible, stores restorePath (e.g., previous snapshot). `revert` operation creates inverse mutation with same provenance.
7. **No Direct DB Mutations:** All business module CRUD methods refactored to go through mutation service. Direct `db.prepare` outside contract is disallowed via code review + new lint rule (to be enforced in tests).

### Tables

- `biz_record_mutations` — Stores all mutations.
- `biz_audit` extended with new columns: workflow_id, execution_id, context_package_ids JSON, evidence_refs JSON, policy_decision JSON, reversible BOOLEAN, restore_path JSON.

---

## 6.4 Organization and Role Boundaries

Reuse existing RBAC/business foundations, do not create second identity system.

### Entities

- **User:** Exists via `biz_members.userId`, maps to XR workspace user. Single identity.
- **Organization:** Top-level, owns workspaces, members, audit chain per org (already).
- **Workspace/Project:** Isolation unit. Workspace settings include `privacyMode: "local" | "private" | "hybrid"`, `allowedProviders`, `modules`, `aiWorkersEnabled`.
- **Role:** owner, admin, manager, member, viewer, guest — defaults preserved, plus custom permissions.
- **AI Worker:** New authority profile per workspace, delegated authority limited to workspaceIds. Cannot exceed member who deployed? Delegated authority = intersection of deployer's effective permissions AND worker's declared. If deployer is member, worker cannot get admin.
- **Delegated Authority:** Function `resolveEffectiveWorkerAuthority(memberId, workerId, workspaceId)` computes allowed actions.
- **Record/Data Scope:** Each query filters by orgId+workspaceId. Enforcement via `authority-boundaries.ts` central function `enforceScope`. Cross-workspace access denied unless explicitly org-read and caller has permission + privacy mode allows.
- **Approval Authority:** Map role → approval levels: owner can approve elevated, admin standard+elevated, manager standard for their workspace modules, member can approve review for their own tasks, viewer cannot approve.
- **Audit Visibility:** Owner/admin see all audit, manager sees workspace, member sees own + non-sensitive, viewer limited, guest none. Private data (HR salary) only owner/admin/HR manager.

### Implementation

- `authority-boundaries.ts` provides `checkAccess`, `checkDataScope`, `checkApprovalAuthority`, `getAuditVisibility`.
- Integrates with `trust/authority.ts` effective authority.
- Uses existing `BusinessDatabase` joins, not new identity.

---

## 6.5 Artifacts and Evidence

Per spec: Documents, research reports, meeting notes, communications, analytics, records, generated outputs must use existing context/artifact/provenance contracts. No disconnected formats.

### Artifact Contracts

Reuse `WorkflowArtifact` from workflow/types: `{artifactId, nodeId, contract, location, contentHash, createdAt}` where contract is `ArtifactContract` from `src/context/types.ts` or similar.

### Evidence Refs

Reuse `EvidenceRef` = `{ kind: "context_item"|"research_source"|"document"|"execution_record"|"business_record"; id: string; hash?: string }`.

### Linking

- **Documents:** `biz_documents` row + entry in `biz_artifacts` (artifactId → documentId, provenance: source meeting transcript, contextPackageId, workflowRunId, evidenceRefs: meetingId, researchReportId). Rendering via context injection preambles, not raw.

- **Research Reports:** Research engine's `finalReport` saved as artifact with `contract: research_report`, location: file path or inline content hash, provenance includes sources array with trust scores. When creating KB article, evidenceRefs include sourceIds.

- **Meeting Notes:** Meeting transcript stored as artifact with restricted sensitivity, summary doc artifact with evidenceRefs: transcript artifactId, action items tasks.

- **Communications:** Message artifacts with channels, provenance linking to ticket/deal.

- **Analytics:** Dashboard widget data + report configs as artifacts with evidence refs to underlying invoices/deals.

- **Business Records:** Each record mutation includes artifact refs if document/report generated as part of same workflow run.

### Storage

- `biz_artifacts` table: id, workspaceId, workflowRunId, nodeId, contract JSON, location, contentHash, provenance JSON (sources, contextPackageIds, evidenceRefs, actor), createdAt.

- All artifact content hashed, tamper-evident.

---

## 6.6 Human Attention

Define per spec:

| Category | What | How | Grouping | Uncertainty | UI |
|----------|------|-----|----------|-------------|----|
| Requires approval | High-value deal close (>10k), invoice send, expense >1k, external API write, public KB publish, worker write to sensitive module | Workflow human_approval node, ApprovalEscalationService creates decision, dashboard work queue shows card with evidence, expiry 2h-24h, approval level standard/elevated, notification via dashboard + cli + optional webhook/email | Group by workspace, by approval type, defer non-critical 5min window, max 20 per group | Show confidence score, risk tier, budget impact, evidence summary, model uncertainty if agentic node | dashboard approval list, cli `xr biz approvals list` json, non-tty |
| Can be auto-executed | Low-value deal moves, task creation low priority, document draft, research search, internal notifications | Execute via deterministic nodes, no human gate, but audit logged, informational notification optional | No grouping, log as info | Log confidence, no block | Info notifications collapsed |
| Requires review | Research report synthesis, meeting notes summary, document from template that will be shared, worker proposal for record mutation | human_review node, reviewer can approve / request changes / reject, evidenceShown includes full artifact + sources | Group by review type, defer 10min | Show uncertainty: "model confidence 0.72, 2 contradictions detected" | Review queue separate |
| Informational | KPI updates, forecast recalculated, task completed, meeting scheduled | notification node severity info, channel dashboard + cli, not blocking | Defer 5min, group by module | No uncertainty | Activity feed, progressive disclosure |
| Uncertainty display | Low confidence, high risk, budget near limit, contradictions | Shown in approval/review cards: confidence, trust scores, evidence coverage, policy reason | - | Explicit | UI badge |

Avoid fatigue:

- Only consequential + irreversible + external actions require approval.
- Auto-executed but audited actions are majority.
- Batch notifications per workspace per 5min window.
- Provide "approve all similar" for same type low-risk.
- Dashboard shows counts, not spams.

Implementation via `approval-escalation.ts` + existing workflow human nodes.

---

## 6.7 Local/Private Operation

### Privacy Modes

- **Local:** All execution, context, intelligence routing stays local. No cloud provider calls unless explicitly allowed. Enforcement: intelligence router policy local-only, context retrieval filtered to local content, no external integrations auto-triggered.
- **Private:** Local + no external writes without elevated approval. Sensitive data (HR salary, meeting transcript, PII) marked restricted, never injected into cloud models. Context injection masks PII.
- **Hybrid:** Allows cloud routing with policy/consent, but sensitive fields still private. Existing policy/consent mechanism used.

### Enforcement Matrix (reuses 7 above)

- Workspace settings `privacyMode` + `allowedProviders`.
- Record sensitivity: public, internal, confidential, restricted (HR, transcript, credentials).
- Context policy: `context/policy.ts` already has sensitivity and trust; business layer adds filter `sensitivityMax` per worker/workspace.
- Intelligence: `intelligence/router.ts` supports local-only; business layer calls `buildProviderWithDecision` with policy from workspace privacy.
- Integrations: External writes require policy check `privacy-policy` + approval. If workspace private and integration connector is cloud (e.g., Salesforce), requires elevated approval + consent flag in `biz_privacy_policies`.
- Audit: Sensitive data masked in audit metadata, but hash chain preserved.

### Implementation

- `local-privacy.ts` provides `enforcePrivacy(workspaceId, operation, dataSensitivity, target)` → checks privacy mode, provider locality, integration type, returns allowed/denied/requires_approval + remediation.
- Uses existing capability authority + trust policy.

---

## 6.8 Design Constraints

Per spec 6.8, enforce:

- Use canonical workflow/execution/trust/durable/intelligence/context/capability contracts — No bespoke scheduler for business. `automation/engine.ts` will delegate to WorkflowEngine.
- Do not add modules for feature count — No new business modules beyond existing 15 unless missing primitive blocks verified journey. If needed, minimal primitive e.g., `biz_outcomes` table, not new module.
- Do not bypass business RBAC/audit — All operations via authority-boundaries + audit extended.
- Do not let model output directly mutate authoritative records without policy — All via propose→commit contract.
- Do not implement Phase 11 remote control plane — Stay single-process, SQLite, local daemon, no remote execution, no distributed infra.

---

## Implementation Ordering (File-by-File)

1. Core types + schema + database migration → `types.ts`, `schema.ts`, `database.ts`, `migration.ts`
2. Outcome + record-mutation + authority + artifact + approval + privacy → `outcome.ts`, `record-mutation.ts`, `authority-boundaries.ts`, `artifact-evidence.ts`, `approval-escalation.ts`, `local-privacy.ts`
3. Worker contract + execution bridge → `worker-contract.ts`, `execution-bridge.ts`
4. Journeys + workflow templates → `journeys.ts`, `workflow-templates.ts`
5. Operating layer orchestrator → `operating-layer.ts`
6. Update business modules to use contracts (crm, sales, etc) + ai-workers
7. CLI/daemon/dashboard views → `src/commands/business.ts`, `src/daemon/routes/business.routes.ts`, `dashboard.ts` patches
8. Tests → `test/business/operating-layer.test.ts` etc.
9. Docs → user guides, developer guides, changelog.

All new code production, no placeholders, typed, zod validated where applicable.

---

*Design intended to satisfy XR 5.3 Sections 6.* 
