# XR UX Implementation Plan

**Plan Date:** 2026-08-12
**Version:** 1.0
**Based on:** Phase 0 UX Audit

---

## OVERVIEW

This plan transforms XR from a powerful terminal tool into a polished, consumer-ready AI agent product. The plan follows the mandatory phased approach, with each phase building on the previous.

**Core principle:** Preserve all backend functionality. Enhance the experience layer.

---

## PHASE STRUCTURE

```
PHASE 0 ✅  Repository + UX Audit (COMPLETE)
PHASE 1    Information Architecture
PHASE 2    XR Design System
PHASE 3    Onboarding
PHASE 4    Main Chat Experience
PHASE 5    Navigation + Control Center
PHASE 6    Provider + Local Model UX
PHASE 7    Voice + XR Avatar
PHASE 8    Skills + MCP + Agents
PHASE 9    Memory + Research + Automation
PHASE 10   Computer Control
PHASE 11   Coding Workspace
PHASE 12   Dashboard + Settings + Security
PHASE 13   TUI Enhancement
PHASE 14   CLI Enhancement
PHASE 15   Cross-Surface Consistency
PHASE 16   Performance + Accessibility
PHASE 17   End-to-End Product Testing
PHASE 18   Release Readiness
```

---

## PHASE 1: INFORMATION ARCHITECTURE

**Objective:** Define how users navigate XR. Group capabilities intelligently. Beginner-friendly without hiding advanced features.

**Affected Files:**
- `src/interfaces/shell/app.ts` — navigation structure
- `src/interfaces/shell/render.ts` — view rendering
- `src/interfaces/shell/types.ts` — view types
- `src/ui/icons.ts` — navigation icons
- `src/daemon/dashboard/` — web navigation

**Key Decisions:**
1. **Central chat is the heart** — Everything accessible from or to chat
2. **Sidebar groups:**
   - **Conversation:** Chat, Sessions, Research
   - **Agents:** Agents, Workflows, Automations
   - **Knowledge:** Memory, Files, Skills
   - **Setup:** Providers, Models, Settings
   - **System:** Dashboard, Security, Usage
3. **Progressive disclosure:** Advanced features discoverable but not overwhelming
4. **Command palette** (Ctrl+K / Cmd+K) for keyboard users

**Deliverables:**
- `XR_INFORMATION_ARCHITECTURE.md`
- Updated navigation structure in Shell
- Web dashboard navigation matching Shell mental model

---

## PHASE 2: XR DESIGN SYSTEM

**Objective:** Create cohesive visual language across all surfaces. Apply brand tokens fully. Add avatar integration system.

**Affected Files:**
- `src/ui/tokens.ts` — design tokens (mostly complete, may enhance)
- `src/ui/theme.ts` — ANSI mapping (TUI)
- `src/ui/brand.ts` — brand assets (enhance with avatar states)
- `src/ui/primitives.ts` — UI primitives (enhance)
- `src/ui/layout.ts` — layout helpers (enhance)
- `src/daemon/dashboard/` — web design system CSS
- New: `src/ui/avatar.ts` — avatar rendering system

**Key Decisions:**
1. **XR palette:** Primary #00D4FF cyan, deep dark bg #0A0A0F, violet accent
2. **Avatar integration:** Official XR avatar used across all interactive surfaces
3. **Avatar states:** listening, thinking, speaking, idle, working, error
4. **Glassmorphism:** Used carefully for depth, not decoration
5. **Motion:** Meaningful only, performance-conscious
6. **Typography:** JetBrains Mono for code, Inter/Syne for UI

**Design Tokens to Define/Enhance:**
- Avatar state colors and animations
- Chat message styling (user/XR/tool/agent)
- Card styles for various content types
- Status indicators
- Progress visualization
- Error state styling

**Deliverables:**
- `XR_DESIGN_SYSTEM.md`
- Enhanced avatar system
- Web CSS design system
- Enhanced TUI primitives

---

## PHASE 3: ONBOARDING

**Objective:** Transform first-run from text wizard to branded, guided, visual experience. Get user to first success in < 60 seconds.

**Affected Files:**
- `src/interfaces/onboard.ts` — main onboarding (24KB, enhance)
- `src/interfaces/cli.ts` — CLI output helpers
- `src/ui/brand.ts` — brand rendering
- `src/local/hardware.ts` — hardware detection
- `src/local/recommend.ts` — model recommendation

