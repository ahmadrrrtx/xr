/**
 * XR 3.1 Shell — application controller
 *
 * State, input, slash commands, agent runs, palette.
 * Backend systems are consumed only via existing APIs.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig, saveConfig, isMemoryEnabled } from "../../config/config.ts";
import { buildProvider, knownProviders } from "../../providers/factory.ts";
import { priceFor, isLocal } from "../../cost/pricing.ts";
import { Store } from "../../state/db.ts";
import { MemoryStore, projectScopeFromCwd, type CaptureOutcome } from "../../memory/store.ts";
import { detectRuntime } from "../../local/runtimes.ts";
import { runLab } from "../../security/lab.ts";
import { buildAuditReport } from "../../export/report.ts";
import { runAgent, type AgentDeps } from "../../core/agent.ts";
import { WorkspaceManager } from "../../core/workspace.ts";
import { SHELL_VIEW_ORDER, type ShellViewId } from "../../ui/icons.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import { SPINNER_FRAMES } from "../../ui/theme.ts";
import { Terminal, parseKey, type KeyEvent } from "../../ui/terminal.ts";
import { computeLayout } from "./layout.ts";
import { assembleFrame } from "./render.ts";
import type {
  ShellState, ModeState, Severity, ProjectMeta, PaletteItem,
  SessionRow, ResearchRow, ChatMessage,
} from "./types.ts";

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
  if (last && last.role === "assistant" && last.meta === "live") last.meta = "XR";
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
}

function createState(): ShellState {
  const { config } = loadConfig();
  const wm = new WorkspaceManager();
  const workspaceId = wm.getActiveId();
  const store = wm.getStore(workspaceId);
  let auditValid: boolean | null = null;
  try { auditValid = store.verifyChain().valid; } catch { /* ignore */ }
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
  };
}

// ── Palette ───────────────────────────────────────────────────────────────────

function paletteItems(state: ShellState): PaletteItem[] {
  const go = (view: ShellViewId) => () => {
    setView(state, view);
    state.overlay = "none";
    state.focus = "composer";
  };
  return [
    { id: "nav-home", label: "Open Overview", description: "Home dashboard", keywords: ["dashboard", "home"], section: "navigation", shortcut: "g d", run: go("home") },
    { id: "nav-chat", label: "Open Chat", description: "Conversation workspace", keywords: ["assistant", "messages"], section: "navigation", shortcut: "g c", run: go("chat") },
    { id: "nav-sessions", label: "Open Sessions", description: "Recent tasks and chats", keywords: ["history"], section: "navigation", shortcut: "g s", run: go("sessions") },
    { id: "nav-workspaces", label: "Open Workspaces", description: "Switch isolated workspaces", keywords: ["projects"], section: "navigation", shortcut: "g w", run: go("workspaces") },
    { id: "nav-research", label: "Open Research", description: "Citable research runs", keywords: ["report"], section: "navigation", shortcut: "g r", run: go("research") },
    { id: "nav-activity", label: "Open Activity", description: "Tool timeline", keywords: ["timeline"], section: "navigation", shortcut: "g t", run: go("activity") },
    { id: "nav-audit", label: "Open Audit Log", description: "Tamper-evident chain", keywords: ["security", "chain"], section: "navigation", shortcut: "g a", run: go("audit") },
    { id: "nav-memory", label: "Open Memory", description: "Durable knowledge", keywords: ["rag", "remember"], section: "navigation", run: go("memory") },
    { id: "nav-status", label: "Open Status", description: "System overview", keywords: ["health"], section: "navigation", run: go("status") },
    { id: "nav-settings", label: "Open Settings", description: "Runtime configuration", keywords: ["config"], section: "settings", shortcut: "g .", run: go("settings") },
    { id: "notices", label: "Notification Center", description: "Recent notices", keywords: ["alerts"], section: "commands", shortcut: "Ctrl+N", run: () => { state.overlay = "notifications"; state.dirty = true; } },
    { id: "quick", label: "Quick Actions", description: "High-frequency ops", keywords: ["actions"], section: "commands", shortcut: "Ctrl+J", run: () => { state.overlay = "quick"; state.dirty = true; } },
    { id: "workspace-picker", label: "Workspace Picker", description: "Switch workspace", keywords: ["workspace"], section: "commands", shortcut: "Ctrl+W", run: () => { state.overlay = "startup"; state.startupSection = "workspace"; state.dirty = true; } },
    { id: "mode", label: "Switch Mode", description: "agent / plan / ask", keywords: ["mode"], section: "commands", shortcut: "Shift+Tab", run: () => { state.overlay = "mode"; state.dirty = true; } },
    { id: "model", label: "Change Model", description: `Active: ${state.provider}/${state.model}`, keywords: ["model", "provider", "switch", "ollama", "openai", "claude"], section: "commands", shortcut: "Alt+P", run: () => { state.overlay = "model"; state.dirty = true; } },
    { id: "help", label: "Keyboard Help", description: "All bindings", keywords: ["keys", "shortcuts"], section: "commands", shortcut: "?", run: () => { state.overlay = "help"; state.helpSeen++; state.dirty = true; } },
    { id: "serve", label: "Control Center guide", description: "How to launch xr serve", keywords: ["dashboard", "browser"], section: "commands", run: () => {
      appendMessage(state, "assistant", "Run `xr serve` in another terminal, then open http://127.0.0.1:3141 — same XR, browser surface.", "guide");
      state.overlay = "none"; setView(state, "chat");
    }},
    { id: "security-lab", label: "Run Security Lab", description: "Injection benchmark", keywords: ["security"], section: "commands", run: async () => { state.overlay = "none"; await runSecurityLab(state); } },
    { id: "audit-export", label: "Export Signed Audit", description: "Write xr-audit-*.md", keywords: ["export"], section: "commands", run: async () => { state.overlay = "none"; await exportAudit(state); } },
    { id: "clear", label: "Clear Chat View", description: "Keep history, clear screen", keywords: ["clear"], section: "commands", shortcut: "Ctrl+L", run: () => {
      state.chat = state.chat.slice(0, 1);
      state.overlay = "none";
      notify(state, "info", "Chat cleared");
    }},
    { id: "exit", label: "Exit XR", description: "Leave the shell", keywords: ["quit"], section: "commands", run: () => { state.overlay = "exit"; state.dirty = true; } },
  ];
}

