# XR 3.1A — Competitive Research
> Deep analysis of the products that define user expectations for XR.

This research is the foundation for every design decision in XR 3.1A. We did not arrive at any UI pattern by intuition; every pattern below is justified by what leading products have shipped, tested, and taught users to expect.

Products studied fall into five categories:

1. **AI coding agents** — Claude Code, OpenCode, Codex CLI, Gemini CLI, Goose, OpenHands, Aider, Continue.dev, Cursor, Windsurf
2. **Terminal applications** — Lazygit, btop, k9s, Warp, Ghostty, WezTerm
3. **Chat UX** — ChatGPT, Claude (web), Perplexity, Gemini
4. **Dashboard/command-center UX** — Linear, Raycast, GitHub, Vercel, Arc, Notion
5. **Onboarding** — Cursor, Raycast, VS Code, Docker Desktop, Claude Desktop

---

## 1. AI Coding Agents

### 1.1 Claude Code (Anthropic) — the benchmark for terminal AI UX

**What it is:** Full-screen terminal agent with streaming, slash commands, diff previews, permission system.

**Key UX patterns to copy:**
- **Single composer at bottom.** One input line. Natural language + slash commands + @-mentions all in one.
- **Streaming output by default.** Tokens appear in real time with a blinking block cursor. Users *see* thinking happen.
- **Thinking indicator.** An explicit "thinking…" state (spinner + expanded-thinking toggle with Alt+T) that explains latency.
- **Tool-call timeline.** Every tool call (Read, Write, Edit, Bash) gets its own collapsible line with status, duration, and args preview. Collapsed by default to one line per tool; expand with Ctrl+O.
- **Permission dialogs.** When a destructive action is about to happen (shell, file write, network), the screen dims, a centered modal appears with: tool name, why it needs it, full command preview, and two buttons (Allow · Deny) with arrow-key selection. Remember-decision checkbox ("Always allow bash commands starting with `npm test`").
- **Command palette.** Ctrl+Shift+P opens a searchable command list with keyboard mnemonics (g+<key> for go-to, matching Gmail/Linear).
- **Modes.** A mode chip in the prompt shows Manual / Plan / Auto-accept / Auto. Shift+Tab cycles modes.
- **/compact.** Summarizes the conversation in-place to free context — smart, not "clear chat."
- **/cost.** Shows real-time $ spent on the current session with per-model breakdown.
- **Background tasks.** Ctrl+B sends a running task to background. Tasks list with Ctrl+T.
- **Diff previews.** File edits shown as inline green/red diffs before applying; y/n to accept per-hunk or all.
- **Exit: double-Esc.** Rewind to checkpoint (undo) when input is empty. Clears draft when input is full.
- **Color prompt bar.** `/color` lets the user set the prompt accent; identifies sessions at a glance.
- **Vim/emacs readline.** All standard Ctrl+A/E/K/U/W/P/N work in the input. Doesn't hijack readline keys.
- **Shift+Enter = newline, Enter = send.** Universal convention that must be preserved.
- **Image paste.** Ctrl+V pastes an image from clipboard into the prompt (terminal-supported via OSC 52 + term-img protocol).
- **External editor.** Ctrl+X Ctrl+E opens $EDITOR for long prompts.
- **Keyboard muscle memory** is almost entirely preserved from bash/readline. This is non-negotiable for terminal users.

**What not to copy:**
- Anthropic account requirement and login flow. XR is local-first, no account.
- The single-color theme — XR's cyan/neon brand is a differentiator.

### 1.2 Aider — terminal pair programming

**Key patterns:**
- **/add, /drop, /read only, /architect, /code** — explicit mode and context commands taught inline.
- **Architect/editor split** — strong model plans, fast/cheap model emits diffs. XR's multi-agent already does this; UX must expose it as a toggle.
- **Auto-commits with descriptive messages.** XR's audit log is the equivalent; expose commit-style summary at end of task.
- **Diff presentation as standard unified diff**, same as `git diff`. Users understand unified diff instantly.
- **/undo** as a top-level command that reverts the last change (Git-based). Safe.
- **Tokens displayed live** in the status area — `/tokens` shows context window pressure.

**What not to copy:**
- Aider's text-dense REPL feel. It's powerful but looks like a 1990s IRC client.

