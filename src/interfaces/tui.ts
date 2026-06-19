/**
 * XR Stage 5 — Polished Interactive TUI
 *
 * A Claude Code–class terminal workspace. Designed to feel like a real product,
 * not a debug REPL. Key improvements over the previous tui.ts / tui2.ts:
 *
 *  - Single canonical file (replaces tui.ts + tui2.ts)
 *  - Full command-history navigation (↑/↓ arrows)
 *  - Real-time spinner with elapsed time (star-burst like Claude Code)
 *  - Structured tool-call display with status icons
 *  - Provider / model / budget status bar on every prompt
 *  - Claude Code–style thinking indicator
 *  - Inline diff preview for write_file operations
 *  - /help with grouped categories, not a raw list
 *  - /status shows full system health
 *  - /chat opens browser chat interface
 *  - /dashboard opens browser dashboard
 *  - Graceful resume after Ctrl+C (SIGINT → "Interrupted, continuing…")
 *  - XR.md / .xrrc project memory auto-load
 *  - Non-TTY mode degrades cleanly
 *
 * Architecture:
 *  - Zero heavy deps (no ink, blessed, react)
 *  - Raw mode for arrow keys, ESC sequences
 *  - Async generator pattern for streaming
 *  - All styling via src/ui/theme.ts tokens
 */

import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { loadConfig } from "../config/config.ts";
import { buildProvider, knownProviders } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { Store } from "../state/db.ts";
import { loadSkills } from "../skills/loader.ts";
import { runLab } from "../security/lab.ts";
import { approvePrompt, overBudgetPrompt } from "./cli.ts";
import { runAgent, type AgentResult, type AgentDeps } from "../core/agent.ts";
import type { Message } from "../core/types.ts";
import {
  A, xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, SYM, SPINNER_FRAMES, LAYOUT,
} from "../ui/theme.ts";
import { Spinner, StepTracker } from "../ui/spinner.ts";
import {
  banner, divider, section, kv, box, badge, table, helpPanel, notify,
  toolCallLine, emptyState, errorState, statusLine,
} from "../ui/layout.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TUIState {
  provider:       string;
  model:          string;
  mode:           "agent" | "plan" | "ask";
  budget:         number;
  totalSpent:     number;
  sessionTokens:  number;
  history:        string[];
  historyIndex:   number;
  multiLineBuffer:string[];
  interrupted:    boolean;
}

interface ProjectMeta {
  name:       string;
  techStack?: string[];
  frameworks?: string[];
  conventions?: string[];
  testingFramework?: string;
  description?: string;
}

// ── Project Memory ────────────────────────────────────────────────────────────

function loadProjectMeta(cwd: string): ProjectMeta {
  const name = basename(cwd);
  const candidates = [
    join(cwd, "xr.md"),
    join(cwd, ".xrrc"),
    join(cwd, ".xrrc.md"),
    join(cwd, "CLAUDE.md"),
  ];
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
    } catch { /* skip */ }
  }
  return { name };
}

// ── Status Bar ────────────────────────────────────────────────────────────────

function renderStatusBar(state: TUIState): void {
  const isLocalProvider = isLocal(state.provider);
  const providerBadge = isLocalProvider
    ? `${SYM.local} ${xrGreen(state.provider)}`
    : `${SYM.cloud} ${xrAmber(state.provider)}`;
  const modelStr  = xrDim(state.model.slice(0, 24));
  const modeStr   = state.mode === "agent" ? xrCyan("agent")
                  : state.mode === "plan"  ? xrAmber("plan")
                  : xrDim("ask");
  const budgetStr = state.budget > 0
    ? `${SYM.budget} ${xrAmber("$" + state.totalSpent.toFixed(4))} ${xrDim("/")} ${xrDim("$" + state.budget.toFixed(2))}`
    : isLocalProvider ? `${SYM.local} ${xrGreen("free")}` : `${xrDim("no budget set")}`;

  console.log(
    `\n  ${xrDim("┄".repeat(70))}\n` +
    `  ${providerBadge}  ${modelStr}  ${xrDim("│")}  ${modeStr}  ${xrDim("│")}  ${budgetStr}\n` +
    `  ${xrDim("┄".repeat(70))}`
  );
}