function filteredPalette(state: ShellState): PaletteItem[] {
  const q = state.paletteQuery.trim().toLowerCase();
  const items = paletteItems(state);
  if (!q) return items;
  return items.filter((item) =>
    [item.label, item.description, ...item.keywords].join(" ").toLowerCase().includes(q),
  );
}

// ── Confirm / lab / export ────────────────────────────────────────────────────

function promptConfirm(state: ShellState, title: string, detail?: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { title, detail, defaultYes, resolve };
    state.overlay = "confirm";
    state.dirty = true;
  });
}

async function runSecurityLab(state: ShellState): Promise<void> {
  const { config } = loadConfig();
  const report = runLab({ egressAllowlist: config.security.egressAllowlist });
  const blockedPct = Math.round(report.rate * 100);
  appendMessage(state, "assistant", `Security lab: blocked ${report.blocked}/${report.total} attacks (${blockedPct}%).`, "security");
  notify(state, blockedPct >= 90 ? "ok" : blockedPct >= 70 ? "warn" : "error", "Security lab completed", `${report.blocked}/${report.total} blocked`);
}

async function exportAudit(state: ShellState): Promise<void> {
  const report = buildAuditReport({
    project: state.meta.name,
    chainValid: state.store.verifyChain().valid,
    entries: state.store.recentAudit(1000),
    totalUsd: state.store.costSummary().totalUsd,
  });
  const file = join(state.cwd, `xr-audit-${Date.now().toString(36)}.md`);
  await Bun.write(file, report.markdown);
  notify(state, "ok", "Audit report exported", file);
}

// ── Slash commands ────────────────────────────────────────────────────────────

