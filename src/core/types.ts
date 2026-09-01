/**
 * XR — core type definitions
 * The shared vocabulary for the whole agent.
 */

/** Agent operating modes (see PRD F1). */
export type Mode = "agent" | "plan" | "ask";

/** Trust level of a value/step — basis of the Dual-LLM separation (later phase). */
import type { EnvironmentExecutable, TrustRequest } from "../runtime/trust/types.ts";
import type { RunStatus } from "./ux-status.ts";

export type Trust = "trusted" | "quarantined";

/**
 * XR 4.2 — result of running a high-risk command inside an isolated
 * environment via ToolContext.runIsolated. Secret-free; safe to audit/display.
 */
export interface IsolatedRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when the action was BLOCKED (fail closed) rather than executed. */
  blocked: boolean;
  reason?: string;
  /** Phase 4 · T1 — actionable remediation surfaced to the user when blocked. */
  remediation?: string;
  /** Placement actually used (e.g. "namespace_sandbox"). */
  placement?: string;
  /** Whether isolation verification passed before execution. */
  verified?: boolean;
}

/** A tool the agent can call. */
export interface Tool {
  name: string;
  description: string;
  /** JSON-schema-ish parameter description for the model. */
  parameters: Record<string, unknown>;
  /** Is this action risky enough to require human approval? */
  requiresApproval: boolean;
  /**
   * XR 4.2 — declare this tool's objective risk facts so the execution fabric's
   * trust gate can classify and place it. Return undefined to opt out (legacy
   * behavior). Tools that need a real boundary (e.g. shell) isolate via
   * ToolContext.runIsolated; tools that only need classification/recording
   * (reads, in-workspace writes, egress-gated network) return a TrustRequest.
   */
  trustRequest?: (args: Record<string, unknown>, ctx: ToolContext) => TrustRequest | undefined;
  /** Run the tool. May throw; caller handles. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** Working directory the agent is allowed to touch. */
  cwd: string;
  /**
   * Phase 06 — cooperative cancellation for this run, forwarded from the
   * surface's abort handle (Ctrl+C / workflow stop / execution cancel).
   * Tools whose underlying operations support interruption (subprocesses,
   * fetch) MUST observe it; tools that cannot interrupt safely must ignore
   * it and document that limitation — absence of interruption must never be
   * reported as cancellation.
   */
  signal?: AbortSignal;
  /** Ask the human to approve a risky action. Returns true if approved. */
  approve(req: ApprovalRequest): Promise<boolean>;
  /** Append an entry to the tamper-evident audit log. */
  audit(event: string, detail: Record<string, unknown>): void;
  /** Domains the agent may contact (egress allow-list). Empty = none. */
  egressAllowlist?: string[];
  /**
   * Phase 4 · T4 — explicitly permitted raw-IP / loopback destinations
   * (exact host or host:port), consumed by the centralized egress proxy.
   */
  allowedHosts?: readonly string[];
  /** Dry-run: simulate side effects, never actually write/execute. */
  dryRun?: boolean;
  /**
   * XR 4.2 — run a high-risk command inside an isolated environment when the
   * runtime provides a Trust service. ABSENT when no Trust service is wired,
   * in which case tools use their legacy in-process path. Implementations FAIL
   * CLOSED: if required isolation is unavailable they return { blocked: true }
   * rather than executing in the unrestricted host process.
   */
  runIsolated?: (req: TrustRequest, exec: EnvironmentExecutable) => Promise<IsolatedRunResult>;
  /**
   * Phase 4 · T1 — hardened mode (fail-closed). When true, a high-risk tool
   * MUST NOT fall back to host-authority execution when `runIsolated` is
   * absent or blocked — it fails instead. When false/absent, the legacy
   * fallback is permitted but audited as a degraded path.
   */
  hardened?: boolean;
  /**
   * Phase 7 · T1 — optional tool-use recorder. When present, invoked after
   * every tool execution with the outcome so the capability provenance graph
   * can answer "what did the agent use?". Absence disables recording, never
   * execution (kernel stays free of platform imports: this is a plain
   * callback type).
   */
  onToolUse?: (info: { tool: string; ok: boolean; error?: string }) => void;
}

