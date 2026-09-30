# Phase 2 — Brand Components · Implementation Plan

> Contract: `docs/IMPLEMENTATION-PLAN.md` §PHASE 2, `docs/DESIGN-SYSTEM.md` §6 (XR Avatar) + §4.2 + §7 (motion),
> `docs/THEME-SYSTEM.md` (component adaptation table), `docs/SCREEN-BRIEFS.md` §OV-2/OV-3.
> Visual truth: `uploads/XR AVATAR .png`, `uploads/XR Avatar side face.png`, `uploads/XR Aavatar side face 2 .png`,
> `uploads/xr logo (1).png` (the numbered preview PNGs referenced by the brief are not in the workspace —
> the uploaded assets + docs carry the spec).
> Replaces Phase 1's temporary `Logo.tsx` / `MiniAvatar.tsx`.

## Research summary (Step 2)

1. **Glow** — CSS `filter: drop-shadow(0 0 Npx var(--accent-glow))` traces the element's alpha (perfect for
   almond eyes / core / ring), inherits theme vars, and avoids SVG `<filter>` id collisions entirely. Native
   feGaussianBlur filters need widened filter regions and document-global unique ids — not worth it here.
2. **Gradients along paths** — true along-stroke gradients require path slicing (Bostock technique); instead
   plasma trails are *filled tapered brush-stroke paths* (wide at the shoulder, thin at the tip) with a
   linearGradient fill oriented along the sweep — simpler and matches "brush stroke" language.
3. **CSS vars in SVG gradients** — `stop-color` is a supported CSS styling mechanism (W3C SVG styling), so
   `<stop style={{ stopColor: 'var(--metal)' }} />` works in WebView2 / WKWebView / WebKitGTK.
4. **id collisions** — SVG gradient/filter ids are document-global; every defs block gets a `useId()`-unique id
   so multiple avatars/logos on one page never cross-reference the wrong defs.
5. **Motion** — Framer `useReducedMotion()` (already the Phase 1 pattern in PageTransition); DESIGN-SYSTEM §7.2
   values (breath 4s scale 1↔1.02, core pulse 1.2s, thinking orbit 1.2s/4s, springs 380/26).

## Files

| File | Purpose |
|---|---|
| `src/components/brand/types.ts` | `AvatarState` (7), `AvatarSize` (xs/sm/md/lg/xl → 16/24/40/80/200), `AvatarVariant` (head/bust/orb), `LogoVariant` (icon/full/large) |
| `src/components/brand/defs.tsx` | Shared SVG defs factory (React `useId` namespacing): metal gradient, helmet radial, plasma gradient, core radial — all stops via CSS vars |
| `src/components/brand/Logo.tsx` | **Replaces** Phase 1 temp: `icon` (flat silver X + core), `full` (X + Orbitron "XR"), `large` (beveled gradient X, 2 orbit ellipses, electron bead, breathing core) |
| `src/components/brand/Avatar.tsx` | The sentinel: state machine (7 states), 3 detail tiers (tiny xs·sm / bust md·lg·xl / orb→CompanionOrb), theme-adaptive glow, reduced-motion, speaking rings, thinking orbit, error flash, sleeping slits |
| `src/components/brand/CompanionOrb.tsx` | Widget orb: glossy sphere, eyes, core dot, tilted ring (12s rotation), halo, voice wave rings (no drag — Phase 6) |
| `src/components/brand/index.ts` | Public exports + types |
| `src/components/brand/BrandGallery.tsx` | Dev-only QA page content (used by `/__brand`) |
| `src/router.tsx` | Dev-only `/__brand` route behind `import.meta.env.DEV` |
| `src/styles/themes.css` | New tokens per theme: `--avatar-glow-strength` (8px/3px/6px/0/0) and `--accent-2` (plasma tip blue per theme) |
| `src/components/layout/Sidebar.tsx`, `UserMenu.tsx`, `cmdk/CommandPalette.tsx`, `screens/Chat/index.tsx` | Wiring: real components replace placeholders |
| `src/components/brand/MiniAvatar.tsx` | **Deleted** (superseded by `<Avatar variant="head">`) |

## Component APIs

```tsx
<Logo variant="icon" | "full" | "large" size?: number className?: string />
   // defaults: icon 28 · full wordmark 20 · large 120
<Avatar size="xs|sm|md|lg|xl" state={AvatarState} variant="head|bust|orb"
        showRingsOnSpeak?: boolean className?: string />
   // defaults: size md · state idle · variant bust · rings true
<CompanionOrb size?: number state?: AvatarState className?: string />
   // defaults: 80 · idle — drag explicitly out of scope (Phase 6)
```

## SVG breakdown

