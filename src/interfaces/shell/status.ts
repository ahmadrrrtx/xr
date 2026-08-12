/**
 * XR 3.1 Shell — Status Bar and Enhancements
 *
 * Enhanced status bar, keyboard help, focus indicators, view transitions.
 *
 * Enhancements over Phase 2:
 * - More detailed status information
 * - Keyboard shortcut reference
 * - Focus state visualization
 * - View transition indicators
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed, xrViolet } from "../../ui/theme.ts";
import { SYM } from "../../ui/theme.ts";
import { padAnsi, clipAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";
import type { ShellState } from "./types.ts";

// ── Enhanced Status Bar ────────────────────────────────────────────────────────

export interface StatusBarSection {
  label: string;
  value: string;
  color?: (s: string) => string;
  icon?: string;
}

/**
 * Render enhanced status bar
 */
export function renderStatusBar(state: ShellState, width: number): string[] {
  const lines: string[] = [];

  // Status bar height: 2 rows (enhanced from 1)
  const statusItems: StatusBarSection[] = [
    {
      label: "Mode",
      value: state.mode,
      color: modeColor(state.mode),
    },
    {
      label: "Provider",
      value: state.provider,
      color: state.provider === "ollama" ? xrGreen : xrAmber,
      icon: state.provider === "ollama" ? SYM.local : SYM.cloud,
    },
    {
      label: "Model",
      value: state.model,
    },
    {
      label: "Budget",
      value: state.budget > 0 ? `$${state.budget}` : "Unlimited",
      color: state.budget > 0 ? xrAmber : xrDim,
      icon: state.budget > 0 ? SYM.budget : SYM.info,
    },
    {
      label: "Audit",
      value: state.auditValid === true ? "✓ Valid" : state.auditValid === false ? "✗ Invalid" : "?",
      color: state.auditValid === true ? xrGreen : state.auditValid === false ? xrRed : xrDim,
    },
  ];

  // Row 1: Status items
  const row1Parts: string[] = [];
  for (const item of statusItems) {
    const icon = item.icon ? `${item.icon} ` : "";
    const value = item.color ? item.color(item.value) : item.value;
    row1Parts.push(`${icon}${xrDim(item.label)}: ${value}`);
  }

  const row1 = row1Parts.join(`  ${xrDim("·")}  `);
  lines.push(clipAnsi(row1, width));

  // Row 2: Keyboard hints (context-aware)
  const hints = getStatusHints(state);
  lines.push(clipAnsi(hints, width));

  return lines;
}

/**
 * Get context-aware status hints
 */
function getStatusHints(state: ShellState): string {
  const hints: string[] = [];

  // Show different hints based on current view and state
  if (state.busy) {
    hints.push(`${renderCompactAvatar(state.avatarState, "")} ${state.busyLabel}  ·  ${SYM.running} Running`);
  } else if (state.view === "chat") {
    hints.push(`${renderCompactAvatar(state.avatarState, "")} Ready  ·  ${SYM.info} Type a message or / for commands`);
  } else if (state.view === "sessions") {
    hints.push(`${SYM.info} ↑↓ Navigate  ·  Enter Resume  ·  / Back to chat`);
  } else if (state.view === "providers" || state.view === "models") {
    hints.push(`${SYM.info} Alt+P Switch provider  ·  /model Change model`);
  } else if (state.view === "settings") {
    hints.push(`${SYM.info} ↑↓ Navigate settings  ·  Enter Edit  ·  Esc Back`);
  } else {
    hints.push(`${renderCompactAvatar(state.avatarState, "")} ${xrDim("Press ? for help")}`);
  }

  return hints.join("");
}

/**
 * Get mode color
 */
function modeColor(mode: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    agent: xrCyan,
    chat: xrGreen,
    research: xrViolet,
    code: xrAmber,
  };
  return colors[mode] ?? xrDim;
}

// ── Keyboard Help Overlay ──────────────────────────────────────────────────────

export interface KeyboardHelpSection {
  title: string;
  items: { keys: string; action: string }[];
}

/**
 * Render full keyboard help
 */
