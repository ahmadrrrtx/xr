# XR 3.1A — Information Architecture
> The canonical map of what exists inside XR, how it's organized, and how users think about it.

This document defines:
1. The **objects** in XR (nouns)
2. The **relationships** between them
3. The **hierarchy** of surfaces and sections
4. The **canonical vocabulary** (no more "shell/console/dashboard/Mission Control" confusion)

---

## 1. The Canonical Vocabulary

Every surface, every doc, every command uses these words. No synonyms.

### 1.1 Surfaces (how you interact with XR)

| Term | Meaning |
|---|---|
| **XR** | The product, the OS, the binary |
| **Shell** | The terminal-native fullscreen experience (`xr` with no args). "TUI" is an implementation term — never exposed to the user. |
| **Control Center** | The web dashboard served by `xr serve` on `127.0.0.1:3141`. "Dashboard" is acceptable in developer docs; the user-facing name is Control Center. |
| **CLI** | One-shot command-line invocation (`xr "<task>"`, `xr models list`). Pipeable, scriptable, non-interactive. |
| **Extensions** | Third-party editors/devices that talk to XR: VS Code extension, future Zed/JetBrains, future mobile app. |
| **Telegram Bot** | Optional remote-control surface. Explicit opt-in. |
| **Voice** | Input/output modality, not a separate surface. Voice works inside the Shell and (eventually) Control Center. |

### 1.2 Structural nouns (what XR organizes)

| Term | Meaning | One-line definition |
|---|---|---|
| **Workspace** | Isolation boundary | A named context with its own working directory, memory, audit log, sessions, and budget. Like a "profile" or "tenant." |
| **Session** | A thread of work | A single conversation/execution. Belongs to exactly one workspace. Has a title, mode, status, cost, history of messages and tool calls. Sessions can be running, paused, done, or errored. |
| **Message** | A turn in a session | Either user text, assistant text, or a system notice. Rendered in the chat view. |
| **Tool Call** | An action XR took | An invocation of a tool (shell, file, provider, browser, computer-control, plugin, skill, MCP). Belongs to a message. Has input, output, duration, approval state. |
| **Provider** | An AI model vendor or runtime | Ollama, OpenAI, Anthropic, Google, Groq, local runtime. Has models, health, API key state, latency. |
| **Model** | A specific AI model | e.g., `claude-sonnet-4-20250514`, `gpt-5`, `qwen2.5:7b`. Belongs to a provider. Has pricing, context window, capabilities. |
| **Skill** | A capability pack | An installable bundle of prompts, templates, docs, metadata, and permissions. Adds capabilities. Published and versioned. Marketplace unit. |
| **Plugin** | A deep integration | A code-level extension that adds commands, tools, or hooks. Heavier than a skill. Requires trust/enable. |
| **MCP Server** | External tool server | A process that implements the Model Context Protocol, exposing tools to XR. Registered by the user. |
| **Memory** | Durable user knowledge | Explicitly saved facts, preferences, project conventions. Scoped by workspace/project/global. Injectable into prompts on demand. |
| **Research** | A citable report | A structured research session with a topic, plan, sources, claims, contradictions, synthesis. Rendered as an artifact. |
| **Artifact** | A produced thing | A file, report, plan, diff, chart, code block, or table produced by XR during a session. Rendered inline; exportable. |
| **Audit Entry** | A tamper-evident log record | Every notable action (model call, tool invocation, config change, approval, denial) writes one. Chained by SHA-256. |
| **Approval** | A permission gate | A request from XR to the user before taking a risky action (shell, file write, send, external network). |
| **Budget** | Spend controls | Per-task hard cap (code-enforced), per-day/per-month soft caps, per-provider/per-model breakdown. |
| **Shield** | Security/privacy subsystem | Process inspection, startup audit, tracker/ad blocking, browser privacy, file quarantine. |
| **Agent** | A multi-agent worker | A named role in the multi-agent runtime (supervisor, planner, executor, researcher…). Configurable. |

### 1.3 Verbs (what you do)

| Verb | Meaning |
|---|---|
| **Run** | Execute a task from the composer (`xr "do X"`, Enter in composer) |
| **Ask** | Answer a question without executing tools (`/ask` mode) |
| **Plan** | Produce a plan without executing (`/plan` mode) |
| **Approve / Deny** | Respond to an approval request |
| **Resume** | Continue a paused or past session |
| **Switch** | Change workspace/model/provider/mode (not "change" or "set") |
| **Install / Enable / Disable / Remove** | Skills, plugins, MCP servers |
| **Remember / Forget** | Memory entries |
| **Export** | Audit, research, session transcript |
| **Verify** | Audit chain integrity |

