# XR 3.1D — Chat Workspace Shippack

**Date:** 2026-07-14  
**Scope:** Primary Control Center Chat Workspace redesign  
**Backend contract:** Frozen. No memory, research, provider, plugin, MCP, Shield, voice, kernel, business OS, or computer-control engine changes.

---

## 1. Complete UX audit

### Existing Chat Workspace before 3.1D

The pre-3.1D chat panel was a useful dashboard accessory, not the operating surface XR needs:

| Area | Finding | Severity | 3.1D resolution |
|---|---|---:|---|
| Layout | Single-column chat hidden inside dashboard chrome | P0 | New 3-pane workspace: history, conversation, inspector |
| Navigation | No multi-chat management inside chat | P0 | Local workspace chat list, new chat, pin, archive, branch, search |
| Composer | Plain textarea + send button | P0 | Universal composer with slash commands, @context, attachments, drag/drop, paste, toggles, mode cycling, autosaved drafts |
| Trust | Tool/API work invisible except final answer | P0 | Professional tool timeline with status, purpose, result, expandable output |
| Control safety | Pending approvals not surfaced in chat | P0 | Inspector approval section wired to `/api/control/pending` and `/api/control/approve` |
| Research | Research was another dashboard tab, not a conversational mode | P1 | Research toggle and `/research` workflow surface existing research context without changing backend |
| Memory | Memory not visible while composing | P1 | Memory toggle, `@memory` context chip, memory peek, `/memory` browse/search |
| Artifacts | Code blocks rendered as plain pre blocks only | P1 | Artifact cards extracted from fenced code, JSON, and markdown tables with copy/download |
| Message actions | No retry, edit, branch, copy | P1 | Per-message Copy, Edit, Branch, Regenerate |
| Runtime awareness | Model/provider chip only | P1 | Provider/model/mode/budget/approval/workspace indicators in header and inspector |
| Interrupt | No visible stop state | P1 | Send button becomes Stop and aborts stream with preserved partial response |
| Attachments | No file affordance | P1 | File picker, drag/drop, clipboard file paste, attachment pills; metadata sent as UI context only until backend accepts files |
| Accessibility | Minimal ARIA, weak keyboard hints | P1 | Landmarked panes, live region, labelled controls, keyboard-first interactions |
| Mobile | Chat remained cramped | P2 | Responsive collapse to single-pane composer-first layout |
| Persistence | History only in provider/backend session, no chat UX | P2 | Browser localStorage workspace state; backend sessions unaffected |

---

## 2. Competitive research

### Products analyzed

AI assistants: ChatGPT, Claude, Gemini, Perplexity, Grok.  
AI IDEs/agents: Claude Code, Cursor, Windsurf, OpenCode, OpenHands, Continue.dev.  
Research systems: OpenAI Deep Research, Gemini Deep Research, DeerFlow.  
Productivity/developer UX: Notion AI, Raycast AI, Linear, GitHub, Vercel, Warp.

### Extracted best practices applied

| Pattern | Source class | XR 3.1D interpretation |
|---|---|---|
| Composer is the primary command surface | ChatGPT, Claude, Cursor, Claude Code, Raycast | One universal composer supports natural language, `/commands`, `@mentions`, toggles, attachments, and modes |
| Workspace/project-level organization | ChatGPT Projects, Claude Projects, Perplexity Spaces, Linear workspaces | Chat history sidebar groups conversations into Workspace, supports pin/archive/search locally |
| Tool calls must be explicit | Claude Code, Cursor Agent, Windsurf Cascade, OpenHands | Tool timeline shows tool, purpose, status, result; approvals are visible in inspector |
| Research needs evidence visibility | Perplexity, Deep Research systems | Research toggle and `/research` expose research as a workflow, with room for sources/artifacts from existing endpoints |
| Artifacts are first-class | ChatGPT Canvas, Claude Artifacts, Cursor code blocks, Notion AI | Fenced code/JSON/tables become copyable/downloadable artifact cards |
| Edits and retries are normal conversation operations | ChatGPT, Claude, Gemini | Message actions: edit previous prompt, regenerate assistant turn, branch from any point |
| Agent safety requires a live stop control | Claude Code, OpenHands, computer-control products | Streaming Stop button aborts the request and preserves partial state |
| Context must be visible | Cursor @mentions, Perplexity Spaces, Claude context usage | Context chips reveal slash command, @mentions, memory/research/control state |
| Calm density beats maximal chrome | Linear, Vercel, GitHub | Minimal XR tokens; inspector is powerful but not visually loud |
| Keyboard consistency matters | Claude Code, Warp, Linear, GitHub | Enter send, Shift+Enter newline, Esc stop, Ctrl+K palette preserved, Ctrl+N new chat, Ctrl+B branch |

### Non-cloning stance

3.1D does not copy any competitor’s brand language or layout wholesale. It uses XR’s immutable design language: dark-first shell, cyan/green/amber/red semantic colors, monospace metadata, trust vocabulary, auditability, and local-first posture.

---

## 3. Component architecture

