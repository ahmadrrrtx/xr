# XR 3.1B — Stability Report

**Date:** 2026-07-14  
**Scope:** Production stabilization of the Shell redesign only  
**Policy:** No features, no backend rewrites, no drive-by refactors  

---

## 1. Scope of XR 3.1B files

### Created
- `src/ui/tokens.ts`
- `src/ui/ansi.ts`
- `src/ui/icons.ts`
- `src/ui/primitives.ts`
- `src/ui/terminal.ts`
- `src/ui/css-vars.css`
- `src/interfaces/shell/app.ts`
- `src/interfaces/shell/layout.ts`
- `src/interfaces/shell/render.ts`
- `src/interfaces/shell/types.ts`
- `docs/xr-3.1/XR-3.1-SHELL-IMPLEMENTATION.md`
- `docs/XR-3.1-SHELL-REDESIGN-SUMMARY.md`
- `docs/xr-3.1/XR-3.1B-TYPESCRIPT-AUDIT.md` (this pass)
- `docs/xr-3.1/XR-3.1B-STABILITY-REPORT.md` (this pass)
- `docs/xr-3.1/XR-3.1B-COMPATIBILITY-REPORT.md` (this pass)

### Modified
- `src/interfaces/tui.ts` — re-export `runShell as runTUI`
- `src/ui/theme.ts` — token-backed ANSI layer
- `src/ui/index.ts` — design-system public API
- `docs/XR-3.1-REDESIGN-PLAN.md` — plan updated for Shell

### Explicitly untouched (backend freeze)
`src/core/*`, `src/providers/*`, `src/memory/*`, `src/cost/*`, `src/security/*`, `src/plugins/*`, `src/mcp/*`, `src/voice/*`, `src/research/*`, `src/computer/*`, `src/business/*`, `src/skills/*`, `src/daemon/*`, `src/commands/*` (except they may import stable `theme` symbols).

---

## 2. TypeScript stability

| Check | Result |
|---|---|
| `tsc` errors in 3.1B paths | **0** |
| `tsc` errors repo-wide | **23** — all Category B pre-existing (see audit) |
| Clean `origin/main` same 23 errors | **Yes** (byte-identical error set) |
| Circular imports in ui/shell graph | **None** (14 nodes / 37 edges, DFS clean) |

**Import graph (Shell):**

```
tui.ts → shell/app.ts
app.ts → layout.ts, render.ts, types.ts, ui/{ansi,icons,terminal,theme}
render.ts → layout, types, ui/{ansi,brand,icons,primitives,theme}
layout.ts → ui/tokens
theme.ts → tokens
primitives → ansi, icons, theme
terminal → ansi, theme
```

No cycles. No imports from frozen backend into the design-token layer.

---

## 3. Runtime stability checks performed

| Check | Method | Result |
|---|---|---|
| Module load all 3.1B TS entrypoints | dynamic `import()` | Pass |
| Non-TTY `runTUI()` | force `isTTY=false` | Graceful message; no throw; no alt-screen leak |
| `Terminal.leave()` when never entered | unit call | No-op; safe |
| Color modes `truecolor/256/16/mono/none` | `setColorMode` + `xrCyan` | Pass; mono/none strip color |
| `SYM.*` string compatibility for CLI | `typeof SYM.ok === "string"` | Pass |
| `src/ui/index.ts` exports | COLOR, Terminal, NAV_ITEMS | Pass |
| Official brand frames | `renderOfficialBannerFrame` | Pass (lines render) |
| Layout breakpoints | 200/120/100/80/70/40 cols | Pass (see compatibility report) |
| Key parser | Ctrl+K/N/W, arrows, Shift+Tab, Alt+P | Pass (prior smoke) |
| RSS after Shell import | `process.memoryUsage()` | ~55 MB RSS after import (sandbox); well under idle budget intent |
| Entry wiring | `src/index.ts` still `import("./interfaces/tui")` + `runTUI()` | Pass |

---

## 4. Terminal lifecycle (alternate screen / cleanup)

