# PHASE 10 — Personal and Business Operating Layer — Audit Deliverable
**Version:** XR 5.2.0 Baseline → XR 5.3.0 Target  
**Date:** 2026-07-27  
**Scope:** Audit of all `src/business/`, workflow, execution, trust, intelligence, context, capability contracts, research, integrations, documents/meetings/communication, RBAC, CLI/daemon/dashboard.

---

## 1. Module Inventory and Ownership

### Business Core (`src/business/core/`)
| File | Lines | Ownership | Status | Notes |
|------|-------|-----------|--------|-------|
| `database.ts` | ~300 | BusinessOS / Core | Partial | Creates 33 tables (biz_organizations, biz_workspaces, biz_members, contacts, pipelines, deals, projects, tasks, tickets, knowledge, invoices, expenses, employees, meetings, documents, automations, workers, dashboards, audit, events, credentials). Uses SQLite via BusinessDatabase wrapper. Idempotent migration. BUT: not integrated with canonical `WorkspaceStore` adapter until Phase 0.5 unification test; still direct SQLite. Missing linkage to ExecutionRecord, ContextPackage, Artifact. |
| `schema.ts` | ~700 | BusinessOS | Partial | CREATE TABLE statements. No foreign keys to canonical artifact/context tables. No workflow versioning integration. |
| `types.ts` | ~1200 | BusinessOS | Basic | Defines org, workspace, member, contact, pipeline, deal, project, task, ticket, knowledge, invoice, expense, employee, meeting, document, automation, worker, dashboard, audit, events. Missing: outcome contract, record-mutation provenance, worker governance narrow authority, artifact linkage. |
| `audit.ts` | 162 | Security / Business | Basic | Hash-chained audit log (SHA-256). Verify method. But NOT linked to workflow/task/execution, policy/approval, source/evidence/context, reversibility/restore path. No tamper-evident export via existing mechanisms integration yet. |
| `bus.ts` | 149 | BusinessOS / Core Event Bus | Basic | In-memory event bus with wildcard, persistence to biz_events. Does NOT bridge to canonical `core/event-bus.ts` nor to workflow engine. No durable execution. |
| `rbac.ts` | ~350 | Security | Partial | Role defaults (owner, admin, manager, member, viewer, guest). Custom permissions. Workspace access checks. BUT: No integration with canonical `trust/authority.ts`, capability effective authority, or worker-delegated authority. Workers not checked. |
| `organization.ts` | ~300 | BusinessOS | Basic | CRUD organizations + default workspace. Works. No integration with XR workspace manager, no cross-workspace leakage tests beyond basic. |
| `pipeline.ts` | ~400 | BusinessOS | Basic | Pipeline stages, deals, stats. Bespoke logic. Not using workflow engine. |
| `contacts.ts` | 351 | CRM Foundation | Basic | CRUD contacts, notes, search, stats. Isolated from context/provenance. |
| `index.ts` | ~500 | BusinessOS Main Entry | Partial | Composes all modules, lifecycle hook. Initialize creates tables. getHealth. BUT: Modules use bespoke automation engine, not canonical workflow engine. No capability descriptors, no trust policy. |

### Business Modules (`src/business/modules/`)
Each module is ~200-600 LOC, same pattern: direct DB access, simple CRUD, event emission via bus, no execution records, no workflow nodes, no artifact linkage, no RBAC enforcement per method (relies on caller), no outcome measurement, no failure/restore, no context packaging.

- `crm/index.ts` — Contacts with segmentation, search, stats. No deterministic node integration.
- `sales/index.ts` — Deals, forecasting, move stages, stats. Uses pipeline manager. Emits `deal.*` events. Not governed.
- `marketing/index.ts` — Campaigns, segments. Basic.
- `support/index.ts` — Tickets sequential numbers, messages. Basic.
- `projects/index.ts` — Projects, tasks, milestones, progress. No workflow engine.
- `knowledge/index.ts` — Articles, categories, search. No context/artifact/provenance.
- `finance/index.ts` — Invoices, expenses, P&L. Math exact but no approval gates.
- `hr/index.ts` — Employees, time-off, directory. No privacy enforcement.
- `analytics/index.ts` — KPIs, dashboards, reports. No evidence linkage.
- `automation/engine.ts` — Registers triggers (event, schedule, webhook), sequential step execution. BESPOKE scheduler, not canonical workflow engine. No execution records, no approval, no trust.
- `scheduling/index.ts` — Calendar events, meetings integration. No context package.
- `communication/index.ts` — Messages, threads. No artifact contract.
- `documents/index.ts` — Docs, templates, versioning. No provenance, no context injection.
- `meetings/index.ts` — Meetings, agenda, notes, transcript. No research engine linkage.
- `ai-workers/index.ts` — 24KB, 8 worker definitions (ceo_advisor, sales_director, marketing_director, financial_analyst, hr_manager, project_manager, support_specialist, researcher). Each with broad permissions (`* read`), system prompts, capabilities, but NO narrow authority contract: No org/workspace scope enforcement, no allowed workflows declaration, no context scope, no model/provider scope, no budget, no risk/placement, no approval/review requirements, no data access boundaries, no success criteria, no escalation rules, no revocation/disable behavior verification. Conversations stored as JSON blobs.

