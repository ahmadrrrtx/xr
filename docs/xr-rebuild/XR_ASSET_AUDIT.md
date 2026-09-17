# XR — Asset & Brand Audit

> Evidence date 2026-09-17. Tags: [OBSERVED] / [INFERRED] / [RECOMMENDED].
> Rule honored: official logo + avatar are the source of truth; nothing invented replaces them.

## 1. Inventory

| Asset | Path | Specs [OBSERVED] | Content |
|---|---|---|---|
| Avatar (primary) | `assets/avatar.png` | 512×449, RGBA, ~191 KB, pHYs set | Painterly dark AI bust: glossy black hooded head, glowing cyan slit-eyes, luminous blue chest core; brush-stroke shoulders; **light/near-white backdrop** |
| Logo (primary) | `assets/logo.png` | 458×382, RGBA, ~152 KB | Metallic silver "X" blade mark + orbital ring + glowing blue orb core; wordmark "XR"; tagline "The AI Agent You Can Actually Trust"; **black backdrop** |
| Avatar front | `assets/brand/avatar-front.png` | 806×656 RGBA | Same character, frontal, cyan energy wings, starfield dark backdrop |
| Avatar hero | `assets/brand/avatar-hero.png` | 845×656 RGBA | Hero variant (dark starfield) |
| Palette reference | `assets/brand/palette-reference.png` | 712×154 RGBA | Brand palette strip |
| Avatar SVG | `assets/avatar.svg` | viewBox 96×96 | Flat geometric: circle #0A0A0F, gradient stroke #00D4FF→#6048F8, cyan "V" + violet strokes forming X, green dot #00FF88 |
| Logo SVG | `assets/logo.svg` | viewBox 120×96 | Same mark in rounded-rect tile |
| Seccomp BPF | `assets/seccomp/*.bpf` | binary | sandbox blocklists (functional asset, not visual) |

## 2. Brand analysis

### 2.1 Two identities (finding BUG-002)
- **Rendered identity (PNG):** cinematic 3D character + metallic X-orb logo; premium, sci-fi, trustworthy tone; tagline present.
- **Geometric identity (SVG):** minimal flat mark (X-in-circle/tile), gradient cyan→violet, green status dot; engineered, icon-suitable.
- They share palette but not geometry: the SVG's X is a stroked chevron-pair; the PNG's X is a metallic blade cross with orbit. [OBSERVED]
- **Consequence:** favicon/app-icon/SVG contexts and hero/marketing contexts currently speak different marks. [INFERRED]

### 2.2 Color system (extracted)
- Cyan `#00D4FF` (primary energy/eyes), Violet `#6048F8` (secondary), Green `#00FF88` (status/alive), Near-black `#0A0A0F` (ground), plus painterly blues in renders. Dashboard tokens add red/amber for states. [OBSERVED]
- Semantic read: cyan = XR presence/energy; green = safe/alive/allowed; violet = depth/intelligence; amber/red reserved for risk. [INFERRED → design system]

### 2.3 Avatar states available vs needed
- Available: bust-light (avatar.png), front-dark-wings (avatar-front), hero (avatar-hero). No states for listening/thinking/error/approval. [OBSERVED]
- Needed for voice/modes: idle, listening, thinking, working, speaking, interrupted, stopped, error, waiting-approval. [RECOMMENDED: derive as motion/glow treatments over the official front render + geometric mark states, not new characters]

### 2.4 Typography & iconography today
- No bundled brand typeface; CLI uses ANSI art banner (▀▄▀ █▀█); dashboard uses system sans/mono tokens. Icons: minimal/absent; no icon set. [OBSERVED]

## 3. Dispositions

| Asset | KEEP | REPLACE | REGENERATE | CREATE |
|---|---|---|---|---|
| avatar.png / brand renders | ✔ source of truth | — | — | state treatments (glow/eye/motion overlays) for voice/modes |
| logo.png | ✔ marketing/hero | — | — | clean extraction: mark-only, wordmark-only, lockups (horizontal/stacked), mono variants |
| avatar.svg / logo.svg | — | ✔ unify geometry with PNG mark (one canonical vector mark derived from the official logo's X+orb, keeping gradient + green dot) | — | full icon-scale set (16/24/32/48/512), favicon, tray icons (mono/light/dark) |
| icon system | — | ✔ (none exists) | — | new 24px grid icon set (see Design System) |
| ASCII banner | — | ✔ official lockup in TUI (safe-area Unicode box w/ logo glyph) | — | — |
| palette-reference.png | ✔ reference | — | — | tokenized palette (Design System) |
| seccomp BPF | ✔ functional | — | — | — |

## 4. Brand usage rules for XR Desktop [RECOMMENDED]

1. **One mark, many renditions:** canonical vector X+orb mark (from logo.png geometry) with gradient; flat mono variants for tray/favicon/CLI; never a second logo.
2. **Avatar = presence:** the character appears only as XR's *presence* (voice orb, onboarding meet-XR, empty-state companion, approval requester identity), never as decoration.
3. **Light/dark:** dark ground #0A0A0F-family is primary (matches renders); light mode uses ink-on-paper with cyan/violet accents at AA contrast; avatar switches to front-dark render on dark, bust-light on light.
4. **Tagline** used only in onboarding/about/marketing surfaces.
5. **No neon-glass:** glows reserved for *state* (listening/working/approval), aligned to semantic colors.
6. Desktop window identity: mark in titlebar/tray; wordmark "XR" + surface name (e.g., "XR — Work").

## 5. Concept-asset plan (this phase only)

- 10 visual concepts (see README index) rendered with official logo/avatar reference imagery and the target IA; stored under `docs/xr-rebuild/concepts/`.
- Vector mark unification sheet (geometry spec: blade angles, orbit ellipse ratio, orb radius, gradient vector, green dot placement) as SVG spec doc in Design System. [RECOMMENDED]
