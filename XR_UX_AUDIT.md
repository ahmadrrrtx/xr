# XR UX Audit — Phase 0 Findings

**Audit Date:** 2026-08-12
**Auditor:** Chief Product Experience Architect
**Repository:** github.com/ahmadrrrtx/xr (v7.1.0 Truth)
**Scope:** Full UX/product audit of existing XR Agent Runtime

---

## 1. EXECUTIVE SUMMARY

XR is a technically sophisticated local-first AI agent runtime with strong architectural foundations. The backend systems are well-engineered: execution fabric, policy enforcement, budget governor, audit chain, provider abstraction, skills/plugins/MCP extensibility.

**However, the user experience does not yet match the backend capability.**

The product feels like a powerful engine wrapped in a minimal interface. It lacks:
- Visual brand presence during interaction
- Avatar-driven personality
- Polished loading/transition states
- Clear agent state communication
- Beginner-friendly discovery
- Desktop application experience
- Cohesive visual identity across surfaces

**The opportunity:** Transform XR from "powerful terminal tool" into "polished consumer-ready AI agent product" while preserving all backend capabilities.

---

## 2. WHAT XR HAS RIGHT (STRENGTHS)

| Area | Status | Notes |
|------|--------|-------|
| Backend architecture | ✅ Excellent | Execution envelope, runner, state machine, cancellation |
| Provider system | ✅ Excellent | 26 presets, native adapters, OpenAI-compatible transport |
| Security model | ✅ Excellent | Policy gate, approvals, budget governor, egress allowlist, secrets vault |
| Audit chain | ✅ Excellent | SHA-256 linked, verifiable offline |
| Skills system | ✅ Excellent | 65 bundled, manifest-governed |
| Plugin system | ✅ Excellent | Permissions, hash verification, lifecycle |
| MCP support | ✅ Excellent | Client + manager + registry, allowlist |
| Multi-agent | ✅ Excellent | Planner → reviewer → synthesizer with security gate |
| Memory | ✅ Excellent | Consent-first, categorized, explainable retrieval |
| Research | ✅ Excellent | Offline default, opt-in web, source provenance |
| CLI output | ✅ Good | Rich output helpers, clear exit codes |
| Design tokens | ✅ Good | Comprehensive token system exists |
| Brand assets | ✅ Good | Official logo + avatar provided |

---

## 3. UX PROBLEMS BY AREA

### 3.1 FIRST RUN / ONBOARDING

**Current Behaviour:**
- Text-based wizard in terminal
- Privacy explanation is plain text paragraphs
- No visual brand presence
- No avatar visibility
- Hardware detection happens but isn't visualized
- Local model recommendation is text-only

**Problems:**
1. **No emotional connection** — User sees text, not XR personality
2. **No visual guidance** — All steps are text descriptions
3. **Brand invisible** — Official logo/avatar not used in onboarding
4. **Hardware visualization missing** — "Your computer" is abstract
5. **Local/offline unclear** — User doesn't visually understand offline capability

**Severity:** HIGH — First impression sets trajectory for entire experience

**Proposed Solution:**
- Visual welcome with XR avatar presence
- Animated brand moment at launch
- Hardware visualized as cards/insights
- Local model recommendations as selectable cards
- Clear local/cloud/hybrid visual indicators

---

### 3.2 SHELL / TUI

**Current Behaviour:**
- Fullscreen terminal application
- Sidebar navigation with icon rail support
- Chat view with message history
- Sessions, workspaces, research views
- Composer at bottom
- Status bar with provider/model info
- Keyboard-driven with palette (Ctrl+K)
- ANSI brand rendering in sidebar

**Problems:**
1. **Chat is text-only** — No visual distinction for agent thinking/working states
2. **No avatar presence** — XR has no visual identity during conversation
3. **Tool execution invisible** — User doesn't see what XR is doing step-by-step
4. **Loading states minimal** — Spinners only, no contextual feedback
5. **Sidebar functional but plain** — No visual hierarchy enhancement
6. **No streaming visualization** — Response streaming is text append
7. **Agent states unclear** — Planning, executing, waiting for approval all look similar
8. **No visual model switching feedback** — Alt+P works but no visual confirmation

**Severity:** HIGH — Main interaction surface needs polish

**Proposed Solution:**
- Avatar presence in sidebar/header during interaction
- Visual state indicators for agent modes (thinking, working, waiting)
- Tool execution visible as structured cards
- Streaming visualized with progressive reveal
- Enhanced sidebar with avatar and status
- Model switch visual confirmation

---

### 3.3 DASHBOARD / DAEMON (xr serve)

**Current Behaviour:**
- Web dashboard at localhost:3141
- Token-authenticated
- Chat interface exists
- API routes for skills, plugins