**Ownership gap:** All modules owned by BusinessOS monolith, not decomposed into deterministic vs agentic vs human nodes. No capability descriptors (`src/capabilities/`).

### Workflow (`src/workflow/`)
| File | Status |
|------|--------|
| `types.ts` | Production-ready — defines WorkflowDefinition, WorkflowNode (14 kinds: trigger, deterministic, agentic, human_approval, human_review, tool_action, wait_timer, branch, join, artifact_output, business_record, notification, completion, compensation), run states, node states, validation, human decision, artifacts, cost. This IS canonical. |
| `engine.ts` | Production-ready — execution of runs, state machine, safety MAX_TICKS 1000, parallel key handling, human decision submission, pause/cancel, inspection. Integrates with agent runner, execution recorder, context provider interfaces. |
| `state-machine.ts` | Production-ready — applyRunEvent, applyNodeEvent, canAdvanceNodes, canAcceptHumanInput, canPause, canCancel. Valid transitions map. |
| `repository.ts` | Production — persistence of runs, definitions, human decisions. |
| `inspection.ts` | Provides inspection summaries. |
| `versioning.ts` | Draft/publish, integrity hash, migration acceptance. |
| `nodes.ts` | Factory functions. |

**Gap:** Business modules DO NOT use this engine. They use bespoke automation engine.

### Execution / Durable (`src/execution/`)
| File | Status |
|------|--------|
| `types.ts` | Canonical execution envelope: intent → plan → policy → placement → action → observation → evidence → outcome. Universal action envelope, idempotency, timeout, approval, budget. |
| `service.ts` | ExecutionService — records, approves, budget blocks, timeout, cancellation, dry-run, duplicate idempotency, usage. Emits lifecycle events. Production. |
| `adapters/*` | 6 adapters: agent, control, domain, mcp, plugin, tool, workflow. Maps capability kinds to execution. |
| `checkpoint.ts` | CheckpointManager — saves authority snapshot, side-effect safety classification. |
| `lease.ts` | LeaseManager — prevents duplicate execution. |
| `recovery.ts` | RecoveryManager — classifies recovery: safe auto_resume vs requires_approval, cancellation, environment attachment, dirty detection, quarantine. |
| `repository.ts` | ExecutionRepo — persistence. |
| `state-machine.ts` | Execution state machine. |

**Gap:** Business automation engine bypasses this entirely. No lease, no checkpoint, no recovery for business records.

### Trust (`src/trust/`)
| File | Status |
|------|--------|
| `types.ts` | TrustRequest, RiskClassification, AuthorityGrant, PlacementDecision, EnvironmentInfo, CredentialRef, ResourcePolicy. |
| `service.ts` | TrustService — classifier (deterministic inputs → tier0-3, safe/sensitive/destructive), authority grants, credential scoping, placement decisions, verification, cleanup. |
| `authority.ts` | Effective authority: declaration ∩ policy ∩ grants minus denied. |
| `policy.ts` | Policy evaluation. |
| `credentials.ts` | Credential vault. |
| `environment/*` | In-process, restricted-process, container backends, manager, namespace, backend. |
| `classify.ts` | Risk classifier. |

**Gap:** Business modules have own RBAC but not using trust service. No model output treated as proposal.

### Intelligence (`src/intelligence/`)
- `router.ts`, `catalog.ts`, `capability.ts`, `scorer.ts`, `evaluator.ts`, `fallback.ts`, `service.ts` — Production routing across providers, tri-state capability, local-first policy, fallback, metrics, explainable decisions. **Not used by business AI workers:** workers have hardcoded model field, no routing decision record, no locality enforcement.

### Context (`src/context/`)
- `types.ts`, `assembler.ts`, `retrieval.ts`, `injection.ts`, `provenance.ts`, `policy.ts`, `repository.ts`, `compression.ts`, `memory-adapter.ts`, `embedding.ts`, `service.ts` — Canonical context packages with tiers: instruction, data, quarantine. Trust levels, consent, provenance, evidence linkage, inspection. **Not used by business modules:** documents/meetings/knowledge generate markdown without provenance linking, no context packages.

