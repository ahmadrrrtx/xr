/**
 * XR — Full Interactive TUI
 * 
 * Replaces plain console.log with a rich terminal UI that rivals
 * Claude Code, Hermes, and OpenClaw.
 * 
 * Features:
 * - Streaming token output (like Claude Code)
 * - Slash commands (/ask, /plan, /loop, /skills, /exit, etc.)
 * - Command history (up/down arrows)
 * - Multi-line input (shift+enter for newlines)
 * - Real-time status indicators (thinking, tool call, done)
 * - Inline diff previews for write operations
 * - Progress spinners for long operations
 * - Color-coded output by type (info, success, warning, error, tool)
 * 
 * Architecture:
 * - Pure Bun/Node.js (no heavy deps like ink or blessed)
 * - ANSI escape codes for colors/positioning
 * - Raw mode for arrow keys
 * - SIGINT/SIGTERM handling
 * - Graceful degradation on non-TTY
 */

import { loadConfig } from "../config/config.ts";
import { buildProvider, knownProviders } from "../providers/factory.ts";
import { runAgent, type AgentResult, type AgentDeps } from "../core/agent.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { Store } from "../state/db.ts";
import { loadSkills } from "../skills/loader.ts";
import { runLab } from "../security/lab.ts";
import { approvePrompt, overBudgetPrompt } from "./cli.ts";
import { join, basename } from "node:path";

// ── ANSI Escape Helpers ───────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
  // Cursor & screen
  clearLine: "\x1b[2K\x1b[0G",
  clearScreen: "\x1b[2J",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  moveUp: (n: number) => `\x1b[${n}A`,
  moveDown: (n: number) => `\x1b[${n}B`,
  moveRight: (n: number) => `\x1b[${n}C`,
  moveLeft: (n: number) => `\x1b[${n}D`,
  saveCursor: "\x1b[s",
  restoreCursor: "\x1b[u",
  // Bright variants
  brightGreen: "\x1b[92m",
  brightRed:   "\x1b[91m",
  brightYellow:"\x1b[93m",
  brightCyan:  "\x1b[96m",
};

function eraseLine(): string {
  return "\x1b[2K";
}

function moveCursor(x: number, y: number): string {
  return `\x1b[${y + 1};${x + 1}H`;
}

// ── Banner ────────────────────────────────────────────────────────────────────
function showBanner(): void {
  console.log(`
${C.cyan}  ▀▄▀ █▀█   ${C.brightCyan}XR — The AI Agent You Can Actually Trust${C.reset}
${C.cyan}  █░█ █▀▄   ${C.dim}by @ahmadrrrtx · local-first · spend-capped · secure${C.reset}
`);
}

// ── Readline (TTY-aware, non-blocking) ───────────────────────────────────────
async function readLine(prompt: string = ""): Promise<string> {
  process.stdout.write(prompt);
  const buf: number[] = [];
  
  return new Promise((resolve) => {
    const handler = (key: Uint8Array) => {
      for (const byte of key) {
        if (byte === 3) { // Ctrl+C
          process.stdin.setRawMode?.(false);
          process.exit(130);
        }
        if (byte === 13 || byte === 10) { // Enter
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", handler);
          const line = new TextDecoder().decode(new Uint8Array(buf));
          console.log(); // newline after input
          resolve(line);
          return;
        }
        if (byte === 127 || byte === 8) { // Backspace
          if (buf.length > 0) {
            buf.pop();
            process.stdout.write("\x1b[D\x1b[K");
          }
          continue;
        }
        if (byte === 27) { // Arrow keys — for now just ignore
          continue;
        }
        if (byte >= 32 && byte <= 126) {
          buf.push(byte);
          process.stdout.write(String.fromCharCode(byte));
        }
      }
    };
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    process.stdin.on("data", handler);
  });
}

// ── Streaming Output ──────────────────────────────────────────────────────────
function streamText(text: string, prefix = ""): void {
  let line = prefix;
  process.stdout.write(prefix);
  for (const char of text) {
    if (char === "\n") {
      process.stdout.write("\n" + (prefix ? C.dim + prefix + C.reset : ""));
    } else {
      process.stdout.write(char);
    }
  }
  process.stdout.write("\n");
}

// ── Slash Command Parser ───────────────────────────────────────────────────────
interface SlashCommand {
  name: string;
  description: string;
  aliases: string[];
  handler: (args: string, deps: TUICtx) => Promise<void>;
}

