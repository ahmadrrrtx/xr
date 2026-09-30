# XR Design System — v1.0 "Observer"
## The Definitive Visual, Motion, and Component Language for XR

> **Status:** Master source of truth. Every screen, component, avatar, CLI surface, and marketing asset must conform to this document.
> **Brand identity source:** The XR logo (`xr logo.png` — metallic silver X on atomic ring, cyan core, deep space black) and the XR Avatar (glossy black sentinel with electric-cyan eyes + chest core, brushed silver armor accents, sketch/energy-trail collar). These two assets are the non-negotiable brand anchors.
> **Tagline:** "The AI Agent You Can Actually Trust."
> **Prepared:** 2026-09-30 for @ahmadrrrtx/xr

---

## 0. Design Philosophy

XR is **not** another chatbot UI. It is a **sentinel** — calm, intelligent, observant, powerful, and trustworthy. It feels like something that is *aware* of you without being loud about it. The design must communicate three things before the user reads a single word:

1. **Intelligence** — precision, focus, capability (earned via minimalism + typographic hierarchy + motion)
2. **Trust** — cryptographic solidity, clarity, auditability (earned via consistent grids, readable type, visible state)
3. **Presence** — the feeling that XR is "there," breathing, waiting, watching (earned via subtle motion, the Avatar, the core glow, soft animations)

