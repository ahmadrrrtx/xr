# XR 3.1 — Shell (Terminal) Implementation Notes

> Companion to the product research set in `docs/xr-3.1/`.
> Records what shipped in the Terminal Shell redesign and how it maps to the specs.

**Status:** Implemented (experience layer only — backend frozen)  
**Primary entry:** `xr` → `src/interfaces/tui.ts` → `src/interfaces/shell/app.ts`

---

## 1. Redesign approach

The previous TUI was a single 1,500-line file that:

- Cleared and rewrote the entire alternate screen every 100ms
- Mixed layout, input, and agent I/O
- Used ad-hoc navigation labels not aligned with the IA vocabulary
- Lacked damage-region rendering, readline composer, g-chords, and a shared design system

**Approach (per Executive Summary + Implementation Roadmap M0–M3):**

1. **Tokens first** — `src/ui/tokens.ts` is the single source of truth for color, spacing, motion, typography, and terminal layout constants. Theme, CSS vars, and primitives compile from it.
2. **Primitives second** — reusable TUI atoms/molecules in `src/ui/primitives.ts` (badge, status dot, composer prompt, status bar, overlays, empty/error states, key hints).
3. **Terminal engine** — `src/ui/terminal.ts` owns alternate screen, raw mode, bracketed paste, resize, key parsing, and **line-diff damage rendering**.
4. **Modular Shell** — controller / render / layout / types split under `src/interfaces/shell/`.
5. **No backend rewrites** — agent, providers, memory, cost, security, plugins, MCP, etc. are only *called*, never modified.

---

## 2. File map

### New

| File | Role |
|---|---|
| `src/ui/tokens.ts` | Canonical design tokens + CSS var generator |
| `src/ui/css-vars.css` | Web export of the same tokens |
| `src/ui/ansi.ts` | Visible-width ANSI utilities |
| `src/ui/icons.ts` | Glyph vocabulary + nav order (Shell + Control Center) |
| `src/ui/primitives.ts` | Reusable TUI components |
| `src/ui/terminal.ts` | Terminal engine + key parser + damage paint |
| `src/interfaces/shell/types.ts` | Shell state types |
| `src/interfaces/shell/layout.ts` | Responsive three/single-pane geometry |
| `src/interfaces/shell/render.ts` | Header, sidebar, views, composer, status, overlays |
| `src/interfaces/shell/app.ts` | Controller: input, palette, slash, agent runs |
| `docs/xr-3.1/XR-3.1-SHELL-IMPLEMENTATION.md` | This file |

### Rewritten

| File | Why |
|---|---|
| `src/interfaces/tui.ts` | Thin re-export of `runShell` (was monolithic TUI) |
| `src/ui/theme.ts` | Compiles tokens → ANSI; color-mode detection; NO_COLOR |
| `src/ui/index.ts` | Public API for the design system |

### Lightly updated

| File | Why |
|---|---|
| `src/ui/layout.ts` | Continues to serve CLI banners; SYM import stable |
| `src/interfaces/cli.ts` | SYM import stable |

### Unchanged (backend freeze)

All of: `src/core/*`, `src/providers/*`, `src/memory/*`, `src/cost/*`, `src/security/*`, `src/plugins/*`, `src/mcp/*`, `src/voice/*`, `src/research/*`, `src/computer/*`, `src/business/*`, `src/skills/*`.

---

## 3. Experience contract (what users get)

### Layout

```
┌ Header (brand · workspace › session · mode) ───────────┐
│ Sidebar │ Main workspace              │ Inspector      │
│ (22ch)  │ (flex)                      │ (26–32ch)      │
├─────────┴─────────────────────────────┴────────────────┤
│ Composer  xr [agent] ›                                 │
│ Status bar · connection · mode · model · spend · audit │
└────────────────────────────────────────────────────────┘
```

- **≥120 cols:** three-pane  
- **80–119 cols:** sidebar + main (inspector off)  
- **<90 cols:** icon rail  
- **<80 cols:** main-only compact  

### Navigation (per Navigation Architecture)

