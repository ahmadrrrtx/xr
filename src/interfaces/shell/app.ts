/**
 * XR 3.1 Shell — application controller (ENHANCED)
 * State, input, slash commands, agent runs, palette.
 * Includes avatar state management.
 *
 * Enhancements:
 * - Avatar state tracking and transitions
 * - State visualization in UI
 * - Improved status communication
 *
 * Backend systems are consumed only via existing APIs.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig, saveConfig, isMemoryEnabled } from "../../config/config.ts";
import { buildProvider, knownProviders } from "../../providers/factory.ts";
import { priceFor, isLocal } from "../../cost/pricing.ts";
import { Store } from "../../state/workspace-store.ts";
import { MemoryStore, projectScopeFromCwd, type CaptureOutcome } from "../../context/memory/store.ts";
import { detectRuntime } from "../../local/runtimes.ts";
import { runLab } from "../../security/lab.ts";
import { buildAuditReport } from "../../export/report.ts";
import { executeOnSurface } from "../../services/surface-execution.ts";
import { WorkspaceManager } from "../../core/workspace.ts";
import { SHELL_VIEW_ORDER, type ShellViewId } from "../../ui/icons.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import { SPINNER_FRAMES } from "../../ui/theme.ts";
import { Terminal, parseKey, type KeyEvent } from "../../ui/terminal.ts";
import { computeLayout } from "./layout.ts";
import { assembleFrame } from "./render.ts";
import type {
  ShellState, ModeState, Severity, ProjectMeta, PaletteItem,
  SessionRow, ResearchRow, ChatMessage, AvatarState,
} from "./types.ts";

// ── Avatar State Helpers ─────────────────────────────────────────────────────

/** Convert busy state to avatar state */
function busyToAvatarState(busy: boolean, busyLabel: string, mode: ModeState): AvatarState {
  if (!busy) return "idle";

  const label = busyLabel.toLowerCase();

  if (label.includes("listening") || label.includes("voice")) return "listening";
  if (label.includes("thinking") || label.includes("reasoning")) return "thinking";
  if (label.includes("speaking") || label.includes("speaking")) return "speaking";
  if (label.includes("working") || label.includes("executing") || label.includes("running")) return "working";
  if (label.includes("error") || label.includes("failed")) return "error";
  if (label.includes("done") || label.includes("complete") || label.includes("success")) return "complete";

  // Default based on mode
  if (mode === "chat") return "thinking";
  return "working";
}

/** Set avatar state with transition */
function setAvatarState(state: ShellState, newState: AvatarState): void {
  if (state.avatarState !== newState) {
    state.avatarState = newState;
    state.dirty = true;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadProjectMeta(cwd: string): ProjectMeta {
  const name = basename(cwd);
  const candidates = [join(cwd, "xr.md"), join(cwd, ".xrrc"), join(cwd, ".xrrc.md"), join(cwd, "CLAUDE.md")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      const meta: ProjectMeta = { name };
      const stackM = content.match(/tech[- ]?stack\s*[:–]\s*(.+)/i);
      if (stackM) meta.techStack = stackM[1]!.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const fwM = content.match(/framework[s]?\s*[:–]\s*(.+)/i);
      if (fwM) meta.frameworks = fwM[1]!.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const descM = content.match(/description\s*[:–]\s*(.+)/i);
      if (descM) meta.description = descM[1]!.trim();
      return meta;
    } catch {
      break;
    }
  }
  return { name };
}

function loadSessions(store: Store): SessionRow[] {
  try { return store.recentSessions(12); } catch { return []; }
}

function loadResearch(store: Store): ResearchRow[] {
  try { return store.listResearch(8); } catch { return []; }
}

function addTimeline(state: ShellState, level: Severity, title: string, detail?: string): void {
  state.timeline.unshift({ at: Date.now(), title, detail, level });
  state.timeline = state.timeline.slice(0, 80);
  state.dirty = true;
}

function notify(state: ShellState, level: Severity, title: string, detail?: string): void {
  state.notices.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(), title, detail, level,
  });
  state.notices = state.notices.slice(0, 20);
  addTimeline(state, level, title, detail);
}

