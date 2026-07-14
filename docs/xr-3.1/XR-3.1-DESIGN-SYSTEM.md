# XR 3.1A — Design System
> The single source of truth for tokens, typography, color, motion, spacing, elevation, iconography, and voice.

This design system compiles to **three render targets**:
1. **Terminal/TUI** — rendered with ANSI escape codes (RGB when supported; 16-color fallback when not)
2. **Web (dashboard + future web client)** — rendered as CSS custom properties + a small component library
3. **Website (marketing)** — rendered as Tailwind + CSS custom properties, sharing the same core tokens

All three targets read from the **same token definitions**. If a token changes here, all three render targets must be regenerated to match.

---

## 1. Brand Identity

| Attribute | Value |
|---|---|
| Name | XR |
| Tagline | "The AI Agent You Can Actually Trust" |
| Mark | The XR monogram (cyan→violet gradient over shield) — `assets/logo.png` |
| Avatar | Cybernetic guardian visage — `assets/avatar.png` |
| Wordmark-as-ASCII (terminal fallback) | `▀▄▀ █▀█` / `█░█ █▀▄` (two-line) |
| Voice | Precise, concise, technical-warm (see Design Philosophy §3) |

Do not redraw, recolor, or reshape the logo. Do not add drop shadows beyond the existing glow. Do not rotate or tilt. The avatar can be used as a decorative hero element; the monogram is used for lockups, favicon, and nav brand.

---

## 2. Color

### 2.1 Core palette (semantic)

| Token | Hex | Use |
|---|---|---|
| `--xr-bg` | `#0A0A0F` | Page/app background |
| `--xr-bg-2` | `#0D1117` | Slightly raised background (sidebar, topbar) |
| `--xr-surface` | `#111827` | Cards, panels, bubbles |
| `--xr-surface-2` | `#1A2234` | Raised cards, inputs, selected list item |
| `--xr-border` | `#1F2937` | Default borders |
| `--xr-border-2` | `#2D3748` | Hover borders, input focus pre-glow |
| `--xr-text` | `#F9FAFB` | Primary text |
| `--xr-text-dim` | `#9CA3AF` | Secondary text, labels, timestamps |
| `--xr-muted` | `#6B7280` | Tertiary text, disabled, meta |

### 2.2 Accent palette

| Token | Hex | Meaning |
|---|---|---|
| `--xr-primary` / `--xr-cyan` | `#00D4FF` | Primary brand — active views, primary buttons, links, streaming cursor, glows |
| `--xr-violet` | `#A855F7` | Secondary brand — brand gradient end, avatar accents, premium features |
| `--xr-success` / `--xr-green` | `#00FF88` | Success, local mode, enabled, online, audit-intact |
| `--xr-warning` / `--xr-amber` | `#F59E0B` | Warnings, cloud routing, pending approvals, budget near-cap |
| `--xr-error` / `--xr-red` | `#FF4D4D` | Errors, blocked, denied, audit broken, budget breached |

### 2.3 Extended data colors (for charts/graphs; not used in chrome)

| Token | Hex |
|---|---|
| `--xr-data-1` | `#00D4FF` (cyan) |
| `--xr-data-2` | `#A855F7` (violet) |
| `--xr-data-3` | `#00FF88` (green) |
| `--xr-data-4` | `#F59E0B` (amber) |
| `--xr-data-5` | `#60A5FA` (blue) |
| `--xr-data-6` | `#F472B6` (pink) |

### 2.4 Gradients
- **Brand gradient:** `linear-gradient(90deg, #00D4FF, #7AA7FF, #A855F7)` — used for logo, hero text, premium badges only. Never on buttons, never on body text.
- **Shield glow:** `radial-gradient(circle, rgba(0,212,255,.22), transparent 60%)` — subtle halo around active state/avatar.
- **Surface glow (focus):** `0 0 0 1px rgba(0,212,255,.4), 0 0 20px rgba(0,212,255,.15)` — used for keyboard-focused cards and primary inputs.

