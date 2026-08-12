/**
 * XR 3.1 — Chat Message System
 *
 * Defines message types, rendering, and streaming support for the main chat.
 *
 * Message types:
 * - user: User's input
 * - assistant: XR's response (streaming + final)
 * - tool: Tool execution display
 * - agent: Multi-agent communication
 * - system: Status, notices, info
 * - error: Error display with recovery
 *
 * Spec: XR_DESIGN_SYSTEM.md §9.8
 */

import { xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, xrViolet } from "../../ui/theme.ts";
import { A } from "../../ui/theme.ts";
import { padAnsi, clipAnsi, wrapAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";

// ── Message Types ─────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "tool" | "agent" | "system" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  meta?: string;       // "live" | "XR" | tool name | error code | etc.
  timestamp: number;
  status?: "pending" | "running" | "success" | "error" | "cancelled";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  progress?: number;   // 0-100 for determinate progress
}

// ── Message Prefixes ──────────────────────────────────────────────────────────

const PREFIXES: Record<MessageRole, string> = {
  user:     "You",
  assistant: "XR",
  tool:     "Tool",
  agent:    "Agent",
  system:   "System",
  error:    "Error",
};

// ── Message Rendering ─────────────────────────────────────────────────────────

/**
 * Render a message header (role + timestamp + meta)
 */
export function renderMessageHeader(msg: ChatMessage, avatarState: AvatarState, width: number): string {
  const roleColor = {
    user: xrCyan,
    assistant: xrViolet,
    tool: xrAmber,
    agent: xrGreen,
    system: xrDim,
    error: xrRed,
  }[msg.role];

  const rolePrefix = PREFIXES[msg.role];
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let meta = "";
  if (msg.meta) {
    meta = msg.meta === "live" ? ` ${xrDim("· streaming")}` : ` ${xrDim(`· ${msg.meta}`)}`;
  }

  // Avatar for XR messages
  const avatar = msg.role === "assistant" ? ` ${renderCompactAvatar(avatarState, "XR")}` : "";

  return clipAnsi(
    `${roleColor(`${avatar} ${rolePrefix}:`)}  ${xrDim(time)}${meta}`,
    width,
  );
}

/**
 * Render message content with appropriate styling
 */
export function renderMessageContent(msg: ChatMessage, width: number): string[] {
  const lines: string[] = [];
  const usable = Math.max(20, width - 4);
  const wrapped = wrapAnsi(msg.content, usable);

  if (msg.role === "tool") {
    // Tool execution display
    lines.push(...renderToolMessage(msg, usable));
  } else if (msg.role === "error") {
    // Error display with recovery suggestion
    lines.push(...renderErrorMessage(msg, usable));
  } else if (msg.role === "system") {
    // System message with icon
    lines.push(...renderSystemMessage(msg, usable));
  } else {
    // Regular text message
    for (const line of wrapped) {
      lines.push(`  ${line}`);
    }
  }

  return lines;
}

/**
 * Render tool execution message
 */
function renderToolMessage(msg: ChatMessage, width: number): string[] {
  const lines: string[] = [];
  const statusIcon = {
    pending: "○",
    running: "⟳",
    success: "✓",
    error: "✗",
    cancelled: "⊘",
  }[msg.status ?? "pending"];

  const statusColor = {
    pending: xrDim,
    running: xrCyan,
    success: xrGreen,
    error: xrRed,
    cancelled: xrAmber,
  }[msg.status ?? "pending"];

  // Tool header
  const toolName = msg.toolName ?? msg.meta ?? "unknown";
  lines.push(`  ${xrBold(toolName)} ${statusColor(statusIcon)} ${statusColor(msg.status?.toLowerCase() ?? "pending")}`);

  // Tool args (truncated)
  if (msg.toolArgs && Object.keys(msg.toolArgs).length > 0) {
    const argsStr = JSON.stringify(msg.toolArgs);
    const preview = argsStr.length > 80 ? argsStr.slice(0, 80) + "..." : argsStr;
    lines.push(`  ${xrDim(preview)}`);
  }

  // Progress bar for running tools
  if (msg.status === "running" && msg.progress !== undefined) {
    const barWidth = Math.max(10, Math.min(40, width - 16));
    const filled = Math.round((msg.progress / 100) * barWidth);
    const bar = "█".repeat(filled) + "─".repeat(barWidth - filled);
    lines.push(`  ${xrDim(bar)} ${msg.progress}%`);
  }

  // Tool result
  if (msg.toolResult) {
    lines.push("");
    const resultLines = wrapAnsi(msg.toolResult, width - 6);
    for (const line of resultLines.slice(0, 10)) {
      lines.push(`  ${xrDim(line)}`);
    }
    if (resultLines.length > 10) {
      lines.push(`  ${xrDim("... (truncated)")}`);
    }
  }

  lines.push("");
  return lines;
}

