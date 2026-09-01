/**
 * XR Daemon API v1 — contract schemas (Phase 8 · T1).
 *
 * Single source of truth for request/response *shapes* on the daemon API.
 * These are zod/v4 schemas: they drive
 *
 *   1. runtime request validation (fail-closed 400 problem+json),
 *   2. OpenAPI 3.1 / JSON-Schema generation (z.toJSONSchema),
 *   3. typed-client inference (`z.infer`).
 *
 * Compatibility rule (docs/api/COMPATIBILITY.md): a schema NEVER narrows what
 * the handler already accepts — `looseObject` so historically-tolerated
 * unknown keys keep working. Field-level optional/required mirrors the
 * handler's own semantic checks (those handlers still run: schema validation
 * is an additional, contract-stating envelope, not a behavior change).
 */

import { z } from "zod/v4";

// ── Shared primitives ────────────────────────────────────────────────────────

/** Every error body carries `error` (legacy) plus problem+json-style fields. */
export const ApiError = z.looseObject({
  error: z.string().describe("Legacy error message (kept for compatibility)."),
  title: z.string().optional().describe("Short problem type label (RFC 9457 style)."),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  errors: z.array(z.looseObject({ path: z.string(), message: z.string() })).optional()
    .describe("Schema validation issues, when the failure is a bad request body."),
});
export type ApiError = z.infer<typeof ApiError>;

export const OkResponse = z.looseObject({ ok: z.boolean() });

/** Free-form JSON object response (envelope stable = always an object). */
export const ObjectResponse = z.looseObject({});

// ── Phase 2 · F-11 — durable approvals ───────────────────────────────────────

export const ApprovalDecisionRequest = z.looseObject({
  approved: z.boolean().describe("True = approve the pending action; false = deny."),
  userId: z.string().optional().describe("Optional operator identity recorded in the audit."),
});

export const ApprovalsListResponse = z.looseObject({
  pending: z.array(
    z.looseObject({
      id: z.string(),
      taskId: z.string().nullable(),
      runId: z.string().nullable(),
      sessionId: z.string().nullable(),
      tool: z.string(),
      argsHash: z.string(),
      reason: z.string().describe("Model-shaped reason text — untrusted, framed as data."),
      preview: z.unknown().nullable().describe("Structured preview (diff / interpreted command / redacted args)."),
      riskTier: z.string(),
      surface: z.string(),
      requestedAt: z.number(),
      ttlMs: z.number(),
      expiresAt: z.number(),
    }),
  ),
});

// ── Onboarding (Phase B · B-1) ───────────────────────────────────────────────

export const OnboardingStatusResponse = z.looseObject({
  needsSetup: z.boolean().describe("True when this install has no working route yet (no provider key and no running local model)."),
  reasons: z.array(z.string()).describe("Plain-language reasons, for the GUI's honest 'why'."),
  cloud: z.looseObject({
    configured: z.number().describe("Hosted providers with a stored key."),
    ready: z.number().describe("Configured providers whose health probe succeeded."),
    count: z.number().describe("Total hosted provider presets."),
  }),
  local: z.looseObject({
    runtime: z.string().describe("Active local runtime id (e.g. ollama)."),
    healthy: z.boolean(),
    running: z.boolean(),
    installed: z.number().describe("Installed local model count."),
  }),
  internet: z.boolean().describe("Best-effort reachability probe (never blocks the response)."),
  config: z.looseObject({
    provider: z.string(),
    model: z.string(),
    memory: z.boolean(),
    voice: z.boolean(),
    approval: z.boolean(),
  }),
});

export const OnboardingProviderRequest = z.looseObject({
  providerId: z.string().min(1).max(80).describe("Hosted provider preset id (from /api/providers)."),
  apiKey: z.string().min(1).max(2048).describe("Provider API key — stored in the OS keychain or sealed file, never returned."),
  model: z.string().max(200).optional().describe("Optional default model for this provider."),
  probe: z.boolean().optional().describe("Run a live health probe after saving (default true; the save itself never fails on probe outcome)."),
});

export const OnboardingProviderResponse = z.looseObject({
  ok: z.boolean(),
  provider: z.string(),
  model: z.string(),
  secretBackend: z.string().describe("Where the key was stored (keychain or sealed file)."),
  health: z.nullable(z.looseObject({ ok: z.boolean(), detail: z.nullable(z.string()), latencyMs: z.nullable(z.number()) }))
    .describe("Advisory live probe result — the key is saved regardless."),
});

export const OnboardingCompleteRequest = z.looseObject({});

// ── Workspace files (Phase G · G-1/G-2; experimental surface) ───────────────

