# XR SCREEN DESIGN BRIEFS — v1.0 Final
## One detailed spec per screen. Hand to a coding agent as the build contract.

**Stack:** Tauri v2 + React 18 + TypeScript + Vite + Tailwind v4 (Oxide) + shadcn/ui v4 + Framer Motion + Zustand v5 + TanStack Query v5 + Lucide React @1.5px + Sonner + cmdk + Recharts + React Flow (xyflow) + Monaco (@monaco-editor/react) + Orbitron/Inter/JetBrains Mono (local).
**Theme tokens:** defined in `xr-THEME-SYSTEM.md` — always use `var(--*)` never hardcoded hex.
**Files:** code goes under `src/screens/<ScreenName>/`, components under `src/components/ui/` (shared) and `src/components/<screen>/` (screen-local).

---

# GLOBAL APPLICATION SHELL (applies to all screens)

## Window architecture (Tauri v2)
4 native windows, all managed by Rust backend:
1. **Main** — primary app window (chat, builder, etc.), default 1280×800, min 960×600, resizable
2. **HUD** — floating Raycast-style palette, 640×480, always-on-top, hidden by default, frameless with blur, movable
3. **Voice Theater** — fullscreen/secondary-monitor, frameless, immersive, hidden by default
4. **Companion** — small 120×120 orb window, always-on-top, frameless, transparent, draggable, bottom-right default

Plus system tray icon (always alive, even when main window hidden) and global shortcuts.

## Main window layout (persistent across all 14 primary screens)