### 1.4 Modes

| Mode | Shown as | Behavior |
|---|---|---|
| **Agent** | `agent` (cyan) | Execute actions, call tools, run shell, write files. Approvals enforced. |
| **Plan** | `plan` (violet) | Produce a step-by-step plan with checkboxes; no tool execution or file changes. |
| **Ask** | `ask` (dim) | Answer-only mode. No tools. Read-only. Cheap. |

Voice is a modality, not a mode. The mic icon next to the composer indicates voice is on; the mode chip still reads agent/plan/ask.

---

## 2. Object model (relationships)

```
XR (binary, local)
└── Workspace (1:N active)
    ├── Memory entries (0:N)
    ├── Audit chain (append-only, hash-chained)
    ├── Budget config
    ├── Sessions (0:N)
    │   ├── Messages (1:N, ordered)
    │   │   └── Tool calls (0:N)
    │   │       ├── Approval (0:1)
    │   │       └── Artifacts (0:N)
    │   └── Cost/token tallies
    ├── Research runs (0:N) → produces Artifact (report)
    ├── Skills installed (0:N)
    ├── Plugins enabled (0:N)
    └── MCP servers registered (0:N)

User
├── Global config (preferences, keybindings, theme)
├── API keys (OS keychain)
└── Default workspace
```

### 2.1 Key relationships
- A **session** belongs to exactly one **workspace**. Moving a session between workspaces is not supported.
- A **tool call** belongs to exactly one **message** (an assistant message that decided to call a tool).
- An **approval** belongs to exactly one **tool call** (one-to-one, or null if approval not required).
- **Memory** can be global (across workspaces) or scoped to a workspace or path.
- **Skills** are installed per workspace (with an option for global install).
- **Providers** are globally configured (API keys stored in OS keychain); per-workspace provider overrides are allowed.
- **Audit entries** are append-only and hash-chained within a workspace. Cross-workspace audit is the union.
- **Artifacts** exist within a session but can be exported to files outside XR.

### 2.2 State machines

**Session status:**
```
draft → running → (paused ⇄ running) → done
                            ↘ error
                            ↘ stopped (by user, budget, approval-denied)
```

**Tool call status:**
```
planned → awaiting_approval → running → done
                                           ↘ error
                                           ↘ denied
```

**Approval status:**
`pending → approved (with optional "always for this pattern" rule) → denied`

**Provider health:**
`unknown → checking → healthy · degraded · unreachable · no-key`

---

## 3. Site map (Control Center)

```
Control Center (web)
├── Overview (home/dashboard)
├── Chat (default session)
├── Sessions
│   └── :sessionId  (drill-down: messages, tool calls, cost, artifacts, audit tail)
├── Workspaces
│   └── :workspaceId (overview, sessions, memory, skills, audit per-workspace)
├── Research
│   └── :researchId (citable report)
├── Marketplace (Skills)
│   ├── Browse
│   ├── Installed
│   └── :skillId (details, install, permissions)
├── Plugins
├── MCP Servers
├── Computer Control
│   ├── Plan
│   ├── Activity
│   └── Pending Approvals
├── Shield (security/privacy)
│   ├── Overview
│   ├── Processes
│   ├── Startup
│   ├── Downloads
│   ├── Browser
│   └── Security Lab
├── Audit Log
│   └── :entryId (hash-chain verification view)
├── Budget & Cost
├── Providers & Models
├── Memory
├── Voice
└── Settings
    ├── General (theme, density, keybindings)
    ├── Providers (API keys, defaults)
    ├── Models (local models, routing)
    ├── Budget defaults
    ├── Memory preferences
    ├── Voice settings
    ├── Trust (approvals, egress, Shield)
    ├── Skills & Plugins
    ├── MCP
    ├── Computer Control
    └── About (version, open source license, export all data)
```

### URL structure (deep linking required)
```
/                                       → /overview
/chat                                   → active session chat
/chat/:sessionId                        → specific session
/sessions                               → session list
/sessions/:id                           → session detail
/workspaces                             → workspace switcher
/workspaces/:id                         → workspace overview
/research                               → research list
/research/:id                           → research report
/marketplace                            → skills marketplace
/marketplace/:id                        → skill detail
/plugins                                → plugin manager
/mcp                                    → MCP server manager
/control                                → computer control
/shield                                 → security/privacy
/audit                                  → audit log
/audit/verify                           → chain verification view
/budget                                 → budget & cost
/providers                              → provider manager
/memory                                 → memory browser
/voice                                  → voice settings
/settings                               → general settings
/settings/:section                      → specific settings section
```

