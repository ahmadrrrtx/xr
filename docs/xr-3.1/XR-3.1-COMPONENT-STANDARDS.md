# XR 3.1A — Component Standards
> A catalog of every UI primitive XR uses, specified (but not implemented).

Each component is specified with: purpose, anatomy, states, variants, and behavior. Implementations must exist for **both render targets** (Shell TUI and Control Center web) using the same semantic structure. CLI output uses a subset (no interactive variants; output-only).

This document does not contain code. It defines shape and behavior so any implementation agent (Ink component, React component, terminal renderer) produces the same product.

---

## 0. Cross-cutting rules for all components

1. All interactive components are reachable by keyboard.
2. Every interactive component has a visible focus state (cyan glow + border).
3. All colors use semantic tokens from the design system; never hardcode a hex.
4. Text content uses sentence case ("Save changes" not "Save Changes"), except product proper nouns and title-case section headers that match sidebar labels.
5. Spacing follows the 4px grid.
6. Loading state for any component that fetches data is a **skeleton** (shapes that mimic content) after 150ms. Before 150ms, show nothing (prevents flash-of-spinner).
7. Every component adapts to the three densities:
   - **Compact:** 28px row height, 8px padding, small font (for power users / small terminals)
   - **Default:** 36px row height, 12px padding, standard font
   - **Cozy:** 44px row height, 16px padding, larger font (for presentations, large monitors)
   (Density is a user setting; default = Default.)

---

## 1. Atoms

### 1.1 XR Logo / Wordmark
- **Purpose:** Brand identification.
- **Anatomy:**
  - **Mark:** The XR monogram (cyan→violet gradient shield-XR). Renders as PNG/SVG in web, ANSI-rasterized in TUI (see `src/ui/brand.ts`).
  - **Wordmark:** "XR" in bold, in logo-mark color.
- **Variants:**
  - **Lockup:** mark + "XR" text + optional tagline ("AI Operating System")
  - **Mark-only:** favicon, sidebar icon, avatar
  - **ASCII fallback:** `▀▄▀ █▀█ / █░█ █▀▄` for 16-color terminals and docs
- **Sizes:** 16px (inline), 24px (sidebar header), 48px (empty states), 96px (hero/startup), 192px (onboarding).
- **Never:** rotate, skew, recolor, add drop shadows, or place on busy backgrounds without a solid dark plate.

### 1.2 Status Dot
- **Purpose:** Small binary/state indicator.
- **Anatomy:** 6–8px solid circle.
- **Colors:** green (online/safe/intact), amber (warning/pending/degraded), red (error/offline/broken), cyan (active/streaming/local-with-attention), gray (disabled/off).
- **Optional pulsing animation** for streaming/loading (opacity 0.4 → 1 → 0.4 over 1.4s).
- Never used alone for critical state — always paired with text.

### 1.3 Badge
- **Purpose:** Small categorical label.
- **Anatomy:** 2px 6px padding, 4px radius, 500–600 weight, 11px mono font, colored bg @ 12% opacity with matching fg color.
- **Variants:**
  - `cyan` (default, brand)
  - `green` (success/local/verified)
  - `amber` (warning/cloud/pending/beta)
  - `red` (error/danger/broken)
  - `gray` (muted/neutral)
  - `violet` (premium/official skill)
- Optional: icon prefix (11px glyph, same color as text).
- **In TUI:** rendered as `[label]` in ANSI color; no background fill unless 24-bit color supported.