**Problems:**
1. **Web dashboard likely minimal** — Needs visual design system application
2. **Chat interface needs polish** — Markdown, code blocks, streaming
3. **No avatar integration** — Web surface should show XR identity
4. **Design system not fully applied** — Tokens exist but may not be used

**Severity:** MEDIUM — Web surface is secondary but important

**Proposed Solution:**
- Apply XR design system fully
- Avatar presence in chat
- Polished markdown/code rendering
- Streaming visualization
- Sidebar navigation matching Shell mental model

---

### 3.4 VOICE EXPERIENCE

**Current Behaviour:**
- Voice commands exist (`xr voice ...`)
- Optional, local-first adapters
- Voice triggers capabilities through governed pipeline

**Problems:**
1. **No avatar presentation during voice** — Voice is invisible
2. **No listening/thinking/speaking states visualized**
3. **Avatar not used** — Official avatar should be central to voice UX
4. **Floating mode not implemented** — No detached voice assistant

**Severity:** HIGH — Voice is a key differentiator that's invisible

**Proposed Solution:**
- XR avatar prominently displayed during voice interaction
- Avatar reacts to listening/thinking/speaking states
- Floating voice mode when minimized
- Visual feedback for voice states

---

### 3.5 PROVIDER EXPERIENCE

**Current Behaviour:**
- `xr providers list` shows providers
- `xr providers set <id> <model>` switches
- `xr providers add <id>` enters API key
- Preflight → canary → swap → verify state machine
- Automatic rollback on failure

**Problems:**
1. **CLI-only interaction** — No visual provider management
2. **No provider status visualization** — Health, latency, availability not shown
3. **Model selection abstract** — No visual model picker
4. **Local vs cloud unclear visually** — Status dot exists but minimal

**Severity:** MEDIUM — Functionally excellent, UX could be richer

**Proposed Solution:**
- Visual provider cards with status
- Model picker with capability indicators
- Local/cloud visual distinction
- Latency/cost information where available

---

### 3.6 LOCAL MODEL EXPERIENCE

**Current Behaviour:**
- `xr models set <runtime> <model>` configures
- Ollama integration with model pull
- Hardware detection exists
- Local model recommendation exists

**Problems:**
1. **No hardware visualization** — "Your computer" is text
2. **Model recommendations text-only** — Not visual cards
3. **Download progress unclear** — No visual progress
4. **Resource usage not visualized** — VRAM, RAM expectations unclear

**Severity:** MEDIUM — Important for local-first value proposition

**Proposed Solution:**
- Hardware detected and shown as visual profile
- Model recommendations as cards with rationale
- Download progress visualized
- Resource estimates shown

---

### 3.7 SKILLS / MCP / AGENTS

**Current Behaviour:**
- Skills: `xr skill browse/install/...`
- MCP: `xr mcp ...` full command surface
- Agents: `xr agents list`, `xr agents plan`

**Problems:**
1. **CLI-only interaction** — No visual management
2. **Technical terminology** — "MCP server configuration object" vs "Connect Google Drive"
3. **Permissions not visualized** — What does this skill allow?
4. **Agent status unclear** — Progress not visualized

**Severity:** MEDIUM — Advanced features need approachable UX

**Proposed Solution:**
- Human-language descriptions
- Permission visualization
- Status dashboards
- Visual agent progress

---

### 3.8 MEMORY

**Current Behaviour:**
- Consent-first capture
- Categorized + scoped entries
- TTL/expiry with `xr memory prune`
- Explainable retrieval with match %

**Problems:**
1. **No visual memory browser** — CLI only
2. **Memory contents not explorable visually**
3. **No memory health dashboard**

**Severity:** LOW — Functionally good, visual exploration would help

**Proposed Solution:**
- Visual memory browser
- Search interface
- Category management
- Memory health status

---

### 3.9 SECURITY UX

**Current Behaviour:**
- Policy gate in execution path
- Approvals with full context
- Budget governor with prompts
- Audit chain verification

**Problems:**
1. **Security is invisible during normal operation** — Good, but...
2. **Security status not dashboarded** — User doesn't see "system secure"
3. **Recent security events not visible**
4. **Permissions not overviewable**

**Severity:** MEDIUM — Security should be visible but not overwhelming

**Proposed Solution:**
- Security center dashboard
- Active protections status
- Recent events log
- Permission overview
- Simple explanation for beginners, technical detail for experts

---

### 3.10 USAGE / SPENDING CONTROLS

**Current Behaviour:**
- Per-task budget in USD + tokens
- Budget governor checks before/during steps
- Over-budget prompt with raise option

**Problems:**
1. **Budget not visualized in UI** — Only shown when exceeded
2. **No spending dashboard** — User doesn't see usage over time
3. **No provider/model cost comparison**

**Severity:** MEDIUM — Important for trust and control

**Proposed Solution:**
- Usage dashboard with spent/remaining/limit
- Provider cost indicators
- Budget setting UI
- Historical spending view