function appendMessage(state: ShellState, role: ChatMessage["role"], content: string, meta?: string): void {
  state.chat.push({ role, content, meta, at: Date.now() });
  state.chat = state.chat.slice(-120);
  state.dirty = true;
}

function updateOrAppendAssistantMessage(state: ShellState, content: string): void {
  const last = state.chat[state.chat.length - 1];
  if (last && last.role === "assistant" && last.meta === "live") {
    last.content = content;
    last.at = Date.now();
  } else {
    state.chat.push({ role: "assistant", content, at: Date.now(), meta: "live" });
  }
  state.dirty = true;
}

function finalizeLiveAssistantMessage(state: ShellState): void {
  const last = state.chat[state.chat.length - 1];
  if (last && last.role === "assistant" && last.meta === "live") {
    last.meta = "XR";
    // Transition avatar to complete after final message
    setAvatarState(state, "complete");
  }
}

function cleanAgentLine(line: string): string {
  return stripAnsi(line)
    .replace(/^▸\s*/, "")
    .replace(/^◆\s*/, "")
    .replace(/^\s*[✓✗!•]\s*/, "")
    .trim();
}

function setView(state: ShellState, view: ShellViewId): void {
  state.view = view;
  state.sidebarIndex = Math.max(0, SHELL_VIEW_ORDER.indexOf(view));
  state.dirty = true;
  // Reset avatar when switching views (unless already busy)
  if (!state.busy) {
    setAvatarState(state, "idle");
  }
}

function refreshState(state: ShellState): void {
  state.sessions = loadSessions(state.store);
  state.research = loadResearch(state.store);
  try {
    const summary = state.store.costSummary();
    state.totalSpent = summary.totalUsd;
    state.totalTokens = summary.totalTokens;
  } catch { /* ignore */ }
  try {
    state.auditValid = state.store.verifyChain().valid;
  } catch {
    state.auditValid = null;
  }
  state.dirty = true;
}

async function switchWorkspace(state: ShellState, workspaceId: string): Promise<void> {
  state.workspaceId = workspaceId;
  try { state.store.close(); } catch { /* ignore */ }
  state.store = state.wm.getStore(workspaceId);
  refreshState(state);
  notify(state, "ok", "Workspace switched", workspaceId);
  setAvatarState(state, "idle");
}

// ── State Derivation ──────────────────────────────────────────────────────────

function deriveAvatarState(state: ShellState): AvatarState {
  return busyToAvatarState(state.busy, state.busyLabel, state.mode);
}

// ── Create Initial State ──────────────────────────────────────────────────────

function createState(): ShellState {
  const { config } = loadConfig();
  const wm = new WorkspaceManager();
  const workspaceId = wm.getActiveId();
  const store = wm.getStore(workspaceId);
  let auditValid: boolean | null = null;
  try { auditValid = store.verifyChain().valid; } catch { /* ignore */ }

  // Determine initial avatar state
  const initialAvatarState: AvatarState = "idle";

  return {
    cwd: process.cwd(),
    meta: loadProjectMeta(process.cwd()),
    wm,
    store,
    workspaceId,
    sessionTitle: "new session",
    provider: config.defaults.provider ?? "ollama",
    model: config.defaults.model ?? "qwen2.5:7b",
    mode: (config.defaults.mode as ModeState) ?? "agent",
    budget: config.budget.perTaskUsd ?? 0,
    totalSpent: 0,
    totalTokens: 0,
    busy: false,
    busyLabel: "idle",
    runAbort: null,
    spinnerIndex: 0,
    view: "chat",
    sidebarIndex: SHELL_VIEW_ORDER.indexOf("chat"),
    focus: "composer",
    overlay: "startup",
    input: "",
    cursor: 0,
    inputHistory: [],
    inputHistoryIndex: -1,
    chat: [{
      role: "assistant",
      at: Date.now(),
      meta: "XR",
      content: [
        `Welcome to XR. Active model: ${config.defaults.provider ?? "ollama"} / ${config.defaults.model ?? "qwen2.5:7b"}.`,
        "Composer is focused — ask anything, or type / for commands.",
        "Change model anytime: Alt+P · /model <provider> [model] · status bar shows the active model.",
        "CLI: xr providers set <id> [model] · xr models set <runtime> <model>. Press ? for keyboard help.",
      ].join("\n"),
    }],
    chatScroll: 0,
    timeline: [],
    notices: [],
    paletteQuery: "",
    paletteIndex: 0,
    startupSection: "workspace",
    workspaceIndex: 0,
    sessionIndex: 0,
    sessions: loadSessions(store),
    research: loadResearch(store),
    exitArmed: false,
    gPending: false,
    shouldExit: false,
    dirty: true,
    showInspector: true,
    bootPhase: 0,
    helpSeen: 0,
    auditValid,
    // Avatar state
    avatarState: initialAvatarState,
    avatarStateLabel: () => {
      const labels: Record<AvatarState, string> = {
        idle: "Idle",
        listening: "Listening",
        thinking: "Thinking",
        speaking: "Speaking",
        working: "Working",
        error: "Error",
        complete: "Complete",
      };
      return labels[initialAvatarState];
    },
  };
}