async function handleSlashCommand(state: ShellState, input: string): Promise<void> {
  const [rawName, ...rest] = input.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase() ?? "";
  const args = rest.join(" ").trim();

  switch (name) {
    case "help":
    case "?":
      state.overlay = "help";
      state.helpSeen++;
      break;
    case "status":
      setView(state, "status");
      break;
    case "workspace":
    case "workspaces":
      state.overlay = "startup";
      state.startupSection = "workspace";
      setView(state, "workspaces");
      break;
    case "sessions":
      setView(state, "sessions");
      break;
    case "logs":
    case "audit":
      setView(state, "audit");
      break;
    case "context":
    case "memory":
      setView(state, "memory");
      break;
    case "activity":
      setView(state, "activity");
      break;
    case "research":
      setView(state, "research");
      break;
    case "home":
    case "overview":
      setView(state, "home");
      break;
    case "settings":
    case "config":
      setView(state, "settings");
      break;
    case "palette":
      state.overlay = "palette";
      state.paletteQuery = "";
      state.paletteIndex = 0;
      break;
    case "notifications":
    case "notice":
      state.overlay = "notifications";
      break;
    case "quick":
      state.overlay = "quick";
      break;
    case "models":
    case "local": {
      const { config } = loadConfig();
      const local: any = config.localModels;
      const runtime = local.runtime ?? "ollama";
      const status = await detectRuntime(runtime);
      appendMessage(state, "assistant", [
        "Local models",
        `• runtime: ${status.label} (${status.id})`,
        `• selected: ${local.selected ?? config.defaults.model ?? "none"}`,
        `• health: ${status.healthy ? "healthy" : status.running ? "running" : status.installed ? "installed" : "not found"}`,
        `• models: ${(status.models ?? []).slice(0, 6).join(", ") || "none"}`,
      ].join("\n"), "models");
      setView(state, "chat");
      break;
    }
    case "dashboard":
    case "serve":
      appendMessage(state, "assistant", "Run `xr serve` then open http://127.0.0.1:3141 for Control Center.", "guide");
      setView(state, "chat");
      break;
    case "mode": {
      const next = args as ModeState;
      if (!["agent", "plan", "ask"].includes(next)) {
        notify(state, "warn", "Usage", "/mode agent|plan|ask");
        break;
      }
      state.mode = next;
      const { config } = loadConfig();
      config.defaults.mode = next;
      saveConfig(config);
      notify(state, "ok", "Mode updated", next);
      break;
    }
    case "model": {
      const parts = args.split(/\s+/).filter(Boolean);
      if (!parts.length) {
        // No args → open the model overlay (discoverable switcher)
        state.overlay = "model";
        state.dirty = true;
        notify(state, "info", "Change model", `Active: ${state.provider} / ${state.model}`);
        break;
      }
      const provider = parts[0];
      if (!provider || !knownProviders().includes(provider)) {
        notify(state, "warn", "Unknown provider", knownProviders().join(", "));
        appendMessage(
          state,
          "assistant",
          `Unknown provider "${provider}".\nKnown: ${knownProviders().join(", ")}\n\nTry:\n  /model ollama qwen2.5:7b\n  /model openai gpt-4o-mini\n  xr providers list\n  xr models list`,
          "system",
        );
        break;
      }
      state.provider = provider;
      if (parts[1]) state.model = parts[1]!;
      const { config } = loadConfig();
      config.defaults.provider = state.provider;
      config.defaults.model = state.model;
      // Keep local selection aligned when primary is a local runtime
      if (provider === "ollama" || provider === "lmstudio" || provider === "jan" || provider === "localai" || provider === "vllm") {
        const local: any = config.localModels ?? {};
        local.enabled = true;
        local.selected = state.model;
        local.provider = provider;
        config.localModels = local;
      }
      saveConfig(config);
      notify(state, "ok", "Model updated", `${state.provider} / ${state.model}`);
      appendMessage(
        state,
        "assistant",
        `Active model is now ${state.provider} / ${state.model}.\nStatus bar and sidebar always show the current model.\nSwitch again with Alt+P or /model <provider> [model].`,
        "system",
      );
      break;
    }
    case "budget": {
      if (!args) {
        const { config } = loadConfig();
        const cost = state.store.costSummary();
        appendMessage(state, "assistant", [
          "Budget summary",
          `• per-task cap: ${config.budget.perTaskUsd > 0 ? `$${config.budget.perTaskUsd}` : "none"}`,
          `• total spent: $${cost.totalUsd.toFixed(4)}`,
          `• total tokens: ${cost.totalTokens.toLocaleString()}`,
        ].join("\n"), "budget");
        setView(state, "chat");
        break;
      }
      const next = Number.parseFloat(args);
      if (!Number.isFinite(next)) {
        notify(state, "warn", "Usage", "/budget 0.25");
        break;
      }
      state.budget = next;
      const { config } = loadConfig();
      config.budget.perTaskUsd = next;
      saveConfig(config);
      notify(state, "ok", "Budget updated", `$${next.toFixed(2)}`);
      break;
    }
    case "security-lab":
      await runSecurityLab(state);
      break;
    case "export-audit":
      await exportAudit(state);
      break;
    case "clear":
      state.chat = state.chat.slice(0, 1);
      notify(state, "info", "Chat cleared");
      break;
    case "inspect":
      state.showInspector = !state.showInspector;
      notify(state, "info", state.showInspector ? "Inspector shown" : "Inspector hidden");
      break;
    case "exit":
    case "quit":
      state.overlay = "exit";
      break;
    default:
      notify(state, "warn", "Unknown slash command", `/${name} — try /help`);
      break;
  }
  state.dirty = true;
}