/**
 * Render error message with recovery suggestion
 */
function renderErrorMessage(msg: ChatMessage, width: number): string[] {
  const lines: string[] = [];

  // Error header
  lines.push(`  ${xrRed("✗")} ${xrBold("Error")}: ${msg.content}`);

  // Error details
  if (msg.toolName) {
    lines.push(`  ${xrDim("Tool:")} ${msg.toolName}`);
  }

  // Recovery suggestion
  if (msg.meta && msg.meta !== "live") {
    lines.push("");
    const recovery = getRecoverySuggestion(msg.meta);
    if (recovery) {
      lines.push(`  ${xrAmber("!")} ${recovery.title}`);
      for (const suggestion of recovery.suggestions) {
        lines.push(`  ${xrCyan("›")} ${suggestion}`);
      }
    }
  }

  lines.push("");
  return lines;
}

/**
 * Render system message (status, notices)
 */
function renderSystemMessage(msg: ChatMessage, width: number): string[] {
  const lines: string[] = [];

  const icon = msg.meta === "info" ? "·"
    : msg.meta === "success" ? "✓"
    : msg.meta === "warning" ? "!"
    : msg.meta === "error" ? "✗"
    : "·";

  const color = {
    info: xrCyan,
    success: xrGreen,
    warning: xrAmber,
    error: xrRed,
  }[msg.meta as keyof typeof color] ?? xrDim;

  lines.push(`  ${color(icon)} ${msg.content}`);
  lines.push("");

  return lines;
}

/**
 * Get recovery suggestion for error codes
 */
function getRecoverySuggestion(errorMeta: string): { title: string; suggestions: string[] } | null {
  const suggestions: Record<string, { title: string; suggestions: string[] }> = {
    "api_key_invalid": {
      title: "Your API key may be invalid or expired",
      suggestions: [
        "Check your API key at the provider's dashboard",
        "Run: xr providers add <provider>",
        "Try a different provider: Alt+P",
      ],
    },
    "provider_unreachable": {
      title: "The provider cannot be reached",
      suggestions: [
        "Check your internet connection",
        "The provider may be down — try again later",
        "Switch to a local model if available: xr models list",
        "Try a different provider: Alt+P",
      ],
    },
    "rate_limit": {
      title: "You've hit a rate limit",
      suggestions: [
        "Wait a moment and try again",
        "Consider a higher rate limit plan with the provider",
        "Switch to a local model: Alt+P",
      ],
    },
    "budget_exceeded": {
      title: "Task budget has been reached",
      suggestions: [
        "Increase the per-task budget in Settings → Spending",
        "Continue with a lower-budget task",
        "Use a local model to avoid per-token costs",
      ],
    },
    "model_not_found": {
      title: "The requested model is not available",
      suggestions: [
        "Check the model name spelling",
        "List available models: xr models list",
        "Choose a different model: Alt+P",
      ],
    },
    "tool_denied": {
      title: "A tool execution was denied",
      suggestions: [
        "Approve the action if it's safe: check the approval prompt",
        "Adjust permissions in Settings → Security",
        "Try a different approach that needs fewer permissions",
      ],
    },
    "timeout": {
      title: "The operation timed out",
      suggestions: [
        "Try again — the network may have been slow",
        "Use a faster model or provider",
        "Try offline/local mode if available",
      ],
    },
    "permission_denied": {
      title: "XR doesn't have permission to do this",
      suggestions: [
        "Check Settings → Permissions",
        "Run XR with appropriate permissions",
        "Try a different approach",
      ],
    },
  };

  return suggestions[errorMeta] ?? null;
}

