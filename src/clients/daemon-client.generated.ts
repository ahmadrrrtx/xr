/**
 * XR Daemon API v1 — typed client (GENERATED — do not edit).
 *
 * Source: live route registry + contract schemas.
 * Regenerate: bun run client:generate · Drift gate: bun run client:check
 */

import type { z } from "zod/v4";
import * as S from "../daemon/routes/schemas.ts";

export interface XRDaemonClientOptions {
  /** Daemon base URL, e.g. http://127.0.0.1:3141 (no trailing slash). */
  baseUrl: string;
  /** Local daemon bearer token (printed by `xr serve`). */
  token: string;
  /** Fetch implementation override (tests). */
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

/** Structured API error (problem+json envelope + legacy `error`). */
export class XRApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { error?: string; title?: string; detail?: string; errors?: Array<{ path: string; message: string }> } | null,
  ) {
    super(problem?.error ?? problem?.detail ?? `XR API error ${status}`);
    this.name = "XRApiError";
  }
}

/** Typed client for the versioned daemon API (/api/v1). */
export class XRDaemonClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>;

  constructor(opts: XRDaemonClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetcher = opts.fetchImpl ?? ((globalThis as { fetch: typeof fetch }).fetch);
  }

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    return await this.fetcher(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (!res.ok) {
      let problem: ConstructorParameters<typeof XRApiError>[1] = null;
      try {
        const parsed = (await res.json()) as NonNullable<typeof problem>;
        problem = parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        problem = null;
      }
      throw new XRApiError(res.status, problem);
    }
    return (await res.json()) as T;
  }

  /** Liveness/version health probe (unauthenticated). */
  async healthGet(): Promise<z.infer<typeof S.HealthResponse>> {
    return await this.call("GET", "/api/v1/health");
  }

  /** Aggregated mission-control overview (version, git, providers, memory, cost, audit). */
  async overviewGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/overview");
  }

  /** Cost/usage summary for the active workspace. */
  async costGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/cost");
  }

  /** Recent audit-chain entries (append-only, hash-chained). */
  async auditGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/audit");
  }

  /** Security posture summary (shield + trust + supply chain). */
  async securityGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/security");
  }

  /** List durable agent/execution sessions. */
  async sessionsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/sessions");
  }

  /** Inspect one session by id. */
  async sessionsGet(id: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  /** List research runs. */
  async researchList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/research");
  }

  /** Inspect one research run by id. */
  async researchGet(id: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/research/${encodeURIComponent(id)}`);
  }

  /** Durable-execution recovery status (unresolved work, RPO/RTO). */
  async recoveryStatusGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/recovery");
  }

  /** Effective configuration with secrets redacted. */
  async configSafeGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/config");
  }

  /** One-shot chat completion streamed as Server-Sent Events. (SSE stream — returns the raw Response). */
  async chatStreamPost(body: z.infer<typeof S.ChatStreamRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/chat", body);
  }

  /** List built-in agent roles (supervisor, planner, executor). */
  async agentsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/agents");
  }

  /** Inspect an agent workflow run by id. */
  async agentsWorkflowGet(workflow: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/agents/workflows/${encodeURIComponent(workflow)}`);
  }

  /** Budget caps, current usage, and remaining headroom. */
  async budgetGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/budget");
  }

  /** Set budget caps (per-task/daily/monthly) and warning behavior. */
  async budgetSet(body: z.infer<typeof S.BudgetSetRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/budget/set", body);
  }

  /** Shield security-service status. */
  async shieldStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/status");
  }

  /** Recent scan results and findings. */
  async shieldScan(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/scan");
  }

  /** System process security snapshot. */
  async shieldProcesses(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/processes");
  }

  /** Startup-entry security snapshot. */
  async shieldStartup(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/startup");
  }

  /** Privacy posture (telemetry off, local-first indicators). */
  async shieldPrivacy(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/privacy");
  }

  /** Download-security findings. */
  async shieldDownloads(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/downloads");
  }

  /** Browser-security snapshot. */
  async shieldBrowser(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/shield/browser");
  }

  /** Explain one shield finding by id. */
  async shieldExplain(body: z.infer<typeof S.ShieldExplainRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/shield/explain", body);
  }

  /** Quarantine lifecycle: isolate | restore | delete a finding. */
  async shieldQuarantine(body: z.infer<typeof S.ShieldQuarantineRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/shield/quarantine", body);
  }

  /** Add/remove a whitelist entry. */
  async shieldWhitelist(body: z.infer<typeof S.ShieldWhitelistRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/shield/whitelist", body);
  }

  /** Toggle the ad-block component. */
  async shieldAdblock(body: z.infer<typeof S.ShieldAdblockRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/shield/adblock", body);
  }

  /** Trust & isolation service status (available backends, policy). */
  async trustGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/trust");
  }

  /** Classify an action's risk tier and resolve its isolation placement. */
  async trustClassifyPost(body: z.infer<typeof S.TrustClassifyRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/trust/classify", body);
  }

  /** Search/list capability descriptors (filters via query params). */
  async capabilitiesList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/capabilities");
  }

  /** Capability service health and counts. */
  async capabilitiesHealth(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/capabilities/health");
  }

  /** Inspect one capability descriptor (?id=). */
  async capabilitiesInspect(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/capabilities/inspect");
  }

  /** Effective permission view for a capability (?id=). */
  async capabilitiesPermissions(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/capabilities/permissions");
  }

  /** Run contract-test certification for a capability. */
  async capabilitiesCertify(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/capabilities/certify", body);
  }

  /** Enable an installed capability. */
  async capabilitiesEnable(body: z.infer<typeof S.CapabilityIdRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/capabilities/enable", body);
  }

  /** Disable an enabled capability. */
  async capabilitiesDisable(body: z.infer<typeof S.CapabilityIdRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/capabilities/disable", body);
  }

  /** Quarantine a capability (fail-closed). */
  async capabilitiesQuarantine(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/capabilities/quarantine", body);
  }

  /** Rollback a capability to a previous version. */
  async capabilitiesRollback(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/capabilities/rollback", body);
  }

  /** Provider status (keys present, health, defaults). */
  async providersList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers");
  }

  /** Select default provider/model (+ optional fallback). */
  async providersSet(body: z.infer<typeof S.ProviderSetRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/providers/set", body);
  }

  /** Show the explainable routing decision for a task profile. */
  async providersRoute(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers/route");
  }

  /** Routing SLO measurements (selection-latency compliance). */
  async providersSlo(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers/slo");
  }

  /** Full provider/model catalog with capabilities. */
  async providersCatalog(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers/catalog");
  }

  /** List workspaces and the active one. */
  async workspacesList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/workspaces");
  }

  /** Create a workspace. */
  async workspacesCreate(body: z.infer<typeof S.WorkspaceCreateRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/workspaces/create", body);
  }

  /** Switch the active workspace. */
  async workspacesSwitch(body: z.infer<typeof S.WorkspaceSwitchRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/workspaces/switch", body);
  }

  /** Local model runtimes: detection status and installed models. */
  async modelsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/models");
  }

  /** Select a local runtime+model and routing posture. */
  async modelsSelect(body: z.infer<typeof S.ModelsSelectRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/models/select", body);
  }

  /** Smoke-test a local runtime+model round-trip. */
  async modelsTest(body: z.infer<typeof S.ModelsTestRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/models/test", body);
  }

  /** Computer-control subsystem status. */
  async controlStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/status");
  }

  /** Recent control events (?limit=, ≤200). */
  async controlEvents(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/events");
  }

  /** Pending control authorizations (approval queue). */
  async controlPending(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/pending");
  }

  /** Approve or deny a pending control authorization. */
  async controlApprove(body: z.infer<typeof S.ControlApproveRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/control/approve", body);
  }

  /** Produce a control plan for a task (planning service). */
  async controlPlan(body: z.infer<typeof S.ControlPlanRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/control/plan", body);
  }

  /** List control-layer memory records. */
  async controlMemoryList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/memory");
  }

  /** Delete one control-layer memory record by id. */
  async controlMemoryDelete(id: string): Promise<Record<string, unknown>> {
    return await this.call("DELETE", `/api/v1/control/memory/${encodeURIComponent(id)}`);
  }

  /** Control history (legacy alias of events). */
  async controlHistoryLegacy(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/history");
  }

  /** Control permissions (legacy alias). */
  async controlPermissionsLegacy(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/permissions");
  }

  /** Environment manager status. */
  async environmentStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/status");
  }

  /** Environment interaction capability map. */
  async environmentCapabilities(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/capabilities");
  }

  /** List open environment sessions. */
  async environmentSessions(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/sessions");
  }

  /** Close an environment session. */
  async environmentClose(body: z.infer<typeof S.EnvironmentCloseRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/environment/close", body);
  }

  /** Environment action history. */
  async environmentHistory(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/history");
  }

  /** Environment observations log. */
  async environmentObservations(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/observations");
  }

  /** Effective environment policy. */
  async environmentPolicy(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/environment/policy");
  }

  /** List memory records (legacy memory surface). */
  async memoryList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/memory");
  }

  /** Memory subsystem health. */
  async memoryHealth(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/memory/health");
  }

  /** Semantic memory search (?query=). */
  async memorySearch(body: z.infer<typeof S.MemorySearchQuery>): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/memory/search", body);
  }

  /** Delete one memory record by id. */
  async memoryDelete(id: string): Promise<Record<string, unknown>> {
    return await this.call("DELETE", `/api/v1/memory/${encodeURIComponent(id)}`);
  }

  /** Context store status (counts, freshness, integrity). */
  async contextStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/context");
  }

  /** List context items (?type=&scope=&all=). */
  async contextItems(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/context/items");
  }

  /** Effective context capture/injection policy. */
  async contextPolicy(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/context/policy");
  }

  /** Pending consent decisions (capture/injection). */
  async contextPending(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/context/pending");
  }

  /** Export all context data (data-ownership). */
  async contextExport(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/context/export");
  }

  /** Inspect one context item by id. */
  async contextInspect(id: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/context/item/${encodeURIComponent(id)}`);
  }

  /** Approve a pending context consent decision. */
  async contextApprove(id: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", `/api/v1/context/approve/${encodeURIComponent(id)}`);
  }

  /** Undo a context/memory mutation exactly (latest, or a specific undo-ledger op). Restore never fabricates authority — the before-image is what comes back. */
  async contextUndo(body: z.infer<typeof S.ContextUndoRequest>): Promise<z.infer<typeof S.ContextUndoOutcome>> {
    return await this.call("POST", "/api/v1/context/undo", body);
  }

  /** Revoke consent for a context item (undoable via the undo ledger). */
  async contextRevoke(id: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", `/api/v1/context/revoke/${encodeURIComponent(id)}`);
  }

  /** Business OS extension status (?orgId=&workspaceId=). */
  async businessStatusGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/status");
  }

  /** List business journeys. */
  async businessJourneysList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/journeys");
  }

  /** Start a business journey. */
  async businessJourneysStart(journeyId: string, body: z.infer<typeof S.BusinessJourneyStartRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", `/api/v1/business/journeys/${encodeURIComponent(journeyId)}/start`, body);
  }

  /** List business outcome records. */
  async businessOutcomesList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/outcomes");
  }

  /** Inspect a business outcome. */
  async businessOutcomesGet(outcomeId: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/business/outcomes/${encodeURIComponent(outcomeId)}`);
  }

  /** List business approval requests. */
  async businessApprovalsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/approvals");
  }

  /** Decide a business approval. */
  async businessApprovalsDecide(approvalId: string, body: z.infer<typeof S.BusinessApprovalDecisionRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", `/api/v1/business/approvals/${encodeURIComponent(approvalId)}/decide`, body);
  }

  /** List business artifacts. */
  async businessArtifactsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/artifacts");
  }

  /** List governed business workers. */
  async businessWorkersList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/workers");
  }

  /** Inspect a business worker. */
  async businessWorkersGet(workerId: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/business/workers/${encodeURIComponent(workerId)}`);
  }

  /** Disable a business worker. */
  async businessWorkersDisable(workerId: string): Promise<Record<string, unknown>> {
    return await this.call("POST", `/api/v1/business/workers/${encodeURIComponent(workerId)}/disable`);
  }

  /** Enable a business worker. */
  async businessWorkersEnable(workerId: string): Promise<Record<string, unknown>> {
    return await this.call("POST", `/api/v1/business/workers/${encodeURIComponent(workerId)}/enable`);
  }

  /** List business mutation proposals (auditable). */
  async businessMutationsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/business/mutations");
  }

  /** Business privacy view for a subject. */
  async businessPrivacyGet(subject: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/business/privacy/${encodeURIComponent(subject)}`);
  }

  /** API index: version, operation catalogue link, OpenAPI location. */
  async metaApiRootGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1");
  }

  /** The generated OpenAPI 3.1 document for this daemon. */
  async metaOpenapiGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/openapi.json");
  }

  /** Prometheus text exposition of daemon/runtime metrics (Phase 8 · T2). */
  async metaMetricsGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/metrics");
  }

  /** Recent trace spans (structural only; local ring buffer; never content). */
  async metaTracesGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/traces/recent");
  }

}

/** Convenience factory. */
export function createDaemonClient(opts: XRDaemonClientOptions): XRDaemonClient {
  return new XRDaemonClient(opts);
}
