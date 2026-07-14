# XR 3.1A — Implementation Roadmap
> Six milestones from the current prototype to the coherent XR 3.1 product.

This roadmap is sequenced for momentum: each milestone produces a shippable increment, builds on prior work, and ends with clear exit criteria. The backend is frozen; all work is product-experience only.

**Scope guard:** None of these milestones touch the frozen backend systems (Memory, Research, Providers, Local AI, Plugins, MCP, Business OS, XR Shield, Skills Runtime, Multi-Agent, Computer Control, Voice, Security). Implementation agents consume those systems only through their existing APIs.

**Estimated effort:** ~8–12 weeks of a focused product-eng team (1 UX lead, 2 frontend/terminal engineers, 1 QA).

---

## Guiding principles for implementation

1. **Ship one coherent surface at a time.** Don't try to fix everything at once. TUI is the flagship surface; it ships at quality first.
2. **Tokens before components before screens.** Milestone 0 establishes the design system so that later milestones don't produce divergent UI.
3. **Streaming is P0.** Nothing feels "alive" until tokens stream. This is done early.
4. **Test on real hardware early.** Run performance and accessibility checks at every milestone, not at the end.
5. **Protect the backend.** Any change that requires touching `src/core/agent.ts`, `src/providers/*`, `src/cost/*`, `src/memory/*`, `src/security/*`, etc. is out of scope except to add missing streaming hooks or event emissions.
6. **Delete dead code.** The 3,000-line inline dashboard HTML, the old TUI paths, and fragmented help panels should be deleted as they are replaced, not maintained in parallel.

---

## Milestone 0 — Foundation & Tokens
**Goal:** Establish the substrate everything else builds on. No user-facing changes.
**Estimate:** 1 week.

### Deliverables
1. **Design token source of truth** — `design-tokens.json` (or `src/ui/tokens.ts` as canonical) with every color, spacing, radius, shadow, font, motion token from the Design System doc.
2. **Token compilation:**
   - Terminal/ANSI: updated `src/ui/theme.ts` that imports from the token source.
   - Web CSS variables: a generated `:root { --xr-* }` block used by dashboard.
   - Website Tailwind config: extended theme pulling from same hex values (bg colors must match `#0A0A0F` not `#020817`).
3. **Icon set:** Standardize on a single icon library (Lucide recommended) for web; build a Unicode glyph map for TUI (as defined in Design System §8.2). Remove all emoji from chrome (in code, not in user content).
4. **i18n scaffolding:** extract every user-facing English string into a `src/i18n/strings.ts` dictionary (already started in `src/i18n/strings.ts` — complete it).
5. **Repository hygiene:** move the existing inline `dashboard.ts` HTML into separate files or a tagged-template component system (functions returning strings, e.g., `Card({title, body})`) so that later milestones can build UI compositionally without 3,000-line strings.
6. **Performance budget tooling:** add `xr doctor --perf` stub; set up CI timings for `xr --version` and `xr help`.
7. **Accessibility baseline:** add axe-core to a headless dashboard render in CI; document current baseline violations (to be fixed in later milestones).

### Exit criteria
- [ ] Every token defined in Design System doc exists in code
- [ ] TUI, Dashboard, and Website all read colors from one source of truth
- [ ] No emoji remains in chrome (navigation, buttons, badges, toasts)
- [ ] Dashboard HTML is refactored into composable primitives (no 3,000-line string)
- [ ] CI runs and reports current perf/axe baseline
- [ ] No backend files modified except to add event hooks if needed

---

## Milestone 1 — Streaming Everywhere (P0 perceived performance)
**Goal:** XR responds live. The single biggest perceived-speed fix.
**Estimate:** 1.5 weeks.

### Deliverables
1. **Streaming provider interface** — ensure every provider (Ollama, Anthropic, OpenAI, Gemini, Groq, etc.) exposes a true async token stream, not just a one-shot `chat()` returning the full response. Add a `streamChat()` method that yields `{type: 'token'|'tool_start'|'tool_delta'|'tool_end'|'done', …}` events.
2. **Streaming CLI one-shot** — `xr "task"` streams tokens as they arrive (one token/line-buffered chunk to stdout), with a clean header and footer. Replace the current `say()` aggregation.
3. **Streaming SSE endpoint** — `/api/chat` in `src/daemon/server.ts` emits proper SSE events (`data: {"delta":"…"}` per token, `data: {"tool":…}`, `event: done`), not one final `text` blob.
4. **Streaming TUI composer** — the TUI chat view appends tokens as they arrive, character by character, with a blinking block caret (▊) at the streaming position. The current `updateOrAppendAssistantMessage` aggregates lines; change it to stream tokens.
5. **Streaming dashboard chat** — the web chat reads SSE tokens and appends them to the live message bubble in real time (using `requestAnimationFrame` batching, not per-token DOM writes). Caret at end of streaming message.
6. **Tool-call events** across all surfaces: every tool start/end is emitted as an event and shown in the timeline as it happens (not after completion).
7. **Interrupt handling** — Ctrl+C / Stop button cleanly aborts the in-flight provider stream within 200ms; partial response preserved with "(interrupted)" meta tag.