### 2.5 Color rules
1. **Cyan = "XR is interacting with you."** Use sparingly. If everything is cyan, nothing is.
2. **Red is reserved for things the user must look at now.** Never use red for decorative purposes.
3. **Green = safe / local / ok.** A green dot means "this will not leave your machine and will not cost money."
4. **Amber = attention needed but not blocking.** Pending approvals, near-budget, cloud routing, degraded mode.
5. **Neutrals carry 90% of the UI.** If a screen feels neon, it is wrong.
6. **Light mode is out of scope for 3.1A.** Ship dark-only; design tokens are chosen to work for dark. A light theme is a post-3.1 initiative.

### 2.6 Terminal ANSI mapping
For TUI rendering, map semantic tokens to ANSI as follows:

| Token | 24-bit RGB ANSI | 16-color fallback |
|---|---|---|
| `--xr-primary` | `38;2;0;212;255` | `36` (bright cyan) |
| `--xr-violet` | `38;2;168;85;247` | `35` (magenta) |
| `--xr-success` | `38;2;0;255;136` | `32` (green) |
| `--xr-warning` | `38;2;245;158;11` | `33` (yellow) |
| `--xr-error` | `38;2;255;77;77` | `31` (red) |
| `--xr-text` | `38;2;249;250;251` | `37` (white) |
| `--xr-text-dim` | `38;2;156;163;175` | `37;2` (dim white) |
| `--xr-muted` | `38;2;107;114;128` | `90` (gray) |
| `--xr-border` | `38;2;31;41;55` | drawn with box-drawing characters in default fg |
| `--xr-bg` | background color (if terminal supports it) | not drawn (default terminal bg) |

16-color fallback is engaged when `COLORTERM` is not `truecolor`/`24bit`. In 16-color mode, XR does not draw background fills; it uses border characters and spacing alone.

---

## 3. Typography

### 3.1 Font stack
| Role | Family |
|---|---|
| Monospace (code, TUI, tables, IDs, URLs, timestamps, composer) | `'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', ui-monospace, monospace` |
| Sans (UI labels, headings, body text in dashboard/website) | `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif` |
| Display (website hero headlines only) | `'Syne', 'Inter', system-ui, sans-serif` |
| TUI (implicit) | Terminal's configured monospaced font (we do not choose) |