### 1.4 Button
- **Purpose:** Trigger an action.
- **Anatomy:** Label (verb or verb+noun), optional leading icon, optional trailing shortcut (e.g., `⌘K`).
- **Variants:**
  - **Primary:** cyan bg (#00D4FF), near-black text (#001018), 8px radius, 7px 14px padding, 600 weight. Used for the main action on a screen/surface (one per surface).
  - **Secondary/Ghost:** transparent bg, 1px border `--xr-border`, text-dim. Hover: border cyan, text cyan.
  - **Danger:** transparent bg, 1px border rgba(255,77,77,.3), text red. Used for delete/remove/clear.
  - **Link:** no border, no bg, cyan text, 4px padding. Used for tertiary actions ("Cancel," "Learn more").
  - **Icon-only:** 28×28/32×32/36×36, centered icon, ghost style. Used for toolbar buttons (refresh, close, settings).
- **States:** default, hover (brightness 1.1), active/pressed (brightness 0.9, translate 1px), focus (cyan glow), disabled (opacity 0.4, no pointer events), loading (spinner replaces icon/text, disabled).
- **In TUI:** rendered as `[ Label ]` in cyan (primary) or dim (ghost) with surrounding brackets and highlighted on selection.

### 1.5 Text Input
- **Purpose:** Single-line text entry.
- **Anatomy:** 1px border, 8px padding, 8px radius, bg `--xr-surface`, text at 13px sans. Caret: 2px wide cyan, blinking 530ms. Optional leading icon, trailing clear button (x).
- **States:** default, hover (border to `--xr-border-2`), focus (border cyan + glow), error (red border + red helper text), disabled (opacity 0.4).
- **Behavior:** supports paste (including images in composer), selection, undo/redo.
- **Labels:** above input, 12px bold, sentence case. Placeholder text uses `--xr-muted`, never as a replacement for labels.
- **Helper text** below input, 11px, `--xr-text-dim` (or red on error).

### 1.6 Textarea / Multi-line input
- Same as text input but supports multiple lines; 8px 12px padding; minimum 2 rows, max 12 rows then scrolls internally.
- Shift+Enter for new line; Enter to submit when used as the composer's inner component (otherwise Enter adds new line — variant-dependent).

### 1.7 Checkbox
- **Anatomy:** 16×16 box, 1px border, 4px radius; check mark glyph when checked in matching color.
- **States:** unchecked, checked (cyan bg, white check), indeterminate (cyan bg, dash), disabled, focus.
- Label to the right, clickable.

### 1.8 Toggle Switch
- **Anatomy:** 36×20 track, 14mm circular thumb.
- **Colors:** off = `--xr-border-2` with gray thumb; on = cyan track with dark thumb.
- **Animation:** thumb slides 120ms ease; track color fades.

### 1.9 Radio / Selector Card
Used primarily for onboarding mode selection.
- **Anatomy:** card with icon/illustration, title, description, radio-style indicator on right.
- 1px default border; cyan border + subtle cyan glow when selected.
- Hover: border `--xr-border-2`.

### 1.10 Spinner
- **Purpose:** Indicate indeterminate progress.
- **Variants:**
  - **Star-burst** (primary): `· ✻ ✽ ✶ ✳ ✢ ·` frames cycling at 120ms per frame, in cyan. Used when XR is thinking/processing.
  - **Dots** (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`): for non-AI loading (fetching data, saving).
  - **Circular** (web): 14px ring, 2px border with cyan top; 700ms linear rotation.
- Always accompanied by a text label ("thinking…", "connecting…", "saving…") when spinner is visible >500ms.

### 1.11 Progress Bar
- **Purpose:** Determinate progress.
- **Anatomy:** Track (bg `--xr-border`, 4px height, 2px radius), fill (cyan gradient, 0–100% width). Optional: percentage label above-right.
- Used for: Ollama model pulls, onboarding steps, audit verification, exports.
- When percentage unknown, falls back to an indeterminate sliding bar (a 30% cyan band sliding across).

### 1.12 Divider
- **Anatomy:** 1px line in `--xr-border`. Can be horizontal (full width, 8px vertical margin) or vertical (full height, 8px horizontal margin).
- Optional label centered in divider (used for section breaks; label is 11px uppercase tracked dim text).

### 1.13 Tooltip
- **Purpose:** Show contextual label/shortcut on hover or focus.
- **Anatomy:** 11px mono/sans, 6px 10px padding, 8px radius, bg `--xr-surface-2`, 1px border `--xr-border-2`. Shortcut shown right-aligned in mono when relevant.
- Delay: 400ms show, immediate hide. Does not appear on touch devices.
- **TUI:** not applicable (no hover); use status bar hints instead.

### 1.14 Skeleton
- **Purpose:** Placeholder while content loads.
- **Anatomy:** Gray blocks (`--xr-surface-2`) shaped like the content they precede (text lines = rounded rectangles at 80%/60%/90% widths; avatar = circle; image = rect). Subtle shimmer animation (a light gradient sweeping across, 1.4s).
- Used in lists, cards, tables during initial load.

---

## 2. Molecules

### 2.1 Composer
- **Purpose:** The universal input (the most important component in XR).
- **Anatomy:**
  - **Mode chip** leading (shows "agent"/"plan"/"ask" — clickable to switch)
  - **Input area** (multi-line textarea, auto-resizes 1–12 lines)
  - **Attachment row** (optional; shows @-file chips, image thumbnails above input when present)
  - **Toolbelt / actions** below input (left: slash `/`, @, attachment, mic; right: Send button with ↑ glyph)
  - **Hint line** (contextual: "Shift+Enter for new line · / for commands · @ to attach"; fades out after 5 messages sent)
- **States:**
  - Idle (placeholder "Ask XR anything, or type / for commands…")
  - Typing (no placeholder)
  - Slash menu open (floating above composer, filtered by typed command prefix)
  - @-menu open (floating above, filtered context items)
  - Busy (Send button replaced by Stop button, input disabled during streaming but user can still type next message)
  - Error (red border, error message below input)
- **Behavior:**
  - `/` typed at start of a word opens slash menu (can also open via button)
  - `@` opens mention menu (files, folders, skills, providers, memory, web)
  - `#` opens tag/modifier menu (#plan, #ask, #deep, #local, #budget, etc.)
  - Paste/drag-drop files and images (web: File API; terminal: bracketed-paste + OSC 52 where supported)
  - Voice button toggles push-to-talk (hold-to-record in TUI; click to start/stop in CC)
  - Messages can be queued: user can type and press Enter while XR is responding; the message sends when current response finishes.
- **Send button:** cyan up-arrow (↑); when busy, becomes a stop square (■).
- **In TUI:** occupies the bottom 3–4 rows; prompt line reads `xr [agent] ›` in cyan + bold.
- **In CLI:** the prompt is the shell prompt; one-shot invocations have no interactive composer.

### 2.2 Message Bubble
- **Purpose:** Display a single message in a session.
- **Anatomy:**
  - **Role indicator:** small avatar/glyph + name ("You" cyan, "XR" green, "System" dim) at top-left.
  - **Timestamp** dim 11px top-right.
  - **Content area** (prose, markdown, code blocks, tool-call embeds).
  - **Meta line** below: model badge, cost, token count, copy/retry/edit/react actions on hover.
- **Variants by role:**
  - **User:** align right, bg rgba(0,212,255,.08), left border 2px cyan, max-width 80%.
  - **Assistant:** align left, bg `--xr-surface`, 1px border `--xr-border`, max-width 90% (prose needs more room).
  - **System:** full-width, no bg, 11px dim italic text, centered in light sessions.
- **Streaming state:** while streaming, the bubble has a blinking block caret (▊) at end and a typing dots indicator in meta.
- **Content:** supports GitHub-flavored markdown (headings, lists, bold/italic, links, images, blockquotes, tables) and code blocks with syntax highlighting.
- **Tool calls** render inline as tool-call chips (see §2.4), not as plain text.
- **Artifacts** (plans, reports, files, diffs) render in their own block within assistant bubbles (see §2.5 Artifact).

### 2.3 Code Block
- **Anatomy:** Header bar with language label (dim), Copy button, optional Run/Apply buttons when applicable; then `<pre>` block with syntax-highlighted code in mono font, 12px size, padding 12px, bg `--xr-surface-2`, border 1px `--xr-border`, 8px radius, word-wrap off (horizontal scroll when needed).
- Long code blocks are collapsed at 24 lines with "Show all N lines" expansion.

### 2.4 Tool Call Chip / Line
- **Purpose:** Show a single tool invocation within a conversation.
- **Anatomy (collapsed — default):**
  - Glyph (⌘ shell, ◈ file, ◇ model, 🔒 approval, ◪ computer, ⌁ plugin/skill)
  - Tool name in bold
  - Truncated args preview (dim)
  - Status indicator (spinner when running, ✓ green done, ✗ red error, ⏸ amber awaiting approval, ⏱ duration dim)
  - Expand chevron on right
- **Expanded:** full command/args, output (mono block, scrollable), duration, tokens used, cost. Shell output is streamed live in expanded view.
- **In TUI:** one line with the same structure; Enter/→ expands in inspector.
- **In CLI:** `◆ tool.name args…` streamed in real time, with ✓/✗ status updates in place.

### 2.5 Artifact Block
- **Purpose:** Render a produced thing (plan, report, code file, diff, chart, table) as an interactive object inside the message stream.
- **Anatomy:** Header (icon, artifact type, title, meta), body (rendered content), footer (actions: Copy, Export, Apply, Open in right panel, Save as file).
- **Variants:**
  - **Plan:** numbered checklist, each step checkable; "Execute plan" button.
  - **Report (research):** structured document with sections, headings, citation superscripts.
  - **File:** syntax-highlighted code file with path header, Apply/Download buttons.
  - **Diff:** side-by-side or unified green/red diff; Accept/Reject buttons per hunk (when approvals on).
  - **Table:** styled data table with sortable columns.
  - **Chart (future):** bar/line/pie via simple SVG; interactive tooltips.
- Artifacts render inline in chat, and also populate the right inspector panel when selected.

### 2.6 Approval Dialog
- **Purpose:** Ask user to approve or deny a risky action. This is a **modal** (blocks execution).
- **Anatomy:**
  - Icon (amber warning shield) + title: "Approve shell command?"
  - Description (why it's needed, in XR's own words)
  - Preview box (mono, 8px 12px padding, bg `--xr-surface-2`, 8px radius) showing full command/action
  - Context row: working directory, workspace, requesting tool/skill
  - Checkbox: "Always allow commands matching `npm test *` in this workspace" (with editable pattern)
  - Buttons (right-aligned): **Deny** (ghost, default-safe), **Allow** (primary, cyan)
  - Also: "Edit command" link to modify before allowing.
- **Shortcuts:** `Esc` = Deny; `Enter` = focused button; `←/→` = cycle buttons; `a` = allow (when nothing focused); `d` = deny.
- **In TUI:** rendered as centered box overlay (same information hierarchy).
- **In CLI:** same content printed to stderr; interactive Y/n prompt with full preview; default to the safer option (Deny if tool is destructive, Allow if read-only).

### 2.7 Notification / Toast
- **Purpose:** Non-blocking confirmation or information.
- **Anatomy:** icon + message + close (×) button. Left colored border (green = success, cyan = info, amber = warn, red = error).
- **Position:** bottom-right (CC) / bottom status area (TUI).
- **Duration:** 2s (success/info), 4s (warn), persistent until dismissed (error and critical).
- Max 3 visible at a time; queue beyond that.
- Clicking a toast can navigate to the relevant place (e.g., budget toast → budget panel).
- **Accessibility:** `role="status"` or `role="alert"` depending on severity; screen readers announce them.

### 2.8 Status Bar
- **Purpose:** Single strip of machine-state truth (see Navigation §1.3).
- **Anatomy (Shell, 1 row at bottom):**
  - Left: connection dot, workspace, session title (truncated), mode.
  - Center: contextual message (when nothing is running: "Type ? for help"; when running: "⚙ running npm test…").
  - Right: provider/model, spend, tokens, audit icon, notification bell with count.
- **Anatomy (Control Center, topbar chips):** same items presented as chips in the top-right cluster.
- Every chip is clickable and opens the corresponding popover.
- **In CLI:** top line of interactive command output, not a persistent strip.

### 2.9 Chip / Pill
- **Purpose:** Small interactive label (in filters, mode pickers, @-mention chips in composer).
- **Anatomy:** Text (often with icon/avatar), optional × to dismiss. 6px 10px padding, 999px radius, bg `--xr-surface-2`, 1px border `--xr-border`, hover bg `--xr-border`, 11–12px.
- Colored variants for status (cyan = active, green = local, amber = cloud, etc.).

---

## 3. Composite components

### 3.1 Card
- **Purpose:** Container for grouped information.
- **Anatomy:** bg `--xr-surface`, 1px border `--xr-border`, 12px radius, 16px padding, optional `--xr-shadow`. Optional header (card-title left, action right), body, optional footer.
- **Variants:** default, glow-cyan/green/amber (colored shadow for active/success/warning states), hero (larger radius 24px, radial glow bg, 24px padding for landing/onboarding).
- **Interactive cards:** hover → border `--xr-cyan/100` + subtle lift; clickable.
- **In TUI:** rendered as box-drawn panel with `┌─ title ─┐ … └─────────┘`.

### 3.2 Sidebar Navigation
- **Purpose:** Navigate between top-level sections.
- **Anatomy:** brand lockup top; section labels (uppercase, 10px, dim) with grouped navigation items; provider pill + help hint bottom. Width: 220px (web) / 22ch (TUI).
- **Nav item anatomy:** leading glyph (16px), label, optional trailing count badge; 7px 16px padding; left border 2px.
- **Item states:**
  - Default: text-dim, left border transparent
  - Hover: bg rgba(255,255,255,.04)
  - Active: bg rgba(0,212,255,.08), cyan text, cyan left border, 600 weight
  - Keyboard-focused: same as hover + cyan ring
- **Collapse:** toggle to icon-rail (glyphs only, tooltips on hover).
- **TUI:** same structure with 2-char prefix glyph and colored selection marker `●/›/○`.

### 3.3 Command Palette
- **Purpose:** Universal action search.
- **Anatomy:**
  - Floating panel, centered top (120px from top), 560px max width, 16px radius, `--xr-surface` bg, `--xr-shadow-lg`.
  - Top: search input with `›` glyph cyan, 14px text, autofocused.
  - Below: results list (max 300px tall, scrollable), divided into sections (Recent, Commands, Navigation, Skills, Settings) with section labels.
  - Each result row: icon, title, description (dim, smaller), trailing keyboard shortcut (mono, right-aligned).
  - Selected row: bg rgba(0,212,255,.08), cyan text.
- **Behavior:**
  - Type to fuzzy-filter instantly.
  - ↑/↓ navigate; Enter executes.
  - Ctrl+N/P alias up/down.
  - Esc closes.
  - Remembers last 5 used commands at top of "Recent" section.
  - Ctrl+K or Ctrl+Shift+P re-opens; closes on click outside.
- **In TUI:** same structure, rendered as centered box overlay; same keys.

### 3.4 List / Table
- **Purpose:** Display collections (sessions, audit entries, files, skills, providers).
- **Anatomy:**
  - Optional header row with column titles (sortable with ↑/↓ indicators).
  - Rows: 36px height default (density-adjustable), hover bg rgba(255,255,255,.04), selected row bg rgba(0,212,255,.08) + cyan left border.
  - Columns align: text left, numbers right, timestamps right.
  - Checkbox or expansion toggle optionally in first column.
- **Behavior:**
  - Arrow keys to move selection; j/k in Vim mode.
  - `/` opens inline filter field at top.
  - `gg`/`G` jump top/bottom.
  - `x` toggles multi-select mark (check mark appears).
  - Enter/double-click opens/drills into item.
  - Pagination (virtualized for >100 rows) or "Load more…" row at bottom.
- **Empty state:** centered message + icon + suggested action button (e.g., "No sessions yet — ask XR something to start one").
- **Loading state:** skeleton rows (5–10).

### 3.5 Tab Bar
- **Purpose:** Switch between sub-views (e.g., Shield tabs: Overview/Processes/Startup/…).
- **Anatomy:** row of tabs; active tab with cyan bottom border 2px and cyan text; inactive tabs dim; hover: text lightens.
- Tabs can be closable (×) when they are sub-pages.
- Keyboard: left/right arrows move between tabs when tab bar has focus.

### 3.6 Modal / Dialog
- **Purpose:** Blocking interaction requiring decision.
- **Anatomy:**
  - Backdrop/scrim: `rgba(0,0,0,.6)` full-screen, fade-in 120ms.
  - Centered panel (max 480/560/680px depending on type), 16px radius, `--xr-surface` bg, `--xr-shadow-lg`.
  - Title (bold 18px) top-left.
  - Body (13px, 1.6 line).
  - Footer: right-aligned buttons (secondary actions left-to-right, primary at far-right).
  - Optional close × top-right (for non-critical modals only).
- **Behavior:**
  - Opens with scale+fade 120ms.
  - Esc closes unless it's a critical confirmation (e.g., "permanently delete memory").
  - Click outside closes unless critical.
  - Tab cycles focus within dialog; focus trapped.
  - Enter triggers primary button (unless in a textarea).
- **TUI:** centered box overlay with same information hierarchy; no backdrop dimming; instead surrounding content is not interactable while overlay is up.

### 3.7 Popover / Picker
- **Purpose:** Lightweight floating panel attached to a control (model picker, workspace switcher, mode switcher, color picker, emoji).
- **Anatomy:** small panel (240–360px), 12px radius, `--xr-surface`, `--xr-shadow`, attached via caret to the source chip/button with 8px gap.
- Contains a list, search field, or small content.
- Closes on click outside, Esc, or selection.

### 3.8 Context Menu
- Purpose: Right-click (or `...` menu) actions.
- Anatomy: 8px radius panel, list of menu items (icon + label + optional shortcut), dividers between groups. Hover: cyan bg 8%. 36px rows.
- Items can be disabled (dim), checked (✓ prefix), or submenu (▶ suffix).

### 3.9 Breadcrumbs
- **Purpose:** Show location in a hierarchy.
- **Anatomy:** sequence of links separated by `›` chevrons. Current page last, dim, not clickable. Each ancestor clickable.
- Example: `XR › Workspaces › default › Sessions › Refactor auth`

### 3.10 Empty State
- **Purpose:** When a view has no content.
- **Anatomy:** centered icon (48px, dim), heading (16px, "No sessions yet"), subline (dim, "Ask XR anything to start a session"), primary action button ("Start your first task").
- Never just says "No X." Always explains what to do next.

### 3.11 Error State
- **Purpose:** When something fails.
- **Anatomy:** red glyph (✗), bold title ("Failed to connect to Ollama"), plain-language explanation (not raw error unless user expands "Details"), one or more remediation buttons ("Start Ollama", "Open Providers Settings", "Copy error"), optional "Details" collapsible showing raw stack/error for bug reports.
- Errors never leave the user stuck. Every error has at least one suggested action.

### 3.12 Workspace Picker
- **Purpose:** Choose or create a workspace.
- **Anatomy (overlay/popover):** search box at top, list of workspaces (active green ●, others ○) with name, path, session count, "Create new workspace" button at bottom (prominent).
- Used at startup, from sidebar, from status bar chip, from Ctrl+W.
- Selected row on open = current workspace.
- Keyboard: ↑/↓/Enter, `/` to filter, Ctrl+N to create new.

### 3.13 Inspector Panel (right rail)
- **Purpose:** Contextual detail for the current selection (tool call, session, artifact).
- **Anatomy:** 280–340px wide panel; collapsible; resizable (drag to resize, snaps at 240/300/360/420); shows content depending on what's selected.
- Sections (stack of cards):
  - Current selection detail (model, tool, file, session)
  - Activity feed (live tail of tool calls/notices)
  - Relevant metadata (cost, tokens, duration, git branch, cwd, memory count)
- If nothing selected: shows "Activity" (all recent events).

### 3.14 Slash Menu (in-composer)
- **Purpose:** Choose a slash command while typing.
- **Anatomy:** Popover above composer, 320px wide, list matching commands. Each item: glyph + name + short description dim. Selected item highlighted cyan.
- Opens when user types `/` at word start or presses `/` key.
- Filters in real time as user types.
- Enter/Tab to select; Esc to dismiss and return to composer.
- Sections by type (Navigation, Modes, Session, Config, Skills-added).

### 3.15 Mention Menu (@-menu)
- Same UI as slash menu but for context attachments: files (showing path + icon), folders, web search, memory entries, skills, providers.
- When selected, inserts a "chip" into the composer (not plain text) that displays the reference and gets attached to the message as context.
- `@file` shows a fuzzy file picker preview; `@folder` shows folder tree; `@web` adds a web-search annotation; `@memory` searches durable memory.

---

## 4. Layout / Shell components

### 4.1 App Shell (Shell/TUI)
Three-pane layout (see Design System §10.1):
- Top header: 2 rows (brand line + context line + divider)
- Body: sidebar (22ch) │ main (flex) │ inspector (28–34ch)
- Divider line
- Composer (3–4 rows)
- Status bar (1 row)

### 4.2 App Shell (Control Center)
- Left: sidebar (220px, collapsible to 48px icon rail)
- Top: topbar (52px) with breadcrumbs/title + top-right status chips + palette button (⌘K)
- Main: content area with 20px padding, scrollable, or chat layout (no padding for chat to maximize space)
- Right: inspector (320px, toggleable).
- Composer (in chat views) pinned to bottom of content area.

### 4.3 Bento Grid
For overview/dashboard: responsive CSS grid, 16px gaps, mix of 1×1 and 2×1 cards; stat cards 4-up on desktop; collapses to 2-up on tablet, 1-up on mobile.

---

## 5. Page templates (prescribe composition)

### 5.1 Overview/Dashboard
- Top: 4 stat cards (Spend today, Security score, Audit chain, Active tasks)
- Row 2: Provider health │ Local AI │ Memory summary
- Row 3: Recent activity │ Computer control status │ Recent sessions
- Sidebar right: system status (from inspector)

### 5.2 Chat/Session
- Full-height chat stream (composer at bottom, inspector right with tool details and current session metadata).
- No padding on chat container (max content width 820px centered with side margins).

### 5.3 List pages (Sessions, Audit, Memory, Plugins)
- Page header (title + description + primary action button right)
- Tabs/sub-filters row
- Stat cards row (counts) optional
- List/table filling remaining space
- Detail panel right (2-pane layout) for selected item, or drill-down to dedicated page.

### 5.4 Settings
- Secondary sidebar with settings sections (General, Keyboard, Providers, Local Models, Budget, Memory, Voice, Trust, Computer Control, Skills & Plugins, MCP, Notifications, Advanced, About); right content area with sectioned form. Each section has a "Restore defaults" button.

### 5.5 Marketplace
- Hero banner (search + filter chips)
- Stats row (Installed, Verified, Updates)
- Three-column shell: category sidebar │ skill card grid │ inspector (skill detail).

---

## 6. Component inventory completeness checklist

Every component in this doc must be implemented for: [ ] Shell TUI, [ ] Control Center web, [ ] CLI (output variants only).

Implementation agents must build each component against this spec and test against the states listed — not invent new variants or omit states.