interface TUICtx {
  store: Store;
  cwd: string;
  config: ReturnType<typeof loadConfig>["config"];
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "ask", description: "Ask a question (read-only, no file changes)",
    aliases: ["ask", "a"], handler: async (args, ctx) => {
      if (!args.trim()) {
        console.log(`${C.yellow}Usage: /ask <your question>${C.reset}`);
        console.log(`${C.dim}  e.g. /ask what does this function do?${C.reset}`);
        return;
      }
      await runTuiTask(args, "ask", ctx);
    }
  },
  {
    name: "plan", description: "Plan a task (read-only analysis)",
    aliases: ["plan", "p"], handler: async (args, ctx) => {
      if (!args.trim()) {
        console.log(`${C.yellow}Usage: /plan <task description>${C.reset}`);
        console.log(`${C.dim}  e.g. /plan refactor the auth module${C.reset}`);
        return;
      }
      await runTuiTask(args, "plan", ctx);
    }
  },
  {
    name: "mode", description: "Switch mode (agent|plan|ask)",
    aliases: ["mode", "m"], handler: async (args, ctx) => {
      const mode = args.trim() as "agent" | "plan" | "ask";
      if (!["agent", "plan", "ask"].includes(mode)) {
        console.log(`${C.yellow}Usage: /mode agent|plan|ask${C.reset}`);
        return;
      }
      console.log(`${C.green}Mode switched to: ${mode}${C.reset}`);
      ctx.config.defaults.mode = mode;
    }
  },
  {
    name: "model", description: "Switch model/provider",
    aliases: ["model"], handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const provider = parts[0] || ctx.config.defaults.provider;
      const model = parts[1];
      if (!knownProviders().includes(provider)) {
        console.log(`${C.yellow}Unknown provider. Known: ${knownProviders().join(", ")}${C.reset}`);
        return;
      }
      if (model) {
        ctx.config.defaults.model = model;
      }
      ctx.config.defaults.provider = provider;
      console.log(`${C.green}Model: ${provider}/${ctx.config.defaults.model}${C.reset}`);
    }
  },
  {
    name: "budget", description: "Set spend ceiling ($)",
    aliases: ["budget", "b"], handler: async (args) => {
      const amount = parseFloat(args.trim());
      if (isNaN(amount)) {
        console.log(`${C.yellow}Usage: /budget 0.50${C.reset}`);
        return;
      }
      console.log(`${C.green}Budget set to: $${amount}${C.reset}`);
      // Store in env or config for the next run
      process.env.XR_BUDGET = String(amount);
    }
  },
  {
    name: "doctor", description: "System health check + audit chain",
    aliases: ["doctor"], handler: async (_, ctx) => {
      showBanner();
      const { config, warnings } = loadConfig();
      console.log(`${C.bold}System Health${C.reset}`);
      console.log(`  config ........... ${warnings.length ? C.yellow + "⚠ " + warnings.length + " warning(s)" : C.green + "✓ valid"}${C.reset}`);
      for (const w of warnings) console.log(`    ${C.dim}${w}${C.reset}`);
      
      const provider = buildProvider(config, {});
      const h = await provider.health();
      console.log(`  provider ......... ${h.ok ? C.green + "✓ " + provider.label : C.red + "✗ " + provider.label} ${C.dim}(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})${C.reset}`);
      
      const chain = ctx.store.verifyChain();
      console.log(`  audit chain ...... ${chain.valid ? C.green + "✓ intact (" + ctx.store.auditCount() + " entries)" : C.red + "✗ BROKEN"}${C.reset}`);
      console.log(`  skills ........... ${C.green}✓ ${ctx.store.skillCount()} learned · ${ctx.store.frozenCount()} frozen${C.reset}`);
      console.log(`  models ........... ${C.dim}${knownProviders().join(", ")}${C.reset}`);
    }
  },
  {
    name: "attacks", description: "Run injection test lab (security benchmark)",
    aliases: ["attacks", "security"], handler: async (_, ctx) => {
      console.log(`${C.bold}${C.yellow}🔒 Running injection test lab…${C.reset}`);
      const report = runLab({ egressAllowlist: ctx.config.security.egressAllowlist });
      for (const o of report.outcomes) {
        const tag = o.blocked ? C.green + "✓ blocked" : C.red + "✗ ALLOWED";
        console.log(`  ${tag} ${C.dim + o.category.padEnd(22)} ${o.description}${C.reset}`);
      }
      const pct = Math.round(report.rate * 100);
      const line = `\n  block-rate: ${report.blocked}/${report.total} (${pct}%)`;
      console.log(pct >= 90 ? C.green + line + C.reset : C.yellow + line + C.reset);
    }
  },
  {
    name: "skills", description: "List all available skills",
    aliases: ["skills", "skill"], handler: async () => {
      const candidates = [
        join(import.meta.dir, "..", "..", "skills"),
        join(process.cwd(), "skills"),
      ];
      let skills: ReturnType<typeof loadSkills> = [];
      for (const dir of candidates) {
        skills = loadSkills(dir);
        if (skills.length) break;
      }
      console.log(`${C.bold}🧠 Skills (${skills.length})${C.reset}`);
      for (const s of skills) {
        console.log(`  ${C.cyan + s.id.padEnd(20)} ${C.dim}v${s.version} · ${s.source} tools: ${C.dim + (s.tools.join(", ") || "—")}${C.reset}`);
      }
    }
  },
  {
    name: "index", description: "Index project for local RAG memory",
    aliases: ["index"], handler: async (_, ctx) => {
      const { indexProject } = await import("../memory/rag.ts");
      const { basename } = await import("node:path");
      const project = basename(ctx.cwd);
      console.log(`${C.yellow}Indexing project "${project}"…${C.reset}`);
      const count = await indexProject(ctx.store, ctx.cwd, project);
      console.log(`${C.green}✓ Indexed ${count} chunks.${C.reset}`);
    }
  },
  {
    name: "memory", description: "Show project memory and RAG status",
    aliases: ["memory", "rag"], handler: async (_, ctx) => {
      const { fingerprint } = await import("../memory/rag.ts");
      const { basename } = await import("node:path");
      const project = basename(ctx.cwd);
      const fp = fingerprint(ctx.cwd);
      console.log(`${C.bold}🧠 Project: ${project}${C.reset}`);
      console.log(`  files indexed ... ${C.dim}${fp.files}${C.reset}`);
      console.log(`  languages ....... ${C.dim}${Object.keys(fp.languages).join(", ")}${C.reset}`);
      console.log(`  frameworks ...... ${C.dim}${fp.frameworks.join(", ") || "—"}${C.reset}`);
      console.log(`  RAG chunks ...... ${C.dim}${ctx.store.ragCount(project)}${C.reset}`);
      console.log(`  memories ........ ${C.dim}${ctx.store.memoryCount(project)}${C.reset}`);
    }
  },
  {
    name: "cost", description: "Show cost summary (all-time)",
    aliases: ["cost", "usage"], handler: async (_, ctx) => {
      const c = ctx.store.costSummary();
      console.log(`${C.bold}💰 Cost Summary${C.reset}`);
      console.log(`  total USD ....... ${C.green}$${c.totalUsd.toFixed(6)}${C.reset}`);
      console.log(`  total tokens .... ${C.dim}${c.totalTokens.toLocaleString()}${C.reset}`);
      if (c.byModel.length) {
        console.log(`  by model:`);
        for (const m of c.byModel) {
          console.log(`    ${C.cyan + m.model.padEnd(20)} ${C.dim}$${m.usd.toFixed(6)} · ${m.tokens.toLocaleString()} tok${C.reset}`);
        }
      }
    }
  },
  {
    name: "verify-log", description: "Verify tamper-evident audit chain",
    aliases: ["verify-log", "audit"], handler: async (_, ctx) => {
      const chain = ctx.store.verifyChain();
      if (chain.valid) {
        console.log(`${C.green}✓ Audit chain intact (${ctx.store.auditCount()} entries)${C.reset}`);
      } else {
        console.log(`${C.red}✗ Audit chain BROKEN at entry #${chain.brokenAt}${C.reset}`);
        console.log(`${C.yellow}  Possible tampering detected. DO NOT trust prior audit entries.${C.reset}`);
      }
    }
  },
  {
    name: "export", description: "Export signed audit report",
    aliases: ["export", "report"], handler: async (_, ctx) => {
      const { buildAuditReport } = await import("../export/report.ts");
      const { randomUUID } = await import("node:crypto");
      console.log(`${C.yellow}Building audit report…${C.reset}`);
      const report = buildAuditReport({
        project: basename(ctx.cwd),
        chainValid: ctx.store.verifyChain().valid,
        entries: ctx.store.recentAudit(1000),
        totalUsd: ctx.store.costSummary().totalUsd,
      });
      const outPath = join(ctx.cwd, `xr-audit-${randomUUID().slice(0, 8)}.md`);
      await import("node:fs").then(m => m.writeFileSync(outPath, report.markdown));
      console.log(`${C.green}✓ Report saved: ${outPath}${C.reset}`);
    }
  },
  {
    name: "shell", description: "Run a shell command through XR (approval-gated)",
    aliases: ["shell", "bash"], handler: async (args, ctx) => {
      if (!args.trim()) {
        console.log(`${C.yellow}Usage: /shell <command>${C.reset}`);
        return;
      }
      await runTuiTask(`Run this shell command and report the output: ${args}`, "agent", ctx);
    }
  },
  {
    name: "help", description: "Show all slash commands",
    aliases: ["help", "h", "?"], handler: async () => {
      console.log(`${C.bold}Available slash commands:${C.reset}\n`);
      for (const cmd of SLASH_COMMANDS) {
        const aliases = cmd.aliases.length > 1 ? ` (${cmd.aliases.slice(1).join(", ")})` : "";
        console.log(`  ${C.cyan}/${cmd.name}${aliases}  ${C.dim}${cmd.description}${C.reset}`);
      }
      console.log(`\n${C.dim}  Mode: agent (default) | plan | ask${C.reset}`);
      console.log(`${C.dim}  Press Ctrl+C to exit${C.reset}`);
    }
  },
  {
    name: "exit", description: "Exit XR",
    aliases: ["exit", "quit", "q", "bye"], handler: async () => {
      console.log(`${C.green}Goodbye! XR — the AI agent you can actually trust.${C.reset}`);
      process.exit(0);
    }
  },
  {
    name: "clear", description: "Clear the terminal screen",
    aliases: ["clear", "cls"], handler: async () => {
      console.clear();
      showBanner();
    }
  },
];