**User Journey:**
```
LAUNCH XR
  ↓
VISUAL WELCOME with XR avatar
  ↓
XR detects your computer
  ↓
Show hardware profile (visual)
  ↓
Offer: Local (Ollama) or Cloud provider
  ↓
If local: Show recommended models as cards
  ↓
If cloud: Show provider options, enter API key
  ↓
Configure basics (workspace name, preferences)
  ↓
READY — open to chat
```

**Key Enhancements:**
1. Visual welcome with avatar
2. Hardware shown as profile card
3. Model recommendations as selectable cards with rationale
4. Clear local/cloud/hybrid visual indicators
5. Progress indication
6. Privacy explanation with visual elements

**Deliverables:**
- `XR_USER_JOURNEYS.md` (onboarding journey)
- Enhanced onboard.ts with visual elements
- Hardware profile visualization

---

## PHASE 4: MAIN CHAT EXPERIENCE

**Objective:** Make chat the polished heart of XR. Streaming, markdown, code blocks, tool execution visible, agent states clear.

**Affected Files:**
- `src/interfaces/shell/render.ts` — chat rendering (30KB, enhance)
- `src/interfaces/shell/app.ts` — chat state management (44KB, enhance)
- `src/interfaces/shell/types.ts` — chat message types
- `src/daemon/dashboard/` — web chat
- `src/ui/primitives.ts` — message rendering primitives

**Key Enhancements:**
1. **Avatar presence** in chat context (sidebar/header)
2. **Streaming visualization** — progressive reveal, not just text append
3. **Markdown rendering** — headers, lists, bold, italic, links
4. **Code blocks** — syntax highlighting, copy button
5. **Tool execution cards** — what XR is doing, step by step
6. **Agent state indicators** — thinking, planning, executing, waiting
7. **File attachments** — drag/drop, preview
8. **Model switch feedback** — visual confirmation
9. **Error states** — clear, actionable
10. **Loading states** — contextual, not blank

**Chat Message Types:**
- `user` — user messages
- `assistant` — XR responses (streaming + final)
- `tool` — tool execution display
- `agent` — multi-agent communication
- `system` — status, notices
- `error` — error display

**Deliverables:**
- Enhanced chat rendering
- Streaming visualization
- Tool execution display
- Avatar integration in chat context

---

## PHASE 5: NAVIGATION + CONTROL CENTER

**Objective:** Clean, understandable sidebar/control center. Group capabilities intelligently. Keyboard-first with discoverability.

**Affected Files:**
- `src/interfaces/shell/app.ts` — navigation state
- `src/interfaces/shell/render.ts` — sidebar rendering
- `src/ui/icons.ts` — navigation icons
- `src/daemon/dashboard/` — web sidebar

**Sidebar Structure:**

```
NAVIGATION
  ├ Chat (g c) — main conversation
  ├ Sessions (g s) — history
  ├ Research — reports

AGENTS
  ├ Agents — manage agents
  ├ Workflows — multi-agent workflows
  └ Automations — scheduled/automated

KNOWLEDGE
  ├ Memory — what XR remembers
  ├ Files — file access
  └ Skills — available skills

SETUP
  ├ Providers — cloud providers
  ├ Models — local models
  └ Settings — preferences

SYSTEM
  ├ Dashboard — overview
  ├ Security — security status
  └ Usage — spending/usage
```

**Key Enhancements:**
1. Grouped, labeled sections
2. Keyboard shortcuts shown
3. Command palette (Ctrl+K) with search
4. Active view highlighting
5. Provider/model pill at bottom
6. Avatar presence in sidebar header

**Deliverables:**
- Enhanced sidebar with groups
- Command palette
- Navigation keyboard shortcuts

---

## PHASE 6: PROVIDER + LOCAL MODEL UX

**Objective:** Make provider configuration extremely simple. Visual model selection. Clear local/cloud distinction.

**Affected Files:**
- `src/interfaces/providers.ts` — provider UI
- `src/providers/factory.ts` — provider system
- `src/interfaces/models.ts` — model UI
- `src/local/ollama.ts` — Ollama integration
- `src/local/recommend.ts` — model recommendation
- `src/local/hardware.ts` — hardware detection

