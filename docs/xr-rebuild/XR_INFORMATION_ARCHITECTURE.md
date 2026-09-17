# XR — Information Architecture (target)

> Tags: [INFERRED] from audit + research · [RECOMMENDED]. Principle: expose *work*, hide *subsystems*; progressive disclosure; one vocabulary (Product Architecture §3).

## 1. Primary navigation (5 areas + presence)

| # | Area | Purpose | Contains (progressive) |
|---|---|---|---|
| 1 | **Home** | "What do you want XR to do?" | composer-first; continue-work cards; pending approvals badge; readiness strip (engine/providers/voice); recent runs |
| 2 | **Work** | the conversation+execution surface | task transcript, live tool timeline, inline approvals, attachments, mode/model picker, memory peek, run inspector drawer |
| 3 | **Workspace** | project gravity | file explorer, editor tabs, diffs, problems, terminal panes, git panel, preview, agent sidecar pane (select→ask→diff→approve→apply) |
| 4 | **Agents** | orchestration visibility | team runs (roles/status/dependencies/progress/budget), agent definitions, conflict/ownership view |
| 5 | **Library** | capability discovery | Skills (65+), MCP connections, Plugins, Integrations, Models & Providers (Model Center), each w/ detail sheets |
| — | **Trust Center** (secondary, global) | safety & control | Approvals queue, Modes, Audit log, Budgets, Shield/hygiene, Permissions, Security settings |
| — | **Runs** (global) | history as product data | filterable run list + full anatomy view |
| — | **Settings** | configuration | General, Models, Local, Automation, Voice, Privacy, Advanced (raw config/API) |

Presence (not nav): avatar orb (voice/ambient states), acting indicator (computer control), tray.

**Mapping from today:** 23 panels → folded: dashboard→Home; chat/sessions→Work/Runs; agents→Agents; providers/models→Library/Model Center; skills/mcp/plugins→Library; memory→Work drawer + Settings→Memory; approvals/budget/audit/shield→Trust Center; automation/triggers→Settings→Automation + Runs; capabilities→Library (advanced view) + Trust→Permissions; control/voice→modes; files/research→Workspace/Work; workspaces→window-level context switcher; about/settings→Settings. [RECOMMENDED]

## 2. Global actions & command palette

- **⌘K / Ctrl+K palette:** fuzzy over actions (new task, open file, switch workspace, run skill by name, connect MCP, set mode, approve pending…) + navigation + recent runs. Parity rule: every nav destination and every CLI verb concept reachable. [RECOMMENDED]
- **Global shortcut (OS):** quick-capture task from anywhere → routes to Work.
- **Quick keys:** `g h/w/s/a/l` area jumps (heritage of dashboard letter-map [OBSERVED]); `⌘.` stop XR; `⌘A` approvals; `⌘V` voice toggle.
- **Context switcher:** workspace/project picker in titlebar (workspaces remain engine concept).

## 3. Secondary navigation patterns

- Within-area tabs only where anatomy demands (Workspace: Explorer/Editor/Search/Git/Problems; Run view: Transcript/Plan/Files/Tools/Approvals/Cost/Artifacts).
- Detail = right sheet/drawer (skill detail, MCP detail, run inspector, memory entry) — never new nav nodes.
- Advanced/raw surfaces (config JSON, OpenAPI playground, capability grants table) live under Settings→Advanced with warning styling. [RECOMMENDED]

## 4. State & context model

- Window context = workspace; Task context = run; both visible in titlebar breadcrumb: `XR › <workspace> › <task title>`.
- Approval requests are *interrupts*: global sheet w/ source label (which agent/run), never buried in a panel (research: cross-thread approval overlay [Codex]).
- Empty/loading/error states designed per surface (Screen Specs).

## 5. Terminology map (old → new)

| Old surface term | New term |
|---|---|
| Control Center / Mission Control / Shell | XR Desktop (app), Work (surface) |
| session | Run (history) / Task (live) |
| guardrails / trust panel | Trust Center |
| capabilities | Permissions (Trust) + Library (advanced) |
| extensions | Library |
| models/providers | Model Center |
| triggers | Automations |
| shield/hygiene | Shield (inside Trust Center) |

## 6. Disclosure ladder (complexity budget)

1. **See:** composer, cards, presence. 2. **Open:** drawers/sheets (run inspector, skill detail). 3. **Configure:** Settings/Trust Center. 4. **Raw:** Advanced (JSON/config/API). Nothing at level 4 appears at level 1. [RECOMMENDED]