URL updates happen on panel switch. Back/forward buttons work. Refresh preserves the current view.

---

## 4. Site map (Shell / TUI)

The Shell has a **slimmer navigation** than the Control Center because terminals have limited space and keyboard navigation favors shallow hierarchies.

```
Shell (xr)
├── Home (startup hub)
├── Chat (current session)            ← primary surface
├── Sessions (picker + resume)
├── Workspaces (picker)
├── Research (list + open in Control Center or inline viewer)
├── Activity (tool timeline)
├── Audit Log (browser)
├── Memory (viewer)
├── Status (system overview)
├── Command Palette (Ctrl+K)
├── Notifications (Ctrl+N)
└── Settings (compact, navigated via /config or palette)
```

Everything else (Marketplace, Plugins, Shield, detailed Budget, Voice settings) is accessible via:
- The Command Palette (open and type the name)
- Slash commands (`/marketplace`, `/plugins`, `/shield`, `/budget`)
- Hint: "Open in Control Center for full UI" (launches browser to the matching URL)

---

## 5. Site map (CLI)

The CLI is **command-based**, not navigational. Commands are grouped by intent:

```
xr                              → open Shell (default)
xr "<task>"                     → one-shot agent run
xr --help, xr help [topic]      → help
xr --version                    → version
xr serve                        → start Control Center server

xr run "<task>" [flags]         → explicit run (default command)
  --mode agent|plan|ask
  --model <provider/model>
  --budget <usd>
  --workspace <id>
  --output text|json|markdown
  --resume <sessionId>

xr workspace list|create|switch|delete
xr session list|resume|fork|export
xr memory add|list|search|forget|clear
xr research <topic> [--deep] [--compare] [--factcheck]
xr models list|recommend|install|test|select
xr providers list|set|add|test|health
xr budget [--set <usd>] [--monthly <usd>]
xr plugins install|enable|disable|list|remove|search
xr skills ... (mirrors marketplace commands)
xr mcp add|list|remove|test
xr agents list|plan
xr control start|stop|status|plan|open
xr voice start|stop|test|wake
xr shield scan|status|processes|startup|quarantine
xr audit tail|verify|export
xr config get|set|reset
xr doctor                       → health check + repair hints
xr onboarding                   → first-run wizard (re-runnable)
xr update                       → check for updates, install
```

All CLI commands also accept:
- `--json` for machine-readable output (scripting)
- `--workspace <id>` to target a workspace other than active
- `--quiet` to suppress non-essential output

---

## 6. Information hierarchy by task

### 6.1 "I want to ask XR something"
1. Open XR (Shell or Control Center)
2. Composer is focused
3. Type, press Enter
4. Stream starts
5. See response and tool calls

**Depth: 0 clicks/keystrokes after launch.** Composer is always focused on open.

### 6.2 "I want to see what XR is doing right now"
1. Open XR
2. Status bar (always visible) shows active session, step, cost
3. Activity/Inspector panel (Shell: inspector right; Control Center: collapsible right rail) shows tool timeline
4. Clicking a tool call expands args/output

**Depth: 0 (visible by default).**

### 6.3 "I want to see how much I've spent"
1. Status bar shows session spend and today's spend at all times
2. Click/select the spend chip → Budget panel opens with full breakdown
3. `/budget` command works in composer

**Depth: 1 click/keystroke.**

### 6.4 "I want to resume prior work"
1. Open XR
2. Home shows "Recent sessions" (top of list)
3. Or `/sessions` or Ctrl+P (palette "resume") fuzzy-search sessions
4. Select → session resumes, state restored

**Depth: 1–2 keystrokes.**

### 6.5 "I want to switch model"
1. Click model chip in status/composer
2. Popover list of models with latency, cost, capabilities badges
3. Select → model switches live; active session continues with new model
4. `/model <provider/model>` slash command

**Depth: 1 click, or typed command.**

### 6.6 "I want to install a skill"
1. `/marketplace` or Ctrl+K "marketplace" or sidebar Marketplace
2. Browse/search → see permissions, dependencies, examples
3. Install → one confirmation
4. Skill commands appear in `/` menu next time composer is opened

**Depth: 3 keystrokes from anywhere.**

### 6.7 "I want to audit what XR did yesterday"
1. Audit Log panel
2. Filter by date range, event type, session
3. "Verify chain" button confirms integrity
4. Export signed report to markdown/PDF

**Depth: 2 navigation steps.**

---

## 7. Search architecture

XR has three search surfaces. Each has a distinct job.