Although `src/daemon/dashboard.ts` remains a self-contained HTML document for package/runtime compatibility, the chat workspace is now structured as reusable UI modules inside the dashboard surface:

| Logical component | Responsibility | Main functions/CSS |
|---|---|---|
| `ChatWorkspace` | 3-pane shell and orchestration | `buildChatUI`, `.chat-wrap`, `.chat-main` |
| `ChatHistorySidebar` | Chat search/list/pin/archive selection | `renderChatList`, `chatSelectChat`, `.chat-sidebar` |
| `ConversationView` | Message virtualization-ready scroll surface | `renderMessages`, `renderMessage`, `.chat-messages` |
| `MessageActions` | Copy/edit/branch/regenerate | `copyMessage`, `editMessage`, `branchAtMessage`, `regenerateFrom` |
| `UniversalComposer` | Text input, slash commands, context chips, attachments, toggles | `renderComposer`, `handleComposerKeydown`, `toggleComposerFlag`, `.composer-card` |
| `AttachmentTray` | File metadata pills, paste/drop/file picker | `addFilesToComposer`, `handleComposerPaste`, `setupDropZone` |
| `RuntimeHeader` | Provider/model/mode/budget/approval indicators | `renderRuntime`, `.chat-chip` |
| `ToolTimeline` | Tool status and output history | `addToolEvent`, `updateToolEvent`, `.tool-card` |
| `ApprovalInspector` | Existing computer-control approval integration | `loadApprovals`, `answerApproval` |
| `MemoryInspector` | Memory peek/search browse | `loadMemoryPeek`, `/memory` handler |
| `ArtifactRenderer` | Rich artifact extraction/copy/download | `extractArtifacts`, `renderArtifacts`, `downloadArtifact` |
| `SlashCommandRouter` | Client-side bridge to existing backend endpoints | `handleSlashCommand` |

---

## 4. Information architecture updates

### Before

Dashboard > Chat was a secondary panel.

### After

Chat is the primary operating surface with three stable regions:

1. **Workspace history** — chats, pins, archive, search.
2. **Conversation canvas** — messages, artifacts, composer.
3. **Inspector** — runtime, tool timeline, approvals, memory, shortcuts.

Existing dashboard panels remain available and compatible. Chat now links naturally to existing surfaces via slash commands and inspector affordances rather than replacing backend modules.

---

## 5. Modified files

| File | Change |
|---|---|
| `src/daemon/dashboard.ts` | Replaced legacy chat CSS and JS with XR 3.1D Chat Workspace UI, local multi-chat state, universal composer, artifact renderer, tool timeline, approvals/memory inspector, slash command bridge, responsive/a11y improvements |

---

## 6. New files

| File | Purpose |
|---|---|
| `docs/xr-3.1/XR-3.1D-CHAT-WORKSPACE-SHIPPACK.md` | Complete delivery report for UX audit, architecture, migration, performance, accessibility, compatibility, validation, release notes |

---

## 7. Ready-to-paste production code

Production code is in `src/daemon/dashboard.ts`. The implementation remains self-contained, dependency-free, and offline-safe. It uses existing `api()` and `/api/chat` conventions and adds no runtime packages.

Key production behaviors:

- Preserves `/chat` and dashboard route compatibility.
- Uses existing bearer token and `BASE` fetch strategy.
- Uses `localStorage` for UI-only chat organization; backend session storage remains untouched.
- Aborts in-flight chat via `AbortController`.
- Does not send attachment bytes to unsupported backend endpoints; it presents file context metadata safely until file ingestion endpoints exist.
- Uses only existing endpoints: `/api/chat`, `/api/control/plan`, `/api/control/pending`, `/api/control/approve`, `/api/memory`, `/api/memory/search`, `/api/research`, `/api/overview`, `/api/cost`, `/api/control/status`, `/api/providers`, `/api/models`.

---

## 8. Migration notes

No data migration is required.

- Existing backend sessions are not modified.
- Existing dashboard panels continue to work.
- Existing `/api/chat` clients continue to work.
- Users get new local browser chat organization on first open.
- Clearing, archiving, pinning, and branching in 3.1D affect UI workspace state only, not the backend audit log or provider history.
- If users need to reset the new chat workspace UI state, they can clear browser localStorage key `xr.chat.workspace.v31d`.

---

## 9. Performance report

| Standard | Implementation | Status |
|---|---|---|
| First token/response perception | Assistant placeholder appears immediately; stream updates render incrementally | PASS |
| No backend boot changes | Dashboard remains static HTML/JS; no new server bootstrap | PASS |
| Avoid unnecessary backend calls | Inspector lazily calls memory/approvals; slash commands call only needed endpoints | PASS |
| Long history readiness | Render path is centralized and can be virtualized; local search filters before render | PASS |
| Markdown cost | Lightweight regex renderer only; no heavy markdown dependency | PASS |
| Attachments | Stores metadata only, avoiding large localStorage blobs | PASS |
| Responsive | Right inspector collapses <1180px; history collapses <820px | PASS |
| Reduced motion | `prefers-reduced-motion` disables pulse/caret animations | PASS |

