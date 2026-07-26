# Platform Support Matrix (XR 5.1)

Generated from the same probe logic as `xr env capabilities`
(`detectEnvironmentCapabilities()`). **Rule: `partial` is never rounded up to
`supported`, and `unsupported` is reported with remediation instead of
silently degrading at action time.**

## Matrix

| Environment | Linux | macOS | Windows | Notes |
|---|---|---|---|---|
| Browser | supported* | supported* | supported* | *\*requires the `playwright` module; real import probe, not an optimistic check. Playwright-managed chromium used when no system browser exists.* |
| Desktop | supported (xdotool + wmctrl) | partial (clicclick / Accessibility) | partial | macOS needs `cliclick` for click/drag/move. **Scroll injection exists only on Linux — macOS/Windows honestly report it unsupported (5.1 fix; previously it faked success).** |
| Application | supported (xdg-open) | supported (open) | supported (PowerShell Start-Process) | launch/open/close via signals |
| Filesystem | supported | supported | supported | read/list/write/mkdir/move/delete under workspace policy + approvals |
| Voice | partial–unsupported† | partial† | partial† | †*needs local capture/playback/STT/TTS tools; cloud stays dual-consent opt-in* |
| Vision | partial (needs screenshot tool + tesseract) | partial–supported | partial | local OCR is tesseract-or-nothing; no silent cloud fallback |

## Backend tools probed (exact)

| Capability | Linux | macOS | Windows |
|---|---|---|---|
| Keyboard/mouse | `xdotool` | osascript + `clicclick` | PowerShell SendKeys |
| Window focus | `wmctrl` | osascript | PowerShell |
| Screenshot | `gnome-screenshot` → `scrot` → `import` (ImageMagick) | `screencapture` | PowerShell System.Drawing |
| Mic capture | `arecord` / `rec` / `sox` | `afrecord` / `rec` | — (tracked as missing) |
| Playback | `aplay` / `paplay` / `play` | `afplay` | PowerShell |
| Local STT | `whisper` / `whisper-cli` / `whisper.cpp` (`main`) | same | — |
| Local TTS | `espeak` / `espeak-ng` / `piper` / `kokoro` | `say` | PowerShell |
| OCR | `tesseract` | `tesseract` | `tesseract` |
| Browser | playwright chromium (module probe) | same | same |

## Sandbox / elevated environments (this matters)

- **Root:** Chromium **refuses to launch as root with its sandbox**, and
  XR refuses to auto-add `--no-sandbox`. Launch fails with an explicit error
  and remediation. The only escape hatch is the explicit triple
  `XR_BROWSER_DISABLE_SANDBOX=1 + XR_BROWSER_UNSAFE_ACK=1 +
  XR_BROWSER_ALLOW_ROOT=1` — acknowledged dangerous, intended only for
  disposable dev containers. There is no silent downgrade: if the sandbox
  cannot be on, the browser does not open.
- **Headless Linux (no DISPLAY/Wayland):** desktop control tools are absent →
  desktop reports `unsupported` with remediation. Browser can still run
  headless (Playwright default `XR_BROWSER_HEADLESS` unset; headed mode
  opt-in). Filesystem/application keep working.
- **Wayland vs X11:** `xdotool`/`wmctrl` are X11 tools; on pure Wayland they
  may exist but not function. XR reports tool presence honestly and surfaces
  execution failures with the tool's stderr rather than inventing a
  capability.
- **Containers/CI:** everything except docker-typical GUI/audio works; the
  capability matrix is the source of truth at runtime
  (`xr env capabilities --json`, `xr doctor --json` → `environment` check).

## Honest degradation contract

1. Support is computed by probing, cached for 30 s, and re-probeable
   (`invalidateEnvironmentCapabilityCache`).
2. An action against an `unsupported` environment is **blocked at the gate
   with a remediation string** — it never "runs anyway degraded".
3. `partial` support lists exactly what works (`working[]`) and what does not
   (`missing[]`); nothing is implied.
4. Optional components (voice, vision/cloud, desktop) failing NEVER block
   core XR: text CLI, filesystem, memory/context, workflows all continue.
   Per-modality kill switches disable just that environment.
5. Support status varies with the machine; the release does not claim
   "works everywhere". It claims "reports everywhere truthfully".
