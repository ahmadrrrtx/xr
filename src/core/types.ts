/**
 * XR — core type definitions
 * The shared vocabulary for the whole agent.
 */

/** Agent operating modes (see PRD F1). */
export type Mode = "agent" | "plan" | "ask";

/** Trust level of a value/step — basis of the Dual-LLM separation (later phase). */
import type { EnvironmentExecutable, TrustRequest } from "../runtime/trust/types.ts";

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

export interface ApprovalRequest {
  tool: string;
  reason: string;
  /** Optional tool arguments for transparent approval prompts. */
  args?: Record<string, unknown>;
  /** A human-readable preview (e.g. a diff). */
  preview?: string;
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

/** What the model returns each turn: either tool calls, or a final answer. */
export interface ModelTurn {
  /** The model's reasoning / message (shown to user). */
  message: string;
  /** Tool calls to execute this turn. Empty = done. */
  toolCalls: ToolCall[];
  /** True when the model considers the task complete. */
  done: boolean;
  /** Token usage for cost accounting (Phase 1). */
  usage?: { inTokens: number; outTokens: number };
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
      status: string;
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
  /** Optional: list known models (for dynamic discovery) */
  listModels?(): Promise<string[]>;
}
