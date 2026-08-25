/**
 * XR 3.1 Shell — shared types
 * Vocabulary: docs/xr-3.1/XR-3.1-INFORMATION-ARCHITECTURE.md
 */

import type { ShellViewId } from "../../ui/icons.ts";
import type { WorkspaceManager } from "../../core/workspace.ts";
import type { Store } from "../../state/workspace-store.ts";
import { runStatusLabel } from "../../core/ux-status.ts";

export type { ShellViewId };

export type OverlayId =
  | "none"
  | "startup"
  | "palette"
  | "notifications"
  | "quick"
  | "confirm"
  | "help"
  | "model"
  | "mode"
  | "exit";

export type FocusPane = "sidebar" | "main" | "inspector" | "composer";

export type ModeState = "agent" | "plan" | "ask";

/**
 * Phase D · D-1 — how much of the agent's REAL work (the tool/step timeline
 * fed by the run loop) is shown in the chat feed. There is no per-turn
 * reasoning channel in the runtime, so this honestly controls timeline
 * visibility instead of pretending to toggle model "thinking":
 *   · none     — final answers only
 *   · brief    — tool/step titles (default)
 *   · detailed — titles + detail lines
 */
export type AgentDetail = "none" | "brief" | "detailed";

/** Pure cycle helper (testable): none → brief → detailed → none. */
export function cycleAgentDetail(current: AgentDetail): AgentDetail {
  const order: AgentDetail[] = ["none", "brief", "detailed"];
  return order[(order.indexOf(current) + 1) % order.length]!;
}

export type Severity = "info" | "ok" | "warn" | "error";

export interface ProjectMeta {
  name: string;
  techStack?: string[];
  frameworks?: string[];
  conventions?: string[];
  testingFramework?: string;
  description?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
  meta?: string;
}

export interface TimelineEvent {
  at: number;
  title: string;
  detail?: string;
  level: Severity;
}

export interface Notice {
  id: string;
  title: string;
  detail?: string;
  level: Severity;
  at: number;
}

export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  section: "recent" | "commands" | "navigation" | "skills" | "settings";
  shortcut?: string;
  run: () => Promise<void> | void;
}

export interface ConfirmState {
  title: string;
  detail?: string;
  defaultYes: boolean;
  resolve: (value: boolean) => void;
}

export interface SessionRow {
  id: string;
  title: string;
  mode: string;
  status: string;
  created_at: number;
}

export interface ResearchRow {
  id: string;
  topic: string;
  depth: string;
  status: string;
  updated_at: number;
}

export interface ShellState {
  cwd: string;
  meta: ProjectMeta;
  wm: WorkspaceManager;
  store: Store;
  workspaceId: string;
  sessionTitle: string;
  provider: string;
  model: string;
  mode: ModeState;
  agentDetail: AgentDetail;
  budget: number;
  totalSpent: number;
  totalTokens: number;
  busy: boolean;
  busyLabel: string;
  /**
   * A-19 — the abort handle for the run currently in flight. Ctrl+C / Esc
   * abort it; the loop stops at its next checkpoint and reports
   * `stopped: "cancelled"` (no fake completion, no run-on in the background).
   */
  runAbort: AbortController | null;
  spinnerIndex: number;
  view: ShellViewId;
  sidebarIndex: number;
  focus: FocusPane;
  overlay: OverlayId;
  // Composer
  input: string;
  cursor: number;
  inputHistory: string[];
  inputHistoryIndex: number;
  // Content
  chat: ChatMessage[];
  chatScroll: number;
  timeline: TimelineEvent[];
  notices: Notice[];
  // Overlays
  paletteQuery: string;
  paletteIndex: number;
  startupSection: "workspace" | "session";
  workspaceIndex: number;
  sessionIndex: number;
  sessions: SessionRow[];
  research: ResearchRow[];
  confirm?: ConfirmState;
  exitArmed: boolean;
  // g-chord
  gPending: boolean;
  gTimer?: ReturnType<typeof setTimeout>;
  // Flags
  shouldExit: boolean;
  dirty: boolean;
  showInspector: boolean;
  bootPhase: number;
  helpSeen: number;
  auditValid: boolean | null;
}

/**
 * Phase 12 · Phase E — map a canonical stream event to the Shell status line.
 *
 * Pure so it can be tested without a terminal. The Shell used to invent its own
 * words here ("planning", "reading", "thinking"); it now renders the same
 * vocabulary the Control Center does, from `src/core/ux-status.ts`.
 *
 * Returns `null` for events that carry no status, so the caller keeps the
 * current label instead of blanking it.
 */
export function busyLabelForEvent(
  ev: import("../../core/types.ts").ChatStreamEvent,
): string | null {
  if (ev.type !== "status") return null;
  // `tool_running` carries the real tool name in `message`.
  return runStatusLabel(ev.status, ev.status === "tool_running" ? ev.message : undefined);
}
