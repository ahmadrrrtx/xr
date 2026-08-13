# 07 — Visual Direction

**Date:** 2026-08-13. The look must feel like a **precision instrument**, not
a gaming dashboard. Mission §22 allows glassmorphism/gradients but requires
readability, contrast, performance, and hierarchy first.

## 1. Design principles (ranked)

1. **Calm darkness.** Deep navy field, neutral chrome, one accent at a time.
2. **Precision.** 1px borders, aligned grids, monospace for data, crisp SVG
   lines. Existing identity — keep.
3. **Honesty as aesthetics.** States are literal (real data), never decorated
   away. A "Safe" badge looks safe because it is verified.
4. **Glow discipline.** Cyan glow only on the active/focus element or the
   avatar visor; never a glow on everything.
5. **Progressive depth.** Surface hierarchy via elevation (bg → bg-2 →
   surface → surface-2) plus 1px borders — minimal reliance on shadows.
6. **The avatar is the personality.** Everything else is instrument chrome.

## 2. Visual language per surface

| Surface | Treatment |
|---|---|
| **Dashboard** | Liquid 3-pane (sidebar / main / inspector). Sidebar `bg-2`; main `bg`; cards `surface` with 1px `border`. Header topbar `bg-2` with breadcrumb + status chips. No heavy blur anywhere; a subtle `backdrop-filter` is permitted only on the command palette & popovers, max 8px blur, behind 85%+ opaque surface (readability first). |
| **Chat** | Flat full-width messages. User = right-aligned subtle `surface-2` block; assistant = left-aligned on transparent with avatar chip. Tool timeline = slim cards with icon + verb + status dot + expandable body. |
| **Empty states / onboarding** | Hero avatar with soft radial cyan halo (`--xr-gradient-shield`), one headline, one CTA, 3–4 capability chips. |
| **Voice mode** | Avatar centered, larger, with state ring (listening = cyan breathing ring; thinking = subtle orbiting dot; speaking = gentle pulse tied to real TTS; idle = dim). Ring + glow intensity only — never modify the avatar art. |
| **TUI** | Existing ANSI identity; add `secondary` indigo where accent needed; keep monospace density. |
| **Website** | Follows same tokens (already Next+framer+tailwind); keep marketing-grade polish but brand-consistent. |

## 3. Glassmorphism policy (mission §22)

- **Allowed:** command palette, popovers, floating companion (future), toast.
  These are transient layers where translucency communicates "on top".
- **Forbidden:** glass cards in main content, glass sidebar, glass chat
  messages — hurts readability and costs performance.
- Every translucent surface: `rgba` background ≥ 0.85 opacity + blur ≤ 8px +
  1px border + solid fallback when `prefers-reduced-transparency` or no
  `backdrop-filter` support.

## 4. Gradients policy

- Brand gradient `#00D4FF → #7AA7FF → #6048F8` (secondary corrected) — only:
  logo, hero wordmark, premium badges, progress fills.
- Never on buttons, never on body text, never on large backgrounds.

## 5. Motion direction

Minimal. Only state-explaining motion; durations 80–200 ms; springs only for
popovers/avatar; everything guarded by `prefers-reduced-motion`
(details: `08-motion-system.md`).

## 6. What we will NOT ship visually

- Neon/dark-gaming gradients, particle fields, floating orbs (except avatar
  halo), 3D backgrounds, animated brand mark, emoji icons, SMS bubbles,
  oversized hero carousels in product UI, fake depth, heavy blur on main
  surfaces, decorative animation of any kind.
- Any visual that can't be verified against real runtime state.

## 7. New supporting assets (mission §23) — only if needed

Spec: all must use the official palette (navy field, cyan glow, indigo
accents, geometric precision):
1. Empty-state illustration (avatar + orbit ring) — can be pure SVG/CSS,
   no new raster needed.
2. Onboarding step illustrations — SVG from palette.
3. Floating companion mark (future) — avatar chip + ring, CSS.
No asset bloat: prefer SVG/CSS compositions over new rasters; the only new
rasters allowed are curated copies of supplied avatar variants into
`assets/brand/`.

## 8. Density & responsiveness (mission §27)

- Breakpoints: ≥1200 full 3-pane; 960–1200 hide inspector (toggle);
  640–960 sidebar collapses to icon rail; <640 stack (chat first). The
  dashboard is desktop-first; the *website* is responsive-first.
- Content max-width ~900px in chat for line-length comfort; panels fluid.
- No horizontal scroll anywhere; tables wrap or scroll internally.
