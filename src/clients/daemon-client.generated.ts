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

/** Typed operations generated from the versioned route registry. */
export interface XRDaemonClient {
  /** Start a full research run (plan → search → read → extract → synthesize) through the same engine as `xr research`; returns immediately with a run id to stream. */
  researchRunStart(body: z.infer<typeof S.ResearchRunStartRequest>): Promise<z.infer<typeof S.ResearchRunStartResponse>>;
  /** Status of a research run (state, session id, result once finished). */
  researchRunGet(runId: string): Promise<z.infer<typeof S.ResearchRunResponse>>;
  /** Stream a research run as Server-Sent Events: buffered replay, then live run_started · status · log · plan · search · sources · fetch · extract · contradictions · budget · run_completed | run_error · stream_end. (SSE stream — returns the raw Response). */
  researchRunStream(runId: string): Promise<Response>;
  /** Cancel a research run — the abort reaches the in-flight model call and page fetch; the session persists as stopped (cancelled) with everything gathered so far. */
  researchRunCancel(runId: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Extract text from an uploaded PDF (multipart field `file`, ≤ 20 MB) in memory — nothing is written to disk; attach the text to a run as a document. */
  researchUploadPdf(): Promise<z.infer<typeof S.ResearchPdfUploadResponse>>;
  /** Research network posture: whether the search host is allow-listed and whether research may fetch the public web. */
  researchSettingsGet(): Promise<z.infer<typeof S.ResearchSettingsResponse>>;
  /** Persist research.allowPublicWeb (the research-only public-web fetch path; the egress allow-list and SSRF guard still apply). */
  researchSettingsSet(body: z.infer<typeof S.ResearchSettingsPatchRequest>): Promise<z.infer<typeof S.ResearchSettingsResponse>>;
  /** Save a finished research finding to durable memory as model synthesis (provenance + per-source links); explicit, never automatic. */
  researchRemember(id: string): Promise<z.infer<typeof S.ResearchRememberResponse>>;
  /** Search the web through XR's research providers (SearXNG / Firecrawl) and return normalized sources. */
  researchSearch(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** Scrape one public URL into normalized markdown/text with metadata, content hash, and citations. */
  researchScrape(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** Map a site's URLs (discovery only). */
  researchMap(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** Start a bounded async crawl job (poll GET /api/research/jobs/{id} or stream /api/research/stream/{id}). */
  researchCrawl(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** Extract schema-validated structured data from URLs. */
  researchExtract(body: z.infer<typeof S.ResearchOperationRequest>): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** List research jobs (live + persisted). */
  researchJobsList(): Promise<z.infer<typeof S.ResearchJobsListResponse>>;
  /** Inspect one research job by id. */
  researchJobsGet(id: string): Promise<z.infer<typeof S.ResearchJobResponse>>;
  /** Cancel a running research job (truthful cancelled state; partial results preserved). */
  researchJobsCancel(id: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Stream research progress as Server-Sent Events. (SSE stream — returns the raw Response). */
  researchJobsStream(id: string): Promise<Response>;
  /** Liveness health probe (unauthenticated, minimal payload). */
  healthGet(): Promise<z.infer<typeof S.HealthResponse>>;
  /** Aggregated mission-control overview (version, git, providers, memory, cost, audit). */
  overviewGet(): Promise<Record<string, unknown>>;
  /** Cost/usage summary for the active workspace. */
  costGet(): Promise<Record<string, unknown>>;
  /** Recent audit-chain entries (append-only, hash-chained). */
  auditGet(): Promise<Record<string, unknown>>;
  /** Export the signed, hash-chained audit bundle (same report as `xr audit export`). */
  auditExport(): Promise<Record<string, unknown>>;
  /** Security posture summary (shield + trust + supply chain). */
  securityGet(): Promise<Record<string, unknown>>;
  /** List durable agent/execution sessions. */
  sessionsList(): Promise<Record<string, unknown>>;
  /** Inspect one session by id. */
  sessionsGet(id: string): Promise<Record<string, unknown>>;
  /** List research runs. */
  researchList(): Promise<Record<string, unknown>>;
  /** Inspect one research run by id. */
  researchGet(id: string): Promise<Record<string, unknown>>;
  /** Durable-execution recovery status (unresolved work, RPO/RTO). */
  recoveryStatusGet(): Promise<Record<string, unknown>>;
  /** Effective configuration with secrets redacted. */
  configSafeGet(): Promise<Record<string, unknown>>;
  /** Durable pending approvals across all surfaces (workspace store). */
  approvalsList(): Promise<z.infer<typeof S.ApprovalsListResponse>>;
  /** Decide a durable approval request (approve/deny). TTL default-deny applies. */
  approvalsDecide(approvalId: string, body: z.infer<typeof S.ApprovalDecisionRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Voice session state + offline STT/TTS backend probes. */
  voiceStatus(): Promise<Record<string, unknown>>;
  /** Start/stop the live voice session (mic uplink armed). */
  voiceSession(): Promise<Record<string, unknown>>;
  /** Upload pcm16-le 16 kHz mic chunks; engine endpointing + VAD. */
  voiceAudio(): Promise<Record<string, unknown>>;
  /** SSE downlink: state/final transcript/tts audio/barge-in/approvals. */
  voiceEvents(): Promise<Record<string, unknown>>;
  /** Barge-in: cancel current TTS (and flagged run), return to listening. */
  voiceBarge(): Promise<Record<string, unknown>>;
  /** Shell reports TTS playback finished; session returns to listening. */
  voicePlayed(): Promise<Record<string, unknown>>;
  /** Make the assistant speak a line through the offline TTS pipeline. */
  voiceSay(): Promise<Record<string, unknown>>;
  /** Phase 15: STT model catalogue (offline/download, local binaries, cloud) with install state and sizes. */
  voiceModels(): Promise<Record<string, unknown>>;
  /** Phase 15: TTS voice catalogue (Piper offline voices + cloud) with install state and sizes. */
  voiceVoices(): Promise<Record<string, unknown>>;
  /** Phase 15: effective voice settings (engine config `voice` block). */
  voiceSettingsGet(): Promise<Record<string, unknown>>;
  /** Phase 15: patch voice settings (validated, clamped); applies live to the session. */
  voiceSettingsSet(): Promise<Record<string, unknown>>;
  /** Phase 15: start a model download (component+id, or the first-run bundle); progress streams on /events. */
  voiceDownload(): Promise<Record<string, unknown>>;
  /** Phase 15: cancel the running model download (partial files resume on retry). */
  voiceDownloadCancel(): Promise<Record<string, unknown>>;
  /** Phase 15: delete every downloaded voice model and the extracted runtime. */
  voiceModelsClear(): Promise<Record<string, unknown>>;
  /** Phase 15: synthesize a sample (voice/speed override) and return WAV bytes without touching the session. */
  voiceTest_tts(): Promise<Record<string, unknown>>;
  /** Phase 15: transcribe one pcm16 utterance directly (settings screen 'Test transcription'). */
  voiceTranscribe(): Promise<Record<string, unknown>>;
  /** First-run status: does this install need setup, and why. */
  onboardingStatus(): Promise<z.infer<typeof S.OnboardingStatusResponse>>;
  /** Save a hosted provider API key (BYOK) and set it as the default route. The key is stored in the OS keychain or sealed file and is never returned. A live probe is explicit opt-in; its failure does not undo a successful save — the outcome is reported honestly. */
  onboardingProvider(body: z.infer<typeof S.OnboardingProviderRequest>): Promise<z.infer<typeof S.OnboardingProviderResponse>>;
  /** Remove a known engine provider credential with acknowledged backend deletion. External environment/other-install/backups and vendor-side revocation remain owner responsibilities. */
  onboardingProviderRemove(body: z.infer<typeof S.OnboardingProviderRemoveRequest>): Promise<z.infer<typeof S.OnboardingProviderRemoveResponse>>;
  /** Record onboarding completion in the audit log (the honest completion record). */
  onboardingComplete(body: z.infer<typeof S.OnboardingCompleteRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** List the project root (process.cwd()) — one level, scope-enforced, with real per-file git status. */
  filesList(): Promise<z.infer<typeof S.FilesListResponse>>;
  /** Read a text file inside the project root (scope-enforced, size-capped). */
  filesRead(body: z.infer<typeof S.FilesReadRequest>): Promise<z.infer<typeof S.FilesReadResponse>>;
  /** Real `git diff` for a tracked file inside the project root. */
  filesDiff(body: z.infer<typeof S.FilesDiffRequest>): Promise<z.infer<typeof S.FilesDiffResponse>>;
  /** Hunk-level REJECT over the engine's own diff: reverse-apply the chosen hunks of a file's working-tree diff via git, after ONE human approval whose preview shows exactly those hunks. Stale ids and changed files are refused (409), never guessed. */
  filesHunksRevert(body: z.infer<typeof S.FilesHunksRevertRequest>): Promise<z.infer<typeof S.FilesHunksRevertResponse>>;
  /** Save a text file inside the project root — human-approval-gated, scope-enforced, staleness-guarded, hash-chain audited. */
  filesWrite(body: z.infer<typeof S.FilesWriteRequest>): Promise<z.infer<typeof S.FilesWriteResponse>>;
  /** Workspace git branch + porcelain status (argv-only git, root-scoped). */
  gitStatus(): Promise<Record<string, unknown>>;
  /** Recent commits for the workspace (bounded, argv-only). */
  gitLog(): Promise<Record<string, unknown>>;
  /** Stage paths with `git add` — runs only after a durable human approval (riskTier medium). */
  gitStage(body: z.infer<typeof S.GitStageRequest>): Promise<Record<string, unknown>>;
  /** Commit staged work — runs only after a durable human approval (riskTier high). */
  gitCommit(body: z.infer<typeof S.GitCommitRequest>): Promise<Record<string, unknown>>;
  /** Run ONE shell command in the project root — deterministic policy check, durable approval, output streamed as SSE (line-based command runner, NOT a PTY; see terminal.pty.open for the real one). (SSE stream — returns the raw Response). */
  terminalRun(body: z.infer<typeof S.TerminalRunRequest>): Promise<Response>;
  /** Live terminal sessions owned by this daemon and the per-daemon cap. */
  terminalPtyList(): Promise<z.infer<typeof S.TerminalPtyListResponse>>;
  /** Open a REAL interactive terminal (pseudo-terminal: openpty / ConPTY) in the project root — ONE durable high-tier approval per session (keystrokes are not policy-inspected, and the preview says so), cwd scope-enforced, output streamed as SSE, shell killed on disconnect. (SSE stream — returns the raw Response). */
  terminalPtyOpen(body: z.infer<typeof S.TerminalPtyOpenRequest>): Promise<Response>;
  /** Write keystrokes to an open terminal session (≤ 64 KB per message). */
  terminalPtyInput(sessionId: string, body: z.infer<typeof S.TerminalPtyInputRequest>): Promise<z.infer<typeof S.TerminalPtyInputResponse>>;
  /** Resize an open terminal session (the child sees the new size). */
  terminalPtyResize(sessionId: string, body: z.infer<typeof S.TerminalPtyResizeRequest>): Promise<z.infer<typeof S.TerminalPtyResizeResponse>>;
  /** End a terminal session the way a closing window does: SIGHUP, then SIGKILL after a 2 s grace (Windows: close console + terminate). */
  terminalPtyClose(sessionId: string): Promise<z.infer<typeof S.TerminalPtyCloseResponse>>;
  /** Register/open an absolute folder as a Builder project (validated, realpath'd, audited) → stable id for every other Builder route. */
  builderProjectsOpen(body: z.infer<typeof S.BuilderProjectOpenRequest>): Promise<z.infer<typeof S.BuilderProjectResponse>>;
  /** Projects this daemon has open. */
  builderProjectsList(): Promise<z.infer<typeof S.BuilderProjectsListResponse>>;
  /** Project tree (heavy folders listed, not descended; 4 000-entry cap) with git badges and branch. */
  builderTree(projectId: string): Promise<z.infer<typeof S.BuilderTreeResponse>>;
  /** Read a text file inside the project (?path=, 512 KB cap, binary detected). */
  builderFileRead(projectId: string, body: z.infer<typeof S.BuilderFileReadRequest>): Promise<z.infer<typeof S.BuilderFileReadResponse>>;
  /** Save a file — SSE: approval_required (write_file, per-project scope) → applied | denied; stale mtime answers 409 first. (SSE stream — returns the raw Response). */
  builderFileWrite(projectId: string, body: z.infer<typeof S.BuilderFileWriteRequest>): Promise<Response>;
  /** Create an empty file or a folder — SSE consent stream (create_file | mkdir). (SSE stream — returns the raw Response). */
  builderFileCreate(projectId: string, body: z.infer<typeof S.BuilderFileCreateRequest>): Promise<Response>;
  /** Rename/move inside the project — SSE consent stream (rename_file). (SSE stream — returns the raw Response). */
  builderFileRename(projectId: string, body: z.infer<typeof S.BuilderFileRenameRequest>): Promise<Response>;
  /** Delete a file or folder (recursive, stated in the approval) — SSE consent stream (delete_file). (SSE stream — returns the raw Response). */
  builderFileDelete(projectId: string, body: z.infer<typeof S.BuilderFileDeleteRequest>): Promise<Response>;
  /** Branch, dirty flag and per-path badges for the project. */
  builderGit(projectId: string): Promise<z.infer<typeof S.BuilderGitResponse>>;
  /** Syntax diagnostics from the PROJECT's own TypeScript (transpileModule); {available:false} when it is not installed. */
  builderDiagnostics(projectId: string, body: z.infer<typeof S.BuilderDiagnosticsRequest>): Promise<z.infer<typeof S.BuilderDiagnosticsResponse>>;
  /** Apply selected hunks of a unified diff — dry-run first (conflicts → 409, nobody asked), then SSE consent stream (patch) with a backup for undo. (SSE stream — returns the raw Response). */
  builderApplyDiff(projectId: string, body: z.infer<typeof S.BuilderApplyDiffRequest>): Promise<Response>;
  /** Restore the backup an apply-diff made — SSE consent stream (write_file). (SSE stream — returns the raw Response). */
  builderUndo(projectId: string, body: z.infer<typeof S.BuilderUndoRequest>): Promise<Response>;
  /** Detected dev command (vite/next/cra/node/cargo/django/flask/static), live status and the recent log tail. */
  builderDevServerStatus(projectId: string): Promise<z.infer<typeof S.BuilderDevServerResponse>>;
  /** Start the dev server — deterministic policy gate, then SSE consent stream (shell; static sites: serve_static) → applied{status}. (SSE stream — returns the raw Response). */
  builderDevServerStart(projectId: string, body: z.infer<typeof S.BuilderDevServerStartRequest>): Promise<Response>;
  /** Stop the project's dev server (SIGTERM → 2 s → SIGKILL). */
  builderDevServerStop(projectId: string): Promise<z.infer<typeof S.BuilderDevServerStopResponse>>;
  /** Install dependencies with the lockfile's package manager — SSE consent stream (shell); output streams on the events feed. (SSE stream — returns the raw Response). */
  builderDevServerInstall(projectId: string): Promise<Response>;
  /** Live feed (SSE): dev-server log/ready/exit/status and debounced fs:changed batches from a recursive watcher. (SSE stream — returns the raw Response). */
  builderEvents(projectId: string): Promise<Response>;
  /** Desktop UI state for this workspace (layout, tabs, drafts, last area) — opaque JSON the renderer owns, kept durable by the engine. */
  stateUiGet(body: z.infer<typeof S.UiStateGetQuery>): Promise<z.infer<typeof S.UiStateGetResponse>>;
  /** Upsert/delete desktop UI-state keys (null deletes). Budgeted: ≤ 256 KB per value, ≤ 256 keys per workspace, key shape enforced; all-or-nothing. */
  stateUiPatch(body: z.infer<typeof S.UiStatePatchRequest>): Promise<z.infer<typeof S.UiStatePatchResponse>>;
  /** One-shot chat completion streamed as Server-Sent Events. (SSE stream — returns the raw Response). */
  chatStreamPost(body: z.infer<typeof S.ChatStreamRequest>): Promise<Response>;
  /** List user-authored agents (full documents, newest first). */
  agentsCustomList(): Promise<z.infer<typeof S.CustomAgentListResponse>>;
  /** Create a custom agent; validated (name, prompt ≥ 20 chars, tools ⊆ engine tools, budget $0.01–$5) and stored as versioned JSON. */
  agentsCustomCreate(body: z.infer<typeof S.CustomAgentInputRequest>): Promise<z.infer<typeof S.CustomAgentResponse>>;
  /** Import an exported agent document; a free, well-formed id is kept, otherwise a new one is minted (imports never overwrite). */
  agentsCustomImport(body: z.infer<typeof S.CustomAgentImportRequest>): Promise<z.infer<typeof S.CustomAgentResponse>>;
  /** One custom agent — the same document the Export action downloads. */
  agentsCustomGet(id: string): Promise<z.infer<typeof S.CustomAgentResponse>>;
  /** Update a custom agent (partial merge, same validation); every save bumps `version`. */
  agentsCustomUpdate(id: string, body: z.infer<typeof S.CustomAgentPatchRequest>): Promise<z.infer<typeof S.CustomAgentResponse>>;
  /** Delete a custom agent file. */
  agentsCustomDelete(id: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Duplicate a custom agent into a new document. */
  agentsCustomDuplicate(id: string, body: z.infer<typeof S.CustomAgentDuplicateRequest>): Promise<z.infer<typeof S.CustomAgentResponse>>;
  /** Compile + lint a canvas graph without saving; returns problems and a graph summary (nodes · tools · human checks). */
  workflowsInspect(body: z.infer<typeof S.WorkflowInspectRequest>): Promise<z.infer<typeof S.WorkflowInspectResponse>>;
  /** Recent workflow runs across all definitions. */
  workflowsRunsList(): Promise<z.infer<typeof S.WorkflowRunListResponse>>;
  /** A workflow run with per-node states, cost and pending human checks. */
  workflowsRunsGet(runId: string): Promise<z.infer<typeof S.WorkflowRunResponse>>;
  /** Stream a workflow run as Server-Sent Events: buffered replay, then live run_state · node_state · log · cost_update · approval_required · run_end · stream_end. Every event is emitted by the engine as the run advances. (SSE stream — returns the raw Response). */
  workflowsRunsStream(runId: string): Promise<Response>;
  /** Cancel a run — aborts the in-flight node (model call / tool) and withdraws any parked human check. */
  workflowsRunsCancel(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>>;
  /** Pause a running workflow after the current node finishes. */
  workflowsRunsPause(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>>;
  /** Resume a paused workflow. */
  workflowsRunsResume(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>>;
  /** Record a human decision for a parked approval/review node. Goes through the same approval record the Shield modal decides; the engine enforces the node's denial/expiry policy. */
  workflowsRunsDecide(runId: string, body: z.infer<typeof S.WorkflowDecisionRequest>): Promise<z.infer<typeof S.WorkflowRunResponse>>;
  /** List saved workflows (latest active version each) with a graph summary and the last run. */
  workflowsList(): Promise<z.infer<typeof S.WorkflowListResponse>>;
  /** Compile a canvas graph into a canonical WorkflowDefinition, lint it (errors → 422 with per-node problems) and publish version 1 (immutable, content-hashed). */
  workflowsCreate(body: z.infer<typeof S.WorkflowCreateRequest>): Promise<z.infer<typeof S.WorkflowResponse>>;
  /** A workflow definition (latest or ?version=) with its canvas graph, lint problems and version list. */
  workflowsGet(id: string): Promise<z.infer<typeof S.WorkflowResponse>>;
  /** Publish a new immutable version from the canvas graph; `baseVersion` must be the latest (409 otherwise). */
  workflowsUpdate(id: string, body: z.infer<typeof S.WorkflowUpdateRequest>): Promise<z.infer<typeof S.WorkflowResponse>>;
  /** Retire a workflow: every version is marked inactive (runs and history are kept). */
  workflowsDelete(id: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Start a run of a workflow (latest or a given version) with resolved parameters; at most 3 runs in flight (429 otherwise). Returns the queued run to stream. */
  workflowsRun(id: string, body: z.infer<typeof S.WorkflowRunStartRequest>): Promise<z.infer<typeof S.WorkflowRunResponse>>;
  /** Run history for one workflow definition. */
  workflowsRunsHistory(id: string): Promise<z.infer<typeof S.WorkflowRunListResponse>>;
  /** List built-in orchestration roles and live multi-agent workflow runs. */
  agentsList(): Promise<Record<string, unknown>>;
  /** Inspect an agent workflow run by id. */
  agentsWorkflowGet(workflow: string): Promise<Record<string, unknown>>;
  /** Deterministic planner templates per workflow kind (gallery source). */
  agentsTemplates(): Promise<Record<string, unknown>>;
  /** Plan (dryRun) or plan+run a team workflow; execution is detached, record is authoritative. */
  agentsWorkflowCreate(): Promise<Record<string, unknown>>;
  /** Team-run control verbs: pause (drains current wave), resume, cancel — engine-guarded. */
  agentsWorkflowControl(): Promise<Record<string, unknown>>;
  /** Steer a live run: delegate an instruction to a worker (audited handoff). */
  agentsWorkflowSteer(): Promise<Record<string, unknown>>;
  /** Human review decision for an awaiting_review task (approve completes, reject blocks). */
  agentsWorkflowReview(): Promise<Record<string, unknown>>;
  /** SSE downlink for task lifecycle events (started/ready/blocked/completed/failed/note). */
  agentsEvents(): Promise<Record<string, unknown>>;
  /** Budget caps, current usage, and remaining headroom. */
  budgetGet(): Promise<Record<string, unknown>>;
  /** Set budget caps (per-task/daily/monthly) and warning behavior. */
  budgetSet(body: z.infer<typeof S.BudgetSetRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** List governed triggers and the global pause-all kill switch. */
  triggersList(): Promise<Record<string, unknown>>;
  /** Create a governed trigger (requires consentRef + budget). */
  triggersCreate(body: z.infer<typeof S.TriggerCreateRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Pause or resume ALL triggers (kill switch). In-flight fires are not cancelled. */
  triggersPause(body: z.infer<typeof S.TriggerPauseRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Inspect one trigger by id. */
  triggersGet(id: string): Promise<Record<string, unknown>>;
  /** Shield security-service status. */
  shieldStatus(): Promise<Record<string, unknown>>;
  /** Recent scan results and findings. */
  shieldScan(): Promise<Record<string, unknown>>;
  /** System process security snapshot. */
  shieldProcesses(): Promise<Record<string, unknown>>;
  /** Startup-entry security snapshot. */
  shieldStartup(): Promise<Record<string, unknown>>;
  /** Privacy posture (telemetry off, local-first indicators). */
  shieldPrivacy(): Promise<Record<string, unknown>>;
  /** Download-security findings. */
  shieldDownloads(): Promise<Record<string, unknown>>;
  /** Browser-security snapshot. */
  shieldBrowser(): Promise<Record<string, unknown>>;
  /** Explain one shield finding by id. */
  shieldExplain(body: z.infer<typeof S.ShieldExplainRequest>): Promise<Record<string, unknown>>;
  /** Quarantine lifecycle: isolate | restore | delete a finding. */
  shieldQuarantine(body: z.infer<typeof S.ShieldQuarantineRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Add/remove a whitelist entry. */
  shieldWhitelist(body: z.infer<typeof S.ShieldWhitelistRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Toggle the ad-block component. */
  shieldAdblock(body: z.infer<typeof S.ShieldAdblockRequest>): Promise<Record<string, unknown>>;
  /** Trust & isolation service status (available backends, policy). */
  trustGet(): Promise<Record<string, unknown>>;
  /** Set the trust mode (careful|balanced|autonomous); the policy gate enforces it. */
  trustMode(): Promise<Record<string, unknown>>;
  /** Classify an action's risk tier and resolve its isolation placement. */
  trustClassifyPost(body: z.infer<typeof S.TrustClassifyRequest>): Promise<Record<string, unknown>>;
  /** Search/list capability descriptors (filters via query params). */
  capabilitiesList(): Promise<Record<string, unknown>>;
  /** Capability service health and counts. */
  capabilitiesHealth(): Promise<Record<string, unknown>>;
  /** Inspect one capability descriptor (?id=). */
  capabilitiesInspect(): Promise<Record<string, unknown>>;
  /** Effective permission view for a capability (?id=). */
  capabilitiesPermissions(): Promise<Record<string, unknown>>;
  /** Run contract-test certification for a capability. */
  capabilitiesCertify(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>>;
  /** Enable an installed capability. */
  capabilitiesEnable(body: z.infer<typeof S.CapabilityIdRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Disable an enabled capability. */
  capabilitiesDisable(body: z.infer<typeof S.CapabilityIdRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Quarantine a capability (fail-closed). */
  capabilitiesQuarantine(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>>;
  /** Rollback a capability to a previous version. */
  capabilitiesRollback(body: z.infer<typeof S.CapabilityIdRequest>): Promise<Record<string, unknown>>;
  /** Provider status (keys present, health, defaults). */
  providersList(): Promise<Record<string, unknown>>;
  /** Select default provider/model (+ optional fallback). */
  providersSet(body: z.infer<typeof S.ProviderSetRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Show the explainable routing decision for a task profile. */
  providersRoute(): Promise<Record<string, unknown>>;
  /** Routing SLO measurements (selection-latency compliance). */
  providersSlo(): Promise<Record<string, unknown>>;
  /** Full provider/model catalog with capabilities. */
  providersCatalog(): Promise<Record<string, unknown>>;
  /** Provider capabilities (supported features per provider). Phase 04 gateway. */
  providersCapabilities(): Promise<Record<string, unknown>>;
  /** Resolved fallback chain (primary → fallbackProvider → local). Phase 04 gateway. */
  providersFallback(): Promise<Record<string, unknown>>;
  /** List workspaces and the active one. */
  workspacesList(): Promise<Record<string, unknown>>;
  /** Create a workspace. */
  workspacesCreate(body: z.infer<typeof S.WorkspaceCreateRequest>): Promise<Record<string, unknown>>;
  /** Add or replace a custom OpenAI-compatible endpoint (any base URL the SSRF guard allows). */
  providersCustomAdd(body: z.infer<typeof S.CustomProviderAddRequest>): Promise<Record<string, unknown>>;
  /** Switch the active workspace. */
  workspacesSwitch(body: z.infer<typeof S.WorkspaceSwitchRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Local model runtimes: detection status and installed models. */
  modelsList(): Promise<Record<string, unknown>>;
  /** Select a local runtime+model and routing posture. */
  modelsSelect(body: z.infer<typeof S.ModelsSelectRequest>): Promise<Record<string, unknown>>;
  /** Pull a local model through the runtime, streaming its own byte-level progress (SSE). */
  modelsPull(body: z.infer<typeof S.ModelsPullRequest>): Promise<Record<string, unknown>>;
  /** Smoke-test a local runtime+model round-trip. */
  modelsTest(body: z.infer<typeof S.ModelsTestRequest>): Promise<Record<string, unknown>>;
  /** List registered MCP servers (live registry, CLI parity). */
  mcpList(): Promise<Record<string, unknown>>;
  /** Register an MCP server (stdio command or http url). */
  mcpAdd(): Promise<Record<string, unknown>>;
  /** Remove (uninstall) a registered MCP server. */
  mcpRemove(): Promise<Record<string, unknown>>;
  /** Enable a registered MCP server. */
  mcpEnable(): Promise<Record<string, unknown>>;
  /** Disable a registered MCP server. */
  mcpDisable(): Promise<Record<string, unknown>>;
  /** Best-effort health probe across registered MCP servers. */
  mcpHealth(): Promise<Record<string, unknown>>;
  /** SEC-01 pin snapshot: pinned MCP tool-contract hashes per server. */
  mcpPins(): Promise<Record<string, unknown>>;
  /** SEC-01 live drift report: pinned contract vs what the server advertises now. */
  mcpPinsDiff(): Promise<Record<string, unknown>>;
  /** SEC-01 pin a server's current tool contracts (hash snapshot). */
  mcpPin(): Promise<Record<string, unknown>>;
  /** SEC-01 drop a server's pin (legacy per-call approvals resume). */
  mcpUnpin(): Promise<Record<string, unknown>>;
  /** Telegram bot state: connection, running status, paired users and settings. Never includes the token. */
  telegramStatus(): Promise<Record<string, unknown>>;
  /** Save a BotFather token after a getMe check, then start the bot. */
  telegramConnect(body: z.infer<typeof S.TelegramConnectRequest>): Promise<Record<string, unknown>>;
  /** Stop the bot, remove the token and every paired user. Requires confirm: true. */
  telegramDisconnect(body: z.infer<typeof S.TelegramDisconnectRequest>): Promise<Record<string, unknown>>;
  /** Start polling (or the webhook, when one is set) for the connected bot. */
  telegramStart(): Promise<Record<string, unknown>>;
  /** Stop the bot cleanly. The token is kept so the bot can be started again. */
  telegramStop(): Promise<Record<string, unknown>>;
  /** Open the 10-minute pairing window. A user who sends /start then receives a 6-digit code. */
  telegramPairOpen(): Promise<Record<string, unknown>>;
  /** Confirm a 6-digit code shown in Telegram. The single-use code adds the sender to the paired list. */
  telegramPair(body: z.infer<typeof S.TelegramPairRequest>): Promise<Record<string, unknown>>;
  /** Remove one paired Telegram user. */
  telegramUnpair(body: z.infer<typeof S.TelegramUnpairRequest>): Promise<Record<string, unknown>>;
  /** Update rate limit, attachment cap, webhook URL and auto-start. Only sent fields change. */
  telegramSettings(body: z.infer<typeof S.TelegramSettingsRequest>): Promise<Record<string, unknown>>;
  /** Redacted tail of the Telegram bot log. */
  telegramLogs(body: z.infer<typeof S.TelegramLogsQuery>): Promise<Record<string, unknown>>;
  /** Receive a Telegram update in webhook mode. Authenticated by Telegram's secret_token header, not the XR token. */
  telegramWebhook(): Promise<Record<string, unknown>>;
  /** Discord bot state: gateway, paired users, allowed channels and settings. Never includes the token. */
  discordStatus(): Promise<Record<string, unknown>>;
  /** Save a bot token after checking it against Discord, register slash commands, then open the gateway. */
  discordConnect(body: z.infer<typeof S.DiscordConnectRequest>): Promise<Record<string, unknown>>;
  /** Stop the bot, remove the token, paired users and the channel allow-list. Requires confirm: true. */
  discordDisconnect(body: z.infer<typeof S.DiscordDisconnectRequest>): Promise<Record<string, unknown>>;
  /** Open the gateway for the connected bot (resumes the session when one is saved). */
  discordStart(): Promise<Record<string, unknown>>;
  /** Close the gateway cleanly. The token is kept so the bot can be started again. */
  discordStop(): Promise<Record<string, unknown>>;
  /** Open the 10-minute pairing window and mint one 6-digit code for the dialog to display. */
  discordPairOpen(body: z.infer<typeof S.DiscordPairOpenRequest>): Promise<Record<string, unknown>>;
  /** Close the pairing window and invalidate any code that was minted in it. */
  discordPairClose(): Promise<Record<string, unknown>>;
  /** Remove one paired Discord user. Their DMs stop being answered immediately. */
  discordUnpair(body: z.infer<typeof S.DiscordUnpairRequest>): Promise<Record<string, unknown>>;
  /** Servers the bot is a member of, for the channel picker. Read-only. */
  discordGuilds(): Promise<Record<string, unknown>>;
  /** Text channels in one server, for the channel picker. Read-only. */
  discordChannels(body: z.infer<typeof S.DiscordChannelsQuery>): Promise<Record<string, unknown>>;
  /** Allow XR to answer in one server channel (mention or slash command only). */
  discordChannelsAdd(body: z.infer<typeof S.DiscordChannelRemoveRequest>): Promise<Record<string, unknown>>;
  /** Revoke XR's access to one server channel. */
  discordChannelsRemove(body: z.infer<typeof S.DiscordChannelRemoveRequest>): Promise<Record<string, unknown>>;
  /** Update rate limit, attachment cap, webhook URL, dev server and auto-start. Only sent fields change. */
  discordSettings(body: z.infer<typeof S.DiscordSettingsRequest>): Promise<Record<string, unknown>>;
  /** Redacted tail of the Discord bot log. */
  discordLogs(body: z.infer<typeof S.DiscordLogsQuery>): Promise<Record<string, unknown>>;
  /** Receive an interaction in webhook mode. Authenticated by Discord's Ed25519 signature, not the XR token. */
  discordWebhook(): Promise<Record<string, unknown>>;
  /** WhatsApp link state: linked device, connection, QR window, allowed contacts, outbox, caps and per-chat settings. Never includes credentials. */
  whatsappStatus(): Promise<Record<string, unknown>>;
  /** Open the linked-device connection. With credentials on disk this resumes silently, with no QR. */
  whatsappConnect(): Promise<Record<string, unknown>>;
  /** Same as connect: start the linked device and mark the surface enabled. */
  whatsappStart(): Promise<Record<string, unknown>>;
  /** Close the socket but keep the link, so a later start resumes without a QR. */
  whatsappStop(): Promise<Record<string, unknown>>;
  /** Unlink the device: ask WhatsApp to log out, wipe the sealed credentials and stop. Requires confirm: true. */
  whatsappDisconnect(body: z.infer<typeof S.WhatsAppUnpairRequest>): Promise<Record<string, unknown>>;
  /** The same unlink action, named the way the dialog's button reads. Requires confirm: true. */
  whatsappUnpair(body: z.infer<typeof S.WhatsAppUnpairRequest>): Promise<Record<string, unknown>>;
  /** Open the QR pairing window (three minutes). Refused while a device is already linked. */
  whatsappPair(): Promise<Record<string, unknown>>;
  /** Close the QR window early and stop offering frames. */
  whatsappPairClose(): Promise<Record<string, unknown>>;
  /** Allow one contact number to talk to XR. Anything not on this list is ignored in silence. */
  whatsappContactsAdd(body: z.infer<typeof S.WhatsAppContactRemoveRequest>): Promise<Record<string, unknown>>;
  /** Revoke one contact number. Their chat stops being answered immediately. */
  whatsappContactsRemove(body: z.infer<typeof S.WhatsAppContactRemoveRequest>): Promise<Record<string, unknown>>;
  /** Update the message rate, attachment cap, outbox switch and auto-start. Only sent fields change. */
  whatsappSettings(body: z.infer<typeof S.WhatsAppSettingsRequest>): Promise<Record<string, unknown>>;
  /** Redacted tail of the WhatsApp log. Phone numbers appear as last four digits only. */
  whatsappLogs(body: z.infer<typeof S.WhatsAppLogsQuery>): Promise<Record<string, unknown>>;
  /** Server-sent events: QR frames as PNG data URLs while pairing, then a terminal state (open, timeout, closed or error). */
  whatsappQr(body: z.infer<typeof S.WhatsAppQrQuery>): Promise<Record<string, unknown>>;
  /** Computer-control subsystem status. */
  controlStatus(): Promise<Record<string, unknown>>;
  /** Single composed pane: control status + pending + permissions + triggers + mode. */
  controlCockpit(): Promise<Record<string, unknown>>;
  /** Recent control events (?limit=, ≤200). */
  controlEvents(): Promise<Record<string, unknown>>;
  /** Pending control authorizations (approval queue). */
  controlPending(): Promise<Record<string, unknown>>;
  /** Approve or deny a pending control authorization. */
  controlApprove(body: z.infer<typeof S.ControlApproveRequest>): Promise<z.infer<typeof S.OkResponse>>;
  /** Produce a control plan for a task (planning service). */
  controlPlan(body: z.infer<typeof S.ControlPlanRequest>): Promise<Record<string, unknown>>;
  /** List control-layer memory records. */
  controlMemoryList(): Promise<Record<string, unknown>>;
  /** Delete one control-layer memory record by id. */
  controlMemoryDelete(id: string): Promise<Record<string, unknown>>;
  /** Control history (legacy alias of events). */
  controlHistoryLegacy(): Promise<Record<string, unknown>>;
  /** Control permissions (legacy alias). */
  controlPermissionsLegacy(): Promise<Record<string, unknown>>;
  /** Pause/resume/stop computer control (durable, honored per-action by the gate; stop also denies all pending approvals). */
  controlPause(): Promise<Record<string, unknown>>;
  /** Grant a standing computer-use permission scope (persisted, audited, gate-enforced). */
  controlPermissionsGrant(): Promise<Record<string, unknown>>;
  /** Environment manager status. */
  environmentStatus(): Promise<Record<string, unknown>>;
  /** Environment interaction capability map. */
  environmentCapabilities(): Promise<Record<string, unknown>>;
  /** List open environment sessions. */
  environmentSessions(): Promise<Record<string, unknown>>;
  /** Close an environment session. */
  environmentClose(body: z.infer<typeof S.EnvironmentCloseRequest>): Promise<Record<string, unknown>>;
  /** Environment action history. */
  environmentHistory(): Promise<Record<string, unknown>>;
  /** Environment observations log. */
  environmentObservations(): Promise<Record<string, unknown>>;
  /** Effective environment policy. */
  environmentPolicy(): Promise<Record<string, unknown>>;
  /** List memory records (legacy memory surface). */
  memoryList(): Promise<Record<string, unknown>>;
  /** Memory subsystem health. */
  memoryHealth(): Promise<Record<string, unknown>>;
  /** Semantic memory search (?query=). */
  memorySearch(body: z.infer<typeof S.MemorySearchQuery>): Promise<Record<string, unknown>>;
  /** Explicitly remember something (user-provenance write). Refused for do-not-remember matches; sensitive content needs acknowledgeSensitive. */
  memoryCreate(body: z.infer<typeof S.MemoryCreateRequest>): Promise<z.infer<typeof S.MemoryWriteResponse>>;
  /** Edit a memory's content, tags, importance or expiry. Exclusion and sensitivity checks apply to edits. */
  memoryUpdate(id: string, body: z.infer<typeof S.MemoryUpdateRequest>): Promise<z.infer<typeof S.MemoryWriteResponse>>;
  /** Export this workspace's memory as an xr-memory JSON bundle (includes provenance). */
  memoryExport(): Promise<Record<string, unknown>>;
  /** Import an xr-memory bundle (merge, or replace with acknowledgeReplace). Sensitive entries are skipped, not imported. */
  memoryImport(body: z.infer<typeof S.MemoryImportRequest>): Promise<Record<string, unknown>>;
  /** Heuristic entity graph over memories (people, projects, files, tools). Read-only. */
  memoryGraph(): Promise<z.infer<typeof S.MemoryGraphResponse>>;
  /** Memory settings. Auto-memory is reported off and cannot be enabled in this version. */
  memorySettingsGet(): Promise<z.infer<typeof S.MemorySettingsResponse>>;
  /** Update memory settings (show expired). Turning on auto-memory is refused with 409. */
  memorySettingsPut(body: z.infer<typeof S.MemorySettingsRequest>): Promise<z.infer<typeof S.MemorySettingsResponse>>;
  /** Plan (default) or apply (apply: true) consolidation of old, low-importance memories into a summary. Originals are superseded, not deleted. */
  memoryConsolidate(body: z.infer<typeof S.MemoryConsolidateRequest>): Promise<Record<string, unknown>>;
  /** Scan text for sensitive patterns (card numbers, SSNs, API and private keys) without saving it. */
  memoryScan(body: z.infer<typeof S.MemoryScanRequest>): Promise<Record<string, unknown>>;
  /** Delete one memory record by id. */
  memoryDelete(id: string): Promise<Record<string, unknown>>;
  /** List built-in integrations with connection state. Secrets are never included. */
  integrationsList(): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Get one integration with its connection state. */
  integrationsGet(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Save the OAuth app client ID and secret (BYOK) in the credential vault. */
  integrationsApp_credentials(id: string, body: z.infer<typeof S.IntegrationAppCredentialsRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Start an OAuth sign-in. Returns the provider authorize URL with PKCE and state. */
  integrationsOauthStart(id: string): Promise<z.infer<typeof S.IntegrationOAuthStartResponse>>;
  /** Finish an OAuth sign-in from the xr:// callback. Validates the single-use state and stores tokens in the vault. */
  integrationsOauthComplete(body: z.infer<typeof S.IntegrationOAuthCompleteRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Connect an API-key integration. Secrets go to the vault after a successful probe. */
  integrationsConnect(id: string, body: z.infer<typeof S.IntegrationConnectRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Run a health probe and refresh the account and last-sync time. Refreshes the token first when needed. */
  integrationsSync(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Disconnect: revoke the grant (best effort) and delete the local token. */
  integrationsDisconnect(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>>;
  /** Context store status (counts, freshness, integrity). */
  contextStatus(): Promise<Record<string, unknown>>;
  /** List context items (?type=&scope=&all=). */
  contextItems(): Promise<Record<string, unknown>>;
  /** Effective context capture/injection policy. */
  contextPolicy(): Promise<Record<string, unknown>>;
  /** Pending consent decisions (capture/injection). */
  contextPending(): Promise<Record<string, unknown>>;
  /** Export all context data (data-ownership). */
  contextExport(): Promise<Record<string, unknown>>;
  /** Inspect one context item by id. */
  contextInspect(id: string): Promise<Record<string, unknown>>;
  /** Approve a pending context consent decision. */
  contextApprove(id: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Undo a context/memory mutation exactly (latest, or a specific undo-ledger op). Restore never fabricates authority — the before-image is what comes back. */
  contextUndo(body: z.infer<typeof S.ContextUndoRequest>): Promise<z.infer<typeof S.ContextUndoOutcome>>;
  /** Revoke consent for a context item (undoable via the undo ledger). */
  contextRevoke(id: string): Promise<z.infer<typeof S.OkResponse>>;
  /** Business licence state, verified offline against the built-in key. */
  cloudLicenseGet(): Promise<Record<string, unknown>>;
  /** Verify a submitted licence token without storing it. */
  cloudLicenseVerify(): Promise<Record<string, unknown>>;
  /** Whether one Business feature is available (?feature=…). */
  cloudLicenseFeature(feature: string): Promise<Record<string, unknown>>;
  /** Whether XR is signed in to a team (never fails when it is not). */
  cloudSessionGet(): Promise<Record<string, unknown>>;
  /** Sign out of the team; leaves all local data untouched. */
  cloudSessionDelete(): Promise<Record<string, unknown>>;
  /** Team memory facts for one shared workspace (?workspaceId=). */
  cloudTeammemoryGet(): Promise<Record<string, unknown>>;
  /** Promote a fact to a team workspace (sensitivity-vetted locally first). */
  cloudTeammemoryPost(): Promise<Record<string, unknown>>;
  /** Delete a team fact (administrative on the server). */
  cloudTeammemoryDelete(factId: string): Promise<Record<string, unknown>>;
  /** Teams this installation belongs to (degrades to available:false offline). */
  cloudTeamsGet(): Promise<Record<string, unknown>>;
  /** Shared team workspaces (degrades to available:false without a team). */
  cloudTeamworkspacesGet(): Promise<Record<string, unknown>>;
  /** Managed-model usage for the current organization. */
  cloudUsageGet(): Promise<Record<string, unknown>>;
  /** Desktop-local mobile listener status (bearer authenticated). */
  mobileDesktopStatusGet(): Promise<Record<string, unknown>>;
  /** Explicitly start desktop mobile listener using a CA-issued TLS identity. */
  mobileDesktopStartPost(body: z.infer<typeof S.DesktopMobileStartRequest>): Promise<Record<string, unknown>>;
  /** Stop the desktop mobile listener and invalidate outstanding pairing codes. */
  mobileDesktopStopPost(): Promise<Record<string, unknown>>;
  /** SHA-256 fingerprint of the served LAN certificate (server-reported only; not peer certificate pinning). */
  mobileCertFingerprintGet(): Promise<Record<string, unknown>>;
  /** Redeem the 6-digit pairing code; issues the HttpOnly Secure paired-device cookie. */
  mobilePairPost(): Promise<Record<string, unknown>>;
  /** Close the caller's session (rejects anonymous; clears the cookie; device self-revokes). */
  mobileSessionDelete(): Promise<Record<string, unknown>>;
  /** List paired devices (desktop/privileged sessions only). */
  mobileDevicesListGet(): Promise<Record<string, unknown>>;
  /** Revoke a paired device by id (desktop/privileged sessions only). */
  mobileDevicesRevokePost(id: string): Promise<Record<string, unknown>>;
  /** Send a test Web Push to a paired device (desktop/privileged sessions only; truthful ok:false when delivery fails). */
  mobileDevicesPushTestPost(id: string): Promise<Record<string, unknown>>;
  /** Mint an on-demand 6-digit pairing code and pairing URL (desktop/privileged sessions only). */
  mobilePairQrPost(): Promise<Record<string, unknown>>;
  /** VAPID public key for Web Push subscription (LAN mode only). */
  mobilePushVapidPubkeyGet(): Promise<Record<string, unknown>>;
  /** Attach or replace the paired device's Web Push subscription. */
  mobilePushSubscribePost(): Promise<Record<string, unknown>>;
  /** Remove the paired device's Web Push subscription. */
  mobilePushSubscribeDelete(): Promise<Record<string, unknown>>;
  /** Send a test Web Push to the paired device (truthful ok:false when delivery fails). */
  mobilePushTestPost(): Promise<Record<string, unknown>>;
  /** Model list for the companion picker (from the effective config; installed local models plus the effective selection). */
  mobileCompanionModelsGet(): Promise<Record<string, unknown>>;
  /** Budget summary in cents for the companion (today/month spend, monthly + per-task caps; no fabricated daily cap). */
  mobileCompanionBudgetGet(): Promise<Record<string, unknown>>;
  /** Pending approvals for the companion (same durable store as the desktop; decided records age out). */
  mobileCompanionApprovalsGet(): Promise<Record<string, unknown>>;
  /** Decide a pending approval from the phone (shared decide path — first decision wins from any surface). */
  mobileCompanionApprovalDecidePost(): Promise<Record<string, unknown>>;
  /** Companion chat list (mobile-scoped store; newest first). */
  mobileCompanionChatsGet(): Promise<Record<string, unknown>>;
  /** Create a companion chat. */
  mobileCompanionChatsCreatePost(): Promise<Record<string, unknown>>;
  /** Companion chat messages (mobile-scoped; sync source for a re-installed or second phone). */
  mobileCompanionChatMessagesGet(): Promise<Record<string, unknown>>;
  /** Send a companion chat message; streams the SAME canonical SSE as /api/chat (adapter: mode 'ask', per-chat lane). Provider-offline answers 503 honestly. */
  mobileCompanionChatPost(): Promise<Record<string, unknown>>;
  /** API index: version, operation catalogue link, OpenAPI location. */
  metaApiRootGet(): Promise<Record<string, unknown>>;
  /** Companion + desktop identity probe: daemon version, host URL, LAN flag, and the XR-P01 contract handshake (contract version, desktop floor, schema version, capabilities). Auth-gated (a 401 here is how the mobile app detects a revoked session). */
  metaVersionGet(): Promise<Record<string, unknown>>;
  /** The generated OpenAPI 3.1 document for this daemon. */
  metaOpenapiGet(): Promise<Record<string, unknown>>;
  /** Prometheus text exposition of daemon/runtime metrics (Phase 8 · T2). */
  metaMetricsGet(): Promise<Record<string, unknown>>;
  /** Recent trace spans (structural only; local ring buffer; never content). */
  metaTracesGet(): Promise<Record<string, unknown>>;
}

// [name, HTTP method, route template, path parameter count, body, raw SSE]
const OPERATIONS: ReadonlyArray<readonly [string, string, string, number, boolean, boolean]> = [
  ["researchRunStart","POST","/api/v1/research/run",0,true,false],
  ["researchRunGet","GET","/api/v1/research/run/{runId}",1,false,false],
  ["researchRunStream","GET","/api/v1/research/run/{runId}/stream",1,false,true],
  ["researchRunCancel","POST","/api/v1/research/run/{runId}/cancel",1,false,false],
  ["researchUploadPdf","POST","/api/v1/research/upload-pdf",0,false,false],
  ["researchSettingsGet","GET","/api/v1/research/settings",0,false,false],
  ["researchSettingsSet","PATCH","/api/v1/research/settings",0,true,false],
  ["researchRemember","POST","/api/v1/research/{id}/remember",1,false,false],
  ["researchSearch","POST","/api/v1/research/search",0,true,false],
  ["researchScrape","POST","/api/v1/research/scrape",0,true,false],
  ["researchMap","POST","/api/v1/research/map",0,true,false],
  ["researchCrawl","POST","/api/v1/research/crawl",0,true,false],
  ["researchExtract","POST","/api/v1/research/extract",0,true,false],
  ["researchJobsList","GET","/api/v1/research/jobs",0,false,false],
  ["researchJobsGet","GET","/api/v1/research/jobs/{id}",1,false,false],
  ["researchJobsCancel","POST","/api/v1/research/jobs/{id}/cancel",1,false,false],
  ["researchJobsStream","GET","/api/v1/research/stream/{id}",1,false,true],
  ["healthGet","GET","/api/v1/health",0,false,false],
  ["overviewGet","GET","/api/v1/overview",0,false,false],
  ["costGet","GET","/api/v1/cost",0,false,false],
  ["auditGet","GET","/api/v1/audit",0,false,false],
  ["auditExport","GET","/api/v1/audit/export",0,false,false],
  ["securityGet","GET","/api/v1/security",0,false,false],
  ["sessionsList","GET","/api/v1/sessions",0,false,false],
  ["sessionsGet","GET","/api/v1/sessions/{id}",1,false,false],
  ["researchList","GET","/api/v1/research",0,false,false],
  ["researchGet","GET","/api/v1/research/{id}",1,false,false],
  ["recoveryStatusGet","GET","/api/v1/recovery",0,false,false],
  ["configSafeGet","GET","/api/v1/config",0,false,false],
  ["approvalsList","GET","/api/v1/approvals",0,false,false],
  ["approvalsDecide","POST","/api/v1/approvals/{approvalId}/decision",1,true,false],
  ["voiceStatus","GET","/api/v1/voice/status",0,false,false],
  ["voiceSession","POST","/api/v1/voice/session",0,false,false],
  ["voiceAudio","POST","/api/v1/voice/audio",0,false,false],
  ["voiceEvents","GET","/api/v1/voice/events",0,false,false],
  ["voiceBarge","POST","/api/v1/voice/barge-in",0,false,false],
  ["voicePlayed","POST","/api/v1/voice/played",0,false,false],
  ["voiceSay","POST","/api/v1/voice/say",0,false,false],
  ["voiceModels","GET","/api/v1/voice/models",0,false,false],
  ["voiceVoices","GET","/api/v1/voice/voices",0,false,false],
  ["voiceSettingsGet","GET","/api/v1/voice/settings",0,false,false],
  ["voiceSettingsSet","POST","/api/v1/voice/settings",0,false,false],
  ["voiceDownload","POST","/api/v1/voice/download",0,false,false],
  ["voiceDownloadCancel","POST","/api/v1/voice/cancel-download",0,false,false],
  ["voiceModelsClear","POST","/api/v1/voice/clear-models",0,false,false],
  ["voiceTest_tts","POST","/api/v1/voice/test-tts",0,false,false],
  ["voiceTranscribe","POST","/api/v1/voice/transcribe",0,false,false],
  ["onboardingStatus","GET","/api/v1/onboarding/status",0,false,false],
  ["onboardingProvider","POST","/api/v1/onboarding/provider",0,true,false],
  ["onboardingProviderRemove","POST","/api/v1/onboarding/provider/remove",0,true,false],
  ["onboardingComplete","POST","/api/v1/onboarding/complete",0,true,false],
  ["filesList","GET","/api/v1/files",0,false,false],
  ["filesRead","GET","/api/v1/files/read",0,true,false],
  ["filesDiff","GET","/api/v1/files/diff",0,true,false],
  ["filesHunksRevert","POST","/api/v1/files/hunks/revert",0,true,false],
  ["filesWrite","POST","/api/v1/files/write",0,true,false],
  ["gitStatus","GET","/api/v1/git/status",0,false,false],
  ["gitLog","GET","/api/v1/git/log",0,false,false],
  ["gitStage","POST","/api/v1/git/stage",0,true,false],
  ["gitCommit","POST","/api/v1/git/commit",0,true,false],
  ["terminalRun","POST","/api/v1/terminal/run",0,true,true],
  ["terminalPtyList","GET","/api/v1/terminal/pty",0,false,false],
  ["terminalPtyOpen","POST","/api/v1/terminal/pty",0,true,true],
  ["terminalPtyInput","POST","/api/v1/terminal/pty/{sessionId}/input",1,true,false],
  ["terminalPtyResize","POST","/api/v1/terminal/pty/{sessionId}/resize",1,true,false],
  ["terminalPtyClose","DELETE","/api/v1/terminal/pty/{sessionId}",1,false,false],
  ["builderProjectsOpen","POST","/api/v1/builder/projects",0,true,false],
  ["builderProjectsList","GET","/api/v1/builder/projects",0,false,false],
  ["builderTree","GET","/api/v1/builder/projects/{projectId}/tree",1,false,false],
  ["builderFileRead","GET","/api/v1/builder/projects/{projectId}/file",1,true,false],
  ["builderFileWrite","POST","/api/v1/builder/projects/{projectId}/file/write",1,true,true],
  ["builderFileCreate","POST","/api/v1/builder/projects/{projectId}/file/create",1,true,true],
  ["builderFileRename","POST","/api/v1/builder/projects/{projectId}/file/rename",1,true,true],
  ["builderFileDelete","POST","/api/v1/builder/projects/{projectId}/file/delete",1,true,true],
  ["builderGit","GET","/api/v1/builder/projects/{projectId}/git",1,false,false],
  ["builderDiagnostics","POST","/api/v1/builder/projects/{projectId}/diagnostics",1,true,false],
  ["builderApplyDiff","POST","/api/v1/builder/projects/{projectId}/apply-diff",1,true,true],
  ["builderUndo","POST","/api/v1/builder/projects/{projectId}/undo",1,true,true],
  ["builderDevServerStatus","GET","/api/v1/builder/projects/{projectId}/dev-server",1,false,false],
  ["builderDevServerStart","POST","/api/v1/builder/projects/{projectId}/dev-server/start",1,true,true],
  ["builderDevServerStop","POST","/api/v1/builder/projects/{projectId}/dev-server/stop",1,false,false],
  ["builderDevServerInstall","POST","/api/v1/builder/projects/{projectId}/dev-server/install",1,false,true],
  ["builderEvents","GET","/api/v1/builder/projects/{projectId}/events",1,false,true],
  ["stateUiGet","GET","/api/v1/state/ui",0,true,false],
  ["stateUiPatch","PUT","/api/v1/state/ui",0,true,false],
  ["chatStreamPost","POST","/api/v1/chat",0,true,true],
  ["agentsCustomList","GET","/api/v1/agents/custom",0,false,false],
  ["agentsCustomCreate","POST","/api/v1/agents/custom",0,true,false],
  ["agentsCustomImport","POST","/api/v1/agents/custom/import",0,true,false],
  ["agentsCustomGet","GET","/api/v1/agents/custom/{id}",1,false,false],
  ["agentsCustomUpdate","PATCH","/api/v1/agents/custom/{id}",1,true,false],
  ["agentsCustomDelete","DELETE","/api/v1/agents/custom/{id}",1,false,false],
  ["agentsCustomDuplicate","POST","/api/v1/agents/custom/{id}/duplicate",1,true,false],
  ["workflowsInspect","POST","/api/v1/workflows/inspect",0,true,false],
  ["workflowsRunsList","GET","/api/v1/workflows/runs",0,false,false],
  ["workflowsRunsGet","GET","/api/v1/workflows/runs/{runId}",1,false,false],
  ["workflowsRunsStream","GET","/api/v1/workflows/runs/{runId}/stream",1,false,true],
  ["workflowsRunsCancel","POST","/api/v1/workflows/runs/{runId}/cancel",1,false,false],
  ["workflowsRunsPause","POST","/api/v1/workflows/runs/{runId}/pause",1,false,false],
  ["workflowsRunsResume","POST","/api/v1/workflows/runs/{runId}/resume",1,false,false],
  ["workflowsRunsDecide","POST","/api/v1/workflows/runs/{runId}/human-decision",1,true,false],
  ["workflowsList","GET","/api/v1/workflows",0,false,false],
  ["workflowsCreate","POST","/api/v1/workflows",0,true,false],
  ["workflowsGet","GET","/api/v1/workflows/{id}",1,false,false],
  ["workflowsUpdate","PATCH","/api/v1/workflows/{id}",1,true,false],
  ["workflowsDelete","DELETE","/api/v1/workflows/{id}",1,false,false],
  ["workflowsRun","POST","/api/v1/workflows/{id}/run",1,true,false],
  ["workflowsRunsHistory","GET","/api/v1/workflows/{id}/runs",1,false,false],
  ["agentsList","GET","/api/v1/agents",0,false,false],
  ["agentsWorkflowGet","GET","/api/v1/agents/workflows/{workflow}",1,false,false],
  ["agentsTemplates","GET","/api/v1/agents/templates",0,false,false],
  ["agentsWorkflowCreate","POST","/api/v1/agents/workflows",0,false,false],
  ["agentsWorkflowControl","POST","/api/v1/agents/workflows/",0,false,false],
  ["agentsWorkflowSteer","POST","/api/v1/agents/workflows/",0,false,false],
  ["agentsWorkflowReview","POST","/api/v1/agents/workflows/",0,false,false],
  ["agentsEvents","GET","/api/v1/agents/events",0,false,false],
  ["budgetGet","GET","/api/v1/budget",0,false,false],
  ["budgetSet","POST","/api/v1/budget/set",0,true,false],
  ["triggersList","GET","/api/v1/triggers",0,false,false],
  ["triggersCreate","POST","/api/v1/triggers",0,true,false],
  ["triggersPause","POST","/api/v1/triggers/pause",0,true,false],
  ["triggersGet","GET","/api/v1/triggers/{id}",1,false,false],
  ["shieldStatus","GET","/api/v1/shield/status",0,false,false],
  ["shieldScan","GET","/api/v1/shield/scan",0,false,false],
  ["shieldProcesses","GET","/api/v1/shield/processes",0,false,false],
  ["shieldStartup","GET","/api/v1/shield/startup",0,false,false],
  ["shieldPrivacy","GET","/api/v1/shield/privacy",0,false,false],
  ["shieldDownloads","GET","/api/v1/shield/downloads",0,false,false],
  ["shieldBrowser","GET","/api/v1/shield/browser",0,false,false],
  ["shieldExplain","POST","/api/v1/shield/explain",0,true,false],
  ["shieldQuarantine","POST","/api/v1/shield/quarantine",0,true,false],
  ["shieldWhitelist","POST","/api/v1/shield/whitelist",0,true,false],
  ["shieldAdblock","POST","/api/v1/shield/adblock",0,true,false],
  ["trustGet","GET","/api/v1/trust",0,false,false],
  ["trustMode","POST","/api/v1/trust/mode",0,false,false],
  ["trustClassifyPost","POST","/api/v1/trust/classify",0,true,false],
  ["capabilitiesList","GET","/api/v1/capabilities",0,false,false],
  ["capabilitiesHealth","GET","/api/v1/capabilities/health",0,false,false],
  ["capabilitiesInspect","GET","/api/v1/capabilities/inspect",0,false,false],
  ["capabilitiesPermissions","GET","/api/v1/capabilities/permissions",0,false,false],
  ["capabilitiesCertify","POST","/api/v1/capabilities/certify",0,true,false],
  ["capabilitiesEnable","POST","/api/v1/capabilities/enable",0,true,false],
  ["capabilitiesDisable","POST","/api/v1/capabilities/disable",0,true,false],
  ["capabilitiesQuarantine","POST","/api/v1/capabilities/quarantine",0,true,false],
  ["capabilitiesRollback","POST","/api/v1/capabilities/rollback",0,true,false],
  ["providersList","GET","/api/v1/providers",0,false,false],
  ["providersSet","POST","/api/v1/providers/set",0,true,false],
  ["providersRoute","GET","/api/v1/providers/route",0,false,false],
  ["providersSlo","GET","/api/v1/providers/slo",0,false,false],
  ["providersCatalog","GET","/api/v1/providers/catalog",0,false,false],
  ["providersCapabilities","GET","/api/v1/providers/capabilities",0,false,false],
  ["providersFallback","GET","/api/v1/providers/fallback",0,false,false],
  ["workspacesList","GET","/api/v1/workspaces",0,false,false],
  ["workspacesCreate","POST","/api/v1/workspaces/create",0,true,false],
  ["providersCustomAdd","POST","/api/v1/providers/custom",0,true,false],
  ["workspacesSwitch","POST","/api/v1/workspaces/switch",0,true,false],
  ["modelsList","GET","/api/v1/models",0,false,false],
  ["modelsSelect","POST","/api/v1/models/select",0,true,false],
  ["modelsPull","POST","/api/v1/models/pull",0,true,false],
  ["modelsTest","POST","/api/v1/models/test",0,true,false],
  ["mcpList","GET","/api/v1/mcp",0,false,false],
  ["mcpAdd","POST","/api/v1/mcp/add",0,false,false],
  ["mcpRemove","POST","/api/v1/mcp/remove",0,false,false],
  ["mcpEnable","POST","/api/v1/mcp/enable",0,false,false],
  ["mcpDisable","POST","/api/v1/mcp/disable",0,false,false],
  ["mcpHealth","GET","/api/v1/mcp/health",0,false,false],
  ["mcpPins","GET","/api/v1/mcp/pins",0,false,false],
  ["mcpPinsDiff","GET","/api/v1/mcp/pins/diff/",0,false,false],
  ["mcpPin","POST","/api/v1/mcp/pin",0,false,false],
  ["mcpUnpin","POST","/api/v1/mcp/unpin",0,false,false],
  ["telegramStatus","GET","/api/v1/telegram/status",0,false,false],
  ["telegramConnect","POST","/api/v1/telegram/connect",0,true,false],
  ["telegramDisconnect","POST","/api/v1/telegram/disconnect",0,true,false],
  ["telegramStart","POST","/api/v1/telegram/start",0,false,false],
  ["telegramStop","POST","/api/v1/telegram/stop",0,false,false],
  ["telegramPairOpen","POST","/api/v1/telegram/pair/open",0,false,false],
  ["telegramPair","POST","/api/v1/telegram/pair",0,true,false],
  ["telegramUnpair","POST","/api/v1/telegram/unpair",0,true,false],
  ["telegramSettings","POST","/api/v1/telegram/settings",0,true,false],
  ["telegramLogs","GET","/api/v1/telegram/logs",0,true,false],
  ["telegramWebhook","POST","/api/v1/telegram/webhook",0,false,false],
  ["discordStatus","GET","/api/v1/discord/status",0,false,false],
  ["discordConnect","POST","/api/v1/discord/connect",0,true,false],
  ["discordDisconnect","POST","/api/v1/discord/disconnect",0,true,false],
  ["discordStart","POST","/api/v1/discord/start",0,false,false],
  ["discordStop","POST","/api/v1/discord/stop",0,false,false],
  ["discordPairOpen","POST","/api/v1/discord/pair/open",0,true,false],
  ["discordPairClose","POST","/api/v1/discord/pair/close",0,false,false],
  ["discordUnpair","POST","/api/v1/discord/unpair",0,true,false],
  ["discordGuilds","GET","/api/v1/discord/guilds",0,false,false],
  ["discordChannels","GET","/api/v1/discord/channels",0,true,false],
  ["discordChannelsAdd","POST","/api/v1/discord/channels/add",0,true,false],
  ["discordChannelsRemove","POST","/api/v1/discord/channels/remove",0,true,false],
  ["discordSettings","POST","/api/v1/discord/settings",0,true,false],
  ["discordLogs","GET","/api/v1/discord/logs",0,true,false],
  ["discordWebhook","POST","/api/v1/discord/webhook",0,false,false],
  ["whatsappStatus","GET","/api/v1/whatsapp/status",0,false,false],
  ["whatsappConnect","POST","/api/v1/whatsapp/connect",0,false,false],
  ["whatsappStart","POST","/api/v1/whatsapp/start",0,false,false],
  ["whatsappStop","POST","/api/v1/whatsapp/stop",0,false,false],
  ["whatsappDisconnect","POST","/api/v1/whatsapp/disconnect",0,true,false],
  ["whatsappUnpair","POST","/api/v1/whatsapp/unpair",0,true,false],
  ["whatsappPair","POST","/api/v1/whatsapp/pair",0,false,false],
  ["whatsappPairClose","POST","/api/v1/whatsapp/pair/close",0,false,false],
  ["whatsappContactsAdd","POST","/api/v1/whatsapp/contacts/add",0,true,false],
  ["whatsappContactsRemove","POST","/api/v1/whatsapp/contacts/remove",0,true,false],
  ["whatsappSettings","POST","/api/v1/whatsapp/settings",0,true,false],
  ["whatsappLogs","GET","/api/v1/whatsapp/logs",0,true,false],
  ["whatsappQr","GET","/api/v1/whatsapp/qr",0,true,false],
  ["controlStatus","GET","/api/v1/control/status",0,false,false],
  ["controlCockpit","GET","/api/v1/control/cockpit",0,false,false],
  ["controlEvents","GET","/api/v1/control/events",0,false,false],
  ["controlPending","GET","/api/v1/control/pending",0,false,false],
  ["controlApprove","POST","/api/v1/control/approve",0,true,false],
  ["controlPlan","POST","/api/v1/control/plan",0,true,false],
  ["controlMemoryList","GET","/api/v1/control/memory",0,false,false],
  ["controlMemoryDelete","DELETE","/api/v1/control/memory/{id}",1,false,false],
  ["controlHistoryLegacy","GET","/api/v1/control/history",0,false,false],
  ["controlPermissionsLegacy","GET","/api/v1/control/permissions",0,false,false],
  ["controlPause","POST","/api/v1/control/pause",0,false,false],
  ["controlPermissionsGrant","POST","/api/v1/control/permissions/grant",0,false,false],
  ["environmentStatus","GET","/api/v1/environment/status",0,false,false],
  ["environmentCapabilities","GET","/api/v1/environment/capabilities",0,false,false],
  ["environmentSessions","GET","/api/v1/environment/sessions",0,false,false],
  ["environmentClose","POST","/api/v1/environment/close",0,true,false],
  ["environmentHistory","GET","/api/v1/environment/history",0,false,false],
  ["environmentObservations","GET","/api/v1/environment/observations",0,false,false],
  ["environmentPolicy","GET","/api/v1/environment/policy",0,false,false],
  ["memoryList","GET","/api/v1/memory",0,false,false],
  ["memoryHealth","GET","/api/v1/memory/health",0,false,false],
  ["memorySearch","GET","/api/v1/memory/search",0,true,false],
  ["memoryCreate","POST","/api/v1/memory",0,true,false],
  ["memoryUpdate","PATCH","/api/v1/memory/{id}",1,true,false],
  ["memoryExport","GET","/api/v1/memory/export",0,false,false],
  ["memoryImport","POST","/api/v1/memory/import",0,true,false],
  ["memoryGraph","GET","/api/v1/memory/graph",0,false,false],
  ["memorySettingsGet","GET","/api/v1/memory/settings",0,false,false],
  ["memorySettingsPut","PUT","/api/v1/memory/settings",0,true,false],
  ["memoryConsolidate","POST","/api/v1/memory/consolidate",0,true,false],
  ["memoryScan","POST","/api/v1/memory/scan-sensitive",0,true,false],
  ["memoryDelete","DELETE","/api/v1/memory/{id}",1,false,false],
  ["integrationsList","GET","/api/v1/integrations",0,false,false],
  ["integrationsGet","GET","/api/v1/integrations/{id}",1,false,false],
  ["integrationsApp_credentials","PUT","/api/v1/integrations/{id}/app",1,true,false],
  ["integrationsOauthStart","POST","/api/v1/integrations/{id}/oauth/start",1,false,false],
  ["integrationsOauthComplete","POST","/api/v1/integrations/oauth/complete",0,true,false],
  ["integrationsConnect","POST","/api/v1/integrations/{id}/connect",1,true,false],
  ["integrationsSync","POST","/api/v1/integrations/{id}/sync",1,false,false],
  ["integrationsDisconnect","POST","/api/v1/integrations/{id}/disconnect",1,false,false],
  ["contextStatus","GET","/api/v1/context",0,false,false],
  ["contextItems","GET","/api/v1/context/items",0,false,false],
  ["contextPolicy","GET","/api/v1/context/policy",0,false,false],
  ["contextPending","GET","/api/v1/context/pending",0,false,false],
  ["contextExport","GET","/api/v1/context/export",0,false,false],
  ["contextInspect","GET","/api/v1/context/item/{id}",1,false,false],
  ["contextApprove","POST","/api/v1/context/approve/{id}",1,false,false],
  ["contextUndo","POST","/api/v1/context/undo",0,true,false],
  ["contextRevoke","POST","/api/v1/context/revoke/{id}",1,false,false],
  ["cloudLicenseGet","GET","/api/v1/cloud/license",0,false,false],
  ["cloudLicenseVerify","POST","/api/v1/cloud/license/verify",0,false,false],
  ["cloudLicenseFeature","GET","/api/v1/cloud/license/feature/{feature}",1,false,false],
  ["cloudSessionGet","GET","/api/v1/cloud/session",0,false,false],
  ["cloudSessionDelete","DELETE","/api/v1/cloud/session",0,false,false],
  ["cloudTeammemoryGet","GET","/api/v1/cloud/team-memory",0,false,false],
  ["cloudTeammemoryPost","POST","/api/v1/cloud/team-memory",0,false,false],
  ["cloudTeammemoryDelete","DELETE","/api/v1/cloud/team-memory/{factId}",1,false,false],
  ["cloudTeamsGet","GET","/api/v1/cloud/teams",0,false,false],
  ["cloudTeamworkspacesGet","GET","/api/v1/cloud/team-workspaces",0,false,false],
  ["cloudUsageGet","GET","/api/v1/cloud/usage",0,false,false],
  ["mobileDesktopStatusGet","GET","/api/v1/mobile/desktop/status",0,false,false],
  ["mobileDesktopStartPost","POST","/api/v1/mobile/desktop/start",0,true,false],
  ["mobileDesktopStopPost","POST","/api/v1/mobile/desktop/stop",0,false,false],
  ["mobileCertFingerprintGet","GET","/api/v1/mobile/cert-fingerprint",0,false,false],
  ["mobilePairPost","POST","/api/v1/mobile/pair",0,false,false],
  ["mobileSessionDelete","DELETE","/api/v1/mobile/session",0,false,false],
  ["mobileDevicesListGet","GET","/api/v1/mobile/devices",0,false,false],
  ["mobileDevicesRevokePost","POST","/api/v1/mobile/devices/{id}/revoke",1,false,false],
  ["mobileDevicesPushTestPost","POST","/api/v1/mobile/devices/{id}/push-test",1,false,false],
  ["mobilePairQrPost","POST","/api/v1/mobile/pair-qr",0,false,false],
  ["mobilePushVapidPubkeyGet","GET","/api/v1/mobile/push/vapid-pubkey",0,false,false],
  ["mobilePushSubscribePost","POST","/api/v1/mobile/push/subscribe",0,false,false],
  ["mobilePushSubscribeDelete","DELETE","/api/v1/mobile/push/subscribe",0,false,false],
  ["mobilePushTestPost","POST","/api/v1/mobile/push/test",0,false,false],
  ["mobileCompanionModelsGet","GET","/api/v1/mobile/models",0,false,false],
  ["mobileCompanionBudgetGet","GET","/api/v1/mobile/budget",0,false,false],
  ["mobileCompanionApprovalsGet","GET","/api/v1/mobile/approvals",0,false,false],
  ["mobileCompanionApprovalDecidePost","POST","/api/v1/mobile/approvals",0,false,false],
  ["mobileCompanionChatsGet","GET","/api/v1/mobile/chats",0,false,false],
  ["mobileCompanionChatsCreatePost","POST","/api/v1/mobile/chats",0,false,false],
  ["mobileCompanionChatMessagesGet","GET","/api/v1/mobile/chats",0,false,false],
  ["mobileCompanionChatPost","POST","/api/v1/mobile/chat",0,false,false],
  ["metaApiRootGet","GET","/api/v1",0,false,false],
  ["metaVersionGet","GET","/api/v1/meta/version",0,false,false],
  ["metaOpenapiGet","GET","/api/v1/openapi.json",0,false,false],
  ["metaMetricsGet","GET","/api/v1/metrics",0,false,false],
  ["metaTracesGet","GET","/api/v1/traces/recent",0,false,false],
];

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

  static {
    for (const [name, method, template, parameterCount, hasBody, sse] of OPERATIONS) {
      Object.defineProperty(this.prototype, name, {
        configurable: true, writable: true,
        value: async function(this: XRDaemonClient, ...args: unknown[]) {
          let i = 0;
          const path = template.replace(/\{[^}]+\}/g, () => encodeURIComponent(args[i++] as string));
          const body = hasBody ? args[parameterCount] : undefined;
          return sse ? this.raw(method, path, body) : this.call(method, path, body);
        },
      });
    }
  }
}

/** Convenience factory. */
export function createDaemonClient(opts: XRDaemonClientOptions): XRDaemonClient {
  return new XRDaemonClient(opts);
}