**Key Enhancements:**
1. **Provider cards** — name, type (local/cloud), status, default model
2. **Model picker** — searchable, with capability indicators
3. **Local model recommendations** — cards with rationale, size, resource usage
4. **Hardware profile** — detected specs shown visually
5. **Download progress** — visualized for model pulls
6. **Provider health** — latency, availability indicators
7. **Cost indicators** — where available

**Deliverables:**
- Provider management UI (visual)
- Model selection UI
- Hardware profile display
- Local model recommendation cards

---

## PHASE 7: VOICE + XR AVATAR

**Objective:** Voice feels like native XR capability. Avatar prominent during voice. Avatar reacts to states.

**Affected Files:**
- `src/interfaces/voice.ts` (or voice module)
- `src/ui/avatar.ts` — NEW: avatar rendering system
- `src/daemon/dashboard/` — web voice UI
- `src/interfaces/shell/app.ts` — Shell voice integration
- `src/control/` — computer control (if voice-triggered)

**Avatar States:**
- `idle` — resting, subtle animation
- `listening` — attentive, audio-visual cue
- `thinking` — processing, contemplative
- `speaking` — active, mouth/expression movement
- `working` — executing task
- `error` — something went wrong
- `complete` — task done

**Key Enhancements:**
1. **Avatar rendering system** for terminal (ANSI) and web (canvas/SVG)
2. **Voice activation UI** — avatar prominent, listening indicator
3. **State-reactive avatar** — different visual for each state
4. **Floating voice mode** — small avatar window when detached
5. **Voice status** — listening/thinking/speaking clearly shown
6. **Offline voice indicator** — when local voice available

**Floating Voice Mode:**
```
+-----------------------+
|    [XR Avatar]        |
|    Listening...       |
|    [waveform/gesture] |
|    ───────────────    |
|    Quick actions:     |
|    □ Stop talking     |
|    □ Use result       |
+-----------------------+
```

**Deliverables:**
- `src/ui/avatar.ts` — avatar system
- Voice UI with avatar
- Floating mode implementation
- Avatar state system

---

## PHASE 8: SKILLS + MCP + AGENTS

**Objective:** Make these systems understandable. Human-language descriptions. Visual status. Permissions clear.

**Affected Files:**
- `src/skills/` — skill system
- `src/mcp/` — MCP client/manager
- `src/agents/` — agent definitions
- `src/services/multi-agent-service.ts` — multi-agent execution
- `src/daemon/skills-api.ts` — skills API

**Key Enhancements:**
1. **Skills as capabilities** — "Connect Google Drive" not "Install MCP server"
2. **Skill cards** — description, capability, permissions, source, status
3. **MCP connections** — list of connected servers, tools available, permissions
4. **Agent profiles** — identity, purpose, capabilities, status
5. **Agent execution visualization** — progress, steps, results
6. **Permission clarity** — what does this skill/agent have access to?

**Deliverables:**
- Skills browser UI
- MCP connection manager UI
- Agent profiles and status
- Permission visualization

---

## PHASE 9: MEMORY + RESEARCH + AUTOMATION

**Objective:** Make memory explorable. Research results visual. Automations manageable.

**Affected Files:**
- `src/context/memory/` — memory system
- `src/research/` — research engine
- `src/automation/` — automation system

**Key Enhancements:**
1. **Memory browser** — searchable, categorized, with explanations
2. **Memory management** — delete, categorize, export
3. **Research results** — citable reports with sources
4. **Automation list** — active automations, triggers, status
5. **Automation editor** — create/edit automations

**Deliverables:**
- Memory browser UI
- Research results view
- Automation management UI

---

## PHASE 10: COMPUTER CONTROL

**Objective:** Understandable computer control. Clear approval for dangerous actions.

**Affected Files:**
- `src/computer/` — computer control
- `src/control/` — control system
- `src/security/guard.ts` — policy gate

**Key Enhancements:**
1. **Computer control capabilities** — inspect, interact, execute, control, automate
2. **Action approval UI** — WHAT, WHY, SCOPE, RISK, ALLOW/DENY
3. **Security clarity** — dangerous actions never hidden
4. **Vision agent** — opt-in, clearly indicated