// ── Streaming Support ──────────────────────────────────────────────────────────

/**
 * Create a streaming message (in-progress)
 */
export function createStreamingMessage(role: "assistant" | "tool", content: string = ""): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    meta: "live",
    timestamp: Date.now(),
    status: "running",
  };
}

/**
 * Update streaming message content
 */
export function updateStreamingMessage(msg: ChatMessage, content: string): ChatMessage {
  return {
    ...msg,
    content,
    timestamp: Date.now(),
  };
}

/**
 * Finalize streaming message
 */
export function finalizeMessage(msg: ChatMessage, status: "success" | "error" | "cancelled" = "success"): ChatMessage {
  return {
    ...msg,
    meta: status === "success" ? "XR" : status === "error" ? "error" : "cancelled",
    status,
    timestamp: Date.now(),
  };
}

// ── Tool Execution Helpers ─────────────────────────────────────────────────────

/**
 * Start a tool execution message
 */
export function startToolExecution(toolName: string, args: Record<string, unknown> = {}): ChatMessage {
  return {
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role: "tool",
    content: `Executing ${toolName}...`,
    meta: "tool",
    toolName,
    toolArgs: args,
    timestamp: Date.now(),
    status: "running",
    progress: 0,
  };
}

/**
 * Update tool progress
 */
export function updateToolProgress(msg: ChatMessage, progress: number): ChatMessage {
  return {
    ...msg,
    progress,
    content: progress < 100 ? `Executing ${msg.toolName}... ${progress}%` : `Executing ${msg.toolName}... done`,
    timestamp: Date.now(),
  };
}

/**
 * Complete tool execution
 */
export function completeToolExecution(msg: ChatMessage, result: string, success = true): ChatMessage {
  return {
    ...msg,
    status: success ? "success" : "error",
    toolResult: result,
    content: success ? `✓ ${msg.toolName} completed` : `✗ ${msg.toolName} failed`,
    timestamp: Date.now(),
  };
}

// ── Avatar-aware Rendering ─────────────────────────────────────────────────────

/**
 * Render a complete chat message with avatar context
 */
export function renderChatMessage(msg: ChatMessage, avatarState: AvatarState, width: number): string[] {
  const result: string[] = [];

  // Header
  result.push(renderMessageHeader(msg, avatarState, width));

  // Content
  const contentLines = renderMessageContent(msg, width);
  result.push(...contentLines);

  return result;
}

/**
 * Render a chat message bubble (for web dashboard)
 * Returns CSS class names and content structure
 */
export function getChatMessageBubbleClass(msg: ChatMessage): string {
  const base = "xr-message";
  const roleClass = msg.role === "user" ? "user" : "assistant";
  const statusClass = msg.status ? `has-status-${msg.status}` : "";

  return `${base} ${roleClass} ${statusClass}`.trim();
}

/**
 * Get avatar emoji for message role (web use)
 */
export function getMessageAvatar(msg: ChatMessage): string {
  if (msg.role === "user") return "👤";
  if (msg.role === "assistant") return "◉";  // XR avatar
  if (msg.role === "tool") return "⚙";
  if (msg.role === "agent") return "🤖";
  if (msg.role === "system") return "●";
  if (msg.role === "error") return "!";
  return "?";
}

// ── Conversation Analysis ──────────────────────────────────────────────────────

/**
 * Get message count by role
 */
export function countMessagesByRole(messages: ChatMessage[]): Record<MessageRole, number> {
  const counts: Record<MessageRole, number> = {
    user: 0,
    assistant: 0,
    tool: 0,
    agent: 0,
    system: 0,
    error: 0,
  };

  for (const msg of messages) {
    counts[msg.role]++;
  }

  return counts;
}

/**
 * Get conversation summary
 */
export function summarizeConversation(messages: ChatMessage[]): {
  totalMessages: number;
  userMessages: number;
  xrMessages: number;
  toolCalls: number;
  errors: number;
  lastActivity: number;
} {
  const counts = countMessagesByRole(messages);

  return {
    totalMessages: messages.length,
    userMessages: counts.user,
    xrMessages: counts.assistant,
    toolCalls: counts.tool,
    errors: counts.error,
    lastActivity: messages.length > 0 ? messages[messages.length - 1].timestamp : 0,
  };
}