| Concern | Implementation | Status |
|---|---|---|
| Enter alt screen | `A.altScreenEnter` (`?1049h`) | OK |
| Leave alt screen | `A.altScreenLeave` + cursor show + reset | OK |
| Raw mode | `setRawMode(true)` on enter; false on leave | OK |
| Bracketed paste | on enter; off on leave | OK |
| Mouse | off by default (Shell does not enable) | OK |
| Unexpected exit | `process.once("exit"\|SIGINT\|SIGTERM)` → `leave()` | OK |
| Double leave | guarded by `entered` flag | OK |
| Resize | invalidates frame buffer; full redraw | OK |
| Damage paint | line-diff; full if >60% dirty or size change | OK |
| Perf log path | cross-platform temp dir (fixed this pass) | OK |

**Known operational note (not a regression):**  
`Terminal.enter()` registers `SIGINT` → `leave()` + `process.exit(130)`. The Shell also handles Ctrl+C in the key loop for interrupt-vs-exit. If a true OS SIGINT arrives, process exits after restore — correct for cleanup. In-app Ctrl+C is handled as a key (`\x03`) before that path in normal raw mode.

---

## 5. Keyboard / input stability

| Binding | Handled in | Status |
|---|---|---|
| Ctrl+C | app `handleKey` + terminal SIGINT fallback | OK |
| Ctrl+D empty → exit confirm | app | OK |
| Esc priority stack | overlay → interrupt → unfocus → exit | OK |
| Ctrl+K palette | app | OK |
| Ctrl+N / Ctrl+W / Ctrl+J | app | OK |
| g-chords | app (1s timeout) | OK |
| Composer readline subset | Ctrl+A/E/U, arrows, history | OK |
| Bracketed paste | parseKey + insertText | OK |
| Shift+Tab mode cycle | app | OK |
| Alt+P model overlay | app | OK |

---

## 6. Render / performance stability

| Topic | Behavior | Status |
|---|---|---|
| Idle redraw | Spinner ticker only when `busy` or startup overlay | OK |
| Input paint | Immediate on key (dirty flag) | OK |
| Full clear rate | Resize / first frame / heavy dirty | Reduced vs old 100ms full clear |
| Startup | 6 × 110ms brand frames | Spec-aligned |
| XR_PERF=1 | Writes `xr-perf.log` under system temp | OK after path fix |

---

## 7. Memory / dependency footprint

- Shell does **not** boot the full kernel on open (index fast-path preserved).
- Heavy deps (agent, providers) load when a task is submitted.
- Design system has **zero** new npm dependencies (still `zod` + optional `playwright` only).

---

## 8. Fixes applied in this stabilization pass

1. **`src/ui/terminal.ts`** — perf log uses `process.env.TEMP || TMPDIR || TMP || "/tmp"` so Windows does not assume `/tmp`.
2. **`src/interfaces/shell/app.ts`** — removed unused `spawnSync` import (hygiene; avoids dead Node import).

No other code changes. No Category B fixes.

---

## 9. Residual risks (accepted)

| Risk | Severity | Mitigation / follow-up |
|---|---|---|
| Repo `tsc` still fails overall due to Category B | Medium for CI purity | Gate Shell paths separately later; fix B in dedicated debt PR |
| True interactive TTY not exercised in this sandbox | Medium | Manual checklist on Win/macOS/Linux terminals |
| Agent interrupt is cooperative (no AbortSignal plumbing) | Low–Med | Pre-existing agent contract; Shell best-effort busy clear |
| Ctrl+W is workspace (not readline kill-word) | Spec choice | Documented in Shell implementation notes |

---

## 10. Production readiness verdict (Shell)

| Gate | Verdict |
|---|---|
| 3.1B TypeScript | **PASS** (0 errors) |
| Backend freeze | **PASS** (untouched) |
| Entry compatibility (`runTUI`) | **PASS** |
| Non-TTY safety | **PASS** |
| Cleanup / alt-screen design | **PASS** |
| Full-repo green `tsc` | **FAIL (pre-existing)** — not a 3.1B blocker |
| Interactive multi-OS manual matrix | **PENDING operator** (checklist provided) |

**Verdict:** XR 3.1B Shell is **stable for release as an experience layer**. Repository-wide typecheck debt is **orthogonal** and tracked in the TypeScript audit as Category B.