**Deliverables:**
- Computer control UI
- Approval flow enhancement
- Security information display

---

## PHASE 11: CODING WORKSPACE

**Objective:** Serious coding environment. VS Code-style workspace. Agent-controlled.

**Affected Files:**
- New: `src/coding/` or integration point
- `src/tools/` — file/edit tools
- `src/daemon/` — web workspace

**Key Enhancements:**
1. **File tree** — project files
2. **Editor** — code editing (use available runtime capabilities)
3. **Tabs** — multiple files
4. **Terminal** — integrated terminal
5. **Agent panel** — agent interaction
6. **Diffs** — change visualization
7. **Git awareness** — status, history

**Note:** Build on actual runtime capabilities, not fake editor.

**Deliverables:**
- Coding workspace UI
- File tree and editor integration
- Agent panel for coding tasks

---

## PHASE 12: DASHBOARD + SETTINGS + SECURITY

**Objective:** Dashboard answers key questions. Security visible but not overwhelming. Settings manageable.

**Affected Files:**
- `src/daemon/dashboard/` — dashboard
- `src/daemon/server.ts` — server routes
- `src/interfaces/shell/app.ts` — Shell home view
- `src/security/` — security systems
- `src/cost/` — cost/budget systems

**Dashboard Questions:**
- What is XR doing? → Activity status
- What has XR done? → Recent tasks
- What is running? → Active runs
- What is connected? → Providers, MCP, skills
- What is costing money? → Usage/spending
- What is using resources? → Model, memory
- What needs attention? → Alerts, errors

**Security Center:**
- System security status (secure/attention/alert)
- Active protections list
- Permissions overview
- Recent security events
- Audit chain status
- Isolation state
- Trust status

**Settings Categories:**
- General (workspace, theme, accessibility)
- Providers (cloud, local)
- Models (local runtimes)
- Memory (enable, categories, expiry)
- Voice (enable, preferences)
- Computer control (enable, permissions)
- Security (policy, approvals, egress)
- Spending (budget, limits)
- Privacy (data handling)

**Deliverables:**
- Dashboard UI
- Security center
- Settings UI

---

## PHASE 13: TUI ENHANCEMENT

**Objective:** Shell/TUI feels polished, modern, fast. Avatar presence. State visualization.

**Affected Files:**
- `src/interfaces/shell/app.ts` — main controller
- `src/interfaces/shell/render.ts` — rendering
- `src/interfaces/shell/layout.ts` — layout
- `src/ui/brand.ts` — brand rendering
- `src/ui/avatar.ts` — avatar (from Phase 7)
- `src/ui/primitives.ts` — primitives

**Key Enhancements:**
1. **Avatar in sidebar/header** — XR presence
2. **Enhanced status bar** — model, provider, mode, budget, status
3. **View transitions** — smooth, not abrupt
4. **Avatar states in TUI** — thinking, working indicators
5. **Keyboard shortcut help** — always accessible (?)
6. **Palette enhancement** — better search, categories

**TUI Views to Polish:**
- Chat (streaming, states)
- Sessions (list, select, resume)
- Workspaces (list, select, create)
- Research (list, view)
- Agents (list, status)
- Skills (browse, info)
- MCP (connections)
- Memory (browse)
- Settings (navigate, edit)
- Dashboard (overview)
- Security (status)
- Usage (stats)

**Deliverables:**
- Enhanced Shell/TUI
- Avatar integration in TUI
- View polish

---

## PHASE 14: CLI ENHANCEMENT

**Objective:** CLI remains powerful but outputs are clearer. Help is discoverable. Errors are useful.

**Affected Files:**
- `src/interfaces/cli.ts` — CLI helpers
- `src/commands/` — command implementations
- `src/cli/` — CLI router

**Key Enhancements:**
1. **Help system** — `xr help` comprehensive
2. **Command suggestions** — "did you mean...?"
3. **Error suggestions** — "try this..."
4. **Output consistency** — all commands use same styling
5. **Machine-readable output** — `--json` where appropriate
6. **Progress for long operations** — visual feedback

**Deliverables:**
- Enhanced CLI help
- Better error messages
- Consistent output styling

---

## PHASE 15: CROSS-SURFACE CONSISTENCY