### Capabilities (`src/capabilities/`)
- `types.ts`, `authority.ts`, `certification.ts`, `adapters.ts`, `service.ts`, `store.ts`, `index.ts` — Common inspectable descriptors, publisher/provenance/package-integrity, declared-vs-effective authority, dependency inspection, evidence-based discovery, certification contract tests, safe install/update/disable/quarantine/rollback. **Not used by business modules:** business modules declare capabilities as simple {module, actions} arrays, not capability descriptors.

### Research Engine (`src/research/`)
- `engine.ts`, `plan.ts`, `search.ts`, `ranking.ts`, `extract.ts`, `synthesize.ts`, `report.ts`, `budget.ts`, `types.ts` — Evidence ledger, source ranking, extraction, synthesis, contradictions, refresh history. **Not integrated with business:** knowledge/meetings/documents don't use research engine; no evidence-linked reports for business journeys.

### Integrations / OAuth / Credentials
- `src/integrations/registry.ts` — 30+ connectors categorized, schemas.
- `oauth.ts` — OAuth flow.
- `credentials.ts` — CredentialVault with encryption.
- **Gap:** Business connectors use `biz_credentials` table direct, not capability/trust/credential contracts. External writes require no policy/approval.

### Documents / Meetings / Communication / Scheduling
All exist as business modules but:
- Documents: versioning but no artifact contract, no provenance, no human review.
- Meetings: agenda/notes/transcript but no research linkage, no artifact output nodes.
- Communication: messages but no notification node type usage, no escalation.
- Scheduling: calendar events but not using workflow timer nodes.

### Business Database / Schema / Audit / RBAC
See above. Migration idempotent, verified by `test/business/business.test.ts` 21 tests green. But missing linkage to execution, workflow, context, artifacts, outcomes.

### CLI / Daemon / Dashboard / Business Routes
- `src/commands/business.ts` — Only `status` and `init`, not journey/outcome views.
- `src/business/cli.ts` — Defines BUSINESS_CLI_COMMANDS with many subcommands (contacts, deals, tickets, etc) but handlers not wired to command registry; they are declarative metadata, not implemented in core CLI router.
- `src/daemon/routes/index.ts` — No business routes. Business OS not exposed via daemon API.
- `dashboard.ts` — 204KB HTML, mission control UI with sidebar, chat, sessions, but no business operating layer views (work queues, active workflows, AI worker status, approvals, records changed, evidence/artifacts, cost/time, failures/recovery, audit/provenance).
- `src/daemon/server.ts` — Server boots, no business integration.

### Existing Workflow Templates
- `src/templates/workflows/` — 12 pre-built automation templates JSON. Basic, not business-journey oriented, missing authority boundaries.

### Business/Agent/Research Tests
- `test/business/business.test.ts` — 21 tests, all green, but only CRUD + isolated data tests, not end-to-end journeys, not agent/deterministic/human steps, not record mutation with provenance.
- `test/workflow/` — 36 tests green.
- `test/execution/` — 61 tests green.
- `test/trust/` — comprehensive.
- No tests for complete personal/developer/research/business journeys.

---

## 2. User/Persona Journey Matrix

| Persona | Representative Intent | Trigger | Current Support | Gap |
|---------|------------------------|---------|----------------|-----|
| Personal user | Capture meeting notes → create tasks → research follow-up | Manual doc creation + task add | Modules exist but disconnected. No workflow linking meeting → tasks → research → outcome. No context package. |
| Developer | Manage project, tasks, dependencies, milestone, publish docs | Project + tasks CRUD | No deterministic workflow nodes for build/test/deploy, no artifact output, no execution records, no approval for release, no measurable velocity. |
| Researcher | Research competitor, produce evidence-linked report, convert to KB article | Research engine standalone + knowledge module standalone | No flow: research topic → sources → evidence → synthesis → report → approval → KB publish with provenance. |
| CRM Operator | New contact → qualify → create deal → follow-up automation → invoice | Contact add, deal create, manual move, automation bespoke | No canonical workflow: contact.created → qualification → deal creation requires approval? No record authority, no execution lease, no outcome verification, duplicate mutation risk. |
| Sales | Pipeline review, forecast, move deal to won, generate invoice | Sales module forecast (weighted) + finance invoice | No human approval gate for high-value deal close, no cost tracking, no audit linking to workflow/task/execution, no communication artifact. |
| Support | Ticket inbound → triage → assign → resolve → KB article suggestion | Ticket add + resolve | No escalation rules, no SLA enforcement via workflow timer, no AI worker with narrow authority. |
| Project Manager | Create project → assign tasks → track progress → meeting → doc output | Projects + tasks + meetings separate | No workflow: project.create → task assignment via human review → execution records → artifact docs → completion outcome. |
| Knowledge Worker | Draft document from template → review → publish → link to project | Document template render | No provenance, no human review node, no workflow approval, no artifact contract. |
| Finance Operator | Create invoice from deal → send → track payment | Invoice create, manual send | No approval for external write (send), no evidence linkage to deal, no reversible path. |
| Organization Admin | Manage org, workspaces, members, roles, workers, integrations | Org + members + workers CRUD | No delegated authority model, no worker budget/escalation visibility, no audit export, no privacy/local operation enforcement. |