export const FilesListResponse = z.looseObject({
  root: z.string().describe("Absolute project root being browsed (process.cwd())."),
  cwd: z.string().describe("Relative path currently listed ('' = root)."),
  entries: z.array(z.looseObject({
    name: z.string(),
    rel: z.string().describe("Path relative to root ('' = root itself)."),
    type: z.enum(["file", "dir"]),
    size: z.number().describe("Bytes; 0 for directories."),
    mtime: z.number().describe("Last-modified epoch ms."),
    git: z.nullable(z.enum(["clean", "modified", "staged", "untracked", "added", "deleted"])).describe("Per-file git status from the real porcelain output; null when not a git repo."),
    isText: z.boolean().optional().describe("Best-effort text detection for files."),
  })),
  git: z.looseObject({ branch: z.nullable(z.string()), dirty: z.boolean() }).optional()
    .describe("Repository-level status from gitSummary (cwd)."),
  truncated: z.boolean().describe("True when the entry list was capped for safety."),
});

export const FilesReadRequest = z.looseObject({
  path: z.string().max(2000).describe("Path relative to the project root."),
});

export const FilesReadResponse = z.looseObject({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  truncated: z.boolean().describe("True when the file was capped at the read limit."),
  isText: z.boolean(),
});

export const FilesDiffRequest = z.looseObject({
  path: z.string().max(2000).describe("Path relative to the project root (must be inside)."),
});

export const FilesDiffResponse = z.looseObject({
  path: z.string(),
  diff: z.string().describe("Real `git diff -- <path>` output; empty for untracked files."),
  ok: z.boolean(),
  tracked: z.boolean(),
});



const chatRole = z.enum(["system", "user", "assistant", "tool"]);

// ── Requests ─────────────────────────────────────────────────────────────────

export const ChatStreamRequest = z.looseObject({
  message: z.string().min(1),
  history: z.array(z.looseObject({ role: chatRole, content: z.string() })).optional()
    .describe("Trailing conversation history (last ≤10 turns are used)."),
});

export const BudgetSetRequest = z.looseObject({
  perTaskUsd: z.number().nonnegative().optional(),
  monthlyCap: z.number().nonnegative().optional(),
  dailyCap: z.number().nonnegative().nullable().optional(),
  warningsEnabled: z.boolean().optional(),
});

export const ProviderSetRequest = z.looseObject({
  provider: z.string().optional(),
  model: z.string().optional(),
  fallbackProvider: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
});

export const WorkspaceCreateRequest = z.looseObject({
  id: z.string().optional().describe("Workspace id, /^[a-z0-9_-]+$/i."),
  name: z.string().optional(),
});

export const WorkspaceSwitchRequest = z.looseObject({
  id: z.string().optional(),
});

export const LocalRouting = z.enum(["local-only", "hybrid", "cloud-first"]);

export const ModelsSelectRequest = z.looseObject({
  runtime: z.string().optional().describe("Local runtime id (e.g. ollama, lmstudio)."),
  model: z.string().optional(),
  routing: LocalRouting.optional(),
});

export const ModelsTestRequest = z.looseObject({
  runtime: z.string().optional(),
  model: z.string().optional(),
});

export const ControlApproveRequest = z.looseObject({
  id: z.string().min(1),
  approved: z.boolean(),
});

export const ControlPlanRequest = z.looseObject({
  task: z.string().min(1),
  noMemory: z.boolean().optional(),
});

export const EnvironmentCloseRequest = z.looseObject({
  sessionId: z.string().min(1),
});

export const ShieldExplainRequest = z.looseObject({
  id: z.string().min(1).describe("Finding/threat id to explain."),
});

export const ShieldQuarantineRequest = z.looseObject({
  action: z.enum(["isolate", "restore", "delete"]),
  id: z.string().min(1),
  threat: z.unknown().optional()
    .describe("Threat snapshot used by `isolate` (structural; content stays local)."),
});

export const ShieldWhitelistRequest = z.looseObject({
  action: z.enum(["add", "remove"]),
  type: z.string().min(1).describe("Entry class (e.g. process, path, signer, domain)."),
  value: z.string().min(1),
});

export const ShieldAdblockRequest = z.looseObject({
  enable: z.boolean(),
});

/** Accepts a full TrustRequest or the shorthand {cmd, cwd} (see route docs). */
export const TrustClassifyRequest = z.looseObject({
  cmd: z.string().optional(),
  cwd: z.string().optional(),
  kind: z.string().optional(),
  risk: z.string().optional(),
});

export const CapabilityIdRequest = z.looseObject({
  id: z.string().optional().describe("Capability descriptor id."),
});

export const BusinessJourneyStartRequest = z.looseObject({
  orgId: z.string().optional(),
  workspaceId: z.string().optional(),
  input: z.unknown().optional(),
});

export const BusinessApprovalDecisionRequest = z.looseObject({
  decision: z.string().optional().describe("approve | reject (module-defined vocabulary)."),
  note: z.string().optional(),
});

