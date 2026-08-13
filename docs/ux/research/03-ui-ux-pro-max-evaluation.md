# ui-ux-pro-max skill — evaluation & adoption

Researched 2026-08-13. Source:
`github.com/nextlevelbuilder/ui-ux-pro-max-skill` (v2.11.0, MIT). We studied
its methodology per mission §4. **We do not install the skill or add it as a
dependency** — we extract its rules into XR's own design process, because XR's
brand and runtime are authoritative.

## What the skill is

A searchable local database of UI/UX rules: 84 styles, 192 palettes, 74 font
pairings, 192 product types with reasoning, 98 UX guidelines, 104 icons,
16 GSAP motion presets, 25 chart types, 22 stacks. Key workflow:
`--design-system` generation (pattern + style + colors + typography + effects
+ anti-patterns), then per-domain lookups.

## What we adopt (as process rules, not code)

| Rule (paraphrased) | Where it lands in XR |
|---|---|
| **Accessibility is priority 1**: contrast ≥ 4.5:1, keyboard nav, aria-labels, never remove focus rings | `09-accessibility.md`; enforced by existing `test/a11y/contrast.test.ts` + axe sweep |
| **No emoji as icons** — use SVG line icons | Audit finding: dashboard uses 🎤 🛡 ⌘ 🔬 in places → replaced with inline SVGs (`10-component-architecture.md`) |
| **Min touch target 44×44 (web ≥ 32–36 with spacing), 8px+ spacing** | Dashboard button/control minimums in `06-design-system.md` |
| **Motion 150–300 ms, convey meaning, respect reduced-motion, no decorative-only animation** | `08-motion-system.md` |
| **Base font 16px body / 1.5 line-height; semantic color tokens; no raw hex in components** | `06-design-system.md` — raw hex only in `src/ui/tokens.ts` |
| **Loading feedback for every async action; errors near the field; progressive disclosure; no placeholder-only labels** | `11-ui-state-model.md`, `05-user-flows.md` |
| **Design dials**: variance (minimal→bold), motion (subtle→complex), density (spacious 24–96 / standard 16–64 / dense 8–32) | XR locks **low variance, low motion, dense-to-standard density** — a tool, not a showroom |
| **Style selection must match product type; consistency; SVG icons** | `07-visual-direction.md` — XR = "dark, minimal, technical, precision" (its existing 3.1 identity), not glassmorphism-by-default |
| **Pre-delivery checklist** (icon discipline, interaction feedback, light/dark contrast, safe areas, a11y) | Adopted verbatim as the per-phase gate in `12-implementation-roadmap.md` §Gate |

## What we explicitly reject

- **Styles that fight XR's identity** (neon gaming dashboards, skeuomorphism,
  playful gradients): XR's brand is cyan/indigo on deep navy, precision 1px
  borders, monospace metrics — already codified in `src/ui/tokens.ts` and the
  official assets.
- **Wholesale style-forking**: we keep XR's own tokens as the single source of
  truth and use ui-ux-pro-max only as a *checklist and reasoning aid*.
- **Any runtime dependency**: no npm package, no CLI install. Process only.

## Process integration

Each implementation phase's design pass runs a two-minute self-check against
the adopted rules above (a condensed "UX Pro Max check" in the phase gate),
recorded in the phase result notes (`12-implementation-roadmap.md`).
