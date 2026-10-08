# Phase 19 — Agents: study notes

Branch `phase/19-agents-workflows`. Written before code (Step 0 of the brief).

## 1. Brief premises vs. what the repo actually has

| Brief says | Repo reality | Consequence |
| --- | --- | --- |
| `desktop/src/screens/Agents.tsx` is a 113-line swimlane stub with mock lanes | `screens/Agents/index.tsx` is a 5-line `PlaceholderScreen` | Built Builder/Research-style: `index.tsx` lazy wrapper → `AgentsScreen.tsx` + components. No swimlane to salvage. |
| `desktop/src/api/client.ts` has `agents()/workflow()/…` calls | No `desktop/src/api/` at all. Desktop talks to the engine through `engineFetch`/`engineJson`/`readSse` (`src/engine/transport.ts`, `sse.ts`) and the generated typed client lives in the ROOT at `src/clients/daemon-client.generated.ts` | New endpoints are declared in the daemon contract, OpenAPI + generated client regenerated; the desktop gets a small `src/agents/api.ts` like Research's. |
| `inspection.ts` validates definitions (cycles, dead nodes…) | `inspection.ts` renders RUN inspections for the CLI (`renderInspection`, labels/colours). Definition validation is `nodes.ts#validateGraph` (duplicate ids, missing deps, cycles, trigger-at-root) | A definition linter (`src/execution/workflow/lint.ts`) wraps `validateGraph` and adds per-kind config checks + unreachable/dangling nodes; it returns structured problems for the Problems panel. |
| Engine emits run events / has an SSE surface | `WorkflowEngine` has NO event emission (the agentic `say` callback is a no-op stub), is never constructed by the daemon, `run.cost` never accumulates, `contextProvider` is injected but unused | Added `onEvent` sink + cost accumulation in `engine.ts` (small, additive); the daemon gets a `workflow-runtime.ts` that composes the engine with the real `AgentService.execute()` (one execution path), core tools, approval plane, SQLite repo and a real timer. |
| `agents.routes.ts` exposes workflow CRUD + steer/review/control for the DAG | Those routes drive the Stage-12 **team** runs (`WorkflowRecord` planned by the supervisor), a different model from `execution/workflow` DAG runs | DAG runs get their own `/api/workflows/*` routes. Pause/resume/cancel map to the DAG engine; **steer has no DAG equivalent** (no supervisor to re-plan) — the toolbar says so instead of faking it. |
| `GET /api/agents` lists built-in roles | Returns 3 static `BUILTIN_ROLES` + team workflows + health | Kept (additive): the response now also carries `agents: AgentDefinition[]` from `src/agents/registry.ts` (23 definitions, `builtin: true`) plus custom agents (`builtin: false`). |
| Prebuilt = Coder/Researcher/Writer/Analyst/Designer/Ops/General | Registry has no Writer/Designer/General agents; it has Supervisor, Planner, Researcher, Builder, Reviewer, Verifier, Executor, Synthesizer, Memory Manager, Router, Model Selector, Security Checker + 12 role specialisations (disabled by default) | Gallery shows what the engine really has, grouped into honest families (Coding / Research / Writing / Analysis / Security / Ops / Coordination). No invented agents. |
| Custom agents in `~/xr/agents/` | XR's home is `XR_HOME` (default `~/.xr`) | Stored at `XR_HOME/agents/<id>.json` (sandboxed, validated, versioned). |
| Branch node routes true/false | `executeBranchNode` only flips untaken targets' state when they are `pending`; `refreshNodeReadiness` then marks BOTH targets ready because their dependency (the branch) completed, and untaken nodes otherwise stay pending forever (run parks in `running`) | Engine fix: untaken targets (and nodes whose dependencies are all skipped) are `skipped`; `all` joins already count skipped as satisfied. |

## 2. Engine facts that shape the UI