```
┌─────────────────────────────────────────────────────────────┐
│ [Traffic lights / titlebar drag region — 52px, macOS style]  │
├──────┬──────────────────────────────────────────────────────┤
│      │  [Topbar: search | wallet | mic | notif | avatar]     │
│ S    ├──────────────────────────────────────────────────────┤
│ i    │                                                      │
│ d    │                                                      │
│ e    │             Main screen content area                 │
│ b    │             (varies per route)                       │
│ a    │                                                      │
│ r    │                                                      │
│      │                                                      │
│ 72px │                                                      │
│ (or  ├──────────────────────────────────────────────────────┤
│ 240) │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

### Sidebar (left, collapsible 72px ↔ 240px)
- **Widths:** icon-only `w-[72px]` or expanded `w-[240px]`, collapsed by default on launch, toggle with `⌘B` or chevron button at bottom.
- **Background:** `var(--bg-ink)` with 1px `var(--border-subtle)` right border.
- **XR logo:** top, 40px tall, clicking goes to Chat and resets session list. Collapsed: mini X icon (28px cyan). Expanded: full wordmark "XR" in Orbitron 20px with tiny tagline.
- **Nav items (14), order fixed:**
  1. Chat (`MessageCircle`)
  2. Brain / Agent Trace (`Brain`) — labeled "Brain"
  3. Workspaces (`Folder`)
  4. Builder (`Hammer`)
  5. Search / Research (`Search`)
  6. Agents (`Rocket`)
  7. Skills Store (`ShoppingBag`)
  8. Shield / Trust Center (`ShieldCheck`)
  9. Runs / Control Room (`Clock`)
  10. Memory Explorer (`Database`)
  11. Budget (`Wallet`) — shows tiny budget-dot color (green/yellow/red)
  12. Integrations (`Plug`)
  13. Voice (`Mic`)
  14. Settings (`Settings`)
- **Active indicator:** 4px-wide vertical `var(--accent)` bar on left edge of item, plus background `color-mix(in oklab, var(--accent) 10%, transparent)`; items not active show icon in `var(--text-secondary)` on hover → `var(--text-primary)`.
- **Collapse toggle:** bottom, `PanelLeft` Lucide icon, rotates 180° when expanded.
- **User card (expanded only):** bottom area, avatar 24px, name, "Pro" or "Personal" badge, right-click for menu.
- **Scroll:** sidebar never scrolls; if items don't fit (rare), the middle section becomes scrollable but logo top + collapse bottom stay sticky.
- **Tooltip (collapsed only):** hovering an icon shows label tooltip to the right, 180ms delay, `bg-ink`/`bg-metal-bright` per theme, 1.5px Lucide style.

### Topbar (52px tall, sticky)
- **Background:** `var(--bg-void)` (or same as chrome, slight contrast with content area); bottom 1px `var(--border-subtle)` border.
- **Left:** screen title + context (e.g. "Chat" + session name, or "Builder / my-portfolio" with breadcrumbs), 18px semibold in `var(--text-primary)`.
- **Center:** command palette trigger (cmdk button) — "Type a command or ask XR..." pill input, `⌘K` shortcut shown right inside, magnifying glass icon left. 480px max width, centered.
- **Right (order from left to right on right side):**
  1. **Wallet widget** (`Wallet` icon + "$5.00" in Expanded, or just icon in small widths) — clicking opens Budget screen; dot indicates budget health (green >50%, yellow 20-50%, red <20%).
  2. **Mic button** — clicking starts voice session; if active: pulsing cyan waves animation. `⌘.` shortcut.
  3. **Notification bell** (`Bell`) — badge count unread (red dot if >0). Opens notification dropdown/popover on click (last 20 events, "Mark all read", "Open Control Room").
  4. **Avatar** (28px circle, XR sentinel head) — dropdown menu: profile, switch workspace, settings, check for updates, quit.
- **macOS traffic lights** are at top-left of the titlebar drag region; on Windows/Linux, minimize/maximize/close controls replace traffic lights at top-right (title bar height adjusts to 40px on Win/Linux).
- **All topbar buttons:** 32px×32px rounded 8px, icon 18px centered; hover `bg-raised`; active/pressed `bg-accent/20`.

### Content area
- **Padding:** 24px (p-6) by default; specific screens override.
- **Scroll:** scrollable area is the content region only (sidebar+topbar fixed); scrollbar thin (8px), thumb `var(--text-tertiary)/20`, transparent track.
- **Routing:** client-side via React Router v6 (or TanStack Router), URL deep-links: `/chat/:sessionId`, `/brain/:runId`, `/workspaces`, `/builder/:workspaceId`, etc.

---


# SCREEN 1: CHAT (`/chat/:sessionId?`)
> Default landing screen. Conversation + session list + composer.

## Layout
Three regions (no session list on narrow windows — collapse to icon sidebar):
- **Session list (left, 260px, resizable via drag divider, collapsible):**
  - Top: "New Chat" full-width primary button (cyan filled, `+` icon, `⌘N` shortcut).
  - Below: search input "Search conversations..." (appears when list >5 items).
  - Group labels: "Today", "Yesterday", "Last 7 days", "Older" — small uppercase tracking-wide 11px `text-tertiary`.
  - Session items: 44px tall, rounded 8px, truncated title (first message or auto-named), timestamp on right (e.g. "2:14 PM" or "Mon"), small model dot indicator (color-coded: cyan=cloud/local-XR, purple=thinking, gray=archived). Active session: `bg-raised` + left 3px accent bar. Hover: show delete/rename/archive buttons on right (opacity 0→1).
  - Bottom: "Archived chats" collapsed link.
- **Conversation (center, flex 1):**
  - **Welcome state (no session / new chat):** centered hero at vertical-center; XR avatar (80px, idle state), "Hey Ahmad. What are we building today?" 22px semibold, 4 suggestion chips below ("Explain a codebase", "Research a topic", "Draft an email", "Open workspace") — clicking starts new session with that prompt.
  - **Active conversation:** messages flow top-to-bottom, oldest first, auto-scroll to bottom on new message.
    - User messages: right-aligned bubble, `bg-raised`, `text-primary`, 16px, max-width 70%, rounded 16px (top-right 4px), user initial circle avatar (32px) right of bubble, sent timestamp tiny `text-tertiary` below.
    - XR messages: left-aligned, **XR avatar head (28px)** on far left, bubble `bg-ink` with subtle glow in XR Native (no glow in Paper/Arctic) `border border-subtle`, rounded 16px (top-left 4px), `text-primary` body 15px, markdown rendered (headings, lists, code blocks, tables, bold/italic/links).
    - **Tool call cards:** inside XR message bubble (or interjected), a small collapsed card showing tool icon + name + one-line summary ("📧 Read 3 emails from Sarah"), expandable to show inputs/outputs in monospaced block, status icon (spinner → ✓ green → ✗ red).
    - **Code blocks:** JetBrains Mono 13px, `bg-black/50` (light themes `bg-black/5`), rounded 8px, language label top-left, copy button top-right (appears on hover), syntax highlighting via Shiki or Monaco-lite.
    - **Streaming state:** last XR message has blinking cyan cursor at end (2px wide, 18px tall, 500ms blink opacity); streaming dots (3 dots) if waiting for first token; progress bar subtle (thin 2px cyan-gradient fill at top of message as tokens arrive).
    - **Citations:** inline superscript [1][2] in cyan, click opens source panel.
    - **Approval inline:** if tool requires approval, render Approval Modal (see cross-surface component) OR inline card in flow (see S8).
- **Composer (bottom, fixed above content, centered):**
  - Container: max-width 820px, horizontal padding 24px, margin 0 auto.
  - Input: rounded 16px (pill-like), `bg-ink` border `border-default`, focus `border-accent` + glow ring (themes without glow: only thicker border). Multi-line textarea (auto-grow from 44px → 200px max), 15px Inter, placeholder "Message XR..." + "Enter to send, Shift+Enter new line, ⌘ Enter for voice" tiny text right inside.
  - Inside/attached buttons: attachment 📎 (paperclip) left → opens file picker (multi-file, images paste), mic 🎤 right inside input → voice dictation; **outside right**: voice-theater button (waves icon) → opens Theater, Send button ➜ (cyan filled, disabled while empty gray).
  - Attachments strip: above input when files/images attached — thumbnail previews with remove-X, filename + size for docs.
  - Character/token counter: far right below input when >75% of context window: "12.4K / 128K tokens" `text-tertiary`, turns amber at 90%, red at 98%.
  - Model/agent chip: far left below input — tiny chip "Claude Sonnet 4.5 ▾" clicking opens model picker popover (list models: local+cloud, latency+cost+strength comparison).

## Empty / loading / error states
- **First launch (no sessions):** welcome hero with 4 suggestion chips.
- **Loading session:** skeleton messages (3 lines per bubble, shimmer animation 1400ms gradient sweep) + 600ms delay minimum to avoid flash.
- **Error sending:** red inline toast above composer ("Message failed — retry"), retry button next to failed user message, message remains editable.
- **Network loss:** banner yellow bar top of conversation "Offline — messages queued, will send when reconnected", queued messages show dashed border + clock icon.
- **Rate limit / budget hit:** red banner "Budget limit reached — pausing requests", "Adjust budget" button opens Budget.

## Backend / data contracts
- **Sessions list:** `GET /api/sessions?limit=50&offset=0` → `{ sessions: [{id, title, updatedAt, model, lastMessagePreview, pinned}] }`.
- **Session messages:** `GET /api/sessions/:id/messages?cursor=...` → `{ messages: [...], hasMore, cursor }` (paginated, load older on scroll up).
- **Send message:** `POST /api/sessions/:id/messages` → streams server-sent events `{type: "token"|"tool_call"|"approval_request"|"done"|"error", ...}`.
- **Real-time:** WebSocket/Tauri event `chat:event` for streaming tokens and agent events.
- **Approve/deny:** `POST /api/approvals/:id { decision: "allow"|"deny", rememberRule?: {...} }`.
- **Cancel:** `POST /api/sessions/:id/cancel` (aborts generation mid-stream).

## Animations
- Message entrance: opacity 0→1, translateY 8px→0, spring (stiffness 400, damping 30), 220ms, user messages from right slightly, XR from left.
- Typing indicator: three dots bounce vertically staggered 120ms each.
- Streaming cursor: opacity 0.2↔1, 500ms cycle (respect reduced-motion: solid opacity 1).
- Tool call card expand: height 0→auto, opacity 0→1, 200ms ease-out.
- Send button: disabled (gray, scale 0.95) → enabled (cyan filled, scale 1).
- Composer grow: height auto-animate with Framer Motion `layout`.
- Session list item hover: bg fade 150ms, delete buttons opacity 0→1 150ms delay.

## Keyboard shortcuts
- `⌘N` new chat, `⌘K` command palette, `⌘/` focus composer, `⌘.` mic, `Esc` blur inputs / close modals, `↑` edit last message (when composer empty), `Cmd/Ctrl+Shift+O` open session list toggle.

## Accessibility
- Live region `aria-live="polite"` announces new XR messages (content) + approval requests.
- Tab order: session list → composer → send; messages are navigable but not focus-trapping.
- Skip-to-content link "Skip to conversation" visible on first Tab.
- Color-only indicators (model dot, status) have icons/text equivalents.
- Minimum touch target 32px (composer buttons larger 40px).
- Streaming cursor has reduced-motion alternative (static, no blink).

## Scroll behavior
- Auto-scroll to bottom when new assistant token arrives if user is already near bottom (<120px from end).
- If user has scrolled up, show "↓ New messages" floating button bottom-right; click scrolls to bottom.
- Scroll up past first loaded message triggers "Load older messages" (infinite scroll up) with spinner top.

## Theme notes
- XR Native: XR bubbles get `box-shadow: 0 0 12px -4px var(--accent-glow)`.
- Graphite/Midnight: bubbles are same bg as cards, accent border-left 2px for XR.
- Paper/Arctic: XR bubbles get 1px `border-subtle` and very light shadow; code blocks use higher contrast.

# SCREEN 2: BRAIN / AGENT RUN (`/brain/:runId`)
> Live trace view of a single agent run — OTel tree + Gantt chart.

## Purpose
Show exactly what an agent is doing / did, call-by-call, with timing, inputs, outputs, cost. Debugging, transparency, learning. **This is XR's proof-of-trust UI** — never hides tool calls.

## Layout
- **Header (sticky top, under topbar):**
  - Run ID monospace (e.g. "#847") + run title/workspace + agent name chip + model chip
  - Status dot (cyan pulsing = running, green = done, red = failed, yellow = waiting approval, gray = killed)
  - Started time + elapsed (live ticker while running, monospace)
  - Token counters (live): input/output tokens, cumulative cost estimate monospace `text-accent`
  - Right: "Stop" red-outline button (disabled if done), "Restart" ghost button, "Share" ghost, "Export JSON" ghost
  - Tabs below header: **Trace** (active) / Timeline / Events / Cost / Logs
- **Main split (horizontally resizable divider):**
  - **LEFT (55%): Tree view** (primary)
    - Indented hierarchical list of calls: top = run root → LLM calls → tool calls → sub-agent calls.
    - Each row: expand/collapse chevron (if children), status icon (spinner circle for running, ✓ green, ✗ red, ⏸ yellow waiting), icon (Brain=LLM, Wrench=tool, User=user message, Shield=approval), name (monospace or semibold), duration badge right (`42ms`, `1.2s`, `2:14` running→live), token count for LLM nodes.
    - Color coding by category: LLM = cyan bg/left bar, tool = blue-purple, file I/O = orange, network = green, shell = red-orange, approval = yellow.
    - Selected row highlighted `bg-raised` with accent left border.
    - Click row → shows full details in right-side detail panel (inputs, outputs, metadata, error stack).
    - Auto-expand to show currently-executing node; auto-scroll to running node (with "follow" toggle).
  - **RIGHT (45%):**
    - Top (40% height): **Gantt timeline** — horizontal bars on a time axis (total run duration), each tree node = one colored bar aligned to start/duration, color same as category. Hover shows tooltip with name + duration + exact start offset. Zoom in/out via buttons or ⌘+scroll.
    - Bottom (60% height): **Detail panel** for selected node — tabs: Inputs (JSON syntax-highlighted, collapsible), Outputs (rendered — markdown if string, JSON if object), Metadata (id, parent, tokens, model, timing, cost), Error (if any: red monospace stack trace), "Re-run from here" button.

## Empty / loading / error
- **No runId (default `/brain`):** "Open a run" empty state with recent runs list (last 10) + "Pick a recent run or start an agent to see it think."
- **Loading run:** skeleton tree rows (12 shimmering lines) + skeleton Gantt.
- **Run not found:** "Run not found" with back-to-runs link.
- **Failed run:** root row is red, detail panel shows error prominently; retry button.
- **Very long run (>10k nodes):** virtualized tree (react-window) to keep 60fps; Gantt downsamples to visible window.

## Backend contracts
- `GET /api/runs/:id` → `{ id, agent, workspace, model, status, startedAt, endedAt, tokensIn, tokensOut, cost, root }`
- `GET /api/runs/:id/events?cursor=` → streamed SSE of live events (new calls, completions, token counts)
- `GET /api/runs/:id/tree?node=` → lazily-load children of a node (paginated depth-first)
- `POST /api/runs/:id/cancel`, `POST /api/runs/:id/retry?fromNode=...`
- OTel-compatible trace format (spanId, parentSpanId, startTime, duration, attributes, events)

## Animations
- New tree nodes appear with opacity 0→1 + slide-down 12px, spring 300/28.
- Running node: cyan bar pulses 1500ms cycle on the left edge; spinner icon rotates.
- Gantt bar grows in real time (width animates to new value).
- Token/cost counters tick (number tween 150ms ease-out) instead of jumping.
- Panel divider drag: real-time width, cursor col-resize.

## Keyboard
- `↑↓` navigate tree, `→←` expand/collapse, `Space` select, `R` restart, `S` stop, `⌘E` export, `/` focus search.
- `J/K` for vim-style navigation (optional, from settings).

## A11y
- Tree view uses proper ARIA tree roles (`role="tree"`, `aria-expanded`, `aria-level`, `aria-selected`).
- Gantt has a text-only table equivalent shown to screen readers.
- Status icons have text labels (running/completed/failed/waiting).
- Live region announces when new nodes appear and when run completes/fails.
- Color is not the only indicator (icons + labels accompany color).

## Theme notes
- Gantt colors use a categorical palette (cyan/purple/orange/green/red/yellow) adjusted for contrast per theme (brighter/dimmer).
- JSON syntax highlighting tokens map to theme vars (keys=accent, strings=amber/olive, numbers=purple, keywords=wait-purple).
- Running pulse uses `--accent-glow` (softer in Midnight, absent in Paper/Arctic).

# SCREEN 3: WORKSPACES (`/workspaces`)
> Launch pad for projects. Template picker + multi-window launch.

## Layout
- **Header:**
  - Title "Workspaces" 24px bold
  - Right: "+ New Workspace" primary cyan button, "Open as multi-window" toggle (icon: LayoutGrid), view toggle (grid / list icons).
  - Sub-header: Search bar "Search workspaces..." left; filter chips All/Pinned/Recent/Git right.
- **Template strip (below header, collapsible):** "Start from template" — 5 template cards side-scrollable: Python, Web App, Research, Custom, Git Clone. Each card: emoji icon, title, subtitle ("React + Vite + Tailwind + Builder live preview"), "Use" button on hover. Git Clone card shows URL input expansion on click.
- **Main area: workspace grid (default, 3 columns, responsive 2/3/4 columns at 1024/1280/1600):**
  - Workspace card: 240px min height, `bg-ink`, rounded 12px, `border-subtle`, hover `border-accent/40` + subtle lift (`translateY(-2px)` + shadow).
  - Card content: gradient header strip (top 4px, color derived from workspace type: web=cyan, python=blue, research=purple, custom=metal), emoji icon (40px) + favorite star top-right, workspace name bold 16px (truncated), path 12px monospace `text-tertiary` (truncated), small stack chips (React, Python, Ollama) 10px, last opened "2h ago" 11px, quick actions on hover (Open · Open in Finder · Delete).
  - Selected card: `border-accent` + accent glow ring (or thicker border in light themes).
  - "+ New workspace" card at end of grid: dashed border, large `+` in center, "Create new workspace" label — click opens same flow as + button.
- **Multi-window mode (toggle on):** cards have checkboxes; selection counter + "Launch N windows" floating bar at bottom; Tauri spawns a separate window per selected workspace at remembered positions.

## Empty / loading
- **No workspaces:** centered illustration (folder+orb), "No workspaces yet" heading, "Create your first workspace" primary button, "Try a template" secondary link.
- **Loading:** 8 skeleton cards with shimmer.
- **Error (path missing):** card shows yellow warning badge "Path not found" — "Locate" button.

## Backend
- `GET /api/workspaces` → list; `POST /api/workspaces { name, path, template }`; `DELETE /api/workspaces/:id`; `PATCH /api/workspaces/:id { pinned, name }`.
- Template metadata: built-in JSON; "Git Clone" calls `POST /api/workspaces/clone { url }` (uses git2 or git CLI).
- Launch multi-window: Tauri command `spawn_workspace_windows(ids[])` — each window gets its own webview via `WebviewWindowBuilder`.

## Animations
- Cards stagger in on mount (opacity + 12px translateY, 40ms stagger, spring 380/28).
- Hover: scale 1.01, border-color to accent/40; favorite star pop (scale 0→1.2→1, spring).
- Multi-window launch bar: slide up 32px→0, 280ms spring.
- Template strip cards: horizontal scroll with snap; mouse drag scroll supported.

## A11y
- Cards are `role="button"`, focusable, Enter/Space activates.
- Template strip has left/right arrow scroll + scroll buttons for keyboard users.
- Favorite star has accessible label "Toggle favorite"; delete has destructive confirmation dialog.

---

# SCREEN 4: BUILDER (`/builder/:workspaceId`)
> Lovable/Cursor/v0-style 3-pane IDE: chat with XR | Monaco code editor | live preview iframe.

## Layout (three columns, draggable dividers)
- **Top bar (under app topbar):** project breadcrumb "my-portfolio/main", branch chip `main ✓`, right: "Deploy" (cyan filled primary rocket icon), "Save" ghost, "Push" ghost, "⟷ Sync" status dot, preview target selector (local:3000 / preview container).
- **Left pane: AI Chat (28% width, min 280, max 480):**
  - Header "AI Chat" 14px bold, `···` menu (clear, export, share).
  - Chat thread, same styling as main Chat screen but compact (avatars 20px, bubble padding 10px).
  - Builder-specific context: XR knows the open file(s) and workspace; messages can reference "line 42 of App.tsx" and click-to-jump.
  - Buttons below XR messages: [Apply diff] (cyan), [Explain], [Copy]; if XR proposes code change, a unified diff preview is shown inline with accept/reject per hunk.
  - Composer: same as chat but smaller (auto-grow up to 120px), "Attach open file" paperclip-with-code icon.
- **Middle pane: Monaco Editor (flex 1):**
  - Tab bar: open files as tabs (X close, dot unsaved), "active" tab underlined accent. "+" button opens quick file picker (cmdk-style fuzzy).
  - Editor: Monaco, `@monaco-editor/react`, theme derived from app theme (see tokens), font JetBrains Mono 13px, line numbers, minimap right, minimap can toggle off, bracket pair colorization, word-wrap off by default, F1 command palette native to Monaco.
  - Code lens: subtle `💡 XR: suggest fix` / `XR: explain` inline lenses (can toggle off).
  - Diagnostics gutter: red/yellow squiggles from TypeScript/language servers run in sidecar; hover shows message.
  - Bottom: minibuffer-like status bar (file path, cursor line:col, spaces/tabs, language, encoding).
- **Right pane: Live Preview (28%, min 320, max 520):**
  - Top bar: URL bar `localhost:3000`, back/forward/reload, open-external button (↗ opens in system browser), device size toggle (desktop/tablet/mobile frame), console toggle.
  - Content: `<iframe>` pointed at the dev server (started/stopped automatically by sidecar). When app isn't running, shows "Start dev server" placeholder with play button.
  - Console (slide up from bottom when toggled): iframe-injected console logs, `log/info/warn/error` color-coded, filter input, clear button.
  - Builder uses the Tauri `webview` approach for preview OR sandboxed `<iframe>` pointing at a sidecar process on localhost (never the same origin as app).

## File tree (togglable, far left within middle pane, 240px)
- Opened via button next to tabs (file tree icon, `⌘\` toggle).
- Shows workspace folder tree, folders expandable, files show extension-colored icon, right-click context menu (new file/folder, rename, delete, reveal in OS, open in terminal).
- Drag-drop files to move.
- Active file highlighted.
- Git status badges: M=modified, U=untracked, A=added, D=deleted in standard colors.

## Sidecar process (Rust/Node)
- Builder auto-starts the project dev server (detects framework: npm run dev / pnpm dev / cargo run / python -m http.server), proxies to iframe port.
- Shows "Installing dependencies..." / "Starting dev server..." / "Ready in 2.3s" status chips in preview topbar.
- If install/start fails, shows error log in preview area with "Retry" and "Show full log" buttons.

## Empty / loading
- **No workspace:** "Open a workspace to start building" + recent workspace list.
- **No file open:** Monaco shows "Open a file" with large file icon and "Open file" button, or drag-drop file into pane.
- **Cloning/installing/starting:** skeleton editor + centered spinner "Setting up workspace...", log stream below.
- **Preview error:** Iframe error (port not open) shows friendly page with error details + Start button.
- **Applying XR patch:** editors show staged diff highlights (green add, red remove gutter) for 1.5s before auto-applying, with undo toast.

## Backend
- File ops: `GET/POST/PATCH/DELETE /api/workspaces/:id/files` (Tauri fs plugin, sandboxed to workspace root).
- Sidecar: Tauri shell plugin spawns dev server, streams stdout to UI via events.
- Preview proxy: Tauri localhost port per workspace, proxy CORS headers set.
- Diff apply: XR returns unified diffs; backend applies patch via `diff` library (never blind overwrite).
- Git: uses built-in git bindings for status, commit, push, pull, branch.

## Animations
- File open tab: slide in, fade 150ms.
- Diff application: gutter highlights flash green 600ms then fade to normal.
- Console slide up: height 0→35%, 250ms spring.
- Preview loading: small spinner top-right; iframe content shows after load with fade-in 200ms.
- Sidebar (file tree) slide: width 0→240, 280ms spring.
- Panels divider drag: real-time, mouse col-resize cursor.

## Keyboard
- `⌘P` quick open file (cmdk), `⌘S` save, `⌘\` toggle file tree, `⌘1/2/3` focus chat/editor/preview, `⌘Enter` send chat, `⌘W` close tab, `⌘D` diff accept hunk, `Ctrl+\`` toggle console, `F1` Monaco command palette.