**All personas currently use isolated modules. No complete outcome-oriented journey exists end-to-end through canonical contracts.**

---

## 3. Current Business Record/Data Model

33 tables, see schema. Core entities:

- `biz_organizations` (id, name, slug, domain, plan, settings JSON, timestamps) — Top-level tenant.
- `biz_workspaces` (id, org_id, name, slug, description, icon, color, settings JSON, timestamps) — Unit of isolation, but isolation only checked in RBAC, not enforced via trust/environment.
- `biz_members` (id, org_id, user_id, email, name, avatar, role, workspaces JSON, permissions JSON, status, lastActive, created) — Members with workspace access list.
- `biz_contacts` (id, workspace_id, type, status, name, email, phone, avatar, company, title, tags JSON, customFields JSON, source, ownerId, score, lastContacted, timestamps) — CRM foundation.
- `biz_contact_notes` + `biz_contact_activities` — Child records.
- `biz_pipelines` (id, workspace_id, name, stages JSON, isDefault, timestamps) — Pipeline definition.
- `biz_deals` (id, workspace_id, pipeline_id, stage_id, title, value, currency, contactId, companyId, ownerId, probability, expectedClose, actualClose, tags, customFields, lostReason, timestamps) — Sales.
- `biz_projects`, `biz_tasks`, `biz_milestones` — Project management, tasks have dependencies JSON, attachments JSON.
- `biz_tickets`, `biz_ticket_messages` — Support.
- `biz_knowledge_articles` — KB.
- `biz_invoices`, `biz_expenses` — Finance.
- `biz_employees`, `biz_time_off` — HR.
- `biz_meetings`, `biz_calendar_events` — Scheduling.
- `biz_documents`, `biz_document_templates` — Documents.
- `biz_automations`, `biz_automation_runs` — Bespoke automation, not canonical workflow.
- `biz_workers`, `biz_worker_conversations` — AI workers, conversations as messages JSON.
- `biz_dashboards`, `biz_reports` — Analytics.
- `biz_audit` (id, org_id, workspace_id, actor_id, actor_type, action, resource, resource_id, changes JSON, metadata JSON, hash, previous_hash, timestamp) — Hash-chained audit, but not linked to workflow/execution/context.
- `biz_events` (id, workspace_id, type, source, data JSON, actor_id, timestamp) — Event persistence.
- `biz_credentials`, `biz_integration_sync` — Credentials encrypted, sync state.
- `biz_schema_version`.

**Data Model Gaps:**
- No outcome/measurement table (verified outcome, cost/time).
- No record-mutation provenance table linking actor/worker, workflow/task/execution, policy/approval, source/evidence/context, previous value, reversibility.
- No artifact table using existing artifact/provenance contracts.
- No worker authority table (allowed workflows, capabilities, budget, risk, approval requirements, escalation, revocation).
- No human attention/approval queue table linked to business records.
- No privacy classification per record (local vs cloud transfer).
- No context package linkage per business operation.
- No execution record linkage per business mutation.

---

## 4. AI Worker Authority Matrix

| Role | Current Declared Capabilities | Permissions | Budget | Model Scope | Risk | Approval | Escalation | Data Access | Revocation | Gap |
|------|-------------------------------|-------------|--------|-------------|------|----------|------------|-------------|------------|-----|
| ceo_advisor | analytics(read_kpis), sales(read_deals), finance(read_pnl), support(read_tickets), hr(read_directory), research(market) | *:read, reports create/read/export, dashboards create/read/update | None | `model?: string` optional, no routing | Not classified | None | schedule 9am weekdays, no escalation | Claims all data, not scoped | enabled boolean, but not enforced via Effective Authority | **CRITICAL:** Broad read-all, no narrow scope, no workflow allowlist, no budget cap, no provider locality, no trust tier, no success criteria. |
| sales_director | crm read/create/update, sales read/create/update/move, documents create, automation create | contacts create/read/update, deals create/read/update, docs create/read | None | Same | Not classified | None | No | Claims contacts/deals | enabled | Same gaps |
| marketing_director | marketing create/read, crm segment, research, docs create | contacts read, campaigns create/read/update, docs create/read | None | Same | Same | Same | Same | Same | enabled | Same |
| financial_analyst | finance read/create, sales read, analytics create | invoices create/read/update, expenses, reports | None | Same | Same | Same | schedule Monday 8am | finance | enabled | Same |
| hr_manager | hr read/manage, projects read | employees create/read/update, time_off | None | Same | Same | Same | Same | hr | enabled | Same |
| project_manager | projects create/read, tasks create/update, meetings read | projects, tasks, reports | None | Same | Same | Same | Same | projects | enabled | Same |
| Support + Researcher etc | Similar | Broad | None | None | None | None | None | Broad | enabled | Same |

