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

  /** Start a full research run (plan → search → read → extract → synthesize) through the same engine as `xr research`; returns immediately with a run id to stream. */
  async researchRunStart(body: z.infer<typeof S.ResearchRunStartRequest>): Promise<z.infer<typeof S.ResearchRunStartResponse>> {
    return await this.call("POST", "/api/v1/research/run", body);
  }

  /** Status of a research run (state, session id, result once finished). */
  async researchRunGet(runId: string): Promise<z.infer<typeof S.ResearchRunResponse>> {
    return await this.call("GET", `/api/v1/research/run/${encodeURIComponent(runId)}`);
  }

  /** Stream a research run as Server-Sent Events: buffered replay, then live run_started · status · log · plan · search · sources · fetch · extract · contradictions · budget · run_completed | run_error · stream_end. (SSE stream — returns the raw Response). */
  async researchRunStream(runId: string): Promise<Response> {
    return await this.raw("GET", `/api/v1/research/run/${encodeURIComponent(runId)}/stream`);
  }

  /** Cancel a research run — the abort reaches the in-flight model call and page fetch; the session persists as stopped (cancelled) with everything gathered so far. */
  async researchRunCancel(runId: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("POST", `/api/v1/research/run/${encodeURIComponent(runId)}/cancel`);
  }

  /** Extract text from an uploaded PDF (multipart field `file`, ≤ 20 MB) in memory — nothing is written to disk; attach the text to a run as a document. */
  async researchUploadPdf(): Promise<z.infer<typeof S.ResearchPdfUploadResponse>> {
    return await this.call("POST", "/api/v1/research/upload-pdf");
  }

  /** Research network posture: whether the search host is allow-listed and whether research may fetch the public web. */
  async researchSettingsGet(): Promise<z.infer<typeof S.ResearchSettingsResponse>> {
    return await this.call("GET", "/api/v1/research/settings");
  }

  /** Persist research.allowPublicWeb (the research-only public-web fetch path; the egress allow-list and SSRF guard still apply). */
  async researchSettingsSet(body: z.infer<typeof S.ResearchSettingsPatchRequest>): Promise<z.infer<typeof S.ResearchSettingsResponse>> {
    return await this.call("PATCH", "/api/v1/research/settings", body);
  }

  /** Save a finished research finding to durable memory as model synthesis (provenance + per-source links); explicit, never automatic. */
  async researchRemember(id: string): Promise<z.infer<typeof S.ResearchRememberResponse>> {
    return await this.call("POST", `/api/v1/research/${encodeURIComponent(id)}/remember`);
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

  /** Phase 15: STT model catalogue (offline/download, local binaries, cloud) with install state and sizes. */
  async voiceModels(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/voice/models");
  }

  /** Phase 15: TTS voice catalogue (Piper offline voices + cloud) with install state and sizes. */
  async voiceVoices(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/voice/voices");
  }

  /** Phase 15: effective voice settings (engine config `voice` block). */
  async voiceSettingsGet(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/voice/settings");
  }

  /** Phase 15: patch voice settings (validated, clamped); applies live to the session. */
  async voiceSettingsSet(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/settings");
  }

  /** Phase 15: start a model download (component+id, or the first-run bundle); progress streams on /events. */
  async voiceDownload(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/download");
  }

  /** Phase 15: cancel the running model download (partial files resume on retry). */
  async voiceDownloadCancel(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/cancel-download");
  }

  /** Phase 15: delete every downloaded voice model and the extracted runtime. */
  async voiceModelsClear(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/clear-models");
  }

  /** Phase 15: synthesize a sample (voice/speed override) and return WAV bytes without touching the session. */
  async voiceTest_tts(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/test-tts");
  }

  /** Phase 15: transcribe one pcm16 utterance directly (settings screen 'Test transcription'). */
  async voiceTranscribe(): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/voice/transcribe");
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

  /** Hunk-level REJECT over the engine's own diff: reverse-apply the chosen hunks of a file's working-tree diff via git, after ONE human approval whose preview shows exactly those hunks. Stale ids and changed files are refused (409), never guessed. */
  async filesHunksRevert(body: z.infer<typeof S.FilesHunksRevertRequest>): Promise<z.infer<typeof S.FilesHunksRevertResponse>> {
    return await this.call("POST", "/api/v1/files/hunks/revert", body);
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

  /** Run ONE shell command in the project root — deterministic policy check, durable approval, output streamed as SSE (line-based command runner, NOT a PTY; see terminal.pty.open for the real one). (SSE stream — returns the raw Response). */
  async terminalRun(body: z.infer<typeof S.TerminalRunRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/terminal/run", body);
  }

  /** Live terminal sessions owned by this daemon and the per-daemon cap. */
  async terminalPtyList(): Promise<z.infer<typeof S.TerminalPtyListResponse>> {
    return await this.call("GET", "/api/v1/terminal/pty");
  }

  /** Open a REAL interactive terminal (pseudo-terminal: openpty / ConPTY) in the project root — ONE durable high-tier approval per session (keystrokes are not policy-inspected, and the preview says so), cwd scope-enforced, output streamed as SSE, shell killed on disconnect. (SSE stream — returns the raw Response). */
  async terminalPtyOpen(body: z.infer<typeof S.TerminalPtyOpenRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/terminal/pty", body);
  }

  /** Write keystrokes to an open terminal session (≤ 64 KB per message). */
  async terminalPtyInput(sessionId: string, body: z.infer<typeof S.TerminalPtyInputRequest>): Promise<z.infer<typeof S.TerminalPtyInputResponse>> {
    return await this.call("POST", `/api/v1/terminal/pty/${encodeURIComponent(sessionId)}/input`, body);
  }

  /** Resize an open terminal session (the child sees the new size). */
  async terminalPtyResize(sessionId: string, body: z.infer<typeof S.TerminalPtyResizeRequest>): Promise<z.infer<typeof S.TerminalPtyResizeResponse>> {
    return await this.call("POST", `/api/v1/terminal/pty/${encodeURIComponent(sessionId)}/resize`, body);
  }

  /** End a terminal session the way a closing window does: SIGHUP, then SIGKILL after a 2 s grace (Windows: close console + terminate). */
  async terminalPtyClose(sessionId: string): Promise<z.infer<typeof S.TerminalPtyCloseResponse>> {
    return await this.call("DELETE", `/api/v1/terminal/pty/${encodeURIComponent(sessionId)}`);
  }

  /** Register/open an absolute folder as a Builder project (validated, realpath'd, audited) → stable id for every other Builder route. */
  async builderProjectsOpen(body: z.infer<typeof S.BuilderProjectOpenRequest>): Promise<z.infer<typeof S.BuilderProjectResponse>> {
    return await this.call("POST", "/api/v1/builder/projects", body);
  }

  /** Projects this daemon has open. */
  async builderProjectsList(): Promise<z.infer<typeof S.BuilderProjectsListResponse>> {
    return await this.call("GET", "/api/v1/builder/projects");
  }

  /** Project tree (heavy folders listed, not descended; 4 000-entry cap) with git badges and branch. */
  async builderTree(projectId: string): Promise<z.infer<typeof S.BuilderTreeResponse>> {
    return await this.call("GET", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/tree`);
  }

  /** Read a text file inside the project (?path=, 512 KB cap, binary detected). */
  async builderFileRead(projectId: string, body: z.infer<typeof S.BuilderFileReadRequest>): Promise<z.infer<typeof S.BuilderFileReadResponse>> {
    return await this.call("GET", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/file`, body);
  }

  /** Save a file — SSE: approval_required (write_file, per-project scope) → applied | denied; stale mtime answers 409 first. (SSE stream — returns the raw Response). */
  async builderFileWrite(projectId: string, body: z.infer<typeof S.BuilderFileWriteRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/file/write`, body);
  }

  /** Create an empty file or a folder — SSE consent stream (create_file | mkdir). (SSE stream — returns the raw Response). */
  async builderFileCreate(projectId: string, body: z.infer<typeof S.BuilderFileCreateRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/file/create`, body);
  }

  /** Rename/move inside the project — SSE consent stream (rename_file). (SSE stream — returns the raw Response). */
  async builderFileRename(projectId: string, body: z.infer<typeof S.BuilderFileRenameRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/file/rename`, body);
  }

  /** Delete a file or folder (recursive, stated in the approval) — SSE consent stream (delete_file). (SSE stream — returns the raw Response). */
  async builderFileDelete(projectId: string, body: z.infer<typeof S.BuilderFileDeleteRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/file/delete`, body);
  }

  /** Branch, dirty flag and per-path badges for the project. */
  async builderGit(projectId: string): Promise<z.infer<typeof S.BuilderGitResponse>> {
    return await this.call("GET", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/git`);
  }

  /** Syntax diagnostics from the PROJECT's own TypeScript (transpileModule); {available:false} when it is not installed. */
  async builderDiagnostics(projectId: string, body: z.infer<typeof S.BuilderDiagnosticsRequest>): Promise<z.infer<typeof S.BuilderDiagnosticsResponse>> {
    return await this.call("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/diagnostics`, body);
  }

  /** Apply selected hunks of a unified diff — dry-run first (conflicts → 409, nobody asked), then SSE consent stream (patch) with a backup for undo. (SSE stream — returns the raw Response). */
  async builderApplyDiff(projectId: string, body: z.infer<typeof S.BuilderApplyDiffRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/apply-diff`, body);
  }

  /** Restore the backup an apply-diff made — SSE consent stream (write_file). (SSE stream — returns the raw Response). */
  async builderUndo(projectId: string, body: z.infer<typeof S.BuilderUndoRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/undo`, body);
  }

  /** Detected dev command (vite/next/cra/node/cargo/django/flask/static), live status and the recent log tail. */
  async builderDevServerStatus(projectId: string): Promise<z.infer<typeof S.BuilderDevServerResponse>> {
    return await this.call("GET", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/dev-server`);
  }

  /** Start the dev server — deterministic policy gate, then SSE consent stream (shell; static sites: serve_static) → applied{status}. (SSE stream — returns the raw Response). */
  async builderDevServerStart(projectId: string, body: z.infer<typeof S.BuilderDevServerStartRequest>): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/dev-server/start`, body);
  }

  /** Stop the project's dev server (SIGTERM → 2 s → SIGKILL). */
  async builderDevServerStop(projectId: string): Promise<z.infer<typeof S.BuilderDevServerStopResponse>> {
    return await this.call("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/dev-server/stop`);
  }

  /** Install dependencies with the lockfile's package manager — SSE consent stream (shell); output streams on the events feed. (SSE stream — returns the raw Response). */
  async builderDevServerInstall(projectId: string): Promise<Response> {
    return await this.raw("POST", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/dev-server/install`);
  }

  /** Live feed (SSE): dev-server log/ready/exit/status and debounced fs:changed batches from a recursive watcher. (SSE stream — returns the raw Response). */
  async builderEvents(projectId: string): Promise<Response> {
    return await this.raw("GET", `/api/v1/builder/projects/${encodeURIComponent(projectId)}/events`);
  }

  /** Desktop UI state for this workspace (layout, tabs, drafts, last area) — opaque JSON the renderer owns, kept durable by the engine. */
  async stateUiGet(body: z.infer<typeof S.UiStateGetQuery>): Promise<z.infer<typeof S.UiStateGetResponse>> {
    return await this.call("GET", "/api/v1/state/ui", body);
  }

  /** Upsert/delete desktop UI-state keys (null deletes). Budgeted: ≤ 256 KB per value, ≤ 256 keys per workspace, key shape enforced; all-or-nothing. */
  async stateUiPatch(body: z.infer<typeof S.UiStatePatchRequest>): Promise<z.infer<typeof S.UiStatePatchResponse>> {
    return await this.call("PUT", "/api/v1/state/ui", body);
  }

  /** One-shot chat completion streamed as Server-Sent Events. (SSE stream — returns the raw Response). */
  async chatStreamPost(body: z.infer<typeof S.ChatStreamRequest>): Promise<Response> {
    return await this.raw("POST", "/api/v1/chat", body);
  }

  /** List user-authored agents (full documents, newest first). */
  async agentsCustomList(): Promise<z.infer<typeof S.CustomAgentListResponse>> {
    return await this.call("GET", "/api/v1/agents/custom");
  }

  /** Create a custom agent; validated (name, prompt ≥ 20 chars, tools ⊆ engine tools, budget $0.01–$5) and stored as versioned JSON. */
  async agentsCustomCreate(body: z.infer<typeof S.CustomAgentInputRequest>): Promise<z.infer<typeof S.CustomAgentResponse>> {
    return await this.call("POST", "/api/v1/agents/custom", body);
  }

  /** Import an exported agent document; a free, well-formed id is kept, otherwise a new one is minted (imports never overwrite). */
  async agentsCustomImport(body: z.infer<typeof S.CustomAgentInputRequest>): Promise<z.infer<typeof S.CustomAgentResponse>> {
    return await this.call("POST", "/api/v1/agents/custom/import", body);
  }

  /** One custom agent — the same document the Export action downloads. */
  async agentsCustomGet(id: string): Promise<z.infer<typeof S.CustomAgentResponse>> {
    return await this.call("GET", `/api/v1/agents/custom/${encodeURIComponent(id)}`);
  }

  /** Update a custom agent (partial merge, same validation); every save bumps `version`. */
  async agentsCustomUpdate(id: string, body: z.infer<typeof S.CustomAgentPatchRequest>): Promise<z.infer<typeof S.CustomAgentResponse>> {
    return await this.call("PATCH", `/api/v1/agents/custom/${encodeURIComponent(id)}`, body);
  }

  /** Delete a custom agent file. */
  async agentsCustomDelete(id: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("DELETE", `/api/v1/agents/custom/${encodeURIComponent(id)}`);
  }

  /** Duplicate a custom agent into a new document. */
  async agentsCustomDuplicate(id: string, body: z.infer<typeof S.CustomAgentDuplicateRequest>): Promise<z.infer<typeof S.CustomAgentResponse>> {
    return await this.call("POST", `/api/v1/agents/custom/${encodeURIComponent(id)}/duplicate`, body);
  }

  /** Compile + lint a canvas graph without saving; returns problems and a graph summary (nodes · tools · human checks). */
  async workflowsInspect(body: z.infer<typeof S.WorkflowInspectRequest>): Promise<z.infer<typeof S.WorkflowInspectResponse>> {
    return await this.call("POST", "/api/v1/workflows/inspect", body);
  }

  /** Recent workflow runs across all definitions. */
  async workflowsRunsList(): Promise<z.infer<typeof S.WorkflowRunListResponse>> {
    return await this.call("GET", "/api/v1/workflows/runs");
  }

  /** A workflow run with per-node states, cost and pending human checks. */
  async workflowsRunsGet(runId: string): Promise<z.infer<typeof S.WorkflowRunResponse>> {
    return await this.call("GET", `/api/v1/workflows/runs/${encodeURIComponent(runId)}`);
  }

  /** Stream a workflow run as Server-Sent Events: buffered replay, then live run_state · node_state · log · cost_update · approval_required · run_end · stream_end. Every event is emitted by the engine as the run advances. (SSE stream — returns the raw Response). */
  async workflowsRunsStream(runId: string): Promise<Response> {
    return await this.raw("GET", `/api/v1/workflows/runs/${encodeURIComponent(runId)}/stream`);
  }

  /** Cancel a run — aborts the in-flight node (model call / tool) and withdraws any parked human check. */
  async workflowsRunsCancel(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>> {
    return await this.call("POST", `/api/v1/workflows/runs/${encodeURIComponent(runId)}/cancel`);
  }

  /** Pause a running workflow after the current node finishes. */
  async workflowsRunsPause(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>> {
    return await this.call("POST", `/api/v1/workflows/runs/${encodeURIComponent(runId)}/pause`);
  }

  /** Resume a paused workflow. */
  async workflowsRunsResume(runId: string): Promise<z.infer<typeof S.WorkflowControlResponse>> {
    return await this.call("POST", `/api/v1/workflows/runs/${encodeURIComponent(runId)}/resume`);
  }

  /** Record a human decision for a parked approval/review node. Goes through the same approval record the Shield modal decides; the engine enforces the node's denial/expiry policy. */
  async workflowsRunsDecide(runId: string, body: z.infer<typeof S.WorkflowDecisionRequest>): Promise<z.infer<typeof S.WorkflowRunResponse>> {
    return await this.call("POST", `/api/v1/workflows/runs/${encodeURIComponent(runId)}/human-decision`, body);
  }

  /** List saved workflows (latest active version each) with a graph summary and the last run. */
  async workflowsList(): Promise<z.infer<typeof S.WorkflowListResponse>> {
    return await this.call("GET", "/api/v1/workflows");
  }

  /** Compile a canvas graph into a canonical WorkflowDefinition, lint it (errors → 422 with per-node problems) and publish version 1 (immutable, content-hashed). */
  async workflowsCreate(body: z.infer<typeof S.WorkflowCreateRequest>): Promise<z.infer<typeof S.WorkflowResponse>> {
    return await this.call("POST", "/api/v1/workflows", body);
  }

  /** A workflow definition (latest or ?version=) with its canvas graph, lint problems and version list. */
  async workflowsGet(id: string): Promise<z.infer<typeof S.WorkflowResponse>> {
    return await this.call("GET", `/api/v1/workflows/${encodeURIComponent(id)}`);
  }

  /** Publish a new immutable version from the canvas graph; `baseVersion` must be the latest (409 otherwise). */
  async workflowsUpdate(id: string, body: z.infer<typeof S.WorkflowUpdateRequest>): Promise<z.infer<typeof S.WorkflowResponse>> {
    return await this.call("PATCH", `/api/v1/workflows/${encodeURIComponent(id)}`, body);
  }

  /** Retire a workflow: every version is marked inactive (runs and history are kept). */
  async workflowsDelete(id: string): Promise<z.infer<typeof S.OkResponse>> {
    return await this.call("DELETE", `/api/v1/workflows/${encodeURIComponent(id)}`);
  }

  /** Start a run of a workflow (latest or a given version) with resolved parameters; at most 3 runs in flight (429 otherwise). Returns the queued run to stream. */
  async workflowsRun(id: string, body: z.infer<typeof S.WorkflowRunStartRequest>): Promise<z.infer<typeof S.WorkflowRunResponse>> {
    return await this.call("POST", `/api/v1/workflows/${encodeURIComponent(id)}/run`, body);
  }

  /** Run history for one workflow definition. */
  async workflowsRunsHistory(id: string): Promise<z.infer<typeof S.WorkflowRunListResponse>> {
    return await this.call("GET", `/api/v1/workflows/${encodeURIComponent(id)}/runs`);
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

  /** Explicitly remember something (user-provenance write). Refused for do-not-remember matches; sensitive content needs acknowledgeSensitive. */
  async memoryCreate(body: z.infer<typeof S.MemoryCreateRequest>): Promise<z.infer<typeof S.MemoryWriteResponse>> {
    return await this.call("POST", "/api/v1/memory", body);
  }

  /** Edit a memory's content, tags, importance or expiry. Exclusion and sensitivity checks apply to edits. */
  async memoryUpdate(id: string, body: z.infer<typeof S.MemoryUpdateRequest>): Promise<z.infer<typeof S.MemoryWriteResponse>> {
    return await this.call("PATCH", `/api/v1/memory/${encodeURIComponent(id)}`, body);
  }

  /** Export this workspace's memory as an xr-memory JSON bundle (includes provenance). */
  async memoryExport(): Promise<Record<string, unknown>> {
    return await this.call("GET", "/api/v1/memory/export");
  }

  /** Import an xr-memory bundle (merge, or replace with acknowledgeReplace). Sensitive entries are skipped, not imported. */
  async memoryImport(body: z.infer<typeof S.MemoryImportRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/memory/import", body);
  }

  /** Heuristic entity graph over memories (people, projects, files, tools). Read-only. */
  async memoryGraph(): Promise<z.infer<typeof S.MemoryGraphResponse>> {
    return await this.call("GET", "/api/v1/memory/graph");
  }

  /** Memory settings. Auto-memory is reported off and cannot be enabled in this version. */
  async memorySettingsGet(): Promise<z.infer<typeof S.MemorySettingsResponse>> {
    return await this.call("GET", "/api/v1/memory/settings");
  }

  /** Update memory settings (show expired). Turning on auto-memory is refused with 409. */
  async memorySettingsPut(body: z.infer<typeof S.MemorySettingsRequest>): Promise<z.infer<typeof S.MemorySettingsResponse>> {
    return await this.call("PUT", "/api/v1/memory/settings", body);
  }

  /** Plan (default) or apply (apply: true) consolidation of old, low-importance memories into a summary. Originals are superseded, not deleted. */
  async memoryConsolidate(body: z.infer<typeof S.MemoryConsolidateRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/memory/consolidate", body);
  }

  /** Scan text for sensitive patterns (card numbers, SSNs, API and private keys) without saving it. */
  async memoryScan(body: z.infer<typeof S.MemoryScanRequest>): Promise<Record<string, unknown>> {
    return await this.call("POST", "/api/v1/memory/scan-sensitive", body);
  }

  /** Delete one memory record by id. */
  async memoryDelete(id: string): Promise<Record<string, unknown>> {
    return await this.call("DELETE", `/api/v1/memory/${encodeURIComponent(id)}`);
  }

  /** List built-in integrations with connection state. Secrets are never included. */
  async integrationsList(): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("GET", "/api/v1/integrations");
  }

  /** Get one integration with its connection state. */
  async integrationsGet(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("GET", `/api/v1/integrations/${encodeURIComponent(id)}`);
  }

  /** Save the OAuth app client ID and secret (BYOK) in the credential vault. */
  async integrationsApp_credentials(id: string, body: z.infer<typeof S.IntegrationAppCredentialsRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("PUT", `/api/v1/integrations/${encodeURIComponent(id)}/app`, body);
  }

  /** Start an OAuth sign-in. Returns the provider authorize URL with PKCE and state. */
  async integrationsOauthStart(id: string): Promise<z.infer<typeof S.IntegrationOAuthStartResponse>> {
    return await this.call("POST", `/api/v1/integrations/${encodeURIComponent(id)}/oauth/start`);
  }

  /** Finish an OAuth sign-in from the xr:// callback. Validates the single-use state and stores tokens in the vault. */
  async integrationsOauthComplete(body: z.infer<typeof S.IntegrationOAuthCompleteRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("POST", "/api/v1/integrations/oauth/complete", body);
  }

  /** Connect an API-key integration. Secrets go to the vault after a successful probe. */
  async integrationsConnect(id: string, body: z.infer<typeof S.IntegrationConnectRequest>): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("POST", `/api/v1/integrations/${encodeURIComponent(id)}/connect`, body);
  }

  /** Run a health probe and refresh the account and last-sync time. Refreshes the token first when needed. */
  async integrationsSync(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("POST", `/api/v1/integrations/${encodeURIComponent(id)}/sync`);
  }

  /** Disconnect: revoke the grant (best effort) and delete the local token. */
  async integrationsDisconnect(id: string): Promise<z.infer<typeof S.IntegrationEnvelope>> {
    return await this.call("POST", `/api/v1/integrations/${encodeURIComponent(id)}/disconnect`);
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