### Exit criteria
- [ ] First token appears <200ms (local warm) / <800ms (cloud) after Enter
- [ ] Tokens render at ≥30/sec visibly on all three surfaces
- [ ] Ctrl+C / Stop interrupts within 200ms
- [ ] Tool calls appear in timeline within 50ms of being initiated
- [ ] Streaming works for at least the 4 major providers (Ollama, Anthropic, OpenAI, Gemini); other providers use a compat shim that streams the full response in one chunk (acceptable but flagged for later work)
- [ ] No new ANSI color regressions; old non-streaming path removed

---

## Milestone 2 — Keyboard, Palette, and Composer (P0 usability)
**Goal:** Keyboard muscle memory works everywhere. Composer is the universal input.
**Estimate:** 1.5 weeks.

### Deliverables
1. **Composer rewrite (TUI):**
   - Real cursor movement (left/right) instead of treating input as a single string
   - Full readline bindings: Ctrl+A/E/K/U/W/Y, Alt+B/F, Ctrl+P/N history
   - Multiline support (Shift+Enter newline, Enter submit)
   - Tab completion for slash commands and file paths (`@/mentions`)
   - Paste via bracketed-paste and OSC 52
   - Ctrl+X Ctrl+E opens `$EDITOR`
   - Prompt: `xr [agent] ›` with mode chip clickable (in TUI via Enter on chip)
2. **Keybinding standardization:** implement the full binding table from Navigation §2 globally across Shell and Control Center. Remove current hijackings (Ctrl+J = quick actions, Ctrl+N = notifications, Ctrl+W = workspace) and reassign to non-readline chords (e.g., Ctrl+Shift+J, Ctrl+Shift+N, Ctrl+Shift+W) or g-chords.
3. **g-chord system** — `g` followed by another key within 1s for go-to navigation, in both Shell and Control Center.
4. **Command Palette v2:**
   - Five sections (Recent, Commands, Navigation, Skills, Settings)
   - Shows keyboard shortcuts next to each item
   - Fuzzy search with highlighting
   - `?` opens contextual help (not palette; separate overlay)
   - Works in Shell (Ctrl+K) and Control Center (Ctrl/Cmd+K, Ctrl+Shift+P alias)
5. **Slash menu (in-composer `/`):** when user types `/` at word start, shows a popover/list of slash commands filtered by typed prefix. Select via Enter/Tab, dismiss via Esc.
6. **@-mention menu (in-composer `@`):** file/folder search first; tabs for files, skills, memory, providers, web. Inserts a "chip" into the composer (web) or tagged reference (TUI).
7. **Context help overlay (`?`):** shows the shortcuts available in the current view. Lazygit-style, centered overlay; dismissable with `?` or Esc.
8. **Esc priority implementation** (Navigation §1.4): modal → popover → interrupt → collapse → confirm-exit.
9. **Tab key behavior:** Tab completes in composer; Tab cycles focus between panes only when composer is empty (outside of text).

### Exit criteria
- [ ] All keybindings from Navigation §2 work in both Shell and Control Center
- [ ] Composer supports full readline, multiline, paste, Tab completion, external editor
- [ ] `/` and `@` menus work in composer on both surfaces
- [ ] No readline key (Ctrl+A/E/K/U/W/P/N) is hijacked for product chrome
- [ ] Command palette contains every navigable destination and every slash command
- [ ] Ctrl+K opens palette in <50ms

---

## Milestone 3 — Coherent Layout & Shell
**Goal:** XR looks and feels like one operating system. Sidebar, status bar, three-pane layout consistent across surfaces.
**Estimate:** 2 weeks.