**Matrix Analysis:**
- No worker declares `organization/workspace scope` — they take workspaceId per request but no enforcement that worker cannot access other workspace.
- No `allowed workflows` list — workers can run any automation.
- No `context scope` — they can read all context tiers.
- No `capabilities/tools` narrowed — they declare module actions but not effective capability descriptors.
- No `model/provider scope` — free choice.
- No `budget` — no max USD, tokens, steps.
- No `risk/placement` — not classified via trust service.
- No `approval/review requirements` — no gates.
- No `data access` narrow — owner claims `*`.
- No `success/outcome criteria` — vague system prompts.
- No `escalation rules` — only schedule cron.
- No `revocation/disable behavior` — enabled flag exists but disabled workers could still execute via direct DB if not enforced.

**Required per spec 6.2:** Role/identity, org/workspace scope, allowed workflows, context scope, capabilities/tools, model/provider scope, budget, risk/placement, approval/review, data access, success criteria, escalation, revocation — all must be declared and enforced.

---

## 5. Workflow/Execution/Context/Artifact Linkage Map

| Business Operation | Workflow Node Used? | Execution Record? | Context Package? | Artifact/Provenance? | Trust/Policy? | Linkage Score |
|--------------------|-------------------|-------------------|------------------|-----------------------|---------------|---------------|
| contact create | No (direct DB) | No | No | No | RBAC only, not trust | 0/5 |
| deal move | No | No | No | No | No | 0/5 |
| deal won | Emits event `deal.won` but no workflow | No | No | No | No | 1/5 |
| ticket create/resolve | No | No | No | No | No | 0/5 |
| project/task CRUD | No | No | No | No | No | 0/5 |
| invoice create/send | No | No | No (send is external write without approval) | No | No | 0/5 |
| document create | No | No | No | No (version increments but not artifact contract) | No | 0/5 |
| meeting create | No | No | No | No | No | 0/5 |
| automation run | Bespoke engine, not canonical workflow | No ExecutionService | No | No | No | 0/5 |
| worker chat | Direct message append JSON, no agent loop? | No | No memory adapter | No | No | 0/5 |
| research to KB | No linkage — research engine saves own sessions, KB article separate | No | No | No | No | 0/5 |

**Canonical contracts exist (workflow engine, execution service, context service, artifact types) but business modules bypass them.**

Linkage should be: Intent/Trigger → Context Package → Workflow Definition (versioned) → Node execution (deterministic/agentic/human) → Execution Record with Trust Classification → Artifact Output (document/research/meeting/communication) with Provenance → Business Record Mutation via Record Authority Contract → Audit with hash chain + export → Outcome measurement (cost/time/success) → Failure/Recovery via checkpoint/lease/recovery.

**Current: Trigger → Direct DB write → Bus event → Audit single table.**

---

## 6. Human Approval/Escalation Map

| Action | Requires Approval? | Current Implementation | What Should Require? | Escalation? | Fatigue Risk |
|--------|-------------------|-----------------------|----------------------|-------------|--------------|
| Read contacts, deals, projects | No | No | No | No | Low |
| Create contact, deal (low value) | No | No | No (auto) | Informational notification | Low |
| Move deal to qualified/proposal | No | No | No, but log | Info | Low |
| Move deal to closed_won > $10k | Should require approval | No gate | Requires approval (manager) | Approval request, 2h expiry, notify role | Medium |
| Create invoice > $5k | Should require approval | No | Approval | Approval | Medium |
| Send invoice (external write) | Should require approval per spec | No | Requires approval + policy check | Standard approval | High (external side effect) |
| Delete contact/deal/project | Should require review | No | Review required | Review request | Medium |
| Worker proposing record mutation | Should be proposal until committed | Direct mutation if worker tool? No worker tool execution integrated | Model output → proposal/evidence, human or policy commits | Review queue | High |
| Generate report/dashboard | No | No | No, but provenance needed | Info | Low |
| Research synthesis | Should have review for high-stakes | No | Optional review | Review if high uncertainty | Medium |
| Expense approval | Should require manager approval | No | Approval | Approval | Medium |
| Time-off request | Approval | Status pending, but no workflow node | Human approval node | Approval + notify | Medium |
| Automation that calls external API | Should require approval + credential scoping | No | Elevated approval + credential ref | Elevated gate | High |
| Worker disable/revocation | Should notify | Enabled flag toggle | Audit + notification + no silent authority restoration | Critical notification | Low |

**Current map:** Only time-off uses pending status; all other consequential mutations silent. No approval fatigue management, no grouping/deferral, no uncertainty display.

