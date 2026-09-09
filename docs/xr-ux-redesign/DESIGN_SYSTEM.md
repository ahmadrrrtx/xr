# XR Design System — Phase 4.0

## Brand Identity

- **Name:** XR
- **Tagline:** "Your AI Operating System"
- **Voice:** Precise, calm, confident, technical-warm
- **Product Line:** AI Operating System

## Color System

### Core Palette (Navy-based, cyan accent)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0B1120` | App background |
| `--bg-secondary` | `#0F172A` | Elevated surfaces, panels |
| `--bg-tertiary` | `#1E293B` | Cards, inputs, hover states |
| `--bg-elevated` | `#334155` | Active rows, selected items |

| Token | Value | Usage |
|-------|-------|-------|
| `--border-default` | `#1E293B` | Subtle dividers |
| `--border-strong` | `#334155` | Interactive boundaries |
| `--border-focus` | `#38BDF8` | Focus rings |

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#F1F5F9` | Primary text |
| `--text-secondary` | `#94A3B8` | Secondary copy |
| `--text-muted` | `#64748B` | Metadata, timestamps |

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#38BDF8` | Primary interactive (cyan) |
| `--accent-glow` | `rgba(56, 189, 248, 0.15)` | Glow effects |
| `--violet` | `#6048F8` | Brand identity (logo, key features) |
| `--success` | `#22C55E` | Completed, online, safe |
| `--warning` | `#F59E0B` | Attention, cloud routing |
| `--error` | `#EF4444` | Critical, failed, denied |

### Status Colors
- **Online/Active:** `#22C55E` (green)
- **Processing:** `#38BDF8` (cyan, animated)
- **Warning:** `#F59E0B` (amber)
- **Error/Failed:** `#EF4444` (red)
- **Idle/Muted:** `#64748B` (gray)

## Typography

### Font Stack
- **Sans (UI):** `'Inter', 'Segoe UI', system-ui, sans-serif`
- **Mono (Code):** `'JetBrains Mono', 'Fira Code', 'SF Mono', monospace`
- **Display (Headlines):** `'Inter', system-ui, sans-serif` (semibold, tight tracking)

### Type Scale (Web)

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| Display | 48px | 600 | Hero headlines |
| H1 | 30px | 600 | Page titles |
| H2 | 22px | 600 | Section headings |
| H3 | 16px | 600 | Card titles |
| Body | 14px | 400 | Default text |
| Small | 13px | 400 | Secondary |
| Caption | 12px | 400 | Metadata |
| Mono | 12px | 400 | Code, technical |

### Letter Spacing
- Display/H1/H2: `-0.02em` (tight)
- Body/Small: `0` (normal)
- Labels/Tags: `0.02em` (slight)

## Spacing

**4px base unit** (web)

| Token | Value |
|-------|-------|
| `sp-1` | 4px |
| `sp-2` | 8px |
| `sp-3` | 12px |
| `sp-4` | 16px |
| `sp-5` | 20px |
| `sp-6` | 24px |
| `sp-8` | 32px |
| `sp-10` | 40px |
| `sp-12` | 48px |
| `sp-16` | 64px |
| `sp-20` | 80px |

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 6px | Small badges, inline elements |
| `md` | 10px | Buttons, inputs |
| `lg` | 14px | Cards, panels |
| `xl` | 20px | Large panels, modals |
| `full` | 9999px | Pills, avatars |

## Elevation

| Level | Shadow |
|-------|--------|
| `none` | none |
| `sm` | `0 1px 2px rgba(0,0,0,0.3)` |
| `md` | `0 4px 16px rgba(0,0,0,0.35)` |
| `lg` | `0 12px 40px rgba(0,0,0,0.45)` |
| `xl` | `0 24px 80px rgba(0,0,0,0.5)` |

## Motion

| Token | Duration | Easing |
|-------|----------|--------|
| `fast` | 80ms | `ease-out` |
| `base` | 150ms | `ease-out` |
| `slow` | 250ms | `cubic-bezier(.4,0,.2,1)` |
| `entrance` | 300ms | `cubic-bezier(.22,1,.36,1)` |

## Component Patterns

### Buttons
- Primary: Solid accent bg, white text, `radius-md`
- Secondary: Transparent, `border-strong`, hover fills subtle bg
- Ghost: No border, text only, hover adds bg
- Danger: Red tint, used sparingly for destructive actions

### Cards / Panels
- `bg-secondary` background
- `border-default` (1px)
- `radius-lg`
- Hover: border → `border-strong`, subtle bg lift
- Internal padding: `sp-6`

### Status Dots
- 8px circle
- Color matches semantic meaning
- Animated pulse when active/processing

### Progress Bars
- `bg-tertiary` track
- `accent` fill
- `radius-full`
- Smooth transitions

### Badges
- `radius-sm`
- Small text (11-12px)
- Subtle bg tint matching status color

### Inputs
- `bg-tertiary` background
- `border-default` border
- Focus: `border-accent` + glow
- `radius-md`
- Height: 40px default

## Layout System

### Sidebar
- Width: 240px (expanded) / 64px (collapsed)
- `bg-primary` background
- Separator: 1px border-right

### Top Bar
- Height: 56px
- `bg-primary` or transparent
- Contains: breadcrumbs, search, status chips, user menu

### Main Content
- Max-width: 1280px
- Padding: `sp-8` horizontal on large screens
- Responsive: stacks to single column below 768px

## Empty States
- Large icon (muted color)
- Title: what you can do here
- Subtitle: brief context
- CTA button

## Error States
- Clear icon (error color)
- Title: what went wrong
- Message: plain language explanation
- Action: retry / fix / learn more

## Loading States
- Skeleton screens for structured content
- Spinner for indeterminate waits
- Progress bar for known-duration tasks
- Shimmer animation on skeleton blocks
