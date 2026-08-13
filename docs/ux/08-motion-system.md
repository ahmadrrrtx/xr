# 08 — Motion System

**Date:** 2026-08-13. Mission §21: motion must be intentional, subtle, and
respect `prefers-reduced-motion`. The existing `MOTION` tokens
(`fastMs 80 / baseMs 120 / slowMs 200`, `easingStandard`,
`easingEntrance`) are the base.

## 1. Tokens

| Token | Value | Use |
|---|---|---|
| `instant` | 0–50 ms | hover tint, border color, focus ring |
| `fast` | 80 ms | active/pressed, small state changes |
| `base` | 120 ms | panel toggles, list reorder, chips |
| `slow` | 200 ms | modal/overlay entrance, sidebar collapse |
| `entrance` | cubic-bezier(.22,1,.36,1) | popovers, palette, avatar states |
| `standard` | cubic-bezier(.4,0,.2,1) | everything else |
| spring | stiffness 420 / damping 34 (≈ 200 ms settle) | avatar ring, popover scale — use sparingly |

## 2. What moves, and why (state-explaining only)

| Element | Motion | Explains |
|---|---|---|
| Streaming cursor | blinking block cursor (existing `cursorBlinkMs`) | "producing output" |
| Tool timeline card | icon turns spinner → check/stop, card expands on click | "tool running / done" |
| Agent state line | text + dot swap with `fast` fade | state transitions |
| Avatar ring | breathing scale (idle), pulse (speaking), orbit dot (thinking) | voice/agent state |
| Approval card | slides in from right inspector on pending | "needs you now" |
| Toast | fade/slide 160 ms in, auto-dismiss | transient feedback |
| Modal/palette | 160 ms scale+fade entrance | "temporary layer" |
| Sidebar collapse | 200 ms width | layout change |

## 3. Streaming animation rules (research-backed)

- Buffer partial tokens; render markdown progressively; never reflow the
  whole message per token (CSS growth only).
- Code blocks: render when the closing fence arrives OR show an inline
  "streaming" marker inside the block (mission §21).
- Stop control always visible while streaming; abort is real
  (`chatAbortController` exists in dashboard).

## 4. Reduced motion & transparency

- Global `@media (prefers-reduced-motion: reduce)`: disable all non-essential
  animation (breathing, pulse, orbit, cursor blink→static), keep opacity
  transitions ≤ 80 ms for feedback only.
- `@media (prefers-reduced-transparency: reduce)`: solid fallbacks for all
  translucent surfaces.
- TUI: existing `_reducedMotion` detection in `src/ui/theme.ts` — honor it
  for spinner frames (static dot) and banner pulse.

## 5. Anti-patterns (hard bans)

- Auto-playing animation loops on main surfaces; parallax; scroll-jacking;
  animated backgrounds; particle bursts; haptic-feel shakes; animating
  width/height of layout-critical containers (CLS); exit animations slower
  than entrance; decorative animation with no state meaning.

## 6. Implementation notes

- Dashboard has no CSS transitions today — add only via utility classes
  (`.xr-motion-*`) so motion can be globally disabled by one rule.
- Website already uses framer-motion — keep its motion within the same
  tokens (durations 150–300 ms per ui-ux-pro-max guidance, exit faster than
  enter).
- Test: a unit test asserts `prefers-reduced-motion` CSS exists; axe sweep
  covers `animation` concerns where applicable.