**Spec 6.6 requires:** Define what requires approval vs auto vs review vs informational, how notifications grouped/deferred, what uncertainty shown. Avoid approval fatigue and silent consequential automation.

---

## 7. Privacy/Local Operation Matrix

| Data Domain | Current Storage | Local Operation Supported? | Cloud Transfer Policy | Leakage Risk | Required for 5.3 |
|-------------|----------------|---------------------------|----------------------|--------------|------------------|
| Organizations, workspaces, members | SQLite | Yes, fully local | No transfer currently, but no policy gate | Low | Needs locality flag per workspace, enforcement before context injection. |
| Contacts (PII: email, phone, title) | SQLite | Yes local | Integrations could sync to external CRMs without policy check | Medium | Must enforce policy/consent before cloud transfer, use capability trust credential contracts. |
| Deals (financial) | SQLite | Yes local | Could be exported without approval | Medium | Local/private operation for sensitive domains, cloud transfer requires policy/consent. |
| Projects/tasks (internal) | SQLite | Yes local | Low | Low | Local. |
| Tickets (customer PII + issue) | SQLite | Yes local | Support integrations maybe cloud | Medium | Privacy enforcement. |
| Knowledge articles (internal) | SQLite | Yes local | Public visibility flag exists | Medium | Respect visibility, context scope. |
| Invoices (financial + contact PII) | SQLite | Yes local | Send invoice = external write, needs approval | High | Approval + provenance. |
| HR employees (highly sensitive: salary, etc) | SQLite | Yes local, must remain private | No policy | Critical | Local/private operation mandatory, no cloud transfer without elevated approval. |
| Meetings (transcript, notes) | SQLite | Yes local, transcript may contain sensitive discussion | No policy | Critical | Local-private per transcription, context scope enforcement. |
| Documents (may contain sensitive) | SQLite | Yes local | Export could go to Google Drive without consent? | High | Use context policy, provenance. |
| Worker conversations | SQLite JSON | Yes local, but includes business data | Could be sent to LLM provider (cloud) without locality check | Critical | Needs context scope enforcement, intelligence router local-only policy for sensitive data. |
| Audit/events | SQLite | Local | Exportable via existing mechanisms, but no privacy redaction | Medium | Tamper-evident + exportable, but sensitive data masked. |
| Credentials | SQLite encrypted `biz_credentials` | Local vault | OAuth tokens for integrations | High | Must use trust/credential contracts — task_scoped refs, not raw secrets in prompts. |
| Context packages | WorkspaceStore / ContextService (if used) | Local SQLite | Can include user memory, must enforce scope before injection | Critical | Context scope enforced before retrieval/injection (spec 10). |
| Research sources/evidence | Filesystem + SQLite? | Local, but web fetch external | Fetch is external but read-only; synthesis sends to LLM (provider) | Medium | Must respect locality: if workspace is local-private, routing must be local-only. |

**Matrix Gap:** No explicit `local/private` attribute on workspaces, records, or context tiers. No policy enforcement that sensitive business/personal journeys must operate locally/private where current providers/integrations support it. No check for cloud transfer consent. Intelligence router supports local-only policy, but business modules do not use it. Context service has policy, but business doesn't call it.

---

## 8. Outcome/Metric Gap Analysis

| Journey | Desired Outcome (Spec) | Current Metric | Gap |
|---------|------------------------|----------------|-----|
| Personal knowledge/task mgmt | Capture → organize → produce artifact, measurable time/cost, provenance | No outcome contract, no cost, no time, no provenance | Missing: outcome.ts, verification, cost/time tracking via execution records + workflow cost aggregation. |
| Developer/project execution | Project → tasks → completion, velocity measured, artifacts (docs), failure recovery | No velocity, no task dependencies enforced, no artifact output node | Missing: outcome measurement, durable recovery, workflow nodes. |
| Research/evidence/reporting | Research topic → evidence ledger → synthesis → report → review → publish, citations preserved | Research engine produces sources/evidence but not linked to KB, no human review gate | Missing: artifact/provenance linkage, approval, measurable trust score. |
| Customer/CRM/support | New lead → contact → qualified → support ticket resolved → KB suggestion, measurable satisfaction | Support ticket has satisfaction field but not measured as outcome, no SLA workflow | Missing: workflow SLA (wait_timer node), outcome contract (solved time, satisfaction). |
| Sales/follow-up | Lead → deal → follow-up automation → close → invoice, forecast measured | Forecast exists but weighted only, no automated follow-up via workflow, no outcome verification | Missing: deterministic nodes for follow-up, notification nodes, cost/time, audit linking. |
| Projects/meetings/documents | Meeting → notes → tasks → document → artifact, provenance | Meeting notes separate, no artifact output | Missing: artifact/provenance, human review, outcome verification. |
| Scheduling/communication | Schedule meeting → notification → calendar event, attendees, outcome | Calendar events CRUD, no notification workflow, no human approval | Missing: notification channels, escalation. |
| Finance/operations | Deal won → invoice → payment tracked, P&L, measurable cash flow | Invoice CRUD, no approval for high value, no reversibility path | Missing: approval, reversibility, audit provenance, outcome metric (cash collected). |