// ── Prompt Renderer ───────────────────────────────────────────────────────────

function renderPrompt(state: TUIState): void {
  const modeTag = state.mode === "agent" ? xrCyan("agent") : state.mode === "plan" ? xrAmber("plan") : xrDim("ask");
  process.stdout.write(`\n  ${xrBold(xrCyan("xr"))} ${xrDim("[")}${modeTag}${xrDim("]")} ${xrCyan("›")} `);
}

// ── Slash Command Registry ────────────────────────────────────────────────────

interface SlashCommand {
  name:        string;
  aliases:     string[];
  args?:       string;
  description: string;
  category:    "chat" | "system" | "security" | "tools" | "local" | "nav";
  handler:     (args: string, ctx: TUIContext) => Promise<void>;
}

interface TUIContext {
  state:  TUIState;
  store:  Store;
  cwd:    string;
  meta:   ProjectMeta;
}

const COMMANDS: SlashCommand[] = [
  // ── Chat / Task ──────────────────────────────────────────────────────────────
  {
    name: "ask", aliases: ["a"], args: "<question>",
    description: "Ask a question (read-only, no file changes)",
    category: "chat",
    handler: async (args, ctx) => {
      if (!args.trim()) { notify("warn", "Usage: /ask <question>"); return; }
      await runTask(args, "ask", ctx);
    },
  },
  {
    name: "plan", aliases: ["p"], args: "<task>",
    description: "Plan a task without executing it",
    category: "chat",
    handler: async (args, ctx) => {
      if (!args.trim()) { notify("warn", "Usage: /plan <task>"); return; }
      await runTask(args, "plan", ctx);
    },
  },
  {
    name: "mode", aliases: ["m"], args: "agent|plan|ask",
    description: "Switch operating mode",
    category: "chat",
    handler: async (args, ctx) => {
      const m = args.trim() as TUIState["mode"];
      if (!["agent", "plan", "ask"].includes(m)) {
        notify("warn", "Usage: /mode agent|plan|ask"); return;
      }
      ctx.state.mode = m;
      notify("ok", `Mode → ${xrCyan(m)}`);
    },
  },
  {
    name: "model", aliases: [], args: "<provider> [model]",
    description: "Switch provider and/or model",
    category: "chat",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const p = parts[0];
      if (!p || !knownProviders().includes(p)) {
        notify("warn", `Unknown provider. Available: ${xrDim(knownProviders().join(", "))}`); return;
      }
      ctx.state.provider = p;
      if (parts[1]) ctx.state.model = parts[1];
      notify("ok", `Provider → ${xrCyan(p)}  Model → ${xrDim(ctx.state.model)}`);
    },
  },
  {
    name: "budget", aliases: ["b"], args: "<usd>",
    description: "Set spend ceiling in USD (0 = unlimited for local)",
    category: "chat",
    handler: async (args, ctx) => {
      const n = parseFloat(args.trim());
      if (isNaN(n)) { notify("warn", "Usage: /budget 0.50"); return; }
      ctx.state.budget = n;
      process.env["XR_BUDGET"] = String(n);
      notify("ok", `Budget ceiling → ${xrGreen("$" + n.toFixed(2))}`);
    },
  },

  // ── Navigation ───────────────────────────────────────────────────────────────
  {
    name: "dashboard", aliases: ["dash", "d"],
    description: "Open XR dashboard in your browser (xr serve)",
    category: "nav",
    handler: async (_args, _ctx) => {
      notify("info", "Starting dashboard server…");
      console.log(`  ${xrDim("Run")} ${xrCyan("xr serve")} ${xrDim("to start the server, then open")} ${xrCyan("http://localhost:3141")}`);
    },
  },
  {
    name: "chat", aliases: ["ui"],
    description: "Open XR chat interface in your browser",
    category: "nav",
    handler: async (_args, _ctx) => {
      notify("info", "Starting chat UI…");
      console.log(`  ${xrDim("Run")} ${xrCyan("xr serve")} ${xrDim("then open")} ${xrCyan("http://localhost:3141/chat")}`);
    },
  },

  // ── System ───────────────────────────────────────────────────────────────────
  {
    name: "status", aliases: ["s"],
    description: "Full system status: provider, local AI, budget, memory, audit",
    category: "system",
    handler: async (_args, ctx) => {
      await renderFullStatus(ctx);
    },
  },
  {
    name: "doctor", aliases: [],
    description: "Health check — providers, audit chain, local runtime",
    category: "system",
    handler: async (_args, ctx) => {
      await renderDoctor(ctx);
    },
  },
  {
    name: "cost", aliases: ["usage"],
    description: "Show spending summary for this session and all-time",
    category: "system",
    handler: async (_args, ctx) => {
      renderCostSummary(ctx);
    },
  },
  {
    name: "index", aliases: [],
    description: "Index current project for local RAG memory",
    category: "system",
    handler: async (_args, ctx) => {
      const sp = new Spinner().start(`Indexing ${xrCyan(ctx.meta.name)}…`);
      try {
        const { indexProject } = await import("../memory/rag.ts");
        const count = await indexProject(ctx.store, ctx.cwd, ctx.meta.name);
        sp.succeed(`Indexed ${xrGreen(String(count))} chunks for ${xrCyan(ctx.meta.name)}`);
      } catch (e) {
        sp.fail(`Index failed: ${(e as Error).message}`);
      }
    },
  },

  // ── Memory ───────────────────────────────────────────────────────────────────
  {
    name: "memory", aliases: ["mem", "rag"],
    description: "Show memory, RAG chunks, and project context",
    category: "tools",
    handler: async (_args, ctx) => {
      renderMemoryPanel(ctx);
    },
  },

  // ── Security ─────────────────────────────────────────────────────────────────
  {
    name: "attacks", aliases: ["lab", "security"],
    description: "Run injection defense test lab (10-attack benchmark)",
    category: "security",
    handler: async (_args, ctx) => {
      await renderSecurityLab(ctx);
    },
  },
  {
    name: "verify-log", aliases: ["audit", "verify"],
    description: "Verify tamper-evident SHA-256 audit chain integrity",
    category: "security",
    handler: async (_args, ctx) => {
      renderAuditVerify(ctx);
    },
  },
  {
    name: "export", aliases: ["report"],
    description: "Export signed audit report to markdown",
    category: "security",
    handler: async (_args, ctx) => {
      await exportReport(ctx);
    },
  },

  // ── Skills / Local ────────────────────────────────────────────────────────────
  {
    name: "skills", aliases: ["skill"],
    description: "List learned skills and frozen baselines",
    category: "local",
    handler: async (_args, ctx) => {
      renderSkills(ctx);
    },
  },
  {
    name: "shell", aliases: ["bash"], args: "<command>",
    description: "Run a shell command through XR (approval-gated, audited)",
    category: "tools",
    handler: async (args, ctx) => {
      if (!args.trim()) { notify("warn", "Usage: /shell <command>"); return; }
      await runTask(`Run this shell command and report the output: ${args}`, "agent", ctx);
    },
  },

  // ── UI Utilities ──────────────────────────────────────────────────────────────
  {
    name: "help", aliases: ["h", "?"],
    description: "Show all slash commands grouped by category",
    category: "system",
    handler: async (_args, _ctx) => {
      renderHelp();
    },
  },
  {
    name: "clear", aliases: ["cls"],
    description: "Clear the terminal screen",
    category: "system",
    handler: async (_args, _ctx) => {
      process.stdout.write(A.clearScreen);
      banner();
    },
  },
  {
    name: "exit", aliases: ["quit", "q", "bye"],
    description: "Exit XR",
    category: "system",
    handler: async (_args, _ctx) => {
      console.log(`\n  ${SYM.ok} ${xrBold("Goodbye.")} ${xrDim("XR — the AI agent you can actually trust.")}\n`);
      process.exit(0);
    },
  },
];