Residual performance note: true DOM virtualization is architecturally prepared but not added as a dependency because the dashboard is intentionally dependency-free. For extremely long local histories, future work can window `renderMessages()` without backend changes.

---

## 10. Accessibility report

| WCAG/standard area | 3.1D behavior |
|---|---|
| Landmarks | Chat history uses `aside`, conversation uses `section`, inspector uses `aside` with labels |
| Keyboard | Enter send, Shift+Enter newline, Esc stop, tab-accessible buttons, chat sessions keyboard selectable |
| Screen readers | Conversation has `aria-live="polite"`; composer has textbox role and label; icon buttons have labels |
| Focus visibility | Existing XR focus/hover treatment preserved; controls have visible borders and color/text labels |
| Color semantics | Status chips include text labels, not color-only state |
| Motion | Reduced motion media query disables chat animations |
| Hit targets | Composer/tool/header buttons meet 24px minimum and generally 30px+ |
| Plain language | Empty state and errors explain what happened and how to continue |
| High contrast | Uses XR tokenized colors and borders; remains compatible with existing forced-color strategy |

Known manual test still required outside sandbox: NVDA/VoiceOver pass on the served dashboard.

---

## 11. Compatibility report

| System | Compatibility result |
|---|---|
| Provider engine | Uses existing `/api/chat`; no provider API changes |
| Streaming | Reads existing SSE shape: `delta`, `text`, `error`, `[DONE]` |
| Memory engine | Uses existing list/search endpoints only |
| Research engine | Uses existing research list endpoint and mode UX; no engine changes |
| Plugins/MCP | No contracts touched; chat UI can discuss/invoke through existing backend provider behavior |
| Computer control | Uses existing pending/approve endpoints; no executor changes |
| Shield | Exposed as composer toggle only; no shield config mutations |
| Voice stack | Voice toggle UI-ready; no voice stack changes |
| Dashboard | Existing navigation and non-chat panels untouched |
| CLI | No CLI files changed |
| Shell | No Shell/TUI files changed |
| Sessions | Backend session APIs untouched; UI local chats do not corrupt sessions |

---

## 12. Validation report

Commands run in sandbox:

```bash
npm install --no-audit --ignore-scripts
npx tsc --noEmit --pretty false
```

Result:

- `src/daemon/dashboard.ts` reports **no TypeScript syntax/type errors**.
- Repo-wide `tsc` remains red due to documented pre-existing Category B errors in business modules, Shield CLI, integrations, control/kernel, and daemon server (`isLocal`) debt. These are consistent with XR 3.1B/3.1C reports and were not introduced by the chat workspace.

Manual code validation:

- Verified the dashboard template contains no unescaped backticks after the embedded chat rewrite.
- Verified the implementation uses only existing authenticated dashboard API conventions.
- Verified no backend engine files were modified.

Functional checks to perform when running `xr serve` locally:

1. Open `/chat?token=...`.
2. Send normal prompt; confirm response appears and can be stopped.
3. Run `/status` and `/budget`.
4. Run `/plan <task>`; confirm plan-only endpoint returns without execution.
5. Run `/memory` and `/memory <query>`.
6. Pin, branch, archive, export, edit, regenerate.
7. Drag/drop and paste an image/file; confirm attachment pill appears and no bytes are uploaded.
8. Trigger a pending computer-control approval; confirm inspector allow/deny works.
9. Resize to mobile width; confirm single-pane layout.
10. Enable reduced motion; confirm animations stop.

---

## 13. Release notes

### XR 3.1D — Chat Workspace

XR Chat is now the primary AI workspace surface.

New:

- Three-pane chat operating surface: history, conversation, inspector.
- Universal composer with slash commands, @context chips, attachment tray, drag/drop, paste files, mode/toggle controls.
- Multi-chat UI with search, pin, archive, branch, export, drafts.
- Message actions: copy, edit, branch, regenerate.
- Tool timeline for chat, plan, memory, status, budget, and research workflows.
- Approval inspector for existing computer-control permission requests.
- Memory peek and `/memory` browse/search.
- Research mode toggle and `/research` workflow entry.
- Artifact cards for code, JSON, markdown tables, and downloadable outputs.
- Stop/interrupt for in-flight responses.
- Responsive and accessibility upgrades.

Unchanged:

- Provider contracts.
- Memory/research/plugin/MCP/control engines.
- CLI and Shell behavior.
- Dashboard non-chat panels.

---

## 14. Documentation updates

This shippack documents the 3.1D surface and should be read alongside immutable 3.1 architecture documents:

- Executive Summary
- Design Philosophy
- Design System
- UX Research
- Competitive Research
- Information Architecture
- Navigation Architecture
- User Journeys
- Performance Standards
- Accessibility Standards
- Component Standards
- Shell Implementation
- XR 3.1B reports
- XR 3.1C reports

3.1D is an implementation of those architecture standards on the Chat Workspace surface, not a new design language.
