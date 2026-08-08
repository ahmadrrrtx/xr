# XR 3.1B — Terminal Shell + TUI Redesign Summary

**Date:** 2026-07-14  
**Scope:** Experience layer only (backend frozen)  
**Package:** `@rrrtx/xr`  
**Specs followed:** all documents under `docs/xr-3.1/`

---

## 1. Redesign approach

### Thesis (from Executive Summary)
The backend is not the problem. XR felt like six products. The Shell must be the definitive terminal-native surface of **one** operating system: same vocabulary, same status truth, same composer, same palette.

### Method
1. **Read every XR 3.1 research doc** before code.
2. **Tokens → primitives → terminal engine → Shell modules** (Roadmap M0–M3).
3. **Study interaction patterns** (Claude Code, Lazygit, k9s, btop, Warp, Ghostty) — not layouts.
4. **Never touch** Memory, Research, Providers, Voice, Plugins, MCP, Business OS, Shield, Skills, Computer Control, Security, Budget, Audit, Kernel.
5. **Official branding only** (`assets/logo.png`, `assets/avatar.png` via `src/ui/brand.ts`).

### Product commitments implemented
| Commitment | Implementation |
|---|---|
| Composer is universal input | Bottom `xr [mode] ›` with history, paste, slash |
| Status bar is ground-truth | Connection · workspace · mode · model · spend · activity · audit · notices |
| Command palette is universal | `Ctrl+K` fuzzy search over nav + commands |

---

## 2. Files changed / created

### Created
| Path | Purpose |
|---|---|
| `src/ui/tokens.ts` | Canonical design tokens (color, space, motion, type, TERM layout, CSS export) |
| `src/ui/css-vars.css` | Web-facing CSS variables from the same tokens |
| `src/ui/ansi.ts` | Visible-width ANSI clip/pad/wrap/box |
| `src/ui/icons.ts` | Glyph vocabulary + NAV_ITEMS + SHELL_VIEW_ORDER |
| `src/ui/primitives.ts` | Badge, status dot, button, progress, spinner, empty/error, nav item, composer, status bar, overlays |
| `src/ui/terminal.ts` | Alt-screen, raw input, key parser, **line-diff damage paint**, perf log |
| `src/interfaces/shell/types.ts` | Shell state model |
| `src/interfaces/shell/layout.ts` | Responsive geometry (3-pane / single / icon-rail) |
| `src/interfaces/shell/render.ts` | Frame assembly for all views + overlays |
| `src/interfaces/shell/app.ts` | Controller: input, g-chords, palette, slash, agent runs |
| `docs/xr-3.1/XR-3.1-SHELL-IMPLEMENTATION.md` | Spec↔code map + checklist |
| `docs/XR-3.1-SHELL-REDESIGN-SUMMARY.md` | This summary |

### Rewritten
| Path | Why |
|---|---|
| `src/interfaces/tui.ts` | Was 1521-line monolith; now thin `runTUI` → `runShell` |
| `src/ui/theme.ts` | Token-backed ANSI, color-mode detection, NO_COLOR/mono/16/truecolor |
| `src/ui/index.ts` | Design-system public API without export collisions |

### Updated
| Path | Why |
|---|---|
| `src/ui/layout.ts` | Stable SYM import (CLI helpers unchanged) |
| `src/interfaces/cli.ts` | Stable SYM import |
| `docs/XR-3.1-REDESIGN-PLAN.md` | Reflects definitive Shell redesign |

### Not modified (backend freeze)
`src/core/*`, `src/providers/*`, `src/memory/*`, `src/cost/*`, `src/security/*`, `src/plugins/*`, `src/mcp/*`, `src/voice/*`, `src/research/*`, `src/computer/*`, `src/business/*`, `src/skills/*`, `src/daemon/*` (except consumption via existing APIs).

---

## 3. Reusable design primitives (future surfaces inherit these)

```
src/ui/tokens.ts      → COLOR, SPACE, RADIUS, MOTION, TYPE, TERM, cssVarsBlock()
src/ui/theme.ts       → xrCyan/Green/Amber/Red, A.*, color modes
src/ui/icons.ts       → glyph(), icon(), NAV_ITEMS (Shell + Control Center order)
src/ui/primitives.ts  → badge, statusDot, button, progressBar, spinnerFrame,
                        emptyState, errorState, successState, keyHint,
                        listRow, navItem, toastLine, toolCallLine,
                        composerPrompt, statusBar, overlayFrame, card
src/ui/terminal.ts    → Terminal engine (also usable by future full-screen tools)
src/ui/css-vars.css   → Control Center + website
```

CLI (`layout.ts`, `cli.ts`) and future Dashboard should import tokens/primitives rather than hardcoding hex.