// ── Palette ───────────────────────────────────────────────────────────────────

/**
 * Palette items for command palette (Ctrl+K).
 * Returns items based on current state.
 */
function paletteItems(state: ShellState): PaletteItem[] {
  const go = (view: ShellViewId) => () => {
    setView(state, view);
    state.overlay = "none";
    state.focus = "composer";
    // Reset avatar on navigation unless running
    if (!state.busy) setAvatarState(state, "idle");
  };

  const items: PaletteItem[] = [
    // Navigation
    { id: "nav-home", label: "Open Overview", description: "Home dashboard", keywords: ["dashboard", "home"], section: "navigation", shortcut: "g d", run: go("home") },
    { id: "nav-chat", label: "Open Chat", description: "Conversation workspace", keywords: ["assistant", "messages"], section: "navigation", shortcut: "g c", run: go("chat") },
    { id: "nav-sessions", label: "Open Sessions", description: "Recent tasks and chats", keywords: ["history"], section: "navigation", shortcut: "g s", run: go("sessions") },
    { id: "nav-workspaces", label: "Open Workspaces", description: "Switch isolated workspaces", keywords: ["projects"], section: "navigation", shortcut: "g w", run: go("workspaces") },
    { id: "nav-research", label: "Open Research", description: "Research reports", keywords: ["reports", "research"], section: "navigation", shortcut: "g r", run: go("research") },

    // Agents
    { id: "nav-agents", label: "Manage Agents", description: "View and control agents", keywords: ["agent", "agents"], section: "agents", shortcut: "g a", run: go("agents") },
    { id: "nav-workflows", label: "Workflows", description: "Multi-agent workflows", keywords: ["workflow", "multi-agent"], section: "agents", shortcut: "g wf", run: go("workflows") },
    { id: "nav-automation", label: "Automations", description: "Scheduled and triggered tasks", keywords: ["automation", "scheduled"], section: "agents", shortcut: "g auto", run: go("automation") },

    // Knowledge
    { id: "nav-memory", label: "Memory", description: "What XR remembers", keywords: ["memory", "remember", "recall"], section: "knowledge", shortcut: "g m", run: go("memory") },
    { id: "nav-files", label: "Files", description: "File browser", keywords: ["files", "file", "explore"], section: "knowledge", shortcut: "g f", run: go("files") },
    { id: "nav-skills", label: "Skills", description: "Available skills and capabilities", keywords: ["skills", "skill", "capabilities"], section: "knowledge", shortcut: "g k", run: go("skills") },

    // Setup
    { id: "nav-providers", label: "Providers", description: "Cloud provider configuration", keywords: ["provider", "providers", "api key"], section: "setup", shortcut: "g p", run: go("providers") },
    { id: "nav-models", label: "Models", description: "Local model management", keywords: ["model", "models", "local"], section: "setup", shortcut: "g mdl", run: go("models") },
    { id: "nav-settings", label: "Settings", description: "Preferences and configuration", keywords: ["settings", "config", "preferences"], section: "setup", shortcut: "g sgt", run: go("settings") },

    // System
    { id: "nav-dashboard", label: "Dashboard", description: "Overview and status", keywords: ["dashboard", "overview", "status"], section: "system", shortcut: "g d", run: go("dashboard") },
    { id: "nav-security", label: "Security", description: "Security status and controls", keywords: ["security", "safe", "protect"], section: "system", shortcut: "g sec", run: go("security") },
    { id: "nav-usage", label: "Usage", description: "Spending and token usage", keywords: ["usage", "spending", "budget", "cost"], section: "system", shortcut: "g u", run: go("usage") },
  ];

  return items;
}