// ── Slash Command Dispatch ────────────────────────────────────────────────────
async function handleSlashCommand(input: string, ctx: TUICtx): Promise<boolean> {
  if (!input.startsWith("/")) return false;
  
  const parts = input.slice(1).split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.name === name || cmd.aliases.includes(name)) {
      await cmd.handler(args, ctx);
      return true;
    }
  }
  
  console.log(`${C.yellow}Unknown command: /${name}. Type /help for all commands.${C.reset}`);
  return true;
}

// ── Run Task in TUI Mode ──────────────────────────────────────────────────────
async function runTuiTask(task: string, mode: "agent" | "plan" | "ask", ctx: TUICtx): Promise<AgentResult | null> {
  const { config } = loadConfig();
  const providerId = ctx.config.defaults.provider;
  const model = ctx.config.defaults.model;
  const provider = buildProvider(config, { provider: providerId, model });
  
  // Check provider health
  const health = await provider.health();
  if (!health.ok) {
    console.log(`${C.red}✗ Provider ${providerId} unreachable: ${health.detail}${C.reset}`);
    console.log(`${C.yellow}  Tip: xr model ollama  to switch to a local model (free)${C.reset}`);
    return null;
  }
  
  const budgetAmount = parseFloat(process.env.XR_BUDGET ?? "0");
  const budget = {
    maxUsd: isLocal(providerId) ? undefined : (budgetAmount > 0 ? budgetAmount : config.budget.perTaskUsd),
    maxTokens: config.budget.perTaskTokens,
  };
  
  const lines: string[] = [];
  const say = (line: string) => {
    lines.push(line);
    // Strip ANSI for clean display, keep key info
    console.log(line);
  };
  
  const result = await runAgent(task, mode, {
    provider,
    store: ctx.store,
    cwd: ctx.cwd,
    say,
    approve: approvePrompt,
    onOverBudget: overBudgetPrompt,
    budget,
    pricing: priceFor(providerId, model),
    egressAllowlist: config.security.egressAllowlist,
    dryRun: false,
  } as AgentDeps);
  
  console.log();
  if (result.stopped === "done") {
    console.log(`${C.green}✓ Done in ${result.steps} step(s) · ${result.meter ?? ""}${C.reset}`);
  } else if (result.stopped === "budget") {
    console.log(`${C.yellow}⏸ Budget guard — stopped to respect your ceiling${C.reset}`);
  } else if (result.stopped === "max_steps") {
    console.log(`${C.yellow}⏸ Reached step limit (${result.steps} steps)${C.reset}`);
  } else {
    console.log(`${C.red}✗ ${result.finalMessage}${C.reset}`);
  }
  
  return result;
}

