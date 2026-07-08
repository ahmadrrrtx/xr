# XR Stage 15 — Business OS Architecture

**Version:** 15.0.0  
**Status:** Production Architecture  
**License:** MIT  
**Date:** 2026-07-08

---

## Executive Summary

XR Stage 15 transforms XR from an AI agent into an **AI Business Operating System**. It unifies CRM, Sales, Marketing, Support, Projects, Knowledge, Finance, HR, Analytics, Automation, Scheduling, Communication, Documents, Meetings, and AI Workers behind one intelligent AI platform.

### Design Principles

1. **Local-first, BYOK** — Zero vendor lock-in. Users own their data and credentials.
2. **Module as Skills** — Every Business OS module is an XR Skill, extensible through the existing Skill Runtime.
3. **Integration through MCP/Plugins** — External services connect via existing MCP Platform and Plugin Platform.
4. **AI Workers as Agents** — Each business role is an XR Agent with Memory, Research, Voice, and Computer Control.
5. **Privacy by Default** — No silent data collection. All integrations are opt-in with explicit permissions.
6. **Workspace Isolation** — Organizations and workspaces are fully isolated. RBAC enforced at every layer.
7. **Audit Everything** — XR Shield policies, tamper-evident audit log, and permission approvals on all mutations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     XR Business OS Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  CRM │ Sales │ Marketing │ Support │ Projects │ Knowledge       │
│  Finance │ HR │ Analytics │ Automation │ Scheduling │ Comms     │
│  Documents │ Meetings │ AI Workers                               │
├─────────────────────────────────────────────────────────────────┤
│                   Business Core Services                         │
│  Organization │ Workspace │ RBAC │ Contacts │ Pipeline │ Events │
│  Audit │ Webhooks │ Scheduler │ EventBus                        │
├─────────────────────────────────────────────────────────────────┤
│                    Integration Layer                              │
│  OAuth │ BYOK │ Connector Registry │ Credential Vault           │
├─────────────────────────────────────────────────────────────────┤
│              Existing XR Platform (Stage 1-14)                   │
│  Provider Engine │ Memory Engine │ Research Engine │ Voice Stack │
│  Computer Control │ Plugin Platform │ MCP Platform │ Skills      │
│  Multi-Agent Runtime │ Dashboard │ CLI │ TUI │ XR Shield        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Map

### How Business OS connects to existing XR systems:

| XR System        | Business OS Integration                                           |
| ---------------- | ----------------------------------------------------------------- |
| **Provider Engine** | AI Workers use Provider Engine for LLM calls. No new providers.  |
| **Memory Engine**   | Business entities stored as Memory entries with business schema.  |
| **Research Engine** | AI Workers use Research Engine for market analysis, competitor monitoring. |
| **Voice Stack**     | AI Workers respond via Voice. Meeting transcription uses STT.    |
| **Computer Control**| AI Workers can control computer for report generation, screenshots. |
| **Plugin Platform** | External integrations (Gmail, Slack, etc.) are XR Plugins.       |
| **MCP Platform**    | CRM/ERP integrations (HubSpot, Salesforce) connect via MCP.     |
| **Skill Runtime**   | Each Business module registers as an XR Skill.                   |
| **Dashboard**       | Business OS UI served through existing daemon dashboard.         |
| **CLI**             | `xr biz` commands registered through command registry.           |
| **TUI**             | Business context available in interactive TUI.                   |
| **Multi-Agent**     | AI Workers are XR Agents registered in agent registry.           |
| **XR Shield**       | All Business OS operations pass through Shield policy engine.    |

### What is NOT duplicated:

- ❌ No new LLM provider — uses Provider Engine
- ❌ No new memory store — uses Memory Engine
- ❌ No new search — uses Research Engine
- ❌ No new voice — uses Voice Stack
- ❌ No new plugin system — uses Plugin Platform
- ❌ No new MCP client — uses MCP Platform
- ❌ No new agent runtime — uses Multi-Agent Runtime
- ❌ No new dashboard server — extends daemon/dashboard
- ❌ No new CLI framework — extends command registry
- ❌ No new security layer — uses XR Shield