/** Phase 2 · F-26 — structured preview kind (canonical in core so the kernel
 *  never imports the control layer; control/preview.ts re-exports). */
export type PreviewKind = "diff" | "new-file" | "file-delete" | "command" | "generic";

/** One section of a structured approval preview. */
export interface PreviewSection {
  title: string;
  body: string;
  kind: "code" | "text" | "table";
  /** Set when the body was truncated for display safety. */
  truncated?: boolean;
}

/**
 * Phase 2 · F-26 — structured approval preview (diff / interpreted command /
 * redacted args). Canonical shape lives HERE (kernel layer) so every layer
 * can reference it without upward imports; the renderers in control/preview.ts
 * produce it and re-export the type for convenience.
 */
export interface StructuredPreview {
  kind: PreviewKind;
  tool: string;
  riskTier: string;
  /**
   * Model-shaped reason text. UNTRUSTED DATA — framed in the UI, never
   * authoritative. Deliberately a separate field from the structured
   * sections so a prompt-injection attempt cannot replace the facts.
   */
  untrustedReason: string;
  sections: PreviewSection[];
}

export interface ApprovalRequest {
  tool: string;
  reason: string;
  /** Optional tool arguments for transparent approval prompts. */
  args?: Record<string, unknown>;
  /** A human-readable preview (e.g. a diff). */
  preview?: string;
  /**
   * Phase 2 · F-26 — structured preview. When present, surfaces render THIS
   * instead of raw text; `reason` stays visible but framed as untrusted
   * model text.
   */
  structuredPreview?: StructuredPreview;
  /** Phase 2 · F-11 — durable-approval identity fields (additive). */
  riskTier?: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
}

export interface ToolResult {
  ok: boolean;
  /** Short text result fed back to the model. */
  output: string;
  /** Optional structured data. */
  data?: unknown;
}

/** A single tool call the model wants to make. */
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * What the model returns each turn: either tool calls, a final answer, or an
 * explicit honest error — NEVER a silent empty "done" (Phase 1 · Turn Contract).
 *
 * A turn is `content | tool_calls | error`. A turn that is none of those
 * (empty or undecodable) carries `status` empty/undecodable and `done:false`;
 * the agent loop converts it to `stopped:"error"` with an audited
 * `turn.empty` / `turn.undecodable` event. `done:true` is only ever set from a
 * model-declared completion (the envelope's `done:true`, or a native
 * `finish_reason` of "stop"), never inferred from an empty tool-call list.
 */
export interface ModelTurn {
  /** The model's reasoning / message (shown to user). May be empty only if tool_calls or error are present. */
  message: string;
  /** Tool calls to execute this turn. Empty is not itself "done". */
  toolCalls: ToolCall[];
  /** True only when the model declared the task complete. */
  done: boolean;
  /**
   * Explicit model/transport error (Phase 1). When set, the loop ends
   * `stopped:"error"` and never reports a fake completion.
   */
  error?: string;
  /** Parse classification. `empty` ⇒ no content arrived; `undecodable` ⇒ content was not a valid turn. */
  status?: "parsed" | "empty" | "undecodable";
  /** Token usage for cost accounting (Phase 1). */
  usage?: { inTokens: number; outTokens: number };
  /** Whether `usage` was provider-reported or estimated (cost honesty, F-13). */
  usageSource?: "provider" | "estimated";
}

/**
 * Declared transport capabilities for a provider instance (resolver-owned).
 * The agent loop reads these to honor the capability catalog on the hot path
 * (Phase 1): `streaming:false` ⇒ call `chat()`; `functionCalling` ⇒ native
 * OpenAI `tools`; `toolUse:false` ⇒ envelope protocol only.
 */
export interface ProviderCapabilitiesFlags {
  streaming: boolean;
  toolUse: boolean;
  functionCalling: boolean;
  jsonMode: boolean;
}

/** A chat message in the running conversation. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For tool messages, which tool produced this. */
  name?: string;
}

