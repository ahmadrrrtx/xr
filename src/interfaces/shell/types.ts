/**
 * XR 3.1 Shell — shared types (ENHANCED)
 * Includes avatar state support
 */

import type { AvatarState } from "../../ui/avatar.ts";

// ── Shell Views ──────────────────────────────────────────────────────────────

export type ShellViewId =
  | "chat"           // Main conversation
  | "sessions"       // Recent tasks
  | "research"       // Research reports
  | "agents"         // Agent management
  | "workflows"      // Multi-agent workflows
  | "automation"     // Automations
  | "memory"         // Memory browser
  | "files"          // File browser
  | "skills"         // Skills browser
  | "providers"      // Provider management
  | "models"         // Local model management
  | "settings"       // Settings
  | "dashboard"      // Overview dashboard
  | "security"       // Security status
  | "usage"          // Usage/spending
  | "home";          // Home/overview

// ── Mode States ──────────────────────────────────────────────────────────────

export type ModeState = "agent" | "chat" | "research" | "code";

// ── Focus Areas ──────────────────────────────────────────────────────────────

export type FocusArea = "composer" | "sidebar" | "main" | "inspector";

// ── Overlay States ───────────────────────────────────────────────────────────

export type OverlayState = "none" | "startup" | "palette" | "help" | "confirm" | "error";

// ── Severity Levels ──────────────────────────────────────────────────────────

export type Severity = "ok" | "warn" | "error" | "info";

// ── Chat Message ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "agent" | "system" | "error";
  content: string;
  meta?: string;       // "live" for streaming, "XR" for final, tool name, etc.
  at: number;          // Timestamp
}

// ── Session Row ──────────────────────────────────────────────────────────────

export interface SessionRow {
  id: number;
  title: string;
  mode: ModeState;
  status: "running" | "success" | "failed" | "cancelled";
  created_at: number;
}

// ── Research Row ─────────────────────────────────────────────────────────────

export interface ResearchRow {
  id: number;
  title: string;
  sourceCount: number;
  created_at: number;
}

// ── Project Metadata ─────────────────────────────────────────────────────────

export interface ProjectMeta {
  name: string;
  techStack?: string[];
  frameworks?: string[];
  description?: string;
}

// ── Timeline Event ───────────────────────────────────────────────────────────

export interface TimelineEvent {
  at: number;
  title: string;
  detail?: string;
  level: Severity;
}

// ── Notice ───────────────────────────────────────────────────────────────────

export interface Notice {
  id: string;
  at: number;
  title: string;
  detail?: string;
  level: Severity;
}

// ── Palette Item ─────────────────────────────────────────────────────────────

export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  section: string;
  shortcut?: string;
  run: () => void;
}

// ── Shell State ──────────────────────────────────────────────────────────────

export interface ShellState {
  // Environment
  cwd: string;
  meta: ProjectMeta;

  // Workspace
  wm: import("../../core/workspace.ts").WorkspaceManager;
  store: import("../../state/workspace-store.ts").Store;
  workspaceId: string;
  sessionTitle: string;

  // Model/Provider
  provider: string;
  model: string;
  mode: ModeState;
  budget: number;           // Per-task budget in USD (0 = unlimited)

  // Usage tracking
  totalSpent: number;
  totalTokens: number;

  // Execution state
  busy: boolean;
  busyLabel: string;
  runAbort: ((() => void) | null);
  spinnerIndex: number;

  // View state
  view: ShellViewId;
  sidebarIndex: number;
  focus: FocusArea;
  overlay: OverlayState;

  // Input state
  input: string;
  cursor: number;
  inputHistory: string[];
  inputHistoryIndex: number;

  // Chat
  chat: ChatMessage[];
  chatScroll: number;

  // Timeline & notices
  timeline: TimelineEvent[];
  notices: Notice[];

  // Palette
  paletteQuery: string;
  paletteIndex: number;

  // Startup state
  startupSection: string;
  workspaceIndex: number;
  sessionIndex: number;
  sessions: SessionRow[];
  research: ResearchRow[];

  // Exit handling
  exitArmed: boolean;
  gPending: boolean;
  shouldExit: boolean;

  // Dirty flag for re-render
  dirty: boolean;

  // Inspector visibility
  showInspector: boolean;

  // Boot phases
  bootPhase: number;

  // Help tracking
  helpSeen: number;

  // Audit chain
  auditValid: boolean | null;

  // ── ENHANCED: Avatar state ──────────────────────────────────────────────
  avatarState: AvatarState;
  avatarStateLabel: () => string;  // Derived from state
}

// ── View Options ─────────────────────────────────────────────────────────────

export interface ViewOptions {
  width: number;
  height: number;
  showSidebar: boolean;
  showInspector: boolean;
}

// ── Layout Geometry ──────────────────────────────────────────────────────────

export interface LayoutGeom {
  cols: number;
  rows: number;
  headerH: number;
  composerH: number;
  statusH: number;
  bodyH: number;
  sidebarW: number;
  inspectorW: number;
  mainW: number;
  showSidebar: boolean;
  showInspector: boolean;
  iconRail: boolean;
  singlePane: boolean;
}
