# Phase 19 — Agents: implementation plan

## A. Engine (`src/execution/workflow/`, `src/agents/`, `src/daemon/`)

| Piece | File | Notes |
| --- | --- | --- |
| Event sink + cost | `execution/workflow/engine.ts` | `WorkflowEngineConfig.onEvent?: (e: WorkflowRunEvent) => void`; `emitNode/emitRun/emitCost/emitLog`; runner result gains optional `cost`; `run.cost` + `breakdown[nodeId]` accumulate. Branch: untaken targets → `skipped` with propagation. |
| Event types | `execution/workflow/events.ts` | `WorkflowRunEvent` union (see notes §2). |
| Definition linter | `execution/workflow/lint.ts` | `lintDefinition(nodes, entryNodeIds)` → `{ problems: WorkflowProblem[] }` (`error`: graph errors from `validateGraph`, empty instruction/tool/summary, branch without targets, human node without approver, unreachable node, no completion; `warning`: dangling node, missing description, zero-budget agent). |
| Canvas compiler | `execution/workflow/canvas.ts` | `CanvasGraph {nodes[{id,kind,label,position,config}], edges[{id,source,sourceHandle?,target}]}` → `WorkflowNode[]` via `nodes.ts` factories (+ stable ids, `metadata.canvas`); `decompile(def)` → `CanvasGraph`. Pure, unit-tested. |
| Custom agents | `agents/custom-store.ts` | `CustomAgentStore(dir)`: list/get/save/delete; JSON schema validation (name 1–60, prompt ≥ 20, tools ⊆ known tools, budget 0.01–5, overrides booleans); `version` increments; file name = id; atomic write. |
| Daemon runtime | `daemon/workflow-runtime.ts` | `getWorkflowRuntime(state, config)`: engine + repo + `WorkflowRunRegistry` (replay buffer, subscribers, approval bridge, ≤ 3 concurrent runs) + `startRun(def, params)` (background `executeRun`). Agent runner → `AgentService.execute`, tool executor → core tools with approval ctx, timer → real `setTimeout` + abort. |
| Routes | `daemon/routes/workflows.routes.ts`, `agents.routes.ts` (custom CRUD) | See §C. Contract in `contract-agents.ts`, schemas in `schemas-agents.ts`; `contract.ts` stays at 800 lines. |

## B. Desktop (`desktop/src/`)

```
agents/                       core.ts (role families, colours, icons, labels), api.ts (typed calls + SSE), canvasCore.ts (palette, node defaults, graph helpers, layout, describe), reduce.ts (run events → canvas state)
stores/agentsStore.ts         prebuilt + custom + favourites + editor state
stores/workflowEditorStore.ts nodes/edges/selection/history/clipboard/dirty/definition/run state
screens/Agents/
  index.tsx                   lazy wrapper
  AgentsScreen.tsx            head + tabs (?tab=prebuilt|mine|workflows)
  components/AgentCard.tsx, AgentGrid.tsx, AgentConfigPanel.tsx (read-only), AgentEditor.tsx (slide-over), EmojiPicker.tsx
  workflows/WorkflowCanvas.tsx, NodePalette.tsx, Inspector.tsx, nodes/XrNode.tsx (+ per-kind bodies), edges/FlowEdge.tsx, Toolbar.tsx, ProblemsPanel.tsx, RunSummary.tsx, ParamsDialog.tsx, DefinitionsList.tsx
styles/agents.css             grid, cards, slide-over, canvas theme variables, marching ants, pulses, reduced motion
```

Cross-surface: `stores/chatStore.ts` (`TurnOverrides` + `?agent=`), Chat composer agent chip/picker, Builder top bar agent select, Research researcher picker, `lib/paletteCommands.ts` ("New agent", "Open workflows", "Run workflow …"), Orb/HUD commands, `components/approvals/ApprovalInfo.tsx` labels, Runs/Brain via recorder.

## C. API (all under `/api`, mounted as `/api/v1` too)

| Method | Path | Body → Response |
| --- | --- | --- |
| GET | `/agents` | existing + `agents: AgentSummary[]` (builtin + custom), `tools: string[]` (core tool names) |
| GET | `/agents/custom` | `{ agents: CustomAgent[] }` |
| POST | `/agents/custom` | `CustomAgentInput` → `{ agent }` (400 on validation; 409 duplicate name) |
| GET/PATCH/DELETE | `/agents/custom/{id}` | `{ agent }` / `{ ok }` |
| GET | `/workflows` | `{ definitions: DefinitionSummary[] }` (latest version per id, lastRunAt) |
| POST | `/workflows` | `{ definitionId?, name, description?, tags?, graph: CanvasGraph, parameters? }` → `{ definition, graph, problems }` (422 when hard problems) |
| POST | `/workflows/inspect` | same body → `{ problems }` |
| GET | `/workflows/{id}` | `{ definition, graph, versions: number[] }` (`?version=`) |
| PATCH | `/workflows/{id}` | `{ name?, tags? }` → new version (metadata only) |
| DELETE | `/workflows/{id}` | deactivate all versions → `{ ok }` |
| GET | `/workflows/runs` | `{ runs: WorkflowRunSummary[] }` (`?definitionId=`) |
| POST | `/workflows/{id}/run` | `{ version?, parameters? }` → 202 `{ runId, state }` (409 inactive, 429 concurrency) |
| GET | `/workflows/runs/{runId}` | `{ run: inspection + nodeStates + pendingApproval }` |
| GET | `/workflows/runs/{runId}/stream` | SSE replay + live; `stream_end` + `[DONE]` |
| POST | `/workflows/runs/{runId}/cancel` · `/pause` · `/resume` | `{ ok, state }` |
| POST | `/workflows/runs/{runId}/human-decision` | `{ nodeId, decision: approve|deny|changes_requested|reject, comment? }` → `{ ok, state }` |

## D. Order of work

1. Engine: events + cost + branch skip (+ tests in `test/workflow/`).
2. `lint.ts`, `canvas.ts` (+ tests). 3. Custom agent store (+ tests). 4. Runtime + routes + contract + OpenAPI/client regen.
5. Desktop: agents core/api/stores → screen shell → Prebuilt → My Agents + editor → Chat `?agent=` → canvas (palette/nodes/edges/inspector/toolbar/problems) → compile/save/load → run + SSE + approvals → summary → shortcuts/context menus/auto-arrange → cross-surface → themes → reduced motion → a11y.
6. Rig smoke (mock LLM) + Playwright screenshots → docs → squash → PR.