## Theme
- Monaco themes auto-generated per app theme (XR Native = "xr-native-dark" Monaco theme matching bg `#070B14`; Arctic = "xr-arctic-light"; Paper = warm high-contrast; etc.)
- Iframe preview is **not** themed — content runs as-is (user's app). Iframe chrome (browser bar) uses theme tokens.
- Diff add/remove backgrounds use `--success/15` and `--danger/15`.

# SCREEN 5: RESEARCH (`/research`)
> Perplexity-style deep research. Source panel + synthesized article.

## Layout
- **Left control panel (280px):**
  - Query input (large, primary): "What should XR research?" textarea auto-grow.
  - Depth selector: segmented control — Quick (3min, web) / Standard (8min, 8-12 sources) / Deep (20min, 20+ sources) / Academic (30min, ArXiv+PubMed+journals) — Standard default.
  - Source filters: checkboxes — Web (default on), ArXiv/Papers, Local Files, PDF upload area (drop zone), Connected apps (Gmail/Drive/GitHub).
  - When research running: progress bar (cyan gradient, animated indeterminate→determinate once sources known), current step chip ("Searching web..." → "Fetching 14 sources..." → "Reading..." → "Synthesizing..." → "Done"), cancel button.
  - When done: stats — "14 sources • 8 min • 12.4K tokens • $0.08", "Restart" ghost, "Save to workspace" button, "Share" button.
  - Follow-up suggestions: 4 suggestion chips below stats when done.
- **Main content (flex 1, scrollable, max-width 780px, centered, p-8):**
  - Before research: centered hero "What do you want to discover?" + depth selector copy.
  - During research: live "research log" feed — expanding list of sources discovered so far with title+domain+status (found/reading/synthesized), each row fade+slide in.
  - When done: rendered Markdown report with title, summary, sections with headings, inline citations [1]..[N] in cyan superscript (click highlights source in right panel, scrolls into view, opens source detail), pull quotes, comparison tables, "Contradictions" callout if sources disagree (yellow bg, lists conflicting claims with citations).
  - End of report: "Sources cited" numbered list (title + domain + date + link), "Generated X minutes ago" footer.
- **Right sources panel (320px, resizable, collapsible):**
  - Header "Sources (14)" tab: All / Used in report / Conflicting.
  - Source cards list (scrollable), each card: favicon 20px, domain gray 11px, title 13px bold, snippet text 12px, relevance bar (thin horizontal meter), "Open" button, "Copy" button. Currently-being-read source has cyan pulsing border; cited sources have a cyan check.
  - Click a source: shows full-text view in slide-over or expanded panel (for PDFs: built-in PDF viewer; for web: reader-mode extracted text).

## Empty / loading / error
- **Idle:** centered hero, no sources panel.
- **Running:** skeleton report (headings + line shimmer) appears after 3s to indicate progress, below the live log.
- **No results / blocked:** "Search blocked (egress disabled)" warning with "Enable web access in Shield" button.
- **Partial failure:** banner "8/14 sources reached; continuing with available."
- **Citation missing:** clicking superscript when source failed to load shows "Source unavailable" popover.

## Backend
- `POST /api/research` → SSE stream `{type: "step"|"source"|"claim"|"token"|"citation"|"contradiction"|"done", ...}`.
- Research is a specialized agent pipeline (planner → searcher → reader → synthesizer → fact-checker → citation linker).
- Web search via configurable search provider (SearXNG, Brave, SerpAPI); respects egress proxy rules.
- PDF reading via local extraction (pdf.js in Tauri, no cloud).
- Citations stored with character offsets in final text so click mapping works 100%.

## Animations
- Source cards slide in from right (opacity 0 + X 20px, 300ms spring, staggered 60ms).
- Streaming text same as Chat (cursor blink).
- Progress bar: gradient sweep 1.5s linear while indeterminate, fills to % when known.
- Citation click: source panel item gets cyan flash background 600ms, smooth-scroll into view.
- Contradiction callout: yellow left border, subtle pulse on first render.

## A11y
- Report is proper semantic HTML (`article`, `<h1>-<h4>`, `<cite>`, `<blockquote>`).
- Progress has `aria-valuenow/min/max` and screen-reader text "Research 60% complete, reading sources".
- Sources panel has landmark role; citation links labeled "Citation 14, source: arxiv.org".
- PDF viewer has keyboard accessible text layer.

## Keyboard
- `⌘Enter` submit query (from input), `Esc` cancel running research, `⌘/` focus query input, `⌘S` save to file, `1-9` jump to citation.

---

# SCREEN 6: AGENTS (`/agents`)
> Prebuilt agents gallery + custom agent creator + workflow canvas.

## Layout, three tabs
### Tab A: Prebuilt
- Grid of 7 agent cards (4 columns, responsive 2/3/4 at 800/1200/1600):
  - Each card: circular colored icon (Coder=cyan hammer, Researcher=blue search, Writer=purple pen, Analyst=green chart, Designer=pink palette, Ops=orange server, General=white orb), agent name bold, one-line description gray, stack chips for tools used, "Start chat →" button on hover, "⋮" menu (favorite, view config, duplicate).
  - Favorite corner star (top-right).
- Hover: card lift 4px, border accent glow.
- Click → opens new Chat session pre-wired to that agent (sets system prompt + tools + budget).

### Tab B: My Agents (custom)
- Same grid but user-created agents; "+ Create Agent" prominent card at end of grid.
- Click card → opens Agent Editor modal/panel (name, description, system prompt textarea, allowed tools multi-select chips, model picker, budget cap slider, Constitution overrides, avatar emoji picker, "Save" cyan, "Test" button opens chat in new tab, "Delete" red, "Duplicate" ghost).
- Agent configs saved in `~/xr/agents/` as TOML/JSON, versioned.

### Tab C: Workflows
- Full-screen React Flow canvas:
  - Node palette left (drag onto canvas: LLM call, Tool use, Branch, Human check, Sub-agent, Input, Output, Loop).
  - Canvas (flex 1): dark grid dots (XR Native), nodes as rounded cards colored by type (LLM=cyan, Tool=purple, Branch=yellow, Human=orange), ports on left/right, connections with bezier curves animated "marching ants" dot flow.
  - Right inspector panel: selected node properties (name, config form, e.g. model+prompt for LLM node; tool+args for Tool node).
  - Top: save button, test run button (cyan "▶ Run workflow"), zoom controls (fit, +, -), mini-map bottom-right.
  - Drag-to-pan, scroll-to-zoom, multi-select, undo/redo, copy/paste nodes.

## Empty / loading
- **My Agents empty:** "No custom agents yet — start from a prebuilt or build your own" + CTA.
- **Canvas empty:** dashed empty state with "Drag nodes here to build a workflow" + big + button.
- **Loading agents:** 7 skeleton cards.

## Backend
- `GET/POST/PATCH/DELETE /api/agents`, `POST /api/agents/:id/test`, `POST /api/agents/:id/run`.
- Workflows: `GET/POST /api/workflows`, execute via runner that interprets the DAG (topological sort, retries on node failure, timeouts per node).
- Workflow runs appear in Brain trace view automatically (each node a span).

## Animations
- Card entrance: stagger 40ms.
- Node creation on canvas: scale 0.8→1 spring 380/24.
- Connection create: path draw (stroke-dashoffset 200ms).
- Running workflow: edges get animated marching-ant gradient; active node pulse glow.
- Inspector panel slide right 300ms.

## A11y
- Canvas nodes focusable via Tab, Enter to open inspector, Delete to remove, arrow keys nudge position.
- Color not sole indicator (node icons + labels).
- Screen-reader text summary of graph available via "Describe workflow" button.

## Keyboard (canvas)
- `Space+drag` pan, `Del` delete selected, `⌘C/V` copy paste, `⌘Z/Y` undo redo, `⌘D` duplicate, `⌘+/-` zoom.

# SCREEN 7: SKILLS STORE (`/skills`)
> App-store for agent skills (MCP servers, tools, plugins). Quarantine-first install.

## Layout
- **Left category sidebar (200px):**
  - Featured (active by default), Installed, Developer Tools, Productivity, Research, Media, Browser & Web, Files & Folders, Communication, Cloud & DevOps, Data & Databases, Social.
  - Each category: icon + name + count badge.
- **Main area:**
  - Top: search "Search skills..." input (480px) right, "Installed: N" small chip, "Install from URL..." link (+ for custom MCP).
  - Featured hero (if on Featured category): large featured skill banner (80px tall, rounded 12px) — showcases an official `@rrrtx` skill with icon, name, tagline, INSTALL button, "official" verified badge.
  - Grid of skill cards (3 columns, responsive):
    - Icon square 48px (colored, brand-respecting for integrations), skill name semibold, publisher handle with ✓ verified badge for official, one-line description 13px gray, permissions summary chips (e.g. "📧 Read email" "✉ Send" "🌐 Egress"), install count + rating stars small gray, right side: INSTALL (cyan outline) / INSTALLED (filled cyan chip) / QUARANTINED (red chip) / UPDATE (yellow chip).
    - Hover: card lift 2px, permissions chips more visible, button prominent.
    - Warning: if skill requires dangerous permissions (filesystem write, shell exec, unrestricted egress) shows a ⚠ "Review permissions" warning on the card even before install.
  - Install flow (click INSTALL):
    1. Modal shows skill details, permissions manifest (every permission listed with why, human-readable), publisher trust score (official/signed/community), "Quarantine install" recommended-ticked default (runs in sandbox with limited permissions for first 48h, can't escape quarantine unless user promotes), Advanced options.
    2. Buttons: Cancel / Install with quarantine (cyan) / Install normally (gray secondary, with "Not recommended for untrusted publishers" warning).
    3. Install progress: download → verify signature → install → "✓ Installed — now available to agents" CTA "Test it".

## Empty / loading / error
- **Category empty:** "No skills in this category yet."
- **Loading:** 9 skeleton cards.
- **Install failure:** red message inline "Install failed — signature mismatch (untrusted publisher), blocked by XR Shield" with details.
- **Search no results:** "No skills match '{query}'." with suggestion to install from URL.
- **Quarantined skill in use:** when agent tries to invoke it, an approval is required each time; small toast explains.

## Backend
- `GET /api/skills?category=&q=` → registry index (served from `https://registry.xraget.com` or local mirror, signed Ed25519).
- `POST /api/skills/install { id, quarantine: true }` → verifies signature, downloads to `~/xr/skills/<id>/`, registers via MCP config.
- Skills are MCP servers — run as isolated subprocesses (never linked, AGPL safe), communicate via stdio JSON-RPC.
- Quarantine enforces: no filesystem outside `~/xr/scratch/`, no shell, egress only via proxy with prompts logged, no access to credentials.
- `POST /api/skills/:id/promote` (exit quarantine), `/api/skills/:id/uninstall`.

## Animations
- Cards stagger entrance, 40ms.
- Install button: loading spinner (circle dots braille or spinner Lucide); success: checkmark pop (scale 0→1.2→1).
- Permission modal: backdrop fade 200ms, modal scale 0.96→1 + opacity 0→1 280ms spring.
- Quarantine badge: subtle red pulse 2s cycle (to remind).

## A11y
- Install confirmation is a real dialog (role=alertdialog), focus-trapped, Escape cancels.
- Dangerous permissions flagged with both icon + color + text "High risk".
- Each install action auditable (Shield audit log records install with signature, hash, publisher).

---

# SCREEN 8: SHIELD / TRUST CENTER (`/shield`)
> Security, approvals, audit log. XR's trust spine UI.

## Layout, 4 tabs
### Tab A: Status (default)
- **Hero tile (top):** large shield icon (Check shield when all clear, Alert shield if any action needed, X shield if breach detected).
  - Status headline: "XR Shield: PROTECTED" / "ATTENTION NEEDED" / "COMPROMISED" in respective color.
  - Subtext: e.g. "All requests routed through approval layer · Last check 2 min ago".
  - "All clear" / "Review X issues" chip.
- **Stats row (4 tiles):**
  - "Unauthorized actions blocked: 0" (danger-color number if >0)
  - "Pending approvals: 17" (warning-color number, click → Approvals tab)
  - "Requests auto-approved: 98.2%" (success-color, percentage over last 30d)
  - "Tools in quarantine: 3" (warning, click highlights quarantined skills)
- **Recent activity:** last 10 events list with icon + text + timestamp (e.g. "✓ Approved gmail send to sarah@...", "✗ Blocked shell exec (no rule)", "⚠ New skill installed: figma, quarantined").

### Tab B: Approvals
- List of pending (top, highlighted, cyan-pulsing border on newest), approved (last 24h), and denied (last 24h) approval requests.
- Each request card: skill icon, action requested, target/resource detail, risk badge (Low/Medium/High), justification quote, decision buttons (DENY red / APPROVE cyan) + remember options ("Always allow for this resource", "Allow for 1h", "Allow once", "Deny permanently").
- Pending items auto-deny after 10s? No — wait indefinitely but remind; in user's absence, auto-deny after 60s for safety.
- Bulk actions: "Approve all low-risk", "Deny all" at top.

### Tab C: Audit Log
- Infinite-scroll table of all XR actions (sorted newest first), columns: Time, Actor (agent), Skill/Tool, Action, Resource, Decision (allowed/denied/quarantined), Cost, Rule ID.
- Filter bar: date range, agent, skill, decision, search.
- Click row → opens detailed event view (full inputs/outputs, matched constitutional rule, signature if skill).
- "Export audit log" (JSON/CSV) — user-owned, encrypted at rest.

### Tab D: Security Settings
- Toggles: Egress proxy (ON by default), Auto-approve low-risk (ON), Constitution strictness slider (Lenient/Balanced/Strict), Quarantine all new skills by default (ON), Approve with biometrics (Touch ID/Windows Hello, if hardware supports, ON by default for high-risk), Allow shell exec (OFF by default), PII redaction (ON), Data sharing (OFF by default), Emergency "Revoke all approvals and pause agents" red button.
- Egress proxy configuration: blocked domains list, allowed domains list, "View blocked attempts" link.
- "Run health check" button: checks signature integrity, audit chain, egress proxy connectivity, shows pass/fail.

## Empty / states
- **No pending approvals:** green check "Nothing needs your attention right now" with confetti? No — anti-pattern, use calm checkmark only.
- **Audit log loading:** skeleton rows.
- **Shield compromised (detected tampering):** full-screen red alert modal "XR Shield integrity check failed — a skill may have been tampered with. Quarantine all? [Quarantine and restart]" — non-dismissible until resolved.

## Backend
- `GET /api/shield/status`, `GET /api/shield/approvals?state=pending|approved|denied`, `POST /api/shield/approvals/:id { decision, remember }`.
- `GET /api/shield/audit?cursor=&filter=` paginated.
- `POST /api/shield/revoke-all` (emergency stop), `POST /api/shield/health-check`.
- All events Ed25519 signed in audit chain; tampering invalidates chain and triggers alert.

## Animations
- Shield hero: breathing glow on status change.
- Pending approval card first render: cyan glow ring pulse 1.5s (once) to grab attention; idle subtle pulse every 4s.
- Decision animation: APPROVE → green check wipes across card, card fades out of pending list and moves to approved section; DENY → red cross, slides to denied.
- Stats number counters tween on mount.
- Emergency button: pulse when active.

## A11y
- Approval dialogs are real `role="alertdialog"` (modal, focus trap).
- Status communicated live: new pending approval plays subtle system notification sound (off by default, user enables) + screen reader announcement.
- Risk badges have text labels not just color.
- Audit table: keyboard navigable rows with ARIA grid roles.

# SCREEN 9: RUNS / CONTROL ROOM (`/runs`)
> All runs across all surfaces, emergency stop, history.

## Layout
- **Header:**
  - "All Runs" title, count total/time range.
  - Filter tabs: All / Running / Completed / Failed / Killed (with count badges).
  - Search "Search by ID, agent, workspace..." input.
  - Date range dropdown (Last hour / 24h / 7d / 30d / Custom).
  - Export CSV/JSON button.
  - Big red "STOP ALL" button top-right (only when runs active; click → confirmation "Stop N running agents? They cannot be resumed." → stops all runs).
  - "Active across surfaces" chips (e.g. "2 chat • 1 builder • 0 voice • 1 background") above table.
- **Table (flex 1, virtualized rows, sticky header):**
  - Columns: Status (colored dot + icon), ID (monospace #847), Agent, Workspace, Model, Started (time), Duration (monospace), Tokens (in/out, monospace), Cost (monospace "$0.042"), Actions (View → opens /brain/:id, Kill ⏻ if running).
  - Running rows: cyan pulsing dot; live-ticking duration + tokens + cost.
  - Selected row: `bg-raised` + left accent border.
  - Sortable columns (click header to sort; arrow indicator); default sorted Started desc.
  - Right-click row menu: open brain trace, open workspace, copy ID, retry run, archive.
- **Aggregate stats bar (below header, above table):**
  - "247 runs today • 142K tokens • $0.34 total • 2 running • 1 failed" with the failed number linkable to failed-tab.
- **Charts (expandable section below table, collapsed by default):**
  - Toggle "Show charts" reveals: runs-per-hour bar chart last 24h; cost-per-day area chart last 30d; tokens-by-model donut.

## Empty / loading
- **No runs (fresh install):** friendly empty state "Runs will appear here once agents start working. Start a chat to see your first run." CTA to Chat.
- **Loading:** skeleton rows + shimmer; 500ms min to avoid flash.
- **Failed runs:** red row, hover shows error tooltip; click row opens Brain with error panel focused.
- **Kill confirmation:** modal "Stop run #847?" with reason input (optional) and "Stop" red / "Cancel" ghost.

## Backend
- `GET /api/runs?status=&q=&from=&to=&cursor=` paginated + live SSE updates for running rows.
- `POST /api/runs/:id/cancel`, `POST /api/runs/bulk-cancel { ids: "all-running" }`.
- `GET /api/runs/stats?range=24h|7d|30d` for aggregate numbers + chart data.

## Animations
- New running row appears at top with slide-down 200ms + flash cyan bg 1s then fades to normal.
- Status dot pulse for running (1.5s cycle); killed → gray dot with strike-through animation; error → red shake 400ms (once).
- Counters (duration, tokens, cost) tween on update (150ms ease-out).
- Charts animate on expand (height 0→auto, bars grow from bottom, areas draw).

## A11y
- Table uses `<table>` semantics, sortable columns announce state, running rows have `aria-live` for counter updates.
- Stop All button: labeled "Emergency stop all running agents", confirmation dialog role alertdialog.
- Color dots have text labels (screen reader text "running" etc.).

---

# SCREEN 10: MEMORY EXPLORER (`/memory`)
> Browse/search/edit XR's long-term memory. Entity graph + timeline.

## Layout, two tabs
### Tab A: List
- **Left (35%):**
  - Search "Search memory..." (fuzzy, full-text).
  - Type filter chips: All / Entities (people, projects, orgs) / Facts / Conversations / Files.
  - List of entries: icon by type (User=person, Project=folder, File=file, Conv=message-circle, Fact=star), name bold, snippet gray 13px, last touched timestamp.
  - Selected entry highlighted bg-raised + accent left bar.
- **Right (65%): Detail panel**
  - If entity selected: name bold 24px, type pill, created/updated dates, "Edit" button, "Delete" red button.
  - Fields list: key→value (e.g. "email: sarah@...", "role: designer", "relationship: colleague") editable inline (pencil icon, save with Enter).
  - Linked memories section: list of connected entities (e.g. "works on: portfolio", "knows: Dave") as clickable chips.
  - Provenance: "Mentioned in 3 conversations" with links to sessions.
  - Related files list with paths + open buttons.

### Tab B: Graph
- **Left control strip:** search nodes, filter types (checkboxes), reset view button, "Fit" button.
- **Canvas (full):** React Flow force-directed graph.
  - Central node = user (Alex) — largest, cyan.
  - Other nodes sized by importance/link count (3-20px radius), colored by type: person=purple, project=cyan, file=orange, model=blue, integration=green, fact=yellow.
  - Edges = relationships (line with arrow, color dim metal; label small 10px text "works on", "knows", "uses"...). Edges connected to hovered node brighten, others dim.
  - Click node → slide-out right panel same as List detail.
  - Background: subtle grid dots (dark themes) or light grid (light themes).
  - Mini-map bottom-right, zoom controls, fullscreen button.
  - Drag nodes to reposition (pinned), otherwise physics settles.

## Empty / loading
- **No memory yet:** empty state illustration (empty graph/network icon) "XR starts learning from your conversations once you start chatting. Privacy-first — all memory stored locally on your device." CTA "Start your first chat".
- **Loading:** spinner + skeleton list (list view), placeholder graph with 30 floating dots (canvas).
- **Search no results:** "No memories match" suggestion to search conversations in Chat.
- **Delete confirmation:** dialog "Delete memory '{name}'? XR will forget this permanently. [Delete] / [Cancel]".

## Backend
- Local vector DB (VelesDB or SQLite-vss) stores memories with embeddings.
- `GET /api/memory?q=&type=&cursor=` full-text + semantic search.
- `GET /api/memory/:id`, `PATCH /api/memory/:id`, `DELETE /api/memory/:id`.
- `GET /api/memory/graph?root=me&depth=2` → nodes+edges for graph canvas (lazy load depth as user zooms/clicks).
- Memory is written by Constitution agent post-conversation (user can toggle auto-memory in Settings).

## Animations
- Graph load: nodes pop in with spring (staggered 8ms by distance from center); edges draw after nodes (stroke-dashoffset).
- Hover node: node scale 1.15, connected edges brighten (opacity 0.3→1), unrelated nodes/edges dim to opacity 0.25 (transition 300ms).
- Edge selection: pulse animation along line (marching ant).
- Detail panel slide right 280ms spring.
- Physics settles with damping 0.85, no jitter after 2s.

## A11y
- Graph has a text-based fallback list of nodes and relationships available via "Show as text" button.
- Canvas interactions: Tab cycles nodes, Enter opens detail, arrows pan.
- Colors not sole indicator (icons + labels always present).
- Delete is undoable for 10s via Sonner toast "Deleted — undo".

---

# SCREEN 11: BUDGET (`/budget`)
> Spend, cost governance, limits. Spend caps are code-enforced, this is the control panel.

## Layout, 6 tabs
### Tab A: Overview (default)
- **Stats row (4 tiles):**
  - "This month: $2.47 / $5.00" with horizontal progress bar (cyan fill, turns yellow at 80%, red at 95%), next to it reset date ("Resets Oct 31").
  - "Today: $0.34" small number, today bar.
  - "Avg/day: $0.41".
  - "Tokens this month: 1.2M" (input/output breakdown on hover).
- **Chart (main, 60% height):** stacked area chart, last 30 days spend by category (LLM / tools / cloud compute / voice). Hover tooltip shows date + breakdown. Recharts `AreaChart`, gradient fills `--accent/20`, `--wait/20`, `--warning/20`.
- **By model breakdown (right, 40%):** horizontal bar list — model name, bar proportional to spend, cost number right. Sorted descending. Local models always $0 (gray bar).
- **Quick settings row:** monthly budget slider ($0 / $2 / $5 / $10 / $20 / $50 / custom, snap to presets), "Hard cap" toggle ON (red when near limit), "Circuit breaker" threshold slider % (default 95%), "Model downshifting" toggle ON (auto-switch to cheaper model if expensive calls would exceed cap), "Reserve 10%" toggle ON.
- Emergency button: **"Pause all spending NOW"** (red outline, confirmation required).

### Tab B: Spend History
- Table of all spending events (same pattern as Runs table): time, session, agent, model, tokens in/out, cost, category. Filters: date, model, agent, category. Click row → jumps to that message in Chat or Brain. Running total at bottom.

### Tab C: Models
- Model comparison grid: model name, provider, cost per 1M in/out tokens, latency rating, strengths (chat/coding/reasoning/vision), status (available if API key set + local model installed), "Set as default" button, "Test model" button, "Remove" / "Add API key" buttons. Local Ollama models shown separately with hardware recommendation badges (✓ runs well on M3 Pro, etc.).
- "Add model" button: modal (provider select, API key input (masked, stored in Stronghold), test connection button).

### Tab D: Agents
- Per-agent spend: bar chart + table showing total cost per agent, avg cost per run, runs count. Option "Set per-agent budget cap" slider per row.

### Tab E: Workspaces
- Same as Agents but per workspace. "Set workspace budget" — useful for client projects (don't over-spend).

### Tab F: Settings
- Monthly budget (slider + input), hard cap toggle, circuit breaker threshold, model downshift toggle, finalization reserve %, daily cap, per-request cap, notifications (warn at X%), data export (CSV), billing (for Pro users: manage subscription, billing history, invoices).

## Empty / loading
- **Fresh install:** budget set to $5/mo default; show welcome "Budget defaults to $5/mo. You can change or turn limits off. Spend caps are enforced in code — XR will never surprise you."
- **Loading:** skeleton tiles + chart placeholder.
- **$0 budget mode (free/personal local-only):** all cloud models disabled, UI shows "All local — $0 spent" with cyan check, "Enable cloud models" CTA (warns "This may incur costs").
- **Near limit (80%):** persistent yellow banner "You've spent 80% of your budget this month."
- **Hard cap hit:** all model calls fail gracefully with "Budget limit reached" inline message; red banner with "Raise limit" button.

## Backend
- Spend governor lives in Rust core (pre-call enforcement, not prompt-based) — see xr-MASTER-PLAN §13.5.
- `GET /api/budget/overview`, `GET /api/budget/spend?range=`, `GET /api/budget/models`, `PATCH /api/budget/settings`.
- `POST /api/budget/pause-all`, `POST /api/budget/test-charge` (test).
- Spend events written to SQLite for history; counters cached in-memory for O(1) pre-call checks.

## Animations
- Progress bars fill with spring (stiffness 300, damping 30) on mount; color transitions to yellow/red with 400ms ease.
- Number counters tween when data loads (600ms ease-out-expo).
- Charts animate in (area draw, bars grow from axis, 800ms ease-out).
- Slider thumbs glow cyan on drag; emergency button pulse when spend >90%.
- Budget hit banner slide down from top, red fade-in, "X" dismiss doesn't bypass cap.

## A11y
- Sliders labeled, keyboard adjustable, value announced.
- Color status (green/yellow/red) accompanied by text label.
- Emergency pause is one-click but requires explicit confirm (role=alertdialog).
- Currency and numbers use proper locale formatting.
- Charts have text/data table equivalents for screen readers.

---

# SCREEN 12: INTEGRATIONS (`/integrations`)
> Connected apps and MCP servers. OAuth-gated.

## Layout
- **Header:** "Integrations" title, "Connect custom MCP server" outline button (opens form: name, command, args, env vars), "Request integration" link.
- **Category filter chips:** All / Google / Microsoft / Dev Tools / Communication / Social / Media / Cloud / Data.
- **Search bar:** "Search 40+ integrations..."
- **Grid of integration cards (4 columns, responsive 3/4/5 at 1024/1280/1600):**
  - App icon (56px), integration name semibold, one-line description gray 13px, status footer:
    - "Connect" (outline button, not connected)
    - "Connected" (cyan filled chip with check) + Settings gear + "Disconnect" on hover
    - "Re-auth needed" (yellow warning chip)
    - "Enterprise only" (lock chip for paid tier; click shows upgrade CTA)
  - Hover: OAuth scope summary tooltip/list "Will access: Send email, Read drafts. Will NOT access: Delete messages."
- **Click "Connect":** opens OAuth browser window (Tauri shell open), redirects back via deep link (`xr://oauth/callback?code=...`), exchanges for tokens stored encrypted in OS keychain (Stronghold/keychain/wincred).
- **Connected card click → Settings popover:** status (connected X days ago), scopes granted, data used, "Sync now" button, "Disconnect" (red), "Remove all data" link.

## Empty / loading
- **Loading:** 12 skeleton cards.
- **No integrations connected:** "Connect an app to let XR work with your email, calendar, files, and more" + suggested first connections (Gmail, GitHub, Calendar) as buttons.
- **OAuth failure:** inline error "Connection failed or denied" with retry.
- **Token expired:** "Re-auth needed" chip is clickable to re-run OAuth.

## Backend
- OAuth flow uses Tauri deep-link plugin + OS browser; redirect URI `xr://oauth/callback`.
- Tokens stored in OS keychain via Tauri stronghold; never written to disk plaintext.
- `GET /api/integrations`, `POST /api/integrations/:id/connect`, `POST /api/integrations/:id/disconnect`, `POST /api/integrations/:id/sync`.
- Connected apps appear as MCP servers (skills) automatically.

## Animations
- Cards stagger entrance 40ms.
- Connect button: loading spinner while OAuth window open; on success checkmark pop + card border turns cyan for 1.5s.
- Disconnect: card fades gray, button returns to "Connect".
- Settings popover: fade + scale 0.98→1, 180ms.

## A11y
- OAuth scopes are listed as plain text (not just icons/colors).
- Disconnect has confirm dialog.
- Connected status announced to screen readers.
- All forms have labeled inputs; custom MCP form validates command exists before save.

# SCREEN 13: VOICE SETUP (`/voice`)
> Configure microphone, wake word, STT, TTS, test voice.

## Layout
- **Left column (form, 50%):**
  - Section 1 — Microphone: device dropdown (system default preselected), "Test microphone" button, live volume meter (cyan horizontal bars that react to audio, turns red if clipping), input volume slider, noise suppression toggle (default ON).
  - Section 2 — Wake Word: "Enable 'Hey XR'" toggle, wake phrase input (default "Hey XR", custom editable), sensitivity slider (Low/Med/High, Medium default, with warning: high may trigger falsely; low may miss), wake sound toggle (subtle chime when activated, default ON).
  - Section 3 — Speech-to-Text: model dropdown (Whisper Large v3 local default, Whisper Small, Cloud STT), language auto-detect toggle, profanity filter toggle, "Test transcription" button → records 3s, transcribes, shows result.
  - Section 4 — Text-to-Speech: voice selector (list of voices with gender/accent labels; default voices: Ahmad (male, warm PKR accent), Nova (fem, US), Atlas (male, UK), Sage (neutral)). Sample playback button per voice. Speed slider (0.7x - 1.3x), pitch slider. "XR says..." live preview box: when you change speed/voice, speaks "Ready when you are."
  - Section 5 — Voice Theater: "Open in immersive theater" toggle ON, theater on second-monitor toggle, show transcript toggle, auto-exit on silence toggle (after 30s).
- **Right column (preview, 50%):**
  - Live mini Voice Theater preview: 400px tall viewport, XR avatar (size 120px, idle/listening/thinking/speaking as user tests), waveform below (cyan bars reacting to mic), live transcription readout ("Transcribing your voice in real time..."), status indicator (Ready, Listening, Thinking, Speaking).
  - Big cyan "Start voice session →" button at bottom of right column (opens full Voice Theater window).

## States
- **Permission missing:** "Microphone access denied" warning box with "Open system settings" button (Tauri opens macOS System Settings → Privacy → Microphone).
- **Model not downloaded:** "Whisper Large v3 needs to download (1.5GB)" with progress bar + download button, option to use smaller model while waiting.
- **Testing mic:** volume meter animates, live waveform activates.
- **Success:** "Your voice sounds great!" green check + encouragement.
- **Error (no input):** "No microphone detected. Plug in a microphone and try again."

## Backend
- Uses Tauri audio plugin / cpal for mic capture.
- STT: Whisper.cpp locally (or cloud API if user chooses).
- TTS: local Piper/Coqui or cloud ElevenLabs/OpenAI TTS (user choice in settings).
- Wake word: openWakeWord or Porcupine (free tier); runs locally, always-on.
- `GET /api/voice/devices`, `POST /api/voice/test-mic` (streaming levels via SSE), `POST /api/voice/download-model { model }`.
- Voice session spawns Voice Theater window and starts STT→LLM→TTS loop in Rust backend.

## Animations
- Volume meter: bars 1-15 animate based on RMS audio level (fast attack 40ms, slow decay 200ms).
- Avatar state transitions: breathing idle → eyes focus + cowl glow (listening) → eyes narrow + eye rings orbit (thinking) → mouth/chest core glow + voice rings emit (speaking).
- Waveform: canvas-drawn frequency bars, 60fps.
- Download progress: progress bar fills, percentage number counts.
- Test button: pulse while recording.

## A11y
- All sliders/inputs labeled, keyboard adjustable.
- Audio feedback: screen reader announces state changes; visible text always accompanies audio cues (deaf users).
- Wake word sensitivity warns about false triggers; includes "Show wake events in log" option.
- Volume meter has numerical dB readout for screen readers.

---

# SCREEN 14: SETTINGS (`/settings`)
> macOS System Settings-style grouped form.

## Layout (classic two-pane settings UI)
- **Left category sidebar (180px, fixed):** group labels (Account, App, Preferences, Advanced) and rows:
  - General (active)
  - Appearance ← theme picker lives here
  - Models & Providers
  - Keyboard Shortcuts
  - Notifications
  - Voice & Audio
  - Privacy & Data
  - Updates
  - About XR
- **Right main panel (scrollable, max 720px content width, 32px padding):** Grouped form sections, each section = 1+ related settings with section header 13px uppercase `text-tertiary` 12px above, rounded-card container `bg-ink` / `bg-raised` per theme, row dividers 1px subtle between items.
- Controls per row: toggle switches (cyan when ON), dropdowns, text inputs, slider, primary/ghost/danger buttons. 40px min row height, label left aligned, control right aligned.
- macOS-like: window uses full-height sidebars, preferences grouped, search at top of sidebar to filter.

### General tab content
- Profile: avatar, name, email, "Edit profile" button, account type badge (Personal / Pro).
- Startup: "Launch XR at login" toggle, "Start minimized to tray" toggle, "Open to" dropdown (Chat / Last session / Workspaces).
- Defaults: default model dropdown, fallback model dropdown, default budget dropdown, default workspace.
- Language: UI language selector (English, Urdu, Spanish, French, etc. via i18n).
- Data: "Open data folder" (reveals ~/xr in Finder/Explorer), "Export all data" (zip), "Import data", "Clear cache" red text, "Reset XR to defaults" red (confirmation + types "DELETE" to confirm).

### Appearance tab
- Theme section: 5 circular swatches (large preview ~72px) showing accent+bg for XR Native, Graphite, Midnight, Paper, Arctic, plus "Match system" option. Click applies theme instantly.
- Sidebar: collapsed/expanded default toggle, icon size slider.
- Density: Compact/Comfortable (padding density).
- Font size: 12/13/14/15/16px default body.
- Animations: motion reduction toggle (in addition to OS reduced-motion).
- Glassmorphism toggle (disable backdrop blur for performance).

### Models & Providers tab
- Lists all configured providers: OpenAI, Anthropic, Google, OpenRouter, Ollama (local), etc. Each row: provider name, status dot (connected/auth-error/not configured), "Configure" button → opens key entry modal with masked input, "Test connection" button, "Remove".
- "Add provider" button (opens modal with 12 provider cards + "Custom OpenAI-compatible endpoint").
- Model default pickers (chat / coding / embedding / vision / STT / TTS).
- Local models: "Detect local Ollama models" refresh, "Download model" with model browser (recommends based on hardware: e.g. "Qwen3.5-3B works great on your M3 Pro (36GB)"), download progress bars.

### Keyboard Shortcuts tab
- Searchable list of all commands with shortcut; click row to record new shortcut (listening for chord); conflicts highlighted red; "Reset to defaults" button.
- Global shortcuts (work outside app): "Toggle HUD" default `⌘+Space` (configurable; if conflict with macOS Spotlight, warns and suggests alternate), "Push-to-talk voice" default `⌘.`, "Screenshot & ask XR" default `⌘⇧X`.

### Notifications tab
- Master toggle "Enable notifications".
- Per-event toggles: when approval needed, when agent completes, on budget 80%, on error, on memory saved, sounds toggle.
- Quiet hours: time range when notifications suppressed.
- Notification style: Banner / Alert / None.

### Privacy & Data tab
- Data storage: "Store conversations locally" toggle ON (cloud sync off by default, opt-in), "Encrypt data at rest" ON (can't turn off).
- Telemetry: "Send anonymous usage stats" toggle OFF by default (opt-in only), "Send crash reports" toggle ON.
- PII redaction toggle ON, "Redact these patterns" custom list.
- Egress proxy status + settings link (to Shield).
- "Delete all data" red button (typed confirmation).

### Updates tab
- Current version + build number + channel (Stable/Beta/Nightly).
- "Check for updates" button (uses Tauri updater plugin).
- Auto-update toggle ON, channel selector.
- "Update available" banner: release notes + "Install & restart" cyan button.
- Last checked timestamp.

### About XR tab
- Large XR logo, version, "The AI Agent You Can Actually Trust." tagline.
- Links: Website, GitHub, Docs, Privacy policy, Terms of service, Report a bug, Third-party licenses.
- Credits / open source acknowledgments.
- Checkbox "Enable developer tools" (off by default, enables DevTools, debug menu).

## Empty / loading
- Settings load instantly from Store; async sections (providers, updates) show loading spinner in row.
- Provider status check: pending → success green / error red with message.

## Backend
- All settings via Tauri Store plugin with schema validation.
- Secure keys (API keys) via Stronghold / OS keychain (never in plaintext store).
- `GET /api/settings`, `PATCH /api/settings`, `POST /api/settings/test-provider/:id`, `POST /api/settings/reset`.
- Updates via Tauri updater (signature-verified).

## Animations
- Tab switch: right panel content fades 80ms (no big animation for settings — feel snappy).
- Toggle switches: thumb slides spring 380/26.
- Theme switch: full-app CSS var transition 200ms (no reload).
- Recording shortcut row: border pulse cyan while listening for chord.
- Section groups slight hover on rows (bg-raised).

## A11y
- Full keyboard navigation: Tab through controls, Space toggles, arrow keys in sidebar.
- Form controls have associated labels, error messages announced live.
- Toggle switches are real checkboxes with accessible role switch.
- All destructive actions require typed confirmation + are undoable where possible.
- Shortcut recorder announces new chord after recording.

---

# OVERLAY SURFACES (not full screens, present across app)

## OV-1: HUD Command Palette (`⌘K` / global shortcut)
- **Window:** separate Tauri floating window (640×480, frameless, transparent blur), centered on screen or beneath mouse, appears with global shortcut even when XR main window is closed/hidden.
- **Layout:** input top (large 20px placeholder "Ask XR anything, or type a command...", orb avatar 24px left); results list below grouped (Commands, Chats, Agents, Workspaces, Settings, Search web). Each result: icon left, name gray, shortcut right, highlighted selected row cyan bg; group headers small uppercase `text-tertiary`.
- **Typing a message (not a command):** renders XR orb + streams voice/text response right in the palette (like macOS Spotlight + ChatGPT combined). Quick-ask without opening full chat.
- **Top-right:** keyboard shortcut hint, "Open XR" button to open full app.
- **Actions:** fuzzy search all commands/sessions/agents/files; supports prefixes: `/` filters commands, `@` mentions agents, `>` shell-style action, `?` XR web search.
- **Animation:** scale 0.92→1 + opacity 0→1, 220ms spring. Escape closes.
- **Theme:** respects app theme; backdrop blur 20px.

## OV-2: Voice Theater (immersive)
- **Window:** separate Tauri window, frameless, can go full-screen / to second monitor.
- **Background:** deep space `#03070D` always (overrides theme — cinematic exception) with slow-drifting tiny cyan star particles (canvas WebGL/particles.js), subtle parallax.
- **Avatar:** centered horizontally, 280px tall, above vertical center (at 40%), glossy black sentinel helmet, cyan almond eyes (no pupils), cyan chest core (arc reactor style, smooth circle), energy trails from shoulders (cyan-blue plasma brush strokes, animating softly).
- **Voice rings:** when speaking, 3-4 concentric cyan rings emanate outward from chest core (scale 1 → 4, opacity 0.7 → 0, repeating), thickness proportional to volume.
- **Avatar states:**
  - **Idle:** breathing (scale 1↔1.02 over 4s), eyes half-bright, chest core dim glow.
  - **Listening:** eyes bright, narrow/focused, cowl energy brightens, ring waveform around chest reacts to user voice (inward).
  - **Thinking:** eyes look up/side, 2 small cyan orbit rings circle head (1.2s rotation), chest core pulse slowly.
  - **Speaking:** mouth area doesn't move — instead chest core brightens, concentric rings emit outward, eyes animate slightly (dim/bright with speech cadence).
  - **Waiting approval:** yellow shield badge appears top-right of avatar with "Needs your approval" transcript line.
  - **Error:** eyes turn red (only state with red) + "Hmm, something went wrong" text, fades back to idle after 4s.
- **Transcript panel (bottom, 200px max height):** translucent glass panel (rgba 0.4 blur), latest transcript text scrolling (last few turns), currently-spoken phrase highlighted cyan with karaoke-style highlight (word-by-word as XR speaks).
- **Controls (top-right):** minimize, exit (X), mic mute toggle, settings gear.
- **Exit:** Escape, click X, or global shortcut; fade out 200ms.
- **Accessibility:** subtitles always visible by default (can toggle); reduced motion replaces particle drift with static stars and disables orbiting rings (only speech rings remain at lower speed).

## OV-3: Companion Orb (desktop widget)
- **Window:** small 120×120 frameless Tauri window, transparent, always-on-top, draggable (drag moves it, remembers position), default bottom-right with 24px margin.
- **Orb render:** WebGL/canvas 80px black glossy sphere with:
  - Two almond cyan eyes (small, minimalist, animated by state).
  - Central cyan chest core dot (small, 6px).
  - Thin tilted cyan orbital ring around equator (rotates slowly 12s period).
  - Soft cyan outer glow halo.
- **States:**
  - **Idle:** breathing scale 0.95↔1 (3.5s), eyes calm dim, core slow pulse, ring slow rotation.
  - **Listening:** vertical cyan wave rings emanate outward (like sound waves, 3 rings repeating), eyes bright.
  - **Thinking:** eyes narrow, small orbit dots circle orb.
  - **Speaking:** ring waves emit faster; core brightens with speech volume.
  - **Waiting approval:** yellow dot appears above orb + shield icon, pulses until clicked.
  - **Sleeping (after 30m inactive):** eyes closed (horizontal slit), glow dims, ring stops, orb drifts slightly.
  - **Error:** eyes turn red briefly, shake animation, then back to idle.
- **Click behavior:** left-click → toggle listening (push-to-talk); right-click → context menu (Open XR, Start voice, Approvals, Settings, Quit).
- **Double-click:** open full XR app.
- **Hover:** small tooltip "Hey, Ahmad — I'm here" appears above.
- **Platform:** rendered the same on Windows/Linux; macOS sits nicely in corner, not docked to menubar.
- **Auto-avoid:** orb slides temporarily if a full-screen window would cover it; returns after.

## OV-4: Approval Modal (cross-surface component)
- **Triggered** when a skill/tool requests a blocked permission. Appears in: chat (inline + modal), builder (toast + modal), voice theater (subtle overlay + voice announcement), tray notification, Telegram bot (inline button).
- **Modal design:**
  - Backdrop: `bg-overlay` blur.
  - Card: 520px max-width, rounded 16px, `bg-ink` with thick `border-accent` pulsing 2s cycle.
  - Header: shield icon (40px cyan), "Permission required" title (20px bold), subtitle "{skill} wants to take an action".
  - Body info sections (each a small card):
    - Skill: icon + name + version + verified badge.
    - Action: bold action name (e.g. "Send email").
    - Target/resource: who/what (e.g. to: sarah@company.com).
    - Preview: collapsible (e.g. email body preview, file write diff, command to run) — collapsed by default for sensitive actions, expandable via "Show details".
    - Risk badge (Low/Medium/High) color-coded with one-line explanation.
    - Justification: italic quote from agent: "User asked to send the portfolio update to Sarah."
  - Remember options: checkboxes
    - "Always allow {skill} to {action} {target}" (creates permanent rule in Shield).
    - "Allow for next hour" (temporary rule).
    - "Allow once" (default).
  - Buttons row (equal width, two buttons): DENY (outline danger) / APPROVE (filled accent). Auto-deny countdown 60s (if user doesn't interact — for safety when away; doesn't apply if modal is focused/hovered).
- **Accessibility:** role=alertdialog, focus trap, initial focus on DENY (safe default), Enter=Approve only after tab, Esc=Deny.
- **Animations:** entrance backdrop fade 200ms + card scale 0.95→1 spring 380/24; pulse ring on card border; button press spring scale.
- **Theming:** card bg/buttons adapt to theme but always has accent pulse border and clear DENY/APPROVE distinction.

## OV-5: Notifications (toast + bell)
- **Sonner-based toasts:** bottom-right, slide up 200ms, auto-dismiss 4s (persistent for approvals/errors).
- Types: success (check), info (i), warning (!), error (x), approval (shield), memory (brain), cost (wallet).
- Bell popover: clicking bell shows 360px tall panel, last 20 events grouped by day, "Mark all read", "Open Control Room" link.
- Native OS notifications via Tauri notification plugin (when XR is unfocused/minimized).

## OV-6: cmdk (in-app palette alternative)
- Uses `cmdk` library, `⌘K` opens over main window (in-app, not separate window unlike HUD).
- Same style as HUD but in-app context (search commands within current screen + settings).
- Renders input at top with XR logo; results below, fuzzy search, sub-command groups.

## OV-7: Splash / Boot
- **Window:** 400×500, frameless, centered, shown on launch before main window.
- **Content:** pure black `#03070D` (XR Native, theme-independent for brand consistency), XR logo centered 120px, wordmark "XR" (Orbitron) below logo, thin progress bar (280px wide, cyan gradient fill 0→100% as app loads), loading status text ("Loading memory graph..." / "Starting agents..." / "Ready."), small subtle star particles in background (same as Voice Theater, dim).
- **Logo animation:** core glow breathes (1.5s cycle); atomic ring around X rotates slowly (8s full rotation).
- **Minimum show 800ms** (avoid flash), dismissed automatically when main window ready, fade cross-fade to main window 300ms.
- **On first launch** skips splash and goes directly to Onboarding wizard.

## OV-8: Onboarding Wizard (first launch, 10 steps)
- **Modal/window:** 720×620, centered, rounded 16px, themed glass.
- **Progress bar top** (step 3/10, 30% cyan fill).
- **Step 1 — Splash/Welcome:** XR logo, "Welcome to XR", tagline, Continue button.
- **Step 2 — Promise:** 3 value cards (You own your data, You approve every action, You set the cost), "I understand" button.
- **Step 3 — System Check:** auto-detect OS, CPU, RAM, GPU, mic, webcam, existing Ollama install. Each row with icon + check/warn/error status, with recommendation text (e.g. "M3 Pro 36GB — great! We recommend Qwen3.5-3B for local fast chat, Qwen3.5-Coder-7B for coding").
- **Step 4 — Model setup:** two paths — "Install recommended local model (Qwen3.5-3B, ~2GB)" with download button OR "I'll bring my own API keys" → shows provider list to configure keys OR "Use XR-managed cloud (free tier available)".
- **Step 5 — Model download progress:** progress bar, speed, ETA, can skip and do later.
- **Step 6 — Voice setup:** mic device selector, quick "Say 'Hey XR' to test wake word", "Skip for now" option.
- **Step 7 — Voice selection:** pick a TTS voice (Ahmad default, or Nova/Atlas/Sage), sample playback.
- **Step 8 — Preferences:** name input, theme picker (swatch), default budget ($5/mo default), "Connect Telegram/Discord/WhatsApp" optional quick-connect chips (can skip).
- **Step 9 — Integrations:** quick connect (Gmail, GitHub, Calendar) — OAuth buttons, skip.
- **Step 10 — All set:** summary card with XR greeting "Hey {name}. I'm XR. Ready when you are." XR avatar waves (chest core bright, small energy burst), "Start chatting" primary button → opens main Chat window.
- **Skippable steps** show "Skip for now" link (except promise and system check).
- **System check runs real probes:** Tauri os plugin for OS/RAM, wgpu for GPU, cpal enumerate mics, check if `ollama` binary exists on PATH + query local models list.
- **Time to first chat < 3 minutes** (local model download is the slow step; can use cloud model immediately if user skips download).
- **After onboarding:** splash shows briefly, then Chat window opens with XR already saying greeting.

## OV-9: Updater
- When update available (checked on launch + daily), shows a card on the About settings tab + can show a modal "XR v1.1 is available" with release notes, "Install & restart" cyan button, "Later" ghost, "Skip this version".
- Download progress bar, auto-installs on restart, signature-verified (Ed25519), can't be downgraded by unsigned binaries.

## OV-10: Crash Recovery
- On launch, XR checks for dirty flag (incomplete runs from previous crash).
- If crash detected: shows recovery screen "XR didn't shut down cleanly last time." options: Resume previous sessions / Start fresh / Send crash report (with privacy preview toggle).
- Previous sessions restored, in-flight runs marked as killed/failed with note "Recovered from crash".

---

# CLI (`xr` — `@rrrtx/xr` npm package)
> Terminal client. Simple, open-source, not the full desktop experience.

## Visual identity
- **Terminal:** respects terminal background (auto-detect dark/light via `$COLORFGBG` / terminfo; defaults dark).
- **Colors (ANSI 256):**
  - XR accent: cyan `#00E5FF` (ANSI `38;5;51` dark, `38;5;37` light).
  - Success: green `38;5;42`, warn: yellow `38;5;214`, error: red `38;5;196`, wait: purple `38;5;141`, text: default fg, muted: `38;5;244` (gray).
- **No emojis by default.** Unicode symbols only:
  - `✓` success, `✗` fail/deny, `⚠` warning, `?` prompt, `›` arrow/list, `●` running dot, `◐` braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), `…` progress, `→` next/link, `(i)` info.
- **Font:** assumes user's mono (JetBrains Mono recommended but not enforced).
- **Boxes:** unicode box-drawing (│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼) at 1px weight, accent-colored for tables (avoid heavy `╔╗╚╝`).
- **Spinners:** braille characters animated 80ms frame.
- **Progress bars:** `██░░░` block characters with percentage + ETA; width auto-shrinks to terminal width.
- **Tables:** left-aligned columns, header row in accent/bold, dividers thin.

## Commands (canonical tree)
```
xr [command] [flags]

  auth           login, logout, status, whoami
  chat <msg?>    open chat session (interactive, or one-shot message)
  run <agent>    run an agent on current directory/workspace
  agents         list / describe agents
  skills         list / install / remove / inspect skills
  approve <id>   approve a pending request (from another surface/CLI)
  deny <id>      deny a pending request
  budget         show budget status / set budget
  models         list available models (local + configured cloud)
  model <name>   set default model
  memory         search / inspect / edit XR's memory
  history        list past sessions/runs
  resume <id>    resume a past chat session
  workspace|ws   list / open / create workspaces
  init <template> init new project in cwd from template
  deploy         deploy workspace (provider auto-detect: Vercel/Netlify/Railway)
  status         show XR status (running, version, budget, services)
  config         get/set config values
  update         self-update (npm install -g @rrrtx/xr)
  version|-v     print version
  help           show help

xr chat          # enters interactive chat REPL (default if no subcommand and TTY)
xr "some msg"    # one-shot (non-interactive, print response to stdout, pipeable)
xr --pipe        # stdin/stdout mode, JSON lines, no TTY
xr --model qwen  # override model
xr --budget 0.10 # set per-run budget
```

## Interactive chat REPL (`xr chat`)
- Header banner (one-time): ASCII XR logo box with version, logged-in user, budget, active model (all muted).
- Prompt on newline: `› ` in accent color.
- User types, Enter sends; streaming response starts with `XR:` accent prefix, tokens stream to stdout, tool calls inline as colored lines, approvals prompt inline:
  `? Allow gmail:send to sarah@... ? [y/N/a(lways)/1h]`
- `/help` in REPL shows commands, `/model <name>` switch, `/clear`, `/exit`, `/budget`, `/approve <id>` etc.
- Multiline input with `\` at end or `<` heredoc-style.
- Stdin pipe: `cat error.log | xr "explain this error"` → non-interactive, outputs answer to stdout.
- Exit: Ctrl+D or `/exit` or Ctrl+C twice (single Ctrl+C cancels streaming).

## States
- **Not logged in:** `xr auth login` first (opens browser OAuth or device-code flow); one-shot commands show "Run `xr auth login` first" with clickable link.
- **No local model, no cloud keys:** detects, suggests `xr models install qwen3.5:3b` with warning about download size.
- **Budget reached:** prints "Budget limit hit ($5/mo). Adjust with `xr budget --set 10`" and exits non-zero.
- **Approval needed:** interactive prompt (if TTY); if non-interactive, blocks until approved via desktop app/another device, with stderr message "Approval required: open XR desktop or run `xr approve <id>`".

## Implementation
- **Node.js 18+** (Bun compatible), published as `@rrrtx/xr` on npm, installs as global CLI.
- **No Electron/Tauri** — pure terminal.
- **Shares backend via local daemon?** v1: standalone (connects to XR desktop daemon if running on `localhost:xr-port`, else runs stateless with its own config in `~/.xr/`).
- **Config:** `~/.xr/config.toml`; keys in OS keychain (keytar).
- **Output:** pipable, `--json` for machine-readable output (no color, no spinners, JSONL).
- **Colors disabled** when not TTY or when `NO_COLOR=1` / `--no-color` flag.

## A11y
- No color-only meaning (symbols `✓ ✗ ⚠ ?` always present).
- Screen reader-friendly: progress bars emit `...` instead of block fills in non-TTY.
- Braille spinners replaced by ASCII `|/-\` when terminal doesn't support unicode (detected via `LANG`/`LC_ALL`).

---

# BOT SURFACES (Telegram, Discord, WhatsApp)
> Chat with XR from any messaging app. Same trust model, different surface.

## Common UX across all bots
- **Auth:** link account once via QR/link code; bot knows who you are, enforces your budget/rules.
- **Messages:** text XR normally; XR replies in same chat with same safety/approval behavior (inline approval buttons).
- **Persistent sessions:** same memory, same workspaces (if files not attached, only chat/memory/skills without filesystem).
- **Approvals:** sent as interactive card with [APPROVE] / [DENY] buttons; times out in 60s (denies).
- **Budget warning:** when approaching budget, bot sends heads-up "You've spent $4.20 of $5".
- **Commands:** `/start`, `/stop`, `/budget`, `/status`, `/model`, `/approve`, `/deny`, `/help`.
- **Voice messages:** auto-transcribe and respond; voice-reply only if user enables (default text).
- **Attachments:** photos/files → XR reads/analyzes (respects file-type permissions).
- **Rate limits:** same as desktop.

## Telegram specifics
- Uses Telegram Bot API, long polling or webhook (user self-hosts OR uses XR cloud relay).
- Inline keyboards for approvals/settings.
- MarkdownV2 formatting (bold/italic/code/links) in replies.
- Telegram native reply-threads used to keep multiple sessions separate.

## Discord specifics
- Slash commands `/xr ask`, `/xr budget`, `/xr agents`.
- Runs as a bot user; DMs with XR are private 1:1; server channels opt-in (needs admin setup).
- Ephemeral messages for private info (budget, approvals).
- Buttons/interactions via Discord components.

## WhatsApp specifics
- Via WhatsApp Business Platform or linked device (user pairs their WhatsApp via QR in Settings → Integrations → WhatsApp).
- Plain text replies (WhatsApp doesn't support rich cards); approvals as quick-reply buttons [APPROVE] / [DENY] / [1h].
- Voice note transcription supported.

---

# VS CODE EXTENSION
> XR inside your editor. Copilot-chat style sidebar panel.

## Features
- **Side panel (XR icon in activity bar):** compact chat UI (same model as desktop chat, but compact — smaller avatars, smaller bubbles).
- **Code lens:** `💡 XR: explain`, `XR: fix`, `XR: improve` inline hints above functions.
- **Inline chat:** select code, `⌘K` → XR popover appears inline ("Refactor this", "Add tests", "Explain bug").
- **Right-click context menu:** "Ask XR", "Explain this", "Add tests", "Find bugs".
- **Diagnostics integration:** XR adds its own warnings/suggestions inline (as diagnostics provider).
- **Copilot-style inline suggestions** (optional): ghost-text as you type, Tab to accept (toggleable, default off to avoid conflict with other AI extensions).
- **Status bar item:** "XR: local (qwen3.5)" → click to switch model, shows cost today.
- **Theme:** respects VS Code theme (uses VS Code theme tokens — doesn't enforce XR dark; accent color maps to VS Code's `list.activeSelectionBackground` or configurable to XR cyan).

## Commands (command palette: XR: ...)
- Open chat, Ask XR about selection, Explain selection, Fix selection, Start voice chat, Switch model, Show budget, Toggle inline suggestions.

## Architecture
- VS Code extension (TypeScript), runs in extension host.
- Connects to XR desktop daemon (if running) over localhost WebSocket; if daemon not running, can run standalone with its own config (but shares daemon for consistency).
- Code diffs applied via WorkspaceEdit; previewed before apply.

## Auth
- Uses same login as CLI/desktop (reads config from `~/.xr/`), no separate sign-in. If no config, asks for API key or directs to desktop app to set up.

---

# MOBILE PWA (companion, not full desktop clone)
> Phone/tablet companion for chat, approvals, budget, memory. Not a coding surface.

## Screens (mobile-only, simplified)
1. **Chat list + conversation** (mobile stacked layout — list ↔ chat view slide)
2. **Approvals** (push notifications → approval card with Approve/Deny buttons)
3. **Budget quick-view** (spent/total, raise-limit buttons)
4. **Voice session** (big orb center, talk to XR, hands-free while driving/walking)
5. **Agents** (pick agent, start run, view status)
6. **Settings** (theme, model, integrations, logout)

## Layout
- No sidebar; bottom tab bar (Chat / Voice / Approvals / Settings) — 4 tabs.
- Stack navigation; slide transitions (iOS-native feel).
- Composer at bottom, full-width, same theme tokens.
- Touch targets min 44px.
- Dark/light/theme syncs with system by default, or manual.
- Works offline (read cached conversations; queue sends for when online).
- Installs to home screen (PWA manifest), standalone display, splash screen with XR logo.
- Push notifications for approvals/messages via Web Push (encrypted).

## What's NOT on mobile
- Builder/Monaco editor (coding stays on desktop).
- Memory graph (list only).
- Workspaces management (view only).
- Skills store (view installed only, install via desktop).

## Tech
- React + Vite PWA, responsive design, tailwind same tokens, service worker for offline.
- Talks to same backend daemon via `wss://` when on same LAN or via cloud relay (end-to-end encrypted) when away.

---

# GLOBAL CROSS-CUTTING SPECS

## Scroll behavior
- **Virtualized long lists:** session list, runs table, audit log, memory list, skills grid → use `@tanstack/react-virtual`.
- **Chat auto-scroll:** only when user is near bottom (120px threshold); "scroll to bottom" floating button otherwise.
- **Scrollbars:** 8px width, thumb `var(--text-tertiary)/20`, transparent track, hide when idle on macOS (native overlay style).
- **Smooth scroll:** default `scroll-behavior: smooth`; reduced-motion users get instant.

## Empty states (universal rules)
Every empty state must:
1. State what's missing in plain language (no jargon).
2. Explain why (if non-obvious).
3. Provide exactly one primary action CTA.
4. Include a small, tasteful illustration/emoji (no confetti, no loud graphics).
5. Be 320px max-width, centered in content area, 48px vertical margin above.
6. Never shame ("No data" not "You haven't done anything yet").

## Loading states
- Skeletons for lists/grids/tables (shimmer gradient sweep 1400ms).
- Spinners (braille/circle) for buttons/actions.
- Progress bars for downloads/uploads/long ops (with ETA and % if known).
- Minimum display 400ms to avoid flash of content.
- Streaming UI (chat, research) shows partial content immediately — no blocking skeleton.

## Error states
- Human-readable error (not stack trace to end user; stack trace in dev mode + "copy error" button).
- One actionable recovery suggestion ("Try again" / "Check your internet" / "Open Shield settings" / "Report bug").
- Destructive errors (budget hit, approval denied, shield breach) use semantic color but no panic/alarms.
- Network errors are non-modal (banner top) and auto-retry with backoff; user can manually retry.

## Animation physics (use Framer Motion)
- Spring default for entrances/UI: `stiffness: 380, damping: 28, mass: 1`.
- Spring for modals: `stiffness: 400, damping: 30`.
- Ease-out for linear transitions (color, bg, height): 200ms `cubic-bezier(0.22,1,0.36,1)`.
- Avatar breathing: `repeat: Infinity, repeatType: "mirror", ease: "easeInOut", duration: 4`.
- Shimmer: `linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)` animated x -100%→100% over 1400ms.
- Respect `prefers-reduced-motion`: disable all non-essential animation (fade only, no spring bounce, no pulse, no drift).

## Sound (optional, off by default)
- Subtle UI sounds via Web Audio API (synthesized tones, no audio files) for: approval needed (soft chime), error (low blip), success (short note), wake activate (chime up), wake deactivate (chime down).
- Volume slider in Voice/Notifications settings; respects system volume and "Do Not Disturb".
- Sound is off by default; users enable in onboarding or settings.
- Never play sound without visual state (accessibility).

## Typography (reminder, all screens)
- **UI:** Inter variable, 13-15px body, 11-12px meta/uppercase labels (tracking +0.06em uppercase).
- **Code:** JetBrains Mono, 12-13px, 1.5 line-height.
- **Wordmark only:** Orbitron (XR logo, splash, boot).
- **Headings:** 18/24/32/48px sizes (Major Third scale).
- Line-height: 1.5 body, 1.3 headings, 1.6 long-form (research reports).

## Icons
- **Lucide React** 1.5px stroke, 18-20px default size, color `currentColor`.
- **Custom XR icons:** X logo, sentinel head (SVG in components/Brand), budget orb, trust shield — stored as React SVG components in `src/components/icons/`.
- **Brand icons (Gmail, GitHub, Slack etc.):** Simple Icons (or custom SVGs in `src/components/icons/brands/`), color-respecting.

## Notifications
- In-app Sonner toasts (bottom-right, default 4s, persistent for critical).
- OS-level notifications when window unfocused (via Tauri notification plugin).
- Push notifications for mobile PWA (Web Push, e2e encrypted).
- All notifications include action buttons where relevant (Approve/Deny, View).

## i18n
- Strings externalized via `react-i18next`. English default, Urdu (Pakistan) bundled next, other languages via community contribution.
- RTL support for Urdu/Arabic (mirrors layout, flips sidebar to right).

## Performance budgets
- Initial main window paint < 1.5s on M3 Pro.
- Time to interactive (chat usable) < 2s after splash.
- Memory idle < 200MB (main window); with local model loaded additional to Ollama process.
- Animations 60fps on integrated graphics; fall back to reduced motion if frame rate drops < 30fps for 2s.
- List virtualization for any list > 100 items.
- Code splitting per screen (React lazy + Suspense).

## Security (all screens must)
- Never log API keys/PII to console or disk.
- File access sandboxed to workspace root or approved paths.
- All network routed via egress proxy (when enabled in Shield).
- Approval for any dangerous action (write, shell, send, delete); auto-deny after timeout.
- Audit log records every action; user can export or delete.
- Content Security Policy: no `eval`, no remote scripts (all JS bundled).
- Iframes (Builder preview) sandboxed with `sandbox="allow-scripts allow-forms"` and distinct origin.

## Anti-patterns (explicitly forbidden)
- Fake progress bars / fake typing delays / artificial loading.
- Confetti, party-popper animations for "success" (unprofessional, accessibility issue).
- Overusing cyan glow — glow is for important/active elements only, never on every card.
- Emojis in desktop UI (Lucide icons or unicode symbols only; CLI uses no emoji by default; bots can use emoji when appropriate to the platform).
- Confirmation modals for trivial actions (don't confirm "delete chat" — use undo toast instead).
- Hiding loading spinners behind fake skeleton content that misleads.
- Disabling scroll (unless in a modal that traps scroll).
- Auto-playing sound without explicit user action.
- Collecting telemetry by default (opt-in only).
- Using cute/anthropomorphic copy ("Oopsie!" "Uh-oh!") — use honest plain language.
- Lying about capabilities (don't claim real-time data if you don't have it; say "I don't know" when you don't).

---

# IMPLEMENTATION ORDER (from master plan — Block 0 / M1 first)

## Block 0 — Foundation (must exist before any screen)
- Tauri v2 project skeleton, React+TS+Vite+Tailwind v4 setup, theme tokens, app shell (sidebar, topbar, routing), Zustand stores, TanStack Query setup, Framer Motion defaults, Sonner toasts, cmdk palette, splash, onboarding wizard, Approval Modal cross-component, XR Avatar React component (7 states), Companion Orb window, Settings screen (theme + general + models basics), Chat screen (basic, streaming, sessions list), local model install (Ollama + Qwen3.5-3B), basic CLI scaffold.
- **Result:** user can install, onboard, chat with local model, switch 5 themes, use orb, approve/deny.

## Block 1 — Trust + Work (M1)
- Shield/Trust Center (status, approvals, audit log, security settings), Budget (overview, settings, hard cap enforcement), Workspaces, Agent/Brain trace view (basic tree + cost), Runs/Control Room, Skills Store (install + quarantine), CLI full command tree, Telegram bot, VS Code extension basics.
- **Result:** trusted agent system, workspaces, skills, traceability, multi-surface.

## Block 2 — Creation (M2)
- Builder 3-pane (Monaco + chat + iframe preview + sidecar dev server), Research (deep research agent + sources panel), Agents (prebuilt + custom + workflow canvas), Memory Explorer (list + graph), Integrations (OAuth), Voice setup + Voice Theater (immersive), Memory auto-write.
- **Result:** build apps, research deeply, orchestrate workflows, voice control.

## Block 3 — Scale (M3)
- Multi-window Tauri, all integrations, Discord/WhatsApp bots, Mobile PWA, Teams/SSO/Compliance (paid tier), telemetry opt-in, plugin SDK, full admin console for Business, advanced CLI features (deploy, init templates).
- **Result:** production-grade, multi-user business offering, mobile companion.

## Block 4+ — Polish & long tail
- Speed, animation refinement, accessibility audit, theme polish, extensive skills in registry, community agent/skill publishing, custom model fine-tuning UI, plugins marketplace curation.

---

# DELIVERABLES INDEX

Companion documents in this repo:
- `xr-DESIGN-SYSTEM.md` — complete color/typography/spacing/component/avatar/motion specs
- `xr-THEME-SYSTEM.md` — **this file's sibling:** 5 themes with tokens and adaptation rules
- `xr-SCREEN-MAP.md` — screen inventory & routing map
- `xr-SCREEN-BRIEFS.md` — **this document:** per-screen detailed implementation specs
- `xr-MASTER-PLAN.md` — roadmap, verdicts (BUILD/BORROW/SKIP), business model, spend caps §13.5
- `xr-MASTER-BUILD-PROMPT.md` — copy-paste master prompt for coding agents (Claude Code/Cursor/Aider)
- `xr-DEEP-DIVE-ARCHITECTURE.md` — 12-part technical deep dive
- `xr-ALL-TOOLS-LIST.md` — 20-category FOSS toolkit
- `xr-v2-blueprint.md` — 18-section SOTA blueprint
- `xr-SIMPLE-GUIDE.md` — simple Urdu/English guide
- `xr-review.md` — initial audit (8.0/10)