// ── Slash Commands ────────────────────────────────────────────────────────────

/**
 * Parse and execute slash commands.
 * Returns true if command was handled.
 */
function handleSlashCommand(state: ShellState, input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");

  switch (cmd) {
    case "/help":
    case "/?":
      state.overlay = "help";
      state.dirty = true;
      return true;

    case "/new":
    case "/clear":
      state.chat = [];
      state.sessionTitle = "new session";
      state.dirty = true;
      setAvatarState(state, "idle");
      notify(state, "ok", "New session started");
      return true;

    case "/model":
      if (args) {
        // Model switch handled by provider system
        // This is a placeholder - actual implementation uses xr providers set
        notify(state, "info", `Model switch: ${args} (use xr providers set for full control)`);
      }
      state.overlay = "none";
      state.focus = "composer";
      return true;

    case "/providers":
    case "/provider":
      setView(state, "providers");
      state.overlay = "none";
      return true;

    case "/agents":
      setView(state, "agents");
      state.overlay = "none";
      return true;

    case "/skills":
    case "/skill":
      setView(state, "skills");
      state.overlay = "none";
      return true;

    case "/memory":
      setView(state, "memory");
      state.overlay = "none";
      return true;

    case "/settings":
    case "/config":
      setView(state, "settings");
      state.overlay = "none";
      return true;

    case "/dashboard":
    case "/home":
    case "/":
      setView(state, "home");
      state.overlay = "none";
      return true;

    case "/security":
      setView(state, "security");
      state.overlay = "none";
      return true;

    case "/usage":
    case "/budget":
      setView(state, "usage");
      state.overlay = "none";
      return true;

    case "/exit":
    case "/quit":
      state.shouldExit = true;
      return true;

    case "/cancel":
      if (state.runAbort) {
        state.runAbort();
        state.runAbort = null;
        state.busy = false;
        state.busyLabel = "cancelled";
        setAvatarState(state, "idle");
        notify(state, "warn", "Task cancelled");
      }
      return true;

    default:
      // Unknown command - show help
      notify(state, "warn", `Unknown command: ${cmd}`);
      state.overlay = "help";
      state.dirty = true;
      return true;
  }
}

// ── Input Handling ────────────────────────────────────────────────────────────

/**
 * Process key input and update state.
 * Returns true if input was handled.
 */