**Objective:** XR feels like one product everywhere. Same identity, same patterns, same quality.

**Affected Files:**
- All surfaces:
  - CLI: `src/interfaces/cli.ts`, `src/commands/`
  - Shell: `src/interfaces/shell/`
  - Daemon: `src/daemon/`
  - Website: `website/`

**Consistency Checklist:**
- [ ] XR logo/avatar used consistently
- [ ] Brand colors consistent
- [ ] Typography consistent
- [ ] Terminology consistent
- [ ] Loading states consistent
- [ ] Error states consistent
- [ ] Success states consistent
- [ ] Navigation patterns consistent
- [ ] Keyboard shortcuts consistent where applicable

**Deliverables:**
- Cross-surface consistency audit
- Unified brand application
- Consistent patterns documentation

---

## PHASE 16: PERFORMANCE + ACCESSIBILITY

**Objective:** Performance meets budgets. Accessibility works for all users.

**Affected Files:**
- All UI code
- `src/ui/theme.ts` — motion control
- Performance budget tracking

**Performance Targets (from existing budgets):**
- `--version` / `--help` p95 < 150ms warm / < 300ms cold
- `doctor` < 1s
- Dashboard first render < 1s
- Retrieval 25-33ms @ 100k items

**Accessibility:**
- Keyboard navigation everywhere
- Readable contrast (WCAG AA minimum)
- Clear focus states
- Understandable labels
- Tooltips where needed
- Reduced motion support (existing `XR_REDUCED_MOTION`)
- Screen reader considerations
- Large text option

**Deliverables:**
- Performance verification
- Accessibility audit
- Accessibility enhancements

---

## PHASE 17: END-TO-END PRODUCT TESTING

**Objective:** Test the complete user experience. Find and fix issues.

**Testing Personas:**
1. 10-year-old using XR for first time
2. Non-technical adult
3. Developer
4. Power user
5. Security engineer
6. Product reviewer
7. Release engineer

**Test Scenarios:**
- First run onboarding
- Provider setup
- Local model setup
- First chat task
- Multi-step task with tools
- Agent execution
- Voice interaction (if supported)
- Settings changes
- Error recovery
- Offline behavior
- Security events

**Deliverables:**
- `XR_UX_VALIDATION_REPORT.md`
- Issue catalog
- Fix verification

---

## PHASE 18: RELEASE READINESS

**Objective:** Prepare XR for public launch. All quality bars met.

**Deliverables:**
- `XR_RELEASE_READINESS.md`
- Release checklist completion
- Documentation readiness
- Package readiness assessment

---

## DEPENDENCY ORDER

Some phases depend on others:

```
Phase 2 (Design System) → Phase 3, 4, 5, 7
Phase 7 (Avatar System) → Phase 4, 7, 13
Phase 1 (IA) → Phase 5
Phase 5 (Navigation) → Phase 12 (Dashboard)
Phase 4 (Chat) → Phase 15 (Consistency)
```

**Recommended execution order:**
1. Phase 1 + Phase 2 (foundations)
2. Phase 7 (avatar system — needed by many)
3. Phase 3 (onboarding — first impression)
4. Phase 4 (main chat — heart of product)
5. Phase 5 (navigation)
6. Phase 6 (providers/models)
7. Phase 12 (dashboard/security/settings)
8. Phase 8 (skills/MCP/agents)
9. Phase 9 (memory/research/automation)
10. Phase 10 (computer control)
11. Phase 11 (coding workspace)
12. Phase 13 (TUI enhancement)
13. Phase 14 (CLI enhancement)
14. Phase 7 completion (voice + floating mode)
15. Phase 15 (cross-surface consistency)
16. Phase 16 (performance/accessibility)
17. Phase 17 (testing)
18. Phase 18 (release)

---

## RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Avatar rendering in terminal is limited | Medium | Medium | Use ANSI art + state indicators; web gets full avatar |
| Web dashboard needs significant work | Medium | Medium | Prioritize chat + dashboard, iterate |
| Coding workspace is complex | Medium | High | Start with file tree + agent panel, add editor later |
| Performance regressions from visual enhancements | Low | High | Performance budgets, measure each phase |
| Scope creep | High | High | Strict phase discipline, freeze scope per phase |

---

*End of Implementation Plan*