// ── Memory capture ────────────────────────────────────────────────────────────

function renderCaptureOutcome(state: ShellState, outcome: CaptureOutcome): void {
  if (outcome.kind === "add") {
    if (outcome.ok && outcome.entry) appendMessage(state, "assistant", `✓ remembered: ${outcome.entry.content}`, "memory");
    else if (outcome.declined) appendMessage(state, "assistant", `Okay — I won't remember that.`, "memory");
    else if (outcome.duplicate) appendMessage(state, "assistant", `Already remembered — no duplicate created.`, "memory");
    else appendMessage(state, "assistant", `Could not store memory: ${outcome.reason ?? "unknown"}`, "memory");
  } else if (outcome.kind === "exclusion") {
    appendMessage(state, "assistant", `✓ got it — I won't remember that.`, "memory");
  } else if (outcome.kind === "forget") {
    appendMessage(state, "assistant", `✓ forgotten ${outcome.removed ?? 0} entr${(outcome.removed ?? 0) === 1 ? "y" : "ies"}.`, "memory");
  } else if (outcome.kind === "recall") {
    const entries = outcome.entries ?? [];
    appendMessage(
      state, "assistant",
      entries.length
        ? `Here's what I remember:\n${entries.slice(0, 6).map((e) => `• ${e.content}`).join("\n")}`
        : `I don't have anything relevant saved.`,
      "memory",
    );
  }
}

async function maybeCaptureMemory(state: ShellState, task: string): Promise<boolean> {
  const { config } = loadConfig();
  if (!isMemoryEnabled() || !config.memory.enabled) return false;
  const mem = new MemoryStore(state.store);
  const scope = projectScopeFromCwd(state.cwd);
  const explicitRemember = /^\s*remember\b/i.test(task);
  const outcome = await mem.captureIntentAsync(task, {
    scope,
    source: "chat",
    autoSuggest: false,
    confirm: async (prompt) =>
      explicitRemember ? await promptConfirm(state, "Store durable memory?", prompt, true) : true,
  });
  if (outcome.handled) {
    renderCaptureOutcome(state, outcome);
    notify(state, "ok", "Memory action handled");
    return true;
  }
  return false;
}

// ── Agent run ─────────────────────────────────────────────────────────────────

async function runTask(state: ShellState, task: string): Promise<void> {
  const { config } = loadConfig();
  if (await maybeCaptureMemory(state, task)) {
    setView(state, "chat");
    return;
  }

  appendMessage(state, "user", task, state.mode);
  state.sessionTitle = task.slice(0, 48);
  setView(state, "chat");
  state.busy = true;
  state.busyLabel = `connecting to ${state.provider}`;
  state.spinnerIndex = 0;
  state.dirty = true;

  const provider = buildProvider(config, { provider: state.provider, model: state.model });
  const health = await provider.health();
  if (!health.ok) {
    state.busy = false;
    notify(state, "error", `${state.provider} unavailable`, health.detail ?? "provider health check failed");
    appendMessage(state, "assistant", `Provider ${state.provider} is unreachable: ${health.detail ?? "unknown error"}. Try /model or start Ollama.`, "system");
    return;
  }

  notify(state, "ok", "Connected", `${state.provider}${health.latencyMs ? ` · ${health.latencyMs}ms` : ""}`);
  state.busyLabel = state.mode === "plan" ? "planning" : state.mode === "ask" ? "reading" : "thinking";

  const before = state.store.costSummary();
  const memoryEngine = new MemoryStore(state.store);
  const say = (line: string) => {
    const clean = cleanAgentLine(line);
    if (!clean) return;
    if (stripAnsi(line).includes("◆")) {
      updateOrAppendAssistantMessage(state, clean);
    } else {
      addTimeline(state, "info", clean);
    }
    state.dirty = true;
  };

  const result = await runAgent(task, state.mode, {
    provider,
    store: state.store,
    cwd: state.cwd,
    say,
    approve: async (req) => {
      return await promptConfirm(
        state,
        `Approve ${req.tool}?`,
        `${req.reason}${req.preview ? `\n\n${req.preview}` : ""}`,
        true,
      );
    },
    onOverBudget: async (meter, reason) => {
      const approved = await promptConfirm(
        state,
        "Budget ceiling reached",
        `${reason}\n\n${meter}\n\nRaise budget or switch to a local model.`,
        false,
      );
      return approved ? { usd: 0.10 } : null;
    },
    budget: {
      maxUsd: isLocal(state.provider) ? undefined : (state.budget > 0 ? state.budget : config.budget.perTaskUsd),
      maxTokens: config.budget.perTaskTokens,
    },
    pricing: priceFor(state.provider, state.model),
    egressAllowlist: config.security.egressAllowlist,
    dryRun: false,
    memory: {
      enabled: isMemoryEnabled() && config.memory.injectInChat,
      recallLimit: config.memory.recallLimit,
      semantic: config.memory.semanticRecall,
    },
    memoryStore: memoryEngine,
    sessionSummary: {
      enabled: isMemoryEnabled() && config.memory.saveSessionSummaries,
      minTurns: config.memory.sessionSummaryMinTurns,
    },
  } as AgentDeps);

  finalizeLiveAssistantMessage(state);
  const after = state.store.costSummary();
  state.totalSpent = after.totalUsd;
  state.totalTokens = after.totalTokens;
  state.busy = false;
  state.busyLabel = "idle";

  const deltaUsd = Math.max(0, after.totalUsd - before.totalUsd);
  if (result.stopped === "done") notify(state, "ok", "Task complete", `${result.steps} step(s) · $${deltaUsd.toFixed(4)}`);
  else if (result.stopped === "budget") notify(state, "warn", "Task paused by budget", result.finalMessage);
  else if (result.stopped === "approval") notify(state, "warn", "Task paused for approval", result.finalMessage);
  else notify(state, result.stopped === "error" ? "error" : "info", `Task ended: ${result.stopped}`, result.finalMessage);

  if (result.finalMessage && (!state.chat.length || state.chat[state.chat.length - 1]!.content !== result.finalMessage)) {
    appendMessage(state, "assistant", result.finalMessage, "XR");
  }
  refreshState(state);
}

