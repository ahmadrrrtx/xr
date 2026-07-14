# XR 3.1A — Navigation Architecture
> How the user moves through XR across every surface.

This document specifies the navigation model: what actions are reachable from where, with what keys, in how many steps. The goal is that a user who learns XR once can use every surface without reorientation.

---

## 1. The Four Universal Navigational Primitives

Every surface must support these four primitives. They are muscle-memory fundamentals.

### 1.1 Composer (always accessible)
- **What:** The single input for telling XR what to do.
- **Where:** Bottom of Shell; bottom of Control Center; stdin in CLI; text field in VS Code; voice activation.
- **How to focus:**
  - Shell: `/` key from anywhere (like Vim) focuses the composer; also the composer is always focused when no overlay is open and no other input has focus.
  - Control Center: `/` focuses the composer from anywhere except when typing in another input; also clicking the composer.
  - CLI: stdin is the composer.
- **What it accepts:** natural language, slash commands, @-mentions, #-tags, pasted text, pasted images (where supported).
- **When blocked:** during modal confirmations (user must respond to the modal first). Never blocked by panel navigation or palette.

### 1.2 Command Palette (Ctrl/Cmd+K)
- **What:** Universal action search.
- **Where:** Every surface.
- **Activation:** `Ctrl+K` (Linux/Win), `Cmd+K` (Mac), `Ctrl+Shift+P` (alias for VS Code muscle memory).
- **Contents:** every navigable destination, every command, every setting, recent sessions, recent workspaces, installed skills.
- **Result:** Either navigates, toggles, or executes — never opens a second modal.
- **Keyboard in palette:**
  - `↑`/`↓` move selection
  - `Enter` executes selected
  - `Esc` closes (no action)
  - Type to fuzzy-filter
  - `Ctrl+N`/`Ctrl+P` alias up/down
  - Shown right-aligned next to each item: its keybinding (if it has one), so users learn shortcuts.
- **Sections in palette (in order):**
  1. Recent (sessions, workspaces used this week)
  2. Commands (slash commands for current context)
  3. Navigation (go to a panel/surface)
  4. Skills (matching installed skills)
  5. Settings (matching settings)

### 1.3 Status Bar (always visible)
- **What:** Ground-truth strip of current state.
- **Where:**
  - Shell: bottom 1-line status bar, always visible
  - Control Center: top-bar chips (left of the window controls in the topbar)
  - CLI: first line of interactive output; exported as `XR_STATUS` JSON if `XR_STATUS_JSON=1`
