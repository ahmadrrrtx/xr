# XR — Target Product Architecture

> Tags: [OBSERVED] / [INFERRED] / [RECOMMENDED]. What XR becomes and how the pieces bind.

## 1. Product definition

**XR Desktop = one AI workstation**: a local-first, provider-neutral, audited environment where a human and XR do work together — talking, tasking, coding, researching, controlling, automating — with every capability of today's XR plus a coherent workstation experience.

Product sentence: *"XR is the AI you can actually trust, with a desk to work at."* (tagline heritage: [OBSERVED] logo.png).

## 2. Layered architecture

| Layer | Contents | Ownership | Reuse |
|---|---|---|---|
| L0 XR Core | agent loop, execution fabric, trust/placement, security services, cost, state/repos, providers/intelligence, context/memory, skills/plugins/MCP loaders, research, voice pipeline, automation | Engine (Bun, existing) | **reuse as-is** (~95%) |
| L1 Local Service | daemon server, route contracts (129 ops), SSE streams, auth/pairing, sidecar lifecycle | Engine | reuse; adapt pairing (SEC-04), finish business-route migration (SEC-05) |
| L2 IPC/API | OpenAPI contract + generated typed client; event schema (stream events, control events, approval events) | Shared | reuse; extend events for desktop (pane hints, avatar states) |
| L3 Desktop Shell | Tauri v2 app: surfaces, design system, editor, terminal panes, native trimmings | New | new code; consumes L2 only |
| L4 Operator surfaces | CLI, TUI Shell, VS Code ext, Telegram | Engine | reuse; re-skin terminology to shared glossary |

**Boundary law:** L3 never computes risk, never stores secrets, never signs audit, never enforces budget. L1 re-validates every call. (Constitutional heritage: Art. IV/IX spirit [OBSERVED]; SEC-07.)

## 3. Domain model (shared glossary — one vocabulary everywhere)

| Term | Meaning | Backing today |
|---|---|---|
| **Workspace** | a folder/project context w/ config, memory scope, permissions | workspaces [OBSERVED] |
| **Task** | a unit of requested work (chat turn → run) | sessions/executions |
| **Run** | durable execution record of a Task (plan, steps, tools, files, approvals, cost, artifacts) | execution fabric, session repo |
| **Agent** | role-scoped loop instance w/ permission profile | agents registry [OBSERVED] |
| **Team Run** | multi-agent workflow (orchestrator→roles→synthesis) | workflows/planner [OBSERVED] |
| **Capability** | anything XR can do: tool, skill, MCP tool, plugin command, integration | capabilities inventory (165) [OBSERVED] |
| **Approval** | human decision record (deny/allow-once/always) w/ risk context | approvals store [OBSERVED] |
| **Mode** | autonomy posture: Careful / Balanced / Autonomous ↔ trust tiers + approval policy | trust policy [OBSERVED] → rename UX |
| **Presence** | XR's ambient state (idle/listening/thinking/working/speaking/approval) | voice v2 states [OBSERVED] → generalize |

[RECOMMENDED] All surfaces (desktop/TUI/CLI/API docs) adopt these eight nouns; retire "session/guardrails/mission-control" as primary terms (keep as aliases during migration).

## 4. Capability → surface mapping (summary; full matrix in Feature Inventory)

- Talk/Task/Approve/Inspect → Work surface (all modes).
- Code/Edit/Diff/Terminal/Git → Workspace surface (editor+terminal+agent sidecar pane).
- Orchestrate teams → Agents surface (team run view).
- Discover/install/configure skills/MCP/plugins/integrations → Library surface.
- Remember/forget → Memory surface (also inline in Work).
- Models/providers/keys/local → Model Center (Settings→Models).
- Runs/history/resume → Runs surface (global, filter by workspace).
- Trust: approvals, modes, audit, shield, budgets → Trust Center.
- Voice/computer-control → ambient modes w/ cockpit sheets, not nav pages.
- Automation/triggers → Settings→Automation + Runs filters.

## 5. Execution anatomy (target UX over existing fabric)

```
Task created (composer/CLI/deep-link/voice/trigger)
 → Run spawned (execution fabric) → live event stream (SSE)
 → Work surface: transcript + tool timeline + file deltas + approvals inline
 → Workspace surface: diff pane updates live; terminal shows commands
 → Run completes → Runs surface: full anatomy (plan/agents/tools/files/approvals/cost/artifacts)
 → Actions: resume · retry · duplicate · open-in-workspace · export
```
All backed by existing repos (session/checkpoint/cost/audit/workflow). [OBSERVED feasibility]

## 6. What we deliberately do NOT build

- No cloud control plane (local-first; satellites own enterprise/cloud).
- No second agent loop or per-surface runtime.
- No frontend policy engine.
- No new logo/brand character.
- No dashboard-cockpit revival (Control Center becomes headless fallback + API playground). [RECOMMENDED]

## 7. Success criteria (product)

1. New user: install → first-launch experience → first completed Task with visible trust moments < 10 min.
2. Power user: CLI/TUI/desktop share state instantly (same daemon).
3. Every existing capability reachable in ≤3 interactions from Home (progressive disclosure).
4. Zero security-boundary code in shell (CI-enforced).
5. 65 skills discoverable as a library w/ permissions legible to non-experts. [RECOMMENDED]