// ── Input handling ────────────────────────────────────────────────────────────

function cycleMode(state: ShellState): void {
  const order: ModeState[] = ["agent", "plan", "ask"];
  const i = order.indexOf(state.mode);
  state.mode = order[(i + 1) % order.length]!;
  const { config } = loadConfig();
  config.defaults.mode = state.mode;
  saveConfig(config);
  notify(state, "ok", "Mode", state.mode);
}

function handleGChord(state: ShellState, ch: string): boolean {
  const map: Record<string, ShellViewId | "notices" | "settings"> = {
    d: "home",
    c: "chat",
    s: "sessions",
    w: "workspaces",
    r: "research",
    t: "activity",
    a: "audit",
    m: "memory",
    b: "status",
    x: "status",
    ".": "settings",
    n: "notices" as any,
  };
  const target = map[ch];
  state.gPending = false;
  if (state.gTimer) clearTimeout(state.gTimer);
  if (!target) {
    state.dirty = true;
    return true;
  }
  if (target === "notices") {
    state.overlay = "notifications";
  } else {
    setView(state, target as ShellViewId);
  }
  state.dirty = true;
  return true;
}

async function handleEnter(state: ShellState): Promise<void> {
  if (state.overlay === "palette") {
    const items = filteredPalette(state);
    const item = items[state.paletteIndex];
    if (item) await item.run();
    return;
  }
  if (state.overlay === "notifications" || state.overlay === "quick" || state.overlay === "help" || state.overlay === "model") {
    state.overlay = "none";
    state.dirty = true;
    return;
  }
  if (state.overlay === "mode") {
    state.overlay = "none";
    state.dirty = true;
    return;
  }
  if (state.overlay === "exit") {
    state.shouldExit = true;
    return;
  }
  if (state.overlay === "confirm" && state.confirm) {
    const resolver = state.confirm.resolve;
    const value = state.confirm.defaultYes;
    state.confirm = undefined;
    state.overlay = "none";
    resolver(value);
    state.dirty = true;
    return;
  }
  if (state.overlay === "startup") {
    if (state.startupSection === "workspace") {
      const selected = state.wm.listWorkspaces()[state.workspaceIndex];
      if (selected) await switchWorkspace(state, selected.id);
    } else {
      setView(state, "sessions");
    }
    state.overlay = "none";
    state.focus = "composer";
    state.dirty = true;
    return;
  }

  const value = state.input.trim();
  state.input = "";
  state.cursor = 0;
  if (!value) {
    state.dirty = true;
    return;
  }
  if (state.busy) {
    notify(state, "warn", "XR is already working", "Wait for the current run or interrupt with Esc/Ctrl+C.");
    return;
  }
  if (state.inputHistory[state.inputHistory.length - 1] !== value) state.inputHistory.push(value);
  state.inputHistoryIndex = -1;
  if (value.startsWith("/")) await handleSlashCommand(state, value);
  else await runTask(state, value);
}