### 7.1 Command Palette (Ctrl+K)
- Searches: commands, views, settings, recent sessions, recent workspaces, skills
- Scope: everything XR can do or navigate to
- Activation: Ctrl/Cmd+K from anywhere
- Keyboard: ↑/↓ to select, Enter to run, Esc to dismiss
- Result: always performs an action or navigates; never opens a search-results page

### 7.2 In-composer slash `/` menu
- Searches: slash commands only (commands that operate in current session)
- Scope: current session
- Activation: typing `/` at start of composer word, or pressing `/`
- Result: inserts command (with arguments where applicable)

### 7.3 In-composer @-mention menu
- Searches: files in cwd, open sessions, skills, providers, memory, web search
- Scope: current composer input (context attachment)
- Activation: typing `@`
- Result: inserts a reference chip into the composer that gets attached as context

### 7.4 Dedicated search (Ctrl+P / "Find")
- Searches: memory, sessions, audit log, skills, documentation
- Scope: the active panel's content
- Activation: Ctrl+F within a list; or `/search` in composer for global memory/session search
- Result: filtered list within current view; never navigates away

---

## 8. Settings architecture

Settings are organized into these sections (same order in Control Center, Shell `/config`, and CLI `xr config`):

1. **General** — theme, density, font size, language, startup behavior
2. **Keyboard Shortcuts** — view and customize bindings
3. **Providers** — API keys, default provider/model, fallback, routing (local-first/hybrid/cloud-first)
4. **Local Models** — runtime selection, installed models, hardware recommendation
5. **Budget** — per-task hard cap, daily/monthly soft caps, warnings, auto-fallback rules
6. **Memory** — enable/disable, auto-suggest, semantic recall, categories, data management (export/clear)
7. **Voice** — enable/disable, mode (push-to-talk vs wake), STT/TTS engine, wake word
8. **Trust & Safety** — approval gates (which tool categories require approval), egress allow-list, Shield toggles, injection defense, audit retention
9. **Computer Control** — enable/disable, vision, allowed actions, per-app permissions
10. **Skills & Plugins** — registry configuration, trust levels, auto-update policy
11. **MCP Servers** — add/remove/test servers
12. **Notifications** — desktop notifications, toast preferences, sound
13. **Advanced** — config file path, log level, telemetry (always off), experimental features
14. **About** — version, license, links, check for updates, export all data, reset to defaults

### Rules
- Every setting has a sensible default. The user can complete onboarding without touching Settings.
- Dangerous toggles (disable approvals, disable egress filter, enable computer control) require a typed confirmation ("I understand") before they take effect.
- Settings are reflected live — no "Save" button required (changes save on change).
- A "Restore defaults" button exists at the section level.

---

## 9. Notification architecture

| Severity | When used | Delivery (Shell) | Delivery (Control Center) | Delivery (CLI) |
|---|---|---|---|---|
| **critical** | Approval required, budget hit, task error, security block | Modal (blocks until answered) | Red toast + popover; must acknowledge | Prints to stderr, pauses for input if interactive |
| **warning** | Provider degraded, model fallback, egress blocked, near budget | Top-of-composer warning line | Amber toast (3s auto-dismiss) | Prints warning to stderr |
| **info** | Task completed, skill installed, workspace switched | Status chip update + brief toast (2s) | Blue toast (2s) | Prints "✓ …" line |
| **success** | Onboarding complete, verification passed, export done | Brief green toast | Green toast (2s) | Prints "✓ …" line |
| **silent** | Normal state changes, streaming progress, heartbeat | Status bar update only | Status chip update only | N/A (pipes cleanly) |

Rules:
- Max 3 toasts visible at once (queue newer, drop oldest after dismissal).
- Critical notifications stack; user must dismiss.
- Composer is never blocked by non-critical notifications.
- Every notification has a corresponding entry in the Notifications panel (Ctrl+N).

---

## 10. Breadcrumbs and location awareness

Every surface shows the user exactly where they are.

### Shell
- Status bar shows: `workspace › session › mode` (left)
- Top of main pane shows the view title
- Example: `default › Refactor auth · agent  ..................  ollama/qwen2.5:7b  $0.0034  ✓`

### Control Center
- Topbar shows breadcrumb: `XR › Workspaces › default › Sessions › Refactor auth`
- Each breadcrumb segment is clickable
- Sidebar highlights the active nav item

### CLI
- Every command output begins with a 1-line header (when interactive):
  `● default  agent  ollama/qwen2.5:7b`
- Non-interactive (piped) mode suppresses the header; only output prints.