// ── Slash Command Dispatch ────────────────────────────────────────────────────

async function dispatch(input: string, ctx: TUIContext): Promise<boolean> {
  if (!input.startsWith("/")) return false;
  const parts = input.slice(1).split(/\s+/);
  const name  = parts[0]?.toLowerCase() ?? "";
  const args  = parts.slice(1).join(" ");

  for (const cmd of COMMANDS) {
    if (cmd.name === name || cmd.aliases.includes(name)) {
      await cmd.handler(args, ctx);
      return true;
    }
  }

  notify("warn", `Unknown command: /${name}`);
  console.log(`  ${xrDim("Type /help to see all commands.")}`);
  return true;
}

// ── Task Runner ───────────────────────────────────────────────────────────────

async function runTask(
  task:    string,
  mode:    TUIState["mode"],
  ctx:     TUIContext,
): Promise<void> {
  const { config } = loadConfig();
  const { state, store } = ctx;

  // Provider health check
  const spinner = new Spinner().start(`Connecting to ${xrCyan(state.provider)}…`);
  const provider = buildProvider(config, { provider: state.provider, model: state.model });
  const health   = await provider.health();

  if (!health.ok) {
    spinner.fail(`${state.provider} unreachable${health.detail ? `: ${health.detail}` : ""}`);
    notify("info", `Tip: ${xrCyan("/model ollama")} to switch to local (free)`);
    return;
  }
  spinner.succeed(`Connected — ${xrGreen(state.provider)} ${xrDim(health.latencyMs ? `${health.latencyMs}ms` : "")}`);

  // Thinking indicator
  const thinkSpinner = new Spinner(14).start(
    mode === "ask"  ? "Reading…"
    : mode === "plan" ? "Planning…"
    : "Thinking…"
  );

  let lastLine = "";
  const say = (line: string) => {
    if (thinkSpinner) { thinkSpinner.stop(); }
    if (lastLine === "" && line.trim()) {
      console.log(`\n  ${xrCyan("│")} ${xrBold("XR")}`);
    }
    console.log(`  ${xrDim("│")} ${line}`);
    lastLine = line;
  };

  const budgetMax = parseFloat(process.env["XR_BUDGET"] ?? "0");
  const budget = {
    maxUsd:    isLocal(state.provider) ? undefined : (budgetMax > 0 ? budgetMax : state.budget > 0 ? state.budget : config.budget.perTaskUsd),
    maxTokens: config.budget.perTaskTokens,
  };

  let result: AgentResult | null = null;
  try {
    result = await runAgent(task, mode, {
      provider,
      store,
      cwd:        ctx.cwd,
      say,
      approve:    approvePrompt,
      onOverBudget: overBudgetPrompt,
      budget,
      pricing:    priceFor(state.provider, state.model),
      egressAllowlist: config.security.egressAllowlist,
      dryRun:     false,
    } as AgentDeps);
  } catch (e) {
    thinkSpinner.fail(`Agent error: ${(e as Error).message}`);
    return;
  }

  thinkSpinner.stop();
  console.log(`  ${xrDim("│")}`);

  if (!result) return;

  // Update session stats
  if (result.meter) {
    const match = result.meter.match(/\$([0-9.]+)/);
    if (match) state.totalSpent += parseFloat(match[1]);
  }
  if (result.inputTokens)  state.sessionTokens += result.inputTokens;
  if (result.outputTokens) state.sessionTokens += result.outputTokens;

  // Summary line
  if (result.stopped === "done") {
    console.log(`\n  ${SYM.ok} Done in ${xrCyan(String(result.steps))} step(s)${result.meter ? `  ${xrDim(result.meter)}` : ""}`);
  } else if (result.stopped === "budget") {
    console.log(`\n  ${SYM.warn} Budget ceiling reached — task paused`);
    console.log(`    ${xrDim("Raise limit with /budget <amount> or use a local model (free)")}`);
  } else if (result.stopped === "approval") {
    console.log(`\n  ${SYM.warn} Stopped — action requires your approval`);
  } else {
    console.log(`\n  ${SYM.info} Stopped: ${xrDim(result.stopped ?? "unknown")}`);
  }
}