/** Abstraction over any LLM provider (BYOK or local). */
/**
 * Per-request controls for a model call (audit GAP-001 · P0).
 *
 * Optional so every existing call site keeps compiling and behaving; adapters
 * apply a bounded default when it is omitted, so a call is never unbounded.
 */
export interface ChatOptions {
  /** Caller cancellation — reaches the socket, not just the loop checkpoints. */
  signal?: AbortSignal;
  /** Per-request ceiling in ms. Defaults to the configured provider timeout. */
  timeoutMs?: number;
}

/**
 * XR Phase 04 — Provider Streaming chunk (normalized)
 */
export interface ProviderStreamChunk {
  text?: string;
  toolCall?: { tool: string; args: Record<string, unknown> };
  usage?: { inTokens: number; outTokens: number };
  finish?: boolean;
  reasoning?: string;
  model?: string;
  providerId?: string;
}

/**
 * XR Phase 05 — the CANONICAL chat streaming event contract.
 *
 * Every surface (dashboard, CLI, TUI, API) that streams a chat generation
 * consumes ONE of these events. There is exactly one definition: the agent
 * loop (AgentDeps.onStreamEvent) produces them, the execution fabric forwards
 * them, and the HTTP edge serializes them to SSE. Nothing re-declares the
 * shape elsewhere.
 *
 * Compatibility: the legacy SSE shape `{ text?, done?, error? }` (emitted via
 * the route's observation `say` hook) remains intact for consumers that
 * predate Phase 05. The typed events below are ADDs to the stream contract.
 */
export type ChatStreamEvent =
  | {
      type: "status";
      /**
       * Phase 12 · Phase C — a canonical run status from the single shared
       * vocabulary in `src/core/ux-status.ts`.
       *
       * This used to be an unconstrained `string`, which is why the three
       * surfaces drifted: the loop emitted three ad-hoc values, the Shell
       * invented its own labels, and the Control Center ignored all but two.
       * Narrowing it here makes a typo'd or invented status a compile error, so
       * every surface necessarily renders the same vocabulary.
       *
       * The WIRE contract stays permissive on purpose (`ChatStreamEvent` in
       * `src/daemon/routes/schemas.ts` is a loose object with `status:
       * z.string()`), because pre-Phase-05 consumers and resumed streams may
       * carry older labels. `runStatusLabel()` humanises anything unknown
       * rather than dropping it — so tightening the type costs no
       * compatibility.
       */
      status: RunStatus;
      /** Provider id once resolved (e.g. "provider_selection"/"provider_ready"). */
      provider?: string;
      model?: string;
      message?: string;
      runId?: string;
    }
  | { type: "token"; text: string }
  | {
      type: "tool_call";
      id: string;
      tool: string;
      args: unknown;
    }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      ok: boolean;
      result?: string;
      error?: string;
    }
  | {
      type: "usage";
      usage: { inTokens: number; outTokens: number };
    }
  | {
      type: "done";
      fullText: string;
      usage?: { inTokens: number; outTokens: number };
      finishReason?: string;
      steps: number;
      ttftMs?: number;
      totalMs?: number;
    }
  | {
      type: "error";
      code: string;
      message: string;
      retryable?: boolean;
      detail?: string;
    };

/** Callback a surface supplies to receive canonical streaming events. */
export type StreamEventSink = (event: ChatStreamEvent) => void;

export interface Provider {
  id: string;
  label: string;
  /** Run one turn of the loop. Implementations parse tool calls. */
  chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn>;
  /** Optional streaming variant: yields normalized chunks */
  chatStream?(
    messages: Message[],
    tools: Tool[],
    options?: ChatOptions,
  ): AsyncGenerator<ProviderStreamChunk>;
  /** Quick liveness/health check. */
  health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }>;
  /** Optional: get model id for this provider instance */
  modelId?: string;
  /**
   * Declared transport capabilities for this instance (resolver-owned, Phase 1).
   * Absent ⇒ caller must default conservatively (envelope mode, streaming only
   * when the transport actually exposes `chatStream` and is confirmed capable).
   */
  capabilities?: ProviderCapabilitiesFlags;
  /** Optional: list known models (for dynamic discovery) */
  listModels?(): Promise<string[]>;
}