---

## Module Architecture

### Data Model

All Business OS data uses a unified entity model stored in SQLite (existing XR data store):

```
Organization (top-level tenant)
  └── Workspace (team/project scope)
       ├── Members (users with roles)
       ├── Contacts (CRM entities)
       ├── Deals (sales pipeline)
       ├── Tickets (support)
       ├── Projects
       │    ├── Tasks
       │    └── Milestones
       ├── Documents
       ├── Meetings
       ├── Events (calendar)
       ├── Automations (workflows)
       ├── AI Workers (agent configs)
       └── Integrations (connected services)
```

### Module List

| Module          | Description                              | Skill ID              |
| --------------- | ---------------------------------------- | --------------------- |
| **CRM**         | Contact management, companies, deals     | `business_crm`        |
| **Sales**       | Pipeline, forecasting, proposals         | `business_sales`      |
| **Marketing**   | Campaigns, content calendar, analytics   | `business_marketing`  |
| **Support**     | Tickets, SLA, knowledge base             | `business_support`    |
| **Projects**    | Tasks, milestones, timelines             | `business_projects`   |
| **Knowledge**   | Wiki, SOPs, runbooks                     | `business_knowledge`  |
| **Finance**     | Invoices, expenses, P&L                  | `business_finance`    |
| **HR**          | People directory, time-off, reviews      | `business_hr`         |
| **Analytics**   | Dashboards, reports, metrics             | `business_analytics`  |
| **Automation**  | Workflows, triggers, actions             | `business_automation` |
| **Scheduling**  | Calendar, appointments, availability     | `business_scheduling` |
| **Communication** | Email, chat, notifications             | `business_comm`       |
| **Documents**   | Create, edit, templates                  | `business_docs`       |
| **Meetings**    | Scheduling, notes, transcription         | `business_meetings`   |
| **AI Workers**  | Specialized AI business roles            | `business_workers`    |

---

## File Structure