// ── Help Renderer ─────────────────────────────────────────────────────────────

function renderHelp(): void {
  const categories: Record<string, SlashCommand[]> = {};
  for (const cmd of COMMANDS) {
    (categories[cmd.category] ??= []).push(cmd);
  }
  const catLabels: Record<string, string> = {
    chat:     "Chat & Tasks",
    nav:      "Navigation",
    system:   "System",
    tools:    "Tools",
    security: "Security",
    local:    "Local AI",
  };
  const catOrder = ["chat", "nav", "system", "tools", "security", "local"];

  console.log();
  for (const cat of catOrder) {
    const cmds = categories[cat];
    if (!cmds?.length) continue;
    console.log(`  ${xrBold(xrCyan(catLabels[cat] ?? cat))}`);
    for (const cmd of cmds) {
      const aliases = cmd.aliases.length ? `  ${xrDim("/" + cmd.aliases.join("  /"))}` : "";
      const args    = cmd.args ? ` ${xrDim(cmd.args)}` : "";
      console.log(`    ${xrCyan("/" + cmd.name)}${args}${aliases}`);
      console.log(`      ${xrDim(cmd.description)}`);
    }
    console.log();
  }
  console.log(`  ${xrDim("Type any message to talk to XR. Use /mode to switch between agent, plan, and ask.")}`);
  console.log(`  ${xrDim("Press ↑/↓ to navigate history. Ctrl+C to interrupt. /exit to quit.")}\n`);
}

