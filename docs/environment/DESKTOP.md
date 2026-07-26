# Desktop + Application Capability Matrix (XR 5.1)

Desktop/application control uses the existing per-OS adapters
(`control/executor.ts`): osascript/open/PowerShell/cliclick (macOS),
xdotool/wmctrl/xdg-open (Linux), PowerShell/SendKeys/mouse_event (Windows).
No new action types were added.

## Honest support matrix

| Capability | macOS | Linux | Windows |
|---|---|---|---|
| Launch app (`app`) | ✅ `open -a` | ✅ `gtk-launch`/`xdg-open` | ✅ `Start-Process` |
| Close app (`close`) | ✅ osascript quit | ✅ `pkill -f` | ✅ `Stop-Process` |
| Focus window (`focus`) | ✅ osascript activate | ✅ `wmctrl -a` | ⚠ best-effort message |
| Open target (`open`) | ✅ `open` | ✅ `xdg-open` | ✅ `Start-Process` |
| Editor (`editor.open`) | ✅ code/cursor/vim if installed | ✅ | ✅ |
| Type (`type`) | ✅ osascript keystroke | ✅ `xdotool type` | ✅ SendKeys |
| Key chords (`key`) | ✅ key code/keystroke | ✅ `xdotool key` | ✅ SendKeys |
| Click (`click`) | ⚠ needs `cliclick` | ✅ `xdotool click` | ✅ mouse_event |
| Drag (`drag_drop`) | ⚠ needs `cliclick` | ✅ | ✅ |
| Move (`move`) | ⚠ needs `cliclick` | ✅ | ✅ Cursor.Position |
| Scroll (`scroll`) | ❌ **unsupported** (reported, not faked) | ✅ `xdotool click 4-7` | ❌ **unsupported** (reported) |
| Screenshot (`screenshot`) | ✅ `screencapture` | ✅ gnome-screenshot/scrot/import | ✅ PowerShell |
| Clipboard read | ✅ pbpaste | ✅ xclip/xsel | ✅ Get-Clipboard |
| Clipboard write | ✅ (approval) | ✅ (approval, xclip) | ✅ (approval) |
| Notify | ✅ osascript | ⚠ reports unavailable honestly | ⚠ |
| Volume / battery / wifi / media / trash | ❌ unavailable in this build (explicit stub, never faked) | ❌ | ❌ |

**Warnings fixed in 5.1:** `move` previously routed through the click code path
(it CLICKED); it is now move-only. macOS/Windows `scroll` previously reported
success without doing anything; it now reports `skipped + unsupported`.

## Detection and fail-closed behavior

- `xr env capabilities` (and `xr doctor`) probe the platform and report
  `supported | partial | unsupported` per environment with remediation —
  **partial is never rounded up to supported**.
- The action gate (`desktopSupportFor`) checks tooling before executing: missing
  `xdotool`/`wmctrl`/`cliclick` → action is `blocked` with an install hint.
- Permission scope `desktop` (plus `application`/`clipboard` existing scopes)
  stays mandatory for input injection, granted via `xr control permissions`.

## Target proof for coordinate actions

Coordinate actions (`click`, `drag_drop`, `move`) require in the environment request:

```jsonc
{
  "target": { "kind": "coordinate", "x": 640, "y": 480, "evidence": "obs_screen_172…" },
  "observationRef": "obs_screen_172…",   // must resolve and be FRESH
  "confidence": "medium"                  // below medium → blocked
}
```

A stale observation (older than `environment.vision.staleObservationMs`, default
30 s) blocks the action with an explicit "re-observe" reason. Do not script
coordinate actions from perception you cannot refresh.

## Destructive classes and approval

- Desktop `type` of shell-like text (`sudo`, `rm -`, curl|sh…) is **destructive**
  (existing classifier) — approval mandatory.
- `computer_use` loops run UNDER the environment gate now: outer destructive
  approval once, and every vision-proposed step is gated individually
  (risk → reversibility → approval → freshness). A denial, a circuit trip, or an
  unknown side effect stops the loop. See RECOVERY.md and VISION.md.