**General Gap:** No `Outcome` type, no verified outcome field, no cost/time tracking aggregation across execution records, no audit/provenance completeness check, no failure/recovery measurement.

Spec requires each journey define: trigger/intent, context package, workflow version, agent/deterministic/human nodes, capabilities, authority/approvals, artifacts/records, verified outcome, cost/time, audit/provenance, failure/recovery.

Currently none of the business journeys define these.

---

## 9. File-by-File Implementation Proposal (Strict Scope, No Phase 11)

### New Files (Operating Layer)
- `src/business/core/operating-layer.ts` — Central orchestrator for Phase 10. Implements BusinessOperatingLayer class: initialize journeys, wire workflow engine, execution service, context service, capability service, trust service. Provides outcome-centered API. Owner: BusinessOS + Workflow Engine. Preserves data.

- `src/business/core/record-mutation.ts` — Canonical record mutation contract per 6.3: actor/worker, workflow/task/execution, policy/approval, source/evidence/context, timestamp/version, previous value/change history, reversibility/restore path. Implements `BusinessRecordMutationService` with `propose`, `commit`, `revert`, `history`. Owner: Business Core / Audit.

- `src/business/core/outcome.ts` — Outcome definitions: OutcomeType, VerifiedOutcome, metrics (cost, time, success criteria, evidence refs). Implements `OutcomeTracker` linking workflow runs to measurable outcomes.

- `src/business/core/worker-contract.ts` — AI worker governance contract per 6.2: WorkerAuthorityProfile declaring role/identity, org/workspace scope, allowed workflows, context scope, capabilities/tools (mapped to capability descriptors), model/provider scope (routing policy), budget, risk/placement, approval/review, data access, success criteria, escalation, revocation/disable. Implements `WorkerGovernanceService`.

- `src/business/core/authority-boundaries.ts` — Organization/workspace/role/worker delegated authority, record/data scope, approval authority, audit visibility. Extends existing RBAC with trust authority integration.

- `src/business/core/artifact-evidence.ts` — Artifact and evidence linkage using existing `context/artifact/provenance` contracts. Documents/research/meetings/communications/analytics/records use `WorkflowArtifact` + `EvidenceRef`. Implements `ArtifactService`.

- `src/business/core/approval-escalation.ts` — Human attention management per 6.6: what requires approval vs auto vs review vs informational, grouping/deferral, uncertainty display, SLA, expiry. Implements `ApprovalEscalationService` using workflow human nodes.

- `src/business/core/local-privacy.ts` — Local/private operation matrix enforcement: workspace privacy mode, record sensitivity, context scope enforcement, cloud transfer policy. Implements `LocalPrivacyService` using intelligence router local-only policy + context policy.

- `src/business/core/journeys.ts` — Outcome-oriented journey definitions per 6.1: personal knowledge/task, developer/project, research/evidence/reporting, customer/CRM/support, sales/follow-up, projects/meetings/documents, scheduling/communication, finance/operations. Each journey defines trigger, context package, workflow version, nodes, capabilities, authority, artifacts, outcome, cost/time, audit, failure/recovery. Owner: Operating Layer.

- `src/business/core/workflow-templates.ts` — Canonical workflow definitions for each journey using `WorkflowDefinition` types. Versioned, integrity-hashed, published via WorkflowEngine. No visual editor. Owner: Workflow.

- `src/business/core/execution-bridge.ts` — Bridge business events to ExecutionService and WorkflowEngine: records execution per business operation, leases to prevent duplicate mutation, checkpoints for recovery, trust classification for business actions.

- `src/business/core/migration.ts` — Additional migration for new tables: `biz_outcomes`, `biz_record_mutations`, `biz_worker_authority`, `biz_artifacts`, `biz_approvals`, `biz_privacy_policies`. Preserves existing data, versioned.

### Updated Files
- `src/business/core/database.ts` — Add new tables, preserve existing. Integrate with WorkspaceStore adapter (already partly). Export new table names.

- `src/business/core/types.ts` — Add new types: Outcome, RecordMutation, WorkerAuthorityProfile, ArtifactLink, ApprovalRequest, PrivacyPolicy, JourneyDefinition. Preserve existing.

- `src/business/core/schema.ts` — Add CREATE TABLE for new tables, indexes. Preserve existing.

- `src/business/core/audit.ts` — Extend log to include workflowRef, executionRef, contextPackageId, evidenceRefs, previous value, reversibility, policy decision. Link to existing trust/audit mechanisms. Keep hash chain.

