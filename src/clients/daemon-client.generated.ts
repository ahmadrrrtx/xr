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

  /** Search the web through XR's research providers (SearXNG / Firecrawl) and return normalized sources. */
  async researchSearch(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("POST", "/api/v1/research/search", body);
  }

  /** Scrape one public URL into normalized markdown/text with metadata, content hash, and citations. */
  async researchScrape(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("POST", "/api/v1/research/scrape", body);
  }

  /** Map a site's URLs (discovery only). */
  async researchMap(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("POST", "/api/v1/research/map", body);
  }

  /** Start a bounded async crawl job (poll GET /api/research/jobs/{id} or stream /api/research/stream/{id}). */
  async researchCrawl(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("POST", "/api/v1/research/crawl", body);
  }

  /** Extract schema-validated structured data from URLs. */
  async researchExtract(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("POST", "/api/v1/research/extract", body);
  }

  /** List research jobs (live + persisted). */
  async researchJobsList(): Promise<z.infer<typeof S.ResearchJobsListResponse>> {
    return await this.call("GET", "/api/v1/research/jobs");
  }

  /** Inspect one research job by id. */
  async researchJobsGet(id: string): Promise<z.infer<typeof S.ResearchJobResponse>> {
    return await this.call("GET", `/api/v1/research/jobs/${encodeURIComponent(id)}`);
  }

  /** Cancel a running research job (truthful cancelled state; partial results preserved). */
  async researchJobsCancel(id: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", `/api/v1/research/jobs/${encodeURIComponent(id)}/cancel`);
  }

  /** Stream research progress as Server-Sent Events. (SSE stream — returns the raw Response). */
  async researchJobsStream(id: string): Promise<Response> {
    return await this.raw("GET", `/api/v1/research/stream/${encodeURIComponent(id)}`);
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

  /** Export the signed, hash-chained audit bundle (same report as `xr audit export`). */
  async auditExport(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/audit/export");
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

  /** Durable pending approvals across all surfaces (workspace store). */
  async approvalsList(): Promise<z.infer<typeof S.ApprovalsListResponse>> {
    return await this.call("GET", "/api/v1/approvals");
  }

  /** Decide a durable approval request (approve/deny). TTL default-deny applies. */
  async approvalsDecide(approvalId: string, body: z.infer<typeof S.ApprovalDecisionRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", `/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`, body);
  }

  /** Voice session state + offline STT/TTS backend probes. */
  async voiceStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/voice/status");
  }

  /** Start/stop the live voice session (mic uplink armed). */
  async voiceSession(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/session");
  }

  /** Upload pcm16-le 16 kHz mic chunks; engine endpointing + VAD. */
  async voiceAudio(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/audio");
  }

  /** SSE downlink: state/final transcript/tts audio/barge-in/approvals. */
  async voiceEvents(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/voice/events");
  }

  /** Barge-in: cancel current TTS (and flagged run), return to listening. */
  async voiceBarge(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/barge-in");
  }

  /** Shell reports TTS playback finished; session returns to listening. */
  async voicePlayed(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/played");
  }

  /** Make the assistant speak a line through the offline TTS pipeline. */
  async voiceSay(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/say");
  }

  /** First-run status: does this install need setup, and why. */
  async onboardingStatus(): Promise<z.infer<typeof S.OnboardingStatusResponse>> {
    return await this.call("GET", "/api/v1/onboarding/status");
  }

  /** Save a hosted provider API key (BYOK) and set it as the default route. The key is stored in the OS keychain or sealed file and is never returned. The save succeeds even when the live probe fails — the outcome is reported honestly. */
  async onboardingProvider(body: z.infer<typeof S.OnboardingProviderRequest>): Promise<z.infer<typeof S.OnboardingProviderResponse>> {
    return await this.call("POST", "/api/v1/onboarding/provider", body);
  }

  /** Record onboarding completion in the audit log (the honest completion record). */
  async onboardingComplete(body: z.infer<typeof S.OnboardingCompleteRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/onboarding/complete", body);
  }

  /** List the project root (process.cwd()) — one level, scope-enforced, with real per-file git status. */
  async filesList(): Promise<z.infer<typeof S.FilesListResponse>> {
    return await this.call("GET", "/api/v1/files");
  }

  /** Read a text file inside the project root (scope-enforced, size-capped). */
  async filesRead(body: z.infer<typeof S.FilesReadRequest>): Promise<z.infer<typeof S.FilesReadResponse>> {
    return await this.call("GET", "/api/v1/files/read", body);
  }

  /** Real `git diff` for a tracked file inside the project root. */
  async filesDiff(body: z.infer<typeof S.FilesDiffRequest>): Promise<z.infer<typeof S.FilesDiffResponse>> {
    return await this.call("GET", "/api/v1/files/diff", body);
  }

  /** Save a text file inside the project root — human-approval-gated, scope-enforced, staleness-guarded, hash-chain audited. */
  async filesWrite(body: z.infer<typeof S.FilesWriteRequest>): Promise<z.infer<typeof S.FilesWriteResponse>> {
    return await this.call("POST", "/api/v1/files/write", body);
  }

  /** Workspace git branch + porcelain status (argv-only git, root-scoped). */
  async gitStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/git/status");
  }

  /** Recent commits for the workspace (bounded, argv-only). */
  async gitLog(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/git/log");
  }

  /** Stage paths with `git add` — runs only after a durable human approval (riskTier medium). */
  async gitStage(body: z.infer<typeof S.GitStageRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/git/stage", body);
  }

  /** Commit staged work — runs only after a durable human approval (riskTier high). */
  async gitCommit(body: z.infer<typeof S.GitCommitRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/git/commit", body);
  }

  /** Run ONE shell command in the project root — deterministic policy check, durable approval, output streamed as SSE (line-based command runner, NOT a PTY). (SSE stream — returns the raw Response). */
  async terminalRun(body: z.infer<typeof S.TerminalRunRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/terminal/run", body);
  }

  /** One-shot chat completion streamed as Server-Sent Events. (SSE stream — returns the raw Response). */
  async chatStreamPost(body: z.infer<typeof S.ChatStreamRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/chat", body);
  }

  /** List built-in orchestration roles and live multi-agent workflow runs. */
  async agentsList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/agents");
  }

  /** Inspect an agent workflow run by id. */
  async agentsWorkflowGet(workflow: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/agents/workflows/${encodeURIComponent(workflow)}`);
  }

  /** Deterministic planner templates per workflow kind (gallery source). */
  async agentsTemplates(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/agents/templates");
  }

  /** Plan (dryRun) or plan+run a team workflow; execution is detached, record is authoritative. */
  async agentsWorkflowCreate(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/agents/workflows");
  }

  /** Team-run control verbs: pause (drains current wave), resume, cancel — engine-guarded. */
  async agentsWorkflowControl(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/agents/workflows/");
  }

  /** Steer a live run: delegate an instruction to a worker (audited handoff). */
  async agentsWorkflowSteer(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/agents/workflows/");
  }

  /** Human review decision for an awaiting_review task (approve completes, reject blocks). */
  async agentsWorkflowReview(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/agents/workflows/");
  }

  /** SSE downlink for task lifecycle events (started/ready/blocked/completed/failed/note). */
  async agentsEvents(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/agents/events");
  }

  /** Budget caps, current usage, and remaining headroom. */
  async budgetGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/budget");
  }

  /** Set budget caps (per-task/daily/monthly) and warning behavior. */
  async budgetSet(body: z.infer<typeof S.BudgetSetRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/budget/set", body);
  }

  /** List governed triggers and the global pause-all kill switch. */
  async triggersList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/triggers");
  }

  /** Create a governed trigger (requires consentRef + budget). */
  async triggersCreate(body: z.infer<typeof S.TriggerCreateRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/triggers", body);
  }

  /** Pause or resume ALL triggers (kill switch). In-flight fires are not cancelled. */
  async triggersPause(body: z.infer<typeof S.TriggerPauseRequest>): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", "/api/v1/triggers/pause", body);
  }

  /** Inspect one trigger by id. */
  async triggersGet(id: string): Promise<Record<string, unknown>> {
    return await this.call("GET", `/api/v1/triggers/${encodeURIComponent(id)}`);
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

  /** Set the trust mode (careful|balanced|autonomous); the policy gate enforces it. */
  async trustMode(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/trust/mode");
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

  /** Provider capabilities (supported features per provider). Phase 04 gateway. */
  async providersCapabilities(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers/capabilities");
  }

  /** Resolved fallback chain (primary → fallbackProvider → local). Phase 04 gateway. */
  async providersFallback(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/providers/fallback");
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

  /** List registered MCP servers (live registry, CLI parity). */
  async mcpList(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/mcp");
  }

  /** Register an MCP server (stdio command or http url). */
  async mcpAdd(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/add");
  }

  /** Remove (uninstall) a registered MCP server. */
  async mcpRemove(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/remove");
  }

  /** Enable a registered MCP server. */
  async mcpEnable(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/enable");
  }

  /** Disable a registered MCP server. */
  async mcpDisable(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/disable");
  }

  /** Best-effort health probe across registered MCP servers. */
  async mcpHealth(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/mcp/health");
  }

  /** SEC-01 pin snapshot: pinned MCP tool-contract hashes per server. */
  async mcpPins(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/mcp/pins");
  }

  /** SEC-01 live drift report: pinned contract vs what the server advertises now. */
  async mcpPinsDiff(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/mcp/pins/diff/");
  }

  /** SEC-01 pin a server's current tool contracts (hash snapshot). */
  async mcpPin(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/pin");
  }

  /** SEC-01 drop a server's pin (legacy per-call approvals resume). */
  async mcpUnpin(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/mcp/unpin");
  }

  /** Computer-control subsystem status. */
  async controlStatus(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/status");
  }

  /** Single composed pane: control status + pending + permissions + triggers + mode. */
  async controlCockpit(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/control/cockpit");
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

  /** Pause/resume/stop computer control (durable, honored per-action by the gate; stop also denies all pending approvals). */
  async controlPause(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/control/pause");
  }

  /** Grant a standing computer-use permission scope (persisted, audited, gate-enforced). */
  async controlPermissionsGrant(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/control/permissions/grant");
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