export function renderKeyboardHelp(width: number): string[] {
  const lines: string[] = [];

  // Header
  const titleLines = [
    `${xrBold("Keyboard Shortcuts")}`,
    `${xrDim("─".repeat(Math.min(width - 2, 44)))}`,
    "",
  ];
  lines.push(...titleLines);

  // Navigation
  lines.push(xrBold("Navigation"));
  lines.push(xrDim(""));
  const navShortcuts: KeyboardHelpSection = {
    title: "",
    items: [
      { keys: "g c", action: "Go to Chat" },
      { keys: "g s", action: "Go to Sessions" },
      { keys: "g w", action: "Go to Workspaces" },
      { keys: "g a", action: "Go to Agents" },
      { keys: "g m", action: "Go to Memory" },
      { keys: "g p", action: "Go to Providers" },
      { keys: "g d", action: "Go to Dashboard" },
      { keys: "g r", action: "Go to Research" },
      { keys: "g k", action: "Go to Skills" },
      { keys: "g f", action: "Go to Files" },
      { keys: "g sec", action: "Go to Security" },
      { keys: "g u", action: "Go to Usage" },
      { keys: "g sgt", action: "Go to Settings" },
    ],
  };

  for (const item of navShortcuts.items) {
    lines.push(`  ${xrCyan(item.keys.padEnd(8))} ${item.action}`);
  }
  lines.push("");

  // Actions
  lines.push(xrBold("Actions"));
  lines.push(xrDim(""));
  const actionShortcuts: KeyboardHelpSection = {
    title: "",
    items: [
      { keys: "Ctrl+K", action: "Open command palette" },
      { keys: "Ctrl+C", action: "Cancel current operation" },
      { keys: "/", action: "Focus composer" },
      { keys: "/new", action: "New session" },
      { keys: "/clear", action: "Clear conversation" },
      { keys: "/cancel", action: "Cancel running task" },
      { keys: "/help", action: "Show this help" },
      { keys: "Alt+P", action: "Change provider/model" },
      { keys: "/model", action: "Change model" },
      { keys: "/providers", action: "Open providers" },
      { keys: "/settings", action: "Open settings" },
      { keys: "/security", action: "Open security" },
      { keys: "/usage", action: "Open usage" },
      { keys: "/exit", action: "Exit XR" },
    ],
  };

  for (const item of actionShortcuts.items) {
    lines.push(`  ${xrCyan(item.keys.padEnd(8))} ${item.action}`);
  }
  lines.push("");

  // Palette
  lines.push(xrBold("Command Palette (Ctrl+K)"));
  lines.push(xrDim(""));
  lines.push(`  ${xrCyan("↑↓")} Navigate  ${xrCyan("Enter")} Select  ${xrCyan("Esc")} Close`);
  lines.push(`  ${xrCyan("Type")} to search (e.g. "provider", "settings", "memory")`);
  lines.push("");

  // Tips
  lines.push(xrBold("Tips"));
  lines.push(xrDim(""));
  lines.push(`  ${SYM.info} ${xrDim("Avatar shows XR's current state")}`);
  lines.push(`  ${SYM.info} ${xrDim("Tool execution appears as cards in chat")}`);
  lines.push(`  ${SYM.info} ${xrDim("Errors include suggestions for fixing")}`);
  lines.push(`  ${SYM.info} ${xrDim("All commands work from any view")}`);

  lines.push("");
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));
  lines.push(xrDim(`  Press ${xrCyan("?")} or ${xrCyan("Esc")} to close`));

  return lines;
}

// ── Focus Indicators ────────────────────────────────────────────────────────────

/**
 * Render focus indicator for sidebar
 */
export function renderSidebarFocusIndicator(
  focused: boolean,
  width: number,
): string {
  if (!focused) return "";

  return `${xrDim("│")} ${xrCyan("◀")} ${xrDim("focus")}`;
}

/**
 * Render focus indicator for composer
 */
export function renderComposerFocusIndicator(width: number): string {
  return `${xrCyan("▶")} ${xrDim("composer focused")}`;
}

/**
 * Render focus indicator for main view
 */
export function renderMainFocusIndicator(width: number): string {
  return `${xrDim("│")} ${xrCyan("▼")} ${xrDim("main view")}`;
}

// ── View Transition Indicators ─────────────────────────────────────────────────

/**
 * Show view change notification
 */
export function renderViewChangeNotification(
  fromView: string | null,
  toView: string,
  width: number,
): string[] {
  const lines: string[] = [];

  const fromLabel = fromView ? ` from ${fromView}` : "";
  lines.push("");
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push(xrCyan(`→ Switched${fromLabel} to ${toView}`));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");

  return lines;
}

/**
 * Show loading/transition indicator
 */
export function renderLoadingIndicator(
  message: string,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${message}`));
  lines.push(xrDim(`│ ${SYM.running} Working...`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));
  lines.push("");

  return lines;
}

// ── Error Display ───────────────────────────────────────────────────────────────

/**
 * Render error in Shell with recovery suggestion
 */
export function renderShellError(
  error: string,
  suggestion?: string,
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrRed(`│ ${SYM.error} Error`));
  lines.push(xrRed(`│ ${error}`));
  lines.push(xrDim("│"));

  if (suggestion) {
    lines.push(xrAmber(`│ ${SYM.warn} Try: ${suggestion}`));
    lines.push(xrDim("│"));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));
  lines.push("");

  return lines;
}

// ── Success Display ─────────────────────────────────────────────────────────────

/**
 * Render success/confirmation in Shell
 */
export function renderShellSuccess(
  message: string,
  details?: string[],
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrGreen(`│ ${SYM.ok} ${message}`));
  lines.push(xrDim("│"));

  if (details) {
    for (const detail of details) {
      lines.push(xrDim(`│  ${detail}`));
    }
    lines.push(xrDim("│"));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));
  lines.push("");

  return lines;
}

// ── Welcome/Startup Screen ──────────────────────────────────────────────────────

/**
 * Render startup/welcome in Shell
 */
export function renderStartupScreen(state: ShellState, width: number): string[] {
  const lines: string[] = [];

  // Avatar welcome
  const avatarLines = renderCompactAvatar(state.avatarState);
  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(xrCyan(`│ ${avatarLines}  XR`));
  lines.push(xrDim(`│ ${xrDim("—")} ${xrCyan("AI Operating System")} v3.1`));
  lines.push(xrDim("│"));
  lines.push(xrDim(`│ Workspace: ${state.workspaceId}`));
  lines.push(xrDim(`│ ${SYM.local} ${xrGreen(state.provider === "ollama" ? "Local" : "Cloud")} mode`));
  lines.push(xrDim(`│ Model: ${state.provider} / ${state.model}`));
  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ${SYM.info} ${xrDim("Composer focused — type to chat")}`));
  lines.push(xrDim(`│ ${SYM.info} ${xrDim("Alt+P change provider")}`));
  lines.push(xrDim(`│ ${SYM.info} ${xrDim("/ for commands")}`));
  lines.push(xrDim(`│ ${SYM.info} ${xrDim("Ctrl+K command palette")}`));
  lines.push(xrDim("│"));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));

  return lines;
}
