/**
 * XR 3.1 Shell — shared types
 * Vocabulary: docs/xr-3.1/XR-3.1-INFORMATION-ARCHITECTURE.md
 */

import type { ShellViewId } from "../../ui/icons.ts";
import type { WorkspaceManager } from "../../core/workspace.ts";
import type { Store } from "../../state/db.ts";

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
  budget: number;
  totalSpent: number;
  totalTokens: number;
  busy: boolean;
  busyLabel: string;
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