- **Canonical schema**: `WorkflowDefinition` (`types.ts`, schema `xr-5.0.0/wf-v1`), 14 node kinds. The canvas palette maps onto them: Input → `trigger{manual}`, LLM/Agent → `agentic`, Sub-agent → `agentic` with `agentId`, Tool → `tool_action`, Branch → `branch`, Join → `join`, Human approval → `human_approval`, Human review → `human_review`, Wait → `wait_timer`, Notification → `notification{dashboard}`, Artifact → `artifact_output`, Output → `completion`. **Loop is not a node kind** — the engine has no loop executor, so Loop is not in the palette (documented deviation).
- Node ids come from `nodes.ts` factories (`n_xxxxxxxx`); canvas positions live in `node.metadata.canvas = {x, y}` so a saved definition reloads with its layout. Edge → `dependencies` (plus `trueNodes/falseNodes` for branch handles, `onApproval.nextNodes` for approvals).
- **Versioning**: `createDraft` → `publishDraft` (v1) / `createNewVersion` + `publishNewVersion` (v n+1); `hashDefinition` + `verifyIntegrity`; `WorkflowRepository` (SQLite tables `workflow_definitions/runs/human_decisions`, keyed by `(definition_id, version)`). Save = publish a new immutable version; there is no draft table, so the editor keeps unsaved state locally.
- **Run lifecycle**: `startRun` → `queued`; `executeRun` → ticks of `Promise.allSettled(readyNodes)`; human nodes park the run in `awaiting_approval|awaiting_review`; `submitHumanDecision` resumes; `pauseRun/resumeRun/cancelRun`; cancellation is cooperative (`AbortController` per tick).
- **Agentic nodes** run through `WorkflowAgentRunner.runAgentTask` → wired to `AgentService.execute()` (same path as Chat/Builder: approvals via `ApprovalStore`, budget governor, audit, `surface: "workflow"`). Cost: the runner returns `{usd, tokensIn, tokensOut}` from `AgentResult`; the engine now adds it to `run.cost` and emits `cost_update`.
- **Tool nodes** need a `WorkflowToolExecutor` — production never had one. `workflow-runtime.ts` executes core tools from `src/tools/registry.ts` with the same `ToolContext` the loop uses (egress allow-list, audit, approval plane; `requiresApproval || tool.requiresApproval` → durable approval first). No executor = node fails honestly (engine behaviour kept).
- **Human nodes** also create a durable approval (`tool: "workflow.human_approval"|"workflow.human_review"`, `runId`, `taskId=nodeId`, TTL = node `expiresInMs` capped) so the desktop's existing Approval modal fires. Deciding either through the modal (`POST /api/approvals/:id/decision`) or the inline node buttons (`POST /api/workflows/runs/:id/human-decision`) resolves the same record and calls `engine.submitHumanDecision` — enforced engine-side, the client cannot skip the node.
- **Events** (`onEvent`): `run_state{state}`, `node_state{nodeId,state,error?,outputs?,attempt}`, `log{nodeId?,line}`, `cost_update{cost}`, `approval_required{nodeId,approvalId}`, `run_end{summary}`. The daemon registry buffers them for replay (`GET …/stream` replays then follows; `stream_end` + `[DONE]` like research runs).

## 3. Reuse map (desktop)

- Transport: `engineFetch/engineJson/EngineHttpError`, `readSse`; Brain recorder `beginEngineRun` (workflow nodes become tool spans: `tool_call`/`tool_result` per node, `usage` for cost, `done` at the end) → Runs + Brain list workflow runs with per-node spans.
- Budget: `budgetGate` before `Run`, `recordSpend` with the engine's measured cost after `run_end` (local models → $0 "local").
- Approvals: existing `approvalStore` polling + `ApprovalModal`; only a label for the two new tools.
- Chat `?agent=`: `TurnOverrides` already exists per session (context/agent/surface/mode); extended with `toolsAllow/toolsDeny/model/budgetUsd` and `streamChat` forwards them (the daemon chat route already accepts `toolsAllow/toolsDeny/provider/model/budget`).
- Layout primitives: `Resizer`, `StatusDot`, `useReducedMotion`, Sonner toasts, shadcn Tabs/Dialog/Slider/Switch, Chat's `CodeBlock`.
- Theme tokens: `--accent`, `--warning`, `--success`, `--danger`, `--bg-*`, `--border-*`; glow only in XR Native/Midnight.

## 4. Decisions / deviations (also in the PR)

1. Loop node omitted (no engine executor). Join is offered instead of Loop; a Sub-agent node is an `agentic` node pinned to an agent id (no nested workflow execution — out of scope per brief).
2. Steer is not available for DAG runs (no supervisor). The button is replaced by honest copy; team runs keep their existing endpoint.
3. Custom agents live in `XR_HOME/agents/*.json`; the engine owns reads/writes (no Tauri fs), versions increment on every save, ids are slugs + short random suffix.
4. `GET /api/agents` is additive (`agents[]`); `roles[]` unchanged for compatibility.
5. "Test" on a custom agent navigates to `/chat?agent=<id>` (a Chat session is a desktop concept; no engine "test session" endpoint needed).
6. Academic/ArXiv-style agent pickers in Research: the depth panel gets a researcher-role picker only when more than one research-family agent is enabled; the engine still runs `runResearch()` unchanged.
7. Size gate: tree ceiling raised with a dated reason (Phase 19 adds ~9k lines incl. the canvas).

## 5. Found in the rig (and fixed in this PR)

- **Shield auto-approved a workflow human check.** The daemon parks a human node as a `workflow.human_approval` record with the node's `riskLevel`; the desktop's pending-approval sync bridged it into the global queue, and the policy `autoApproveLowRisk` + risk `low` approved it before anyone saw it. Fix: such requests are `humanOnly` — never auto-approved, remember rules ignored, none minted, excluded from bulk low-risk approval. Covered by `test/desktop/shield-core.test.ts` and `engine-wire.test.ts`.
- **Two dialogs for one question.** Canvas dialog and root Shield modal showed the same record. The canvas dialog now claims the approval surface (`inlineSurface`) while open; a decision through either door settles the other copy with the engine's outcome (no stale modal, no duplicate POST).
- **Duration showed "—".** The completion node moved the run to `completed` before `endedAt` was stamped, so `run_end.summary.endedAt` and the decision reply lacked it; the reply then overwrote fresher stream state. Engine stamps `endedAt` in `executeCompletionNode`; the desktop merges views instead of replacing (`mergeView`).
- **Leaving the screen mid-run froze the canvas.** `leaveScreen` aborted the stream, so Budget/Brain/summary missed the tail. It now keeps listening while a run is active.
- **Zustand v5 selectors** must return stable references (React #185). Store-level memoisation + module constants; see `agentsStore.selectPrebuilt/selectCustom`.