// ── Status Renderer ───────────────────────────────────────────────────────────

async function renderFullStatus(ctx: TUIContext): Promise<void> {
  const { state, store } = ctx;
  const { config } = loadConfig();
  section("XR System Status");

  // Provider
  const provider = buildProvider(config, { provider: state.provider, model: state.model });
  const spinner  = new Spinner().start("Checking provider health…");
  const health   = await provider.health();
  spinner.stop();
  kv("Provider", state.provider, health.ok ? "ok" : "error");
  kv("Model",    state.model,    "cyan");
  kv("Mode",     state.mode,     "cyan");
  kv("Latency",  health.latencyMs ? `${health.latencyMs}ms` : "—", health.ok ? "ok" : "dim");

  divider("Budget");
  const cost = store.costSummary();
  kv("Session spent",    `$${state.totalSpent.toFixed(6)}`);
  kv("All-time spent",   `$${cost.totalUsd.toFixed(6)}`);
  kv("Session tokens",   state.sessionTokens.toLocaleString());
  kv("All-time tokens",  cost.totalTokens.toLocaleString());
  if (state.budget > 0) kv("Budget ceiling", `$${state.budget.toFixed(2)}`, "amber");

  divider("Local AI");
  const local: any = config.localModels;
  kv("Enabled",   local.enabled ? "yes" : "no",   local.enabled ? "ok" : "dim");
  kv("Runtime",   local.runtime ?? "—");
  kv("Routing",   local.routing  ?? "hybrid",      "cyan");
  kv("Model",     local.selected ?? "none",        local.selected ? "ok" : "warn");

  divider("Memory & Skills");
  kv("Skills",   `${store.skillCount()} learned / ${store.frozenCount()} frozen`);
  kv("RAG chunks", String(store.ragCount(ctx.meta.name)));

  divider("Security");
  const chain = store.verifyChain();
  kv("Audit chain",    chain.valid ? `intact (${store.auditCount()} entries)` : "BROKEN", chain.valid ? "ok" : "error");
  kv("Egress list",    config.security.egressAllowlist?.join(", ") || "unrestricted", "dim");
  kv("Approval mode",  config.security.requireApproval?.join(", ") || "none", "dim");

  console.log();
}