- `src/business/core/rbac.ts` — Integrate with trust authority, capability effective authority. Add `checkWorkerAuthority` method. Preserve role defaults.

- `src/business/core/organization.ts` — Add workspace privacy mode, max budget per worker. Preserve.

- `src/business/index.ts` — Wire new operating layer services, expose outcome-centered API. Keep lifecycle hook.

- `src/business/modules/*` — For each module, add governed operations:
  - `crm/index.ts` — Use record-mutation service, execution bridge, artifact service. Expose clear operations using canonical workflow nodes.
  - `sales/index.ts` — Add approval for high-value close, forecast outcome, cost/time tracking.
  - etc — Minimal changes to preserve data but integrate contracts. No new modules unless missing primitive blocks verified journey (allowed).

- `src/business/modules/ai-workers/index.ts` — Major refactor to implement worker-contract: inspection, enable/disable, authority, budget, escalation status. Integrate with workflow/task/execution/context/intelligence/capability/trust.

- `src/business/modules/documents/index.ts`, `meetings/index.ts`, `knowledge/index.ts` — Use artifact-evidence service, context/provenance.

- `src/business/modules/automation/engine.ts` — Deprecate bespoke engine, wrap canonical workflow engine, migration path.

- `src/integrations/credentials.ts` + `registry.ts` — Ensure use capability + trust/credential contracts, no ambient credentials, external writes require policy/approval.

- `src/commands/business.ts` — Extend to outcome-centered views: work queues, active workflows, worker status, approvals, records changed, evidence/artifacts, cost/time, failures/recovery, audit/provenance.

- `src/daemon/routes/` — Add `business.routes.ts` for outcomes, journeys, workers, approvals, artifacts. Wire in `index.ts`. No cloud control plane.

- `src/daemon/dashboard.ts` — Add sections (without claiming enterprise control plane) for work queues, active workflows, AI worker status, approvals/escalations, records changed, evidence/artifacts, cost/time, failures/recovery, audit/provenance. Progressive disclosure.

- `src/workflow/` templates — Add business journey templates (not visual editor).

- `src/context/`, `src/execution/`, `src/capabilities/`, `src/trust/` — No new architecture, only integration usage.

- Tests: new `test/business/operating-layer.test.ts`, `journey.test.ts`, `record-mutation.test.ts`, `worker-contract.test.ts`, `local-privacy.test.ts`, plus integration tests for each journey type.

### Deferred / Not Implemented
See section 10.

---

## 10. Phase 11+ Deferrals

Per strict scope, do NOT implement:

- Remote/cloud/hybrid control plane (no remote execution, no distributed infrastructure, no multi-tenant distributed).
- Multi-tenant distributed infrastructure (keep single-process, SQLite, workspace isolation, not cloud-scale).
- New environment interaction capabilities beyond existing (no new browser/desktop/voice providers).
- Visual workflow editor (workflow definitions remain code/JSON, versioned, no UI editor).
- New provider/routing engine (use existing intelligence plane from Phase 5).
- New memory/context architecture (use XR 4.5 context OS).
- New capability ecosystem (use XR 5.2 capability ecosystem, only integrate).
- New business modules unless missing contract blocks verified journey (only minimal primitives if needed, not module sprawl).
- ERP replacement scope (not full ERP, only outcome-oriented journeys where existing implementation sufficient).
- Autonomous high-stakes decisions without human gates (enforce approval/review).
- Enterprise-grade control plane, certifiable multi-tenant, global operability (Phase 12).
- XR OS supremacy features (Phase 13).

**Deferral marker:** All new code must include comments referencing that Phase 11+ features are deferred and must not be introduced.

---

## Verification Status

- Current commit: `c431499 Merge PR #25 phase9-xr-5.2-capability-ecosystem` → Version 5.2.0 Capability Ecosystem.
- `bun run typecheck` PASSED (0 errors).
- `test/business/business.test.ts` 21 PASS, `workflow` 36 PASS, `execution` 61 PASS, `capabilities/ecosystem` 5 PASS, `context` ~60 PASS, `trust` ~80 PASS, `environment` ~145 PASS, `intelligence` 34 PASS (sampled, total green per prior-phase gates).
- Migration/rollback: Idempotent business DB init verified, audit chain verification method exists, backup/restore not yet tested for new tables (to be added).
- Phase 9 blocked? No — Phase 9 green.

**Conclusion:** Baseline ready for Phase 10 implementation. Audit shows broad business system exists but remains collection of modules with bespoke behavior, not using canonical workflow/execution/trust/intelligence/context/capability contracts. Phase 10 must integrate, not expand modules.

---

*Audit produced per XR 5.3 Enterprise Implementation Prompt Section 5.*
