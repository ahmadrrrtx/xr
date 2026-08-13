# Brand asset analysis — official XR logo & avatar (pixel-verified)

Method: programmatic pixel analysis (PIL) of the user-supplied official assets
and the repository assets. These numbers are the **authoritative brand
source** for the design system (`06-design-system.md`).

## 1. Asset inventory (user-supplied)

| Asset | Size | Content (verified by pixel analysis) |
|---|---|---|
| `xr-logo.png` | 729×656 | XR monogram on near-black; white glyph + cyan/indigo glow |
| `XR logo.png` | 745×203 | Wide lockup: white XR wordmark on black, subtle cyan glow |
| `Colour palate of xr logo.png` | 712×154 | **Official swatch strip** — the palette authority |
| `XR logo in terminal.png` | 430×210 | Logo rendered as ASCII/block art in a terminal |
| `XR logo in different frames.png` | 1536×1024 | Logo variations/badges grid |
| `XR AVATAR .png` | 556×487 | Avatar bust, transparent bg (70% transparent) |
| `XR AVATAR FRONT FACing.png` | 806×656 | Front-facing avatar, full frame, no transparency |
| `XR Avatar side face.png` | 295×271 | Side profile, transparent bg |
| `XR Aavatar side face 2 .png` | 526×433 | Side profile (variant), transparent bg |
| `XR-AVATAR-fullbody-hero-1-power-stance.png` | 845×656 | Full-body hero, power stance |
| `XR-Avatar-fullbody-hero-2-arms.png` | 841×656 | Full-body hero, arms variant |
| `repo/assets/logo.png` | 458×382 | Canonical in-repo logo (used by dashboard/TUI) |
| `repo/assets/avatar.png` | 512×449 | Canonical in-repo avatar (used by dashboard/TUI) |

## 2. Authoritative palette (extracted from `Colour palate of xr logo.png`)

Saturated swatch pixels, dominant values:

| Role | Hex (verified) | Notes |
|---|---|---|
| **Brand cyan (primary)** | `#00D4FF` (clusters `#10D0F8`, `#08D0F8`, `#10D8F8`) | Matches `src/ui/tokens.ts` `primary`. ✅ consistent |
| **Brand indigo (secondary)** | `#6048F8` (clusters `#6850F8`, `#6050F8`, `#6048F0`) | **DRIFT**: tokens/styles use `#A855F7` (Tailwind purple), NOT the official indigo. Official asset wins → token corrected to `#6048F8`. |
| **Near-black navy (bg)** | `#000010` / `#001020` | Matches `--xr-bg #0A0A0F` intent. ✅ |
| **White (text/glyph)** | `#F0F0F0` / `#F9FAFB` | ✅ |

## 3. Avatar palette (front-facing bust, 806×656)

| Role | Hex (verified) | Notes |
|---|---|---|
| Body base | `#000010`→`#001020` deep navy | ✅ |
| Glow ramp (dark→bright) | `#004060` `#006080` `#0090B0` `#00B0D0` `#00C0F0` `#00D0F0` | The visor/glow is a **cyan ramp** from deep teal-blue to bright cyan |
| Visor/accents | `#00C0F0`, `#00D0F0`, `#F0F0F0` | Bright cyan + white highlights |
| Secondary tint | indigo hues present in face accents | Use indigo `#6048F8` for secondary accents, sparingly |

**Design consequence:** the avatar's glow language is cyan-dominant. Agent
state colors (ok/warn/error) must not clash with the visor cyan — success
green `#00FF88`, warning amber `#F59E0B`, error red `#FF4D4D` remain distinct
(from tokens). Avatar state treatment uses **glow intensity + ring color**,
never recoloring the visor itself (do not reshape/recolor official art).

## 4. Rules for asset use (mission §2 compliance)

1. `assets/logo.png` = brand mark: nav, favicon-equivalent, lockups, model
   picker orb. Never redraw, recolor, rotate, or tilt (existing rule in
   `docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md` §1).
2. `assets/avatar.png` (or the supplied front-facing variant) = hero, voice
   mode, empty states, onboarding. Never crop the visor, never change glow
   color.
3. Full-body hero variants = onboarding welcome, dashboard hero banner,
   website. Optional, lazy-loaded.
4. Supporting UI art we may create (empty-state illustrations, onboarding
   steps) must use only the palette above + same geometric language
   (sharp lines, cyan glow, navy field).
5. **New canonical kit during implementation**: copy the best-supplied
   variants into `assets/brand/` (front-avatar, heroes, logo lockup) so the
   repo owns one kit; keep `assets/logo.png` + `assets/avatar.png` names for
   backward-compatible imports (`assetDataUri` reads them).
