# 06 — XR Design System (v2)

**Date:** 2026-08-13 · **Authority:** official brand assets (pixel-verified,
`docs/ux/research/04-brand-asset-analysis.md`) + runtime truth. This document
supersedes conflicting values in `src/ui/tokens.ts` / `src/daemon/dashboard/styles.ts`
for the three deliberate changes below; it is the single design authority.

## 1. Brand

| Attribute | Value |
|---|---|
| Name | XR — "The AI Agent You Can Actually Trust" |
| Mark | Official `assets/logo.png` (cyan→indigo gradient monogram, never redrawn) |
| Avatar | Official `assets/avatar.png` / supplied variants (cybernetic guardian, cyan visor) |
| Terminal wordmark | ASCII `▀▄▀ █▀█ / █░█ █▀▄` (existing) |
| Voice | Precise, concise, technical-warm (existing) |

## 2. Color — semantic tokens (dark-first; single source of truth)

| Token | Hex | Use | Status |
|---|---|---|---|
| `bg` | `#0A0A0F` | app background | keep |
| `bg-2` | `#0D1117` | sidebar/topbar | keep |
| `surface` | `#111827` | cards, panels | keep |
| `surface-2` | `#1A2234` | inputs, selected | keep |
| `border` | `#1F2937` | default borders | keep |
| `border-2` | `#2D3748` | hover borders | keep |
| `text` | `#F9FAFB` | primary text | keep |
| `text-dim` | `#9CA3AF` | secondary | keep |
| `muted` | `#7A8FB0` | tertiary (≥ 5:1 contrast — a11y fix already shipped) | **align tokens to dashboard's verified value** |
| `primary` (cyan) | `#00D4FF` | brand primary | keep (asset-verified) |
| `secondary` (indigo) | `#6048F8` | brand gradient end, avatar accents, premium marks | **CHANGE from `#A855F7` (F-3, asset-verified)** |
| `success` (green) | `#00FF88` | local/ok/safe | keep |
| `warning` (amber) | `#F59E0B` | warnings, cloud route, pending | keep |
| `error` (red) | `#FF4D4D` | errors, blocked | keep |
| `info` | `#00D4FF` | informational | keep |
| `on-primary` | `#001018` | text on cyan | keep |

**Backgrounds:** keep `#020817`-family deep-space values if the dashboard
wants a darker frame, but **declare them as tokens**, never a second palette.

### Color rules (mission §22, existing 3.1 rules, ui-ux-pro-max)
1. Neutrals carry ~90% of the UI. Cyan is the "XR is interacting" signal — sparing.
2. Red only for must-look-now. Green = safe/local. Amber = attention.
3. **Locality code:** local/offline-safe = green; cloud/BYOK = amber; blocked/
   needs-network = neutral/red. Used by the F-7 locality badge everywhere.
4. Contrast ≥ 4.5:1 body, ≥ 3:1 large text & interactive boundaries
   (WCAG 1.4.3 / 1.4.11) — enforce via existing `test/a11y/contrast.test.ts`.
5. Raw hex only inside `src/ui/tokens.ts`. Components consume tokens.

## 3. Typography

| Token | Spec | Use |
|---|---|---|
| `font-sans` | Inter, system-ui stack | UI text |
| `font-mono` | JetBrains Mono, Fira Code, Cascadia Code, monospace | code, metrics, IDs, terminal |
| `font-display` | Syne (fallback Inter) | hero/display only — sparing |
| scale | display 48 / h1 24 / h2 18 / h3 14 / body 13–14 / small 12 / xs 11 / mono 12 / composer 14 | existing |
| base | body ≥ 13px; ensure ≥ 12px minimum everywhere; labels 10–11px uppercase letter-spacing 0.08–0.12em | labels not body |

## 4. Spacing / density

- Grid: 4px. Existing `SPACE` tokens (4/8/12/16/20/24/32/48/96).
- Density: `compact 28 / default 36 / cozy 44` rows (existing `DENSITY`),
  exposed as a user setting; default = default.
- Touch/min targets: interactive ≥ 32px height web, ≥ 44px where touch.

## 5. Radius

`sm 4 / md 8 / lg 12 / xl 16 / full`. Cards md, controls sm–md, dialogs xl,
avatar/status dots full. Precision aesthetic: no oversized radii.

## 6. Shadows & elevation

| Token | Value | Use |
|---|---|---|
| sm | `0 1px 2px rgba(0,0,0,.4)` | subtle |
| md | `0 4px 24px rgba(0,0,0,.4)` | cards/panels |
| lg | `0 12px 44px rgba(0,0,0,.5)` | modals |
| focus | `0 0 0 1px rgba(0,212,255,.4), 0 0 20px rgba(0,212,255,.15)` | keyboard focus (never removed) |
| glow-* | cyan/green/amber/red 20px at 12–20% | state glows only |

## 7. Component tokens (new, reusable)

| Component token | Spec |
|---|---|
| `control-h` | 32px (inputs/buttons), 28px compact |
| `control-radius` | sm (4) buttons, md (8) inputs |
| `card-pad` | 16px |
| `panel-pad` | 24px |
| `sidebar-w` | 240px (collapsible → 64 icon rail) |
| `inspector-w` | 320px |
| `status-dot` | 8px with 2px ring; animate only for active states |
| `toast` | bottom-right, 4px radius, 12px text, ≤ 6 s |
| `scrollbar` | 6px, border-2 track, cyan hover (existing) |

## 8. Status semantics (shared TUI + GUI)

`ok / warn / error / info / active / idle / local / cloud` — colors in
`STATUS_COLOR` (existing) extended with `secondary`. Badges show **icon + text
+ color**, never color alone (a11y).

## 9. Icons

- Inline SVG line icons only (24×24 viewBox, stroke 1.5–2, currentColor).
- No emoji-as-icons (F-4). Centralize in `src/ui/icons.ts` (existing) and
  reuse in the dashboard (currently inline in markup — refactor to one icon
  set).

## 10. Terminal tokens (ANSI mapping)

Keep `src/ui/theme.ts` machinery (truecolor/256/16/mono/NO_COLOR) and the
brand ANSI frames. Update `RGB.secondary` to `#6048F8` when the web token
changes, so TUI + GUI stay identical (F-3). Add `secondary` to
`ANSI16`/fallbacks.

## 11. Light theme

Out of scope (existing 3.1 rule). Tokens are dark-designed; a future light
theme must derive from the same semantic names.

## 12. Conformance

- One authority: `src/ui/tokens.ts` (+ `cssVarsBlock()`), consumed by
  dashboard CSS and website. The dashboard's hand-maintained `:root` is
  replaced/derived (F-2).
- CI: extend `test/a11y/contrast.test.ts` to assert token pairs; add a unit
  test that dashboard CSS variables equal token values (drift lock).
