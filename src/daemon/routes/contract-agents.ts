/**
 * Phase 19 · Custom agents + visual workflows — operation contract entries
 * (schemas live in schemas-agents.ts; spread into the main registry in
 * contract.ts; kept here so the registry stays under the size gate without
 * losing its single-map semantics).
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  OkResponse,
  CustomAgentInputRequest,
  CustomAgentPatchRequest,
  CustomAgentResponse,
  CustomAgentListResponse,
  CustomAgentDuplicateRequest,
  WorkflowInspectRequest,
  WorkflowInspectResponse,
  WorkflowCreateRequest,
  WorkflowUpdateRequest,
  WorkflowListResponse,
  WorkflowResponse,
  WorkflowRunStartRequest,
  WorkflowRunResponse,
  WorkflowRunListResponse,
  WorkflowRunEventFrame,
  WorkflowDecisionRequest,
  WorkflowControlResponse,
} from "./schemas.ts";

const agents = { tag: "agents", stability: "experimental" as const };
const workflows = { tag: "workflows", stability: "experimental" as const };
const AGENT_ID = [{ name: "id", description: "Custom agent id (custom-…)." }];
const WF_ID = [{ name: "id", description: "Workflow definition id." }];
const RUN_ID = [{ name: "runId", description: "Workflow run id from workflows.run." }];

export const AGENTS_WORKFLOWS_CONTRACT: Record<string, ApiOperationMeta> = {
  // ── Custom agents (versioned JSON under $XR_HOME/agents) ─────────────────
  "agents.custom.list": {
    ...agents,
    summary: "List user-authored agents (full documents, newest first).",
    response: CustomAgentListResponse,
  },
  "agents.custom.create": {
    ...agents,
    summary: "Create a custom agent; validated (name, prompt ≥ 20 chars, tools ⊆ engine tools, budget $0.01–$5) and stored as versioned JSON.",
    request: CustomAgentInputRequest,
    response: CustomAgentResponse,
  },
  "agents.custom.import": {
    ...agents,
    summary: "Import an exported agent document; a free, well-formed id is kept, otherwise a new one is minted (imports never overwrite).",
    request: CustomAgentInputRequest,
    response: CustomAgentResponse,
  },
  "agents.custom.get": {
    ...agents,
    summary: "One custom agent — the same document the Export action downloads.",
    template: "/api/agents/custom/{id}",
    pathParams: AGENT_ID,
    response: CustomAgentResponse,
  },
  "agents.custom.update": {
    ...agents,
    summary: "Update a custom agent (partial merge, same validation); every save bumps `version`.",
    template: "/api/agents/custom/{id}",
    pathParams: AGENT_ID,
    request: CustomAgentPatchRequest,
    response: CustomAgentResponse,
  },
  "agents.custom.delete": {
    ...agents,
    summary: "Delete a custom agent file.",
    template: "/api/agents/custom/{id}",
    pathParams: AGENT_ID,
    response: OkResponse,
  },
  "agents.custom.duplicate": {
    ...agents,
    summary: "Duplicate a custom agent into a new document.",
    template: "/api/agents/custom/{id}/duplicate",
    pathParams: AGENT_ID,
    request: CustomAgentDuplicateRequest,
    response: CustomAgentResponse,
  },

  // ── Workflows (React Flow graph → canonical WorkflowDefinition) ──────────
  "workflows.list": {
    ...workflows,
    summary: "List saved workflows (latest active version each) with a graph summary and the last run.",
    response: WorkflowListResponse,
  },
  "workflows.create": {
    ...workflows,
    summary: "Compile a canvas graph into a canonical WorkflowDefinition, lint it (errors → 422 with per-node problems) and publish version 1 (immutable, content-hashed).",
    request: WorkflowCreateRequest,
    response: WorkflowResponse,
  },
  "workflows.inspect": {
    ...workflows,
    summary: "Compile + lint a canvas graph without saving; returns problems and a graph summary (nodes · tools · human checks).",
    request: WorkflowInspectRequest,
    response: WorkflowInspectResponse,
  },
  "workflows.runs.list": {
    ...workflows,
    summary: "Recent workflow runs across all definitions.",
    response: WorkflowRunListResponse,
  },
  "workflows.runs.get": {
    ...workflows,
    summary: "A workflow run with per-node states, cost and pending human checks.",
    template: "/api/workflows/runs/{runId}",
    pathParams: RUN_ID,
    response: WorkflowRunResponse,
  },
  "workflows.runs.stream": {
    ...workflows,
    summary: "Stream a workflow run as Server-Sent Events: buffered replay, then live run_state · node_state · log · cost_update · approval_required · run_end · stream_end. Every event is emitted by the engine as the run advances.",
    sse: true,
    template: "/api/workflows/runs/{runId}/stream",
    pathParams: RUN_ID,
    response: WorkflowRunEventFrame,
  },
  "workflows.runs.cancel": {
    ...workflows,
    summary: "Cancel a run — aborts the in-flight node (model call / tool) and withdraws any parked human check.",
    template: "/api/workflows/runs/{runId}/cancel",
    pathParams: RUN_ID,
    response: WorkflowControlResponse,
  },
  "workflows.runs.pause": {
    ...workflows,
    summary: "Pause a running workflow after the current node finishes.",
    template: "/api/workflows/runs/{runId}/pause",
    pathParams: RUN_ID,
    response: WorkflowControlResponse,
  },
  "workflows.runs.resume": {
    ...workflows,
    summary: "Resume a paused workflow.",
    template: "/api/workflows/runs/{runId}/resume",
    pathParams: RUN_ID,
    response: WorkflowControlResponse,
  },
  "workflows.runs.decide": {
    ...workflows,
    summary: "Record a human decision for a parked approval/review node. Goes through the same approval record the Shield modal decides; the engine enforces the node's denial/expiry policy.",
    template: "/api/workflows/runs/{runId}/human-decision",
    pathParams: RUN_ID,
    request: WorkflowDecisionRequest,
    response: WorkflowRunResponse,
  },
  "workflows.get": {
    ...workflows,
    summary: "A workflow definition (latest or ?version=) with its canvas graph, lint problems and version list.",
    template: "/api/workflows/{id}",
    pathParams: WF_ID,
    response: WorkflowResponse,
  },
  "workflows.update": {
    ...workflows,
    summary: "Publish a new immutable version from the canvas graph; `baseVersion` must be the latest (409 otherwise).",
    template: "/api/workflows/{id}",
    pathParams: WF_ID,
    request: WorkflowUpdateRequest,
    response: WorkflowResponse,
  },
  "workflows.delete": {
    ...workflows,
    summary: "Retire a workflow: every version is marked inactive (runs and history are kept).",
    template: "/api/workflows/{id}",
    pathParams: WF_ID,
    response: OkResponse,
  },
  "workflows.run": {
    ...workflows,
    summary: "Start a run of a workflow (latest or a given version) with resolved parameters; at most 3 runs in flight (429 otherwise). Returns the queued run to stream.",
    template: "/api/workflows/{id}/run",
    pathParams: WF_ID,
    request: WorkflowRunStartRequest,
    response: WorkflowRunResponse,
  },
  "workflows.runs.history": {
    ...workflows,
    summary: "Run history for one workflow definition.",
    template: "/api/workflows/{id}/runs",
    pathParams: WF_ID,
    response: WorkflowRunListResponse,
  },
};
