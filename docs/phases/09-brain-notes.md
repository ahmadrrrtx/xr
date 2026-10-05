# Phase 9 — Brain · Study Notes (mental model)

One page. What exists, what's missing, what I reuse. Written after the Step-0 study pass.

## What already exists (do NOT rebuild)

| Concern | Where | Notes |
|---|---|---|
| Route `/brain/:runId?` | `router.tsx` | Already registered (Phase 0 scaffold), currently renders `PlaceholderScreen id="brain"`. |
| Sidebar entry | `lib/nav.ts` | `brain` already in the 14 fixed-order nav items, **second position** (Chat → Brain → Workspaces), `Brain` Lucide icon, phase 9. Nothing to add. |
| 5-theme system | `stores/theme.ts` + `styles/themes.css` | `html[data-theme="xr-native|graphite|midnight|paper|arctic"]`. Category colors go in as `--cat-*` vars here; glow already doubles off in Paper/Arctic via `--accent-glow: transparent`. |
| Persistence pattern | `lib/persistent-store.ts` | Write-through Tauri Store + localStorage (`writeSettingJSON`/`readSettingJSON`). Use for splitter positions (`xr.brain.splitter.main`, `xr.brain.splitter.detail`). |
| Approval queue | `stores/approvalStore.ts` + `lib/approvalCore.ts` | `requestApproval(spec)` returns a promise of the decision. `ApprovalSpec` = skillId/skillName/skillVersion/skillIcon/action/resource/subject/bodyPreview/risk/justification/rememberOptions. Mock run's `approval.request` span awaits this promise; decision → completed/failed. |
| Orb state | `lib/orb.ts::orbSetState(state)` | `AvatarState` union — set `idle` when a run completes; `thinking` while running (the seam fires in dev builds too, so browser e2e can assert). |
| Shiki | `lib/highlight.ts` | `highlightToHtml(code, lang)` dual-theme (`github-dark`+`github-light`, `defaultColor:false`), CSS var swap in `globals.css` for paper/arctic. `json` already in LANGS. Reuse verbatim. |
| Markdown | `lib/markdown.tsx::MarkdownRenderer` + `screens/Chat/components/CodeBlock.tsx` | react-markdown + remark-gfm, code fences → `CodeBlock` (shiki). Reuse for span outputs. |
| Confirm dialog | `components/settings/dialogs.tsx::ConfirmDialog` | `open/onOpenChange/title/body/confirmLabel/onConfirm` — reuse for Stop/Restart confirms. |
| Stick-to-bottom | `hooks/useStickToBottom.ts` | Chat pattern (ref + `isStuck` + `newCount` + `scrollToBottom`). Reuse for Events/Logs tabs. |
| Hotkeys | `hooks/useHotkeys.ts` | Combo strings (`mod+e`, `/`, arrows as `arrowup`…). Screen-level handler is fine too (brief allows either). |
| Tauri event pattern | `lib/orb.ts`, `lib/approvalEvents.ts` | `emit(event, payload)` from `@tauri-apps/api/event`, no-op in browser + dev `CustomEvent` seam. Clone for `brain:run-update`. |
| Reduced motion | `lib/appearance.ts` sets `html[data-motion="reduced"]`; `globals.css` kills animation under `[data-motion='reduced']` + `prefers-reduced-motion`; Framer `MotionConfig reducedMotion` in `App.tsx` | Framer springs collapse automatically; CSS keyframes need `[data-motion='reduced']` guards (already global for `*`). `useReducedMotion()` from framer covers both. |
| Topbar title | `components/layout/Topbar.tsx::useScreenTitle` | Derives from NAV_ITEMS segment. Extend to append `· #847` for `/brain/:runId`. |
| Full-bleed | `AppShell.tsx` `flush` list | `/chat` + `/settings` render without the `p-6`. Add `/brain`. |
| ToolCallCard | `screens/Chat/components/ToolCallCard.tsx` | `ToolCallRecord` (id/tool/summary/category/input/output/status/error/approvalId). Add "View trace ↗" link + ⌁ running indicator. |
| Runs screen | `screens/Runs/index.tsx` | 6-line placeholder. Phase 11 builds the real control room; Phase 9 gives it a minimal mock table with an eye → `/brain/mock-*` action. |

## Gaps I must build

`src/brain/types.ts` · `src/brain/mock.ts` (deterministic generator + stream simulator) · `src/stores/brainStore.ts` · `src/screens/Brain/index.tsx` (full screen) + `src/brain/tree.tsx` (virtualized tree) · `src/brain/gantt.tsx` · `src/brain/detail.tsx` · `src/brain/tabs.tsx` (Timeline/Events/Cost/Logs) · `src/brain/format.ts` (time/cost/token formatting) · `src/components/Resizer.tsx` · category tokens `--cat-*` in `themes.css` · `brain:run-update` emitter in `src/brain/events.ts` · Chat `ToolCallCard` link · Runs mock rows · Topbar + AppShell tweaks · `react-window` (+types) dep.

## Data-model decisions (brief §1 adapted)

- **Flavors by id suffix** (brief §3): `mock-latest` (default), `mock-short`, `mock-medium`, `mock-long`, `mock-error`, `mock-waiting`, `mock-stress` (10k nodes). `loadRun` parses the suffix; unknown ids generate a deterministic medium-sized run seeded by the id hash, so `/brain/:anyId` always renders (acceptance criterion).
- **Flat span store** + `childrenByParent`; the tree renders from a precomputed **visible row array** (`{id, depth, hasChildren, isExpanded, isNew}`) derived from `expanded: Set<string>` — that array is the `react-window` data source, so 10k nodes stay cheap. Rebuild only when `expanded` or span order changes (not on token ticks).
- **Run totals** recomputed incrementally on span end (tokens/cost), plus the live LLM span's partial tokens feed `run.tokensOut` on token ticks (tweened display, not state churn).
- **Event log** (Events/Logs tabs) is a ring array on the store (`events: BrainEvent[]`, capped ~5k) — span start/end, approval wait/resolve, errors, 1s-throttled token ticks, plus `log` lines emitted by shell/network/file spans.
- **Deterministic RNG**: mulberry32 seeded from a hash of the run id → stable screenshots; timers use a virtual clock (all spans computed from `run.startedAt`), so a loaded run is a frozen snapshot, and `streamMockRun` plays the same script with real `setInterval` deltas.
- **Adapter seam**: `streamMockRun(runId, hooks)` is the only "source" the store consumes. Phase 14 swaps it for a Tauri-event-backed emitter with the same hooks (no store changes).

## Approval integration (cross-surface trust)

`streamMockRun` reaches the `approval.request` span → store calls `approvalStore.requestApproval(spec)` → Phase 7 `ApprovalModal` (rendered globally in `App.tsx`) opens automatically. Promise resolution flips the span to completed (approved) / failed "Denied by user". While pending, span status = `waiting` (yellow pause), run status dot shows "Waiting approval". On run end the waiting span is withdrawn (`approvalStore.withdraw`) so a stopped run never leaks a modal.

## Brand guardrails

Lucide @1.5px · no hex outside `themes.css` (category colors are new tokens there, per-theme for contrast) · glow only via `--accent-glow` / `box-shadow` tokens (absent in Paper/Arctic — the light themes use border-color pulse instead) · monospace for all IDs/times/tokens/costs · 28px tight tree rows, 10px Gantt bars, 3px category spines · copy: short, sentence case, no exclamation marks · Orbitron for the "Brain" index title only.