### 3.2 Type scale (web/UI)
| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--xr-fs-display` | 48px | 1.05 | 800 | Website hero (Syne) |
| `--xr-fs-h1` | 24px | 1.3 | 700 | Page titles |
| `--xr-fs-h2` | 18px | 1.3 | 700 | Section headings, card titles |
| `--xr-fs-h3` | 14px | 1.3 | 600 | Card labels, section subheads (uppercase, tracked +0.06em) |
| `--xr-fs-body` | 13px | 1.6 | 400 | Body copy, most UI text |
| `--xr-fs-small` | 12px | 1.5 | 400 | Secondary lines, meta text |
| `--xr-fs-xs` | 11px | 1.4 | 500 | Captions, timestamps, chip text (mono) |
| `--xr-fs-mono` | 12–13px | 1.5 | 400 | Code, IDs, commands (JetBrains Mono) |
| `--xr-fs-composer` | 14px | 1.5 | 400 | Composer input (sans, large enough for long typing) |

### 3.3 TUI typography
The terminal has one font size (the user's). TUI typography is communicated through weight (bold, dim), spacing (left 2-space indent), and density:
- **Header lines:** bold primary
- **Section labels:** bold primary, tracked by underlines (U+2500)
- **Primary content:** default weight
- **Meta / timestamps / IDs:** dim
- **Numbers/IDs/cost:** cyan or mono weight
- **No italic, no underline except URLs/links** — terminal italic and underline render inconsistently.

### 3.4 Typography rules
1. Body text never goes below 11px on web. 12px minimum for interactive elements.
2. Line length for prose (research reports, docs, long messages) capped at ~72ch.
3. Numbers, IDs, paths, commands, costs, token counts are always set in the monospace font — even in sans body copy.
4. ALL-CAPS styling is reserved for short section labels (3–6 words, tracked +0.06em).
5. The composer font is sans-serif at 14px; but when the user types code (backtick fence), that fragment switches to monospace inline.
6. Do not use the display font (Syne) anywhere in-product. It is marketing-site only.

---

## 4. Spacing (4px grid)

All spacing is multiples of 4px.

| Token | Value | Use |
|---|---|---|
| `--xr-space-1` | 4px | Tight gaps, icon-to-text |
| `--xr-space-2` | 8px | Padding inside chips, badge-to-label |
| `--xr-space-3` | 12px | Card internal padding (compact) |
| `--xr-space-4` | 16px | Standard card padding, section gaps |
| `--xr-space-5` | 20px | Between cards (dashboard grid) |
| `--xr-space-6` | 24px | Section separation, large modal padding |
| `--xr-space-8` | 32px | Page-level padding |
| `--xr-space-12` | 48px | Large viewport padding, hero spacing |
| `--xr-space-24` | 96px | Marketing site section vertical padding |

### TUI spacing
TUI uses a 2-space (2 character cells) horizontal indent for all primary content. Between sections, a single blank line. Horizontal dividers are drawn with U+2500 `─` characters, prefixed by 2 spaces to match content indent. No 4px concept in terminal — character cells are the atomic unit.

### Terminal layout constants
| Constant | Value | Meaning |
|---|---|---|
| `XR_MIN_COLS` | 80 | Minimum supported width; below this, UI collapses to single-pane compact |
| `XR_MIN_ROWS` | 24 | Minimum supported height |
| `XR_COMFORT_COLS` | 120 | Width at which three-pane layout activates |
| `XR_SIDEBAR_W` | 22 cells | TUI sidebar width |
| `XR_INSPECTOR_W` | 32 cells | TUI inspector width (at ≥120 cols), 26 cells at 96–119 |
| `XR_STATUS_H` | 1 | Bottom status bar |
| `XR_COMPOSER_H` | 3 | Composer (prompt + hint + padding) |
| `XR_HEADER_H` | 2 | Top header in TUI |

---

## 5. Radius / Shape

| Token | Value | Use |
|---|---|---|
| `--xr-radius-sm` | 4px | Badges, small chips, inline tags |
| `--xr-radius` | 8px | Buttons, inputs, cards (default) |
| `--xr-radius-lg` | 12px | Large cards, modals |
| `--xr-radius-xl` | 16px | Hero cards, popovers, marketplace skill cards |
| `--xr-radius-full` | 999px | Status dots, pills, toggle handles, avatars |

**TUI:** no radius (impossible). Borders are drawn with box-drawing characters (┌─┐│└─┘) at 8-cell-equivalent radius — that is, hard corners. A softer corner look can be achieved with ╭─╮ on terminals that support it, but is optional.

---

## 6. Elevation / Shadows

Surfaces are flat. XR uses a single glow layer rather than deep shadow stacks — reflecting the HUD/cybernetic aesthetic.

| Token | Value | Use |
|---|---|---|
| `--xr-shadow-sm` | `0 1px 2px rgba(0,0,0,.4)` | Inset controls, pressed state |
| `--xr-shadow` | `0 4px 24px rgba(0,0,0,.4)` | Default cards |
| `--xr-shadow-lg` | `0 12px 44px rgba(0,0,0,.5)` | Modals, palette popover |
| `--xr-glow-cyan` | `0 0 20px rgba(0,212,255,.15)` | Active/focused primary card |
| `--xr-glow-green` | `0 0 20px rgba(0,255,136,.12)` | Success-state card |
| `--xr-glow-amber` | `0 0 20px rgba(245,158,11,.15)` | Warning/pending card |
| `--xr-glow-red` | `0 0 24px rgba(255,77,77,.2)` | Error, security alert |

**TUI:** elevation is communicated by border style (single line, double line, bold) rather than shadow. Active panel = cyan border. Inactive = default dim border. Selected row = cyan background at 8% opacity (if 24-bit color).

---

## 7. Motion

Motion exists to explain state change, not to decorate. Three durations:

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--xr-dur-fast` | 80ms | `cubic-bezier(.4,0,.2,1)` (material standard) | Hover, press, toggle switch, focus ring |
| `--xr-dur-base` | 120ms | same | Panel transitions, palette open/close, toast enter |
| `--xr-dur-slow` | 200ms | `cubic-bezier(.22,1,.36,1)` (entrance) | Modal scale-in, page transition, startup sequence step |