export const MemorySearchQuery = z.looseObject({
  query: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/** Context undo (Phase 8 · T4): undo the most recent, or an explicit, mutation. */
export const ContextUndoRequest = z.looseObject({
  id: z.string().optional().describe("Undo-ledger entry id; defaults to the latest mutation."),
});

export const ContextUndoOutcome = z.looseObject({
  ok: z.boolean(),
  undoneOpId: z.string().optional().describe("The mutation op that was undone."),
  undoOpId: z.string().optional().describe("Append-only ledger id of the undo op itself (evidence)."),
  restoredTarget: z.looseObject({ table: z.string(), id: z.string() }).optional(),
  reason: z.string().optional(),
});

// ── Responses (precise where the shape is small and stable) ─────────────────

export const VersionInfo = z.looseObject({
  name: z.string(),
  version: z.string(),
  codename: z.string().optional(),
  schema: z.number().int().optional(),
});

export const HealthResponse = z.looseObject({
  ok: z.literal(true),
  name: z.string(),
  version: VersionInfo,
  host: z.string(),
  binding: z.string(),
  auth: z.string(),
  ts: z.number(),
});

/** Chat SSE events (streamed as `data: <json>\n\n`, terminated by [DONE]). */
/**
 * Chat SSE events (streamed as `data: <json>\n\n`, terminated by [DONE]).
 * Phase 05 — the canonical streaming event contract. Every event carries a
 * monotonic `event_id` and a `type` discriminator; the legacy fields (`text`,
 * `done`, `error`, `finalMessage`, `cancelled`) are retained so pre-Phase-05
 * consumers keep working. Fields are optional/loose so this stays additive.
 */
export const ChatStreamEvent = z.looseObject({
  event_id: z.number().int().positive().optional().describe("Monotonic per-stream sequence (ordering/resume foundation)."),
  type: z.enum(["status", "token", "tool_call", "tool_result", "usage", "done", "error"]).optional().describe("Canonical event discriminator."),
  status: z.string().optional().describe("Status label (provider_selection, provider_ready, cancelled, ...)."),
  text: z.string().optional().describe("Legacy observation line (via say)."),
  token: z.string().optional().describe("Token delta text for type=token."),
  tool: z.string().optional().describe("Tool id for type=tool_call/tool_result."),
  id: z.string().optional().describe("Tool call id correlating tool_call and tool_result."),
  args: z.unknown().optional().describe("Tool arguments for type=tool_call."),
  ok: z.boolean().optional().describe("Tool success for type=tool_result."),
  result: z.string().optional().describe("Tool output for type=tool_result."),
  usage: z.looseObject({ inTokens: z.number().optional(), outTokens: z.number().optional() }).optional(),
  fullText: z.string().optional().describe("Final generated text (backward-compatible final result)."),
  finishReason: z.string().optional().describe("Loop stop reason (done|error|budget|max_steps|approval|cancelled)."),
  ttftMs: z.number().optional().describe("Time to first token, ms."),
  totalMs: z.number().optional().describe("Total generation duration, ms."),
  code: z.string().optional().describe("Structured error code for type=error."),
  message: z.string().optional().describe("Human-readable message for type=error/status."),
  retryable: z.boolean().optional().describe("Whether the error may be retried."),
  done: z.boolean().optional().describe("Legacy terminal flag."),
  finalMessage: z.string().optional().describe("Legacy terminal full text."),
  stopped: z.string().optional().describe("Legacy stop reason."),
  cancelled: z.boolean().optional().describe("Legacy cancellation flag."),
  error: z.string().optional().describe("Legacy error message."),
});

export const AgentSummary = z.looseObject({ id: z.string(), name: z.string() });

export const ProblemExample = z.looseObject({
  error: z.string(),
});

// ── Phase 10 · research operations ───────────────────────────────────────────

export const ResearchOperationRequest = z.looseObject({
  query: z.string().max(2000).optional().describe("Search query (search intent)."),
  url: z.string().max(2048).optional().describe("Target URL (scrape/map/crawl intent)."),
  urls: z.array(z.string().max(2048)).max(64).optional().describe("Target URLs (extract intent)."),
  schema: z.looseObject({}).optional().describe("JSON schema for structured extraction."),
  depth: z.enum(["quick", "deep"]).optional(),
  max_pages: z.number().int().min(1).max(500).optional().describe("Page cap override."),
  max_depth: z.number().int().min(0).max(10).optional().describe("Depth cap override."),
});
export type ResearchOperationRequest = z.infer<typeof ResearchOperationRequest>;

export const ResearchJobResponse = z.looseObject({
  job: z.looseObject({
    id: z.string(),
    kind: z.string(),
    state: z.string(),
    provider: z.string().optional(),
    sources: z.array(z.looseObject({})).optional(),
    citations: z.array(z.looseObject({})).optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  }),
});
export type ResearchJobResponse = z.infer<typeof ResearchJobResponse>;

export const ResearchJobsListResponse = z.looseObject({
  jobs: z.array(z.looseObject({ id: z.string(), kind: z.string(), state: z.string() })),
  count: z.number().int(),
});
