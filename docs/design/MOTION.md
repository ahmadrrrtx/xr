# XR motion law (design system v3)

The rule that decides everything else: **frequency decides motion.** An
interaction the user performs a hundred times a day earns no animation; one
they see once a month may earn a moment. Every animation must answer "what
changed?" — if a cut would tell the user the same thing, cut.

This is the law CONTRIBUTING's Before | After | Why table is reviewed against.
Tokens live in `desktop/src/styles/prism2.css`; enforcement that can be
automated lives in the renderer lane and the desktop checks.

## Frequency table

| Frequency | Examples | Motion |
|---|---|---|
| 100+/day | ⌘K palette, keyboard navigation between areas, focus moves | **none** — instant |
| 20–100/day | hover, press, tooltip after the first, toggles | ≤ 120 ms, opacity/transform only; press = `scale(0.97)` |
| a few/day | sheets, menus, popovers, toasts, run inspector | 150–300 ms, `--xr-ease-out` in / faster out; origin-aware |
| rare | first run, the post-update screen, hold-to-confirm, trust revoke | may stagger (30–80 ms) and take up to 500 ms; the only place for delight |

## Curves and durations

```
--xr-ease-out:    cubic-bezier(0.23, 1, 0.32, 1)     things that ENTER or respond
--xr-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)    things that MOVE while on screen
--xr-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)     sheets and drawers
--xr-d-fast 120ms · --xr-d-base 180ms · --xr-d-slow 260ms
```

- `ease-in` is never used. `linear` only for constant motion (spinners, the
  hold-to-confirm fill).
- Daily surfaces stay under 300 ms end to end. Asymmetric timing: slow where
  the user decides, fast where the system responds.

## Hard rules

1. **Never animate a keyboard action.** Enter, Escape, arrow keys, shortcuts:
   the result appears. Pointer presses get the press scale; keys do not.
2. **Transform and opacity only.** No animated layout (width/height/top/left),
   no blur beyond the single `--xr-blur` token, nothing enters from
   `scale(0)` — enter from `scale(0.95)` + opacity at most.
3. **Origin-aware.** Popovers and menus grow from the control that opened them;
   only modals and the palette are centered.
4. **Transitions over keyframes** for state changes; CSS over JS under load;
   WAAPI when JS must drive.
5. **Reduced motion is global.** `prefers-reduced-motion: reduce` collapses
   every duration to 1 ms at the root; components cannot opt out. Hover-only
   effects are gated behind `@media (hover: hover)`.
6. **Status surfaces show facts.** No decorative progress, no invented steps,
   no placeholder timings. The boot splash (`desktop/src/boot.ts`) is the
   reference: three real facts, measured timings, the engine's own reasons.

## Signature patterns

- **Press**: every `.btn`, rail button, segmented control and chip scales to
  0.97 on pointer press (prism2.css, v3 section). The palette is exempt.
- **Hold-to-confirm** (Phase 2/4): a `clip-path` fill over 2 s `linear` on
  press, 200 ms release; used only for critical-tier approvals, workspace
  delete and trust revoke; always with a keyboard alternative.
- **Crossfade mask** for content swaps that would otherwise pop: a 2 px blur
  crossfade, never a layout shift.

## Review table (copy into the PR)

| Before | After | Why |
|---|---|---|
| | | |
