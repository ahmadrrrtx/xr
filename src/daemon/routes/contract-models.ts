/**
 * Providers / workspaces / models — the contract half.
 *
 * Extracted from `contract.ts` when it crossed its recorded waiver (XR-REL-02
 * pull, XR-REL-06 custom endpoints). Same convention as `contract-memory.ts`,
 * `contract-agents.ts`, …: `contract.ts` spreads this back into `API_CONTRACT`,
 * so nothing downstream changes. Consent-plane transport, so it stays in core.
 */
import type { ApiOperationMeta } from "./contract.ts";
import {
  ProviderDiscoverRequest, ProviderValidateRequest, ProviderDiscoveryResponse, ProviderProbeRequest, ModelsPullRequest, ModelsSelectRequest, ModelsTestRequest, CustomProviderAddRequest,
  CustomProviderRemoveRequest, ProviderSetRequest, WorkspaceCreateRequest,
  WorkspaceSwitchRequest, OkResponse,
} from "./schemas.ts";

export const MODELS_CONTRACT: Record<string, ApiOperationMeta> = {
  "providers.discover": { summary: "Opt-in bounded model enumeration; not inference/capability verification.", tag: "providers", stability: "experimental", request: ProviderDiscoverRequest, response: ProviderDiscoveryResponse },
  "providers.validate": { summary: "Consented, potentially billable, isolated capability round trip; never executes a tool or certifies agent/billing behavior.", tag: "providers", stability: "experimental", request: ProviderValidateRequest },
  "providers.probe": {
    summary: "Explicit adapter endpoint probe (may send a minimal billable request; not capability verification).",
    tag: "providers", stability: "experimental", request: ProviderProbeRequest,
  },
  "providers.list": {
    summary: "Provider status (keys present, health, defaults).",
    tag: "providers",
    stability: "stable",
  },
  "providers.set": {
    summary: "Select default provider/model (+ optional fallback).",
    tag: "providers",
    stability: "stable",
    request: ProviderSetRequest,
    response: OkResponse,
  },
  "providers.route": {
    summary: "Show the explainable routing decision for a task profile.",
    tag: "providers",
    stability: "stable",
  },
  "providers.slo": {
    summary: "Routing SLO measurements (selection-latency compliance).",
    tag: "providers",
    stability: "stable",
  },
  "providers.catalog": {
    summary: "Full provider/model catalog with capabilities.",
    tag: "providers",
    stability: "stable",
  },
  "providers.capabilities": {
    summary: "Provider capabilities (supported features per provider). Phase 04 gateway.",
    tag: "providers",
    stability: "stable",
  },
  "providers.fallback": {
    summary: "Resolved fallback chain (primary → fallbackProvider → local). Phase 04 gateway.",
    tag: "providers",
    stability: "stable",
  },
  "providers.custom.list": {
    summary: "List custom OpenAI-compatible endpoints (env-var names only).",
    tag: "providers",
    stability: "experimental",
  },
  "providers.custom.remove": {
    summary: "Remove a custom endpoint (its stored secret is retained).",
    tag: "providers",
    stability: "experimental",
    request: CustomProviderRemoveRequest,
  },
  "providers.custom.add": {
    summary: "Add or replace a custom OpenAI-compatible endpoint (SSRF-guarded).",
    tag: "providers",
    stability: "experimental",
    request: CustomProviderAddRequest,
  },
  "workspaces.list": {
    summary: "List workspaces and the active one.",
    tag: "workspaces",
    stability: "stable",
  },
  "workspaces.create": {
    summary: "Create a workspace.",
    tag: "workspaces",
    stability: "stable",
    request: WorkspaceCreateRequest,
  },
  "workspaces.switch": {
    summary: "Switch the active workspace.",
    tag: "workspaces",
    stability: "stable",
    request: WorkspaceSwitchRequest,
    response: OkResponse,
  },
  "models.list": {
    summary: "Local model runtimes: detection status and installed models.",
    tag: "models",
    stability: "stable",
  },
  "models.select": {
    summary: "Select a local runtime+model and routing posture.",
    tag: "models",
    stability: "stable",
    request: ModelsSelectRequest,
  },
  "models.test": {
    summary: "Smoke-test a local runtime+model round-trip.",
    tag: "models",
    stability: "stable",
    request: ModelsTestRequest,
  },
  "models.pull": {
    summary: "Pull a local model, streaming the runtime's own byte progress (SSE).",
    tag: "models",
    stability: "experimental",
    request: ModelsPullRequest,
  },
};
