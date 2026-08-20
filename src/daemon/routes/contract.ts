/**
 * XR Daemon API v1 — operation contract registry (Phase 8 · T1).
 *
 * THE single source of truth for the daemon's public API contract:
 * OpenAPI generation, the typed client generator, runtime request
 * validation, and the compatibility checker all derive from this map,
 * keyed by the canonical route `id` used by the serving code. The
 * completeness assertion in test/api/openapi.test.ts guarantees every
 * served route carries metadata here, so the contract can never drift
 * from what the daemon actually serves (Constitution Art. XI/XVIII).
 */

import type { z } from "zod/v4";
import {
  ApiError,
  BusinessApprovalDecisionRequest,
  BusinessJourneyStartRequest,
  CapabilityIdRequest,
  ChatStreamEvent,
  ChatStreamRequest,
  ChatApproveRequest,
  ChatApproveResponse,
  ControlApproveRequest,
  ControlPlanRequest,
  EnvironmentCloseRequest,
  HealthResponse,
  ContextUndoOutcome,
  ContextUndoRequest,
  MemorySearchQuery,
  ModelsSelectRequest,
  ModelsTestRequest,
  ObjectResponse,
  OkResponse,
  ProviderSetRequest,
  ShieldAdblockRequest,
  ShieldExplainRequest,
  ShieldQuarantineRequest,
  ShieldWhitelistRequest,
  TrustClassifyRequest,
  WorkspaceCreateRequest,
  WorkspaceSwitchRequest,
  BudgetSetRequest,
  OnboardingStatusResponse,
  OnboardingProviderRequest,
  OnboardingProviderResponse,
  OnboardingCompleteRequest,
  FilesListResponse,
  FilesReadRequest,
  FilesReadResponse,
  FilesDiffRequest,
  FilesDiffResponse,
  ResearchOperationRequest,
  ResearchJobResponse,
  ResearchJobsListResponse,
} from "./schemas.ts";

export type Stability = "stable" | "experimental";

export interface ApiOperationMeta {
  /** OpenAPI summary (one sentence; shown in generated docs). */
  summary: string;
  /** OpenAPI tag (groups operations in the spec). */
  tag: string;
  /** Stability level (Art. XI: experimental is never implied stable). */
  stability: Stability;
  /** zod/v4 schema for the JSON request body (mutating methods). */
  request?: z.ZodType;
  /** zod/v4 schema for the success response (JSON) — defaults to the object envelope. */
  response?: z.ZodType;
  /** Server-Sent Events stream instead of a single JSON response. */
  sse?: boolean;
  /**
   * Explicit OpenAPI path template for prefix-matched routes
   * (e.g. "/api/context/item/{id}"). Required where the route matches by
   * prefix so the spec documents real, call-shaped paths.
   */
  template?: string;
  /** Parameters within the template. */
  pathParams?: Array<{ name: string; description?: string }>;
  /** Not part of the public API contract (HTML pages / static assets). */
  surface?: true;
}

/** The version mount point for the public API. */
export const API_VERSION = "v1";
export const API_PREFIX = "/api";
export const V1_PREFIX = "/api/v1";

/**
 * Deprecation policy for the legacy unversioned mount (docs/api/COMPATIBILITY.md):
 * legacy `/api/*` mounts are announced deprecated in 7.x and are removed no
 * earlier than XR 8.0.0 (Art. XXVII: announce → warn → migrate → remove).
 */
export const LEGACY_SUNSET_ISO = "2027-08-01";
export const LEGACY_SUNSET_HTTP_DATE = "Sun, 01 Aug 2027 00:00:00 GMT";
export const COMPATIBILITY_DOC = "docs/api/COMPATIBILITY.md";

