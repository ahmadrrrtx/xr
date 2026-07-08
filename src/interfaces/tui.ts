/**
 * XR 3.1 — Fullscreen TUI Shell
 *
 * This replaces the older inline prompt loop with a dedicated fullscreen
 * terminal workspace. The goal is product feel, not a debug REPL.
 *
 * Highlights:
 *  - launches in the terminal alternate screen
 *  - animated startup built from official XR logo + avatar assets
 *  - startup workspace/session picker
 *  - sidebar, inspector, activity timeline, logs, notifications, command palette
 *  - single composer at the bottom for chat and slash commands
 *  - keyboard-first navigation with graceful non-TTY fallback
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig, saveConfig, isMemoryEnabled } from "../config/config.ts";
import { buildProvider, knownProviders } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { Store } from "../state/db.ts";
import { MemoryStore, projectScopeFromCwd, type CaptureOutcome } from "../memory/store.ts";
import { detectRuntime } from "../local/runtimes.ts";
import { loadSkills } from "../skills/loader.ts";
import { runLab } from "../security/lab.ts";
import { buildAuditReport } from "../export/report.ts";
import { runAgent, type AgentResult, type AgentDeps } from "../core/agent.ts";
import {
  A,
  xrCyan,
  xrGreen,
  xrAmber,
  xrRed,
  xrDim,
  xrBold,
  SYM,
  SPINNER_FRAMES,
} from "../ui/theme.ts";
import {
  padAnsi,
  renderCompactBrand,
  renderOfficialBannerFrame,
  resetAnsi,
  stripAnsi,
  visibleLength,
} from "../ui/brand.ts";
import { WorkspaceManager } from "../core/workspace.ts";

const VIEW_ORDER = ["home", "chat", "sessions", "workspaces", "context", "activity", "logs", "settings"] as const;
type ViewId = typeof VIEW_ORDER[number];
type OverlayId = "none" | "startup" | "palette" | "notifications" | "quick" | "confirm";

type ModeState = "agent" | "plan" | "ask";

type Severity = "info" | "ok" | "warn" | "error";

interface ProjectMeta {
  name: string;
  techStack?: string[];
  frameworks?: string[];
  conventions?: string[];
  testingFramework?: string;
  description?: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
  meta?: string;
}

interface TimelineEvent {
  at: number;
  title: string;
  detail?: string;
  level: Severity;
}

interface Notice {
  id: string;
  title: string;
  detail?: string;
  level: Severity;
  at: number;
}

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  run: () => Promise<void> | void;
}

interface ConfirmState {
  title: string;
  detail?: string;
  defaultYes: boolean;
  resolve: (value: boolean) => void;
}

interface SessionRow {
  id: string;
  title: string;
  mode: string;
  status: string;
  created_at: number;
}

interface ResearchRow {
  id: string;
  topic: string;
  depth: string;
  status: string;
  updated_at: number;
}

interface TuiState {
  cwd: string;
  meta: ProjectMeta;
  wm: WorkspaceManager;
  store: Store;
  workspaceId: string;
  provider: string;
  model: string;
  mode: ModeState;
  budget: number;
  totalSpent: number;
  totalTokens: number;
  busy: boolean;
  busyLabel: string;
  spinnerIndex: number;
  view: ViewId;
  sidebarIndex: number;
  overlay: OverlayId;
  input: string;
  inputHistory: string[];
  inputHistoryIndex: number;
  chat: ChatMessage[];
  timeline: TimelineEvent[];
  notices: Notice[];
  paletteQuery: string;
  paletteIndex: number;
  startupSection: "workspace" | "session";
  workspaceIndex: number;
  sessionIndex: number;
  sessions: SessionRow[];
  research: ResearchRow[];
  confirm?: ConfirmState;
  shouldExit: boolean;
  dirty: boolean;
}

function loadProjectMeta(cwd: string): ProjectMeta {
  const name = basename(cwd);
  const candidates = [join(cwd, "xr.md"), join(cwd, ".xrrc"), join(cwd, ".xrrc.md"), join(cwd, "CLAUDE.md")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      const meta: ProjectMeta = { name };
      const stackM = content.match(/tech[- ]?stack\s*[:–]\s*(.+)/i);
      if (stackM) meta.techStack = stackM[1].split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      const fwM = content.match(/framework[s]?\s*[:–]\s*(.+)/i);
      if (fwM) meta.frameworks = fwM[1].split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      const descM = content.match(/description\s*[:–]\s*(.+)/i);
      if (descM) meta.description = descM[1].trim();
      return meta;
    } catch {
      break;
    }
  }
  return { name };
}

function safeColumns(): number {
  return Math.max(96, process.stdout.columns || 120);
}

function safeRows(): number {
  return Math.max(30, process.stdout.rows || 40);
}

function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleLength(text) <= width) return padAnsi(text, width);
  const plain = stripAnsi(text);
  return plain.slice(0, Math.max(0, width - 1)) + "…";
}

function wrap(text: string, width: number): string[] {
  if (width <= 4) return [text.slice(0, width)];
  const input = text.replace(/\r/g, "");
  const out: string[] = [];
  for (const rawLine of input.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= width) {
        line = next;
      } else {
        if (line) out.push(line);
        if (word.length <= width) {
          line = word;
        } else {
          for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
          line = "";
        }
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

function hline(width: number, ch = "─"): string {
  return ch.repeat(Math.max(0, width));
}

function boxLines(title: string, lines: string[], width: number): string[] {
  const inner = Math.max(8, width - 4);
  const head = `┌─ ${clip(title, inner - 2).trimEnd()}${hline(Math.max(0, inner - visibleLength(title) - 2))}┐`;
  const body = lines.map((line) => `│ ${padAnsi(clip(line, inner), inner)} │`);
  const foot = `└${hline(inner + 2)}┘`;
  return [head, ...body, foot];
}

function normalizeNoticeLevel(level: Severity): string {
  return level === "ok"
    ? xrGreen("ok")
    : level === "warn"
      ? xrAmber("warn")
      : level === "error"
        ? xrRed("error")
        : xrCyan("info");
}

function timelineIcon(level: Severity): string {
  return level === "ok" ? xrGreen("✓") : level === "warn" ? xrAmber("!") : level === "error" ? xrRed("✗") : xrCyan("•");
}

function gitSummary(cwd: string): { branch: string; dirty: boolean; aheadBehind?: string } {
  try {
    const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" });
    const status = spawnSync("git", ["status", "--porcelain", "--branch"], { cwd, encoding: "utf8" });
    if (branch.status !== 0 || status.status !== 0) return { branch: "no git", dirty: false };
    const lines = status.stdout.trim().split("\n").filter(Boolean);
    const header = lines[0] ?? "";
    const dirty = lines.slice(1).length > 0;
    const aheadBehind = header.includes("...") ? header.split("...")[1] : undefined;
    return { branch: branch.stdout.trim(), dirty, aheadBehind };
  } catch {
    return { branch: "no git", dirty: false };
  }
}

function humanTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function humanDate(ts: number): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function addTimeline(state: TuiState, level: Severity, title: string, detail?: string): void {
  state.timeline.unshift({ at: Date.now(), title, detail, level });
  state.timeline = state.timeline.slice(0, 80);
  state.dirty = true;
}

function notify(state: TuiState, level: Severity, title: string, detail?: string): void {
  state.notices.unshift({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), title, detail, level });
  state.notices = state.notices.slice(0, 20);
  addTimeline(state, level, title, detail);
}

function currentSpinner(state: TuiState): string {
  return SPINNER_FRAMES[state.spinnerIndex % SPINNER_FRAMES.length] ?? "·";
}

function loadSessions(store: Store): SessionRow[] {
  try {
    return store.recentSessions(12);
  } catch {
    return [];
  }
}

function loadResearch(store: Store): ResearchRow[] {
  try {
    return store.listResearch(8);
  } catch {
    return [];
  }
}

function createState(): TuiState {
  const { config } = loadConfig();
  const wm = new WorkspaceManager();
  const workspaceId = wm.getActiveId();
  const store = wm.getStore(workspaceId);
  return {
    cwd: process.cwd(),
    meta: loadProjectMeta(process.cwd()),
    wm,
    store,
    workspaceId,
    provider: config.defaults.provider ?? "ollama",
    model: config.defaults.model ?? "qwen2.5:7b",
    mode: (config.defaults.mode as ModeState) ?? "agent",
    budget: config.budget.perTaskUsd ?? 0,
    totalSpent: store.costSummary().totalUsd,
    totalTokens: store.costSummary().totalTokens,
    busy: false,
    busyLabel: "idle",
    spinnerIndex: 0,
    view: "home",
    sidebarIndex: 0,
    overlay: "startup",
    input: "",
    inputHistory: [],
    inputHistoryIndex: -1,
    chat: [
      {
        role: "assistant",
        at: Date.now(),
        meta: "XR · fullscreen shell",
        content: "Welcome to XR. This shell unifies chat, sessions, context, logs, and workspace control in one place.",
      },
    ],
    timeline: [],
    notices: [],
    paletteQuery: "",
    paletteIndex: 0,
    startupSection: "workspace",
    workspaceIndex: 0,
    sessionIndex: 0,
    sessions: loadSessions(store),
    research: loadResearch(store),
    shouldExit: false,
    dirty: true,
  };
}

function refreshState(state: TuiState): void {
  state.sessions = loadSessions(state.store);
  state.research = loadResearch(state.store);
  const summary = state.store.costSummary();
  state.totalSpent = summary.totalUsd;
  state.totalTokens = summary.totalTokens;
  state.dirty = true;
}

async function switchWorkspace(state: TuiState, workspaceId: string): Promise<void> {
  state.workspaceId = workspaceId;
  state.store.close();
  state.store = state.wm.getStore(workspaceId);
  refreshState(state);
  notify(state, "ok", `Workspace switched`, workspaceId);
}

function appendMessage(state: TuiState, role: ChatMessage["role"], content: string, meta?: string): void {
  state.chat.push({ role, content, meta, at: Date.now() });
  state.chat = state.chat.slice(-120);
  state.dirty = true;
}

function updateOrAppendAssistantMessage(state: TuiState, content: string): void {
  const last = state.chat[state.chat.length - 1];
  if (last && last.role === "assistant" && last.meta === "live") {
    last.content = content;
    last.at = Date.now();
  } else {
    state.chat.push({ role: "assistant", content, at: Date.now(), meta: "live" });
  }
  state.dirty = true;
}

function finalizeLiveAssistantMessage(state: TuiState): void {
  const last = state.chat[state.chat.length - 1];
  if (last && last.role === "assistant" && last.meta === "live") {
    last.meta = "XR";
  }
}

function cleanAgentLine(line: string): string {
  return stripAnsi(line)
    .replace(/^▸\s*/, "")
    .replace(/^◆\s*/, "")
    .replace(/^\s*[✓✗!•]\s*/, "")
    .trim();
}