### Deliverables
1. **Sidebar standardization** — identical section order, labels, icons between TUI and Control Center (Navigation §4.1). Icon rail collapse at narrow widths. Provider pill at bottom.
2. **Status bar standardization** — same chips in same order left-to-right: connection dot, workspace, session, mode, provider/model, spend, activity, audit, notifications. Every chip is clickable/keyboard-activatable and opens the corresponding popover (model picker, workspace picker, mode switcher, budget panel).
3. **Three-pane TUI shell** — refactor TUI rendering to use damage-region tracking (no full-screen `clearScreen + rewrite` every 100ms). Render regions: header, sidebar, main, inspector, composer, status. Track dirty regions and only write diffs. Key engine change for perceived smoothness.
4. **Three-pane Control Center layout** — sidebar (220px), main (flex), inspector (320px, toggleable), topbar, chat composer at bottom in chat views. Resizable inspector width (persisted in config).
5. **Popover pickers** (model picker, workspace picker, mode switcher, spend quick-view) implemented once and reused wherever a status chip is clicked.
6. **Notification center** (bell in status bar) — opens right-side drawer with recent notifications, categorized by severity, clear all, click-to-navigate.
7. **Activity/Inspector panel** — live tool timeline, current selection metadata, quick stats. Collapsible; auto-opens when a tool call is running if closed.
8. **Deep linking (Control Center)** — every panel has a URL (IA §3); back/forward works; refresh preserves state. Token stripped from URL after first load and stored in sessionStorage.
9. **Bento Overview page** replacing the current 7-fetch dashboard: a single `/api/overview` response (enhance the existing one) provides all overview-card data; page renders skeleton first, populates as one fetch resolves.
10. **Skeleton screens** replacing per-card spinners for initial loads everywhere.

### Exit criteria
- [ ] Sidebar looks and behaves identically (in shape, if not in pixels) between Shell and Control Center
- [ ] Status bar chips are identical and clickable on both surfaces
- [ ] TUI renders without full-screen flicker at 60fps; measured frame time <16ms
- [ ] Every panel URL-deep-links; browser back/forward works
- [ ] Overview page loads in <1s to fully populated; per-card spinners are gone
- [ ] Token does not appear in URL after first navigation

---

## Milestone 4 — Workflows, Sessions, and Conversations
**Goal:** Real session management, multi-session support, background tasks, artifacts.
**Estimate:** 2 weeks.

### Deliverables
1. **Session model unified** — CLI, TUI, Control Center, and Telegram all read/write the same session records via existing `state/stores`. No separate "chatHistory" arrays.
2. **Sessions page** — list/search/resume/fork/export sessions; per-session detail view (messages, tool calls, cost, audit tail).
3. **Session switcher** — click session title in chat header → popover with recent sessions + search + "New session." Switching sessions is instant; running sessions stay in background.
4. **Background tasks** — Ctrl+B backgrounds the current task; status bar shows count ("● 2 running"); notification when background task completes; `/background` list to inspect and bring to foreground.
5. **Chat view polish:**
   - Message bubbles with role styling, timestamps, model badges, copy/retry/edit/react actions on hover
   - Code blocks with syntax highlighting, copy, and (where applicable) Run/Apply buttons
   - Tool calls as expandable chips (collapsed default)
   - Artifact blocks (plans, reports, files, diffs) rendered inline with Copy/Export/Save buttons
   - Streaming caret at end of live message
   - "N new steps" banner when new output arrives while user scrolled up; click to jump to bottom
6. **Approval dialog redesign** — matches Component §2.6: title, description, full command preview, "Always allow" pattern checkbox, Deny (default) / Allow buttons, Edit-command option. Works in TUI, Control Center, and CLI with the same content hierarchy.
7. **Budget overrun dialog** — same visual language as approval, fail-closed ("Stop" default, not "Add budget").
8. **Plan mode artifact** — when in plan mode, the assistant's output is rendered as a structured plan (checklist steps) with an "Execute plan" primary button and "Edit plan" option.
9. **Diff viewer** for file changes (side-by-side or unified); hunk-level accept/reject when approval mode is strict.
10. **Undo last action** (`u` in TUI, button in CC) — reverts file changes to pre-task state (git-based when in a repo; backup-file based otherwise).

### Exit criteria
- [ ] User can create, switch, resume, fork, and export sessions from any surface
- [ ] A task can run in the background while the user starts a new session
- [ ] Background completion notification fires cross-surface (where applicable)
- [ ] Approval and Budget dialogs are visually consistent, keyboard-navigable, default-safe
- [ ] Chat renders markdown, code, tool calls, and artifacts properly
- [ ] Plan mode produces structured, actionable plans with Execute button
- [ ] Scroll-anchor works: streaming doesn't yank user away from where they're reading
- [ ] At least one successful undo of a file write is demonstrable

