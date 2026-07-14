# XR 3.1A — Accessibility Standards
> Making XR usable by everyone, on every device, with every input method.

Accessibility is not optional. XR ships to developers on Linux/macOS/Windows/Termux, to people using screen readers, to keyboard-only users, to users with color-vision deficiency, to users on slow SSH connections, and to users on braille terminals. These standards apply across every surface (Shell, Control Center, CLI, docs, website).

Target: **WCAG 2.2 AA** as a baseline, with AAA aspirations where feasible.

---

## 1. Universal standards (apply to every surface)

### 1.1 Color is never the only channel of meaning
- Every status, error, warning, and mode indicator pairs color with a **glyph and/or text label**.
  - Green = ✓ + "online"
  - Amber = ! + "pending"
  - Red = ✗ + "error"
  - Cyan = ● + "active"
- This is already the pattern in the TUI; enforce it in the Control Center too (never rely solely on a dot color).

### 1.2 Contrast ratios (minimum)
| Text type | Minimum contrast against background |
|---|---|
| Body text (≥14px regular / ≥11px bold) | **4.5:1** (AA) |
| Large text (≥18px regular / ≥14px bold) | **3:1** (AA) |
| UI components and graphical objects (borders, focus rings, icons) | **3:1** against adjacent colors |
| Text over images/gradients | 4.5:1 where text sits; add a scrim/dark plate if needed |

- XR palette test (against `#0A0A0F`):
  - Cyan `#00D4FF` = 8.2:1 ✅
  - Green `#00FF88` = 12.6:1 ✅
  - Amber `#F59E0B` = 7.6:1 ✅
  - Red `#FF4D4D` = 4.6:1 ✅ (acceptable at 14px+; at 11px use 600 weight)
  - Text-dim `#9CA3AF` = 5.4:1 ✅ on bg `#0A0A0F`
  - Muted `#6B7280` = 4.2:1 ⚠️ fails for 11px regular — must use `#9CA3AF` for small text, reserve `#6B7280` for 12px+ bold
  - Border `#1F2937` = 1.3:1 on bg — this is a *decorative* border, not used to convey meaning (ok)
  - Border-2 `#2D3748` = 1.9:1 — same; focus ring is cyan (10:1+) so it passes.

### 1.3 Keyboard access
- Every interactive element is reachable and operable with keyboard alone.
- **Tab order** follows visual order (left-to-right, top-to-bottom).
- **Visible focus indicator** (cyan glow ring) on every focused element. No `outline: none` without a replacement focus style.
- Standard keyboard conventions are preserved (see Navigation §2):
  - Tab/Shift+Tab moves between controls
  - Enter activates buttons/links
  - Space toggles checkboxes/presses buttons
  - Arrow keys move within menus, lists, radiogroups, tab bars
  - Esc closes dialogs/overlays/menus
  - Ctrl/Cmd+K opens palette everywhere
- No keyboard traps (focus can always leave a component via Tab or Esc).

### 1.4 Focus management
- When a modal opens, focus moves into it and is trapped there until closed.
- When a modal closes, focus returns to the element that opened it.
- After a navigation action (e.g., opening a session), focus lands on a sensible target (the composer or the session content, predictable).
- Skip link: on Control Center, a hidden "Skip to content" link appears as the first tab stop (visible on focus) and jumps past sidebar to main content.

### 1.5 Motion and vestibular safety
- **`prefers-reduced-motion: reduce` is honored.** When set:
  - All transitions collapse to 0ms (instant changes) except a required 20ms fade for state change visibility.
  - Spinner becomes static ("thinking…" label without spin).
  - Pulse/pulsing animations stop.
  - Smooth scroll is disabled (instant jump).
  - Parallax/hover-scale effects disabled.
- No content flashes more than 3 times per second (no seizure risk).
- Animation never blocks interaction (overlays fade in but pointer/keyboard events activate as soon as mounted).

