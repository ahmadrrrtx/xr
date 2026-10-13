# macOS window chrome — decision record

**Decision: XR uses the system's real traffic lights.** The fake ones from
Phase 1 are gone.

This reverses a deliberate earlier choice, so this document records the
evidence rather than just the outcome.

---

## 1. What changed

| | Phase 1 | Phase 27 |
| --- | --- | --- |
| `decorations` | `false` (frameless) | `true` |
| `titleBarStyle` | — | `Overlay` |
| `hiddenTitle` | — | `true` |
| `trafficLightPosition` | — | `{ x: 20, y: 20 }` |
| Lights | Drawn in React (`MacTrafficLights`) | Drawn by macOS |
| Window theme | `"theme": "Dark"` forced | no `theme` key — follows the OS |

Two supporting changes:

- **Per-OS chrome lives in Rust, not in platform configs.** `apply_platform_chrome`
  in `lib.rs` calls `set_decorations(false)` on Windows and Linux and returns
  early on macOS. Verified against `tauri-2.12.0/src/app.rs:2689`: `setup()`
  builds the windows from config *before* running the setup closure and shows
  them *after*, so this is flash-free and needs no duplicated window arrays in
  `tauri.{windows,linux}.conf.json`.
- **`"theme": "Dark"` was removed** from `tauri.conf.json`. It hardcoded dark
  mode and silently disabled "Follow System" — a theme setting the app offers
  but could not honour.

---

## 2. The evidence

### Apple's own guidance

From the Human Interface Guidelines, via
[the macOS design guidelines](https://saglitz.com/design/macos-app-design):

> **Don't draw your own chrome** … don't try to replicate the system-provided
> appearance. Doing so without perfectly matching the system's look and behavior
> can make your app feel broken.

And HIG rule 2.6, via
[the same reference](https://lobehub.com/skills/andresilvagomez-wisper-macos-design-guidelines):

> Never hide or reposition the close (red), minimize (yellow), or zoom (green)
> buttons. **They must remain in the top-left corner.**

Anti-pattern 7 in that source is even more direct: *"Custom window chrome —
Don't replace the standard title bar, traffic lights, or window controls with
custom implementations."*

### The Tauri community

[Tauri's own window-customisation guide](https://tauri.by.simon.hyll.nu/backend/window/customization/)
makes the emotional point plainly:

> Mac users … really, really won't like not having the lights in the corner.

A [real frameless → Overlay migration](https://github.com/ShadyUnderLight/promptarium/pull/51)
documents the practical recipe and its prerequisites: `trafficLightPosition`
(~16, 26), `data-tauri-drag-region` on the title block, the
`core:window:allow-start-dragging` capability, and CSS left-padding so content
never slides under the lights.

### What actually goes wrong with fake lights

Drawn lights are a *re-implementation* of system behaviour. Every one of these
has to be rebuilt by hand, and each is a place to be subtly wrong:

| Behaviour | Real lights | Drawn lights |
| --- | --- | --- |
| Hover glyphs | ✅ | Must be re-drawn |
| ⌥ / ⌘ modified actions | ✅ | Must be re-implemented |
| Dimming when the window is unfocused | ✅ | Must be tracked |
| Fullscreen reveal-on-hover | ✅ | Must be tracked |
| VoiceOver / accessibility roles | ✅ | Must be labelled by hand |
| Matching macOS version appearance changes | ✅ free | Breaks on OS updates |

---

## 3. What XR keeps

The window is still visually XR's. `titleBarStyle: "Overlay"` extends the
content under the title bar area while keeping a real title bar, and
`hiddenTitle: true` removes the title text. The topbar is XR's own 52px strip;
the lights simply sit on top of it at (20, 20).

The topbar:

- Is the drag region (`data-tauri-drag-region` on the `<header>`).
- Gives the screen title `ml-[68px]` on macOS so it never slides under the
  lights. Three 12px dots plus two 8px gaps starting at x=20 ends at x=72, so
  68px of margin clears it.

`core:window:allow-start-dragging` was already present in
`capabilities/default.json` — no capability change was needed for this.

---

## 4. Caveats, stated honestly

- **Fullscreen hides the lights.** When the window is fullscreen the menu bar
  and lights hide and reveal on hover. This is standard macOS behaviour for
  every app, not an XR limitation.
- **`transparent: true` + Overlay is a known trap.** Combining transparency with
  an overlay title bar produces an all-black window border
  ([tauri#14394](https://github.com/tauri-apps/tauri/issues/14394)). XR's main
  window is opaque, so this does not apply — but do not add `transparent: true`
  to the main window without addressing it.
- **Windows and Linux are genuinely frameless** there, and keep the drawn
  caption buttons. Neither platform offers a native overlay equivalent for a
  custom title bar, so drawing them remains correct there.

---

## 5. If you need to reverse this

Delete `MacTrafficLights` was already done; to go back you would:

1. Set `decorations: false` in `tauri.conf.json` and drop the `titleBarStyle` /
   `hiddenTitle` / `trafficLightPosition` keys.
2. Reinstate the drawn component in
   `desktop/src/components/layout/WindowControls.tsx`.
3. Re-add the width to the macOS assertion in the frontend's a11y tests, if any
   were added against real-light geometry.

Please read §2 first.