function renderCaptureOutcome(state: TuiState, outcome: CaptureOutcome): void {
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
      state,
      "assistant",
      entries.length ? `Here's what I remember:\n${entries.slice(0, 6).map((e) => `• ${e.content}`).join("\n")}` : `I don't have anything relevant saved.`,
      "memory",
    );
  }
}

function statusCards(state: TuiState): string[] {
  const { config } = loadConfig();
  const git = gitSummary(state.cwd);
  const mem = new MemoryStore(state.store);
  const memoryHealth = mem.health();
  const providerTag = isLocal(state.provider) ? xrGreen(state.provider) : xrAmber(state.provider);
  const approvals = config.security.requireApproval?.length ?? 0;
  const rows = [
    `${xrDim("workspace")} ${xrCyan(state.workspaceId)}`,
    `${xrDim("cwd")} ${state.cwd}`,
    `${xrDim("provider")} ${providerTag}`,
    `${xrDim("model")} ${xrDim(state.model)}`,
    `${xrDim("mode")} ${xrCyan(state.mode)}`,
    `${xrDim("budget")} ${state.budget > 0 ? xrAmber(`$${state.totalSpent.toFixed(4)} / $${state.budget.toFixed(2)}`) : (isLocal(state.provider) ? xrGreen("local / free") : xrDim("uncapped"))}`,
    `${xrDim("memory")} ${config.memory.enabled ? xrGreen(`${memoryHealth.total} entries`) : xrRed("disabled")}`,
    `${xrDim("research")} ${xrCyan(`${state.research.length} recent`)}`,
    `${xrDim("voice")} ${config.voice.enabled ? xrGreen(config.voice.mode) : xrDim("off")}`,
    `${xrDim("permissions")} ${approvals > 0 ? xrAmber(`${approvals} gates`) : xrGreen("relaxed")}`,
    `${xrDim("plugins")} ${config.plugins.enabled ? xrGreen("enabled") : xrDim("off")}`,
    `${xrDim("mcp")} ${config.mcpServers.length ? xrCyan(`${config.mcpServers.length} server(s)`) : xrDim("none")}`,
    `${xrDim("git")} ${git.dirty ? xrAmber(`${git.branch} • dirty`) : xrGreen(`${git.branch} • clean`)}`,
    `${xrDim("agent")} ${state.busy ? xrCyan(`${currentSpinner(state)} ${state.busyLabel}`) : xrDim("idle")}`,
  ];
  return boxLines("Mission status", rows, 34);
}

