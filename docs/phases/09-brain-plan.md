# Phase 9 — Brain · Implementation Plan

## Files

| File | What |
|---|---|
| `desktop/src/brain/types.ts` | `SpanCategory`, `SpanStatus`, `Span`, `Run`, `BrainEvent`, `MockFlavor` |
| `desktop/src/brain/rng.ts` | mulberry32 + string hash (deterministic seeds) |
| `desktop/src/brain/mock.ts` | `createMockRun(id)` (flavors: short/medium/long/error/waiting/stress/latest) + `streamMockRun(runId, hooks)` live simulator |
| `desktop/src/brain/format.ts` | `fmtDuration`, `fmtClock` (2:14.7), `fmtTokens` (1.2k), `fmtUsd`, `fmtRelative` |
| `desktop/src/brain/events.ts` | `emitBrainUpdate()` — Tauri `brain:run-update` + dev CustomEvent seam (orb.ts pattern) |
| `desktop/src/stores/brainStore.ts` | Zustand store per brief §3 (runs/spans/children, selection, tabs, follow, expanded, search, gantt zoom/pan, loadRun/startMockRun/stop/restart/export) + `useTweenNumber` helper |
| `desktop/src/screens/Brain/index.tsx` | Screen: index (hero + recent runs) and run view (header, tabs, resizable split), keyboard shortcuts, live-region announcements |
| `desktop/src/brain/tree.tsx` | `react-window` FixedSizeList tree: indent + 3px category spine, chevron/status/category icons, name, duration badge, selection, running pulse, search filter + highlight, full ARIA tree roles, keyboard nav |
| `desktop/src/brain/gantt.tsx` | Hand-rolled SVG/div Gantt: axis ticks, 10px bars (12px pitch), zoom (⌘+scroll, buttons), pan (drag), dbl-click fit, hover tooltip, click-select, running leading-edge glow, sr-only table, >500-row downsampling |
| `desktop/src/brain/detail.tsx` | Inputs/Outputs/Metadata/Error tabs: Shiki JSON (`highlightToHtml` lang=json), markdown outputs (`MarkdownRenderer`), category-specific views (file path+bytes, shell cmd+cwd, approval info), blinking streaming cursor, "Re-run from here" toast |
| `desktop/src/brain/tabs.tsx` | Timeline (100%-width Gantt + 200px compact tree), Events (virtualized reverse-chron log, search), Cost (div bars + totals tiles), Logs (ANSI-regex colorizer, monospace) |
| `desktop/src/components/Resizer.tsx` | 4px vertical/horizontal drag handle, hover `bg-accent/30`, dbl-click reset, persists via `lib/persistent-store.ts` (`xr.brain.splitter.*`) |
| `desktop/src/styles/themes.css` | + `--cat-llm/tool/file/network/shell/approval/user/agent` per theme (contrast ≥4.5:1 on bg) |
| `desktop/src/styles/globals.css` | + `.xr-run-pulse` keyframe (cyan box-shadow pulse, dark themes; border-color pulse for paper/arctic) + `[data-motion='reduced']` guard + `.xr-caret` blink reuse |
| `desktop/src/lib/nav.ts` | (no change — brain already present, verify order) |
| `desktop/src/components/layout/Topbar.tsx` | `useScreenTitle` → "Brain · #847" when run open |
| `desktop/src/components/layout/AppShell.tsx` | add `/brain` to full-bleed `flush` list |
| `desktop/src/screens/Chat/components/ToolCallCard.tsx` | "View trace ↗" link (→ `/brain/mock-latest`) + ⌁ pulse dot while running |
| `desktop/src/screens/Runs/index.tsx` | Minimal mock control-room table (Phase 11 ships the real one): 8 mock rows, eye → `/brain/mock-*` flavor per row |
| `desktop/package.json` | + `react-window`, + `@types/react-window` (dev) |

## Mock data shape (deterministic)

```
createMockRun(id) → { run, spans[] }   // spans flat, parentId links
```

