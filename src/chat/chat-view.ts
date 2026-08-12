/**
 * XR 3.1 — Chat View Renderer
 *
 * Renders the main chat interface with avatar integration,
 * streaming support, and tool execution visualization.
 */

import { xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, xrViolet } from "../../ui/theme.ts";
import { wrapAnsi, clipAnsi, hline } from "../../ui/ansi.ts";
import { renderCompactAvatar, renderHeaderAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";
import type { ChatMessage, MessageRole } from "./messages.ts";
import { PREFIXES, renderMessageHeader, renderMessageContent } from "./messages.ts";

export interface ChatViewOptions {
  width: number;
  height: number;
  messages: ChatMessage[];
  sessionTitle: string;
  mode: string;
  avatarState: AvatarState;
  busy: boolean;
  busyLabel: string;
  showAvatar: boolean;
}

/**
 * Render the complete chat view
 */
export function renderChatView(options: ChatViewOptions): string[] {
  const {
    width,
    height,
    messages,
    sessionTitle,
    mode,
    avatarState,
    busy,
    busyLabel,
    showAvatar,
  } = options;

  const lines: string[] = [];

  // Header with avatar
  if (showAvatar && avatarState !== "idle") {
    const avatarLines = renderHeaderAvatar(avatarState);
    lines.push(clipAnsi(
      `${avatarLines[0]}  ${xrBold("Chat")}`,
      width,
    ));
    lines.push(clipAnsi(
      `${avatarLines[1]}  ${xrDim(sessionTitle || "new session")}  ${xrDim("·")}  ${xrDim(mode)}`,
      width,
    ));
    lines.push(clipAnsi(
      `${avatarLines[2]}  ${renderCompactAvatar(avatarState, avatarStateLabel(avatarState))}`,
      width,
    ));
  } else {
    lines.push(clipAnsi(
      `${xrBold("Chat")}${xrDim(" · ")}${sessionTitle || "new session"}${xrDim(" · ")}${mode}`,
      width,
    ));
  }

  lines.push(xrDim(hline(Math.max(10, width - 2))));

  // Messages
  const visibleHeight = height - 5; // Reserve space for header, composer, status
  const messageLines = renderMessages({
    messages,
    width,
    avatarState,
    maxLines: visibleHeight,
  });

  lines.push(...messageLines);

  // Bottom status (when busy)
  if (busy || avatarState !== "idle") {
    const statusY = Math.max(0, height - 3);
    while (lines.length < statusY) {
      lines.push("");
    }
    lines.push(clipAnsi(
      `${renderCompactAvatar(avatarState, "")} ${xrDim(busyLabel || avatarStateLabel(avatarState))}`,
      width,
    ));
  }

  // Fill remaining space
  while (lines.length < height) {
    lines.push("");
  }

  return lines.slice(0, height);
}

/**
 * Render message list with scrolling
 */
function renderMessages(options: {
  messages: ChatMessage[];
  width: number;
  avatarState: AvatarState;
  maxLines: number;
  scrollOffset?: number;
}): string[] {
  const { messages, width, avatarState, maxLines, scrollOffset = 0 } = options;

  if (messages.length === 0) {
    return [
      "",
      `  ${xrDim("No messages yet — ask XR something!")}`,
      "",
    ];
  }

  const lines: string[] = [];
  const rendered: string[] = [];

  // Render each message
  for (const msg of messages) {
    rendered.push(...renderSingleMessage(msg, width, avatarState));
  }

  // Apply scrolling (show most recent messages)
  const totalLines = rendered.length;
  const startLine = Math.max(0, totalLines - maxLines - scrollOffset);
  const visibleLines = rendered.slice(startLine, startLine + maxLines);

  return visibleLines;
}

/**
 * Render a single message
 */
function renderSingleMessage(msg: ChatMessage, width: number, avatarState: AvatarState): string[] {
  const lines: string[] = [];

  // Header
  lines.push(renderMessageHeader(msg, avatarState, width));

  // Content
  const content = renderMessageContent(msg, width);
  lines.push(...content);

  // Spacer between messages
  lines.push("");

  return lines;
}

/**
 * Format message for display
 */
export function formatMessageForDisplay(msg: ChatMessage): {
  role: string;
  content: string;
  isStreaming: boolean;
  status: string | null;
} {
  return {
    role: msg.role,
    content: msg.content,
    isStreaming: msg.meta === "live",
    status: msg.status ?? null,
  };
}

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

// ── Helper ────────────────────────────────────────────────────────────────────

function avatarStateLabel(state: AvatarState): string {
  const labels: Record<AvatarState, string> = {
    idle: "Ready",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    working: "Working",
    error: "Error",
    complete: "Done",
  };
  return labels[state];
}