- **Logo large (viewBox 200×200):** X = four chiseled arm paths (each a filled quad, wider at outer edge,
  mitered center) with per-arm linear gradients (metal-bright top-left → metal → darker bottom-right) = bevel;
  ring A = horizontal `<ellipse>` rx 88 ry 26 stroke metal 3px; ring B = same ellipse rotated 30°, animated
  slow rotation 8s; electron bead = `motion.circle` r 3 on ring A (20s loop); core = radialGradient
  (accent-bright center → accent → transparent) + drop-shadow glow, breathing opacity 0.7↔1 (3s).
  `icon`: two stroked diagonals + core dot (solid `var(--metal)`, readable at 16–28px). `full`: icon 24px +
  Orbitron wordmark.
- **Avatar bust (viewBox 200×230, scaled by size):** helmet = smooth egg path, radial gradient
  (`var(--brand-ink)` base, top-left `var(--metal)` highlight at low opacity → glossy black); eyes = two almond
  paths (Q-curve teardrops tilted inward, fill `var(--accent)`, drop-shadow glow, **no pupils**); chest core =
  **single perfect circle** with core radial gradient + glow (**no segments ever**); shoulders = two black
  curves with `var(--metal)` rim-light strokes at low opacity; trails = 3–4 tapered filled paths sweeping
  up-back from the neck, plasma gradient (`var(--accent)` → `var(--accent-2)`), stroke-linecap round;
  speaking rings = 3 `motion.circle` (scale 1→3, opacity 0.8→0, 1.5s repeat, staggered);
  thinking = orbit dot around helmet (1.2s); waiting = amber shield glyph top-right + pulse;
  error = danger-colored eyes/core flashing 3× over 2s then settling dim; sleeping = horizontal slit paths,
  everything dim, no glow.
- **CompanionOrb (viewBox 100×100):** sphere radial gradient (highlight top-left), same eye/core glyphs scaled,
  tilted equatorial ellipse (rotate ~20°, stroke `var(--accent)` 2px, 12s linear rotation), halo drop-shadow,
  listening/speaking wave rings.

## State matrix (exact motion values)

| State | Eyes | Core | Trails | Extra |
|---|---|---|---|---|
| idle | cyan 0.7, breath 4s | scale 0.95↔1 / opacity 0.6↔1, 4s | opacity 0.4↔0.6, 3s | — |
| listening | 1.0, narrowed | opacity 1, pulse 1.5s | 0.9, flicker | subtle inward rings |
| thinking | narrowed, dim | steady | 0.7 | orbit dot 1.2s |
| speaking | cadence flicker 0.2–0.5s | brightest, pulse 1.2s, scale 1↔1.12 | 1.0 | 3 rings outward 1.5s |
| waiting-approval | slightly wider | cyan, attention pulse | 0.5 | amber shield badge |
| error | `var(--danger)` flash ×3 (2s) → dim cyan | red flash ×3 → dim | red tint 2s | settles, never stays red |
| sleeping | closed horizontal slits 0.4 | 0.2, 6s breath | hidden | — |

All transitions spring 380/26. `prefers-reduced-motion` → static mid-brightness frame, no loops.

## Theme adaptation

- Glow: `filter: drop-shadow(0 0 var(--avatar-glow-strength) var(--accent-glow))` — new token
  `--avatar-glow-strength`: xr-native 8px · graphite 3px · midnight 6px · paper 0px · arctic 0px
  (paper/arctic also have `--accent-glow: transparent` — double-off).