export const API_CONTRACT: Record<string, ApiOperationMeta> = {
  // ── system ────────────────────────────────────────────────────────────────
  "health.get": {
    summary: "Liveness/version health probe (unauthenticated).",
    tag: "system",
    stability: "stable",
    response: HealthResponse,
  },
  "dashboard.get": { summary: "Dashboard HTML surface.", tag: "surface", stability: "stable", surface: true },
  "dashboard.alias.get": { summary: "Dashboard HTML surface (alias).", tag: "surface", stability: "stable", surface: true },
  "dashboard.css.get": { summary: "Dashboard stylesheet asset.", tag: "surface", stability: "stable", surface: true },
  "dashboard.js.get": { summary: "Dashboard client application asset.", tag: "surface", stability: "stable", surface: true },
  "chat.page.get": { summary: "Chat-focused dashboard page.", tag: "surface", stability: "stable", surface: true },
  "auth.js.get": { summary: "Sign-in page behaviour asset (open path for the pre-auth page).", tag: "surface", stability: "stable", surface: true },
  "overview.get": {
    summary: "Aggregated mission-control overview (version, git, providers, memory, cost, audit).",
    tag: "system",
    stability: "stable",
  },
  "cost.get": { summary: "Cost/usage summary for the active workspace.", tag: "budget", stability: "stable" },
  "audit.get": { summary: "Recent audit-chain entries (append-only, hash-chained).", tag: "system", stability: "stable" },
  "security.get": { summary: "Security posture summary (shield + trust + supply chain).", tag: "shield", stability: "experimental" },
  "sessions.list": { summary: "List durable agent/execution sessions.", tag: "agents", stability: "stable" },
  "sessions.get": {
    summary: "Inspect one session by id.",
    tag: "agents",
    stability: "stable",
    template: "/api/sessions/{id}",
    pathParams: [{ name: "id", description: "Session id." }],
  },
  "research.list": { summary: "List research runs.", tag: "agents", stability: "experimental" },
  "research.get": {
    summary: "Inspect one research run by id.",
    tag: "agents",
    stability: "experimental",
    template: "/api/research/{id}",
    pathParams: [{ name: "id", description: "Research run id." }],
  },

  // ── research operations + jobs (Phase 10) ──────────────────────────────────
  "research.search": {
    summary: "Search the web through XR's research providers (SearXNG / Firecrawl) and return normalized sources.",
    tag: "research",
    stability: "experimental",
    request: ResearchOperationRequest,
    response: ResearchJobResponse,
  },
  "research.scrape": {
    summary: "Scrape one public URL into normalized markdown/text with metadata, content hash, and citations.",
    tag: "research",
    stability: "experimental",
    request: ResearchOperationRequest,
    response: ResearchJobResponse,
  },
  "research.map": {
    summary: "Map a site's URLs (discovery only).",
    tag: "research",
    stability: "experimental",
    request: ResearchOperationRequest,
    response: ResearchJobResponse,
  },
  "research.crawl": {
    summary: "Start a bounded async crawl job (poll GET /api/research/jobs/{id} or stream /api/research/stream/{id}).",
    tag: "research",
    stability: "experimental",
    request: ResearchOperationRequest,
    response: ResearchJobResponse,
  },
  "research.extract": {
    summary: "Extract schema-validated structured data from URLs.",
    tag: "research",
    stability: "experimental",
    request: ResearchOperationRequest,
    response: ResearchJobResponse,
  },
  "research.jobs.list": {
    summary: "List research jobs (live + persisted).",
    tag: "research",
    stability: "stable",
    response: ResearchJobsListResponse,
  },
  "research.jobs.get": {
    summary: "Inspect one research job by id.",
    tag: "research",
    stability: "stable",
    template: "/api/research/jobs/{id}",
    pathParams: [{ name: "id", description: "Research job id." }],
    response: ResearchJobResponse,
  },
  "research.jobs.cancel": {
    summary: "Cancel a running research job (truthful cancelled state; partial results preserved).",
    tag: "research",
    stability: "stable",
    template: "/api/research/jobs/{id}/cancel",
    pathParams: [{ name: "id", description: "Research job id." }],
    response: OkResponse,
  },
  "research.jobs.stream": {
    summary: "Stream research progress as Server-Sent Events.",
    tag: "research",
    stability: "experimental",
    sse: true,
    template: "/api/research/stream/{id}",
    pathParams: [{ name: "id", description: "Research job id." }],
  },
  "recovery.status.get": { summary: "Durable-execution recovery status (unresolved work, RPO/RTO).", tag: "system", stability: "stable" },
  "config.safe.get": { summary: "Effective configuration with secrets redacted.", tag: "system", stability: "stable" },

  // ── chat / agents ─────────────────────────────────────────────────────────
  "chat.stream.post": {
    summary: "One-shot chat completion streamed as Server-Sent Events.",
    tag: "chat",
    stability: "stable",
    request: ChatStreamRequest,
    response: ChatStreamEvent,
    sse: true,
  },
  "chat.approve.post": {
    summary: "Human decision for a pending chat tool approval (fail-closed; the model cannot approve itself).",
    tag: "chat",
    stability: "stable",
    request: ChatApproveRequest,
    response: ChatApproveResponse,
  },
  "agents.list": { summary: "List built-in agent roles (supervisor, planner, executor).", tag: "agents", stability: "stable" },
  "agents.workflow.get": {
    summary: "Inspect an agent workflow run by id.",
    tag: "agents",
    stability: "experimental",
    template: "/api/agents/workflows/{workflow}",
    pathParams: [{ name: "workflow", description: "Workflow/run id." }],
  },

  // ── budget ────────────────────────────────────────────────────────────────
  "budget.get": { summary: "Budget caps, current usage, and remaining headroom.", tag: "budget", stability: "stable" },
  "budget.set": {
    summary: "Set budget caps (per-task/daily/monthly) and warning behavior.",
    tag: "budget",
    stability: "stable",
    request: BudgetSetRequest,
    response: OkResponse,
  },

  // ── shield ────────────────────────────────────────────────────────────────
  "shield.status": { summary: "Shield security-service status.", tag: "shield", stability: "stable" },
  "shield.scan": { summary: "Recent scan results and findings.", tag: "shield", stability: "experimental" },
  "shield.processes": { summary: "System process security snapshot.", tag: "shield", stability: "experimental" },
  "shield.startup": { summary: "Startup-entry security snapshot.", tag: "shield", stability: "experimental" },
  "shield.privacy": { summary: "Privacy posture (telemetry off, local-first indicators).", tag: "shield", stability: "stable" },
  "shield.downloads": { summary: "Download-security findings.", tag: "shield", stability: "experimental" },
  "shield.browser": { summary: "Browser-security snapshot.", tag: "shield", stability: "experimental" },
  "shield.explain": {
    summary: "Explain one shield finding by id.",
    tag: "shield",
    stability: "experimental",
    request: ShieldExplainRequest,
  },
  "shield.quarantine": {
    summary: "Quarantine lifecycle: isolate | restore | delete a finding.",
    tag: "shield",
    stability: "experimental",
    request: ShieldQuarantineRequest,
    response: OkResponse,
  },
  "shield.whitelist": {
    summary: "Add/remove a whitelist entry.",
    tag: "shield",
    stability: "experimental",
    request: ShieldWhitelistRequest,
    response: OkResponse,
  },
  "shield.adblock": {
    summary: "Toggle the ad-block component.",
    tag: "shield",
    stability: "experimental",
    request: ShieldAdblockRequest,
  },

  // ── trust / isolation ─────────────────────────────────────────────────────
  "trust.get": { summary: "Trust & isolation service status (available backends, policy).", tag: "trust", stability: "stable" },
  "trust.classify.post": {
    summary: "Classify an action's risk tier and resolve its isolation placement.",
    tag: "trust",
    stability: "stable",
    request: TrustClassifyRequest,
  },

  // ── capabilities ──────────────────────────────────────────────────────────
  "capabilities.list": { summary: "Search/list capability descriptors (filters via query params).", tag: "capabilities", stability: "stable" },
  "capabilities.health": { summary: "Capability service health and counts.", tag: "capabilities", stability: "stable" },
  "capabilities.inspect": { summary: "Inspect one capability descriptor (?id=).", tag: "capabilities", stability: "stable" },
  "capabilities.permissions": { summary: "Effective permission view for a capability (?id=).", tag: "capabilities", stability: "stable" },
  "capabilities.certify": { summary: "Run contract-test certification for a capability.", tag: "capabilities", stability: "experimental", request: CapabilityIdRequest },
  "capabilities.enable": { summary: "Enable an installed capability.", tag: "capabilities", stability: "stable", request: CapabilityIdRequest, response: OkResponse },
  "capabilities.disable": { summary: "Disable an enabled capability.", tag: "capabilities", stability: "stable", request: CapabilityIdRequest, response: OkResponse },
  "capabilities.quarantine": { summary: "Quarantine a capability (fail-closed).", tag: "capabilities", stability: "experimental", request: CapabilityIdRequest },
  "capabilities.rollback": { summary: "Rollback a capability to a previous version.", tag: "capabilities", stability: "experimental", request: CapabilityIdRequest },

  // ── providers / workspaces / models ───────────────────────────────────────
  "providers.list": { summary: "Provider status (keys present, health, defaults).", tag: "providers", stability: "stable" },
  "providers.set": {
    summary: "Select default provider/model (+ optional fallback).",
    tag: "providers",
    stability: "stable",
    request: ProviderSetRequest,
    response: OkResponse,
  },
  "providers.route": { summary: "Show the explainable routing decision for a task profile.", tag: "providers", stability: "stable" },
  "providers.slo": { summary: "Routing SLO measurements (selection-latency compliance).", tag: "providers", stability: "stable" },
  "providers.catalog": { summary: "Full provider/model catalog with capabilities.", tag: "providers", stability: "stable" },
  "providers.capabilities": { summary: "Provider capabilities (supported features per provider). Phase 04 gateway.", tag: "providers", stability: "stable" },
  "providers.fallback": { summary: "Resolved fallback chain (primary → fallbackProvider → local). Phase 04 gateway.", tag: "providers", stability: "stable" },
  "workspaces.list": { summary: "List workspaces and the active one.", tag: "workspaces", stability: "stable" },
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
  "models.list": { summary: "Local model runtimes: detection status and installed models.", tag: "models", stability: "stable" },
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

  // ── skills / plugins (sub-APIs) ───────────────────────────────────────────
  "skills.api": {
    summary: "Skills marketplace/registry sub-API (wildcard; see skills adapter docs).",
    tag: "skills",
    stability: "experimental",
    template: "/api/skills/{path}",
    pathParams: [{ name: "path", description: "Sub-path inside the skills adapter." }],
  },
  "plugins.api": {
    summary: "Plugin management sub-API (wildcard; see plugin adapter docs).",
    tag: "plugins",
    stability: "experimental",
    template: "/api/plugins/{path}",
    pathParams: [{ name: "path", description: "Sub-path inside the plugins adapter." }],
  },

  // ── control (computer-use) ────────────────────────────────────────────────
  "control.status": { summary: "Computer-control subsystem status.", tag: "control", stability: "experimental" },
  "control.events": { summary: "Recent control events (?limit=, ≤200).", tag: "control", stability: "experimental" },
  "control.pending": { summary: "Pending control authorizations (approval queue).", tag: "control", stability: "stable" },
  "control.approve": {
    summary: "Approve or deny a pending control authorization.",
    tag: "control",
    stability: "stable",
    request: ControlApproveRequest,
    response: OkResponse,
  },
  "control.plan": {
    summary: "Produce a control plan for a task (planning service).",
    tag: "control",
    stability: "experimental",
    request: ControlPlanRequest,
  },
  "control.memory.list": { summary: "List control-layer memory records.", tag: "control", stability: "experimental" },
  "control.memory.delete": {
    summary: "Delete one control-layer memory record by id.",
    tag: "control",
    stability: "experimental",
    template: "/api/control/memory/{id}",
    pathParams: [{ name: "id", description: "Memory record id." }],
  },
  "control.history.legacy": { summary: "Control history (legacy alias of events).", tag: "control", stability: "experimental" },
  "control.permissions.legacy": { summary: "Control permissions (legacy alias).", tag: "control", stability: "experimental" },

  // ── environment (isolated execution surfaces) ─────────────────────────────
  "environment.status": { summary: "Environment manager status.", tag: "environment", stability: "experimental" },
  "environment.capabilities": { summary: "Environment interaction capability map.", tag: "environment", stability: "experimental" },
  "environment.sessions": { summary: "List open environment sessions.", tag: "environment", stability: "stable" },
  "environment.close": {
    summary: "Close an environment session.",
    tag: "environment",
    stability: "stable",
    request: EnvironmentCloseRequest,
  },
  "environment.history": { summary: "Environment action history.", tag: "environment", stability: "experimental" },
  "environment.observations": { summary: "Environment observations log.", tag: "environment", stability: "experimental" },
  "environment.policy": { summary: "Effective environment policy.", tag: "environment", stability: "experimental" },

  // ── memory / context ──────────────────────────────────────────────────────
  "memory.list": { summary: "List memory records (legacy memory surface).", tag: "memory", stability: "experimental" },
  "memory.health": { summary: "Memory subsystem health.", tag: "memory", stability: "stable" },
  "memory.search": { summary: "Semantic memory search (?query=).", tag: "memory", stability: "stable", request: MemorySearchQuery },
  "memory.delete": {
    summary: "Delete one memory record by id.",
    tag: "memory",
    stability: "stable",
    template: "/api/memory/{id}",
    pathParams: [{ name: "id", description: "Memory record id." }],
  },
  "context.status": { summary: "Context store status (counts, freshness, integrity).", tag: "context", stability: "stable" },
  "context.items": { summary: "List context items (?type=&scope=&all=).", tag: "context", stability: "stable" },
  "context.policy": { summary: "Effective context capture/injection policy.", tag: "context", stability: "stable" },
  "context.pending": { summary: "Pending consent decisions (capture/injection).", tag: "context", stability: "stable" },
  "context.export": { summary: "Export all context data (data-ownership).", tag: "context", stability: "stable" },
  "context.inspect": {
    summary: "Inspect one context item by id.",
    tag: "context",
    stability: "stable",
    template: "/api/context/item/{id}",
    pathParams: [{ name: "id", description: "Context item id." }],
  },
  "context.approve": {
    summary: "Approve a pending context consent decision.",
    tag: "context",
    stability: "stable",
    template: "/api/context/approve/{id}",
    pathParams: [{ name: "id", description: "Pending decision id." }],
    response: OkResponse,
  },
  "context.revoke": {
    summary: "Revoke consent for a context item (undoable via the undo ledger).",
    tag: "context",
    stability: "stable",
    template: "/api/context/revoke/{id}",
    pathParams: [{ name: "id", description: "Context item id." }],
    response: OkResponse,
  },

  "context.undo": {
    summary: "Undo a context/memory mutation exactly (latest, or a specific undo-ledger op). Restore never fabricates authority — the before-image is what comes back.",
    tag: "context",
    stability: "stable",
    request: ContextUndoRequest,
    response: ContextUndoOutcome,
  },

  // ── business (Business OS extension; default-excluded) ────────────────────
  "business.status.get": { summary: "Business OS extension status (?orgId=&workspaceId=).", tag: "business", stability: "experimental" },
  "business.journeys.list": { summary: "List business journeys.", tag: "business", stability: "experimental" },
  "business.journeys.start": {
    summary: "Start a business journey.",
    tag: "business",
    stability: "experimental",
    request: BusinessJourneyStartRequest,
    template: "/api/business/journeys/{journeyId}/start",
    pathParams: [{ name: "journeyId", description: "Journey key." }],
  },
  "business.outcomes.list": { summary: "List business outcome records.", tag: "business", stability: "experimental" },
  "business.outcomes.get": {
    summary: "Inspect a business outcome.",
    tag: "business",
    stability: "experimental",
    template: "/api/business/outcomes/{outcomeId}",
    pathParams: [{ name: "outcomeId", description: "Outcome id." }],
  },
  "business.approvals.list": { summary: "List business approval requests.", tag: "business", stability: "experimental" },
  "business.approvals.decide": {
    summary: "Decide a business approval.",
    tag: "business",
    stability: "experimental",
    request: BusinessApprovalDecisionRequest,
    template: "/api/business/approvals/{approvalId}/decide",
    pathParams: [{ name: "approvalId", description: "Approval id." }],
  },
  "business.artifacts.list": { summary: "List business artifacts.", tag: "business", stability: "experimental" },
  "business.workers.list": { summary: "List governed business workers.", tag: "business", stability: "experimental" },
  "business.workers.get": {
    summary: "Inspect a business worker.",
    tag: "business",
    stability: "experimental",
    template: "/api/business/workers/{workerId}",
    pathParams: [{ name: "workerId", description: "Worker id." }],
  },
  "business.workers.disable": {
    summary: "Disable a business worker.",
    tag: "business",
    stability: "experimental",
    template: "/api/business/workers/{workerId}/disable",
    pathParams: [{ name: "workerId", description: "Worker id." }],
  },
  "business.workers.enable": {
    summary: "Enable a business worker.",
    tag: "business",
    stability: "experimental",
    template: "/api/business/workers/{workerId}/enable",
    pathParams: [{ name: "workerId", description: "Worker id." }],
  },
  "business.mutations.list": { summary: "List business mutation proposals (auditable).", tag: "business", stability: "experimental" },
  "business.privacy.get": {
    summary: "Business privacy view for a subject.",
    tag: "business",
    stability: "experimental",
    template: "/api/business/privacy/{subject}",
    pathParams: [{ name: "subject", description: "Subject (org/workspace/id)." }],
  },

  // ── Phase G · workspace files (experimental surface) ────────────────────
  "files.list": {
    summary: "List the project root (process.cwd()) — one level, scope-enforced, with real per-file git status.",
    tag: "workspace",
    stability: "experimental",
    response: FilesListResponse,
  },
  "files.read": {
    summary: "Read a text file inside the project root (scope-enforced, size-capped).",
    tag: "workspace",
    stability: "experimental",
    request: FilesReadRequest,
    response: FilesReadResponse,
  },
  "files.diff": {
    summary: "Real `git diff` for a tracked file inside the project root.",
    tag: "workspace",
    stability: "experimental",
    request: FilesDiffRequest,
    response: FilesDiffResponse,
  },

  // ── Phase B · onboarding (first-run GUI flow; experimental surface) ──────
  "onboarding.status": {
    summary: "First-run status: does this install need setup, and why.",
    tag: "onboarding",
    stability: "experimental",
    response: OnboardingStatusResponse,
  },
  "onboarding.provider": {
    summary: "Save a hosted provider API key (BYOK) and set it as the default route. The key is stored in the OS keychain or sealed file and is never returned. The save succeeds even when the live probe fails — the outcome is reported honestly.",
    tag: "onboarding",
    stability: "experimental",
    request: OnboardingProviderRequest,
    response: OnboardingProviderResponse,
  },
  "onboarding.complete": {
    summary: "Record onboarding completion in the audit log (the honest completion record).",
    tag: "onboarding",
    stability: "experimental",
    request: OnboardingCompleteRequest,
    response: OkResponse,
  },

  // ── Phase 8 · meta operations (registered by meta.routes.ts) ──────────────
  "meta.apiRoot.get": {
    summary: "API index: version, operation catalogue link, OpenAPI location.",
    tag: "system",
    stability: "stable",
  },
  "meta.openapi.get": {
    summary: "The generated OpenAPI 3.1 document for this daemon.",
    tag: "system",
    stability: "stable",
  },
  "meta.metrics.get": {
    summary: "Prometheus text exposition of daemon/runtime metrics (Phase 8 · T2).",
    tag: "system",
    stability: "stable",
  },
  "meta.traces.get": {
    summary: "Recent trace spans (structural only; local ring buffer; never content).",
    tag: "system",
    stability: "experimental",
  },
};

/** Uniform not-found body (kept compatible: `error` preserved). */
export const NOT_FOUND_BODY = Object.freeze({ error: "not found" });

/** Error schema reused by every operation's error responses. */
export const API_ERROR_SCHEMA = ApiError;
export const API_OBJECT_RESPONSE = ObjectResponse;
