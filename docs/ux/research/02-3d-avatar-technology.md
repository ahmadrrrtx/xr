# 3D / avatar technology research

Researched 2026-08-13. Mission rule: *"DO NOT add 3D simply because it looks
cool. Every visual effect must serve UX. Performance has priority over
spectacle."* This note decides **if** XR should render the avatar in 3D.

## 1. What the avatar is today

- `assets/avatar.png` — 2D raster (512×449, transparent bg, dark navy body +
  cyan glow visor). Also rasterized to ANSI frames for the TUI
  (`src/ui/brand.ts` `OFFICIAL_AVATAR_ANSI`).
- Used in the dashboard model-picker orb (`mp-avatar-img`) and as message
  initials in chat (`XR` / `You`).
- **There is no GLB/GLTF model, no rig, no animation set in the repo.**

## 2. Options

| Option | Cost | What it buys the user | Verdict |
|---|---|---|---|
| **2D avatar + CSS/SVG state animation** | Near zero (existing asset, CSS transforms/filters, SVG masks, `prefers-reduced-motion` guard) | Speaking/listening/thinking/tool-running states communicated via glow pulse, orbit ring, status halo — all the states the mission lists (§12) | **DO THIS NOW** |
| **WebGL avatar (Three.js / R3F + GLTF)** | High: need to author/rig a GLB, loaders, animation state machine, GPU budget, fallbacks for old hardware; bundle +100–300 KB | True 3D presence, lip-sync potential | **FUTURE** — only after a proper GLB exists and perf budgets pass; document in `docs/ux/12-implementation-roadmap.md` as post-launch |
| **Lip-sync (audio-driven)** | Very high; requires phoneme/viseme mapping + animation rig | Realistic speech | FUTURE — depends on 3D model; for now, voice state is shown with 2D glow + status text |
| **Animated GIF/WebP avatar** | Low but janky, heavy, inaccessible | — | Avoid |

## 3. Decision

1. **This transformation ships the 2D avatar with a state-driven visual
   treatment** (glow intensity by agent state, rotating state ring, subtle
   breathing scale on idle, "speaking" pulse tied to real TTS activity where
   the voice pipeline exposes it).
2. **3D is explicitly deferred** and documented as *experimental/future* —
   honestly labeled, never faked. If/when a GLB rig is authored, use
   Three.js (or R3F) loaded **lazily** behind a WebGL-support check, with a
   2D fallback, and gate it behind performance budgets
   (`scripts/perf-gate.ts` exists in-repo).
3. All animation respects `prefers-reduced-motion` (see `08-motion-system.md`).

## 4. Performance guardrails (from research + repo)

- Main chat must not wait for avatar/3D init — lazy-load any heavy visual
  (mission §25).
- Keep dashboard JS single-file & dependency-light today (current client is
  one ~2k-line script, no build step); introducing React/Three for the avatar
  alone is not justified — CSS/SVG covers the state language.
- Target: dashboard boots in < 1.5 s on ordinary hardware; avatar layer must
  be GPU-cheap (CSS transforms + `will-change` only where needed).