- **Contents (left → right):**
  1. **Connection dot** (green = local, amber = cloud, with split indicator when hybrid)
  2. **Workspace** (click → switcher)
  3. **Session** (current session title; click → session picker)
  4. **Mode** (`agent`/`plan`/`ask`; click → mode switcher popover)
  5. **Provider / Model** (e.g., `ollama · qwen2.5:7b`; click → model picker popover)
  6. **Spend** (session cost / today's cost; click → budget panel)
  7. **Tokens** (session tokens; shown in compact view only)
  8. **Activity indicator** (spinner when running; idle when not; click → activity panel)
  9. **Audit chain status** (green ✓ / amber ! / red ✗; click → audit panel)
  10. **Notifications bell** with unread count
- Every chip is clickable/keyboard-activatable and opens a focused popover (NOT navigates away).
- Color semantics match the semantic colors in the design system.

### 1.4 Escape (Esc)
- **Universal behavior, priority-order:**
  1. If a modal is open → close it (and cancel any destructive action that hasn't been confirmed).
  2. If a popover/palette/menu is open → close it.
  3. If a streaming response is in progress → interrupt generation (keeps partial response, same as Ctrl+C).
  4. If a non-primary panel (inspector, right rail, sidebar on mobile) is focused → collapse it and return focus to composer.
  5. (Shell only) If at top level with nothing open → prompt "Exit XR? (y/N)" — double Esc or explicit `y` confirms exit.
- **Never** exits the application instantly.

---

## 2. Global keybinding specification

These bindings work in **Shell** and **Control Center** identically, except where noted. All are user-customizable in Settings → Keyboard Shortcuts.

### 2.1 Universal chords (same in all surfaces)

| Binding | Action |
|---|---|
| `Ctrl/Cmd+K` | Open command palette |
| `Ctrl/Cmd+,` | Open Settings |
| `Ctrl/Cmd+/` or `?` | Show contextual help overlay |
| `Esc` | Dismiss / interrupt (see §1.4 priority) |
| `Ctrl+C` | Interrupt generation / cancel current action; clears palette input when palette open |
| `Ctrl+L` | Clear current session view (keeps history; same as `/clear`) |
| `/` | Focus composer (if another input isn't focused) |
| `Ctrl/Cmd+Shift+P` | Command palette (alias for VS Code muscle memory) |

### 2.2 Go-to mnemonics (g + key, matching Gmail/Linear/Lazygit)

Press `g` then a second key within 1 second (a "g-chord").

| After `g`: | Goes to |
|---|---|
| `g` `d` | Dashboard / Overview |
| `g` `c` | Chat (current session) |
| `g` `s` | Sessions |
| `g` `w` | Workspaces |
| `g` `r` | Research |
| `g` `m` | Marketplace / Skills |
| `g` `p` | Plugins |
| `g` `b` | Budget |
| `g` `a` | Audit log |
| `g` `x` | Shield / Security |
| `g` `.` | Settings |
| `g` `n` | Notifications |
| `g` `t` | Activity / Timeline |

Mnemonics are chosen for memorability (d=dashboard, c=chat, s=sessions, w=workspaces, r=research, m=marketplace, p=plugins, b=budget, a=audit, x=shie[X]ld, .=settings (familiar from many editors)).

### 2.3 In-composer bindings

| Binding | Action |
|---|---|
| `Enter` | Send / run task |
| `Shift+Enter` | New line in composer |
| `Up` / `Down` (when composer single-line or cursor at edge) | Navigate input history |
| `Ctrl+P` / `Ctrl+N` | Previous/next history entry (readline) |
| `Ctrl+A` / `Ctrl+E` | Beginning/end of line |
| `Ctrl+U` | Kill to beginning of line |
| `Ctrl+K` | Kill to end of line |
| `Ctrl+W` | Kill word backward |
| `Alt+B` / `Alt+F` | Back/forward word |
| `Ctrl+X Ctrl+E` | Open $EDITOR to compose (Shell) / open multi-line editor modal (Control Center) |
| `Tab` | Autocomplete current slash command, @-mention, or path |
| `Shift+Tab` | Cycle approval/permissions mode (Manual → Plan → Auto) — Claude Code parity |
| `Ctrl+V` / `Cmd+V` | Paste from clipboard; in Control Center and modern terminals (OSC 52) supports images |
| `Alt+P` | Switch model (opens model picker popover) |
| `Alt+T` | Toggle extended thinking |
| `Alt+O` | Toggle fast/standard mode |
| `Ctrl+B` | Background current task (returns to composer immediately) |
| `Ctrl+X Ctrl+K` | Kill all background tasks (double-tap confirmation) |
| `Ctrl+T` | Toggle task checklist / plan visibility |
| `Ctrl+O` | Toggle transcript/tool-call viewer (expands all tool calls) |

### 2.4 Shell-specific bindings

| Binding | Action |
|---|---|
| `h` `j` `k` `l` | Vim navigation between panels (when composer not focused) |
| `Tab` / `Shift+Tab` | Cycle focus between sidebar → main → inspector |
| `Ctrl+W` | Workspace picker overlay |
| `Ctrl+N` | Notification center overlay |
| `Ctrl+J` | Quick actions overlay |
| `1`…`9` | When sidebar focused, jump to Nth section |
| `Ctrl+R` | Reverse search in history (in composer) |
| `Ctrl+D` (on empty input) | Exit (with confirmation) |
| `PgUp/PgDown` | Scroll main pane |
| `/` in lists | Filter/search within current list |
| `q` | Close current overlay / step back in drill-down (k9s-style) |

### 2.5 Control Center-specific bindings

| Binding | Action |
|---|---|
| `Ctrl/Cmd+F` | Find within current view (incremental search) |
| `Ctrl/Cmd+Shift+F` | Global search across sessions/memory/audit |
| `[` `]` | Previous/next session |
| `Ctrl/Cmd+\`` | Toggle Control Center dev tools (user-accessible inspector of XR state for power users) |
| `Ctrl/Cmd+Shift+K` | AI command search (natural-language to action) |
| `Ctrl/Cmd+Shift+E` | Export current session/research |
| `J` `K` (Vim mode) | Navigate lists when focused |
| `Alt+Click` on panel divider | Maximize that panel |

### 2.6 Reserved for users' muscle memory
The following keys are **never bound by XR** in the Shell, because they have universal terminal meaning that users depend on:
- Ctrl+C (we use it as interrupt, which is the traditional meaning — acceptable)
- Ctrl+D (EOF; we use it for exit on empty input)
- Ctrl+Z (suspend — passes through to shell outside the alternate screen)
- Ctrl+S / Ctrl+Q (XON/XOFF — pass through)

---

## 3. Panel focus model

### 3.1 Shell three-pane focus
The Shell has three focusable columns plus the composer:

```
[ Sidebar ]  [ Main pane ]  [ Inspector ]
                ↓
            [ Composer ]
```

- By default, focus is in **composer**.
- `Tab` / `Shift+Tab` moves focus between columns (Sidebar → Main → Inspector → Composer → Sidebar).
- When focus is in a column, border of that column highlights with a 1px cyan line.
- When focus is in composer, composer gets a cyan focus ring; all other columns return to default border.
- When the user starts typing in any column other than composer, the input is captured as if they typed into the composer (Vim-style "press `i` to insert" is NOT required — any printable character refocuses composer, like in Lazygit).
- `hjkl` and arrow keys move the selection inside a focused column.
- `Enter` on a selected item in Main opens/drills into it.
- `q` or `Esc` steps back out of a drill-down.

### 3.2 Control Center focus
- Follows normal web focus rings.
- Sidebar items are tab-accessible.
- When palette is open, focus is trapped in palette until closed.
- When modal is open, focus is trapped in modal until closed.
- After palette/modal closes, focus returns to the element that opened it.
- Pressing `/` returns focus to composer regardless of where focus is (except when in another text field — in that case, `/` inserts a `/`).

---

## 4. Sidebar / Navigation column

### 4.1 Structure (same order in Shell and Control Center)

The sidebar is identical in structure (labels, icons, order) between Shell and Control Center. Width differs: 22 cells in Shell, 220px in Control Center.

```
[ Brand lockup: XR logo + "XR" label ]

WORKSPACE
 ◉  Dashboard/Overview
 ▸  Chat
 ◌  Sessions
 ▣  Workspaces
 ◈  Status

TOOLS
 ◆  Research
 ⌁  Marketplace (Skills)
 ⚡  Plugins
 ◇  MCP Servers
 ◪  Computer Control

TRUST
 ⛨  Shield
 ≡  Audit Log
 ◉  Budget

ACCOUNT/PREFS
 ··· Settings
```

### 4.2 Sidebar rules
1. **Single active item** at all times (highlighted with 2px cyan left border + subtle cyan bg).
2. **Section headers** are uppercase tiny labels, not clickable.
3. **Collapse** at narrow widths (<22 cells in Shell; <180px in Control Center) to icon-rail: show only glyphs; tooltips reveal label on hover/focus.
4. **Sidebar can be toggled hidden** (Ctrl/Cmd+B in Control Center; not possible in Shell because it's needed for navigation — but at 80 cols the sidebar collapses to a 4-cell icon rail automatically).
5. **Provider pill at bottom of sidebar** shows current provider/model with a green/amber dot; clicking opens model switcher.
6. **"Press ? for help"** hint at bottom (dismissed after user has seen it 3 times).

### 4.3 Drill-down behavior
When a sidebar item has sub-pages (e.g., Sessions → Session detail):
- Main pane navigates into the sub-page.
- Sidebar item remains highlighted (the parent section).
- A breadcrumb appears at top of main pane.
- `Esc` or `q` navigates back up to the parent.

---

## 5. Navigation patterns per area

### 5.1 Lists (sessions, workspaces, audit, memory, plugins)
Lists use these conventions (learn once, use everywhere):
- **Up/K Down/J:** move selection
- **Enter/Space/L:** open / drill into selected item
- **`/`:** filter list in place (filter box at top of list)
- **Esc:** clear filter (if active) or navigate back
- **`g` `g`:** jump to top
- **`G`:** jump to bottom
- **Ctrl+E/Ctrl+Y (Shell) or scroll wheel:** scroll list without moving selection
- **Selection stays visible** during streaming/updates (never jumps out from under the user).
- **Multi-select:** `x` toggles selection on current item (for bulk delete/export); visual checkmark appears.

### 5.2 Drill-down stack (k9s-style)
For hierarchical navigation (workspace → session → tool call):
- Each drill-down pushes a new "view" onto a stack.
- Breadcrumb at top shows full path.
- `q` / `Esc` pops one level.
- There is no concept of "opening in new tab" in the Shell; there is in the Control Center (Ctrl/Cmd+Click or middle-click opens in new browser tab — deep links work).

### 5.3 Overlays vs. panels vs. pages
Three levels of "on-top-of" UI, with distinct behavior:

| Level | Description | How opened | How dismissed | Blocks background? |
|---|---|---|---|---|
| **Popover** | Small attached menu (chips, pickers) | Click/Enter on status bar chip | Click outside, Esc, select item | No (background interactive) |
| **Overlay** | Centered modal-ish panel (palette, notifications, quick actions, workspace picker, confirmations) | Keyboard shortcut or button | Esc, click outside (except confirmations) | Partially (composer still shows; background dimmed) |
| **Modal** | Blocking dialog (destructive confirmation, critical error, onboarding step, first-run) | System-initiated only | Button (or Esc for non-critical) | Yes (full scrim, focus-trapped) |

Rules:
- Modals are used sparingly (Design Philosophy P5).
- Overlays can be summoned while a task is running (palette and notifications are always available).
- Popovers never stack.
- Overlays can stack at most 1 deep (e.g., palette → session select → palette closes).

### 5.4 Workspace switching
- Accessible from: sidebar (Workspaces), palette, Ctrl+W (Shell), status-bar workspace chip.
- Opens the **Workspace Picker overlay** (same as the startup picker):
  - Searchable list of workspaces
  - Active workspace marked with green ●
  - "Create new workspace" option at top
  - Last 5 workspaces in "Recent" section
- Switching is **instant in UI** (optimistic); state loads in background with a small spinner.
- After switch: all panels refresh to new workspace; composer stays focused; current session is either resumed (last session in that workspace) or a new session begins.

### 5.5 Session switching
- Accessible from: Chat header (session title dropdown), palette, Sessions page, `/sessions` command, `g s`.
- Switching sessions **does not interrupt running tasks** — they keep running in background; activity indicator in status bar shows count.
- When returning to a running session, it auto-scrolls to the latest output and a "N new steps since you left" banner appears if the user had scrolled up.

### 5.6 Model/provider switching
- Accessible from: status-bar model chip, Alt+P, `/model`, palette.
- A **model picker popover** appears (NOT a settings page) with:
  - Current provider/model highlighted
  - Favorite models (pinned by user)
  - Available local models (green dot = healthy, latency)
  - Available cloud models (amber dot = needs key; $/1k tokens displayed)
  - Search box at top
  - "Configure providers…" link at bottom → Providers settings
- Switching is instant; applies to the current session and future sessions in this workspace. In-progress generation is **not** interrupted; it finishes with the model that started it (new model applies to next send).

### 5.7 Mode switching (agent/plan/ask)
- Accessible from: status-bar mode chip, Shift+Tab cycles, `/mode`, palette.
- Mode popover shows three options with 1-line descriptions and keyboard shortcut shown.
- Switching modes mid-session:
  - Streaming in agent → switching to plan: completes current response, then next turn is plan.
  - Streaming in plan → switching to agent: asks "Execute the plan?" confirmation.
  - Any mode → ask: immediate, no side effects.
- Mode is shown in composer prompt (`xr [agent] ›`) so the user never mistakes mode.

---

## 6. Startup navigation

The moment `xr` is launched:

1. **Animated brand frame** (≤660ms, 6 frames — shows logo/avatar + boot progress, each frame corresponds to real state: loading config → detecting workspace → loading sessions → connecting default provider → ready).
2. **Workspace/Session picker overlay** (only if: first run, or multiple workspaces and no active session, or user holds Shift on launch).
3. Otherwise: drop straight into **Chat** (last active session, or new session if none) with composer focused, ready to type.
4. The palette is 1 keystroke away (Ctrl+K); help is 1 keystroke away (?).
5. **No loading spinner for >500ms** — the TUI appears and fills in data progressively (skeleton/pending state for lists, spinner only on provider health check).

First run (no config):
1. Animated brand frame.
2. Onboarding modal, 3 progressive cards (Welcome → Mode/Model → Go). Not a long wizard.
3. After onboarding: composer auto-focused with a starter prompt suggestion ("Try: what's in this directory?").

### Control Center startup
1. Browser opens, loads HTML shell (fast — inline HTML, no external deps).
2. Shell renders with skeleton chrome immediately; all data fetches in parallel.
3. Composer focused after first paint (listens for `/` key).
4. Initial navigation: user lands on Chat (or whatever deep link they opened).

### CLI startup
1. `xr "<task>"` → prints 1-line status header, streams task, prints summary footer, exits 0 on success.
2. `xr <command>` → prints output, exits.
3. Never shows TUI chrome unless `--tui` is passed.
4. Piped/non-TTY output: no ANSI colors, no spinners, no animation, pure parseable output (with optional `--json`).

---

## 7. Deep linking (Control Center)

Every view is a URL (see IA §3):
- Opening a URL navigates directly to that view on load.
- Changing panels updates the URL (pushState).
- Back/forward buttons work.
- Cmd/Ctrl+Click on a sidebar item or list item opens in new browser tab.
- Shareable URLs for sessions (`/chat/:id`), research reports (`/research/:id`), audit entries.
- URLs do NOT contain sensitive data (tokens, keys, prompts). Token is stripped from URL after first load and stored in sessionStorage.

---

## 8. Mobile / narrow viewports (future)

Not part of 3.1A, but navigation is designed to collapse gracefully:
1. Sidebar becomes a slide-out drawer (hamburger top-left).
2. Inspector collapses to a bottom sheet, summonable by swiping up on the activity chip.
3. Composer remains pinned to bottom.
4. All g-chord shortcuts remain available via an attached keyboard; palette accessible via pull-down gesture.
5. Telegram bot uses a `/command` menu that mirrors the palette's structure.

---

## 9. Navigation rules, summarized

1. **Composer is always one keystroke away** (`/` focuses it).
2. **Any action is ≤3 keystrokes from anywhere** (either g-chord or palette).
3. **Esc always steps back; never double-exits.**
4. **Ctrl+K always opens the palette, no matter what.**
5. **The status bar is always visible and reflects truth.**
6. **Sidebar structure, order, icons, labels are identical across Shell and Control Center.**
7. **Drill-down stacks are shallow** — maximum 3 levels deep (e.g., Workspaces → Session → Tool Call). After that, use inspector detail panels instead of pushing more views.
8. **List keyboard behavior is identical** in every list (j/k, gg, G, / filter, x select).
9. **Confirmation is required for any destructive action** (delete, clear memory, disable approvals, uninstall skill).
10. **All keyboard shortcuts are user-rebindable** (Settings → Keyboard Shortcuts), with a "Restore defaults" button per section.
