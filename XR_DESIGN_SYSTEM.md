# XR Design System

**Status:** v1.0 — Based on repository tokens.ts + audit findings
** surfaces:** Shell (TUI), CLI, Daemon (Web), Website
**Brand Authority:** Official XR logo + avatar from repository assets

---

## 1. BRAND FOUNDATION

### 1.1 Identity

| Element | Value |
|---------|-------|
| Name | XR |
| Tagline | The AI Agent You Can Actually Trust |
| Product Line | AI Operating System |
| Voice | Precise, concise, technical-warm |

### 1.2 Logo

**Official logo:** `assets/logo.png` (use provided file)

**ASCII wordmark** (terminal fallback):
```
▀▄▀ █▀█
█░█ █▀▄
```

**Logo usage rules:**
- Use official logo PNG on web/desktop surfaces
- Use ASCII wordmark in terminal where images unsupported
- Never redesign or substitute the logo
- Logo appears in: header, onboarding, about, splash

### 1.3 Avatar

**Official avatar:** `assets/avatar.png` (use provided file)

**Avatar usage:**
- Central to voice interaction
- Present in chat context (sidebar/header)
- Reacts to states: idle, listening, thinking, speaking, working, error
- Used across all interactive surfaces

**Avatar variants available:**
- Front-facing (primary)
- Side face (alternate angles)
- Full body hero (promotional/large displays)

---

## 2. COLOR SYSTEM

### 2.1 Core Palette

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `bg` | `#0A0A0F` | `10, 10, 15` | Page background |
| `bg2` | `#0D1117` | `13, 17, 23` | Secondary background |
| `surface` | `#111827` | `17, 24, 39` | Cards, panels |
| `surface2` | `#1A2234` | `26, 34, 52` | Elevated surfaces |
| `border` | `#1F2937` | `31, 41, 55` | Default borders |
| `border2` | `#2D3748` | `45, 55, 72` | Emphasized borders |
| `text` | `#F9FAFB` | `249, 250, 251` | Primary text |
| `textDim` | `#9CA3AF` | `156, 163, 175` | Secondary text |
| `muted` | `#6B7280` | `107, 114, 128` | Disabled, hints |

### 2.2 Brand Colors

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `primary` | `#00D4FF` | `0, 212, 255` | Brand cyan, primary actions, focus |
| `violet` | `#A855F7` | `168, 85, 247` | Accent, secondary brand |
| `success` | `#00FF88` | `0, 255, 136` | Success, local, completed |
| `warning` | `#F59E0B` | `245, 158, 11` | Warning, budget, cloud |
| `error` | `#FF4D4D` | `255, 77, 77` | Error, denied, failed |

### 2.3 Data Colors (charts, visualizations)

| Token | Hex | Usage |
|-------|-----|-------|
| `data1` | `#00D4FF` | Primary data |
| `data2` | `#A855F7` | Secondary data |
| `data3` | `#00FF88` | Success data |
| `data4` | `#F59E0B` | Warning data |
| `data5` | `#60A5FA` | Tertiary data |
| `data6` | `#F472B6` | Quaternary data |

### 2.4 Semantic Colors

