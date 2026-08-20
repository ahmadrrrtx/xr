/**
 * Phase 12 — TUI command palette.
 *
 * Items are local metadata only (no backend round-trip to open). Heavy work
 * happens when a command runs, never when the overlay paints.
 */

import { loadConfig } from "../../config/config.ts";
import { CANCELLATION_BUSY_LABEL, CANCELLATION_USER_COPY } from "../../ui/ux-vocabulary.ts";
import { SHELL_VIEW_ORDER, type ShellViewId } from "../../ui/icons.ts";
import type { ChatMessage, PaletteItem, Severity, ShellState } from "./types.ts";

export interface PaletteDeps {
  setView: (state: ShellState, view: ShellViewId) => void;
  appendMessage: (state: ShellState, role: ChatMessage["role"], content: string, meta?: string) => void;
  notify: (state: ShellState, level: Severity, title: string, detail?: string) => void;
  runSecurityLab: (state: ShellState) => Promise<void>;
  exportAudit: (state: ShellState) => Promise<void>;
}

export function buildPaletteItems(state: ShellState, deps: PaletteDeps): PaletteItem[] {
  const go = (view: ShellViewId) => () => {
    deps.setView(state, view);
    state.overlay = "none";
    state.focus = "composer";
  };
  return [
    { id: "nav-home", label: "Open Overview", description: "Home dashboard", keywords: ["dashboard", "home"], section: "navigation", shortcut: "g d", run: go("home") },
    { id: "nav-chat", label: "Open Chat", description: "Conversation workspace", keywords: ["assistant", "messages"], section: "navigation", shortcut: "g c", run: go("chat") },
    { id: "nav-sessions", label: "Open Sessions", description: "Recent tasks and chats", keywords: ["history"], section: "navigation", shortcut: "g s", run: go("sessions") },
    { id: "nav-workspaces", label: "Open Workspaces", description: "Switch isolated workspaces", keywords: ["projects"], section: "navigation", shortcut: "g w", run: go("workspaces") },
    { id: "nav-research", label: "Open Research", description: "Citable research runs", keywords: ["report"], section: "navigation", shortcut: "g r", run: go("research") },
    { id: "nav-activity", label: "Open Activity", description: "Tool timeline", keywords: ["timeline", "tools"], section: "navigation", shortcut: "g t", run: go("activity") },
    { id: "nav-audit", label: "Open Audit Log", description: "Tamper-evident chain", keywords: ["security", "chain"], section: "navigation", shortcut: "g a", run: go("audit") },
    { id: "nav-memory", label: "Open Memory", description: "Durable knowledge", keywords: ["rag", "remember"], section: "navigation", run: go("memory") },
    { id: "nav-status", label: "Open Status", description: "System overview", keywords: ["health", "doctor"], section: "navigation", run: go("status") },
    { id: "nav-settings", label: "Open Settings", description: "Runtime configuration", keywords: ["config", "permissions"], section: "settings", shortcut: "g .", run: go("settings") },
    { id: "notices", label: "Notification Center", description: "Recent notices", keywords: ["alerts"], section: "commands", shortcut: "Ctrl+N", run: () => { state.overlay = "notifications"; state.dirty = true; } },
    { id: "quick", label: "Quick Actions", description: "High-frequency ops", keywords: ["actions"], section: "commands", shortcut: "Ctrl+J", run: () => { state.overlay = "quick"; state.dirty = true; } },
    { id: "workspace-picker", label: "Workspace Picker", description: "Switch workspace", keywords: ["workspace"], section: "commands", shortcut: "Ctrl+W", run: () => { state.overlay = "startup"; state.startupSection = "workspace"; state.dirty = true; } },
    { id: "mode", label: "Switch Mode", description: "agent / plan / ask", keywords: ["mode"], section: "commands", shortcut: "Shift+Tab", run: () => { state.overlay = "mode"; state.dirty = true; } },
    { id: "model", label: "Change Model", description: `Active: ${state.provider}/${state.model}`, keywords: ["model", "provider", "switch", "ollama", "openai", "claude"], section: "commands", shortcut: "Alt+P", run: () => { state.overlay = "model"; state.dirty = true; } },
    { id: "help", label: "Keyboard Help", description: "All bindings", keywords: ["keys", "shortcuts"], section: "commands", shortcut: "?", run: () => { state.overlay = "help"; state.helpSeen++; state.dirty = true; } },
    { id: "serve", label: "Control Center guide", description: "How to launch xr serve", keywords: ["dashboard", "browser"], section: "commands", run: () => {
      deps.appendMessage(state, "assistant", "Run `xr serve` in another terminal, then open http://127.0.0.1:3141 — same XR, browser surface.", "guide");
      state.overlay = "none"; deps.setView(state, "chat");
    }},
    { id: "security-lab", label: "Run Security Lab", description: "Injection benchmark", keywords: ["security"], section: "commands", run: async () => { state.overlay = "none"; await deps.runSecurityLab(state); } },
    { id: "audit-export", label: "Export Signed Audit", description: "Write xr-audit-*.md", keywords: ["export"], section: "commands", run: async () => { state.overlay = "none"; await deps.exportAudit(state); } },
    { id: "clear", label: "Clear Chat View", description: "Keep history, clear screen", keywords: ["clear"], section: "commands", shortcut: "Ctrl+L", run: () => {
      state.chat = state.chat.slice(0, 1);
      state.overlay = "none";
      deps.notify(state, "info", "Chat cleared");
    }},
    { id: "interrupt", label: "Interrupt current task", description: "Request cancellation at the next checkpoint", keywords: ["stop", "cancel", "esc", "abort"], section: "commands", shortcut: "Esc", run: () => {
      state.overlay = "none";
      if (!state.busy) {
        deps.notify(state, "info", "Nothing to interrupt");
        return;
      }
      state.runAbort?.abort();
      state.busyLabel = CANCELLATION_BUSY_LABEL;
      deps.notify(state, "warn", "Cancellation requested", CANCELLATION_USER_COPY);
      state.dirty = true;
    }},
    { id: "start-task", label: "Start a task", description: "Focus the composer", keywords: ["task", "chat", "compose"], section: "commands", shortcut: "/", run: () => {
      state.overlay = "none";
      deps.setView(state, "chat");
      state.focus = "composer";
      state.dirty = true;
    }},
    { id: "permissions", label: "Show permissions", description: "What requires approval", keywords: ["approval", "policy", "shield"], section: "commands", run: () => {
      const { config } = loadConfig();
      const req = (config.security.requireApproval ?? []).join(", ") || "none listed";
      deps.appendMessage(
        state,
        "assistant",
        [
          "Permissions (runtime policy — the model cannot grant itself any)",
          `• requireApproval: ${req}`,
          `• hardened: ${config.security.hardened ? "yes" : "no"}`,
          "• Shield is always enforced. Blocked actions never execute.",
        ].join("\n"),
        "security",
      );
      state.overlay = "none";
      deps.setView(state, "chat");
    }},
    { id: "doctor", label: "Doctor / status", description: "Live status; full report is `xr doctor`", keywords: ["doctor", "health", "diagnose"], section: "commands", run: () => {
      deps.appendMessage(
        state,
        "assistant",
        "Status view shows live runtime state. For the full diagnostic report run `xr doctor` in the CLI — this palette does not fake a doctor pass.",
        "guide",
      );
      state.overlay = "none";
      deps.setView(state, "status");
    }},
    { id: "exit", label: "Exit XR", description: "Leave the shell", keywords: ["quit"], section: "commands", run: () => { state.overlay = "exit"; state.dirty = true; } },
  ];
}

export function filterPaletteItems(state: ShellState, items: PaletteItem[]): PaletteItem[] {
  const q = state.paletteQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    [item.label, item.description, ...item.keywords].join(" ").toLowerCase().includes(q),
  );
}

/** Views the TUI actually has — never advertise a missing section. */
export function tuiViewIds(): readonly ShellViewId[] {
  return SHELL_VIEW_ORDER;
}