---

## Milestone 5 — Onboarding, Settings, Marketplace, Remaining Panels
**Goal:** Fill in the remaining high-quality surfaces and remove all settings/admin pages that look like admin tools.
**Estimate:** 2 weeks.

### Deliverables
1. **Onboarding redesign:**
   - 3-card modal (not numbered-prompt CLI flow): Welcome → Mode & Model → Go
   - Card selection via arrow keys / click
   - Real hardware detection with recommendation
   - Ollama auto-install with progress bar (user confirms)
   - Optional cloud-key entry (can be skipped)
   - First-prompt suggestion pre-filled in composer after onboarding
   - Re-runnable via `xr onboarding` (with "repair/change" vs "reset" choice)
2. **Settings page** — organized per IA §8 (General, Keyboard, Providers, Local Models, Budget, Memory, Voice, Trust, Computer Control, Skills & Plugins, MCP, Notifications, Advanced, About). All changes live-save; no "Save" buttons; "Restore defaults" per section. Dangerous toggles require typed confirmation. Keyboard shortcut customizer UI.
3. **Marketplace v2** — reconcile the dashboard marketplace and the website `/marketplace` to the same visual system (cybernetic, XR palette, card grid, category sidebar, inspector, hero). Permissions and dependencies shown before install. Install button primary; dangerous permissions require confirmation. Installed skills appear in `/` menu after install without restart.
4. **Audit log v2:**
   - Filterable/searchable list (by event type, session, date, severity)
   - Per-entry detail view with full args/output/hash
   - Verify-chain action with progress bar
   - Signed-markdown export