### Motion rules
1. **No motion over 200ms in productivity surfaces** (TUI, dashboard).
2. **Marketing website can go up to 500ms** for hero entrance, but scroll-snapping and parallax are forbidden.
3. **Always respect `prefers-reduced-motion`.** When set, all transitions collapse to 0ms except 20ms color fades.
4. **Spinner animation is 700ms linear rotation** (continuous). Star-burst spinner cycles at ~120ms per frame.
5. **Streaming cursor** is a blinking block (1 blink per 530ms, matching terminal conventions).
6. **Number counters** animate over 600ms with ease-out (for stat cards on dashboard/website).
7. **No bounce, no overshoot, no elastic easing** in product surfaces. Precision is brand.

### TUI motion
TUI animates via successive redraw frames. The only animations are:
- Startup sequence (6 frames @ 110ms — ~660ms total) with progressive logo/avatar reveal.
- Spinner glyph cycling (every 120ms, only when XR is busy).
- Progress bars advancing during long operations.
- **No other animation in the terminal.** No sliding panels, no fade.

---

## 8. Iconography

XR uses **one** icon system per surface, no mixing.

### 8.1 TUI/dashboard shared icon set (preferred: Lucide or equivalent 1.5px-line set)
We will standardize on a single line icon set (Lucide is recommended: MIT, consistent weight, broad coverage). Every icon is 16×16 in web, 1 cell in terminal (Unicode glyph fallback).

### 8.2 Semantic icon vocabulary (canonical)
These icons are used *everywhere* for the same meaning. Do not substitute:

| Concept | Unicode glyph (TUI fallback) | Lucide icon (web) |
|---|---|---|
| Dashboard / Home | `⬡` (U+2B21) | `hexagon` or `layout-dashboard` |
| Chat / Composer | `›` (U+203A) as primary prompt glyph; `▸` for message | `message-square` |
| Sessions / History | `◌` (dotted circle) | `history` |
| Workspaces | `▣` (square with dots) | `folders` |
| Status / System | `◎` (bullseye) | `activity` |
| Budget / Cost | `◈` (diamond) | `dollar-sign` or `wallet` |
| Provider / Cloud | `☁` | `cloud` |
| Model / AI | `◇` | `cpu` or `sparkles` |
| Memory | `◉` (filled circle) | `brain` (if available, else `database`) |
| Research | `◆` (filled diamond) | `search` or `book-open` |
| Plugins | `⌁` (lightning in U+2301) | `zap` |
| Skills | `⬢` (hex filled) | `puzzle` or `star` |
| Voice / Mic | `🎤` | `mic` |
| Shield / Security | `⛨` (shield cross U+26E8) | `shield` |
| Audit / Log | `≡` | `scroll-text` or `file-text` |
| Settings | `· · ·` (three dots in mono) | `settings` |
| Success / OK | `✓` | `check` |
| Warning | `!` | `alert-triangle` |
| Error / X | `✗` | `x-circle` |
| Info | `·` | `info` |
| Running / Spinner | `⟳` or star-burst | `loader-2` |
| Local / Private | `⬢` (green) | `lock` |
| Terminal / Shell | `▸` (small right tri) | `terminal` |
| Computer Control | `◪` | `monitor` |
| Notifications | `◌` (ring) | `bell` |
| Command Palette | `⌘` | `command` |
| Search | `∕` or `/` | `search` |
| Send | `↑` | `send` (arrow-up) |