function renderHome(state: TuiState, width: number, height: number): string[] {
  const leftCol = Math.max(44, Math.floor(width * 0.55));
  const rightCol = Math.max(28, width - leftCol - 3);
  const lines: string[] = [];
  const brand = renderCompactBrand();
  lines.push(`${brand[0]}  ${xrBold("XR")}${xrDim(" — ")}${xrCyan("AI Operating System")}`);
  lines.push(`${brand[1]}  ${xrDim("smooth startup · coherent surfaces · local-first trust")}`);
  lines.push("");

  const recentSessions = state.sessions.slice(0, 5).map((s) => `${xrDim(humanDate(s.created_at))} ${xrBold(s.title.slice(0, 26))} ${xrDim(`(${s.mode}/${s.status})`)}`);
  const recentResearch = state.research.slice(0, 4).map((r) => `${xrDim(humanDate(r.updated_at))} ${r.topic.slice(0, 28)} ${xrDim(`(${r.status})`)}`);
  const workspaces = state.wm.listWorkspaces().slice(0, 6).map((w) => `${w.id === state.workspaceId ? xrGreen("●") : xrDim("○")} ${w.id} ${xrDim(w.name)}`);
  const perf = [
    `${xrDim("spent")}: $${state.totalSpent.toFixed(4)}`,
    `${xrDim("tokens")}: ${state.totalTokens.toLocaleString()}`,
    `${xrDim("audit")}: ${state.store.auditCount()} entries`,
    `${xrDim("skills")}: ${state.store.skillCount()} learned / ${state.store.frozenCount()} frozen`,
  ];

  const leftBlock = [
    ...boxLines("Recent sessions", recentSessions.length ? recentSessions : [xrDim("No sessions yet")], leftCol),
    "",
    ...boxLines("Recent research", recentResearch.length ? recentResearch : [xrDim("No research runs yet")], leftCol),
    "",
    ...boxLines("Workspaces", workspaces, leftCol),
  ];

  const rightBlock = [
    ...statusCards(state),
    "",
    ...boxLines("Performance", perf, rightCol),
    "",
    ...boxLines(
      "Quick actions",
      [
        `${xrCyan("Ctrl+K")} command palette`,
        `${xrCyan("Ctrl+N")} notifications`,
        `${xrCyan("Ctrl+J")} quick actions`,
        `${xrCyan("Ctrl+W")} workspace picker`,
        `${xrCyan("Tab")} cycle views`,
      ],
      rightCol,
    ),
  ];

  const total = Math.max(leftBlock.length, rightBlock.length);
  for (let i = 0; i < total; i++) {
    lines.push(`${padAnsi(leftBlock[i] ?? "", leftCol)}   ${rightBlock[i] ?? ""}`);
  }

  return lines.slice(0, height);
}

function messagePrefix(role: ChatMessage["role"]): string {
  if (role === "user") return xrCyan("you");
  if (role === "assistant") return xrGreen("xr");
  return xrDim("sys");
}

