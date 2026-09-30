# XR THEME SYSTEM — v1.0 Final
## 5 canonical themes. User-switchable. Live preview.

Every component supports all 5 themes through CSS variables set at `:root`. No per-theme component forks — tokens swap, components auto-adapt.

---

## Design principles

1. **Contrast first** — all text meets WCAG 2.1 AA on every theme (4.5:1 body, 3:1 large text).
2. **One accent per theme** — accent is always the XR family (cyan/teal/cobalt), never random.
3. **Glow is a tool, not a default** — only XR Native has heavy glow; others use shadows, borders, or flat color.
4. **Metal/silver neutral** — the "metal" secondary shifts per theme (brushed silver / warm gray / steel / ink / soft gray).
5. **All themes feel like XR** — same spacing, radii, typography scale, icon set, motion. Only color tokens + shadow strategy change.
6. **Theme switching is instant (no flash)** — variables swap; no re-render; respects `prefers-reduced-motion`.
7. **Per-surface overrides allowed** — Voice Theater always runs XR-Native-like (deep space) regardless of theme (cinematic exception). CLI auto-detects terminal bg (dark/light) and adapts ANSI.

---

## THEME 1: XR NATIVE (default)
> Deep-space void + cyan glow. The hero theme.

| Token | Value | Usage |
|---|---|---|
| `--bg-void` | `#03070D` | App chrome, deepest surfaces |
| `--bg-ink` | `#0A0F1A` | Cards, panels, sidebar, inputs |
| `--bg-raised` | `#121826` | Hover, selected rows |
| `--bg-overlay` | `rgba(3,7,13,0.72)` | Modals, backdrop blur 16px |
| `--border-subtle` | `rgba(183,194,207,0.08)` | Card borders, dividers |
| `--border-default` | `rgba(183,194,207,0.16)` | Inputs, default borders |
| `--border-accent` | `rgba(0,229,255,0.4)` | Active/focus rings |
| `--text-primary` | `#F0F4F8` | Headings, labels |
| `--text-secondary` | `#9AA8BA` | Body, meta, time |
| `--text-tertiary` | `#5A6678` | Disabled, placeholders |
| `--accent` | `#00E5FF` | XR core cyan |
| `--accent-hover` | `#33EBFF` | Buttons hover |
| `--accent-dim` | `#008DA8` | Accent on dark, progress tracks |
| `--accent-glow` | `rgba(0,229,255,0.45)` | Box-shadow glow (buttons, active) |
| `--metal` | `#B7C2CF` | Silver text, icon strokes |
| `--metal-bright` | `#E8EDF3` | Brushed highlight |
| `--success` | `#34D399` | approvals, done states |
| `--warning` | `#FBBF24` | pending, caution |
| `--danger` | `#F87171` | deny, stop, error |
| `--wait` | `#A78BFA` | Thinking/spinner purple |
| `--shadow-strategy` | **glow-based** — `0 0 0 1px var(--border-subtle), 0 0 20px -4px var(--accent-glow)` for active; `0 8px 32px rgba(0,0,0,0.5)` for elevated. |
| `--editor-bg` | `#070B14` | Monaco background |

---

## THEME 2: GRAPHITE
> Warm industrial grayscale. Matte. Linear-but-softer, milled aluminum.

| Token | Value |
|---|---|
| `--bg-void` | `#4A4A4A` |
| `--bg-ink` | `#5E5E5E` |
| `--bg-raised` | `#707070` |
| `--bg-overlay` | `rgba(60,60,60,0.78)` blur 14px |
| `--border-subtle` | `rgba(255,255,255,0.06)` |
| `--border-default` | `rgba(0,0,0,0.15)` |
| `--border-accent` | `rgba(91,138,158,0.6)` |
| `--text-primary` | `#1A1A1A` |
| `--text-secondary` | `#3A3A3A` |
| `--text-tertiary` | `#6B6B6B` |
| `--accent` | `#5B8A9E` (desaturated steel-cyan) |
| `--accent-hover` | `#6E9DB2` |
| `--accent-dim` | `#3F6778` |
| `--accent-glow` | `rgba(91,138,158,0.20)` |
| `--metal` | `#B0B0B0` |
| `--metal-bright` | `#D0D0D0` |
| `--success` | `#4A8D6E` |
| `--warning` | `#B88A2E` |
| `--danger` | `#B25454` |
| `--wait` | `#7A6BAE` |
| `--shadow-strategy` | **subtle inset + matte drop** — `0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 8px rgba(0,0,0,0.25)`. No glow. |
| `--editor-bg` | `#3F3F3F` |

---

## THEME 3: MIDNIGHT
> Deep navy cobalt. Gentle on eyes for 12-hour sessions. Discord-dark-but-premium.

| Token | Value |
|---|---|
| `--bg-void` | `#0D1422` |
| `--bg-ink` | `#131C2E` |
| `--bg-raised` | `#1A2744` |
| `--bg-overlay` | `rgba(13,20,34,0.80)` blur 16px |
| `--border-subtle` | `rgba(148,163,184,0.08)` |
| `--border-default` | `rgba(148,163,184,0.15)` |
| `--border-accent` | `rgba(59,130,246,0.5)` |
| `--text-primary` | `#E2E8F0` |
| `--text-secondary` | `#94A3B8` |
| `--text-tertiary` | `#55657C` |
| `--accent` | `#3B82F6` (electric cobalt) |
| `--accent-hover` | `#60A5FA` |
| `--accent-dim` | `#1E40AF` |
| `--accent-glow` | `rgba(59,130,246,0.22)` (gentle blue, not neon) |
| `--metal` | `#94A3B8` |
| `--metal-bright` | `#CBD5E1` |
| `--success` | `#10B981` |
| `--warning` | `#F59E0B` |
| `--danger` | `#EF4444` |
| `--wait` | `#8B5CF6` |
| `--shadow-strategy` | **soft blue depth** — `0 0 0 1px var(--border-subtle), 0 8px 28px rgba(15,30,70,0.6), 0 0 12px -6px var(--accent-glow)` |
| `--editor-bg` | `#0A1020` |

