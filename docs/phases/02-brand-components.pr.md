# Phase 2 — Brand Components (Original Art)

> Branch: `phase/2-brand-components` · Plan: `docs/phases/02-brand-components.plan.md`
> Builds on Phase 1 (merged in #138). Screenshots: `previews/implementation/phase-02/` ·
> Fidelity proofs: `previews/refinement/02b-fidelity-*.png`.

## What landed

The official shared brand components — **Ahmad's original avatar and logo, auto-vectorized
from his uploads**, replacing the Phase-1 placeholder marks (the geometric X is gone,
`MiniAvatar.tsx` deleted):

- **`<Logo variant="icon|full|large" size? className?>`** — the diamond crest from
  `uploads/xr logo (1).png`: icon = emblem crop (sidebar rail, cmdk), full = emblem +
  XR Orbitron wordmark (expanded sidebar), large = complete art incl. tagline with a
  subtle 4s energy breathe (splash/hero size).
- **`<Avatar size state variant showRingsOnSpeak? className?>`** — the sentinel figure
  from `uploads/XR AVATAR .png`: `bust` (full figure), `head` (square helmet crop with
  the glowing eyes + crest + plume), plus `side`/`side2` variants traced from the two
  profile references. 7 states × 5 sizes; states animate only the cyan energy layers
  (idle breathe · listening/speaking pulse + 3 voice rings · thinking orbit dots ·
  sleeping dim · waiting-approval amber pip · error 2s red flash then settle).
  Reduced-motion → static frames. `role="img"` + `aria-label="XR {state}"`.
- **`<CompanionOrb size? state? className?>`** — glossy sphere + tilted 12s ring +
  halo + voice rings, recolored to the brand cyan palette. Drag/window = Phase 6.
- **Vectorization pipeline (regenerable)** — uploads → k-means palette
  (logo k=12 · avatar k=17 · sides k=12/13) → per-color binary vtracer traces +
  3-band alpha halos → generated `components/brand/art.ts` (layers, viewBoxes, crops:
  logo emblem/text split, avatar head crop). 54 palette tokens + `--brand-bright` /
  `--brand-mid` aliases in `themes.css` — no hex outside themes.css, no `<img>`,
  no new dependencies.
- **Wiring** — sidebar logo (icon/full), cmdk icon logo (20px), topbar trigger
  (`sm head`), user-menu label (`md`), sidebar user card (`sm`), chat hero (`lg`).
- **Dev-only QA page** `/#/__brand` — every state × size, head/side variants, logo
  variants, orb state switcher. Guarded by `import.meta.env.DEV`; verified stripped
  from the production bundle (prod `/#/__brand` redirects to chat).

## Fidelity (browser render vs original PNG, on app bg, tol 26/channel)

| Asset | Pixel match | Mean diff |
|---|---|---|
| Logo | 94.8% | 8.4/255 |
| Avatar (front) | 90.9% | 8.2/255 |
| Side 1 / Side 2 | 81.1% / 80.5% | ~18/255 (sub-pixel glow spray) |

## Verification

- `tsc --noEmit` ✅ · `eslint .` ✅ (0 problems) · `vite build` ✅
- Playwright **35/35**: gallery matrix (7 states × 5 sizes + head + sides), var fills
  resolve in computed styles, error red overlay, orb switcher, gradient-id uniqueness,
  paper/arctic glow double-off (0px) vs xr-native 8px, reduced-motion ring suppression,
  shell wiring (chat lg · card sm · trigger sm-head · label md · cmdk 20), production
  route stripping, zero console errors anywhere.
- No `src-tauri/` changes → Rust untouched.

## Out of scope (unchanged)

Voice Theater · orb Tauri window/drag/click (Phase 6) · audio-reactive rings ·
splash (Phase 3) · screen interiors · new dependencies.
