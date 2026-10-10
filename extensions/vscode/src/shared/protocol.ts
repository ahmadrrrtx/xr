/**
 * Message contract between the extension host and the React webview.
 *
 * Shared by both bundles, so it must stay free of DOM and Node types. The
 * webview never talks to the daemon directly: every request goes through the
 * host, which keeps the webview CSP down to `default-src 'none'`.
 */

export type DaemonState = "connecting" | "connected" | "offline" | "unauthorized";

export interface DaemonStatus {
  state: DaemonState;
  version?: string;
  provider?: string;
  model?: string;
  /** Spend today in USD, from /api/budget usage.dayUsd. */
  spendTodayUsd?: number;
  /** Human-readable reason when not connected. Never contains the token. */
  detail?: string;
}

export interface ActivityLine {
  id: string;
  kind: "status" | "tool" | "narration";
  text: string;
  state: "running" | "ok" | "error" | "info";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  activity: ActivityLine[];
  streaming: boolean;
  error?: string;
  /** Short label for the editor context this message was sent with. */
  contextLabel?: string;
}

export interface ContextChip {
  /** Workspace-relative path of the active file, if any. */
  file?: string;
  /** Number of selected lines, 0 when there is no selection. */
  selectedLines: number;
  /** Whether the selection will be sent with the next message. */
  attached: boolean;
}

export interface PanelState {
  status: DaemonStatus;
  messages: ChatMessage[];
  context: ContextChip;
  busy: boolean;
  mode: "ask" | "agent";
  /** Webview-safe URI of the XR sentinel icon, set by the host. */
  iconUri: string;
}

// ── host → webview ─────────────────────────────────────────────────────────

export type ToWebview =
  | { type: "init"; state: PanelState }
  | { type: "status"; status: DaemonStatus }
  | { type: "context"; context: ContextChip }
  | { type: "busy"; busy: boolean }
  | { type: "message"; message: ChatMessage }
  | { type: "delta"; id: string; text: string }
  | { type: "activity"; id: string; line: ActivityLine }
  | { type: "clear" }
  /** Prefill the composer (for example from a code lens or "Ask about selection"). */
  | { type: "seed"; text: string };

// ── webview → host ─────────────────────────────────────────────────────────

export type ToHost =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "clear" }
  | { type: "toggleAttach" }
  | { type: "openFile"; path: string; line?: number }
  | { type: "openLink"; href: string }
  | { type: "apply"; code: string; language: string }
  | { type: "diff"; code: string; language: string }
  | { type: "copy"; code: string }
  | { type: "switchModel" }
  | { type: "showBudget" }
  | { type: "startDaemon" }
  | { type: "setToken" };

export function isToHost(value: unknown): value is ToHost {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
