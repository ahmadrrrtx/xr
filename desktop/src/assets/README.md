# Brand assets (official renders only — decision D-05)

Everything the product shows as "XR" comes from the owner-supplied renders,
used exactly as provided. The only permitted derivations are pixel-identical
format/size conversions (webp, icon sizes). No vector "marks", no traced or
simplified geometry — that is how two divergent logos came to exist before
Phase 1, and `scripts/desktop-brand-check.ts` now fails CI on any `.svg`
under a brand root, any unregistered or altered brand image, and any module
other than `components/Brand.tsx` importing a brand image directly.

| File | Source | Placement |
|---|---|---|
| `xr-logo.png` | official logo render | titlebar, boot splash, onboarding |
| `xr-avatar.png` | official avatar render, front | presence / identity; voice pose **front** |
| `xr-avatar-128.png`, `xr-avatar-256.png` | the same render, resized | docked voice orb, chips |
| `xr-avatar-side.webp` | official avatar side-profile render | voice pose **side** — XR is working (thinking, planning, working) |
| `xr-avatar-side-2.webp` | official avatar side-profile render 2 | voice pose **side-alt** — XR is acting (tool use, approval pending) |
| `xr-hero.webp` | official "superiority" hero render | onboarding hero; other cinema-zone moments (update complete) |
| `fonts/` | bundled OFL typefaces — see `fonts/README.md` | type identity (checked separately by `desktop-fonts-check`) |

`REGISTRY.json` pins every brand file in the repo (including the OS icons
under `desktop/src-tauri/icons/` and the npm-package copies under `assets/`)
with its SHA-256, source and role. After adding an official render:

```
bun run scripts/desktop-brand-check.ts --write   # regenerate, then state the source in the entry
```

## Pose map (product rule, 09-DESIGN-RETHINK-v3)

`Brand.tsx` is the one place that knows the files. Callers ask for a pose:

```tsx
<XrAvatar pose="front" />          // presence, identity, waiting on the user
<XrAvatar pose="side" />           // XR is working on the user's behalf
<XrAvatar pose="side-alt" />       // XR is acting: tool call, approval pending
poseForVoiceState(state)           // the mapping the Voice surface and docked orb share
```