```
src/business/
├── core/
│   ├── types.ts              # Business OS type definitions
│   ├── schema.ts             # SQLite schema definitions
│   ├── database.ts           # Database manager
│   ├── organization.ts       # Organization management
│   ├── workspace.ts          # Workspace management
│   ├── rbac.ts               # Role-based access control
│   ├── contacts.ts           # Unified contact model
│   ├── pipeline.ts           # Sales pipeline engine
│   ├── events.ts             # Event/activity tracking
│   ├── audit.ts              # Business audit trail
│   ├── webhooks.ts           # Webhook dispatcher
│   ├── scheduler.ts          # Job scheduler
│   ├── bus.ts                # Business event bus
│   └── index.ts              # Core barrel export
├── modules/
│   ├── crm/
│   │   ├── index.ts          # CRM module
│   │   └── skill.ts          # CRM skill definition
│   ├── sales/
│   │   ├── index.ts          # Sales module
│   │   └── skill.ts          # Sales skill definition
│   ├── marketing/
│   │   ├── index.ts          # Marketing module
│   │   └── skill.ts
│   ├── support/
│   │   ├── index.ts          # Support module
│   │   └── skill.ts
│   ├── projects/
│   │   ├── index.ts          # Projects module
│   │   └── skill.ts
│   ├── knowledge/
│   │   ├── index.ts          # Knowledge module
│   │   └── skill.ts
│   ├── finance/
│   │   ├── index.ts          # Finance module
│   │   └── skill.ts
│   ├── hr/
│   │   ├── index.ts          # HR module
│   │   └── skill.ts
│   ├── analytics/
│   │   ├── index.ts          # Analytics module
│   │   └── skill.ts
│   ├── automation/
│   │   ├── index.ts          # Automation module
│   │   ├── engine.ts         # Workflow execution engine
│   │   └── skill.ts
│   ├── scheduling/
│   │   ├── index.ts          # Scheduling module
│   │   └── skill.ts
│   ├── communication/
│   │   ├── index.ts          # Communication module
│   │   └── skill.ts
│   ├── documents/
│   │   ├── index.ts          # Documents module
│   │   └── skill.ts
│   ├── meetings/
│   │   ├── index.ts          # Meetings module
│   │   └── skill.ts
│   └── ai-workers/
│       ├── index.ts          # AI Workers module
│       ├── workers.ts        # Worker definitions
│       └── skill.ts
├── integrations/
│   ├── connectors/
│   │   ├── gmail.ts
│   │   ├── slack.ts
│   │   ├── github.ts
│   │   ├── google-calendar.ts
│   │   ├── stripe.ts
│   │   ├── hubspot.ts
│   │   └── index.ts
│   ├── registry.ts           # Integration registry
│   ├── oauth.ts              # OAuth flow manager
│   └── credentials.ts        # Credential vault (BYOK)
├── security/
│   ├── policies.ts           # Business OS security policies
│   ├── permissions.ts        # Permission definitions
│   └── isolation.ts          # Workspace isolation
├── schemas/
│   └── business-os.skill.json
├── skills/
│   └── business-os/
│       └── xr-skill.json
├── templates/
│   ├── workflows/
│   │   ├── lead-qualification.json
│   │   ├── sales-followup.json
│   │   ├── meeting-prep.json
│   │   ├── proposal-generation.json
│   │   ├── invoice-generation.json
│   │   ├── customer-onboarding.json
│   │   ├── weekly-reports.json
│   │   ├── competitor-monitoring.json
│   │   ├── market-research.json
│   │   ├── content-calendar.json
│   │   ├── email-campaign.json
│   │   └── support-routing.json
│   └── workers/
│       ├── ceo-advisor.json
│       ├── sales-director.json
│       ├── marketing-director.json
│       ├── financial-analyst.json
│       ├── hr-manager.json
│       ├── project-manager.json
│       ├── support-manager.json
│       ├── operations-manager.json
│       ├── legal-assistant.json
│       ├── research-analyst.json
│       └── growth-strategist.json
└── tests/
    ├── core.test.ts
    ├── modules.test.ts
    └── integrations.test.ts
```

---

## Migration Guide

### From existing XR to Business OS:

1. **No breaking changes** — Business OS is additive. Existing XR features unchanged.
2. **Run migration:** `xr biz init` creates the business schema in existing SQLite.
3. **Enable modules:** `xr biz enable crm,sales,analytics` activates modules.
4. **Connect integrations:** `xr biz connect gmail` starts OAuth flow.
5. **Deploy AI Workers:** `xr biz worker deploy ceo-advisor` activates a worker.

### Rollback:

1. `xr biz disable` — Disables all Business OS modules (data preserved).
2. `xr biz uninstall` — Removes Business OS (with confirmation).

---

## Validation Checklist

- [x] No duplicate systems — every capability delegates to existing XR engine
- [x] BYOK enforced — all integrations use user-provided credentials
- [x] Local-first — SQLite storage, no cloud dependency
- [x] XR Shield integration — all operations pass through policy engine
- [x] Audit logging — all mutations logged with SHA-256 chain
- [x] Workspace isolation — organizations fully isolated
- [x] RBAC — role-based access at every layer
- [x] Permission approvals — explicit consent for all integrations
- [x] Skill-based modules — each module is an XR Skill
- [x] Agent-based workers — each AI Worker is an XR Agent
- [x] MCP integration — external CRM/ERP via MCP
- [x] Plugin integration — external services via Plugins
- [x] Voice integration — AI Workers support voice
- [x] Memory integration — business entities in Memory Engine
- [x] Research integration — AI Workers use Research Engine