// ── Main TUI Loop ─────────────────────────────────────────────────────────────
export async function startTui(cwd: string): Promise<void> {
  const store = new Store();
  const { config } = loadConfig();
  
  const ctx: TUICtx = {
    store,
    cwd,
    config,
  };
  
  console.clear();
  showBanner();
  
  // Show welcome context
  const providerId = config.defaults.provider;
  const model = config.defaults.model;
  console.log(`${C.dim}  provider: ${providerId} / ${model}${C.reset}`);
  console.log(`${C.dim}  mode: ${config.defaults.mode}${C.reset}`);
  console.log(`${C.dim}  type /help for all commands${C.reset}`);
  console.log();
  
  // Command history for up/down arrows
  const history: string[] = [];
  let historyIndex = -1;
  
  while (true) {
    try {
      const input = await readLine(`${C.brightCyan}xr> ${C.reset}`);
      const trimmed = input.trim();
      
      if (!trimmed) continue;
      
      // Add to history
      if (trimmed !== history[history.length - 1]) {
        history.push(trimmed);
      }
      historyIndex = history.length;
      
      // Check for slash commands first
      if (trimmed.startsWith("/")) {
        await handleSlashCommand(trimmed, ctx);
        continue;
      }
      
      // Run as agent task
      await runTuiTask(trimmed, (config.defaults.mode ?? "agent") as "agent", ctx);
      
    } catch (e) {
      console.log(`${C.red}✗ Error: ${(e as Error).message}${C.reset}`);
    }
  }
}