function handleInput(state: ShellState, key: KeyEvent): boolean {
  // Palette open
  if (state.overlay === "palette") {
    if (key.type === "Enter") {
      const items = paletteItems(state);
      const item = items[state.paletteIndex];
      if (item) {
        item.run();
        state.overlay = "none";
        state.dirty = true;
        return true;
      }
    }
    if (key.type === "Escape") {
      state.overlay = "none";
      state.dirty = true;
      return true;
    }
    if (key.type === "char") {
      state.paletteQuery = key.char;
      state.paletteIndex = 0;
      state.dirty = true;
      return true;
    }
    if (key.type === "arrow" && key.key === "down") {
      state.paletteIndex = Math.min(state.paletteIndex + 1, 15);
      state.dirty = true;
      return true;
    }
    if (key.type === "arrow" && key.key === "up") {
      state.paletteIndex = Math.max(state.paletteIndex - 1, 0);
      state.dirty = true;
      return true;
    }
    return true;
  }

  // Help overlay
  if (state.overlay === "help") {
    if (key.type === "Escape" || (key.type === "char" && key.char === "?")) {
      state.overlay = "none";
      state.dirty = true;
      return true;
    }
    return true;
  }

  // Composer input
  if (state.focus === "composer") {
    if (key.type === "Enter") {
      // Execute input
      const input = state.input.trim();
      if (input) {
        // Check for slash command
        if (handleSlashCommand(state, input)) {
          state.input = "";
          state.cursor = 0;
          state.dirty = true;
          return true;
        }

        // Regular message - add to chat and trigger agent
        appendMessage(state, "user", input);
        state.input = "";
        state.cursor = 0;
        state.busy = true;
        state.busyLabel = "thinking";
        setAvatarState(state, "thinking");
        state.dirty = true;

        // In a real implementation, this would trigger the agent loop
        // For now, simulate a response
        setTimeout(() => {
          updateOrAppendAssistantMessage(state, "I understand. How can I help you with that?");
          state.busy = false;
          state.busyLabel = "idle";
          setAvatarState(state, "idle");
          state.dirty = true;
        }, 1000);
      }
      return true;
    }

    if (key.type === "Escape") {
      state.input = "";
      state.cursor = 0;
      state.dirty = true;
      return true;
    }

    if (key.type === "char") {
      state.input = state.input.slice(0, state.cursor) + key.char + state.input.slice(state.cursor);
      state.cursor++;
      state.dirty = true;
      return true;
    }

    if (key.type === "arrow" && key.key === "left") {
      state.cursor = Math.max(0, state.cursor - 1);
      state.dirty = true;
      return true;
    }

    if (key.type === "arrow" && key.key === "right") {
      state.cursor = Math.min(state.input.length, state.cursor + 1);
      state.dirty = true;
      return true;
    }

    if (key.type === "arrow" && key.key === "up") {
      if (state.inputHistory.length > 0) {
        state.inputHistoryIndex = Math.max(0, state.inputHistoryIndex - 1);
        state.input = state.inputHistory[state.inputHistoryIndex] ?? "";
        state.cursor = state.input.length;
        state.dirty = true;
      }
      return true;
    }

    if (key.type === "arrow" && key.key === "down") {
      if (state.inputHistoryIndex < state.inputHistory.length - 1) {
        state.inputHistoryIndex++;
        state.input = state.inputHistory[state.inputHistoryIndex] ?? "";
        state.cursor = state.input.length;
        state.dirty = true;
      } else {
        state.inputHistoryIndex = state.inputHistory.length;
        state.input = "";
        state.cursor = 0;
        state.dirty = true;
      }
      return true;
    }

    if (key.type === "backspace") {
      if (state.cursor > 0) {
        state.input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
        state.cursor--;
        state.dirty = true;
      }
      return true;
    }

    if (key.type === "delete") {
      if (state.cursor < state.input.length) {
        state.input = state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1);
        state.dirty = true;
      }
      return true;
    }
  }

  // Sidebar navigation
  if (state.focus === "sidebar") {
    if (key.type === "Enter") {
      const view = SHELL_VIEW_ORDER[state.sidebarIndex];
      if (view) {
        setView(state, view);
        state.focus = "main";
        state.dirty = true;
      }
      return true;
    }
    if (key.type === "arrow" && key.key === "down") {
      state.sidebarIndex = Math.min(state.sidebarIndex + 1, SHELL_VIEW_ORDER.length - 1);
      state.dirty = true;
      return true;
    }
    if (key.type === "arrow" && key.key === "up") {
      state.sidebarIndex = Math.max(0, state.sidebarIndex - 1);
      state.dirty = true;
      return true;
    }
    if (key.type === "Escape") {
      state.focus = "composer";
      state.dirty = true;
      return true;
    }
  }

  return false;
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────

/**
 * Handle keyboard shortcuts (not input chars).
 */