5. **Budget panel v2:** time-series chart (simple SVG bar) of spend per day; per-model and per-provider breakdown; task/day/month cap controls.
6. **Memory panel v2:** searchable, categorized, with add/edit/delete actions (complementing CLI's `xr memory`). Clear-memory requires typed confirmation.
7. **Research panel v2:** shows past research runs; opens research reports as artifacts; citation click-through to source; structured summary/claims/sources/contradictions sections; follow-up in chat.
8. **Providers & Models panel:** unified view (not two panels); local runtimes and cloud providers in one place; latency tests triggerable per-provider; recommended-model highlight; health status per provider.
9. **Shield panel:** retains existing sub-tabs but restyled to match design system; threat severity color-coded with both color and icon; remediation actions one-click.
10. **Plugins & MCP panels:** install/enable/disable/test UI consistent with Marketplace style; permission disclosure before enable.
11. **Empty states** across every panel (per Component §3.10) — icon, heading, explanation, primary action button.
12. **Error states** across every panel (Component §3.11) — title, plain language, details expandable, remediation action.

### Exit criteria
- [ ] Onboarding completes in <90 seconds (with local auto-install on broadband)
- [ ] Every settings section is functional and live-saving
- [ ] Marketplace matches design system and works end-to-end (browse → inspect → install → use)
- [ ] Audit log verifies chain, exports signed report
- [ ] Budget, memory, research, providers, shield, plugins, MCP panels all use consistent card/table components
- [ ] Zero "placeholder" or "coming soon" states in shipping panels
- [ ] All panels accessible via palette, keyboard, and deep link

---

## Milestone 6 — Performance, Accessibility, Polish, Website
**Goal:** Hit all the numbers. Make it feel like a finished product. Align the website.
**Estimate:** 2 weeks.

### Deliverables
1. **Performance pass** — meet every target in Performance Standards doc. Benchmarks green on reference hardware.
   - TUI damage tracking tuned; idle redraws zero
   - Chat DOM updates batched via rAF
   - Virtualization for long lists (>200 rows)
   - API response caching and ETags
   - SSE `/api/events` channel for live state sync (replaces 30s polling)
2. **Accessibility pass** — meet WCAG 2.2 AA per Accessibility Standards doc.
   - ARIA roles/labels on all interactive elements
   - Focus management (traps, return, skip link)
   - Screen reader (VoiceOver, NVDA) spot tests pass
   - `prefers-reduced-motion` honored
   - High-contrast mode, colorblind-safe palette, NO_COLOR support
   - Keyboard-only traversal of all journeys
3. **Terminal compatibility testing** — iTerm2, Terminal.app, Ghostty, WezTerm, Kitty, Alacritty, Windows Terminal, tmux, screen, Linux console, SSH, dumb terminal, piped output.
4. **Polish details:**
   - Motion choreography: palette 80ms, modal 120ms, toast 200ms
   - Micro-copy review across every surface (consistent voice, sentence case, no "!" in errors)
   - Confirmation dialogs for destructive actions (delete workspace, clear memory, uninstall skill, reset settings)
   - Toast for non-critical confirmations ("Saved", "Copied", "Switched to ollama")
   - Version number displayed consistently (topbar about/Account/Prefs area; TUI status bar; website footer)
5. **Website alignment:**
   - Background color aligned to `#0A0A0F` (from current `#020817` drift)
   - Neutral palette aligned to XR design tokens
   - Stats pulled from live package metadata/registry (no hardcoded version/star counts)
   - Marketing copy reviewed against final product (no "v0.5" drifts)
   - `/docs` starter: install, quick start, command reference, architecture overview
   - Accessibility pass on marketing site
6. **CLI polish** — one-shot CLI output framed (header → streamed output → footer summary with cost/time/tokens/status); clean in both TTY and non-TTY mode; `--json` mode produces consistent NDJSON.
7. **Doctor command upgrade** — `xr doctor` outputs a friendly report with fix suggestions and one-key remediation actions (not just key-value lines).
8. **Documentation for users** — `xr help <topic>` covers every command; README updated; QUICKSTART.md; KEYBINDINGS.md printed from a single source of truth.
9. **Release readiness:**
   - CHANGELOG updated
   - Migration guide from 2.x → 3.1A
   - Version bump to 3.1.0 in package.json
   - Screenshots/demo GIF of Shell and Control Center
   - Known-issues list

### Exit criteria
- [ ] Every target in XR-3.1-PERFORMANCE-STANDARDS.md passes on reference hardware
- [ ] Every WCAG 2.2 AA requirement in ACCESSIBILITY-STANDARDS.md met (and documented where not)
- [ ] All nine User Journeys work flawlessly on both Shell and Control Center
- [ ] Zero P0/P1 bugs open (P2 tracked post-launch)
- [ ] Website reflects current product and matches design system
- [ ] Docs/help reflect all new commands, keybindings, surfaces
- [ ] Dogfooded internally for ≥1 week with bug-squash cycle

---

## Post-3.1A (out of scope but ordered)
- Light theme
- VS Code extension v2 (chat panel participant, inline completions)
- Zed/JetBrains/Neovim extensions
- Mobile companion app (Telegram bot is the MVP; native app later)
- WebAssembly demo on marketing site (try-in-browser)
- Team/multi-user workspaces (Business OS RBAC extension)
- Artifact canvas (spreadsheet-like, chart, whiteboard outputs)
- Plugin/skill authoring environment within Control Center
- Prompt library/custom-instructions UI
- Cloud sync (opt-in, E2E encrypted) of config and non-sensitive preferences

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Backend doesn't emit granular streaming events needed for Milestone 1 | Extend only the provider `streamChat()` interface and agent `say()`/event bus; no restructuring of agent logic beyond event emission |
| TUI damage-tracking engine is hard to get right in Bun without a TUI library | Prototype in week 1 of M3 using a simple dirty-region approach; fall back to Ink-like rendering if hand-rolled diffing fails |
| 3,000-line dashboard HTML refactor breaks working surfaces | Refactor one panel at a time behind a flag; delete old code only after new component renders identically |
| Keybinding changes break power-user muscle memory | Document bindings in palette and `?`; allow rebinding in Settings; provide a "legacy bindings" preset for users who preferred the old Ctrl+J/N/W behavior |
| Streaming provider SDKs don't all support true streaming | Implement a shim that streams single-chunk responses with a short fake-thinking delay; mark providers that need better SDK integration as tech debt |
| Scope creep on Business OS / computer control UX | Stay out of those backend modules; ship only the panels/surfaces required to display their existing state and invoke existing APIs |
| Accessibility regressions as UI is rebuilt | Axe runs in CI on every PR; keyboard and screen-reader checklist on every milestone review |

---

## Decision log
During implementation, agents must update this section when making a decision the architecture docs don't cover. This preserves traceability.

*(To be filled during execution.)*

---

## Done means done
Milestone 6 exit criteria are the definition of "XR 3.1A ships." Every criterion is testable. The product experience is coherent, fast, keyboard-first, accessible, and beautiful — one operating system, not six products wearing a logo.
