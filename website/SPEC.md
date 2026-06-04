# XR Website — Design Specification

## 1. Concept & Vision

**XR** — "The AI Agent You Can Actually Trust." A cybersecurity-focused, JARVIS-style AI agent that runs on YOUR API key, YOUR hardware, YOUR rules. The website should feel like entering a secure command center — dark, precise, powerful — but approachable enough for developers and power users. Think: Iron Man's JARVIS meets a premium open-source tool.

The site should communicate: **trust, power, control, and zero-compromise privacy.**

## 2. Design Language

### Aesthetic Direction
**"Cybernetic Command Center"** — Deep space blacks, electric cyan as the primary accent (like a HUD display), neon green for highlights (JARVIS energy), and amber for badges/warnings. Clean grid layouts with subtle glow effects. Glass-morphism for cards. Not aggressive cyberpunk — refined and professional.

### Color Palette
```
--bg-primary:      #020817   (deep space black)
--bg-secondary:    #0A0F1E   (dark navy)
--bg-card:         #0F172A   (slate-900)
--border-glow:     rgba(0, 212, 255, 0.15)
--cyan-primary:    #00D4FF   (main accent)
--cyan-muted:      #0EA5E9   (slate-400)
--green-electric:  #00FF88   (secondary accent)
--green-muted:     #10B981   (emerald)
--amber-warn:      #F59E0B   (warnings, badges)
--text-primary:    #F8FAFC   (slate-50)
--text-secondary:  #94A3B8   (slate-400)
--text-muted:      #475569   (slate-600)
```

### Typography
- **Headings**: `Syne` (Google Fonts) — geometric, futuristic, bold
- **Body**: `Plus Jakarta Sans` — clean, readable, modern
- **Code/Terminal**: `JetBrains Mono` — developer-friendly, distinctive
- **Fallbacks**: system-ui, -apple-system

### Spatial System
- Section padding: `py-24` (96px vertical)
- Container max-width: `max-w-7xl` with horizontal padding
- Card padding: `p-8` or `p-6`
- Gap between cards: `gap-6` or `gap-8`

### Motion Philosophy
- **Entrance animations**: fade-in + slide-up on scroll, staggered 100ms
- **Hover effects**: scale(1.02) + glow border on cards
- **Hero avatar**: rotating rings animation (continuous), pulsing glow
- **Number counters**: animated count-up on scroll into view
- **Tabs**: smooth slide transitions
- **No jarring motion** — everything should feel smooth and controlled

### Visual Assets
- **Icons**: Lucide React (consistent, clean line icons)
- **Avatar**: `https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png`
- **Logo**: `https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/logo.png`
- **Background**: CSS grid pattern with radial gradient overlays
- **Decorative**: Subtle grid lines, glowing orbs, glass cards

## 3. Layout & Structure

### Page Flow
1. **Sticky Navbar** — logo left, nav links center, CTA right. Glass effect on scroll.
2. **Hero** — Full viewport height. Avatar in center with animated rings. Headline + subheadline + stats bar + two CTAs. Background grid pattern with cyan glow.
3. **Comparison** — "Why XR?" table showing features vs competitors. Dark card with cyan borders.
4. **Core Pillars** — 4 big differentiators in horizontal cards: BYOK, JARVIS Control, Cost Governor, Tamper-Evident.
5. **Features Grid** — 12 feature cards in 3-column grid. Icon + title + description.
6. **AI Providers** — Logo grid showing all 12 providers. Clean, organized.
7. **Install** — OS tabs with one-command install. Most important conversion section.
8. **Security** — Visual representation of audit log chain, spend ceiling, injection defense.
9. **Testimonials** — 3 quote cards with stats.
10. **FAQ** — Accordion with 6-8 common questions.
11. **Footer** — Minimal. GitHub stars, links, by @ahmadrrrtx.

### Responsive Strategy
- Desktop: 3-4 column grids, full navbar
- Tablet: 2 column grids, condensed navbar
- Mobile: 1 column, hamburger menu, stacked elements

## 4. Features & Interactions

### Navbar
- Transparent on top, glass (backdrop-blur) on scroll
- Mobile hamburger menu with slide-down animation
- Active section highlighting

### Hero
- Avatar with continuous rotation animation on rings
- Stats bar with animated counters on mount
- CTA buttons with hover glow effect
- Scroll indicator with bounce animation

### Comparison Table
- Sticky header row
- Checkmarks (green) vs X marks (red) for features
- XR column highlighted with cyan border

### OS Install Tabs
- Tab switching with smooth underline indicator
- Copy-to-clipboard on each command block
- Toast notification on copy

### FAQ Accordion
- Smooth height animation on expand/collapse
- Chevron rotation on toggle
- Only one open at a time

## 5. Component Inventory

### Navbar
- States: transparent, scrolled (glass), mobile menu open
- Logo + nav links + GitHub button + hamburger

### HeroSection
- Avatar image with CSS ring animations
- Headline (2 lines, large)
- Subheadline (single line)
- Stats row (4 items with animated numbers)
- Two CTA buttons (primary cyan, secondary outline)
- Scroll indicator

### ComparisonTable
- Header row with product names
- Feature rows with check/X icons
- XR column special styling

### FeatureCard
- Icon (Lucide) in colored circle
- Title (bold)
- Description (muted text)
- Hover: scale + glow border

### InstallSection
- OS tab bar
- Terminal-style code block
- Copy button
- Optional install section
- Note text

### SecuritySection
- Visual audit log chain (connected blocks)
- Spend ceiling meter visualization
- Injection defense diagram

### FAQAccordion
- Question (clickable)
- Answer (animated expand)
- Chevron icon

### Footer
- Logo + tagline
- Link columns
- GitHub stats
- Copyright

## 6. Technical Approach

### Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS 3.4+
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Fonts**: Google Fonts (Syne, Plus Jakarta Sans, JetBrains Mono)
- **Language**: TypeScript

### Key Implementation Notes
- Use `"use client"` directive for animations and interactivity
- Framer Motion for scroll-based animations with `useInView`
- Intersection Observer via Framer Motion's `whileInView`
- CSS custom properties for colors to enable consistent theming
- `useState` for tab selection, accordion state, mobile menu
- Ambient animations via CSS keyframes for avatar rings

### File Structure
```
website/
├── app/
│   ├── page.tsx          # Main landing page (all sections)
│   ├── layout.tsx        # Root layout with fonts, metadata
│   └── globals.css       # Custom CSS, animations, scrollbar
├── lib/
│   └── utils.ts          # Helper functions (cn, etc.)
├── tailwind.config.ts    # Extended with custom colors
├── next.config.js
├── postcss.config.js
├── tsconfig.json
├── package.json
└── vercel.json
```