### 1.3 Cursor — AI-first IDE

**Key patterns:**
- **Cmd+K = in-file edit, Cmd+L = chat panel.** Two separate input modes with different intents (edit selection vs ask anything).
- **@-mentions for context.** @file, @folder, @web, @docs, @code, @git. Popover selector that fuzzy-searches.
- **Agent mode with diff review.** Agent can run terminal commands and edit files, always shows a diff preview before applying.
- **Apply button per code block.** Every AI-generated code block has Apply / Copy / Open-in-tab controls.
- **Plan mode.** Separate button "Plan" that only produces a step-by-step plan (no edits).
- **Terminal inside chat.** When the agent runs a command, a terminal pane shows streaming output in-place.
- **Status bar shows AI activity.** Background agents show a spinner in the bottom status bar.
- **Fast onboarding.** Detect installed editors (VS Code), import keybindings and extensions in one click.
- **Model picker in chat header.** Clickable chip opens a model popover with latency indicator per model.

### 1.4 Windsurf (Codeium) — Cascade agent

**Key patterns:**
- **Cascade flow** — agent shows plan, edits files, runs tests, self-heals. Actions appear as a *timeline* of cards.
- **"Will do X" / "Doing X" / "Did X"** three-state UI per step. Critical for trust.
- **Inline edits with per-line accept/reject.** (More granular than Cursor's whole-diff.)
- **Auto-context (Cascade picks relevant files)** with a visible "added to context" chip so user sees what's being injected.

### 1.5 Codex CLI / OpenAI Codex

**Key patterns:**
- Sandboxed-by-default execution model.
- Simple single-key approvals (a = allow once, A = allow always this session, d = deny, e = edit prompt).
- Network/file/exec are separate permission gates.
- **Resume sessions** with `codex resume` (fuzzy picker).

### 1.6 Gemini CLI, Goose, OpenHands

**Across these products the consistent patterns are:**
- Streaming tokens is table stakes.
- Explicit plan-then-execute mode is universal.
- Approval gates with per-pattern remember-allow are expected.
- Multi-session support is expected (resume, list, fork).
- Backgrounded agents with notification on completion are expected.

### 1.7 Continue.dev — open-source IDE extension

**Key patterns:**
- Config model/provider in a single `.continuerc.json` at project root. XR has `.xrrc`/`xr.md`; make it the same canonical file.
- Slash commands and @-mentions fully customizable.
- Full context-visibility panel — shows exactly what's in the prompt.

---

## 2. Terminal Applications

### 2.1 Lazygit — the gold standard for TUI UX

**Key patterns:**
- **Persistent multi-panel layout, never rearranged.** Left = status/files, middle = diff, right = commits/stash. Spatial memory wins.
- **1–3 key bindings** for every common action (press `c` to commit, `p` to push, `space` to stage). No chords you have to hold.
- **Bottom-line key hint** always shows context-sensitive available keys (1–5 per context, not 30).
- **Side panel with 1-9 numbers** for tab navigation, not arrow keys.
- **Popup confirmation for destructive actions** with clear default.
- **hjkl for navigation** (vim muscle memory).
- **No mouse required but mouse works.** Click a file to stage it.
- **Instant startup.** Lazygit appears within ~100ms of typing `lazygit`.
- **Context-sensitive help** press `?` opens an overlay that lists only the keys available *now*.

### 2.2 k9s — Kubernetes TUI

**Key patterns:**
- **Drill-down stack.** Cluster → namespace → deployment → pod → container → logs. Escape goes back up. Browser-like back-stack.
- **:resource<enter> command mode** for power users (like vim `:` commands). Fuzzy-matches resource aliases.
- **Ctrl-R to reverse-search.**
- **Mouseless everywhere** but also allows point-and-click.
- **Status line shows current namespace, context, cluster** at all times. Location awareness is absolute.
- **`?` key shows context-sensitive help.** Same as Lazygit.

### 2.3 btop / htop — system monitors

**Key patterns:**
- **Single keypress toggles panels.** m = memory, p = process tree, etc. Learn one letter.
- **Ascii/unicode graphs** that update every tick but don't flicker (damage-region redraw).
- **Colors are meaningful** — green=user, red=system, blue=IO. No decorative color.
- **Resizes instantly** on terminal resize.
- **No menus.** You learn 6 keys and you know everything; the key to find them is `?`.

### 2.4 Warp — modern terminal with AI

**Key patterns:**
- **Block editor for input.** Modern text editor (not TTY line discipline) — selection, multiple cursors, cursor movement, completion menu.
- **Blocks as first-class objects.** Each command+output is a Block. Select, copy, re-run, share, pin blocks.
- **Command palette (Cmd+K)** for every action; same palette for navigation, settings, theme, AI commands.
- **AI Command Search** (Cmd+Shift+K) — natural language → shell command.
- **Agent mode input toolbelt** — model selector, voice, image attachment, context chips, fast-forward toggle. All on the input row.
- **Blocks are color-coded by exit status** (red border for non-zero).
- **Warp Drive** for sharing commands/teams — not relevant to XR but the idea of persisted, named command blocks is.
- **Right-click the input → Edit agent toolbelt** to rearrange/hide chips. Personalization.
- **Prompt customization** chips can be shown/hidden/reordered.
- **Cloud agents** (Option+Cmd+Enter) run in isolated cloud. Parallel, offload compute.
- **Zen mode** (Cmd+/) hides all chrome for focus.

### 2.5 Ghostty, WezTerm, Kitty, Alacritty — modern terminals

**Key patterns:**
- **Instant startup.** All four render a window in <100ms. The fastest (Ghostty, Kitty) feel instantaneous.
- **Configuration as a single plain-text file**, editable live, hot-reloaded. XR has `~/.xr/config.json` — good, but expose hot-reload.
- **Tab/title bars that stay out of the way.** Minimal chrome by default.
- **Keybinding customization fully exposed** to the user.
- **Ligature support** (relevant for XR's mono font rendering).
- **OSC 52 clipboard integration** for copy/paste into SSH.
- **Sixel/iTerm image protocol** for inline images. XR should support rendering its avatar and graphs via this protocol in terminals that accept it.

---

## 3. Chat UX

### 3.1 ChatGPT (OpenAI)

**Key patterns:**
- **Empty state is a prompt canvas**, not a list of past conversations. Centered text input, suggested prompts around it.
- **Project GPTs / canvas** open as right-side panels for artifacts (code, spreadsheets, kanbans).
- **Artifacts** live inline in the chat — rendered previews of code, images, SVGs, with Copy/Run-in-playground buttons.
- **Memory toggle** clearly labeled "Memory" in settings with inspect/edit/delete.
- **Voice mode** is a full-screen conversation with waveform, not a tiny mic button.
- **Attachments** (paperclip) support file, image, camera, and Google Drive/Microsoft 365 integrations.
- **Model picker** in the top-center: pill with current model + reasoning effort dropdown.
- **Sidebar collapsible** to maximize chat space; history search at top.

### 3.2 Claude (Anthropic web)

**Key patterns:**
- **Projects** as top-level context boundary (matching XR's "workspaces").
- **Artifacts** open as right-side previews with preview/code/version tabs.
- **"Think" / "Don't think"** reasoning toggle visible on every message.
- **Three-dot context menu** per message for copy/redo/reaction.
- **Citations** show as superscript numbers with hover preview of source. Critical for Research mode.
- **Clear "plan" artifact** for complex tasks — a step-by-step markdown plan rendered as a numbered list with checkboxes.

### 3.3 Perplexity — research UI

**Key patterns:**
- **Sources shown before the answer.** Numbered citations, linked to the live web page.
- **Pro/Con structured answers** for comparison queries.
- **"Ask follow-up" suggested chips** after every answer, grounded in the query.
- **Modes row (Research/Academic/Writing/Math/… )** as visible chips at the top of every query.
- **Answer streamed in structured sections** (Summary, Key findings, Sources) rather than a wall of text.

### 3.4 Gemini (Google)

**Key patterns:**
- **"Thinking" shown inline** as an expandable section.
- **Multimodal input** (image, camera, audio, file) with drag-and-drop.
- **Extensions** (Gmail/Drive/Maps/YouTube) as toggle chips. Relevant to XR's plugin model.
- **"Grounding" indicator** when it uses web search — shows "✓ grounded with Google Search".

### 3.5 Cross-cutting chat patterns

After studying all four:
1. **Empty state matters.** First screen must be welcoming with suggestions, not a blank "type a message" box.
2. **Model picker always visible.** One click to switch.
3. **Streaming always on.** No spinner-then-blink answers in 2026.
4. **Citations and sources explicit.** Especially for research.
5. **Artifacts expand inline** (right panel / full-screen) without leaving the conversation.
6. **Per-message actions** (copy, retry, edit, react, fork) expected on hover.
7. **Message role visually distinct** but not color-coded in a way that breaks contrast.
8. **Composer expands to ~6 lines max**, then scrolls internally.
9. **Attachments shown as preview chips before send.**
10. **Stop generating button prominent during streaming.**

---

## 4. Dashboard / Command-Center UX

### 4.1 Linear — the gold standard for dense-app UX

**Key patterns:**
- **Keyboard-first.** Every action has a keybinding, shown in the ⌘K palette and in menus. g+<key> navigation.
- **Command palette (⌘K) does three things:** navigates to screens, creates new things, takes actions (filter, sort, assign). One palette to rule them all.
- **Sidebar collapsible into icon rail.** Three widths: full labels, icons, hidden.
- **Tri-panel layout on issues list:** filters (left) · list (center) · detail (right). Resizable, rememberable widths.
- **Optimistic UI everywhere.** Button clicks respond instantly; server reconciliation happens in the background.
- **"My Issues" / "Inbox" / "Created by me"** saved views are top-level in sidebar. Power user productivity.
- **Status dot next to workspace name** shows sync status (offline, syncing, synced).
- **Cmd+Click opens in new tab** (browser-native multi-tab support). Deep links everywhere.

### 4.2 Raycast — launcher as OS

**Key patterns:**
- **Root = command palette.** Launch Raycast and you're in a search box. No home screen.
- **Extensions are commands** that appear in the root palette when installed.
- **Persistent "root search"** for everything: apps, files, clipboard, extensions, windows, system commands.
- **AI chat is one command away** — "Ask AI" appears in the root search when you type.
- **Grid view for results** (think app launcher) when appropriate, list view for actions.
- **⌘+K for contextual actions** within the current screen.
- **⌘+, for settings** (universal shortcut on Mac). XR should bind Ctrl/Cmd+, to settings.
- **Onboarding is a 60-second flow** — one permission request at a time, with clear "why" copy.

### 4.3 GitHub — known-everywhere navigation

**Key patterns:**
- **Top bar with global search** that doubles as command palette (`/` or `s` / `g+<key>`).
- **Repo switcher** in top-left with fuzzy search, recent repos.
- **Tabs within a repo** (Code/Issues/PRs/Actions/Security/Settings) are sticky, predictable.
- **Notification bell** with count badge.
- **Status of operations shown as toasts** top-center (not bottom-right).
- **"New" button always top-right** context-aware (new issue, new PR, new repo…).

### 4.4 Vercel — developer dashboards done right

**Key patterns:**
- **Project cards on home** with real-time deployment status dot, last deploy time, framework.
- **Deployments timeline** with git SHA, author, branch, status.
- **Real-time logs streaming** during deploy.
- **Command palette (⌘K)** for switching projects, navigating to deployments, running commands.
- **Invite/team switcher top-left.**
- **Status check** — every deploy is a card with expandable build logs.
- **Minimal chrome**, high information density, cyan accent color (similar brand to XR).

### 4.5 Arc browser — opinionated, personality-driven

**Key patterns:**
- **Strong personality in chrome** — not generic dark-mode. XR has this (cybernetic guardian) — lean into it.
- **Spaces (vertical sidebar sections)** with separate profiles/themes. Analogous to XR's workspaces.
- **Command palette (⌘T)** as primary navigation, not URL bar.
- **"Little Arc"** previews — pop-up windows that don't steal focus. XR notifications should feel like this — glanceable, dismissable.
- **Split view** as a first-class layout primitive.
- **Themed with a "theme picker" that lets users personalize while keeping identity.** XR should let users select prompt-bar color (like Claude Code's `/color`) and accent intensity without breaking brand.

### 4.6 Notion — information density masterclass

**Key patterns:**
- **Sidebar hierarchy with nested pages**, collapse/expand per section, starred pages at top.
- **`/` slash menu** within a page for inserting blocks. XR's chat composer should behave like this: typing `/` opens an in-composer menu, not a separate overlay.
- **Search (⌘P)** across all pages with fuzzy match + type-ahead preview.
- **"New page" button always accessible** at the bottom of the sidebar.
- **Block menu categorizes actions** (Basic, Database, Media, Embeds, Advanced) with icons.
- **Page breadcrumbs** at top showing path in hierarchy. Critical for drill-down UX.

---

## 5. Onboarding

### 5.1 Cursor — fastest coding-agent onboarding
1. **Download → open → import from VS Code** in one click. Keybindings, theme, extensions migrate.
2. **"Try a quick task"** prompt pre-populated with a safe example (e.g., "write a todo app in React").
3. **Model choice presented as a simple picker** with tiers (Free / Pro / API key).
4. **User hits "Run"** and sees AI perform the first task within 60 seconds of install. *Success moment in under a minute.*

### 5.2 Raycast — 60-second setup
1. **Launch → grant accessibility permissions** (macOS) with clear "why" copy: "so Raycast can switch apps and type for you."
2. **Pick a few starter extensions** with toggles.
3. **"Press ⌘Space to open Raycast"** — shows the keyboard shortcut and lets the user press it immediately.
4. **Drop into the launcher with pre-populated demo commands.** The user succeeds on the first keystroke.

### 5.3 VS Code — classic first run
1. **Welcome tab with 4 actions:** New File, Open Folder, Clone Git Repository, Walkthrough.
2. **"Get Started" walkthrough** is a multi-step interactive tutorial within the editor, not a wizard dialog.
3. **Theme picker** shown early (people care about how their editor looks).
4. **Keymap extensions** offered for Vim, IntelliJ, Sublime emigrants.
5. **Folder open → workspace is set → sidebar populates → ready.**

### 5.4 Docker Desktop — installer that earns trust
1. **Installer shows system checks** (WSL2 / virtualization / disk space) with progress per check.
2. **First-run pulls a "hello-world" container** to prove it works. The user sees a success animation within two minutes.
3. **Settings walkthrough** — resources, file sharing, Kubernetes — in a structured left-nav wizard.
4. **Clear "Tutorial" card** on the dashboard that uses a toy example.

### 5.5 Claude Desktop — minimal barrier
1. **Log in with Claude.ai account** (QR code option for mobile).
2. **Ask for folder access** the first time you attach a file — not up front.
3. **Empty state shows 6 example prompts** and a huge text area.
4. **Keyboard shortcut shown bottom-left:** ⌘N new chat, ⌘K search.

### 5.6 Cross-cutting onboarding lessons
1. **Time to first success must be under 2 minutes.** Cursor, Raycast, Claude Desktop all succeed here. Docker is slower but honest about it.
2. **Don't ask for all permissions up front.** Ask when needed (progressive disclosure).
3. **Show a real thing working as soon as possible.** Hello-world container, first AI answer, starter command.
4. **Import/migrate existing configuration.** Don't make the user re-teach you their preferences.
5. **One primary "next step"** when onboarding ends — not 6.

---

## 6. Synthesized Insights — what XR must learn

### 6.1 Expected defaults (table stakes in 2026)
- Token streaming during generation, always.
- Ctrl/Cmd+K opens a universal command palette.
- `/` opens a slash-command menu within the composer.
- @ in the composer opens a context-mention menu (files, skills, providers).
- Model picker is one click/keypress away from anywhere.
- Esc closes overlays, interrupts generation, or steps back (Lazygit/k9s/Claude Code all agree).
- Shift+Enter = newline, Enter = send.
- Vim/readline keys work in terminal composer (Ctrl+A/E/K/U/W/P/N/L).
- `?` shows context-sensitive help.
- Status bar shows: mode · provider/model · workspace · spend · activity.
- Sessions are resumable, listable, searchable.
- Tasks can be backgrounded with a notification on completion.
- Approvals show the full command/tool/preview and support "always allow for this pattern."
- Empty state suggests actions, it doesn't just sit there.
- Deep links / resizable panels / breadcrumbs in the dashboard.

### 6.2 Places where XR can LEAD, not follow
- **Hard spend ceiling is code-enforced before every call.** No competitor does this at the enforcement level (most have soft warnings). XR's cost governor is a differentiator — make it *visible and explorable* not just "present."
- **Tamper-evident audit chain.** No competitor ships a hash-chained log of every action. XR should make this a premium, explorable surface (time-travel debugger, export for compliance).
- **Local-first with graceful cloud fallback.** Most competitors are cloud-only (Cursor, Claude Code cloud, Windsurf) or local-only (Ollama-only). XR bridges both — make the routing *visible* (which calls went local vs cloud, which were blocked).
- **Skills marketplace with permission transparency.** Every Skill shows exactly what it can touch *before* install. Better than VS Code extensions which often over-permission silently.
- **Computer control with vision.** Only a few competitors (Claude computer use, OpenHands) do this; XR's approach (opt-in, audited, deterministic commands) is safer. Make the "what did XR just see/do" timeline a first-class view.
- **Research mode with real citations.** Perplexity-style but with source-first, contradiction-flagging rigor the others don't offer.

### 6.3 Anti-patterns to avoid
- **Multiple surfaces with divergent command sets.** (Warp historically had different keybindings in Agent mode vs Terminal mode — users complained.) Same palette, same keys, everywhere.
- **The "feature panels that look like settings pages" anti-pattern.** The current dashboard has 17 panels, many of which are settings (Providers, Models, Memory, Voice, Settings). Good dashboards have 2–3 primary *work* surfaces and put everything else in Settings.
- **The "infinite loading spinner" anti-pattern.** Never show spinner >500ms without a skeleton or progress indicator.
- **The "emoji-as-icon" anti-pattern.** Emojis look different on every OS and date quickly. Use a custom glyph set (or Lucide/Phosphor icons) consistently.
- **The "modal-without-escape" anti-pattern.** Every modal/dialog/overlay must close on Esc with zero side effects.
- **The "notification spam" anti-pattern.** Toasts should be reserved for state changes the user must know about. Status changes belong in the status bar, not a toast.
- **The "scroll-jank during streaming" anti-pattern.** Streaming text must keep the view pinned to bottom if the user is at bottom, but let them scroll up without being forced back down. (ChatGPT/Claude both get this right.)

### 6.4 Concrete targets for XR 3.1A

Derived from the patterns above, these are the experiences XR must nail:

| Experience | Source pattern(s) |
|---|---|
| Composer at bottom, streaming, slash/mentions, Shift+Enter | Claude Code, ChatGPT, Warp |
| Tool-call timeline, collapsible, color-coded | Claude Code, Windsurf |
| Approval modal with always-allow-pattern | Claude Code, Codex CLI |
| Universal Ctrl+K palette | Linear, Raycast, Warp, Lazygit |
| g+<key> go-to shortcuts | Linear, Claude Code, GitHub |
| `?` contextual help | Lazygit, k9s, btop |
| Persistent multi-panel TUI, never rearranged | Lazygit, btop |
| Drill-down back-stack in lists | k9s |
| Block-based outputs (Warp-style) with re-run/copy/share | Warp |
| Tri-panel dashboard (sidebar · work · inspector) | Linear, VS Code |
| Optimistic UI with background sync | Linear, Vercel |
| Empty state with suggestions, not blank | ChatGPT, Claude, Raycast |
| Artifacts/results in right panel | Claude, ChatGPT canvas |
| Citations/sources in Research mode | Perplexity, Claude |
| 60-second onboarding to first AI answer | Cursor, Raycast |
| One primary CTA post-onboarding | All good onboarding |
| `<500ms TUI cold start`, `<300ms CLI first paint` | Ghostty, Lazygit, Raycast |
| Token-level streaming with visible thinking | All 2026 AI products |
| Per-message actions (copy, retry, edit, fork) | ChatGPT, Claude, Cursor |
| Deep linking (hash routes) in dashboard | GitHub, Vercel, Linear |
| Keyboard muscle memory preserved (readline) in TUI | bash, Claude Code, Lazygit |

If XR ships only the above list, it matches the 2026 state-of-the-art. The differentiators (spend ceiling, audit chain, local-first hybrid, transparent permissions) put it ahead.