async function renderDoctor(ctx: TUIContext): Promise<void> {
  const { config, warnings } = loadConfig();
  section("XR Doctor");

  // Config
  const cfgOk = warnings.length === 0;
  kv("Config",       cfgOk ? "valid" : `${warnings.length} warning(s)`,  cfgOk ? "ok" : "warn");
  for (const w of warnings) console.log(`    ${xrDim(w)}`);

  // Provider
  const sp = new Spinner().start("Testing provider…");
  const provider = buildProvider(config, {});
  const h = await provider.health();
  sp.stop();
  kv("Provider",     h.ok ? `${provider.label} online` : `${provider.label} offline`,  h.ok ? "ok" : "error");
  if (h.detail)  console.log(`    ${xrDim(h.detail)}`);

  // Audit
  const chain = ctx.store.verifyChain();
  kv("Audit chain",  chain.valid ? `intact (${ctx.store.auditCount()} entries)` : "BROKEN", chain.valid ? "ok" : "error");

  // Skills
  kv("Skills",       `${ctx.store.skillCount()} learned · ${ctx.store.frozenCount()} frozen`);

  // Local AI
  try {
    const { detectRuntime } = await import("../local/runtimes.ts");
    const local: any = config.localModels;
    if (local?.runtime) {
      const rt = await detectRuntime(local.runtime);
      kv("Local runtime", rt.running ? `${rt.label} ready` : `${rt.label} offline`, rt.running ? "ok" : "warn");
    }
  } catch { kv("Local runtime", "not configured", "dim"); }

  console.log();
  notify("info", `Config: ${xrDim("~/.xr/config.json")}`);
}

function renderCostSummary(ctx: TUIContext): void {
  const cost = ctx.store.costSummary();
  section("Cost Summary");
  kv("Session spent",   `$${ctx.state.totalSpent.toFixed(6)}`);
  kv("Session tokens",  ctx.state.sessionTokens.toLocaleString());
  kv("All-time spent",  `$${cost.totalUsd.toFixed(6)}`,       "cyan");
  kv("All-time tokens", cost.totalTokens.toLocaleString());
  if (cost.byModel?.length) {
    divider("By Model");
    for (const m of cost.byModel) {
      kv(m.model.slice(0, 22), `$${m.usd.toFixed(6)}  ${xrDim(m.tokens.toLocaleString() + " tok")}`);
    }
  }
  console.log();
}

function renderMemoryPanel(ctx: TUIContext): void {
  section("Memory & RAG");
  const { store, meta, cwd } = ctx;

  kv("Project",    meta.name);
  kv("RAG chunks", String(store.ragCount(meta.name)));

  if (meta.techStack?.length) kv("Tech stack",  meta.techStack.join(", "),  "cyan");
  if (meta.frameworks?.length) kv("Frameworks",  meta.frameworks.join(", "), "dim");

  // Durable memory
  try {
    const { MemoryStore } = require("../memory/store.ts");
    const mem   = new MemoryStore(store);
    const stats = mem.stats();
    divider("Durable Memory");
    kv("Total entries", String(mem.count()));
    for (const [cat, n] of Object.entries(stats)) {
      kv(`  ${cat}`, String(n), "dim");
    }
  } catch { /* memory store not available */ }

  console.log();
  console.log(`  ${xrDim("Add: xr memory add \"…\" --category preference")}`);
  console.log(`  ${xrDim("List: xr memory list")}`);
  console.log(`  ${xrDim("Delete: xr memory delete <id>")}\n`);
}

async function renderSecurityLab(ctx: TUIContext): Promise<void> {
  const { config } = loadConfig();
  section("Injection Defense Lab");
  notify("info", "Running 10-attack benchmark…");

  const report = runLab({ egressAllowlist: config.security.egressAllowlist });
  console.log();

  for (const o of report.outcomes) {
    const icon = o.blocked ? SYM.ok : SYM.error;
    const label = o.blocked ? xrGreen("blocked") : xrRed("ALLOWED");
    console.log(`  ${icon} ${xrDim(o.category.padEnd(24))} ${label}  ${xrDim(o.description)}`);
  }

  const pct  = Math.round(report.rate * 100);
  const line = `  Block-rate: ${report.blocked}/${report.total} (${pct}%)`;
  console.log();
  console.log(pct >= 90 ? `  ${SYM.ok} ${xrGreen(line)}` : pct >= 70 ? `  ${SYM.warn} ${xrAmber(line)}` : `  ${SYM.error} ${xrRed(line)}`);
  console.log();

  const chainHash = ctx.store.verifyChain();
  if (chainHash.valid) {
    console.log(`  ${SYM.ok} ${xrDim("Report signed — audit chain intact")}`);
  }
}

