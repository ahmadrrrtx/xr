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

## B. Desktop (`desktop/src/`) — as built

```
agents/                       core.ts (role families, colours, labels), api.ts (typed calls + run SSE), canvasCore.ts (palette, node defaults, graph helpers, layer layout, describe, quick lint), reduce.ts (run events → RunProgress, completion summary)
stores/agentsStore.ts         prebuilt + custom + favourites + editor state (memoised selectors — Zustand v5 needs stable refs)
stores/workflowEditorStore.ts nodes/edges/selection/history/clipboard/dirty/definition/run state (lazy chunk: it pulls in @xyflow/react)
screens/Agents/
  index.tsx                   lazy wrapper
  AgentsScreen.tsx            head + tabs (?tab=prebuilt|mine|workflows, persisted), import/new intents
  icons.ts                    role → Lucide icon map
  components/                 AgentCard, PrebuiltTab, MyAgentsTab, DeleteAgentDialog, ModelSelect, AgentEditor (slide-over), AgentConfigSheet (read-only)
  workflows/                  WorkflowsTab (canvas), XrNode, XrEdge, Palette, Toolbar, Inspector, ProblemsPanel, RunPanels (params, approval modal, summary, failure banner), WorkflowLibrary
styles/agents.css             grid, cards, slide-over, canvas theme variables, marching ants, pulses, reduced motion
```

Cross-surface: `stores/chatStore.ts` + `screens/Chat` (`?agent=` pre-wires a session), `lib/paletteCommands.ts`, `voice/session.ts` (navigate + toast), `components/approvals/ApprovalInfo.tsx` (workflow tool labels), Brain via `beginEngineRun`, Budget via `recordSpend` on `run_end`.

Shield interplay (found in the rig, fixed here): a workflow human check is a real approval record, so the Shield poller bridges it into the global queue too. Such requests carry `humanOnly: true` (`engine/wire.ts`): the policy gate never auto-approves them (Art. IV.4 — "low risk" does not mean "nobody asks"), remember rules are ignored and none are minted, bulk "approve low-risk" skips them, and the modal says so. While the canvas's own dialog is up the root modal yields (`inlineSurface`); when the engine records the decision through either door the other copy is settled with the real outcome (`settleEngineApproval`), so nothing stale stays on screen and no second POST is sent. Leaving the screen mid-run keeps the stream open; an idle document stops listening.

## C. API — as built (`/api/v1`; contract in `routes/contract-agents.ts`, schemas in `schemas-agents.ts`)

| Method | Path | Body → Response |
| --- | --- | --- |
| GET | `/agents` | `{ roles, agents: AgentSummary[] (builtin + custom, `builtin:false`), tools[{name,description,requiresApproval}], workflows, health }` |
| GET / POST | `/agents/custom` | `{ agents }` / `CustomAgentInput` → 201 `{ agent }` (400 `errors[{path,message}]`, 422 semantic, 409 duplicate name) |
| POST | `/agents/custom/import` | exported JSON (`schemaVersion: "xr-5.0.0/agent-v1"`) → 201 `{ agent }` |
| GET / PATCH / DELETE | `/agents/custom/{id}` | `{ agent }` / `{ agent }` (version++) / `{ ok }` |
| POST | `/agents/custom/{id}/duplicate` | → 201 `{ agent }` |
| GET | `/workflows` | `{ workflows: WorkflowSummary[] }` (`definitionId, name, version, nodeCount, summary{nodes,tools,humanChecks,llmSteps}, tags, publishedAt, lastRun`) |
| POST | `/workflows` | `{ name, description?, graph: CanvasGraph, tags? }` → 201 `{ workflow, graph, problems, versions }` (422 lint errors) |
| POST | `/workflows/inspect` | `{ graph }` → `{ ok, problems, summary }` |
| GET | `/workflows/{id}` | `{ workflow, graph, problems, versions }` (`?version=`) |
| PATCH | `/workflows/{id}` | `{ graph, baseVersion, name?, description?, tags? }` → new immutable version (409 when `baseVersion` is stale) |
| DELETE | `/workflows/{id}` | deactivate all versions → `{ ok }` |
| POST | `/workflows/{id}/run` | `{ version?, parameters? }` → 202 `{ run: WorkflowRunView }` (400 missing params, 429 at 3 in flight) |
| GET | `/workflows/runs` | `{ runs }` (`?limit=&definitionId=`) |
| GET | `/workflows/runs/{runId}` | `{ run: WorkflowRunView }` (`nodes[]`, `cost`, `pendingHuman[{nodeId,approvalId,kind,summary}]`, `artifacts`) |
| GET | `/workflows/runs/{runId}/stream` | SSE `run_state · node_state · log · cost_update · approval_required · run_end`, replay then live, `stream_end` + `[DONE]` |
| POST | `/workflows/runs/{runId}/cancel` · `/pause` · `/resume` | `{ ok, state }` |
| POST | `/workflows/runs/{runId}/human-decision` | `{ nodeId, decision: approve|deny|changes_requested|reject, comment? }` → `{ run }` — goes THROUGH the approval record when one exists |

## D. Order of work

1. Engine: events + cost + branch skip (+ tests in `test/workflow/`).
2. `lint.ts`, `canvas.ts` (+ tests). 3. Custom agent store (+ tests). 4. Runtime + routes + contract + OpenAPI/client regen.
5. Desktop: agents core/api/stores → screen shell → Prebuilt → My Agents + editor → Chat `?agent=` → canvas (palette/nodes/edges/inspector/toolbar/problems) → compile/save/load → run + SSE + approvals → summary → shortcuts/context menus/auto-arrange → cross-surface → themes → reduced motion → a11y.
6. Rig smoke (mock LLM) + Playwright screenshots → docs → squash → PR.