### Three laws of XR design
1. **Clarity before flair.** Every glow, gradient, and particle must earn its place. If you remove it and the UI still works, remove it.
2. **Truth in pixels.** Status indicators MUST reflect real state. Fake pulse, fake "thinking" dots, fake progress bars are FORBIDDEN (matches the codebase's claim-lint Constitution).
3. **The operator is in command.** XR proposes; the user disposes. Approval is always one touch away. Destructive actions are never invisible.

---

## 1. Brand Color Palette (extracted from logo + avatar)

All colors derived from the official logo and avatar assets via color-pick. These are canonical — do not introduce other hues as primary UI colors.

### 1.1 Core brand colors

| Token | Hex | RGB | Usage | Preview idea |
|---|---|---|---|---|
| `--xr-core` | `#00E5FF` | 0, 229, 255 | THE XR CYAN — avatar eyes, chest core, logo center, primary accent, active state glow, primary buttons glow, waveform, focus rings | ⬜ electric cyan |
| `--xr-core-bright` | `#7DF9FF` | 125, 249, 255 | Hot highlight on cyan (specular, bloom), illuminated eye edge, core center | ⬜ brightest cyan-white |
| `--xr-core-dim` | `#008DA8` | 0, 141, 168 | Subdued cyan (visited links, disabled accents, low-importance glow, idle breathing base) | ⬜ dark teal-cyan |
| `--xr-core-ghost` | `#003A47` | 0, 58, 71 | Faintest cyan tint (dividers on black, subtle card edges, inactive rings) | ⬜ near-black cyan |

### 1.2 Surface colors (the "void" / "deep space")

| Token | Hex | Usage |
|---|---|---|
| `--xr-void` | `#03070D` | Deepest background (Voice Theater, boot screen, full-screen avatar, splash) |
| `--xr-ink` | `#0A0F1A` | Default app background, panels, sidebar |
| `--xr-surface-1` | `#101827` | Card / elevated panel background, input fields idle |
| `--xr-surface-2` | `#1A2332` | Hovered surface, nested card, toast background, dropdowns |
| `--xr-surface-3` | `#252F40` | Pressed/active surface, selected item, progress track fill background |
| `--xr-border` | `#1E2A3B` | Default border color for cards, inputs, dividers |

### 1.3 Metal / silver (from X logo arms)

| Token | Hex | Usage |
|---|---|---|
| `--xr-metal-hi` | `#F0F4F8` | Primary text (headings, labels, active item text) |
| `--xr-metal` | `#B7C2CF` | Secondary text (body copy, descriptions, meta info) |
| `--xr-metal-dim` | `#6B7889` | Tertiary text (placeholders, timestamps, disabled labels) |
| `--xr-metal-low` | `#3A4556` | Disabled text, subtle dividers, non-interactive chrome |

### 1.4 Semantic colors (used ONLY for specific signals — never as UI chrome)

| Token | Hex | Meaning |
|---|---|---|
| `--xr-approve` | `#22D3EE` (cyan-tinted) | Approvals, success, online, verified, go-ahead |
| `--xr-warning` | `#F59E0B` (amber) | Pending approval, soft limit reached, caution |
| `--xr-deny` | `#EF4444` (alarm red, used sparingly) | Denied, destructive, error, emergency stop, quota hard-cap, breach |
| `--xr-wait` | `#A78BFA` (muted violet) | Thinking/processing/model-running (rare, prefer motion spinner) |
| `--xr-money` | `#34D399` (green) | Cost/budget displayed as money (Wallet widget) — differs from approve to avoid confusion |

**Important rule:** Red (`--xr-deny`) is reserved for alarms. Do not color every error red — soft errors use warning amber. Destructive confirmations require the full XR Shield icon + red button on a dark surface.

### 1.5 Gradients

- **Core glow:** `radial-gradient(circle at center, #00E5FF 0%, #008DA8 30%, transparent 70%)` — used behind avatar core, logo center, active HUD orbs.
- **Metal sweep:** `linear-gradient(135deg, #F0F4F8 0%, #B7C2CF 40%, #6B7889 70%, #F0F4F8 100%)` — for X-mark logo arms in UI (subtle, used on icons not text).
- **Void depth:** `linear-gradient(180deg, #03070D 0%, #0A0F1A 100%)` — default page background.
- **Chest-core pulse:** `radial-gradient(circle, rgba(0,229,255,0.9) 0%, rgba(0,141,168,0.5) 40%, transparent 75%)` — animates in Voice Theater avatar.

---

## 2. Typography

### 2.1 Font families

| Role | Font | Stack fallback | License | Why |
|---|---|---|---|---|
| **UI / all surfaces** | **Inter** | `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | SIL OFL | Modern geometric sans; excellent screen legibility; neutral enough to not fight with the sci-fi brand; weights 100-900 |
| **Monospace / code / logs / terminal** | **JetBrains Mono** | `"JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace` | SIL OFL | Best dev monospace; ligatures optional (enabled in code, disabled in logs) |
| **Display / wordmark only** | **Orbitron** (weight 700/900), used EXCLUSIVELY for the XR wordmark in logo lockups. Do not set headings in Orbitron. | `Orbitron, Inter, sans-serif` | SIL OFL | Matches the X mark's futuristic geometry; already implied by the existing "XR" letterforms in the logo. |

**Host the fonts locally** (in `desktop/public/fonts/`) — no Google Fonts CDN dependency (privacy-first, matches local-first product philosophy).

### 2.2 Type scale (1.250 — Major Third, modified for UI density)

| Token | Size | Line height | Weight | Usage |
|---|---|---|---|---|
| `text-xs` | 11px | 16px | 500 | captions, timestamps, meta, badge labels |
| `text-sm` | 12px | 18px | 400/600 | secondary text, form helpers, list item meta |
| `text-base` | 14px | 20px | 400/500 | body copy, default UI text, chat messages, table rows |
| `text-lg` | 16px | 24px | 400/500 | lead text, chat author names, card titles |
| `text-xl` | 18px | 26px | 500/600 | section subheads, dialog titles, card heads |
| `text-2xl` | 22px | 30px | 600 | page titles, H2, empty state headline |
| `text-3xl` | 28px | 36px | 600/700 | H1, onboarding page titles, Voice Theater captions |
| `text-4xl` | 36px | 44px | 700 | splash/hero, Voice Theater welcome |
| `text-5xl` | 48px | 56px | 700/800 | boot screen "XR" wordmark only |
| `text-6xl` | 72px | 84px | 800 | reserved for Voice Theater intro sequence |

**Tracking (letter-spacing):**
- All caps / small UI labels: `0.08em` (caps render at `text-xs` with `600` weight and 0.08em tracking)
- Headings: `0` (normal)
- Wordmark (Orbitron): `0.04em`

---

## 3. Spacing, Grid, Layout

### 3.1 Spacing scale (4px base)

| Token | Pixels | Usage |
|---|---|---|
| `space-1` | 4px | icon-text gap, tight form gaps |
| `space-2` | 8px | chip padding, compact list gaps |
| `space-3` | 12px | default padding inside compact components, button padding x |
| `space-4` | 16px | card padding, form field vertical gap, default element spacing |
| `space-5` | 20px | section sub-gap |
| `space-6` | 24px | section padding, modal padding x |
| `space-8` | 32px | major section gap, modal padding y |
| `space-10` | 40px | page-level vertical rhythm |
| `space-12` | 48px | hero spacing |
| `space-16` | 64px | top-of-page padding for major screens |

### 3.2 Border radius

| Token | Radius | Usage |
|---|---|---|
| `radius-sm` | 4px | badges, small chips, inline tags |
| `radius-md` | 8px | buttons, inputs, cards, table cells (default) |
| `radius-lg` | 12px | elevated cards, modals, dialogs, dropdown menus |
| `radius-xl` | 16px | feature cards, approval dialogs, large containers |
| `radius-full` | 9999px | pills, toggles, avatar, orb, switches |

**Avoid 0px and 200px+ radius** — XR is not a playful pastel SaaS; medium radii read as precise and engineered.

### 3.3 Shadows (glow-based, not drop-shadow based)

XR uses **glow/halo shadows**, not heavy drop shadows. Shadows emanate from cyan/metal light sources, not from fictional overhead light.

| Token | Value | Usage |
|---|---|---|
| `shadow-glow-xs` | `0 0 6px rgba(0,229,255,0.3)` | Focused input, active button text |
| `shadow-glow-sm` | `0 0 12px rgba(0,229,255,0.35), 0 0 3px rgba(0,229,255,0.5)` | Primary button, focused card |
| `shadow-glow-md` | `0 0 24px rgba(0,229,255,0.4), 0 0 8px rgba(0,229,255,0.3)` | Active avatar core, active HUD orb, approval call-to-action |
| `shadow-glow-lg` | `0 0 48px rgba(0,229,255,0.5), 0 0 16px rgba(0,229,255,0.4)` | Voice Theater orb, critical emergency controls (deny button glow) |
| `shadow-card` | `0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,229,255,0.05) inset` | Default card shadow — subtle depth + faint cyan inset edge |
| `shadow-modal` | `0 24px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,229,255,0.12)` | Modal/dialog elevation |

### 3.4 Layout primitives

- **Sidebar width:** 72px collapsed (icon rail), 240px expanded (with labels). Persistent, dark.
- **Top bar height:** 52px (always shows wallet, status, app menu, avatar).
- **Bottom action bar** (in contextual screens like Builder, Workspace): 48px.
- **Content max-width:** no artificial max for dashboard; text reading (research reports, audit logs) capped at 760px measure.
- **Grid:** 8px baseline grid; components snap to it.
- **Responsive breakpoints:** `sm 640px / md 768px / lg 1024px / xl 1280px / 2xl 1536px` (follow Tailwind defaults — Tauri desktop will primarily be 1024px+).

---

## 4. Iconography

### 4.1 Primary icon set
**Lucide React** (MIT, feather-line style). Stroke weight 1.5px default; 2px for active/selected states.
Color: inherit (uses current text color); active/accented icons use `--xr-core`.

### 4.2 Custom icons (XR brand-specific, ship in `desktop/components/icons/`)
- **XR Shield** — a circular shield with a checkmark + circuit lines (used for Security center, approvals, trust states).
- **XR Core** — a stylized atom with an X (mini logo for favicon, app icon, window title bar, HUD badge).
- **XR Avatar silhouette** (mini) — 16px/24px head-and-shoulders glyph for assistant messages, voice indicator.
- **Orb state glyphs** — idle (ring), listening (wave), thinking (orbit), speaking (sound bars), waiting (pulsing dot with lock).

### 4.3 Icon rules
- All icons must be same stroke family. Do not mix Lucide with Font Awesome/heroicons/solid sets.
- Cyan glow (`shadow-glow-xs`) on icon only for currently active state (e.g., listening mic icon glows cyan).
- Destructive action icons use `--xr-deny` color.

---

## 5. Components (canonical set)

All components built on **shadcn/ui v4** with Tailwind v4 customized to XR's color tokens, plus these overrides:

### 5.1 Buttons

| Variant | Background | Text | Border | Glow | Usage |
|---|---|---|---|---|---|
| **Primary** (default CTA) | `linear-gradient(180deg, #008DA8 0%, #00556A 100%)` | `#F0F4F8` | 1px `#00E5FF` @ 50% | `shadow-glow-sm` | "Send", "Approve", "Install", "Connect" |
| **Primary-highlight** (critical CTA) | `linear-gradient(180deg, #00B8D4 0%, #008DA8 100%)` | white | 1px `#7DF9FF` | `shadow-glow-md` | "Get Started", "Begin Voice", "Authorize" |
| **Secondary** | `--xr-surface-1` | `--xr-metal-hi` | 1px `--xr-border` | none | "Cancel", "Settings", "Configure" |
| **Ghost** | transparent | `--xr-metal` | none | none (hover: `--xr-surface-2`) | icon buttons, nav items, toolbar actions |
| **Destructive** | `linear-gradient(180deg, #7F1D1D 0%, #450A0A 100%)` | `#FCA5A5` | 1px `#EF4444` @ 70% | red subtle glow | "Emergency Stop", "Delete", "Deny", "Revoke" |
| **Approval (inline)** | (not a button — badge with button behavior) | `--xr-approve` | none | none | ✅ inline in approval notifications |
| **Link** | transparent | `--xr-core` | none | none (hover: underline) | inline text links, "learn more" |

**Button sizing:** sm (h-7 px-3 text-xs), md (h-9 px-4 text-sm, default), lg (h-11 px-5 text-base).
All buttons have a 2px cyan focus ring offset 2px on keyboard focus.

### 5.2 Inputs
- Height: 40px md, 36px sm
- Background: `--xr-surface-1` idle, `--xr-surface-2` hover, `--xr-surface-2` + `shadow-glow-xs` on focus
- Border: 1px `--xr-border` idle, 1px `--xr-core` on focus, 1px `--xr-warning` on error
- Placeholder: `--xr-metal-dim`
- Text: `--xr-metal-hi`
- Chat input has a 48px height, "send" button circular (primary variant, 36px diameter) on the right, attachment button on left.

### 5.3 Cards
- Background: `--xr-surface-1`
- Border: 1px `--xr-border`; hover border `--xr-core-ghost`
- Radius: `radius-lg` (12px)
- Padding: `space-5` (20px) default; `space-4` for compact
- Shadow: `shadow-card`
- Cards for "live/running" states get a faint 1px left border in `--xr-core` (pulse animation on "thinking/active").

### 5.4 Badges / chips
- Radius: `radius-full` (pill shape)
- Padding: 2px 10px
- Font: `text-xs`, 600 weight, 0.06em tracking, uppercase
- Variants:
  - **Status:** green (online), amber (pending), red (error), cyan (active), violet (thinking)
  - **Tier:** T0 (cyan fill, safe), T1 (cyan outline), T2 (amber outline, approval needed), T3 (red outline, destructive), T4 (solid red, locked)
  - **Tag** (metal dim background)

### 5.5 Toggle / Switch
- Width 40px, height 22px, radius-full
- Off: `--xr-surface-3` with `--xr-metal-dim` thumb
- On: `--xr-core-dim` track + `--xr-core` glowing thumb (`shadow-glow-xs`)

### 5.6 Approval Modal (THE most important component)
Triggered on Tier 2+ actions. Requirements:
- Centered modal, 480px max width, `radius-xl`
- Top: XR Shield icon (64px) + cyan glow
- Title: risk-tier color-coded heading ("Permission needed" for T2, "Careful — destructive action" for T3, "⚠ Stop and review" for T4)
- Body:
  - What will happen (human-readable summary)
  - Exact command / API call / write target (monospace block in `--xr-surface-3` background, copyable)
  - Why (model's reasoning, one line)
  - Risk level badge
  - Estimated cost
- Actions: **Deny** (secondary, left) / **Always allow this pattern** (ghost, text) / **Approve** (primary-highlight, right)
- Auto-deny countdown (e.g., "Auto-deny in 5:00") shown for unattended sessions
- Enter = approve, Escape = deny
- If over Telegram/Discord: same info sent as text/markdown with ✅/❌ inline buttons.

### 5.7 Wallet/Spend Widget (always visible in top bar)
- Horizontal mini-bar: `Today: $2.34 / $5.00` with color-coded progress bar
- Progress bar background `--xr-surface-3`, fill `--xr-money`, turns amber at 80%, red at 95%
- Click opens Budget Panel (described in screens doc)
- On hover shows tooltip with breakdown by agent/model

### 5.8 Avatar (XR character) — see §6

### 5.9 Toast notifications (Sonner-based)
- Position: top-right on desktop; top-center on mobile
- Background: `--xr-surface-2`, border `--xr-border`
- Cyan left-accent bar for info; green for success; amber for warning; red for error
- Title + one-line description; auto-dismiss 4s; persistent for critical (approval needed)
- Action button inside toast for quick responses ("Approve" directly from toast)

### 5.10 Command Palette (cmdk)
- Trigger: `Cmd+K` / `Ctrl+K`
- Width: 640px, centered, `radius-xl`, `shadow-modal`
- Search input at top (large, 44px, auto-focus)
- Command list: keyboard-navigable, icon left, label + description, right-side shortcut badge
- Cyan highlight for selected row (background `--xr-core-ghost`, 1px left border `--xr-core`)
- Sections: XR Actions, Switch Screen, Skills, Agents, Recent, Settings
- Empty state: friendly "Try 'run a backup' or 'ask XR'" with suggested commands.

### 5.11 Chat message bubbles
- **User messages:** right-aligned, `--xr-surface-2` background, `--xr-metal-hi` text, `radius-xl` (asymmetrical: bottom-right corner 4px to anchor to right)
- **XR messages:** left-aligned, transparent (no bubble) for the first in a sequence, avatar (28px orb or mini-headshot) at start, text in `--xr-metal-hi`, citations in cyan pill badges
- **System/Approval/Error messages:** full-width, thin (36px), `--xr-surface-1` with left-border: cyan=info, amber=approval, red=error, violet=thinking
- **Code blocks:** `--xr-void` background, `--xr-core` top border (2px), JetBrains Mono, language label top-left, copy button top-right, `radius-md`
- **Tool call previews:** collapsible card showing tool name, args summary, status spinner → result; green check on success, red X on failure

### 5.12 Activity / approval indicator (system-tray orb)
- A 12px orb in the tray (menubar extra / system tray icon)
- States:
  - **Idle:** dim cyan, slow pulse (2s cycle)
  - **Listening/Active:** bright cyan glow
  - **Thinking:** rotating orbit animation
  - **Waiting approval:** amber pulsing + badge count of pending approvals
  - **Error/Blocked:** red steady dot

---

## 6. The XR Avatar (the sentinel)

### 6.1 Canonical description (from provided assets)
- **Silhouette:** Smooth featureless helmet/dome ("sentinel" / "no face" — evokes Iron Man's helmet, Savitar, or a quiet AI observer)
- **Eyes:** Two sharp, angled, almond-shaped slits of glowing cyan (`--xr-core` to `--xr-core-bright` gradient); no pupils, no iris — just clean light slits that narrow/widen slightly based on state
- **Chest core:** A circular cyan energy core at sternum (like the logo's center, and like Iron Man's arc reactor or Blue Beetle's scarab back) — glows brightest when XR is speaking/active; dims when idle
- **Color:** helmet = deep glossy black (`#050912` to `#1A2332` gradient), with brushed silver-blue highlights along the jaw and shoulder plates. Eyes + core = XR cyan.
- **Collar/shoulders:** Energy-trail/sketch-effect feathers of crackling cyan-blue energy sweeping back from the neck and shoulders like a cowl — *not solid cloth*, more like ionized plasma or a shard of cosmic energy trailing behind him (matches the provided avatar assets)
- **Mood:** Calm, observing, intelligent, patient. NOT menacing, NOT childish/cute, NOT robotic (no visible seams/bolts).

### 6.2 Avatar states (Voice Theater / Companion orb)

| State | Eyes | Chest core | Surrounding energy | Idle animation |
|---|---|---|---|---|
| **Idle** | dim (30% brightness), narrow slits | dim, slow breathing pulse | slow swirl | 4s breath scale 1.0 ↔ 1.02 |
| **Listening** | bright (90%), eyes slightly WIDER, tracks cursor/subtle parallax | glows with microphone audio amplitude | crackles with voice input | waveform ring around head synced to mic |
| **Thinking** | narrow (70%), flickering once per "thought" | pulses rhythmically with LLM token streaming | orbit particles rotate around head | orbit ring rotation 4s cycle, core pulses |
| **Speaking** | bright (100%), mouth slit glow below eyes (new) | bright, modulates with TTS amplitude | chest energy projects forward | audio waveform bars emanate from core, head slightly tilts |
| **Waiting approval** | amber (override cyan), patient expression | amber-cyan mix | one hand/energy tendril raises in "hold on" gesture (full avatar); orb pulses amber | slow pulse + amber halo |
| **Error/Security** | bright red-cyan warning flash (brief), then narrow intense | flashes red once, returns to dim cyan | energy "deflects" inward (shield up) | quick red pulse then steady dim |
| **Sleeping** | closed (thin cyan line), head tilts down slightly | nearly off, very slow pulse | energy trails retract | 8s slow breath |

### 6.3 Avatar presentation sizes
- **Tiny (16px/24px):** simple orb/circle with cyan dot (no facial features) — for chat avatars, lists.
- **Small (36px):** head-only glyph with glowing eyes — sidebar header, chat header, approval toast.
- **Medium (120px):** head-and-shoulders bust — HUD panel, Companion corner, onboarding sidebar.
- **Large (400px):** head-and-torso — Voice Theater center, welcome screen, settings profile.
- **Full-screen:** bust-to-waist, energy trails extending off-screen — Voice Theater full-screen mode.

### 6.4 Companion Orb (when not in full avatar mode)
If user prefers minimal HUD over the full avatar, render an **orb** (a stylized version of the logo's core):
- 64px diameter, deep cyan-black sphere
- One bright rotating electron ring (like the logo's silver sweep)
- Core center glows with state colors (same as avatar states)
- Click opens HUD; drag to position on screen; right-click for quick actions.

---

## 7. Motion & Animation

Motion in XR is **calm, physics-informed, and purposeful**. Every animation communicates state — no decorative confetti.

### 7.1 Spring physics (Framer Motion defaults)
- **Snappy UI (buttons, toggles, hover):** `type: "spring", stiffness: 500, damping: 30` (~150ms, crisp)
- **Entrance (modals, panels):** `type: "spring", stiffness: 300, damping: 30` (~250ms)
- **Large transitions (HUD open/close, Voice Theater in/out):** `type: "spring", stiffness: 200, damping: 28` (~400ms)

### 7.2 Specific animations
- **HUD open:** slides down from top (translateY -20px → 0) + fades in + orb scales 0.9 → 1
- **Page transitions:** cross-fade 200ms (pages do not slide horizontally — that feels like a mobile app, not a control station)
- **Approval modal:** scale 0.95 → 1 + fade + subtle backdrop blur in
- **Avatar idle breathing:** scale 1 ↔ 1.02, 4s ease-in-out infinite
- **Core pulse (speaking):** scale 1 ↔ 1.12, 0.8s ease-in-out infinite, glow intensity syncs
- **Thinking orbit:** electron ring rotates 360° every 4s, linear infinite
- **Typing indicator (XR thinking):** THREE dots (not three wave bars), 3x8px ellipses, cyan, each dot fades 0.3 ↔ 1 staggered by 0.15s
- **Progress/loading bars:** determinate = fills with `--xr-core` + glow at the leading edge; indeterminate = a cyan shimmer sweeps left-to-right across the bar (1.4s loop)
- **Approval urgency pulse:** when T4 modal appears, screen edge flickers a red vignette for 500ms then fades — draws eye without being seizure-inducing.
- **Glow on hover:** interactive elements get a `shadow-glow-xs` fade-in over 150ms.

### 7.3 Reduced motion
- Respect `prefers-reduced-motion: reduce`: disable all breathing/orbit/pulse animations; keep fades (opacity only, 100ms); remove parallax.

### 7.4 Sound design (optional, default off)
- All UI sounds subtle, futuristic-soft:
  - Approval granted: short soft chime (C major pentatonic, 200ms, -18dB)
  - Approval denied: lower thud (150ms)
  - XR wake: 100ms ascending digital "bloom"
  - XR listening ready: soft click
  - Error: low double-beep
- All sounds off by default; user enables in Settings. Sound pack local (no network fetch). Use WebAudio API with generated tones first; add high-quality recorded sounds later.

---

## 8. Voice Theater Visual Language

The most iconic screen — black-space cinema experience where you talk to XR's avatar.

- **Background:** pure `--xr-void` (#03070D), with a very subtle radial star-field (30 tiny white dots at 10-30% opacity, slow 60s drift) — NOT distracting, just enough depth
- **Center:** Large XR avatar (bust-to-waist for large displays, head-and-shoulders for smaller)
- **Avatar positioning:** vertically slightly above center (eyes at ~40% from top, not 50%)
- **Bottom 20%:** Transcript panel (semi-transparent `--xr-ink` @ 85% opacity, backdrop-blur 12px, `radius-xl` top corners only)
- **Bottom center:** One large "Hold to talk" OR live-waveform button (circular, 72px, primary-highlight variant with glow when listening)
- **Right side:** Action queue (slides in when actions/approval needed)
- **Top-left:** Current time, XR status (e.g., "Connected", "Local only")
- **Top-right:** Exit button, minimize-to-orb button
- **Subtitle text:** centered under avatar, large text, fading in/out as speech is recognized/synthesized
- **Ambient particles:** 5-10 tiny cyan motes drifting around avatar at low velocity (like energy particles off the collar trails)
- **Speaking visualization:** concentric cyan rings emanate FROM the chest core outward (not from the mouth) at speech amplitude — matches the chest-core-is-voice-source design

---

## 9. CLI / Terminal Visual Identity (npm `@rrrtx/xr`)

CLI must feel consistent with desktop but optimized for terminals.

### 9.1 Colors (ANSI 256)
- Primary accent: **Cyan** (ANSI 6 / #00A3B0 — terminal-safe, slightly dimmed from UI cyan because terminals render neon poorly)
- Success / Approved: **Green** (ANSI 2)
- Warning / Pending: **Yellow** (ANSI 3)
- Error / Denied: **Red** (ANSI 1)
- Muted: **Gray** (ANSI 8)
- Bold text: white/bright (ANSI 15) for emphasis

### 9.2 CLI elements
- **Boot banner:** minimalist XR logo (ASCII or Unicode-lined atom + X), version line, tagline ("The AI Agent You Can Actually Trust"), security status (green "Audit chain verified" / amber "unverified")
- **Prompt:** `xr> ` in cyan. In workspaces: `xr [project-name]> `.
- **Spinners:** braille spinner (`⡿⣟⣯⣷⣾⣽⣻⢿`) in cyan for progress.
- **Progress bars:** shaded block bar (`▓▓▓▓▓▓▓░░░`) with percentage + ETA.
- **Approval prompts in CLI:** yellow banner, boxed action summary, `[A]pprove / [D]eny / Always allow [P]attern?` prompt, with 5-minute timeout.
- **Audit lines:** prefixed with `›` in dim gray for trace, `[XR]` in cyan for XR responses, `⚠` yellow for warnings, `✗` red for errors.
- **Tables:** unicode-box tables with thin lines (`┌─┬─┐│ │├─┼─┤└─┴─┘`), header in bold cyan, data in default white, status columns colored.
- **NO emojis in CLI output by default** (opt-in flag `--emoji`) — keep it professional by default (matches engineering tone).
- **Help text:** organized in man-page style (`xr <command> --help`), flags left, descriptions indented, examples section.

### 9.3 CLI commands (canonical top-level)
```
xr chat                # interactive chat session
xr ask <query>         # single query, print answer
xr voice               # enter voice mode
xr run <task>          # run a specific task
xr agent list          # list available agents
xr agent use <name>    # use a specific agent
xr skill install       # install a skill
xr serve               # start daemon
xr status              # daemon + wallet status
xr budget set|show     # manage spend limits
xr approve list        # list pending approvals
xr audit verify        # verify the audit chain
xr model list          # list configured models
xr workspace list      # list workspaces
xr tui                 # full terminal UI (advanced)
xr doctor              # diagnose installation
```

---

## 10. Onboarding Flow (first launch)

Onboarding is its own screen set, designed to get a user from installation → first working conversation in under 3 minutes. XR auto-detects the environment to reduce friction.

### 10.1 Onboarding philosophy
- No "create account." Local-first. Zero cloud dependency by default.
- XR does the heavy lifting: detects installed models, recommends best local model, offers to install it (Ollama auto-install or download via XR's own installer)
- User is shown EACH choice clearly; nothing happens without consent
- The Constitution ("what XR can and cannot do") is shown ONCE in plain language, not legalese
- Final step: a working first conversation with the avatar greeting the user by name

### 10.2 Flow screens (exact order)
1. **Splash** — XR logo + tagline (2s, transitions to welcome)
2. **Welcome** — "Meet XR" (short paragraph, hero avatar, button "Get started")
3. **The XR Promise (Constitution summary)** — 5 plain-language cards (Privacy first · You approve everything · Audit chain · Never lies about capability · Local first) + "I understand" checkbox
4. **System check** — XR auto-scans: OS, RAM, CPU, GPU, microphone, internet, existing models (Ollama, LM Studio, Jan, llama.cpp). Green check / amber warning / red issue for each. If Ollama not found, offer "Install recommended local model" (see below).
5. **Model setup:**
   - Auto-detection result (e.g., "We found Ollama running with Qwen3-8B — great!")
   - If nothing found: "Choose your setup":
     - **Recommended (local):** Download Qwen3.5-3B via Ollama (auto-install Ollama if needed, ~2GB download, one click, with ETA + permission)
     - **Bring your own key:** enter OpenAI/Anthropic/Groq/OpenRouter API key (stored in Stronghold immediately)
     - **I'll configure later:** skip to chat with limited capability
   - **Smart Model Selection explanation** — "XR automatically picks the best model for each task. You can override anytime."
6. **Voice setup** (optional, skippable):
   - Microphone permission request (OS-native dialog)
   - Test mic: "Say something..." (VAD meter shows input, auto-advances when detected)
   - Wake word selection: "Hey XR" (default), or push-to-talk only
   - Voice selection: TTS default (Kokoro, pre-downloaded if possible), gender/language options
7. **Preferences:**
   - Your name (so XR can address you)
   - Language (English default, with ES/UR/FR/DE starters)
   - Daily spend cap slider (default $2/day casual preset; show monthly equivalent; explain why)
   - Quiet hours (default 23:00-07:00)
8. **Telegram / bot connection** (optional, skippable):
   - "Connect Telegram to approve tasks and talk to XR from your phone" (shows QR code + bot link)
   - Skip available
9. **Calibration / first greeting:**
   - Screen darkens, avatar appears
   - "Assalam o Alaikum / Hello, Ahmad. I'm XR. I'm ready when you are." (name injected)
   - Animated test: "You can speak, type, or press Cmd+Shift+X to wake me. What would you like to do first?"
   - Three suggestion cards: "Set up a project" / "Ask me anything" / "Take a tour"
10. **Transition to main dashboard** (with confetti-free subtle animation: orb flies from onboarding screen to the sidebar corner where it lives)

### 10.3 Auto-detection detail
- **Windows:** Check for CUDA GPU, WSL, installed Ollama, winget, microphone permissions (warn if not granted)
- **macOS:** Check Apple Silicon (recommend oMLX for local inference), accessibility permissions (prompt if computer control enabled later), mic permissions
- **Linux:** Check for NVIDIA GPU, PipeWire/PulseAudio, bwrap (required for MCP sandbox — install instruction shown if missing)
- **All platforms:** Detect existing Ollama/LM Studio/llama.cpp/Jan/LocalAI processes; if running, automatically wire them as available providers (no user config needed)

---

## 11. Accessibility (a11y)

XR targets WCAG 2.1 AA as minimum.

- All interactive elements are keyboard-reachable (Tab order, Enter activates, Space toggles, Escape dismisses)
- Focus ring: 2px solid `--xr-core` with 2px offset, visible on keyboard focus (suppress on mouse interaction via `:focus-visible`)
- Minimum text size 12px; body text 14px
- Color: NEVER rely on color alone — status badges also use icons (✓ ⚠ ✕ •), risk tiers use icons + text
- Contrast ratios: body text (metal-hi on ink) ≈ 13.5:1 (AAA); secondary (metal on ink) ≈ 7.8:1 (AAA); cyan on ink ≈ 8:1 (AAA)
- Screen reader support: all images/icons alt-text; aria labels for icon-only buttons; aria-live regions for streaming responses, approvals, status changes
- Reduced motion (§7.3)
- Font scaling: UI respects OS font-size up to 150% without breaking layout
- Voice input as alternative to every text input (microphone icon where relevant)

---

## 12. Cross-platform specifics

| Element | macOS | Windows | Linux |
|---|---|---|---|
| **Window chrome** | Unified titlebar with traffic lights (traffic-left, XR icon and title centered, window controls right) | Standard Windows titlebar with caption buttons | Custom GTK-headerbar style or system default |
| **Font rendering** | Let macOS handle antialiasing; don't apply subpixel hacks | Use default Windows ClearType | Use grayscale antialiasing |
| **System tray** | NSStatusItem (menubar extra, not dock icon) | System tray icon with tooltip | AppIndicator |
| **Global shortcut** | `Cmd+Shift+X` | `Ctrl+Shift+X` | `Ctrl+Shift+X` |
| **Autostart** | LaunchAgent | Registry Run key / Startup folder | XDG autostart `.desktop` |
| **Microphone perm** | tauri-plugin-macos-permissions prompt | WASAPI loopback + system mic dialog | PipeWire/Pulse portal |
| **Computer control backend** | AXUIElement via Cua (requires accessibility permission — show clear OS prompt with instructions) | UIA via Cua | AT-SPI2 via Cua |
| **Sandbox for MCP** | Seatbelt `sandbox-exec` (add profiles) | AppContainer / Job Objects (staged M2+) | bwrap (already exists, promote to Landlock+seccomp) |
| **Keychain/secrets** | Keychain via tauri-plugin-stronghold | Windows Credential Manager via Stronghold | libsecret via Stronghold |

---

## 13. Brand usage rules (for website, marketing, social, CLI, app)

- **Logo clear space:** minimum 50% of the X mark's width on all sides.
- **Minimum logo size:** 24px in digital, 0.5" in print.
- **Logo on dark:** full-color version (silver X, cyan core, atomic ring, tagline in Inter)
- **Logo on light:** single-color dark (ink) version; do NOT place full-color logo on light backgrounds (the glow reads poorly). Produce a monochrome mark.
- **Never stretch/skew the logo.** Never add drop shadows, outer stroke, or recolor.
- **Avatars** are drawn from the three reference images; do not redesign character's silhouette (no pupils, no mouth on helmet, always the cowl of energy, always chest core).
- **Screenshots for marketing must reflect real UI state** (Constitution Article VIII — false panels are banned). If you must use a mockup, mark it "Design preview."

---

## Appendix A: Tailwind Config (drop-in for Tauri React front-end)

```js
// tailwind.config.js (v4 format via @tailwindcss/vite plugin, in tailwind.config.ts)
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        xr: {
          core: "#00E5FF", "core-bright": "#7DF9FF", "core-dim": "#008DA8", "core-ghost": "#003A47",
          void: "#03070D", ink: "#0A0F1A", "surface-1": "#101827", "surface-2": "#1A2332", "surface-3": "#252F40",
          border: "#1E2A3B",
          "metal-hi": "#F0F4F8", metal: "#B7C2CF", "metal-dim": "#6B7889", "metal-low": "#3A4556",
          approve: "#22D3EE", warning: "#F59E0B", deny: "#EF4444", wait: "#A78BFA", money: "#34D399",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Fira Code", "Menlo", "Consolas", "monospace"],
        display: ["Orbitron", "Inter", "sans-serif"],
      },
      boxShadow: {
        "glow-xs": "0 0 6px rgba(0,229,255,0.3)",
        "glow-sm": "0 0 12px rgba(0,229,255,0.35), 0 0 3px rgba(0,229,255,0.5)",
        "glow-md": "0 0 24px rgba(0,229,255,0.4), 0 0 8px rgba(0,229,255,0.3)",
        "glow-lg": "0 0 48px rgba(0,229,255,0.5), 0 0 16px rgba(0,229,255,0.4)",
        card: "0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,229,255,0.05) inset",
        modal: "0 24px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,229,255,0.12)",
      },
      borderRadius: { xl: "16px" },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
        orbit: "orbit 4s linear infinite",
        pulseglow: "pulseGlow 0.8s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
      },
      keyframes: {
        breathe: { "0%,100%": { transform: "scale(1)" }, "50%": { transform: "scale(1.02)" } },
        orbit: { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
        pulseGlow: { "0%,100%": { opacity: 0.8, transform: "scale(1)" }, "50%": { opacity: 1, transform: "scale(1.12)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
    },
  },
  plugins: [],
};
```

---

## Appendix B: Quick reference — "Feeling lost? Use these."

- Background: `bg-xr-ink` / `bg-xr-void` for theater
- Text primary: `text-xr-metal-hi`; secondary: `text-xr-metal`
- Accent/interactive: `text-xr-core`, `border-xr-core`, `shadow-glow-sm`
- Cards: `bg-xr-surface-1 border border-xr-border rounded-lg shadow-card p-5`
- Primary button: `<Button variant="default">` (shadcn `default` remapped to xr-primary)
- Cyan glow on something active: `shadow-glow-sm` + 1px `border-xr-core/50`
- Terminal/voice: use `font-mono` on `bg-xr-void`
- Avatar default: medium (120px) bust on dark, chest core visible