### 1.6 Text and typography
- Base text size is **never smaller than 11px** on web, and is user-scalable (no `maximum-scale=1` in viewport meta).
- User can resize text up to 200% without horizontal scrolling or broken layouts (test at 200% zoom).
- Line height minimum: 1.5 for body text, 1.3 for headings.
- Paragraph spacing (post-on-paragraph margin) is ≥1.5× line height.
- Letter spacing for ALL-CAPS labels ≥0.06em (already spec'd — important for readability).
- No ALL-CAPS for body text; reserved for short labels.
- Monospace font is used for code, IDs, paths, costs, tokens, keybindings — but **proportional font for all prose** (improves dyslexia readability).

### 1.7 Language and plain language
- `lang="en"` set on HTML root; strings are externalized (i18n-ready, even if English-only at first).
- Plain language: short sentences, no jargon without an in-context definition, no "here's the thing:" filler.
- Errors use plain language and explain remediation (see Component §3.11 Error State).
- Every UI element with a non-obvious icon has a tooltip or accessible name.

---

## 2. Control Center (web/dashboard) specifics

### 2.1 ARIA roles and labels
- Landmark regions: `<nav aria-label="Main navigation">` for sidebar, `<main>` for content, `<aside aria-label="Inspector">` for right rail, `<header role="banner">` for topbar, `<footer>` if used.
- Command palette: `role="dialog"`, `aria-modal="true"`, `aria-label="Command palette"`, `aria-activedescendant` for selected item.
- Toast/notifications: `role="status"` (info/success) or `role="alert"` (error/critical) — screen readers announce these live.
- Chat messages: `aria-live="polite"` region for assistant responses; typing indicator announced via `aria-label`.
- Composer: `role="textbox"`, `aria-multiline="true"`, `aria-label="Ask XR anything…"`.
- Status chips: `aria-label` that expands the abbreviation, e.g., "Provider: Ollama, model Qwen 2.5 7B, online."
- Icon-only buttons have `aria-label` (close, send, mic, settings, etc.).
- Sidebar navigation items are in a `<ul>`; current page marked with `aria-current="page"`.
- Tabs: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` pointing to panel id.
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title, `aria-describedby` pointing to body.
- Progress bars: `role="progressbar"`, `aria-valuenow/valuemin/valuemax`.
- Lists (sessions, audit, skills): use `<ul>`/`<ol>`; not div-soup.
- Tables (audit, cost breakdown): `<table>` with `<th scope="col/row">`.

### 2.2 Keyboard bindings (web)
Beyond the universal chords (Navigation §2):
- `Tab` / `Shift+Tab` cycle focus
- `Enter` / `Space` activate
- `Arrow` keys in menus, lists, tab bars, radio groups
- `Home` / `End` jump to first/last item in lists
- `Page Up` / `Page Down` scroll content area
- `Ctrl/Cmd+F` find in page/panel; for global search opens palette prefixed with search
- `/` focuses composer (when not in a text field)
- `?` shows keyboard shortcuts overlay
- `Esc` dismisses

### 2.3 Screen reader experience
Test with NVDA (Windows), VoiceOver (macOS), and Orca (Linux) — at minimum one must be tested per release.
- First visit: after page load, the first tab stop is "Skip to content"; page `<title>` is "XR — Control Center" or more specifically "Sessions — XR".
- Streaming assistant responses: use `aria-live="polite"` so new tokens are announced periodically (not per-token, which is overwhelming). Announce "XR responded" at completion, with response focusable via `Tab`.
- Tool calls: announce "Running command: npm install" when started, "Command completed" when done.
- Approvals: modal receives focus; primary ("Deny") focused by default (safe default); `aria-describedby` includes command preview.
- Status bar chips: textual state is included (not just color).
- Animations: do not trap keyboard focus during enter animation; user can press Esc during fade-in to dismiss.
- Images/logos: decorative images use `alt=""`; meaningful images (avatar used in hero) use descriptive alt text ("XR cybernetic guardian avatar").

### 2.4 Vision accommodations
- High-contrast mode: when `forced-colors: active` is detected (Windows high-contrast), revert to system colors for all chrome (borders, buttons, focus rings).
- Dark mode is the default; light mode is not in 3.1A but CSS must be structured so a light theme can be added without refactor (CSS custom properties make this free).
- Links are underlined (or have non-color underline cue) on keyboard focus; not only on hover.
- Focus ring is a minimum 2px solid cyan with a 1px dark outline (for contrast against light/dark) — visible on all backgrounds.

### 2.5 Motor accommodations
- Minimum hit target size: **24×24px** for buttons; 36×36px recommended for primary buttons.
- No double-click or drag-only actions (drag-drop has an alternative; double-click has a menu alternative).
- Sticky hover disabled on touch (hover states do not "stick" after tap).
- Key repeat rate respected (holding arrow keys scrolls at OS rate).
- Allow users to disable all auto-send / predictive features.

### 2.6 Neurodiversity / cognitive
- No auto-advancing carousels/rotators.
- Timeouts: if any session expires, user gets a warning at 2 minutes, can extend. No invisible timeouts for in-progress tasks.
- Consistent placement of primary actions (primary button bottom-right / right side of dialog; destructive buttons left or clearly separated).
- Undo is available for destructive actions (delete memory, clear session, remove plugin) for 10 seconds via a toast with "Undo."
- Confirmation required for irreversible actions (see Design Philosophy §14 — typed confirmation for the most dangerous, like "disable all approvals").

---

## 3. Shell (TUI) accessibility

Terminal accessibility is underdiscussed; XR treats it as a first-class concern.

### 3.1 Terminal compatibility matrix
| Terminal capability | XR behavior |
|---|---|
| True color (24-bit) | Full palette, glows, subtle bg tints |
| 256 color | Map semantic colors to nearest 256-palette cube |
| 16 color | Use basic ANSI colors (cyan/green/yellow/red/white/dim) |
| Monochrome | Use typographic weight (bold/dim) and glyphs only; no color |
| No alternate screen (`?1049h` unsupported) | Fall back to inline scrolling TUI (like `less`-style); don't crash |
| No mouse | Keyboard works (always does) |
| Bracketed paste | Supported (paste detection); no fake-indent injection |
| OSC 52 clipboard | Copy to system clipboard from TUI where terminal supports it (yanks key/action) |
| Sixel/iTerm inline images | Render the XR logo/avatar as image on startup if supported; ANSI fallback otherwise |
| Screen/tmux | Avoid problematic escapes; no direct cursor addressing outside alternate screen; respect `$TERM` |
| Slow SSH/high latency | Reduce redraw frequency (damage regions), batch ANSI, avoid re-clearing screen every frame |

### 3.2 Screen readers in terminal
- Emacspeak, Orca terminal reader, and VoiceOver (Terminal/iTerm2) read terminal output linearly. Therefore:
  - Do not draw decorative Unicode spans that read as "box drawing vertical" on every line. Use box-drawing characters sparingly and only where they convey structure (headers, dividers).
  - Every interactive list item has a label that reads cleanly (e.g., "1. Sessions, 3 unread, 1 running" — not "│ ● sessions  3 │").
  - Status bar is one line, last line, with fields separated by a clear delimiter ("│" with surrounding spaces reads as "pipe"; using " · " reads as "dot" and is cleaner).
- When `$TERM` is `dumb` or output is not a TTY, output plain text (no ANSI codes, no spinners, no full-screen), ready for parsing.

### 3.3 Keyboard
All keyboard bindings in the Shell are listed in Navigation §2. Critical accessibility rules for TUI:
- Every keybind is discoverable via `?` and listed in command palette.
- Emacs/readline bindings work in the composer (Ctrl+A/E/K/U/W/P/N) — this is essential for users who rely on these for motor/AT reasons.
- There is a "Sticky keys" mode where chorded keys (g+<key>) can be pressed sequentially with a timeout (5 seconds by default), configurable.
- Escape timeout is 100ms (not shorter, to avoid breaking Alt/Meta bindings; not longer, to feel responsive).

### 3.4 Reduced motion in terminal
When `NO_COLOR=1` is set OR user has toggled reduced motion in Settings:
- Spinners become static "working…" labels
- Startup animation shows one frame (final brand frame) without progression
- No blinking cursor (solid block)
- No glow/bg color fills

`NO_COLOR=1` convention (https://no-color.org/) is respected: disables color entirely; output uses bold/dim and glyphs.

### 3.5 Text size and density
- TUI respects terminal font size (we cannot change it), but:
  - Layout scales with terminal size; at narrow widths (≤90 cols), switch to compact density; at ≤80 cols, single-column.
  - Never output lines that wrap mid-word or produce stray newlines because content is hard-coded wide.
- Provide a **density setting**: compact (less vertical padding, 28-char rows), default (36), cozy (44).

### 3.6 Colorblind safety
- Protans/protanopia (red-blind): reds appear dimmer. Critical red states must also use ✗ and "error" text label.
- Deutans (green-blind): green/red confusion is common; green ✓ vs red ✗ differ in shape; never rely on green-vs-red alone.
- Tritans (blue-yellow): cyan-vs-violet brand gradient is distinguishable to most tritans (hue difference 120°+).
- Provide a **"High-contrast / accessible" palette** option in Settings that replaces green/red with more saturated/differentiated hues and adds text labels wherever color is used.

### 3.7 Braille and TTS
- Avoid relying on Unicode symbols that screen readers mispronounce (e.g., ⛨ is read as "black cross on shield" or worse). Always pair icons with text labels in core UI; allow hiding icons (text-only mode for TUI).
- The "text-only mode" setting removes all decorative glyphs and replaces them with text labels: `[OK]`, `[WARN]`, `[ERR]`, `[RUN]`, `[LOCAL]`, `[CLOUD]`.

---

## 4. CLI accessibility

The CLI is the most accessible surface because plain text is universal. Rules:
1. **Non-TTY output (piped/redirected) is plain text.** No ANSI codes, no spinners, no progress bars that overwrite lines. Errors go to stderr; data goes to stdout.
2. `--json` flag produces machine-readable JSON on stdout (one object or NDJSON for streaming), suitable for consumption by other tools, screen readers, or braille displays.
3. `--quiet` suppresses all non-essential output.
4. Progress bars on TTY become percentage lines on non-TTY ("Progress: 47%").
5. Interactive prompts detect non-TTY and fail with a descriptive error (not hang waiting for input).
6. Help text is organized into sections and fits within 80 columns; no line longer than 80 chars.
7. Every command returns a meaningful exit code (0 success, 1 general error, 2 invalid usage, 3 network/auth, 4 security/denied).

---

## 5. Website and docs accessibility

The marketing site and documentation must also meet WCAG 2.2 AA:
1. Semantic HTML (`<nav>`, `<main>`, `<h1>`–`<h6>` in order, never skip heading levels).
2. Skip-to-content link.
3. Images have descriptive alt text; decorative images alt="".
4. Form labels associated with inputs; no floating-label-only pattern that disappears on focus.
5. Color contrast meets §1.2.
6. Keyboard navigation works for all navigation and CTAs.
7. `prefers-reduced-motion` disables Framer Motion animations (wrap motion components with reduced-motion check).
8. No autoplay audio/video.
9. Links have discernible text (not "click here," not raw URLs).
10. Focus ring visible.
11. Mobile tap targets ≥44×44px.
12. Hero text must pass contrast over any background imagery (dark plate/gradient is acceptable).

### Docs (future `/docs` section)
- Docs are navigable by keyboard; sidebar links have visible focus; search is keyboard-accessible.
- Code blocks have copy buttons with descriptive labels.
- Anchors on every heading.
- "On this page" TOC for long pages.

---

## 6. Voice accessibility

Voice modality has its own accessibility concerns:
1. Voice wake word is off by default; push-to-talk is the default (respects users who don't want always-listening for privacy/cognitive load reasons).
2. Audible feedback confirms when XR starts and stops listening (subtle chime, configurable).
3. Dictated text appears in the composer before sending, so user can edit/approve — XR never sends voice input without explicit send action.
4. Responses can be spoken aloud (TTS) or shown in text; TTS is off by default and has adjustable speed.
5. Voice mode has a visible indicator (mic icon red, "listening" label) so deaf/HoH users can see state.
6. Voice does not suppress the text UI (never replaces visual output — it augments).
7. Wake word false positives are rejected in favor of false negatives (don't wake up randomly); allow user to retrain wake sensitivity.

---

## 7. Testing requirements

Each XR 3.1A release must be tested against:

1. **Automated checks**
   - Dashboard: axe-core runs in CI against a headless render of each route; 0 critical/serious violations.
   - Color-contrast check in CI for all component states.
   - TTY/non-TTY smoke tests to ensure CLI output is clean when piped.

2. **Keyboard-only testing**
   - Every primary user journey (see User Journeys doc) completed using only keyboard in both Shell and Control Center.

3. **Screen reader spot checks**
   - VoiceOver (Safari, macOS): all major flows
   - NVDA (Firefox, Windows): palette, chat, approval, settings

4. **Terminal accessibility**
   - Tested in: iTerm2, Terminal.app, Ghostty, WezTerm, Kitty, Alacritty, Windows Terminal, tmux, screen, basic Linux console (`$TERM=linux`), `$TERM=dumb`, and piped output.
   - Tested with `NO_COLOR=1`.
   - Tested over SSH (200ms simulated latency).

5. **Zoom and responsive**
   - Dashboard at 200% browser zoom, no horizontal scroll, all content accessible.
   - TUI at 80×24, 120×40, 200×60 terminal sizes.

6. **Color vision**
   - Simulate protanopia, deuteranopia, tritanopia (Chrome DevTools/Coblis); all statuses distinguishable.

7. **Reduced motion**
   - With `prefers-reduced-motion: reduce`, every motion is removed or shortened; product remains fully functional.

8. **Internationalization**
   - All UI strings are externalized (i18n file) — initially English only, but structure ready for translation.
   - Text direction (RTL) is considered for future support (logical CSS properties — `padding-inline-start`, `margin-inline-end` — used in new CSS).

---

## 8. Settings affordances

XR Settings → General exposes:
- **Density:** Compact / Default / Cozy
- **Motion:** Full / Reduced / None
- **Color:** Standard / High-contrast / Accessible (colorblind-friendly) / Monochrome (text-only in TUI)
- **Font size** (web): Small/Default/Large (12/14/16px base)
- **TUI icons:** Default / Text-only labels
- **Keyboard layout:** Standard / Sticky-chords (for motor accessibility)
- **Screen-reader mode** (web): announces updates at configurable verbosity (concise/normal/verbose), disables per-token live announcements, adds "Response ready" summary after each message.
- **Sound:** On/Off (default off; audible chime for critical events when on)
- **Autoplay TTS:** Off by default.

These settings persist per user (in `~/.xr/config.json`) and apply across surfaces.

---

## 9. Legal and policy alignment

- EU Accessibility Act (EAA) — XR as a developer tool used within the EU needs to meet WCAG AA for the consumer-facing website; good-faith effort for the developer tool.
- US Section 508 — similar.
- Our commitment goes beyond compliance: an accessible terminal AI tool is a more powerful tool for everyone.