---

## THEME 4: PAPER
> Warm cream. Book / iA Writer / Bear. Writers, reading-heavy sessions.

| Token | Value |
|---|---|
| `--bg-void` | `#EDE6D9` |
| `--bg-ink` | `#F5F0E8` |
| `--bg-raised` | `#FAF7F2` |
| `--bg-overlay` | `rgba(220,210,195,0.85)` blur 14px |
| `--border-subtle` | `rgba(60,50,35,0.08)` |
| `--border-default` | `rgba(60,50,35,0.18)` |
| `--border-accent` | `rgba(42,122,111,0.5)` |
| `--text-primary` | `#2B2318` |
| `--text-secondary` | `#5C4F3D` |
| `--text-tertiary` | `#908069` |
| `--accent` | `#2A7A6F` (faded ink-teal) |
| `--accent-hover` | `#379487` |
| `--accent-dim` | `#1B554D` |
| `--accent-glow` | `transparent` (paper doesn't glow) |
| `--metal` | `#8A7C66` |
| `--metal-bright` | `#B5A890` |
| `--success` | `#4F8A5C` |
| `--warning` | `#B8862E` |
| `--danger` | `#B2504A` |
| `--wait` | `#7B6BA8` |
| `--shadow-strategy` | **paper on desk** — `0 1px 2px rgba(60,50,35,0.06), 0 8px 24px -4px rgba(60,50,35,0.12)` |
| `--editor-bg` | `#FBF8F2` |

**Typography note:** Paper theme headings get +0.01em letter-spacing and optional serif toggle (`ui-serif, "Source Serif Pro", Georgia`) in Settings.

---

## THEME 5: ARCTIC
> Pure white light mode. Apple/Sonoma/Linear-light. Crisp.

| Token | Value |
|---|---|
| `--bg-void` | `#FFFFFF` |
| `--bg-ink` | `#F8FAFC` |
| `--bg-raised` | `#F1F5F9` |
| `--bg-overlay` | `rgba(255,255,255,0.78)` blur 20px |
| `--border-subtle` | `rgba(15,23,42,0.06)` |
| `--border-default` | `rgba(15,23,42,0.12)` |
| `--border-accent` | `rgba(6,182,212,0.5)` |
| `--text-primary` | `#0F172A` |
| `--text-secondary` | `#475569` |
| `--text-tertiary` | `#94A3B8` |
| `--accent` | `#06B6D4` (crisp cyan, flat) |
| `--accent-hover` | `#0891B2` |
| `--accent-dim` | `#0E7490` |
| `--accent-glow` | `transparent` |
| `--metal` | `#64748B` |
| `--metal-bright` | `#334155` |
| `--success` | `#059669` |
| `--warning` | `#D97706` |
| `--danger` | `#DC2626` |
| `--wait` | `#7C3AED` |
| `--shadow-strategy` | **light elevation** — `0 1px 2px rgba(15,23,42,0.05), 0 4px 16px -4px rgba(15,23,42,0.10)` |
| `--editor-bg` | `#FFFFFF` |

---

## Theme switching

- Location: **Settings → Appearance** — 5 circular color swatches showing accent+bg preview.
- System option: **"Match system"** (auto light/dark via OS `prefers-color-scheme`; XR Native dark ↔ Arctic light).
- Keyboard shortcut: `⌘/Ctrl+Shift+T` cycles themes.
- Persistence: saved to Tauri Store (`settings.json`), encrypted via Stronghold.
- Implementation: `html[data-theme="xr-native"]` etc.; CSS custom properties cascade; zero per-theme component forks.
- Live preview in Settings on hover/click (instant, no reload).
- Transition: background/border/box-shadow eased 200ms; text/color immediate (no lag).

---

## Component adaptation rules per theme

| Component | XR Native | Graphite | Midnight | Paper | Arctic |
|---|---|---|---|---|---|
| Primary button | bg-accent + glow | bg-accent flat | bg-accent + soft glow | bg-accent flat | bg-accent flat |
| Sidebar active | bg-accent/10 + left glow bar | bg-black/15 + left accent bar | bg-accent/12 + left bar | bg-accent/10 + left bar | bg-accent/10 + left bar |
| Card | bg-ink + subtle border | bg-raised + matte | bg-ink + subtle border | bg-raised + paper shadow | bg-ink + light shadow |
| Input focus | border-accent + glow ring | border-accent | border-accent + soft ring | border-accent | border-accent |
| Tooltip | bg-metal-bright text-black | bg-text-primary text-bg-raised | bg-metal-bright text-void | bg-text-primary text-paper | bg-slate-900 text-white |
| Inline code | bg-black/40 text-accent | bg-black/20 text-accent | bg-black/30 text-accent | bg-black/5 text-accent-dim | bg-black/5 text-accent-dim |
| Modal | glass + glow ring on primary | matte dark panel | glass + soft blue | paper shadow | white card + light shadow |
| XR Avatar glow | heavy cyan core glow | soft steel glow only | soft cobalt glow | subtle teal tint, no glow | crisp cyan, no glow |

---

## Semantic color consistency

- **Success** green — done, connected, approved, online
- **Warning** amber — pending, caution, needs re-auth
- **Danger** red — deny, error, stopped, quarantined, kill
- **Wait** purple — thinking, spinner, loading
- **Accent** theme accent — XR, links, active, primary CTA

Charts and data viz use the same semantic mapping (Recharts theme per token set) so they read correctly in every theme.