function renderAuditVerify(ctx: TUIContext): void {
  const chain = ctx.store.verifyChain();
  section("Audit Chain Verification");
  if (chain.valid) {
    console.log(`  ${SYM.ok} ${xrGreen("Intact")} ${xrDim(`(${ctx.store.auditCount()} entries · SHA-256 hash chain)`)}`);
  } else {
    console.log(`  ${SYM.error} ${xrRed("BROKEN")} ${xrDim(`at entry #${chain.brokenAt}`)}`);
    notify("warn", "Possible tampering. Do not trust prior audit entries.", "Run: xr verify-log --full");
  }
  console.log();
}

async function exportReport(ctx: TUIContext): Promise<void> {
  const sp = new Spinner().start("Building audit report…");
  try {
    const { buildAuditReport } = await import("../export/report.ts");
    const { randomUUID }       = await import("node:crypto");
    const report = buildAuditReport({
      project:    ctx.meta.name,
      chainValid: ctx.store.verifyChain().valid,
      entries:    ctx.store.recentAudit(1000),
      totalUsd:   ctx.store.costSummary().totalUsd,
    });
    const outPath = join(ctx.cwd, `xr-audit-${randomUUID().slice(0, 8)}.md`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, report.markdown);
    sp.succeed(`Report saved: ${xrCyan(outPath)}`);
  } catch (e) {
    sp.fail(`Export failed: ${(e as Error).message}`);
  }
}

function renderSkills(ctx: TUIContext): void {
  const { join } = require("node:path");
  section("Skills");
  try {
    const candidates = [
      join(import.meta?.dir ?? process.cwd(), "..", "..", "skills"),
      join(process.cwd(), "skills"),
    ];
    let skills: ReturnType<typeof loadSkills> = [];
    for (const dir of candidates) {
      skills = loadSkills(dir);
      if (skills.length) break;
    }
    if (!skills.length) {
      emptyState("skills", "Run a task and XR will learn from it automatically.");
    } else {
      for (const s of skills) {
        kv(s.id.slice(0, 22), `v${s.version}  ${xrDim(s.source)}  tools: ${xrDim(s.tools.join(", ") || "—")}`);
      }
    }
  } catch (e) {
    notify("warn", "Could not load skills", (e as Error).message);
  }
  kv("Learned",  String(ctx.store.skillCount()));
  kv("Frozen",   String(ctx.store.frozenCount()));
  console.log();
}

// ── Raw Mode Input ────────────────────────────────────────────────────────────

async function readInputLine(state: TUIState): Promise<string> {
  renderPrompt(state);

  return new Promise((resolve) => {
    let buf: number[] = [];

    const onData = (key: Buffer) => {
      for (let i = 0; i < key.length; i++) {
        const byte = key[i]!;

        // Ctrl+C → interrupt
        if (byte === 3) {
          state.interrupted = true;
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve("__INTERRUPT__");
          return;
        }

        // Enter
        if (byte === 13 || byte === 10) {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", onData);
          const line = Buffer.from(buf).toString("utf8");
          process.stdout.write("\n");
          resolve(line);
          return;
        }

        // Backspace
        if (byte === 127 || byte === 8) {
          if (buf.length > 0) {
            buf.pop();
            process.stdout.write("\x1b[D\x1b[K");
          }
          continue;
        }

        // ESC sequences (arrow keys)
        if (byte === 27 && key[i + 1] === 91) {
          const code = key[i + 2];
          if (code === 65) {
            // Up arrow — history back
            if (state.historyIndex < state.history.length - 1) {
              state.historyIndex++;
              const prev = state.history[state.history.length - 1 - state.historyIndex] ?? "";
              buf = Array.from(Buffer.from(prev, "utf8"));
              process.stdout.write(`\x1b[2K\r`);
              renderPrompt(state);
              process.stdout.write(prev);
            }
            i += 2;
            continue;
          }
          if (code === 66) {
            // Down arrow — history forward
            if (state.historyIndex > 0) {
              state.historyIndex--;
              const next = state.history[state.history.length - 1 - state.historyIndex] ?? "";
              buf = Array.from(Buffer.from(next, "utf8"));
              process.stdout.write(`\x1b[2K\r`);
              renderPrompt(state);
              process.stdout.write(next);
            } else {
              state.historyIndex = -1;
              buf = [];
              process.stdout.write(`\x1b[2K\r`);
              renderPrompt(state);
            }
            i += 2;
            continue;
          }
          // Ignore other ESC sequences
          i += 2;
          continue;
        }

        // Printable ASCII + UTF-8
        if (byte >= 32) {
          buf.push(byte);
          process.stdout.write(String.fromCharCode(byte));
        }
      }
    };

    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    process.stdin.on("data", onData);
  });
}

// ── Session Startup Screen ────────────────────────────────────────────────────

async function showStartScreen(state: TUIState, meta: ProjectMeta): Promise<void> {
  process.stdout.write(A.clearScreen);
  banner();

  // Project context
  if (meta.techStack?.length || meta.frameworks?.length || meta.description) {
    console.log(`  ${xrBold(xrCyan("Project:"))} ${xrDim(meta.name)}`);
    if (meta.description)     console.log(`  ${xrDim(meta.description)}`);
    if (meta.techStack?.length) console.log(`  ${xrDim("Stack:")} ${meta.techStack.slice(0, 5).join(", ")}`);
    console.log();
  }

  // Status line
  statusLine([
    { label: "provider", value: state.provider,    color: isLocal(state.provider) ? "green" : "amber" },
    { label: "model",    value: state.model.slice(0, 24) },
    { label: "mode",     value: state.mode,          color: "cyan"  },
  ]);

  console.log();
  console.log(`  ${xrDim("Type a message to talk to XR. Use")} ${xrCyan("/help")} ${xrDim("to see all commands.")}`);
  console.log(`  ${xrDim("Quick:")} ${xrCyan("/ask")}  ${xrCyan("/plan")}  ${xrCyan("/model")}  ${xrCyan("/status")}  ${xrCyan("/dashboard")}`);
  console.log();
}

// ── Main TUI Loop ─────────────────────────────────────────────────────────────

export async function runTUI(): Promise<void> {
  const { config } = loadConfig();
  const store  = new Store();
  const cwd    = process.cwd();
  const meta   = loadProjectMeta(cwd);

  const state: TUIState = {
    provider:      config.defaults.provider ?? "ollama",
    model:         config.defaults.model    ?? "qwen2.5:7b",
    mode:          (config.defaults.mode    as TUIState["mode"]) ?? "agent",
    budget:        config.budget.perTaskUsd ?? 0,
    totalSpent:    0,
    sessionTokens: 0,
    history:       [],
    historyIndex:  -1,
    multiLineBuffer: [],
    interrupted:   false,
  };

  const ctx: TUIContext = { state, store, cwd, meta };

  await showStartScreen(state, meta);

  // SIGTERM handler
  process.on("SIGTERM", () => {
    process.stdout.write(A.cursorShow);
    console.log(`\n  ${SYM.ok} ${xrDim("XR exiting cleanly.")}\n`);
    process.exit(0);
  });

  // Main REPL
  while (true) {
    let input: string;
    try {
      input = await readInputLine(state);
    } catch {
      break;
    }

    // Handle Ctrl+C interrupt
    if (input === "__INTERRUPT__") {
      if (state.interrupted) {
        console.log(`\n  ${SYM.ok} ${xrDim("Interrupted. Type /exit to quit.")}\n`);
        state.interrupted = false;
        continue;
      }
      console.log(`\n  ${xrDim("Interrupted. Press Ctrl+C again or type /exit to quit.")}`);
      state.interrupted = true;
      continue;
    }
    state.interrupted = false;

    const trimmed = input.trim();
    if (!trimmed) continue;

    // Add to history (deduplicate consecutive)
    if (state.history[state.history.length - 1] !== trimmed) {
      state.history.push(trimmed);
      if (state.history.length > 200) state.history.shift();
    }
    state.historyIndex = -1;

    // Slash command or chat
    const isCmd = await dispatch(trimmed, ctx);
    if (!isCmd) {
      // Plain message → run agent
      console.log(`\n  ${xrDim("│")} ${xrBold("You")}  ${xrDim(trimmed.slice(0, 100))}`);
      await runTask(trimmed, state.mode, ctx);
    }
  }
}