function renderChat(state: TuiState, width: number, height: number): string[] {
  const lines: string[] = [];
  const usable = Math.max(24, width - 2);
  const messages = state.chat.slice(-12);
  lines.push(`${xrBold("Chat session")}${xrDim(" · markdown-aware · tool timeline in inspector")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  for (const msg of messages) {
    const head = `${messagePrefix(msg.role)} ${xrDim(humanTime(msg.at))}${msg.meta ? xrDim(` · ${msg.meta}`) : ""}`;
    lines.push(head);
    for (const wrapped of wrap(msg.content, usable - 2)) lines.push(`  ${wrapped}`);
    lines.push("");
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderSessions(state: TuiState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Sessions & task history")}${xrDim(" · recent chats, tasks, and workflow runs")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  for (const [index, session] of state.sessions.entries()) {
    const selected = index === state.sessionIndex ? xrCyan("›") : xrDim(" ");
    lines.push(`${selected} ${xrBold(session.title.slice(0, 34))} ${xrDim(`#${session.id} · ${session.mode} · ${session.status} · ${humanDate(session.created_at)}`)}`);
  }
  if (!state.sessions.length) lines.push(xrDim("No sessions yet."));
  lines.push("");
  lines.push(xrBold("Recent research"));
  for (const run of state.research.slice(0, 6)) lines.push(`  ${run.topic.slice(0, 42)} ${xrDim(`${run.depth}/${run.status} · ${humanDate(run.updated_at)}`)}`);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderWorkspaces(state: TuiState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Workspace picker")}${xrDim(" · isolated context, memory, and audit lanes")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  for (const [index, ws] of state.wm.listWorkspaces().entries()) {
    const selected = index === state.workspaceIndex ? xrCyan("›") : xrDim(" ");
    const active = ws.id === state.workspaceId ? xrGreen("active") : xrDim("ready");
    lines.push(`${selected} ${xrBold(ws.id)} ${xrDim(ws.name)} ${xrDim("·")} ${active}`);
    lines.push(`    ${xrDim(ws.rootDir)}`);
  }
  lines.push("");
  lines.push(`${xrDim("Use Ctrl+W anywhere to reopen the picker. New workspaces are created with:")} ${xrCyan("xr workspace create <id>")}`);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderContext(state: TuiState, width: number, height: number): string[] {
  const mem = new MemoryStore(state.store);
  const memoryEntries = mem.list().slice(0, 8);
  const lines: string[] = [];
  lines.push(`${xrBold("Context viewer")}${xrDim(" · project metadata, memory, and local knowledge")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  lines.push(`${xrDim("project")} ${state.meta.name}`);
  if (state.meta.description) lines.push(...wrap(state.meta.description, width - 2));
  if (state.meta.techStack?.length) lines.push(`${xrDim("stack")} ${state.meta.techStack.join(", ")}`);
  if (state.meta.frameworks?.length) lines.push(`${xrDim("frameworks")} ${state.meta.frameworks.join(", ")}`);
  lines.push(`${xrDim("rag chunks")} ${state.store.ragCount(state.meta.name)}`);
  lines.push("");
  lines.push(xrBold("Memory"));
  if (!memoryEntries.length) lines.push(xrDim("No durable memory entries yet."));
  for (const entry of memoryEntries) lines.push(`  ${entry.category.padEnd(11)} ${entry.content.slice(0, Math.max(10, width - 18))}`);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderActivity(state: TuiState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Activity timeline")}${xrDim(" · tool calls, status, and runtime metrics")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  const cost = state.store.costSummary();
  lines.push(`${xrDim("total cost")} $${cost.totalUsd.toFixed(4)}`);
  lines.push(`${xrDim("total tokens")} ${cost.totalTokens.toLocaleString()}`);
  lines.push(`${xrDim("audit chain")} ${state.store.verifyChain().valid ? xrGreen("intact") : xrRed("broken")}`);
  lines.push(`${xrDim("background agent")} ${state.busy ? xrCyan(state.busyLabel) : xrDim("idle")}`);
  lines.push("");
  for (const event of state.timeline.slice(0, Math.max(0, height - 8))) {
    lines.push(`${timelineIcon(event.level)} ${xrDim(humanTime(event.at))} ${event.title}`);
    if (event.detail) lines.push(`  ${clip(event.detail, width - 4).trimEnd()}`);
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderLogs(state: TuiState, width: number, height: number): string[] {
  const entries = state.store.recentAudit(16);
  const lines: string[] = [];
  lines.push(`${xrBold("Logs viewer")}${xrDim(" · tamper-evident audit chain")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  for (const entry of entries) {
    lines.push(`${xrDim(humanDate(entry.created_at))} ${xrBold(entry.event)}`);
    const detail = stripAnsi(entry.detail).replace(/\s+/g, " ");
    lines.push(`  ${clip(detail, width - 4).trimEnd()}`);
  }
  if (!entries.length) lines.push(xrDim("No audit entries yet."));
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderSettings(state: TuiState, width: number, height: number): string[] {
  const { config } = loadConfig();
  const lines: string[] = [];
  lines.push(`${xrBold("Settings snapshot")}${xrDim(" · current configuration relevant to runtime UX")}`);
  lines.push(xrDim(hline(Math.max(20, width - 2))));
  lines.push(`${xrDim("provider")} ${config.defaults.provider}`);
  lines.push(`${xrDim("model")} ${config.defaults.model}`);
  lines.push(`${xrDim("fallback")} ${config.defaults.fallbackProvider ?? "none"}${config.defaults.fallbackModel ? ` / ${config.defaults.fallbackModel}` : ""}`);
  lines.push(`${xrDim("budget cap")} ${config.budget.perTaskUsd > 0 ? `$${config.budget.perTaskUsd}` : "none"}`);
  lines.push(`${xrDim("memory")} ${config.memory.enabled ? `enabled · inject=${config.memory.injectInChat}` : "disabled"}`);
  lines.push(`${xrDim("voice")} ${config.voice.enabled ? config.voice.mode : "off"}`);
  lines.push(`${xrDim("approvals")} ${(config.security.requireApproval ?? []).join(", ") || "none"}`);
  lines.push(`${xrDim("egress")} ${(config.security.egressAllowlist ?? []).join(", ") || "unrestricted"}`);
  lines.push("");
  lines.push(`${xrDim("Use slash commands to change active runtime ergonomics:")}`);
  lines.push(`  ${xrCyan("/mode agent|plan|ask")}`);
  lines.push(`  ${xrCyan("/budget 0.25")}`);
  lines.push(`  ${xrCyan("/model <provider> [model]")}`);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderCenter(state: TuiState, width: number, height: number): string[] {
  switch (state.view) {
    case "chat": return renderChat(state, width, height);
    case "sessions": return renderSessions(state, width, height);
    case "workspaces": return renderWorkspaces(state, width, height);
    case "context": return renderContext(state, width, height);
    case "activity": return renderActivity(state, width, height);
    case "logs": return renderLogs(state, width, height);
    case "settings": return renderSettings(state, width, height);
    case "home":
    default:
      return renderHome(state, width, height);
  }
}

function renderInspector(state: TuiState, width: number, height: number): string[] {
  const git = gitSummary(state.cwd);
  const entries = state.timeline.slice(0, 10);
  const lines: string[] = [];
  const mem = new MemoryStore(state.store);
  const health = mem.health();
  lines.push(...boxLines("Inspector", [
    `${xrDim("provider")} ${state.provider}`,
    `${xrDim("model")} ${state.model}`,
    `${xrDim("workspace")} ${state.workspaceId}`,
    `${xrDim("directory")} ${basename(state.cwd)}`,
    `${xrDim("git")} ${git.branch}${git.dirty ? " · dirty" : " · clean"}`,
    `${xrDim("memory")} ${health.total} total / ${health.expired} expired`,
    `${xrDim("research")} ${state.research.length} recent`,
    `${xrDim("tokens")} ${state.totalTokens.toLocaleString()}`,
    `${xrDim("spend")} $${state.totalSpent.toFixed(4)}`,
    `${xrDim("status")} ${state.busy ? `${currentSpinner(state)} ${state.busyLabel}` : "idle"}`,
  ], width));
  lines.push("");
  lines.push(...boxLines("Activity feed", entries.length ? entries.flatMap((event) => {
    const first = `${timelineIcon(event.level)} ${humanTime(event.at)} ${event.title}`;
    return event.detail ? [first, `  ${clip(event.detail, Math.max(10, width - 6)).trimEnd()}`] : [first];
  }) : [xrDim("No runtime activity yet")], width));
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderSidebar(state: TuiState, width: number, height: number): string[] {
  const rows: string[] = [];
  rows.push(xrBold("XR shell"));
  rows.push(xrDim("One product. Every surface."));
  rows.push("");
  for (const [index, view] of VIEW_ORDER.entries()) {
    const active = state.view === view;
    const focused = state.sidebarIndex === index;
    const marker = active ? xrCyan("●") : focused ? xrAmber("›") : xrDim("○");
    rows.push(`${marker} ${active ? xrBold(view) : view}`);
  }
  rows.push("");
  rows.push(xrBold("Status"));
  rows.push(`${xrDim("provider")} ${state.provider}`);
  rows.push(`${xrDim("mode")} ${state.mode}`);
  rows.push(`${xrDim("budget")} ${state.budget > 0 ? `$${state.budget}` : "free/local"}`);
  rows.push(`${xrDim("voice")} ${loadConfig().config.voice.enabled ? loadConfig().config.voice.mode : "off"}`);
  rows.push(`${xrDim("memory")} ${loadConfig().config.memory.enabled ? "on" : "off"}`);
  rows.push("");
  rows.push(xrBold("Keys"));
  rows.push(`${xrCyan("Tab")} next view`);
  rows.push(`${xrCyan("Ctrl+K")} palette`);
  rows.push(`${xrCyan("Ctrl+N")} notices`);
  rows.push(`${xrCyan("Esc")} dismiss`);
  while (rows.length < height) rows.push("");
  return rows.slice(0, height).map((line) => padAnsi(clip(line, width), width));
}

function renderComposer(state: TuiState, width: number): string[] {
  const prompt = `${xrBold(xrCyan("xr"))} ${xrDim("[")}${state.busy ? xrAmber("busy") : xrCyan(state.mode)}${xrDim("]")} ${xrCyan("›")}`;
  const contentWidth = Math.max(8, width - visibleLength(prompt) - 1);
  const wrappedInput = wrap(state.input || "", contentWidth).slice(0, 2);
  if (!wrappedInput.length) wrappedInput.push("");
  const first = `${prompt} ${wrappedInput[0] ?? ""}`;
  const second = `  ${wrappedInput[1] ?? xrDim("Type a task or /help")}`;
  const hint = xrDim("Ctrl+K palette · Ctrl+W workspaces · Ctrl+J quick actions · /help commands");
  return [clip(first, width), clip(second, width), clip(hint, width)];
}

function renderStatusBar(state: TuiState, width: number): string {
  const items = [
    `${isLocal(state.provider) ? xrGreen("local") : xrAmber("cloud")} ${state.provider}`,
    `${xrDim("model")} ${state.model}`,
    `${xrDim("workspace")} ${state.workspaceId}`,
    `${xrDim("spent")} $${state.totalSpent.toFixed(4)}`,
    `${xrDim("tokens")} ${state.totalTokens.toLocaleString()}`,
    `${xrDim("audit")} ${state.store.verifyChain().valid ? xrGreen("ok") : xrRed("broken")}`,
  ];
  return clip(items.join(` ${xrDim("│")} `), width);
}

function renderStartupOverlay(state: TuiState, width: number, height: number): string[] {
  const contentWidth = Math.min(88, width - 8);
  const workspaces = state.wm.listWorkspaces();
  const sessions = state.sessions;
  const lines: string[] = [];
  const art = renderOfficialBannerFrame(state.spinnerIndex);
  for (const line of art) lines.push(clip(line, contentWidth));
  lines.push("");
  lines.push(xrBold("Welcome to XR 3.1"));
  lines.push(xrDim("Select a workspace, glance at recent sessions, then press Enter to begin."));
  lines.push("");
  lines.push(xrBold(`${state.startupSection === "workspace" ? "[workspaces]" : " workspaces "}`));
  for (const [index, ws] of workspaces.entries()) {
    const marker = index === state.workspaceIndex && state.startupSection === "workspace" ? xrCyan("›") : xrDim(" ");
    const active = ws.id === state.workspaceId ? xrGreen("active") : xrDim("ready");
    lines.push(`${marker} ${ws.id.padEnd(14)} ${clip(active, 8).trimEnd()} ${xrDim(ws.name)}`);
  }
  lines.push("");
  lines.push(xrBold(`${state.startupSection === "session" ? "[sessions]" : " sessions "}`));
  if (sessions.length) {
    for (const [index, session] of sessions.slice(0, 6).entries()) {
      const marker = index === state.sessionIndex && state.startupSection === "session" ? xrCyan("›") : xrDim(" ");
      lines.push(`${marker} ${clip(session.title, 28).trimEnd()} ${xrDim(`${session.mode}/${session.status} · ${humanDate(session.created_at)}`)}`);
    }
  } else {
    lines.push(xrDim("  No sessions yet — your first task starts a new one."));
  }
  lines.push("");
  lines.push(xrDim("Tab switches lists · ↑/↓ move · Enter continues · Esc dismisses"));

  const boxed = boxLines("Startup", lines, contentWidth);
  const padTop = Math.max(1, Math.floor((height - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((width - contentWidth) / 2));
  const out: string[] = [];
  for (let i = 0; i < padTop; i++) out.push("");
  for (const row of boxed) out.push(`${" ".repeat(padLeft)}${row}`);
  return out;
}

function renderPalette(state: TuiState, width: number, height: number): string[] {
  const items = paletteItems(state).filter((item) => {
    const q = state.paletteQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [item.label, item.description, ...item.keywords].join(" ").toLowerCase();
    return hay.includes(q);
  });
  const view = items.slice(0, 10);
  const contentWidth = Math.min(72, width - 10);
  const lines = [`${xrBold("Command palette")}`, `${xrDim("Search commands, views, settings, and actions")}`, "", `${xrCyan("> ")}${state.paletteQuery || xrDim("type to search")}`, ""];
  for (const [index, item] of view.entries()) {
    const selected = index === state.paletteIndex ? xrCyan("›") : xrDim(" ");
    lines.push(`${selected} ${item.label}`);
    lines.push(`  ${xrDim(item.description)}`);
  }
  if (!view.length) lines.push(xrDim("No matches."));
  const boxed = boxLines("Universal search", lines, contentWidth);
  const padTop = Math.max(1, Math.floor((height - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((width - contentWidth) / 2));
  return [...Array.from({ length: padTop }, () => ""), ...boxed.map((row) => `${" ".repeat(padLeft)}${row}`)];
}

function renderNotificationsOverlay(state: TuiState, width: number, height: number): string[] {
  const contentWidth = Math.min(72, width - 10);
  const lines = [`${xrBold("Notification center")}`, `${xrDim("Recent runtime notices and recovery signals")}`, ""];
  if (!state.notices.length) lines.push(xrDim("No notifications yet."));
  for (const notice of state.notices.slice(0, 10)) {
    lines.push(`${timelineIcon(notice.level)} ${notice.title} ${xrDim(`· ${humanDate(notice.at)}`)}`);
    if (notice.detail) lines.push(`  ${notice.detail}`);
  }
  const boxed = boxLines("Notifications", lines, contentWidth);
  const padTop = Math.max(1, Math.floor((height - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((width - contentWidth) / 2));
  return [...Array.from({ length: padTop }, () => ""), ...boxed.map((row) => `${" ".repeat(padLeft)}${row}`)];
}

function renderQuickActionsOverlay(state: TuiState, width: number, height: number): string[] {
  const contentWidth = Math.min(64, width - 10);
  const lines = [
    `${xrBold("Floating quick actions")}`,
    `${xrDim("These are the highest-frequency operations in XR.")}`,
    "",
    `${xrCyan("/status")} inspect provider, budget, local runtime, and audit chain`,
    `${xrCyan("/workspace")} reopen the workspace picker`,
    `${xrCyan("/sessions")} jump to recent chats/tasks`,
    `${xrCyan("/logs")} inspect the audit chain and recent actions`,
    `${xrCyan("/export-audit")} create a signed markdown report in the cwd`,
    `${xrCyan("/security-lab")} run the injection benchmark`,
    `${xrCyan("/dashboard")} instructions for launching Mission Control`,
  ];
  const boxed = boxLines("Quick actions", lines, contentWidth);
  const padTop = Math.max(1, Math.floor((height - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((width - contentWidth) / 2));
  return [...Array.from({ length: padTop }, () => ""), ...boxed.map((row) => `${" ".repeat(padLeft)}${row}`)];
}

function renderConfirmOverlay(state: TuiState, width: number, height: number): string[] {
  const contentWidth = Math.min(68, width - 10);
  const lines = [state.confirm?.title ?? "Confirm action", "", ...(state.confirm?.detail ? wrap(state.confirm.detail, contentWidth - 6) : []), "", xrDim(`Enter/Y = ${state.confirm?.defaultYes ? "approve" : "deny default override"} · N/Esc = cancel`),];
  const boxed = boxLines("Approval", lines, contentWidth);
  const padTop = Math.max(1, Math.floor((height - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((width - contentWidth) / 2));
  return [...Array.from({ length: padTop }, () => ""), ...boxed.map((row) => `${" ".repeat(padLeft)}${row}`)];
}

function paletteItems(state: TuiState): PaletteItem[] {
  return [
    { id: "view-home", label: "Open Home", description: "Mission Control overview", keywords: ["dashboard", "mission", "overview"], run: () => { state.view = "home"; state.sidebarIndex = VIEW_ORDER.indexOf("home"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-chat", label: "Open Chat", description: "Conversation workspace", keywords: ["assistant", "messages"], run: () => { state.view = "chat"; state.sidebarIndex = VIEW_ORDER.indexOf("chat"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-sessions", label: "Open Sessions", description: "Recent tasks and chats", keywords: ["history", "recent"], run: () => { state.view = "sessions"; state.sidebarIndex = VIEW_ORDER.indexOf("sessions"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-workspaces", label: "Open Workspaces", description: "Switch isolated workspaces", keywords: ["projects", "contexts"], run: () => { state.view = "workspaces"; state.sidebarIndex = VIEW_ORDER.indexOf("workspaces"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-context", label: "Open Context Viewer", description: "Project memory and local knowledge", keywords: ["memory", "rag", "project"], run: () => { state.view = "context"; state.sidebarIndex = VIEW_ORDER.indexOf("context"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-activity", label: "Open Activity Timeline", description: "Live runtime actions and metrics", keywords: ["timeline", "metrics"], run: () => { state.view = "activity"; state.sidebarIndex = VIEW_ORDER.indexOf("activity"); state.overlay = "none"; state.dirty = true; } },
    { id: "view-logs", label: "Open Logs Viewer", description: "Recent audit events", keywords: ["audit", "security", "chain"], run: () => { state.view = "logs"; state.sidebarIndex = VIEW_ORDER.indexOf("logs"); state.overlay = "none"; state.dirty = true; } },
    { id: "notices", label: "Open Notification Center", description: "Inspect recent notices", keywords: ["toasts", "alerts"], run: () => { state.overlay = "notifications"; state.dirty = true; } },
    { id: "quick", label: "Open Quick Actions", description: "High-frequency XR actions", keywords: ["actions", "shortcuts"], run: () => { state.overlay = "quick"; state.dirty = true; } },
    { id: "workspace-picker", label: "Open Workspace Picker", description: "Reopen startup workspace selector", keywords: ["workspace", "project"], run: () => { state.overlay = "startup"; state.startupSection = "workspace"; state.dirty = true; } },
    { id: "serve", label: "Open Mission Control instructions", description: "How to launch xr serve", keywords: ["dashboard", "browser", "serve"], run: () => { appendMessage(state, "assistant", "Run `xr serve` in another terminal to launch the local dashboard and chat surfaces.", "guide"); state.overlay = "none"; state.view = "chat"; state.dirty = true; } },
    { id: "security-lab", label: "Run Security Lab", description: "Injection benchmark against XR", keywords: ["security", "attacks"], run: async () => { state.overlay = "none"; await runSecurityLab(state); } },
    { id: "audit-export", label: "Export Signed Audit Report", description: "Write xr-audit-*.md into the current directory", keywords: ["export", "audit", "report"], run: async () => { state.overlay = "none"; await exportAudit(state); } },
  ];
}

function promptConfirm(state: TuiState, title: string, detail?: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = { title, detail, defaultYes, resolve };
    state.overlay = "confirm";
    state.dirty = true;
  });
}

async function runSecurityLab(state: TuiState): Promise<void> {
  const { config } = loadConfig();
  const report = runLab({ egressAllowlist: config.security.egressAllowlist });
  const blockedPct = Math.round(report.rate * 100);
  appendMessage(state, "assistant", `Security lab: blocked ${report.blocked}/${report.total} attacks (${blockedPct}%).`, "security");
  notify(state, blockedPct >= 90 ? "ok" : blockedPct >= 70 ? "warn" : "error", "Security lab completed", `${report.blocked}/${report.total} blocked`);
}

async function exportAudit(state: TuiState): Promise<void> {
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

function buildBudgetSummary(state: TuiState): string {
  const { config } = loadConfig();
  const cost = state.store.costSummary();
  return [
    `Budget summary`,
    `• per-task cap: ${config.budget.perTaskUsd > 0 ? `$${config.budget.perTaskUsd}` : 'none'}`,
    `• total spent: $${cost.totalUsd.toFixed(4)}`,
    `• total tokens: ${cost.totalTokens.toLocaleString()}`,
    `• top model: ${cost.byModel[0] ? `${cost.byModel[0].model} ($${cost.byModel[0].usd.toFixed(4)})` : 'none yet'}`,
  ].join("\n");
}

async function buildModelsSummary(state: TuiState): Promise<string> {
  const { config } = loadConfig();
  const local: any = config.localModels;
  const runtime = local.runtime ?? "ollama";
  const status = await detectRuntime(runtime);
  return [
    `Local models`,
    `• runtime: ${status.label} (${status.id})`,
    `• selected: ${local.selected ?? config.defaults.model ?? 'none'}`,
    `• routing: ${local.routing ?? 'hybrid'}`,
    `• endpoint: ${status.baseUrl}`,
    `• health: ${status.healthy ? 'healthy' : status.running ? 'running' : status.installed ? 'installed' : 'not found'}`,
    `• detected models: ${(status.models ?? []).slice(0, 6).join(', ') || 'none'}`,
  ].join("\n");
}

function buildResearchSummary(state: TuiState): string {
  const recent = state.research.slice(0, 6);
  return recent.length
    ? ['Recent research', ...recent.map((r) => `• ${r.topic} (${r.depth}/${r.status})`)].join('\n')
    : 'No research runs yet. Use `xr research "topic"` or ask from chat.';
}

async function handleSlashCommand(state: TuiState, input: string): Promise<void> {
  const [rawName, ...rest] = input.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase() ?? "";
  const args = rest.join(" ").trim();
  switch (name) {
    case "help":
    case "?":
      appendMessage(
        state,
        "assistant",
        [
          "Slash commands:",
          "/help",
          "/status",
          "/workspace",
          "/sessions",
          "/logs",
          "/context",
          "/activity",
          "/home",
          "/palette",
          "/notifications",
          "/quick",
          "/models",
          "/research",
          "/dashboard",
          "/mode agent|plan|ask",
          "/model <provider> [model]",
          "/budget [usd]",
          "/security-lab",
          "/export-audit",
          "/clear",
          "/exit",
        ].join("\n"),
        "guide",
      );
      break;
    case "status":
      state.view = "home";
      state.sidebarIndex = VIEW_ORDER.indexOf("home");
      appendMessage(state, "assistant", statusCards(state).map(stripAnsi).join("\n"), "status");
      break;
    case "workspace":
    case "workspaces":
      state.overlay = "startup";
      state.startupSection = "workspace";
      state.view = "workspaces";
      state.sidebarIndex = VIEW_ORDER.indexOf("workspaces");
      break;
    case "sessions":
      state.view = "sessions";
      state.sidebarIndex = VIEW_ORDER.indexOf("sessions");
      break;
    case "logs":
      state.view = "logs";
      state.sidebarIndex = VIEW_ORDER.indexOf("logs");
      break;
    case "context":
    case "memory":
      state.view = "context";
      state.sidebarIndex = VIEW_ORDER.indexOf("context");
      break;
    case "activity":
      state.view = "activity";
      state.sidebarIndex = VIEW_ORDER.indexOf("activity");
      break;
    case "home":
      state.view = "home";
      state.sidebarIndex = VIEW_ORDER.indexOf("home");
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
    case "local":
      appendMessage(state, "assistant", await buildModelsSummary(state), "models");
      break;
    case "research":
      appendMessage(state, "assistant", buildResearchSummary(state), "research");
      break;
    case "dashboard":
      appendMessage(state, "assistant", "Run `xr serve` in another terminal, then open http://127.0.0.1:3141 .", "guide");
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
      const provider = parts[0];
      if (!provider || !knownProviders().includes(provider)) {
        notify(state, "warn", "Unknown provider", knownProviders().join(", "));
        break;
      }
      state.provider = provider;
      if (parts[1]) state.model = parts[1];
      const { config } = loadConfig();
      config.defaults.provider = state.provider;
      config.defaults.model = state.model;
      saveConfig(config);
      notify(state, "ok", "Provider updated", `${state.provider} / ${state.model}`);
      break;
    }
    case "budget": {
      if (!args) {
        appendMessage(state, "assistant", buildBudgetSummary(state), "budget");
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
    case "exit":
    case "quit":
      state.shouldExit = true;
      break;
    default:
      notify(state, "warn", "Unknown slash command", `/${name}`);
      break;
  }
  state.dirty = true;
}

async function maybeCaptureMemory(state: TuiState, task: string): Promise<boolean> {
  const { config } = loadConfig();
  if (!isMemoryEnabled() || !config.memory.enabled) return false;
  const mem = new MemoryStore(state.store);
  const scope = projectScopeFromCwd(state.cwd);
  const explicitRemember = /^\s*remember\b/i.test(task);
  const outcome = await mem.captureIntentAsync(task, {
    scope,
    source: "chat",
    autoSuggest: false,
    confirm: async (prompt) => explicitRemember ? await promptConfirm(state, "Store durable memory?", prompt, true) : true,
  });
  if (outcome.handled) {
    renderCaptureOutcome(state, outcome);
    notify(state, "ok", "Memory action handled");
    return true;
  }
  return false;
}

async function runTask(state: TuiState, task: string): Promise<void> {
  const { config } = loadConfig();
  if (await maybeCaptureMemory(state, task)) {
    state.view = "chat";
    state.sidebarIndex = VIEW_ORDER.indexOf("chat");
    return;
  }

  appendMessage(state, "user", task, state.mode);
  state.view = "chat";
  state.sidebarIndex = VIEW_ORDER.indexOf("chat");
  state.busy = true;
  state.busyLabel = `connecting to ${state.provider}`;
  state.spinnerIndex = 0;
  state.dirty = true;

  const provider = buildProvider(config, { provider: state.provider, model: state.model });
  const health = await provider.health();
  if (!health.ok) {
    state.busy = false;
    notify(state, "error", `${state.provider} unavailable`, health.detail ?? "provider health check failed");
    appendMessage(state, "assistant", `Provider ${state.provider} is unreachable: ${health.detail ?? "unknown error"}`, "system");
    return;
  }

  notify(state, "ok", `Connected`, `${state.provider}${health.latencyMs ? ` · ${health.latencyMs}ms` : ""}`);
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
      return await promptConfirm(state, `Approve ${req.tool}?`, `${req.reason}${req.preview ? `\n\n${req.preview}` : ""}`, true);
    },
    onOverBudget: async (meter, reason) => {
      const approved = await promptConfirm(state, "Budget ceiling reached", `${reason}\n\n${meter}\n\nRaise budget in settings later or switch to a local model.`, false);
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

  if (result.finalMessage && (!state.chat.length || state.chat[state.chat.length - 1].content !== result.finalMessage)) {
    appendMessage(state, "assistant", result.finalMessage, "XR");
  }
  refreshState(state);
}

function renderFrame(state: TuiState): string {
  const cols = safeColumns();
  const rows = safeRows();
  const sidebarW = 24;
  const inspectorW = cols >= 120 ? 34 : 28;
  const mainW = cols - sidebarW - inspectorW - 4;
  const headerH = 3;
  const composerH = 4;
  const statusH = 1;
  const bodyH = rows - headerH - composerH - statusH - 2;

  const header: string[] = [];
  header.push(`${xrBold("XR")}${xrDim(" · ")}${xrCyan("AI Operating System")}${xrDim(" · fullscreen shell")}`);
  header.push(clip(`${xrDim("workspace")} ${xrCyan(state.workspaceId)}  ${xrDim("cwd")} ${state.cwd}  ${xrDim("provider")} ${isLocal(state.provider) ? xrGreen(state.provider) : xrAmber(state.provider)}  ${xrDim("model")} ${state.model}`, cols));
  header.push(xrDim(hline(cols)));

  const sidebar = renderSidebar(state, sidebarW, bodyH);
  const center = renderCenter(state, mainW, bodyH);
  const inspector = renderInspector(state, inspectorW, bodyH);

  const body: string[] = [];
  for (let i = 0; i < bodyH; i++) {
    body.push(`${padAnsi(sidebar[i] ?? "", sidebarW)} │ ${padAnsi(center[i] ?? "", mainW)} │ ${padAnsi(inspector[i] ?? "", inspectorW)}`);
  }

  const composer = renderComposer(state, cols);
  const status = renderStatusBar(state, cols);

  const frameLines = [
    ...header,
    ...body,
    xrDim(hline(cols)),
    ...composer,
    status,
  ];

  if (state.overlay === "startup") {
    return `${A.clearScreen}${renderStartupOverlay(state, cols, rows).join("\n")}${resetAnsi()}`;
  }
  if (state.overlay === "palette") {
    return `${A.clearScreen}${renderPalette(state, cols, rows).join("\n")}${resetAnsi()}`;
  }
  if (state.overlay === "notifications") {
    return `${A.clearScreen}${renderNotificationsOverlay(state, cols, rows).join("\n")}${resetAnsi()}`;
  }
  if (state.overlay === "quick") {
    return `${A.clearScreen}${renderQuickActionsOverlay(state, cols, rows).join("\n")}${resetAnsi()}`;
  }
  if (state.overlay === "confirm") {
    return `${A.clearScreen}${renderConfirmOverlay(state, cols, rows).join("\n")}${resetAnsi()}`;
  }

  return `${A.clearScreen}${frameLines.join("\n")}${resetAnsi()}`;
}

function handlePrintable(state: TuiState, data: Buffer): void {
  const text = data.toString("utf8");
  state.input += text;
  state.dirty = true;
}

async function executePaletteSelection(state: TuiState): Promise<void> {
  const items = paletteItems(state).filter((item) => {
    const q = state.paletteQuery.trim().toLowerCase();
    if (!q) return true;
    return [item.label, item.description, ...item.keywords].join(" ").toLowerCase().includes(q);
  });
  const item = items[state.paletteIndex];
  if (!item) return;
  await item.run();
}

async function handleEnter(state: TuiState): Promise<void> {
  if (state.overlay === "palette") {
    await executePaletteSelection(state);
    return;
  }
  if (state.overlay === "notifications" || state.overlay === "quick") {
    state.overlay = "none";
    state.dirty = true;
    return;
  }
  if (state.overlay === "confirm" && state.confirm) {
    const resolver = state.confirm.resolve;
    state.overlay = "none";
    const value = state.confirm.defaultYes;
    state.confirm = undefined;
    resolver(value);
    state.dirty = true;
    return;
  }
  if (state.overlay === "startup") {
    if (state.startupSection === "workspace") {
      const selected = state.wm.listWorkspaces()[state.workspaceIndex];
      if (selected) await switchWorkspace(state, selected.id);
    } else {
      state.view = "sessions";
      state.sidebarIndex = VIEW_ORDER.indexOf("sessions");
    }
    state.overlay = "none";
    state.dirty = true;
    return;
  }

  const value = state.input.trim();
  state.input = "";
  if (!value) {
    state.dirty = true;
    return;
  }
  if (state.busy) {
    notify(state, "warn", "XR is already working", "Wait for the current run to finish or cancel with Ctrl+C.");
    return;
  }
  if (state.inputHistory[state.inputHistory.length - 1] !== value) state.inputHistory.push(value);
  state.inputHistoryIndex = -1;
  if (value.startsWith("/")) await handleSlashCommand(state, value);
  else await runTask(state, value);
}

function moveSidebar(state: TuiState, delta: number): void {
  state.sidebarIndex = (state.sidebarIndex + delta + VIEW_ORDER.length) % VIEW_ORDER.length;
  state.view = VIEW_ORDER[state.sidebarIndex] as ViewId;
  state.dirty = true;
}

async function handleData(state: TuiState, data: Buffer): Promise<void> {
  const bytes = Array.from(data);
  const text = data.toString("utf8");

  if (bytes.length === 1 && bytes[0] === 3) {
    state.shouldExit = true;
    return;
  }

  if (state.overlay === "confirm" && state.confirm) {
    const lower = text.toLowerCase();
    if (text === "\r" || text === "\n" || lower === "y") {
      const resolve = state.confirm.resolve;
      const value = state.confirm.defaultYes;
      state.confirm = undefined;
      state.overlay = "none";
      resolve(value);
      state.dirty = true;
      return;
    }
    if (lower === "n" || bytes[0] === 27) {
      const resolve = state.confirm.resolve;
      state.confirm = undefined;
      state.overlay = "none";
      resolve(false);
      state.dirty = true;
      return;
    }
  }

  // ctrl+k command palette
  if (bytes.length === 1 && bytes[0] === 11) {
    state.overlay = "palette";
    state.paletteQuery = "";
    state.paletteIndex = 0;
    state.dirty = true;
    return;
  }
  // ctrl+n notifications
  if (bytes.length === 1 && bytes[0] === 14) {
    state.overlay = state.overlay === "notifications" ? "none" : "notifications";
    state.dirty = true;
    return;
  }
  // ctrl+w workspace picker
  if (bytes.length === 1 && bytes[0] === 23) {
    state.overlay = "startup";
    state.startupSection = "workspace";
    state.dirty = true;
    return;
  }
  // ctrl+j quick actions
  if (bytes.length === 1 && bytes[0] === 10) {
    state.overlay = state.overlay === "quick" ? "none" : "quick";
    state.dirty = true;
    return;
  }
  // tab cycle view / section
  if (bytes.length === 1 && bytes[0] === 9) {
    if (state.overlay === "startup") {
      state.startupSection = state.startupSection === "workspace" ? "session" : "workspace";
      state.dirty = true;
      return;
    }
    moveSidebar(state, 1);
    return;
  }

  // escape / arrows
  if (text === "\x1b") {
    if (state.overlay !== "none") {
      state.overlay = "none";
      state.confirm = undefined;
      state.dirty = true;
      return;
    }
    return;
  }
  if (text === "\x1b[A") {
    if (state.overlay === "palette") {
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
    } else if (state.overlay === "startup") {
      if (state.startupSection === "workspace") state.workspaceIndex = Math.max(0, state.workspaceIndex - 1);
      else state.sessionIndex = Math.max(0, state.sessionIndex - 1);
    } else if (state.input) {
      const next = state.inputHistory.length - 1 - (state.inputHistoryIndex + 1);
      if (next >= 0) {
        state.inputHistoryIndex += 1;
        state.input = state.inputHistory[state.inputHistory.length - 1 - state.inputHistoryIndex] ?? state.input;
      }
    } else {
      moveSidebar(state, -1);
      return;
    }
    state.dirty = true;
    return;
  }
  if (text === "\x1b[B") {
    if (state.overlay === "palette") {
      const items = paletteItems(state).filter((item) => {
        const q = state.paletteQuery.trim().toLowerCase();
        if (!q) return true;
        return [item.label, item.description, ...item.keywords].join(" ").toLowerCase().includes(q);
      });
      state.paletteIndex = Math.min(Math.max(0, items.length - 1), state.paletteIndex + 1);
    } else if (state.overlay === "startup") {
      if (state.startupSection === "workspace") state.workspaceIndex = Math.min(Math.max(0, state.wm.listWorkspaces().length - 1), state.workspaceIndex + 1);
      else state.sessionIndex = Math.min(Math.max(0, state.sessions.slice(0, 6).length - 1), state.sessionIndex + 1);
    } else if (state.inputHistoryIndex > 0) {
      state.inputHistoryIndex -= 1;
      state.input = state.inputHistory[state.inputHistory.length - 1 - state.inputHistoryIndex] ?? "";
    } else if (state.inputHistoryIndex === 0) {
      state.inputHistoryIndex = -1;
      state.input = "";
    } else {
      moveSidebar(state, 1);
      return;
    }
    state.dirty = true;
    return;
  }
  if (text === "\r" || text === "\n") {
    await handleEnter(state);
    return;
  }

  // backspace
  if (bytes.length === 1 && (bytes[0] === 127 || bytes[0] === 8)) {
    if (state.overlay === "palette") state.paletteQuery = state.paletteQuery.slice(0, -1);
    else state.input = state.input.slice(0, -1);
    state.dirty = true;
    return;
  }

  if (state.overlay === "palette") {
    if (text >= " " && text !== "\x7f") {
      state.paletteQuery += text;
      state.paletteIndex = 0;
      state.dirty = true;
    }
    return;
  }

  if (text >= " " && text !== "\x7f") {
    handlePrintable(state, data);
  }
}

function restoreTerminal(): void {
  process.stdout.write(`${A.cursorShow}\x1b[?1049l${A.reset}`);
  process.stdin.setRawMode?.(false);
}

async function showAnimatedStartup(state: TuiState): Promise<void> {
  const frames = 6;
  for (let i = 0; i < frames; i++) {
    state.spinnerIndex = i;
    process.stdout.write(`${A.cursorHide}\x1b[?1049h${renderFrame(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 110));
  }
}

export async function runTUI(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stdout.write(`${xrBold("XR")}: fullscreen TUI requires an interactive terminal.\nRun ${xrCyan('xr help')} or pass a task directly.\n`);
    return;
  }

  const state = createState();
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode?.(true);
  process.stdout.write(`${A.cursorHide}\x1b[?1049h`);

  await showAnimatedStartup(state);

  let rendering = false;
  const render = () => {
    if (rendering) return;
    rendering = true;
    try {
      process.stdout.write(renderFrame(state));
      state.dirty = false;
    } finally {
      rendering = false;
    }
  };

  const ticker = setInterval(() => {
    if (state.busy || state.overlay === "startup") {
      state.spinnerIndex = (state.spinnerIndex + 1) % SPINNER_FRAMES.length;
      state.dirty = true;
    }
    if (state.dirty) render();
  }, 100);

  const onResize = () => { state.dirty = true; };
  const onData = async (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    await handleData(state, data);
    render();
  };

  process.on("SIGTERM", () => { state.shouldExit = true; });
  process.stdout.on("resize", onResize);
  process.stdin.on("data", onData);

  render();

  while (!state.shouldExit) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  clearInterval(ticker);
  process.stdin.off("data", onData);
  process.stdout.off("resize", onResize);
  restoreTerminal();
  process.stdout.write(`\n  ${SYM.ok} ${xrBold("XR session closed.")} ${xrDim("Thanks for using XR.")}\n\n`);
}