function insertText(state: ShellState, text: string): void {
  const before = state.input.slice(0, state.cursor);
  const after = state.input.slice(state.cursor);
  state.input = before + text + after;
  state.cursor += text.length;
  state.dirty = true;
}

function deleteBackward(state: ShellState): void {
  if (state.cursor <= 0) return;
  state.input = state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor);
  state.cursor -= 1;
  state.dirty = true;
}

async function handleKey(state: ShellState, key: KeyEvent): Promise<void> {
  // Global: Ctrl+C
  if (key.name === "ctrl+c") {
    if (state.busy) {
      // interrupt is best-effort; agent may not support abort yet
      notify(state, "warn", "Interrupt requested", "Stopping current run when possible.");
      state.busy = false;
      state.busyLabel = "idle";
      finalizeLiveAssistantMessage(state);
      state.dirty = true;
      return;
    }
    if (state.overlay !== "none") {
      state.overlay = "none";
      state.dirty = true;
      return;
    }
    state.shouldExit = true;
    return;
  }

  // Confirm overlay
  if (state.overlay === "confirm" && state.confirm) {
    if (key.name === "enter" || key.char?.toLowerCase() === "y") {
      const resolve = state.confirm.resolve;
      const value = key.char?.toLowerCase() === "y" ? true : state.confirm.defaultYes;
      state.confirm = undefined;
      state.overlay = "none";
      resolve(value);
      state.dirty = true;
      return;
    }
    if (key.char?.toLowerCase() === "n" || key.name === "esc") {
      const resolve = state.confirm.resolve;
      state.confirm = undefined;
      state.overlay = "none";
      resolve(false);
      state.dirty = true;
      return;
    }
    return;
  }

  // Exit overlay
  if (state.overlay === "exit") {
    if (key.name === "enter" || key.char?.toLowerCase() === "y") {
      state.shouldExit = true;
      return;
    }
    if (key.name === "esc" || key.char?.toLowerCase() === "n") {
      state.overlay = "none";
      state.exitArmed = false;
      state.dirty = true;
      return;
    }
    return;
  }

  // Esc priority: overlay → interrupt → collapse → exit prompt
  if (key.name === "esc") {
    if (state.overlay !== "none") {
      state.overlay = "none";
      state.confirm = undefined;
      state.dirty = true;
      return;
    }
    if (state.busy) {
      state.busy = false;
      state.busyLabel = "idle";
      finalizeLiveAssistantMessage(state);
      notify(state, "warn", "Interrupted");
      return;
    }
    if (state.focus !== "composer") {
      state.focus = "composer";
      state.dirty = true;
      return;
    }
    state.overlay = "exit";
    state.dirty = true;
    return;
  }

  // Global chords
  if (key.name === "ctrl+k") {
    state.overlay = "palette";
    state.paletteQuery = "";
    state.paletteIndex = 0;
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+n") {
    state.overlay = state.overlay === "notifications" ? "none" : "notifications";
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+w") {
    state.overlay = "startup";
    state.startupSection = "workspace";
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+j") {
    state.overlay = state.overlay === "quick" ? "none" : "quick";
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+l") {
    state.chat = state.chat.slice(0, 1);
    notify(state, "info", "Chat cleared");
    return;
  }
  if (key.name === "ctrl+d") {
    if (!state.input) {
      state.overlay = "exit";
      state.dirty = true;
    }
    return;
  }
  if (key.name === "alt+p") {
    state.overlay = "model";
    state.dirty = true;
    return;
  }
  if (key.name === "shift+tab") {
    cycleMode(state);
    return;
  }

  // g-chord
  if (state.gPending && key.name === "char" && key.char) {
    handleGChord(state, key.char);
    return;
  }
  if (key.name === "char" && key.char === "g" && state.overlay === "none" && state.focus !== "composer" && !state.input) {
    state.gPending = true;
    if (state.gTimer) clearTimeout(state.gTimer);
    state.gTimer = setTimeout(() => { state.gPending = false; state.dirty = true; }, 1000);
    state.dirty = true;
    return;
  }
  if (key.name === "char" && key.char === "?" && state.overlay === "none" && !state.input) {
    state.overlay = "help";
    state.helpSeen++;
    state.dirty = true;
    return;
  }
  if (key.name === "char" && key.char === "/" && state.overlay === "none" && state.focus !== "composer" && !state.input) {
    state.focus = "composer";
    state.dirty = true;
    return;
  }

  // Palette input
  if (state.overlay === "palette") {
    if (key.name === "up") {
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      state.dirty = true;
      return;
    }
    if (key.name === "down") {
      const items = filteredPalette(state);
      state.paletteIndex = Math.min(Math.max(0, items.length - 1), state.paletteIndex + 1);
      state.dirty = true;
      return;
    }
    if (key.name === "enter") {
      await handleEnter(state);
      return;
    }
    if (key.name === "backspace") {
      state.paletteQuery = state.paletteQuery.slice(0, -1);
      state.paletteIndex = 0;
      state.dirty = true;
      return;
    }
    if (key.name === "char" && key.char) {
      state.paletteQuery += key.char;
      state.paletteIndex = 0;
      state.dirty = true;
      return;
    }
    if (key.name === "paste" && key.paste) {
      state.paletteQuery += key.paste;
      state.dirty = true;
      return;
    }
    return;
  }

  // Startup overlay navigation
  if (state.overlay === "startup") {
    if (key.name === "tab") {
      state.startupSection = state.startupSection === "workspace" ? "session" : "workspace";
      state.dirty = true;
      return;
    }
    if (key.name === "up") {
      if (state.startupSection === "workspace") state.workspaceIndex = Math.max(0, state.workspaceIndex - 1);
      else state.sessionIndex = Math.max(0, state.sessionIndex - 1);
      state.dirty = true;
      return;
    }
    if (key.name === "down") {
      if (state.startupSection === "workspace") {
        state.workspaceIndex = Math.min(Math.max(0, state.wm.listWorkspaces().length - 1), state.workspaceIndex + 1);
      } else {
        state.sessionIndex = Math.min(Math.max(0, state.sessions.slice(0, 6).length - 1), state.sessionIndex + 1);
      }
      state.dirty = true;
      return;
    }
    if (key.name === "enter") {
      await handleEnter(state);
      return;
    }
    return;
  }

  // Other overlays: enter dismisses
  if (state.overlay !== "none") {
    if (key.name === "enter") {
      await handleEnter(state);
      return;
    }
    return;
  }

  // Tab: cycle focus when composer empty; else (future) complete
  if (key.name === "tab") {
    if (!state.input) {
      const order: ShellState["focus"][] = ["composer", "sidebar", "main", "inspector"];
      const i = order.indexOf(state.focus);
      state.focus = order[(i + 1) % order.length]!;
      state.dirty = true;
      return;
    }
    // slash complete stub
    if (state.input.startsWith("/") && !state.input.includes(" ")) {
      const cmds = ["help", "status", "mode", "model", "budget", "sessions", "workspace", "audit", "memory", "research", "clear", "exit"];
      const partial = state.input.slice(1).toLowerCase();
      const match = cmds.find((c) => c.startsWith(partial));
      if (match) {
        state.input = `/${match} `;
        state.cursor = state.input.length;
        state.dirty = true;
      }
    }
    return;
  }

  // Sidebar navigation
  if (state.focus === "sidebar") {
    if (key.name === "up" || key.char === "k") {
      state.sidebarIndex = (state.sidebarIndex - 1 + SHELL_VIEW_ORDER.length) % SHELL_VIEW_ORDER.length;
      state.view = SHELL_VIEW_ORDER[state.sidebarIndex]!;
      state.dirty = true;
      return;
    }
    if (key.name === "down" || key.char === "j") {
      state.sidebarIndex = (state.sidebarIndex + 1) % SHELL_VIEW_ORDER.length;
      state.view = SHELL_VIEW_ORDER[state.sidebarIndex]!;
      state.dirty = true;
      return;
    }
    if (key.name === "enter") {
      state.focus = "composer";
      state.dirty = true;
      return;
    }
  }

  // Main list navigation
  if (state.focus === "main") {
    if (state.view === "sessions") {
      if (key.name === "up" || key.char === "k") {
        state.sessionIndex = Math.max(0, state.sessionIndex - 1);
        state.dirty = true;
        return;
      }
      if (key.name === "down" || key.char === "j") {
        state.sessionIndex = Math.min(Math.max(0, state.sessions.length - 1), state.sessionIndex + 1);
        state.dirty = true;
        return;
      }
    }
    if (state.view === "workspaces") {
      if (key.name === "up" || key.char === "k") {
        state.workspaceIndex = Math.max(0, state.workspaceIndex - 1);
        state.dirty = true;
        return;
      }
      if (key.name === "down" || key.char === "j") {
        state.workspaceIndex = Math.min(Math.max(0, state.wm.listWorkspaces().length - 1), state.workspaceIndex + 1);
        state.dirty = true;
        return;
      }
      if (key.name === "enter") {
        const ws = state.wm.listWorkspaces()[state.workspaceIndex];
        if (ws) await switchWorkspace(state, ws.id);
        return;
      }
    }
  }

  // Composer readline
  if (key.name === "enter") {
    await handleEnter(state);
    return;
  }
  if (key.name === "backspace") {
    // ensure focus composer on edit
    state.focus = "composer";
    deleteBackward(state);
    return;
  }
  if (key.name === "ctrl+a") {
    state.cursor = 0;
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+e") {
    state.cursor = state.input.length;
    state.dirty = true;
    return;
  }
  if (key.name === "ctrl+u") {
    state.input = state.input.slice(state.cursor);
    state.cursor = 0;
    state.dirty = true;
    return;
  }
  if (key.name === "left") {
    state.cursor = Math.max(0, state.cursor - 1);
    state.focus = "composer";
    state.dirty = true;
    return;
  }
  if (key.name === "right") {
    state.cursor = Math.min(state.input.length, state.cursor + 1);
    state.focus = "composer";
    state.dirty = true;
    return;
  }
  if (key.name === "up" || key.name === "ctrl+p") {
    if (state.focus === "composer") {
      const next = state.inputHistory.length - 1 - (state.inputHistoryIndex + 1);
      if (next >= 0) {
        state.inputHistoryIndex += 1;
        state.input = state.inputHistory[state.inputHistory.length - 1 - state.inputHistoryIndex] ?? state.input;
        state.cursor = state.input.length;
        state.dirty = true;
      }
      return;
    }
  }
  if (key.name === "down") {
    if (state.focus === "composer") {
      if (state.inputHistoryIndex > 0) {
        state.inputHistoryIndex -= 1;
        state.input = state.inputHistory[state.inputHistory.length - 1 - state.inputHistoryIndex] ?? "";
        state.cursor = state.input.length;
      } else if (state.inputHistoryIndex === 0) {
        state.inputHistoryIndex = -1;
        state.input = "";
        state.cursor = 0;
      }
      state.dirty = true;
      return;
    }
  }
  if (key.name === "paste" && key.paste != null) {
    state.focus = "composer";
    insertText(state, key.paste);
    return;
  }
  if (key.name === "char" && key.char) {
    // Any printable refocuses composer (Lazygit-style)
    state.focus = "composer";
    insertText(state, key.char);
    return;
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function runShell(): Promise<void> {
  const term = new Terminal();
  if (!term.isTTY) {
    process.stdout.write("XR: fullscreen Shell requires an interactive terminal.\nRun `xr help` or pass a task directly.\n");
    return;
  }

  const state = createState();
  refreshState(state);

  term.enter({ altScreen: true, bracketedPaste: true, mouse: false });

  const paint = () => {
    const geom = computeLayout(term.cols, term.rows, state.showInspector);
    const items = filteredPalette(state).map((i) => ({
      label: i.label,
      description: i.description,
      shortcut: i.shortcut,
    }));
    const frame = assembleFrame(state, geom, items);
    term.paint(frame);
    state.dirty = false;
  };

  // Startup animation (real phases, no artificial delay past readiness)
  const frames = 6;
  for (let i = 0; i < frames; i++) {
    state.bootPhase = i;
    state.spinnerIndex = i;
    state.overlay = "startup";
    paint();
    await new Promise((r) => setTimeout(r, 110));
  }
  state.bootPhase = 6;

  term.onInput(async (data) => {
    const key = parseKey(data);
    await handleKey(state, key);
    if (state.dirty) paint();
  });

  term.onResizeEvent(() => {
    term.invalidate();
    state.dirty = true;
    paint();
  });

  // Spinner ticker only when busy or startup
  const ticker = setInterval(() => {
    if (state.busy || state.overlay === "startup") {
      state.spinnerIndex = (state.spinnerIndex + 1) % SPINNER_FRAMES.length;
      state.dirty = true;
    }
    // expire notices after 4s for non-errors
    const now = Date.now();
    const before = state.notices.length;
    state.notices = state.notices.filter((n) =>
      n.level === "error" || now - n.at < 4000,
    );
    if (state.notices.length !== before) state.dirty = true;
    if (state.dirty) paint();
  }, 120);

  paint();

  while (!state.shouldExit) {
    await new Promise((r) => setTimeout(r, 40));
  }

  clearInterval(ticker);
  if (state.gTimer) clearTimeout(state.gTimer);
  term.leave();
  process.stdout.write(`\n  ✓ XR session closed. Thanks for using XR.\n\n`);
}