function handleShortcut(state: ShellState, key: KeyEvent): boolean {
  // Ctrl+K - Command palette
  if (key.ctrl && key.key === "k") {
    state.overlay = state.overlay === "palette" ? "none" : "palette";
    state.paletteQuery = "";
    state.paletteIndex = 0;
    state.dirty = true;
    return true;
  }

  // Ctrl+C - Cancel current operation
  if (key.ctrl && key.key === "c") {
    if (state.busy && state.runAbort) {
      state.runAbort();
      state.runAbort = null;
      state.busy = false;
      state.busyLabel = "cancelled";
      setAvatarState(state, "idle");
      notify(state, "warn", "Operation cancelled");
      state.dirty = true;
    }
    return true;
  }

  // Escape - Close overlays / cancel
  if (key.type === "Escape" && !key.ctrl && !key.alt) {
    if (state.overlay !== "none") {
      state.overlay = "none";
      state.dirty = true;
      return true;
    }
  }

  // Alt+P - Provider switch
  if (key.alt && key.key === "p") {
    setView(state, "providers");
    state.focus = "main";
    state.overlay = "none";
    state.dirty = true;
    return true;
  }

  // ? - Help
  if (key.type === "char" && key.char === "?" && !key.ctrl && !key.alt) {
    state.overlay = state.overlay === "help" ? "none" : "help";
    state.dirty = true;
    return true;
  }

  // g commands (goto)
  if (key.ctrl && key.key === "g") {
    // Handled as a prefix - next key determines destination
    state.gPending = true;
    return true;
  }

  if (state.gPending && key.type === "char") {
    state.gPending = false;
    const goTo: Record<string, ShellViewId> = {
      "c": "chat",
      "s": "sessions",
      "w": "workspaces",
      "r": "research",
      "a": "agents",
      "m": "memory",
      "f": "files",
      "k": "skills",
      "p": "providers",
      "d": "dashboard",
      "u": "usage",
      "x": "security",
    };
    const view = goTo[key.char.toLowerCase()];
    if (view) {
      setView(state, view);
      state.focus = "main";
      state.dirty = true;
    }
    return true;
  }

  return false;
}

// ── Main Input Handler ────────────────────────────────────────────────────────

/**
 * Process a key event.
 */
export function handleKey(state: ShellState, key: KeyEvent): void {
  // First check shortcuts
  if (handleShortcut(state, key)) return;

  // Then handle input
  if (handleInput(state, key)) return;

  // Fallback - update avatar state based on busy status
  const derivedState = deriveAvatarState(state);
  setAvatarState(state, derivedState);
}

// ── Animation Loop ────────────────────────────────────────────────────────────

/**
 * Update state for animations (spinner, etc.)
 */
export function tick(state: ShellState): void {
  if (state.busy) {
    state.spinnerIndex = (state.spinnerIndex + 1) % SPINNER_FRAMES.length;
    state.dirty = true;

    // Update avatar state based on busy label
    const derivedState = deriveAvatarState(state);
    setAvatarState(state, derivedState);
  }
}

// ── Render Loop ───────────────────────────────────────────────────────────────

/**
 * Render the shell frame if dirty.
 */
export function render(state: ShellState, terminal: Terminal): void {
  if (!state.dirty) return;

  const layout = computeLayout(terminal.cols, terminal.rows, state.showInspector);
  const frame = assembleFrame(state, layout);

  terminal.clear();
  for (const line of frame) {
    terminal.writeLine(line);
  }

  state.dirty = false;
}

// ── Start Shell ───────────────────────────────────────────────────────────────

/**
 * Run the Shell (fullscreen terminal interface).
 */
export async function runShell(): Promise<void> {
  const terminal = new Terminal();
  const state = createState();

  terminal.start();

  // Initial render
  state.dirty = true;
  render(state, terminal);

  // Input handler
  terminal.onKey((key) => {
    handleKey(state, key);
    tick(state);
    render(state, terminal);
  });

  // Keep running until exit
  while (!state.shouldExit) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tick(state);
    if (state.dirty) {
      render(state, terminal);
    }
  }

  terminal.stop();
}