---

### 3.11 DASHBOARD

**Current Behaviour:**
- `xr serve` dashboard exists
- Home view in Shell shows recent sessions + workspaces

**Problems:**
1. **Dashboard doesn't answer key questions:**
   - What is XR doing?
   - What has XR done?
   - What is running?
   - What is connected?
   - What is costing money?
   - What needs attention?

**Severity:** MEDIUM — Dashboard should be informative

**Proposed Solution:**
- Purpose-driven dashboard
- Activity status
- Recent tasks
- Connected providers
- Usage overview
- Security status
- Attention needed items

---

### 3.12 ERROR HANDLING / RECOVERY

**Current Behaviour:**
- Honest outcomes (success/failed/cancelled)
- Cooperative cancellation
- Approval prompts with full context
- Budget overrun prompts

**Problems:**
1. **Errors are text-only** — No visual error states
2. **Recovery paths not guided** — User must know commands
3. **No error recovery suggestions** — "Try this" not shown

**Severity:** MEDIUM — Errors should be helpful

**Proposed Solution:**
- Visual error states
- Recovery suggestions
- Clear next actions
- Error history viewable

---

### 3.13 CROSS-SURFACE CONSISTENCY

**Current Behaviour:**
- CLI, Shell, Daemon are separate surfaces
- Design tokens shared
- Brand assets shared

**Problems:**
1. **Shell has brand, CLI has banner, Daemon unknown** — Consistency varies
2. **Avatar not used anywhere in interaction** — Major gap
3. **No floating/always-available mode** — XR disappears when not in foreground

**Severity:** HIGH — XR should feel like one product across surfaces

**Proposed Solution:**
- Consistent brand presence everywhere
- Avatar used across all interactive surfaces
- Floating mode for voice/quick access

---

### 3.14 OFFLINE EXPERIENCE

**Current Behaviour:**
- Local-first architecture
- Ollama for local models
- Research offline by default
- Voice has local adapters

**Problems:**
1. **Offline status not clearly communicated visually**
2. **Offline capabilities not highlighted**
3. **Graceful degradation not visualized**

**Severity:** MEDIUM — Offline is a key value prop

**Proposed Solution:**
- Clear local/cloud/hybrid indicators
- Offline capability highlighted
- Graceful state communication

---

## 4. CRITICAL GAPS SUMMARY

| Gap | Severity | Impact |
|-----|----------|--------|
| No avatar presence in interaction | HIGH | XR has no personality during use |
| Chat is text-only, no state visualization | HIGH | User doesn't understand what XR is doing |
| No visual brand during onboarding | HIGH | First impression is clinical |
| No desktop/app experience | HIGH | CLI/Shell only, no polished app |
| Voice has no visual presentation | HIGH | Voice capability is invisible |
| Security status not dashboarded | MEDIUM | User can't see security state |
| Spending not visualized | MEDIUM | User can't see budget status |
| Error recovery not guided | MEDIUM | Users struggle when things fail |
| No floating/quick-access mode | MEDIUM | XR not always available |

---

## 5. BRAND ASSETS AVAILABLE

The following official assets are provided and MUST be used:

- **XR Logo** (multiple variants)
- **XR Avatar** (front-facing, side face, full body hero shots)
- **Brand color palette** (derived from logo)

**Brand colors from repository tokens.ts:**
- Primary: #00D4FF (cyan)
- Background: #0A0A0F (near-black)
- Surface: #111827
- Violet accent: #A855F7
- Success: #00FF88
- Warning: #F59E0B
- Error: #FF4D4D

**Brand ASCII wordmark:**
```
▀▄▀ █▀█
█░█ █▀▄
```

---

## 6. RECOMMENDED PRIORITY ORDER

1. **Avatar presence system** — Across all surfaces
2. **Main chat polish** — State visualization, streaming, tool execution
3. **Onboarding redesign** — Visual, branded, guided
4. **Desktop application** — Polished chat + sidebar + dashboard
5. **Voice + avatar integration** — Avatar reacts to voice states
6. **Dashboard + security + spending** — Unified status view
7. **Provider/model UX** — Visual pickers, status
8. **Skills/MCP/agents UX** — Human-language, visual status
9. **TUI enhancement** — Avatar, states, polish
10. **Floating voice mode** — Always-available assistant

---

## 7. WHAT NOT TO CHANGE

The following backend systems are **frozen** and must be preserved:
- Execution fabric and state machine
- Policy gate and approvals
- Budget governor
- Provider system and presets
- Agent loop and turn repair
- Memory system
- Research engine
- Multi-agent workflows
- Skills, plugins, MCP
- Audit chain
- Security mechanisms
- CLI exit codes and semantics
- All existing commands and their meanings

---

*End of Phase 0 Audit*