- **medium** (default demo, ~24 spans, ~28s): plan LLM → fs.readDir (+ nested parse LLM) → 3× fs.readFile → subagent "summarizer" (3× LLM summarize + approval.request waiting 12s → approved) → synthesize LLM → fs.writeFile → final LLM. Plus 1 network span (search API) and 1 shell span (ls -la) for color variety.
- **short** (~9 spans, ~6s): user → llm plan → 1 tool → llm final.
- **long** (~80 spans, ~90s): research flavor — web search, 6× fetch network, subagent "reader" (6× LLM), shell span, 2 approval spans, final LLM.
- **error** (~14 spans): same shape as medium until `shell.exec` fails mid-flow (non-zero exit, stderr output, red X, run status failed, error run toast).
- **waiting** (~12 spans): frozen at the approval span — status `waiting` everywhere downstream is `pending`; stream resumes live when the user decides (the span is still live, not a dead snapshot).
- **stress** (10,000 spans): 250 LLM nodes × 40 tool children each, flat-ish 2 levels + a few 3-deep subagents; all completed, 5-min run. Virtualization proof.
- Each span: realistic `inputs`/`outputs` (JSON), model names (`gpt-4o`, `llama3.1:70b`), per-category costs (llm tokens → $, tools free), `metadata` (file path+bytes, shell cmd+cwd+exit, network url+status+contentType, approval id).

### streamMockRun script (hooks)

`onSpanStart(span)`, `onSpanEnd(spanId, {status, endedAt, outputs?})`, `onTokenTick(spanId, tokensDelta)`, `onApprovalWait(spanId, spec)`, `onLog(spanId, line)`, `onRunEnd({status, endedAt})`. The script is the flavor's span list with relative start offsets; a 100ms tick loop advances the virtual playhead, emitting starts/ends/ticks (token ticks at ~10/s per running LLM, 1s throttle into the event log). Total play time: short ~6s, medium ~28s, long ~90s (scaled ×0.5 for `startMockRun` demo pace).

## Virtualization strategy

- Tree: `FixedSizeList` (28px rows) over the precomputed visible-row array. Row component reads spans by id from the store (shallow selectors). Entrance animation via Framer `motion.div` keyed on span id (`initial` only for `isNew` rows, cleared after 400ms).
- Gantt: CSS `transform: translateX(panMs*scale)` on a wide inner div; bars positioned by % left/width. Visible-window culling: only render rows whose time window intersects `[pan, pan+visible]`; sub-1px bars render as 1px ticks. No chart lib.
- Events/Logs: `FixedSizeList` (28/20px rows) over the event array.
- 10k-node stress: visible array = 10k entries, list renders ~40 rows → smooth.

## Theme token additions (themes.css, per theme)

Dark themes get saturated colors + glow OK; graphite slightly desaturated; paper/arctic darkened for 4.5:1 on cream/white:

| var | xr-native | graphite | midnight | paper | arctic |
|---|---|---|---|---|---|
| `--cat-llm` | `#00e5ff` | `#7fb3c8` | `#60a5fa` | `#1b554d` | `#0e7490` |
| `--cat-tool` | `#a78bfa` | `#a99ac4` | `#a78bfa` | `#6d5a9e` | `#7c3aed` |
| `--cat-file` | `#f59e0b` | `#c2a35e` | `#f59e0b` | `#8a5f14` | `#b45309` |
| `--cat-network` | `#10b981` | `#7ea88c` | `#34d399` | `#3c6e48` | `#047857` |
| `--cat-shell` | `#f97316` | `#c98a6a` | `#fb923c` | `#9a4a12` | `#c2410c` |
| `--cat-approval` | `#eab308` | `#c4a86a` | `#fbbf24` | `#7d6414` | `#a16207` |
| `--cat-user` | `#94a3b8` | `#a3a3a3` | `#94a3b8` | `#6b5d49` | `#64748b` |
| `--cat-agent` | `#818cf8` | `#a3a0c4` | `#818cf8` | `#4c52a8` | `#4f46e5` |

Contrast check vs `--bg-ink` (the pane bg): all ≥4.5:1 (verified by eye + ratio math on the darkest theme pairing; text usage is ≥11px, dots/bars are non-text so 3:1 suffices but these clear it anyway).

## Keyboard map (screen-level, `/brain/*` only)

`/` search · `↑↓` navigate · `→←` expand/collapse (or descend/ascend) · `Space` select + focus detail · `s` stop (confirm) · `r` restart (confirm if running) · `mod+e` export · `mod+=`/`mod+-` zoom · `mod+0` fit · `escape` deselect/close. Guard: ignore while typing in inputs.

## Out of scope (brief §15)

Real runtime, Runs control room, OTLP, cross-run compare, cloud share, re-run-from-span (toast only), multi-select, Tauri tracing plugin.