---

## 4. UX improvements

| Area | Before | After |
|---|---|---|
| Identity | “TUI shell” / mixed labels | **Shell** vocabulary; Overview/Chat/Sessions/… |
| Layout | Fixed-ish 3 columns, full redraw | Responsive 3-pane / icon-rail / compact |
| Navigation | Tab cycles views | Sidebar + g-chords + palette + `/` focus |
| Status | Partial | Full ground-truth strip with spend/audit/activity |
| Composer | String dump, limited editing | Cursor, Ctrl+A/E/U, history, paste, slash complete |
| Escape | Simple dismiss | Priority: overlay → interrupt → unfocus → exit confirm |
| Help | Buried | `?` overlay + palette + status hints |
| Startup | Basic overlay | Official logo+avatar progressive brand frames |
| Overlays | startup/palette/notices/quick/confirm | + help, mode, model, exit |

---

## 5. Performance impact

| Metric | Before | After |
|---|---|---|
| Redraw strategy | Full `clearScreen` every dirty tick | Line-diff damage; full only on resize or >60% dirty |
| Idle ticker | 100ms always advancing spinner path | Spinner only when `busy` or startup; 120ms |
| Input latency | Batched to next tick | Immediate paint on key |
| Startup | 6×110ms frames | Same budget; progressive art reveal |
| Instrumentation | None | `XR_PERF=1` → `/tmp/xr-perf.log` |

Targets aligned with `XR-3.1-PERFORMANCE-STANDARDS.md` (first paint <500ms, keypress <16ms design).

---

## 6. Accessibility improvements

- Glyph + color for every status (never color alone)
- `NO_COLOR`, `XR_COLOR=mono|16|256|truecolor`
- `XR_TEXT_ONLY=1` for screen-reader-friendlier labels
- `XR_REDUCED_MOTION=1` hook
- Keyboard-complete primary journeys
- Clean alt-screen leave on exit / SIGINT / SIGTERM
- Bracketed paste enabled

---

## 7. Compatibility verification

| Check | Result |
|---|---|
| `runTUI` export preserved for `src/index.ts` | Pass |
| Config / providers / memory / sessions APIs only consumed | Pass |
| Slash commands preserved (+ extended) | Pass |
| Official brand assets only | Pass |
| Typecheck clean for `src/ui/*` + `src/interfaces/shell/*` + `tui.ts` | Pass |
| Module import smoke | Pass |
| Key parser (Ctrl+K/N/W, arrows, Shift+Tab, Alt+P) | Pass |
| Layout breakpoints 200/120/100/80/70 | Pass |

---

## 8. Manual testing checklist

See also `docs/xr-3.1/XR-3.1-SHELL-IMPLEMENTATION.md` §7.

- [ ] Fresh: `xr` → brand frames → workspace picker → Enter → chat composer
- [ ] Existing install: sessions/workspaces load
- [ ] Provider switch: `/model …`, Alt+P overlay
- [ ] Streaming task run + activity timeline
- [ ] Approval Y/N overlay
- [ ] Budget display + `/budget`
- [ ] Memory remember flow
- [ ] Research / audit views
- [ ] Resize, tmux, SSH, Windows Terminal, macOS Terminal, Linux
- [ ] Exit recovery (no stuck alt-screen)
- [ ] `NO_COLOR=1 xr`
- [ ] Fast paths: `xr --version`, `xr help`, `xr serve`

---

## 9. How this follows the research docs

| Document | How applied |
|---|---|
| Executive Summary | One OS; composer / status / palette commitments |
| Design System | Tokens, ANSI map, TERM constants, icon vocab, three-pane |
| Navigation Architecture | Bindings, Esc priority, g-chords, sidebar order |
| Information Architecture | Canonical nouns (Shell, workspace, session, mode…) |
| Component Standards | TUI primitives for badge, composer, status, overlays, empty/error |
| Performance Standards | Damage paint, no idle full redraw, startup budget |
| Accessibility Standards | NO_COLOR, glyphs+color, keyboard-first, text-only mode |
| User Journeys | J1 startup, J2 ask, J3 task loop, J5 model, J6 budget, J8 workspace, J9 audit paths |
| Implementation Roadmap | M0 tokens, M2 keyboard/palette/composer, M3 layout/shell |

---

## 10. Objective check

> The objective is not to make the TUI prettier.  
> The objective is to establish the **definitive XR product experience** that every future interface inherits.

**Delivered substrate:** tokens + icons + primitives + terminal engine + Shell architecture.  
Control Center and website can now bind to the same tokens (`css-vars.css` / `cssVarsBlock()`) and the same nav order (`NAV_ITEMS`) without inventing a second design language.