- Trail tip: new `--accent-2` token per theme (xr-native #38BDF8 · graphite #7FA3B5 · midnight #60A5FA ·
  paper #2A7A6F · arctic #0E7490) — declared once in themes.css, never in components.
- Everything else reads `--accent`, `--metal`, `--metal-bright`, `--brand-ink`, `--warning`, `--danger` —
  theme switch is instant (CSS var cascade, no JS).

## Accessibility

- `role="img"` + `aria-label="XR {state}"` (e.g. "XR listening"); decorative usages (cmdk mini-logo,
  inline chips) get `aria-hidden="true"` from the call site. Not focusable. No sound. Reduced-motion honored.

## Wiring (5.6)

- Sidebar top: `Logo variant="icon|full"` (same call signature as Phase 1 — internals upgraded).
- Topbar/UserMenu avatar + sidebar user card: `<Avatar size="sm" variant="head" />` (24px) / `md` in the menu
  header (replaces MiniAvatar everywhere; file deleted).
- cmdk input: `<Logo variant="icon" size={20} />`.
- Chat placeholder card: `<Avatar size="lg" state="idle" />` hero touch.

## Dev preview page

`/__brand` (router entry only when `import.meta.env.DEV`): 5 themes × 7 states grid at md, all 5 sizes in
idle, Logo icon/full/large, CompanionOrb with a state switcher.

## Test checklist (Step 6 gate)

typecheck / lint / build green · `/__brand` renders all states × sizes × themes · animations per matrix ·
reduced-motion static · chrome wiring correct (sidebar logo swap, topbar avatar, cmdk mini-logo) ·
no console errors · 6 screenshots saved to `previews/implementation/phase-02/` · no pixelation at xl.

## Out of scope (explicit)

Voice Theater window · Companion Orb Tauri window + drag + click behaviors (Phase 6) · audio-reactive rings
(timer-driven pulse only) · splash screen (Phase 3) · chat bubbles · any screen interiors · new dependencies
(none needed).

## Verification results (2026-09-30)

All Step-6 gates green:

- `tsc --noEmit` ✅ · `eslint .` ✅ (0 errors, 0 warnings) · `vite build` ✅
- Production bundle: `/__brand` route + BrandGallery **stripped** (grep of `dist/assets` — no match);
  brand components present in main chunk. Confirmed live: prod `/#/__brand` redirects to `/#/chat`.
- Playwright suite (Chromium headless, dev :5173 + prod preview :4173): **40/40 passed**
  - Gallery: 7 states × 5 sizes (+3 head-variant), role="img" on all 46 svgs, zero `<img>`,
    100% unique gradient ids (useId), stop-color resolves via CSS vars, 3 voice rings on speaking,
    orb switcher live-toggles state.
  - Themes: paper → `--avatar-glow-strength: 0px` (double-off) · xr-native → 8px · `--accent-2` present.
  - Reduced motion (emulated): voice rings suppressed, zero console errors.
  - Shell wiring: chat lg(80) avatar · sidebar full wordmark · user-card sm · topbar sm head ·
    menu-label md(40) · cmdk icon logo 20px · zero console errors anywhere.
  - Error state: finite 2s red-flash keyframes (no timers/state — react-hooks v7 clean); restarts per error.
- Screenshots (7): `previews/implementation/phase-02/01..07` (gallery full, avatar matrix, orb speaking,
  chat avatar, sidebar expanded, cmdk, paper-theme gallery).
- No `src-tauri/` changes → cargo check not required this phase.
- Implementation deviation from plan: error-state "internal 2s timer" replaced by pure Framer-Motion
  finite keyframes (same UX: 2s flash → settled dim frame) to satisfy `react-hooks/set-state-in-effect`.

## Redesign (2026-09-30, Ahmad's correction): ORIGINAL art, not interpretation

Ahmad rejected the geometric interpretation ("these are original xr avatar and logo only use these…
remove that X from app and create proper better svg exactly same and identical"). The brand
components now render his ACTUAL uploads, auto-vectorized:

**Pipeline (regenerable):** uploads → alpha analysis + k-means palette (logo k=12, avatar k=17,
sides k=12/13) → per-color binary vtracer traces (speckle 7) + 3-band alpha halos (96-160/0.5,
48-96/0.25, 16-48/0.1, dark|energy split, speckle 4) → `components/brand/art.ts` (278KB generated
module: layers, viewBoxes, halo bands) → 54 palette tokens + 2 semantic aliases
(--brand-bright/--brand-mid) in themes.css → components render the traced paths with var() fills.

- **Logo** = the diamond crest from `xr logo (1).png`: icon = emblem crop (no tagline),
  full = emblem + XR wordmark, large = full art incl. tagline + 4s energy breathe. THE X IS GONE.
- **Avatar** = the figure from `XR AVATAR .png`: bust = full figure (viewBox 38 28 455 458),
  head = square helmet crop (165 24 235 235), + new `side`/`side2` variants from the profile refs.
  States animate energy layers only (cy/hi): idle breathe, listening/speaking pulse + 3 voice
  rings, thinking orbit dots, sleeping dim, waiting-approval amber pip, error 2s red flash
  (red energy overlay + tint + shake) then settle.
- **CompanionOrb** keeps its sphere geometry, recolored to brand cyans.
- Fills: 54 k-means tokens, constant across themes; glow still per-theme via
  --avatar-glow-strength.

**Fidelity (browser render vs original PNG, composited on app bg, tol 26/chan):**
logo 94.8% · avatar 90.9% · side1 81.1% · side2 80.5% (residual = sub-pixel alpha spray).
Side-by-side proofs: `previews/refinement/02b-fidelity-{logo,avatar,side1,side2}.png`.

**Re-verification:** typecheck/lint/build green · prod bundle still strips /__brand ·
Playwright 35/35 (matrix incl. side variants, var-fills resolve, error overlay, orb switcher,
themes, reduced motion, wiring, zero console errors) · screenshots refreshed (01-07).
