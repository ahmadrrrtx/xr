# XR UX Research Notes

Supporting research for the XR UX transformation (2026-08-13). These notes
feed the design architecture documents in `docs/ux/` and are kept deliberately
short — every claim here is actionable and used by at least one design doc.

| Note | Question it answers |
|---|---|
| [01-terminal-technology.md](01-terminal-technology.md) | What open-source terminal rendering should XR use, and when? |
| [02-3d-avatar-technology.md](02-3d-avatar-technology.md) | Can/should the XR avatar be rendered in 3D, and with what stack? |
| [03-ui-ux-pro-max-evaluation.md](03-ui-ux-pro-max-evaluation.md) | What does the ui-ux-pro-max skill teach us that XR should adopt? |
| [04-brand-asset-analysis.md](04-brand-asset-analysis.md) | Exact pixel-level analysis of the official XR logo/avatar assets (the authoritative brand source). |

## Method

1. **Repo evidence first.** Every design decision was checked against the
   actual repository (`src/`, `assets/`, `docs/`) before being written down —
   no doc assumes the README is correct.
2. **Live brand analysis.** The official logo/avatar PNGs were analyzed
   programmatically (pixel histograms) to extract the authoritative palette.
3. **External research.** Competitive products, terminal tech, 3D tech, and
   the ui-ux-pro-max skill were studied via public sources; patterns were
   borrowed deliberately, never copied wholesale.

## Standing decisions (feed every other doc)

- **XR ships dark-first.** The entire existing token system, TUI, and
  dashboard are dark. A light theme is a future initiative, not part of this
  transformation (matches `docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md` §2.5).
- **The official assets are authoritative** (mission rule §2): `assets/logo.png`
  and `assets/avatar.png`, plus the user-supplied avatar variants. No
  redesigned logo, no generic AI logo.
- **No fake UI.** Every visible control must map to a real runtime path
  (`src/daemon/routes/*`, `src/voice/*`, `src/providers/*`, …). Controls
  without a backing path are hidden, disabled with an honest reason, or
  labeled experimental — never simulated (see `01-product-ux-audit.md` §4).
- **Performance over spectacle.** 3D/avatar work is optional, lazy-loaded,
  and only where it communicates agent state (see `02-3d-avatar-technology.md`).
