# XR 3.1A — UX Research
> Findings from first-principles UX analysis and pattern synthesis (we did not run primary user research; findings are grounded in competitive evidence plus the existing XR codebase and the repository's own feedback docs `docs/planning/09-feedback-analysis-and-plan.md`).

---

## 1. Who XR is for

XR serves five primary user archetypes. Each archetype has different surface preferences and different tolerance for complexity.

### 1.1 The security-conscious developer (primary)
- Background: backend/full-stack engineer, comfortable in the terminal, runs Linux or macOS, uses tmux/neovim, cares about supply-chain security.
- Default surface: TUI, with dashboard open on a second monitor.
- Hot buttons: local-first, supply-chain audit, cost control, approval gates.
- Biggest fear: "It did something to my machine I didn't expect."
- Must feel: **in control, auditable, fast at the keyboard.**

### 1.2 The power-user / automator
- Background: sysadmin, DevOps, or indie hacker who wants to offload repetitive work. Uses voice, Telegram bot, scripts.
- Default surface: CLI (`xr "<task>"` inside shell scripts and aliases) plus voice wake-word.
- Hot buttons: computer control, JARVIS-style automation, skills marketplace, Telegram remote.
- Biggest fear: "It's a toy that can't actually do things."
- Must feel: **capable, scriptable, always-on.**

### 1.3 The AI-curious professional
- Background: product manager, designer, founder, researcher, or writer who wants AI help but is intimidated by terminals.
- Default surface: dashboard in browser; eventually the website's web demo if we build one.
- Hot buttons: research mode, chat, simple setup, clear budget, zero surprise.
- Biggest fear: "I don't know what it's doing or how much it will cost."
- Must feel: **approachable, trustworthy, guided.**

### 1.4 The enterprise operator / CISO
- Background: security lead or platform engineer evaluating XR for a team.
- Default surface: audit log export, dashboard Security/Shield panel, compliance reports.
- Hot buttons: audit chain, egress allow-list, RBAC (Business OS), injection defense scores, SSO/on-prem story.
- Biggest fear: "We can't prove what it did."
- Must feel: **compliance-ready, provable, inspectable.**

### 1.5 The extension/skill author
- Background: plugin/skill/MCP developer building on XR.
- Default surface: CLI + docs + VS Code extension.
- Hot buttons: SDK clarity, permission system, marketplace reach, backwards compatibility.
- Biggest fear: "My skill will break because the platform moved."
- Must feel: **stable, well-documented, fair marketplace.**

XR 3.1A prioritizes **archetypes 1 and 2** (terminal-native, power users) because they are the install base today and the ones who will drive word-of-mouth. But every design decision must *also not regress* archetype 3 (approachability of the dashboard) and *must honor* archetype 4 (auditability).

---

## 2. User jobs-to-be-done

| Job | Primary surface | Critical qualities |
|---|---|---|
| "Ask XR a question / do a small task" | Composer (any surface) | Fast to open, instant answer, no ceremony |
| "Run a multi-step coding/automation task" | TUI chat | Streaming, tool timeline, approvals, ability to interrupt |
| "Start in plan mode, approve each step" | TUI / chat | Plan view, per-step approval, rollback |
| "Research a topic with citations" | Dashboard research panel / chat | Citations, structured output, sources panel |
| "Install/enable a skill or plugin" | Marketplace (dashboard + TUI palette) | Permissions visible before install, one-click enable |
| "See how much I've spent" | Status bar (everywhere) | Always visible, one click to details |
| "Switch provider/model mid-session" | Model picker (chips) | One keystroke, no config file editing |
| "See what XR is doing right now" | Activity timeline / inspector | Live, streaming, tool args visible |
| "Audit what XR has done" | Audit log (dashboard + CLI export) | Hash chain verifiable, exportable, filterable |
| "Control my computer by voice" | Voice (push-to-talk or wake) | Low latency, confirmation for destructive actions |
| "Run XR remotely (phone/other machine)" | Telegram bot / future web | Same state, same audit trail |
| "Switch between projects" | Workspace picker | Instant switch, isolated memory & audit |
| "Resume a previous task" | Sessions view | Fuzzy search, one-click resume, shows context |
| "Set up XR for the first time" | Onboarding | <2 minutes to first success, no API keys required |
| "Share/report a result" | Export / copy / share | Markdown report with citations and signatures |

---

## 3. Cognitive model of XR

Users must build one mental model and apply it everywhere. Research on how experts model complex software (Lazar, Feng, Hochheiser; Norman; Raskin) tells us:

### 3.1 The user needs ONE of each
- **One identity:** "I'm in XR." Brand chrome must announce this instantly.
- **One home:** Where you end up when you open XR. (TUI home + dashboard overview serve this role but must converge.)
- **One input:** The Composer.
- **One status strip:** Where is my system right now?
- **One search/command:** Ctrl+K palette.
- **One concept of "where my stuff lives":** Workspaces contain sessions contain messages contain tool calls.
- **One vocabulary:** Use the same nouns across all surfaces and the website. No "Mission Control" vs "XR Shell" vs "XR Console."

### 3.2 The user model XR currently teaches (and must un-teach)
Current code and docs mix these terms:
- "shell", "TUI", "console", "dashboard", "Mission Control", "Control Center", "chat"
- "tasks", "sessions", "runs", "conversations"
- "skills", "plugins", "extensions", "MCP servers"
- "providers", "models", "runtimes"
- "workspaces", "projects", "contexts"

**Canonical vocabulary for 3.1A (see IA doc for the full list):**
- XR has **Surfaces**: Terminal Shell (TUI), Control Center (web dashboard), CLI, VS Code, Telegram.
- XR is organized into **Workspaces**. A workspace is an isolation boundary (memory, audit, cwd).
- Workspaces contain **Sessions**. A session is a single thread of work (chat conversation + tools + output).
- A session has **Messages** (user, assistant, system) and **Tool Calls** (shell, file, provider, computer, etc.).
- Sessions can be **resumed**, **forked**, **backgrounded**.
- XR ships **Skills** (capability packs with permissions), **Plugins** (deep integrations), **MCP servers** (external tool servers). Skills are the marketplace unit; plugins are heavier.
- XR uses **Providers** (OpenAI, Anthropic, Ollama, Gemini…) which serve **Models**.
- XR runs in **Modes**: `agent` (executes), `plan` (plans only), `ask` (answers only), `voice` (listen/act).
- XR has **Trust** features: approval gates, spend ceiling, audit chain, egress allow-list, Shield.

Once these words are fixed, every surface uses them. No exceptions.

### 3.3 Mode anxiety
Research on AI agents (Amershi et al. 2019 "Guidelines for Human-AI Interaction") identifies **mode anxiety** as a top pain point: users cannot predict what the AI will do in the current mode. XR mitigates this by:

1. **Mode is always visible** in the status bar and composer chip.
2. **Mode changes are explicit** user actions (click chip, `/mode`, Shift+Tab cycle) — never automatic.
3. **Modes have distinct affordances:**
   - Agent mode: actions run, tool calls execute, approvals may be requested
   - Plan mode: output is a markdown plan with checkboxes, no code runs
   - Ask mode: output is text-only answers, no tools invoked
   - Voice mode: microphone is hot, wake-word icon visible
4. **The color of the composer changes subtly by mode** (left accent bar) so peripheral vision picks it up. Claude Code uses prompt-bar color; XR adopts this pattern (/color compatible).

### 3.4 Trust calibration
Trust is built or lost in micro-interactions (Riedl & Mayrhofer 2012 "Trust in Automation"). XR must:
- **Show, don't tell** that the cost governor, audit chain, local routing work. Every execution shows the cost and local/cloud routing next to the response.
- **Default to the safe option.** Destructive actions default to "ask." Easy to relax ("always allow for this command prefix").
- **Predict what's about to happen before it does.** Plan mode is the canonical example. Before any shell command, show the command previewed in the tool timeline.
- **Explain why it did something** ("I ran `npm test` to verify the fix because you asked me to validate the refactor").
- **Gracefully accept correction.** If the user denies a tool call, the agent adapts, doesn't beg or repeat.

---

## 4. Pain points (ranked)

Synthesized from reading the repository's feedback docs (`docs/planning/09-feedback-analysis-and-plan.md`), from reading issues in the current UX (audited in the previous document), and from competitive expectations.

### P0 — Feels like multiple products
- Caused by: divergent layouts, divergent color, divergent vocabulary, divergent navigation.
- Fix: One experience kernel, one design system, one vocabulary, one palette (Command), one status strip.

### P1 — Slow perception
- Caused by: kernel-boot-everywhere, no token streaming in dashboard, 100ms full-screen re-render in TUI, multiple spinners in dashboard.
- Fix: fast-paths, streaming everywhere, damage-region rendering, skeleton shells not per-card spinners.

### P2 — No visibility into "what is XR doing right now"
- Caused by: line-only output in CLI, no live token stream in dashboard, tool timeline collapsed in TUI, no streaming SSE sync between surfaces.
- Fix: always-on activity timeline, tool-call events streamed to all surfaces, inspector panel shows current action with args.

### P3 — Discoverability
- Caused by: 29 CLI commands with no discovery entry point in the product, fake hint chips in web chat, no `/` menu, no first-launch walkthrough, no contextual help.
- Fix: universal command palette, in-composer `/` menu, `?` contextual help, guided empty state, post-onboarding "try this" suggestion.

### P4 — Setup anxiety
- Caused by: onboarding asks for mode/model/API keys/budget/permissions/memory/voice (7 choices) before user has seen anything work.
- Fix: "good defaults" fast-path (<60 seconds to first answer), progressive disclosure of advanced choices, import existing configs (env vars, existing `.xrrc`), local-first default with zero setup.

### P5 — Fragmented configuration
- Caused by: 17 dashboard panels each with their own save button vs config file vs CLI flags vs slash commands, no single "settings."
- Fix: unified Settings panel with subsections (Account is absent; XR is local; sections are Provider, Models, Budget, Memory, Voice, Trust, Appearance, Keybindings, Workspaces, Skills/Plugins). All mutations (CLI slash command, palette, dashboard UI) flow through one config mutation API and persist instantly.

### P6 — Poor multi-session and multi-workspace ergonomics
- Caused by: single chat array in TUI, no session switcher in chat, workspaces buried in a panel.
- Fix: sessions sidebar/picker, workspace switcher in top status, background sessions with notification, resume/fork.

### P7 — Weak artifacts
- Caused by: responses render as plain text bubbles; code blocks are styled but not runnable/exportable; reports are not first-class.
- Fix: artifact tabs (Code, Plan, Report, Chart, File diff), open-in-right-panel, export to file, copy full artifact.

### P8 — Accessibility gaps
- Caused by: no ARIA, emoji icons, RGB-only ANSI, no reduced-motion, low contrast small text.
- Fix: full accessibility standard (see XR-3.1-ACCESSIBILITY-STANDARDS.md).

---

## 5. Discoverability framework

Discoverability is not "a help menu." It is layered:

### 5.1 Layer 0 — Zero-state
What the user sees before they do anything:
- **TUI:** Brand frame, current workspace, recent sessions, "Ask XR or type `/` for commands," suggested starter prompts.
- **Dashboard:** Same thing in web layout, recent sessions list, suggested starters.
- **CLI (one-shot):** The output of `xr "task"` starts with a one-line status banner (workspace, mode, provider, budget) before streaming.

### 5.2 Layer 1 — The Composer teaches
- Typing `/` opens an in-composer menu of slash commands, searchable, with descriptions.
- Typing `@` opens a context-mention menu (files, folders, web, skills, providers).
- Typing `#` opens a tag/modifier menu (#plan, #ask, #local, #deep, …).
- Hint chips under the empty composer suggest common slash commands (but disappear after user has sent 5+ messages — they're training wheels).

### 5.3 Layer 2 — The Command Palette (Ctrl+K)
- Every action XR can take is in it. Searchable by name, alias, keyword.
- Shows keyboard shortcut next to every action so user learns bindings.
- "Recently used" section at the top.

### 5.4 Layer 3 — Contextual help (`?`)
- Pressing `?` shows only the shortcuts/actions relevant to the current view.
- Same visual treatment as Lazygit/k9s: an overlay that doesn't navigate away.
- Bottom line of every view shows "Press ? for help" until dismissed 3x.

### 5.5 Layer 4 — Status bar reveals
- Clicking (or focusing) any chip in the status bar opens a quick-switch popover.
- Provider chip → model picker.
- Mode chip → mode switcher.
- Workspace chip → workspace switcher.
- Spend chip → budget panel.

### 5.6 Layer 5 — Persistent docs
- `xr help <topic>` with examples.
- `/help` in composer opens a browsable mini-docs panel in the TUI/dashboard (not dumps 120 lines to scroll).
- Website `/docs` serves the canonical manual.

---

## 6. Workflow patterns (what users actually do)

Studied across Claude Code, Cursor, Warp, Lazygit, and k9s. Users converge on repeatable workflow shapes that XR must support natively.

### 6.1 Tight loop (exploratory coding)
1. User types a task in composer.
2. XR plans briefly and starts executing.
3. XR calls tools, user sees each call in the timeline.
4. XR asks for approval on anything destructive.
5. User responds in-chat (not via a separate approval UI): "yes", "no, do X instead", "use /model claude-opus".
6. XR completes, shows summary + cost + diffs.
7. User immediately types next instruction.

The composer is **never blocked**. The user can type the next instruction while XR is working; it queues or interrupts per user choice.

### 6.2 Deep research
1. User types `/research "topic" --deep`.
2. XR shows research plan (sources to check, queries to run).
3. XR fetches pages and streams findings into a **research artifact** (right-side panel), showing sources and claims as they arrive.
4. Citations are rendered as superscripts, clickable to source.
5. Final report is structured (executive summary, findings, contradictions, sources, export).
6. User can "Continue researching with more sources" or "Turn into outline/doc."

### 6.3 Drive-by automation
1. User runs `xr "rename all .test.js to .spec.js in src/"` from shell.
2. XR does it in one shot (or plans and asks for approval).
3. CLI output is framed: header with workspace/provider/budget, streaming steps, final summary line with `✓ done · 37 files · $0.0034 · 2.8s`.
4. Returns exit code 0. Scriptable.

### 6.4 Long-running background task
1. User starts a big refactor, presses Ctrl+B (backgrounds it).
2. XR continues in background; status bar shows "running: refactor auth (3/12 steps)."
3. User works in another session.
4. On completion, XR shows a non-modal notification (TUI: bottom-right toast; Dashboard: OS-like notification; CLI: prints a line next time prompt is drawn; Telegram: push).
5. User can resume session to review.

### 6.5 Status check (glanceability)
1. User opens XR / switches to dashboard.
2. Within 1 second, they see: am I local or cloud? which model? how much spent today? any running tasks? any pending approvals? audit chain intact? recent sessions?
3. If nothing needs attention, the user closes or switches away.
4. Glanceability is served entirely by the status bar + home/overview top row — no navigation needed.

### 6.6 Setup / config
1. User runs `xr onboarding` or opens XR for the first time.
2. Progressive 3-step flow: welcome (with mode picker cards) → model (with recommendation + auto-install option) → finish (with first-prompt ready).
3. Advanced settings (budget, memory, voice, egress) are accessible via "Customize" link but skipped by default.
4. After setup, the composer is focused and prefilled with a suggested starter prompt like "Try asking me: what's in this directory?"

---

## 7. Micro-interactions that define feel

The feel of a product is in 100 small decisions. These are the decisions XR will standardize:

- **Spinner:** star-burst `· ✻ ✽ ✶ ✳ ✢ ·` (already chosen; keep it). Used when XR is thinking/loading, with a label ("thinking…", "connecting…", "running npm test…").
- **Caret:** blinking block cursor at end of streaming text (▊), same treatment across TUI and dashboard.
- **Success chime (optional):** subtle terminal bell / dashboard sound (off by default) on task completion.
- **Enter:** sends message (composer) or confirms (modal). Shift+Enter: newline.
- **Esc:** interrupts generation OR closes topmost overlay OR steps back (in that priority order). Never double-Esc to exit the application (Claude Code uses this for rewind, we support it but never as quit).
- **Interrupt (Ctrl+C):** during generation → stops generation and keeps response so far. No generation → clears input. Second Ctrl+C → back to shell (with confirmation in TUI).
- **Tab:** in composer → autocomplete command/mention; in modal → cycle buttons; in lists → move focus to next pane (Lazygit). Never hijack Tab for view-cycling (current TUI bug).
- **Notification toast:** fades in on bottom-right in 200ms, stays 4 seconds or until dismissed, fades out in 200ms. Maximum 3 visible at a time.
- **Transitions:** panel/overlay transitions 120ms ease-out. No >200ms transitions in productivity UI (they feel sluggish).
- **Palette open:** 80ms fade+scale-in from center-top.
- **Hover glow on cards:** subtle cyan glow (0 0 0 1px rgba(0,212,255,.3)) on keyboard focus *and* mouse hover — keyboard gets the same treatment.
- **Progress indicator:** determinate bars when we know total steps (onboarding, Ollama pull, plan execution); indeterminate spinner when we don't (LLM generation).

---

## 8. Research questions we will answer in beta (not assumed)

These are questions that need real-user testing during the 3.1 beta period; we do not pretend to know the answers now:

1. Do users expect voice wake-word by default (we ship push-to-talk by default, per safety).
2. Do users want compact vs cozy density? Ship a density toggle.
3. Do users want the inspector open by default? Start open on desktop (>=120 cols), closed on compact (<120 cols).
4. How many sessions do users typically keep? Informs session retention and history depth.
5. What are the top-10 most-used slash commands? Informs palette ordering and hint chips.
6. Is the g+<key> mnemonic system discoverable, or do users just use Ctrl+K? We will instrument the palette to find out.
7. What percentage of tasks run in agent vs plan vs ask mode? Informs default mode recommendation.
8. Do users prefer streaming to show thought/chain-of-thought, or only final answers? Default to hiding thought but allow `/thinking` toggle (matching Claude's extended-thinking UX).