| Status | Color | Symbol |
|--------|-------|--------|
| OK / Success | `success` (#00FF88) | ✓ |
| Warning | `warning` (#F59E0B) | ! |
| Error | `error` (#FF4D4D) | ✗ |
| Info / Active | `primary` (#00D4FF) | · |
| Local | `success` (#00FF88) | ⬡ |
| Cloud | `warning` (#F59E0B) | ☁ |

### 2.5 Color on Primary

| Token | Hex | Usage |
|-------|-----|-------|
| `onPrimary` | `#001018` | Text on primary buttons |

---

## 3. TYPOGRAPHY

### 3.1 Font Families

| Role | Family | Fallbacks |
|------|--------|-----------|
| Mono | `JetBrains Mono` | `Fira Code`, `Cascadia Code`, `SF Mono`, `ui-monospace`, monospace |
| Sans | `Inter` | `Segoe UI`, `system-ui`, `-apple-system`, sans-serif |
| Display | `Syne` | `Inter`, `system-ui`, sans-serif |

### 3.2 Type Scale (Web)

| Token | Size | Usage |
|-------|------|-------|
| `display` | 48px | Hero headlines |
| `h1` | 24px | Page titles |
| `h2` | 18px | Section titles |
| `h3` | 14px | Card titles |
| `body` | 13px | Body text |
| `small` | 12px | Secondary text |
| `xs` | 11px | Labels, captions |
| `mono` | 12px | Code, technical |
| `composer` | 14px | Chat composer |

### 3.3 Terminal Typography

Terminal uses system monospace. Character cells are the unit.
- Minimum: 80 cols × 24 rows
- Comfortable: 120 cols
- Sidebar width: 22 cells
- Inspector width: 32 cells (narrow: 26)

---

## 4. SPACING

### 4.1 Space Scale (4px grid)

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight spacing |
| `space-2` | 8px | Default padding |
| `space-3` | 12px | Medium padding |
| `space-4` | 16px | Standard padding |
| `space-5` | 20px | Large padding |
| `space-6` | 24px | Section padding |
| `space-8` | 32px | Section gaps |
| `space-12` | 48px | Large gaps |
| `space-24` | 96px | Section separators |

### 4.2 Terminal Spacing

Terminal uses character rows and columns:
- Status bar: 1 row
- Composer: 3 rows
- Header: 2 rows
- Icon rail: 4 columns

---

## 5. RADIUS

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 4px | Small elements |
| `radius` (md) | 8px | Default |
| `radius-lg` | 12px | Cards |
| `radius-xl` | 16px | Large panels |
| `radius-full` | 999px | Pills, circles |

---

## 6. MOTION

### 6.1 Durations

| Token | Value | Usage |
|-------|-------|-------|
| `dur-fast` | 80ms | Hover, micro |
| `dur-base` | 120ms | Default transitions |
| `dur-slow` | 200ms | Entrances, attention |
| `spinner-frame` | 120ms | Spinner animation |
| `cursor-blink` | 530ms | Text cursor |
| `startup-frame` | 110ms | Startup animation |
| `startup-frames` | 6 | Startup sequence |

### 6.2 Easing

| Token | Value | Usage |
|-------|-------|-------|
| `easing-standard` | `cubic-bezier(.4,0,.2,1)` | Default |
| `easing-entrance` | `cubic-bezier(.22,1,.36,1)` | Entrances |

### 6.3 Motion Principles

1. **Meaningful only** — Animation communicates, doesn't decorate
2. **Performance-conscious** — No unnecessary animations on large surfaces
3. **Respect reduced motion** — `XR_REDUCED_MOTION=1` disables non-essential
4. **Fast by default** — Quick responses feel snappy

### 6.4 Motion for States

| State | Animation |
|-------|-----------|
| Default → Hover | 80ms scale/translate |
| Loading | Spinner or pulse, 120ms frames |
| Success | Brief scale pulse, green flash |
| Error | Brief shake or red flash |
| Transition | 120-200ms fade/slide |

---

## 7. ELEVATION / SHADOWS

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,.4)` | Subtle lift |
| `shadow` (md) | `0 4px 24px rgba(0,0,0,.4)` | Cards |
| `shadow-lg` | `0 12px 44px rgba(0,0,0,.5)` | Modals, floating |
| `glow-cyan` | `0 0 20px rgba(0,212,255,.15)` | Primary focus |
| `glow-green` | `0 0 20px rgba(0,255,136,.12)` | Success glow |
| `glow-amber` | `0 0 20px rgba(245,158,11,.15)` | Warning glow |
| `glow-red` | `0 0 24px rgba(255,77,77,.2)` | Error glow |
| `focus` | `0 0 0 1px rgba(0,212,255,.4), 0 0 20px rgba(0,212,255,.15)` | Focus ring |

---

## 8. GRADIENTS

| Token | Value | Usage |
|-------|-------|-------|
| `gradient-brand` | `linear-gradient(90deg, #00D4FF, #7AA7FF, #A855F7)` | Brand surfaces, hero |
| `gradient-shield` | `radial-gradient(circle, rgba(0,212,255,.22), transparent 60%)` | Background depth |

---

## 9. COMPONENT STYLES

### 9.1 Buttons

**Primary button:**
- Background: `primary` (#00D4FF)
- Text: `onPrimary` (#001018)
- Border: none
- Radius: `radius` (8px)
- Padding: 8px 16px
- Hover: slight darken, glow
- Active: slight press

**Secondary button:**
- Background: transparent
- Border: `border2` (#2D3748)
- Text: `text` (#F9FAFB)
- Radius: `radius` (8px)
- Hover: surface background

**Ghost button:**
- Background: transparent
- Text: `textDim` (#9CA3AF)
- Hover: surface background, text brightens

### 9.2 Cards

- Background: `surface` (#111827)
- Border: `border` (#1F2937)
- Radius: `radius-lg` (12px)
- Padding: `space-4` (16px)
- Shadow: `shadow` (md)

### 9.3 Inputs

- Background: `bg2` (#0D1117)
- Border: `border` (#1F2937)
- Radius: `radius` (8px)
- Padding: 8px 12px
- Focus: `focus` ring
- Placeholder: `muted` (#6B7280)

### 9.4 Badges / Pills

- Background: surface2 or tinted
- Text: appropriate color
- Radius: `radius-full`
- Padding: 2px 8px

### 9.5 Status Dots

- Size: 8px circle
- Colors: semantic colors
- Optional: pulse animation for active

### 9.6 Avatars

- Size variants: 32px (small), 48px (medium), 64px (large), 128px+ (hero)
- Border: subtle, `border2`
- Background: surface or tinted
- States shown through expression/color/glyph changes

### 9.7 Sidebar Navigation

- Width: 22 cells (terminal), 240px (web)
- Items: icon + label
- Active: primary tinted background, primary text
- Hover: surface2 background
- Sections: labeled groups with dividers

### 9.8 Chat Messages

**User message:**
- Background: primary tinted (subtle)
- Border: left border primary
- Radius: radius
- Align: right

**XR message:**
- Background: surface
- Border: none or subtle
- Radius: radius
- Align: left
- Avatar: left of message

**Tool execution:**
- Background: surface2
- Border: border
- Icon: tool icon
- Show: tool name, status, result preview

**System/notice:**
- Background: tinted by severity
- Icon: severity icon
- Compact

### 9.9 Progress Indicators

**Spinner:**
- Size: 16-24px
- Color: primary
- Frames: 6, 120ms each
- Usage: indeterminate loading

**Progress bar:**
- Height: 4px
- Background: border
- Fill: primary
- Radius: full
- Usage: determinate progress

**Skeleton:**
- Background: surface2
- Animation: pulse, shimmer
- Usage: content loading

---

## 10. TERMINAL-SPECIFIC ADAPTATIONS

### 10.1 ANSI Rendering

- Use truecolor (24-bit) when available
- Fall back to 256-color, then 16-color, then mono
- Respect `NO_COLOR` and `FORCE_COLOR`
- Detect via `COLORTERM`, `TERM`, `TERM_PROGRAM`

### 10.2 Terminal Branding

- Logo: ANSI art from `brand.ts` (rasterized from PNG)
- Colors: ANSI mapped from tokens
- Layout: character cells, not pixels

### 10.3 Terminal Constraints

- Minimum 80×24
- Sidebar collapses to icon rail under 96 cols
- Inspector hides under 120 cols
- Single pane under 80 cols

---

## 11. WEB-SPECIFIC ADAPTATIONS

### 11.1 CSS Custom Properties

All tokens available as CSS variables via `cssVarsBlock()`:
```css
:root {
  --xr-bg: #0A0A0F;
  --xr-primary: #00D4FF;
  --xr-surface: #111827;
  /* ... etc */
}
```

### 11.2 Glassmorphism

Use sparingly:
- Subtle backdrop blur on floating elements
- Low opacity backgrounds
- Border with low opacity white/cyan
- Never heavy glass that destroys readability

### 11.3 Depth

- Layered surfaces with subtle shadows
- Z-stacking for floating elements
- Avatar can have depth/glow

---

## 12. AVATAR STATE SYSTEM

### 12.1 States

| State | Visual | Meaning |
|-------|--------|---------|
| `idle` | Neutral, subtle ambient motion | Waiting, no active task |
| `listening` | Attentive pose, visual listening cue | Capturing voice input |
| `thinking` | Contemplative, processing animation | Reasoning about response |
| `speaking` | Active, mouth/expression movement | Generating voice output |
| `working` | Focused, task-oriented | Executing tools/agents |
| `error` | Concerned, error indicator | Something went wrong |
| `complete` | Satisfied, success indicator | Task finished |

### 12.2 Terminal Avatar

In terminal, avatar uses:
- ANSI art frames for key states
- State indicator glyph + color
- Position: sidebar header, chat context

### 12.3 Web Avatar

On web, avatar uses:
- Original PNG with CSS/SVG overlays
- CSS animations for states
- Canvas for advanced effects if needed
- Position: chat header, voice mode, floating

---

## 13. ACCESSIBILITY

### 13.1 Color Contrast

- All text meets WCAG AA (4.5:1 body, 3:1 large)
- Primary on surface: check ratio
- Don't rely on color alone — add icons/text

### 13.2 Keyboard

- All interactive elements keyboard accessible
- Focus states visible (focus ring)
- Logical tab order
- Skip links where appropriate

### 13.3 Motion

- Respect `prefers-reduced-motion`
- XR respects `XR_REDUCED_MOTION=1`
- No essential content conveyed only by animation

### 13.4 Screen Readers

- Semantic HTML on web
- ARIA labels where needed
- Terminal: text alternatives for visual elements

### 13.5 Scaling

- Text can scale without breaking layout
- Large text option available

---

## 14. RESPONSIVE BEHAVIOR

### 14.1 Terminal

- < 80 cols: single pane, minimal sidebar
- 80-95 cols: icon rail sidebar
- 96-119 cols: full sidebar, no inspector
- 120+ cols: sidebar + inspector

### 14.2 Web

- Desktop: full layout
- Tablet: adaptable, may hide inspector
- Mobile: stack layout, sheet drawers

---

## 15. DO NOT

- Don't use colors that don't come from the token system
- Don't add animation for decoration
- Don't use heavy glass that hurts readability
- Don't redesign the official logo/avatar
- Don't use generic AI icons when XR identity should show
- Don't sacrifice performance for visual effects
- Don't hide dangerous actions behind unclear UI
- Don't fake states (loading, progress, completion)

---

*End of Design System*