| Binding | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+N` | Notifications |
| `Ctrl+W` | Workspace picker |
| `Ctrl+J` | Quick actions |
| `g` then `d/c/s/w/r/t/a/m/.` | Go-to views |
| `/` | Focus composer |
| `?` | Contextual keyboard help |
| `Tab` | Cycle panes (when composer empty) / slash complete |
| `Shift+Tab` | Cycle mode agent→plan→ask |
| `Alt+P` | Model overlay |
| `Esc` | Dismiss → interrupt → unfocus → confirm exit |
| `Ctrl+C` | Interrupt / exit |
| `Ctrl+D` | Exit on empty input (confirm) |
| `Ctrl+L` | Clear chat view |
| Readline | Ctrl+A/E/U, arrows, history Up/Down, bracketed paste |

### Status bar (universal ground-truth)

Left→right: connection dot · workspace · mode · provider/model · spend · activity · audit · notifications.

### Composer (universal input)

`xr [mode] ›` with cursor, history, slash commands, paste. Modes: agent / plan / ask.

---

## 4. Performance

| Metric | Target | Implementation |
|---|---|---|
| First paint | <500ms | Alt-screen enter + brand frames (6×110ms); chrome first |
| Keypress → screen | <16ms | Immediate paint on input; no 100ms batch for keys |
| Idle redraw | low | Spinner ticker only when busy/startup; damage-line diffs |
| Full clear rate | rare | Only on resize or >60% dirty lines |
| Perf log | optional | `XR_PERF=1` → `/tmp/xr-perf.log` |

**Before:** full `clearScreen` every dirty tick (100ms), including idle spinner path.  
**After:** line-level damage; ticker only advances spinner when needed.

---

## 5. Accessibility

- Color never sole channel: glyphs ✓ / ! / ✗ / · always paired
- `NO_COLOR` / `XR_COLOR=mono|16|256|truecolor` honored
- `XR_REDUCED_MOTION=1` / reduced-motion hooks
- `XR_TEXT_ONLY=1` replaces chrome glyphs with `[OK]`/`[ERR]` labels
- Keyboard-only complete for primary journeys
- Bracketed paste; clean alt-screen restore on exit/SIGINT/SIGTERM

---

## 6. Compatibility

- Existing config, providers, plugins, MCP, memory, sessions, skills: **unchanged**
- Slash commands preserved and extended (`/inspect`, `/audit`, g-chord aliases)
- `runTUI` export name preserved for `src/index.ts`
- No user migration required

---

## 7. Manual testing checklist

- [ ] `xr` enters alternate screen with official logo/avatar frames
- [ ] Startup workspace/session picker: Tab, ↑/↓, Enter, Esc
- [ ] Composer accepts text; Enter runs task; history Up/Down
- [ ] `Ctrl+K` palette filters and runs items
- [ ] `g c` / `g s` / `g w` / `g a` navigate
- [ ] `?` help overlay; Esc dismisses
- [ ] `Shift+Tab` cycles mode; status bar reflects mode
- [ ] `/model ollama qwen2.5:7b` updates provider
- [ ] `/budget 0.25` and budget display
- [ ] Approval overlay for tool calls (Y/N/Esc)
- [ ] Resize terminal: layout adapts; no corruption
- [ ] Exit via Esc→y, Ctrl+D, `/exit` — terminal restored
- [ ] `NO_COLOR=1 xr` still navigable
- [ ] tmux / SSH session: no stuck alt-screen after exit
- [ ] `xr --version` / `xr help` still fast paths

---

## 8. Decision log

| Decision | Rationale |
|---|---|
| Keep Ctrl+W as workspace (not readline kill-word) | Matches Navigation §2.4 Shell bindings; Alt+B/F for word motion later |
| Ctrl+K always palette (not kill-to-end in composer) | Universal chord is non-negotiable (Exec Summary §5) |
| Shell views subset of full IA | Terminal density; marketplace/plugins via palette + Control Center |
| Damage by full-line equality | Simple, correct; region IDs reserved for future fine-grained updates |
| Official assets only | Brand.ts raster frames from `assets/logo.png` + `assets/avatar.png` |

---

## 9. Follow-ups (out of this pass, still in roadmap)

- True token streaming into the live assistant bubble (Milestone 1)
- Full @-mention / slash popover menus (Milestone 2)
- Control Center layout parity using the same tokens/CSS vars (Milestone 3)
- Virtualized audit list for 1k+ entries
- Sticky-chord accessibility mode
