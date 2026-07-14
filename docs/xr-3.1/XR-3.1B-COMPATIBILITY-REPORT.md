# XR 3.1B — Compatibility Report

**Date:** 2026-07-14  
**Surface:** Shell (fullscreen terminal) + shared UI tokens  
**Method:** Static analysis, import/runtime smokes, layout matrix, clean-tree comparison  

---

## 1. Platform matrix

| Platform | Expected support | Evidence in code | Sandbox tested |
|---|---|---|---|
| **Linux terminals** | Full | ANSI CSI, alt-screen `?1049h`, raw mode | Import + non-TTY smoke (yes); interactive TTY (operator) |
| **macOS Terminal / iTerm2 / Ghostty / WezTerm / Kitty** | Full truecolor when `COLORTERM`/`TERM_PROGRAM` set | `detectColorMode()` in `theme.ts` | Logic unit-tested via `setColorMode` |
| **Windows Terminal + Bun** | Full | `bin/xr.cjs` uses `where`/`bun.exe`; perf log uses `%TEMP%` | Path fix verified; interactive operator |
| **tmux / screen** | Supported | Alt-screen + no permanent global term state beyond leave | Design-reviewed; operator |
| **SSH** | Supported | Damage paint reduces bandwidth vs full clear | Design-reviewed; operator |
| **Non-TTY / piped** | Degrades | `runTUI` prints guidance and returns | **Pass** in sandbox |
| **`TERM=dumb` / `NO_COLOR`** | Degrades to mono/none | `detectColorMode()` | **Pass** unit |

---

## 2. Terminal capability matrix (Accessibility Standards alignment)

| Capability | Shell behavior |
|---|---|
| True color | Full RGB via `fgRgb` |
| 256 color | RGB escapes still emitted (acceptable); mode flag present |
| 16 color | ANSI basic codes |
| Mono / NO_COLOR | No color; bold/dim only where used |
| Alternate screen | Enter on start; leave on exit/signal |
| Bracketed paste | Enabled |
| Mouse | Available in engine; **disabled** in Shell default (keyboard-first) |
| Resize | Full invalidate + repaint |
| OSC 52 clipboard | Not required for 3.1B ship |

---

## 3. Layout compatibility (columns × rows)

Computed by `computeLayout()`:

| Size | Sidebar | Inspector | Icon rail | Notes |
|---|---|---|---|---|
| 200×50 | 22 | yes (32) | no | Comfort three-pane |
| 120×40 | 22 | yes (26) | no | Spec comfort threshold |
| 100×30 | 22 | no | no | Single work + sidebar |
| 80×24 | 4 | no | **yes** | Spec minimum density |
| 70×20 | hidden | no | — | Main-only compact |
| 40×12 | hidden | no | — | Extreme; still no throw |

No hard-coded 120-only paths in paint; header/composer/status heights from `TERM` tokens.

---

## 4. OS-specific paths and APIs

| API | Usage | Windows-safe? |
|---|---|---|
| `node:path` `join` / `basename` | Project meta, audit export | Yes |
| `Bun.write` for audit export | cwd-relative file | Yes |
| Perf log | `TEMP`/`TMPDIR`/`TMP`/`/tmp` | **Yes** (fixed in stabilization) |
| `process.stdin.setRawMode` | Optional chaining | Yes on TTY; skipped non-TTY |
| `spawnSync` in Shell app | **Removed** (was unused) | n/a |
| `bin/xr.cjs` launcher | `where` on win32 | Pre-existing, OK |

---

## 5. Keyboard compatibility

| Concern | Status |
|---|---|
| ASCII control chords (Ctrl+A/C/D/E/K/L/N/U/W/J) | Parsed by byte value — OS-agnostic in raw mode |
| CSI arrows / Home / End / Delete | Standard VT sequences + `O*` application mode |
| Shift+Tab (`\x1b[Z`) | Parsed |
| Alt+letter (ESC + char) | Parsed for p/t/o/b/f |
| Windows Terminal key encodings | Same VT mode when WT uses xterm sequences (default) |
| Bracketed paste | `\x1b[200~` … `\x1b[201~` |

---

## 6. Integration compatibility (existing product)

| Integration | Compatible? | Notes |
|---|---|---|
| `src/index.ts` default `xr` → TUI | Yes | Still `runTUI()` |
| Config load/save | Yes | Unchanged APIs |
| WorkspaceManager / Store | Yes | Shell consumes only |
| `runAgent` / approvals / budget hooks | Yes | Same contracts as prior TUI |
| CLI `SYM` / theme helpers | Yes | `SYM` remains string map |
| Control Center / daemon | Untouched | No 3.1B coupling |
| Plugins / MCP / Voice / Skills engines | Untouched | Not imported by Shell chrome |

---

## 7. Migration / user compatibility

| User asset | Impact |
|---|---|
| `~/.xr/config.json` | None required |
| Workspaces / sessions DB | None |
| API keys | None |
| Skills / plugins installs | None |
| Muscle memory (slash commands) | Preserved; g-chords additive |

---

## 8. Manual validation checklist (operator)

Run on each target environment after install:

### Boot / teardown
- [ ] `xr` enters fullscreen (alt screen)
- [ ] Official logo/avatar startup frames appear
- [ ] Workspace picker navigable; Enter continues
- [ ] Esc / Ctrl+C / `/exit` restore terminal (no stuck alt-screen, cursor visible)
- [ ] `xr --version` and `xr help` still fast

### Interaction
- [ ] Type in composer; Enter runs or slash works
- [ ] Ctrl+K palette filters and executes
- [ ] g d / g c / g s navigation
- [ ] Resize window mid-session — layout adapts, no corruption
- [ ] tmux: attach/detach, exit XR cleanly
- [ ] SSH session: usable latency, clean exit

### Environment flags
- [ ] `NO_COLOR=1 xr` — readable monochrome
- [ ] `XR_PERF=1 xr` — perf log appears under temp dir
- [ ] Windows Terminal + Git Bash + PowerShell (if used)

### Regression (backend freeze)
- [ ] One agent task still completes (local or cloud)
- [ ] Approval prompt still works
- [ ] `/model`, `/budget`, `/mode` still persist config
- [ ] `xr serve` still starts Control Center

---

## 9. Compatibility verdict

| Area | Verdict |
|---|---|
| Linux / macOS / Windows Terminal design | **Compatible** |
| tmux / SSH design | **Compatible** |
| Non-TTY / CI / pipes | **Compatible** (graceful degrade) |
| Existing config & backends | **Compatible** (no migration) |
| Full interactive sign-off | **Operator checklist pending** |

XR 3.1B does not require platform-specific forks. Remaining risk is operational verification on real TTYs, not architectural incompatibility.