### 8.3 Icon rules
1. **No emojis in chrome.** Emojis are reserved for user-generated content and the AI's message content (where appropriate). Chrome uses the canonical glyph set.
2. **Same glyph, same meaning, everywhere.** If the dashboard uses a shield icon for Security, the TUI uses `⛨` for Security, the website uses the shield icon for Security.
3. **Status dots are solid circles, 6px diameter**, with green/amber/red/cyan semantic color. Used for: provider state, connection state, audit chain state.
4. **16px default on web.** 20px for hero icons; 14px for inline with text.

---

## 9. Component primitives (shape, not implementation)

Full standards in `XR-3.1-COMPONENT-STANDARDS.md`. Summary of visual rules:

- **Button primary:** bg cyan (#00D4FF), text near-black (#001018), 8px radius, 7px 14px padding, 600 weight. Hover: brightness 1.1. Press: brightness 0.95.
- **Button ghost:** transparent bg, 1px border `--xr-border`, text `--xr-text-dim`. Hover: border cyan, text cyan.
- **Button danger:** transparent bg, 1px border rgba(255,77,77,.3), text red. Hover: bg rgba(255,77,77,.08).
- **Input / Textarea:** bg `--xr-surface`, 1px border `--xr-border`, 8px radius. Focus: border cyan + `--xr-glow-cyan`. Placeholder color `--xr-muted`.
- **Card:** bg `--xr-surface`, 1px border `--xr-border`, 12px radius, `--xr-shadow`. Padding 16px.
- **Badge:** 2px 6px padding, 4px radius, 600 weight 11px, mono. Colored bg at 12% opacity (e.g., `rgba(0,255,136,.12)` green) with matching foreground color.
- **Status dot:** 6px solid circle, color matching semantic.
- **Tooltip:** bg `--xr-surface-2`, 1px border `--xr-border-2`, 11px mono, 6px 10px padding, 8ms delay.
- **Modal / Overlay:** bg `--xr-surface`, 1px border `--xr-border-2`, 16px radius, `--xr-shadow-lg`, scrim `rgba(0,0,0,.6)`.
- **Toast:** bottom-right, 10px 16px padding, 12px radius, 1px colored border (green/red/cyan/amber), auto-dismiss 4s.
- **Palette popover:** top-centered, 560px wide max, 12px radius, bg `--xr-surface`, `--xr-shadow-lg`.

### TUI equivalents
| Web component | TUI primitive |
|---|---|
| Primary button | `[ text ]` with cyan text and surrounding brackets, highlighted on selection |
| Ghost button | dim text |
| Card | Box-drawn panel with `┌─ title ─┐ … └─────────┘` |
| Input | Bottom composer with `xr [mode] ›` prompt |
| Badge | `[text]` in 8% opacity via bg ANSI, colored text |
| Status dot | `●` / `○` colored glyph |
| Modal | Centered box overlay; scrim via dimmed surrounding fill |
| Toast | Bottom-right 1-line message (in TUI: bottom bar area or notifications overlay) |

---

## 10. Layout primitives

Three canonical layouts. Every screen uses exactly one.

### 10.1 Three-pane workspace (primary TUI layout; dashboard when wide)
```
┌──────────────────────────────────────────────────────────────────┐
│ Topbar / Header                                                  │
├──────────┬───────────────────────────────┬───────────────────────┤
│ Sidebar  │  Main Work Surface            │ Inspector             │
│ (22ch)   │  (flex)                       │ (28–34ch)             │
│          │                               │                       │
│          │                               │                       │
│          │                               │                       │
├──────────┴───────────────────────────────┴───────────────────────┤
│ Composer                                                         │
├──────────────────────────────────────────────────────────────────┤
│ Status Bar                                                       │
└──────────────────────────────────────────────────────────────────┘
```
- Sidebar: nav + status summary
- Main: chat/session/active work (scrolls)
- Inspector: context, activity timeline, details for the selected item
- Composer: always visible when in a session
- Status bar: one line of machine-state truth

### 10.2 Single-pane focus (composer-only, CLI, narrow terminals, research mode)
```
┌──────────────────────────────────────────────────────────────────┐
│ Workspace · title                                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  (message/tool stream, full width)                               │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Composer                                                         │
├──────────────────────────────────────────────────────────────────┤
│ Status Bar                                                       │
└──────────────────────────────────────────────────────────────────┘
```
- Used by CLI one-shot mode, narrow TUI (<120 cols), mobile, chat-only views.
- Inspector toggles on demand via `/inspect` or a keyboard shortcut.

### 10.3 Bento dashboard (overview, settings, marketplace)
```
┌──────────────────────────────────────────────────────────────────┐
│ Topbar with breadcrumbs + action                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                 │
│  │ Stat    │ │ Stat    │ │ Stat    │ │ Stat    │                 │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘                 │
│                                                                  │
│  ┌───────────────────────┐ ┌────────────────────────────┐        │
│  │ Card (primary)        │ │ Card                      │        │
│  │                       │ │                           │        │
│  └───────────────────────┘ └────────────────────────────┘        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ Table / list / timeline                              │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```
- Responsive grid (4 cols on ≥1200px, 2 cols on tablet, 1 col on mobile).
- Stat cards 4-up on desktop; each has label, value, sub, and an optional status health bar.

---

## 11. States (component state language)

Every interactive component has exactly these states, styled consistently:

| State | Visual treatment |
|---|---|
| `default` | Base token colors |
| `hover` | border → `--xr-border-2`; subtle bg lighten (web) or reverse-video (TUI) |
| `focus-visible` (keyboard) | `--xr-glow-cyan` + 2px cyan outline or border; always visible even in high-contrast mode |
| `active / pressed` | inset 1px, shadow-sm |
| `selected` | bg rgba(0,212,255,.08), cyan text, 2px cyan left border (sidebar style) |
| `disabled` | opacity 0.4, pointer-events none |
| `loading` | spinner inside, no text change |
| `error` | red border, red focus glow, helper line in red |
| `success` | briefly green border + green check on action confirmation |

---

## 12. Accessibility hooks (preview — full spec in dedicated doc)
- Minimum contrast ratio 4.5:1 for body text, 3:1 for large text (WCAG 2.2 AA).
- Focus ring visible on every interactive element.
- All interactive elements have accessible names (`aria-label` when no visible text).
- Status messages use `aria-live="polite"`; errors use `aria-live="assertive"`.
- Color is never the only channel of meaning (pair with icon + text).
- `prefers-reduced-motion` respected.
- TUI: never rely solely on color to communicate state; always pair with a glyph (✓/!/✗/·).

---

## 13. Token export format
Implementation agents will generate:
1. **`src/ui/tokens.ts`** — TypeScript constants used by both TUI (ANSI) and dashboard (CSS-in-JS string)
2. **`src/ui/css-vars.css`** (or injected string in daemon) — `:root { --xr-… }`
3. **`website/tailwind.config.ts` extensions** — mapping Tailwind utility names to the same hex values
4. **Terminal palette table** — documented in `src/ui/theme.ts` (already partially exists; this spec completes it)

A single source file in JSON (e.g., `design-tokens.json`) is recommended as the canonical token definition, from which all four exports are generated.
