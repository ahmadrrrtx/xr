/**
 * XR — core type definitions
 * The shared vocabulary for the whole agent.
 */

/** Agent operating modes (see PRD F1). */
export type Mode = "agent" | "plan" | "ask";

/** Trust level of a value/step — basis of the Dual-LLM separation (later phase). */
export type Trust = "trusted" | "quarantined";

/** A tool the agent can call. */
export interface Tool {
  name: string;
  description: string;
  /** JSON-schema-ish parameter description for the model. */
  parameters: Record<string, unknown>;
  /** Is this action risky enough to require human approval? */
  requiresApproval: boolean;
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
  /** Dry-run: simulate side effects, never actually write/execute. */
  dryRun?: boolean;
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
export interface Provider {
  id: string;
  label: string;
  /** Run one turn of the loop. Implementations parse tool calls. */
  chat(messages: Message[], tools: Tool[]): Promise<ModelTurn>;
  /** Quick liveness/health check. */
  health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }>;
}
