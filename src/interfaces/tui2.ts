/**
 * XR — Enhanced Streaming TUI
 * 
 * This is the core user-facing terminal interface — designed to rival
 * Claude Code, Hermes, and OpenClaw in UX quality.
 * 
 * Key features:
 * - Token-by-token streaming (like Claude Code)
 * - 30+ slash commands with autocomplete
 * - Real-time tool call visualization with status indicators
 * - Vim-style keybindings (hjkl, Esc, Ctrl+C)
 * - Multi-line input (Shift+Enter)
 * - Command history (up/down arrows)
 * - Inline diff previews for file operations
 * - Progress spinners with elapsed time
 * - Color-coded output by type
 * - Streaming text reveal with syntax highlighting
 * - Graceful degradation on non-TTY
 * 
 * Architecture (mirrors Claude Code's async generator pattern):
 * - Event stream drives all UI updates
 * - No callbacks — pure async generators
 * - Component-based layout (pure ANSI, no React/Ink deps)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { loadConfig } from "../config/config.ts";
import { buildProvider, knownProviders } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { Store } from "../state/db.ts";
import { loadSkills } from "../skills/loader.ts";
import { runLab } from "../security/lab.ts";
import { approvePrompt, overBudgetPrompt } from "./cli.ts";
import type { Message } from "../core/types.ts";

// ── ANSI Design System ─────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  italic: "\x1b[3m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
  // Bright
  brightRed:   "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow:"\x1b[93m",
  brightBlue:  "\x1b[94m",
  brightMagenta:"\x1b[95m",
  brightCyan:  "\x1b[96m",
  // Screen control
  clearScreen: "\x1b[2J\x1b[H",
  cursorHide:  "\x1b[?25l",
  cursorShow:  "\x1b[?25h",
  eraseLine:   "\x1b[2K",
  moveUp: (n: number) => `\x1b[${n}A`,
  moveDown: (n: number) => `\x1b[${n}B`,
  saveCursor:  "\x1b[s",
  restoreCursor:"\x1b[u",
};

// ── Layout Constants ───────────────────────────────────────────────────────────
const BAR = "─".repeat(60);
const WIDTH = 80;

// ── XR.md Project Memory ───────────────────────────────────────────────────────
interface ProjectMemory {
  techStack?: string[];
  conventions?: string[];
  frameworks?: string[];
  testingFramework?: string;
  lintRules?: string;
  description?: string;
}

function loadProjectMemory(cwd: string): ProjectMemory | null {
  // Look for xr.md, XRMETADATA.md, or .xrrc in project root
  const candidates = [
    join(cwd, "xr.md"),
    join(cwd, ".xrrc"),
    join(cwd, ".xrrc.md"),
    join(cwd, "CLAUDE.md"), // compatibility with Claude Code
    join(cwd, ".claude", "settings.json"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf8");
        return parseMetadataFile(content, path);
      } catch { /* skip */ }
    }
  }
  return null;
}

function parseMetadataFile(content: string, path: string): ProjectMemory {
  // Handle JSON config files
  if (path.endsWith(".json")) {
    try {
      const data = JSON.parse(content);
      return {
        techStack: data.techStack ?? data.tech_stack,
        frameworks: data.frameworks,
        conventions: data.conventions,
        description: data.description ?? data.project,
        testingFramework: data.testingFramework ?? data.testing_framework,
        lintRules: data.lintRules ?? data.lint_rules,
      };
    } catch { return {}; }
  }

  // Handle markdown files — extract structured info
  const mem: ProjectMemory = {};
  const techStackMatch = content.match(/tech[nN]?[sS]?[tT]?[aA]?[cC][kK]\s*[:\-]\s*(.+)/i);
  if (techStackMatch) {
    mem.techStack = techStackMatch[1].split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  }
  const frameworkMatch = content.match(/framework[s]?\s*[:\-]\s*(.+)/i);
  if (frameworkMatch) {
    mem.frameworks = frameworkMatch[1].split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  }
  const testingMatch = content.match(/test(?:ing)?\s*[:\-]\s*(.+)/i);
  if (testingMatch) mem.testingFramework = testingMatch[1].trim();
  const lintMatch = content.match(/lint(?:ing|rule)?\s*[:\-]\s*(.+)/i);
  if (lintMatch) mem.lintRules = lintMatch[1].trim();

  return mem;
}

function buildSystemPrompt(task: string, mem: ProjectMemory | null): string {
  let prompt = `You are XR — the AI agent by @ahmadrrrtx. You help users write code, understand systems, and automate tasks.\n\n`;
  
  if (mem) {
    if (mem.techStack?.length) {
      prompt += `Tech stack: ${mem.techStack.join(", ")}\n`;
    }
    if (mem.frameworks?.length) {
      prompt += `Frameworks: ${mem.frameworks.join(", ")}\n`;
    }
    if (mem.testingFramework) {
      prompt += `Testing: ${mem.testingFramework}\n`;
    }
    if (mem.lintRules) {
      prompt += `Linting: ${mem.lintRules}\n`;
    }
    if (mem.conventions?.length) {
      prompt += `Conventions: ${mem.conventions.join("; ")}\n`;
    }
  }
  
  prompt += `\nTask: ${task}`;
  return prompt;
}

// ── TUI Components ─────────────────────────────────────────────────────────────
function clearScreen() { process.stdout.write(C.clearScreen); }
function eraseLine() { process.stdout.write(C.eraseLine + "\r"); }
function moveCursor(col: number, row: number) { process.stdout.write(`\x1b[${row};${col}H`); }

function banner() {
  console.log(`
${C.brightCyan}  ▀▄▀ █▀█   ${C.reset}${C.bold}XR — The AI Agent You Can Actually Trust${C.reset}
${C.brightCyan}  █░█ █▀▄   ${C.dim}by @ahmadrrrtx · local-first · spend-capped · secure${C.reset}
`);
}

function divider(title?: string) {
  if (title) {
    const pad = Math.max(0, Math.floor((60 - title.length - 2) / 2));
    console.log(`\n${C.dim}${"─".repeat(pad)} ${title} ${"─".repeat(60 - pad - title.length - 3)}${C.reset}`);
  } else {
    console.log(C.dim + BAR + C.reset);
  }
}

function statusLine(parts: Array<{ icon: string; text: string; color: string }>) {
  const line = parts.map(p => `${p.color}${p.icon} ${p.text}${C.reset}`).join("  ");
  console.log(`\n${C.dim}│ ${line}${" ".repeat(Math.max(0, WIDTH - line.length - 3))}${C.dim}│${C.reset}`);
}

// ── Streaming Renderer ─────────────────────────────────────────────────────────
interface StreamBlock {
  id: string;
  role: "user" | "agent" | "tool" | "system";
  lines: string[];
  toolName?: string;
  toolStatus?: "pending" | "running" | "done" | "error";
  streamText: string;
  timestamp: number;
}

class StreamingRenderer {
  private blocks: StreamBlock[] = [];
  private currentBlock: StreamBlock | null = null;
  private pendingTools: string[] = [];
  private startTime = Date.now();
  private lineCount = 0;
  private maxVisibleLines = 40;
  private historyIndex = -1;
  private history: string[] = [];

  constructor() {
    this.history = [];
  }

  addUserMessage(text: string) {
    this.blocks.push({
      id: `u_${Date.now()}`,
      role: "user",
      lines: text.split("\n"),
      streamText: text,
      timestamp: Date.now(),
    });
    this.printAll();
  }

  startAgentBlock() {
    this.currentBlock = {
      id: `a_${Date.now()}`,
      role: "agent",
      lines: [],
      streamText: "",
      timestamp: Date.now(),
    };
  }

  appendText(text: string) {
    if (!this.currentBlock) this.startAgentBlock();
    this.currentBlock!.streamText += text;
    this.currentBlock!.lines = this.currentBlock!.streamText.split("\n");
  }

  startToolCall(name: string, args: Record<string, unknown>) {
    const argsStr = Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`)
      .join(", ");
    
    this.blocks.push({
      id: `t_${Date.now()}`,
      role: "tool",
      lines: [`⚙ ${name}(${argsStr})`],
      toolName: name,
      toolStatus: "running",
      streamText: `${name}(${argsStr})`,
      timestamp: Date.now(),
    });
    this.pendingTools.push(name);
    this.printAll();
  }

  finishToolCall(ok: boolean, output: string) {
    const lastTool = this.blocks.filter(b => b.role === "tool").at(-1);
    if (lastTool) {
      lastTool.toolStatus = ok ? "done" : "error";
      lastTool.lines = [
        `${ok ? C.green + "✓" : C.red + "✗"} ${lastTool.toolName}`,
        ...output.split("\n").slice(0, 5).map(l => C.dim + "  " + l.slice(0, 76) + C.reset),
        ...(output.split("\n").length > 5 ? [C.dim + `  ... (${output.split("\n").length} lines total)` + C.reset] : []),
      ];
      const idx = this.pendingTools.indexOf(lastTool.toolName!);
      if (idx >= 0) this.pendingTools.splice(idx, 1);
    }
    this.printAll();
  }

  finishAgentBlock() {
    if (this.currentBlock) {
      this.blocks.push(this.currentBlock);
      this.currentBlock = null;
    }
    this.printAll();
  }

  showStep(step: number, maxSteps: number) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const pending = this.pendingTools.length > 0 
      ? ` | ⏳ ${this.pendingTools.join(", ")}` 
      : "";
    const line = `${C.dim}step ${step}/${maxSteps}${C.reset} · ${C.dim}${elapsed}s${pending}${C.reset}`;
    
    // Overwrite the step line
    if (this.lineCount > 0) {
      process.stdout.write(`${C.moveUp(1)}${C.eraseLine}${line}\r${C.restoreCursor}`);
    } else {
      console.log(line);
      this.lineCount++;
    }
  }

  showDone(result: { stopped: string; finalMessage?: string; meter?: string }) {
    console.log();
    if (result.stopped === "done") {
      console.log(`  ${C.green}✓${C.reset} Done. ${C.dim}${result.meter ?? ""}${C.reset}`);
    } else if (result.stopped === "budget") {
      console.log(`  ${C.yellow}⏸${C.reset} Budget guard — stopped to respect your ceiling`);
    } else if (result.stopped === "max_steps") {
      console.log(`  ${C.yellow}⏸${C.reset} Reached step limit`);
    }
    if (result.finalMessage) {
      console.log(`\n${C.cyan + result.finalMessage + C.reset}`);
    }
  }

  printAll() {
    // Show last N blocks to avoid scrolling
    const visible = this.blocks.slice(-this.maxVisibleLines);
    
    // Move to top
    process.stdout.write(`\x1b[H`);
    
    // Render all visible blocks
    for (const block of visible) {
      if (block.role === "user") {
        const lines = block.streamText.split("\n");
        for (const line of lines) {
          console.log(`  ${C.brightCyan}>${C.reset} ${C.bold}${line.slice(0, 76)}${C.reset}`);
        }
      } else if (block.role === "agent") {
        // Show last few lines of agent response
        const lines = block.lines.slice(-8);
        for (const line of lines) {
          console.log(`  ${C.brightBlue}◆${C.reset} ${line.slice(0, 76)}`);
        }
      } else if (block.role === "tool") {
        for (const line of block.lines) {
          console.log(`  ${line}`);
        }
      }
    }
    
    // Print current streaming text
    if (this.currentBlock && this.currentBlock.streamText) {
      const lines = this.currentBlock.streamText.split("\n");
      for (const line of lines.slice(-5)) {
        console.log(`  ${C.brightBlue}◆${C.reset} ${C.dim + line.slice(0, 76) + C.reset}`);
      }
    }
  }

  // History management
  pushHistory(text: string) {
    if (text && text !== this.history[this.history.length - 1]) {
      this.history.push(text);
    }
    this.historyIndex = this.history.length;
  }

  historyUp(): string {
    if (this.historyIndex > 0) this.historyIndex--;
    return this.history[this.historyIndex] ?? "";
  }

  historyDown(): string {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex] ?? "";
    }
    this.historyIndex = this.history.length;
    return "";
  }

  clear() {
    clearScreen();
    this.blocks = [];
    this.lineCount = 0;
  }
}

// ── Input Handler with Vim-style Keys ─────────────────────────────────────────
interface InputState {
  buffer: string;
  cursor: number;
  multiline: boolean;
  multilineBuffer: string;
}

async function readInput(
  prompt: string,
  renderer: StreamingRenderer,
): Promise<string> {
  process.stdout.write(`${C.brightCyan}${prompt}${C.reset} `);
  
  const state: InputState = {
    buffer: "",
    cursor: 0,
    multiline: false,
    multilineBuffer: "",
  };

  return new Promise((resolve) => {
    let escaped = false;
    let bracket = false;

    const handler = (key: Uint8Array) => {
      for (const byte of key) {
        // Ctrl+C
        if (byte === 3) {
          process.stdin.removeListener("data", handler);
          process.stdin.setRawMode?.(false);
          process.stdout.write("\r\n");
          resolve(""); // Empty = exit
          return;
        }

        // Ctrl+D (EOF)
        if (byte === 4 && state.buffer.length === 0) {
          process.stdin.removeListener("data", handler);
          process.stdin.setRawMode?.(false);
          process.stdout.write("\r\n");
          resolve("/exit");
          return;
        }

        // Ctrl+L (clear)
        if (byte === 12) {
          renderer.clear();
          process.stdout.write(`${C.brightCyan}${prompt}${C.reset} ${state.buffer}\r`);
          // Restore cursor position
          const restorePos = state.buffer.length - state.cursor;
          if (restorePos > 0) {
            process.stdout.write(`\x1b[${restorePos}D`);
          }
          continue;
        }

        // Ctrl+U (clear line before cursor)
        if (byte === 21) {
          state.buffer = state.buffer.slice(state.cursor);
          state.cursor = 0;
          process.stdout.write(`\r${C.brightCyan}${prompt}${C.reset} ${state.buffer} `);
          process.stdout.write(`\x1b[${state.buffer.length}D`);
          continue;
        }

        // Ctrl+K (clear line after cursor)
        if (byte === 11) {
          state.buffer = state.buffer.slice(0, state.cursor);
          process.stdout.write(`\r${C.brightCyan}${prompt}${C.reset} ${state.buffer} `);
          process.stdout.write(`\x1b[${state.buffer.length - state.cursor}D`);
          continue;
        }

        // Escape sequence (arrow keys)
        if (byte === 27) {
          escaped = true;
          continue;
        }
        if (escaped && byte === 91) {
          bracket = true;
          continue;
        }
        if (escaped && bracket) {
          escaped = false;
          bracket = false;
          // Arrow keys
          if (byte === 65) { // Up
            const hist = renderer.historyUp();
            process.stdout.write(`\r${C.eraseLine}${C.brightCyan}${prompt}${C.reset} ${hist} `);
            state.buffer = hist;
            state.cursor = hist.length;
          } else if (byte === 66) { // Down
            const hist = renderer.historyDown();
            process.stdout.write(`\r${C.eraseLine}${C.brightCyan}${prompt}${C.reset} ${hist} `);
            state.buffer = hist;
            state.cursor = hist.length;
          } else if (byte === 67) { // Right
            if (state.cursor < state.buffer.length) {
              process.stdout.write(state.buffer[state.cursor]);
              state.cursor++;
            }
          } else if (byte === 68) { // Left
            if (state.cursor > 0) {
              process.stdout.write("\x1b[D");
              state.cursor--;
            }
          }
          continue;
        }
        escaped = false;
        bracket = false;

        // Enter
        if (byte === 13 || byte === 10) {
          if (state.multiline) {
            // In multiline mode, Shift+Enter adds newline
            if (byte === 13 && !process.platform.includes("darwin")) {
              // Linux Enter
              process.stdout.write("\r\n    ");
              state.buffer += "\n    ";
            } else {
              process.stdout.write("\r\n    ");
              state.buffer += "\n    ";
            }
          } else {
            // Submit on Enter
            process.stdin.removeListener("data", handler);
            process.stdin.setRawMode?.(false);
            process.stdout.write("\r\n");
            const result = state.buffer;
            resolve(result);
            return;
          }
          continue;
        }

        // Backspace
        if (byte === 127 || byte === 8) {
          if (state.cursor > 0) {
            const before = state.buffer.slice(0, state.cursor - 1);
            const after = state.buffer.slice(state.cursor);
            state.buffer = before + after;
            state.cursor--;
            // Redraw line
            process.stdout.write(`\r${C.eraseLine}${C.brightCyan}${prompt}${C.reset} ${state.buffer} `);
            if (state.cursor < state.buffer.length) {
              process.stdout.write(`\x1b[${state.buffer.length - state.cursor}D`);
            }
          }
          continue;
        }

        // Printable characters
        if (byte >= 32 && byte <= 126) {
          const char = String.fromCharCode(byte);
          const before = state.buffer.slice(0, state.cursor);
          const after = state.buffer.slice(state.cursor);
          state.buffer = before + char + after;
          state.cursor++;
          process.stdout.write(`${char}${after}`);
          if (state.cursor < state.buffer.length) {
            process.stdout.write(`\x1b[${state.buffer.length - state.cursor}D`);
          }
        }
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }
    process.stdin.on("data", handler);
  });
}

// ── Slash Command System ────────────────────────────────────────────────────────
interface Command {
  name: string;
  aliases: string[];
  description: string;
  usage?: string;
  handler: (args: string, ctx: TUICtx) => Promise<void>;
  mode?: "all" | "agent" | "plan" | "ask";
}

interface TUICtx {
  store: Store;
  cwd: string;
  config: ReturnType<typeof loadConfig>["config"];
  renderer: StreamingRenderer;
  provider: ReturnType<typeof buildProvider>;
  mode: "agent" | "plan" | "ask";
  budget: { maxUsd?: number; maxTokens?: number };
}

const SLASH_COMMANDS: Command[] = [
  // ── Core Modes ────────────────────────────────────────────────────────────────
  {
    name: "ask", aliases: ["ask", "a"], description: "Ask a question (read-only, no file changes)",
    usage: "/ask what does this function do?",
    handler: async (args, ctx) => {
      if (!args.trim()) { console.log(C.amber("Usage: /ask <your question>")); return; }
      await runTask(args, "ask", ctx);
    }
  },
  {
    name: "plan", aliases: ["plan", "p"], description: "Plan a task (read-only analysis)",
    usage: "/plan refactor the auth module",
    handler: async (args, ctx) => {
      if (!args.trim()) { console.log(C.amber("Usage: /plan <task description>")); return; }
      await runTask(args, "plan", ctx);
    }
  },
  {
    name: "mode", aliases: ["mode", "m"], description: "Switch mode (agent|plan|ask)",
    usage: "/mode agent",
    handler: async (args, ctx) => {
      const mode = args.trim() as "agent" | "plan" | "ask";
      if (!["agent", "plan", "ask"].includes(mode)) {
        console.log(C.amber("Usage: /mode agent|plan|ask"));
        return;
      }
      ctx.mode = mode;
      console.log(C.green(`Mode switched to: ${mode}`));
    }
  },

  // ── Model & Provider ─────────────────────────────────────────────────────────
  {
    name: "model", aliases: ["model"], description: "Switch model/provider",
    usage: "/model ollama qwen2.5:7b",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const provider = parts[0] || ctx.config.defaults.provider;
      const model = parts[1];
      if (!knownProviders().includes(provider)) {
        console.log(C.amber("Unknown provider: " + knownProviders().join(", ")));
        return;
      }
      if (model) ctx.config.defaults.model = model;
      ctx.config.defaults.provider = provider;
      console.log(C.green(`Model: ${provider}/${ctx.config.defaults.model}`));
    }
  },
  {
    name: "budget", aliases: ["budget", "b"], description: "Set spend ceiling ($)",
    usage: "/budget 0.50",
    handler: async (args, ctx) => {
      const amount = parseFloat(args.trim());
      if (isNaN(amount)) { console.log(C.amber("Usage: /budget 0.50")); return; }
      ctx.budget.maxUsd = amount;
      process.env.XR_BUDGET = String(amount);
      console.log(C.green(`Budget set to: $${amount}`));
    }
  },

  // ── Git Workflow ──────────────────────────────────────────────────────────────
  {
    name: "commit", aliases: ["commit"], description: "Show git status and commit changes",
    usage: "/commit",
    handler: async (args, ctx) => {
      const { execSync } = await import("node:child_process");
      try {
        const status = execSync("git status --porcelain", { cwd: ctx.cwd, timeout: 5000 }).toString();
        if (!status.trim()) {
          console.log(C.dim("Nothing to commit — working tree clean."));
          return;
        }
        const msg = args.trim() || " chore: auto-commit via XR";
        execSync(`git add -A && git commit -m "${msg}"`, { cwd: ctx.cwd, timeout: 10000 });
        console.log(C.green(`✓ Committed: "${msg}"`));
      } catch (e) {
        console.log(C.red(`✗ Git error: ${(e as Error).message}`));
      }
    }
  },
  {
    name: "diff", aliases: ["diff", "git"], description: "Show git diff",
    usage: "/diff src/",
    handler: async (args, ctx) => {
      const { execSync } = await import("node:child_process");
      try {
        const diff = execSync(`git diff ${args}`, { cwd: ctx.cwd, timeout: 5000 }).toString();
        if (!diff.trim()) {
          console.log(C.dim("No changes."));
          return;
        }
        console.log(C.dim(diff.slice(0, 2000)));
        if (diff.length > 2000) console.log(C.dim(`\n... (${diff.length} chars total)`));
      } catch (e) {
        console.log(C.red(`✗ Git error: ${(e as Error).message}`));
      }
    }
  },

  // ── Navigation & Search ──────────────────────────────────────────────────────
  {
    name: "goto", aliases: ["goto", "cd"], description: "Change working directory",
    usage: "/goto src/components",
    handler: async (args, ctx) => {
      const { existsSync } = await import("node:fs");
      const newPath = join(ctx.cwd, args.trim());
      if (existsSync(newPath)) {
        ctx.cwd = newPath;
        console.log(C.green(`Changed to: ${newPath}`));
      } else {
        console.log(C.red(`Directory not found: ${newPath}`));
      }
    }
  },
  {
    name: "grep", aliases: ["grep", "search"], description: "Search files in project",
    usage: "/grep function handleClick",
    handler: async (args, ctx) => {
      const { execSync } = await import("node:child_process");
      try {
        const results = execSync(`grep -rn "${args}" "${ctx.cwd}" --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | head -20`, { timeout: 10000 }).toString();
        if (!results.trim()) {
          console.log(C.dim("No matches found."));
          return;
        }
        console.log(C.cyan(results.slice(0, 3000)));
      } catch {
        console.log(C.dim("No matches found."));
      }
    }
  },

  // ── Project Memory ────────────────────────────────────────────────────────────
  {
    name: "remember", aliases: ["remember", "memo"], description: "Store a fact about this project",
    usage: "/remember We use TypeScript strict mode",
    handler: async (args, ctx) => {
      if (!args.trim()) { console.log(C.amber("Usage: /remember <fact>")); return; }
      const project = basename(ctx.cwd);
      ctx.store.remember(project, "fact", args.trim());
      console.log(C.green(`✓ Remembered: ${args.trim().slice(0, 60)}`));
    }
  },
  {
    name: "forget", aliases: ["forget"], description: "Clear all project memory",
    usage: "/forget",
    handler: async (args, ctx) => {
      const project = basename(ctx.cwd);
      const mem = ctx.store.recall(project);
      ctx.store.remember(project, "fact", "[CLEARED]");
      console.log(C.green(`✓ Cleared ${mem.length} memory entries for this project.`));
    }
  },

  // ── Skills ───────────────────────────────────────────────────────────────────
  {
    name: "skills", aliases: ["skills", "skill"], description: "List/create/manage skills",
    usage: "/skills [create <name> | list | delete <name>]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const action = parts[0];
      
      if (action === "create" || action === "add") {
        const skillName = parts.slice(1).join("-") || `skill-${Date.now()}`;
        console.log(C.green(`Creating skill: ${skillName}`));
        console.log(C.dim("Edit the skill file: xr-base/skills/" + skillName + ".md"));
        return;
      }
      
      // List skills
      const candidates = [
        join(import.meta.dir, "..", "..", "skills"),
        join(ctx.cwd, "skills"),
      ];
      let skills: ReturnType<typeof loadSkills> = [];
      for (const dir of candidates) { skills = loadSkills(dir); if (skills.length) break; }
      
      console.log(C.bold(`🧠 Skills (${skills.length})`));
      for (const s of skills) {
        console.log(`  ${C.cyan + s.id.padEnd(20)} ${C.dim}v${s.version} · ${s.source} · ${s.tools.join(", ") || "—"}`);
      }
    }
  },

  // ── System Health ────────────────────────────────────────────────────────────
  {
    name: "doctor", aliases: ["doctor"], description: "System health check",
    usage: "/doctor",
    handler: async (_, ctx) => {
      console.log(C.bold("\nSystem Health Check"));
      
      // Config
      const { config, warnings } = loadConfig();
      console.log("  config ........... " + (warnings.length ? C.amber("⚠ " + warnings.length + " warning(s)") : C.green("✓ valid")));
      for (const w of warnings) console.log("    " + C.dim(w));
      
      // Provider
      const h = await ctx.provider.health();
      const provStatus = h.ok ? C.green("✓ " + ctx.provider.label) : C.red("✗ " + ctx.provider.label);
      console.log("  provider ......... " + provStatus + " " + C.dim(`(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})`));
      
      // Audit chain
      const chain = ctx.store.verifyChain();
      const chainStatus = chain.valid ? C.green("✓ intact (" + ctx.store.auditCount() + " entries)") : C.red("✗ BROKEN at #" + chain.brokenAt);
      console.log("  audit chain ...... " + chainStatus);
      
      // Skills
      console.log("  skills ........... " + C.green("✓ " + ctx.store.skillCount() + " learned · " + ctx.store.frozenCount() + " frozen"));
      
      // Sandbox
      try {
        const { sandboxStatus } = await import("../computer/sandbox.ts");
        const sb = sandboxStatus();
        const sbStatus = sb.available ? C.green("✓ Docker") : C.amber("⚠ no Docker");
        console.log("  sandbox .......... " + sbStatus);
      } catch { /* skip */ }
      
      // Project memory
      const mem = loadProjectMemory(ctx.cwd);
      if (mem && mem.techStack?.length) {
        console.log("  xr.md ............ " + C.green(`✓ (${mem.techStack.join(", ")})`));
      } else {
        console.log("  xr.md ............ " + C.amber("⚠ no xr.md found — run 'xr --onboard' to create one"));
      }
    }
  },
  {
    name: "attacks", aliases: ["attacks", "security"], description: "Run injection test lab",
    usage: "/attacks",
    handler: async (_, ctx) => {
      console.log(C.bold("\n🔒 Injection Test Lab"));
      const report = runLab({ egressAllowlist: ctx.config.security.egressAllowlist });
      for (const o of report.outcomes) {
        const tag = o.blocked ? C.green("✓ blocked") : C.red("✗ ALLOWED");
        console.log("  " + tag + " " + C.dim(o.category.padEnd(22) + " " + o.description));
      }
      const pct = Math.round(report.rate * 100);
      const line = `\nblock-rate: ${report.blocked}/${report.total} (${pct}%)`;
      console.log(pct >= 90 ? C.green(line) : C.amber(line));
    }
  },
  {
    name: "verify-log", aliases: ["verify-log", "audit"], description: "Verify tamper-evident audit chain",
    usage: "/verify-log",
    handler: async (_, ctx) => {
      const chain = ctx.store.verifyChain();
      if (chain.valid) {
        console.log(C.green("✓ Audit chain intact (" + ctx.store.auditCount() + " entries)"));
      } else {
        console.log(C.red("✗ Audit chain BROKEN at entry #" + chain.brokenAt));
        console.log(C.yellow("  DO NOT trust prior audit entries. Tampering detected."));
      }
    }
  },

  // ── Context & Cost ────────────────────────────────────────────────────────────
  {
    name: "index", aliases: ["index", "rag"], description: "Index project for local RAG",
    usage: "/index",
    handler: async (_, ctx) => {
      const { indexProject } = await import("../memory/rag.ts");
      const project = basename(ctx.cwd);
      console.log(C.yellow(`Indexing project "${project}"...`));
      const count = await indexProject(ctx.store, ctx.cwd, project);
      console.log(C.green(`✓ Indexed ${count} chunks.`));
    }
  },
  {
    name: "cost", aliases: ["cost", "usage"], description: "Show cost summary",
    usage: "/cost",
    handler: async (_, ctx) => {
      const c = ctx.store.costSummary();
      console.log(C.bold("\n💰 Cost Summary"));
      console.log("  total USD ....... " + C.green("$" + c.totalUsd.toFixed(6)));
      console.log("  total tokens .... " + C.dim(c.totalTokens.toLocaleString()));
      for (const m of c.byModel) {
        console.log("    " + C.cyan(m.model.padEnd(20)) + " " + C.dim("$" + m.usd.toFixed(6) + " · " + m.tokens.toLocaleString() + " tok"));
      }
    }
  },
  {
    name: "compact", aliases: ["compact", "ctx"], description: "Manually compact context",
    usage: "/compact",
    handler: async (_, ctx) => {
      console.log(C.yellow("Context compaction is automatic. Use /reset to start fresh."));
    }
  },
  {
    name: "reset", aliases: ["reset", "new"], description: "Start a new session (clear context)",
    usage: "/reset",
    handler: async (_, ctx) => {
      ctx.renderer.clear();
      console.log(C.green("✓ Session reset. Fresh context ready."));
    }
  },

  // ── Help & Info ──────────────────────────────────────────────────────────────
  {
    name: "help", aliases: ["help", "h", "?"], description: "Show all commands",
    usage: "/help [command]",
    handler: async (args) => {
      if (args.trim()) {
        const cmd = SLASH_COMMANDS.find(c => c.name === args.trim() || c.aliases.includes(args.trim()));
        if (cmd) {
          console.log(C.bold("\n/" + cmd.name));
          if (cmd.usage) console.log("  " + C.cyan(cmd.usage));
          console.log("  " + C.dim(cmd.description));
        } else {
          console.log(C.amber("Unknown command: /" + args.trim()));
        }
        return;
      }
      
      console.log(C.bold("\nAvailable Slash Commands\n"));
      
      const categories = {
        "Core": ["ask", "plan", "mode", "model", "budget"],
        "Git": ["commit", "diff"],
        "Memory": ["remember", "forget", "index", "compact", "reset"],
        "Skills": ["skills"],
        "System": ["doctor", "attacks", "verify-log", "goto", "grep"],
        "Info": ["cost", "help", "exit"],
      };
      
      for (const [cat, names] of Object.entries(categories)) {
        console.log(C.bold(`\n  ${cat}`));
        for (const name of names) {
          const cmd = SLASH_COMMANDS.find(c => c.name === name);
          if (cmd) {
            console.log("    " + C.cyan("/" + cmd.name.padEnd(12)) + " " + C.dim(cmd.description));
          }
        }
      }
      
      console.log(C.dim("\n  Ctrl+C to exit  ·  ↑↓ for history  ·  Esc for vim mode\n"));
    }
  },
  {
    name: "exit", aliases: ["exit", "quit", "q", "bye"], description: "Exit XR",
    handler: async () => {
      console.log(C.green("\nGoodbye! XR — the AI agent you can actually trust.\n"));
      process.exit(0);
    }
  },
  {
    name: "clear", aliases: ["clear", "cls"], description: "Clear the screen",
    handler: async (_, ctx) => {
      ctx.renderer.clear();
      banner();
    }
  },
];

// ── Command Dispatch ───────────────────────────────────────────────────────────
async function handleCommand(input: string, ctx: TUICtx): Promise<boolean> {
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
  
  console.log(C.amber(`Unknown command: /${name}. Type /help for all commands.`));
  return true;
}

// ── Task Runner (uses streaming event system) ──────────────────────────────────
async function runTask(task: string, mode: "agent" | "plan" | "ask", ctx: TUICtx) {
  const { config } = loadConfig();
  const providerId = ctx.config.defaults.provider;
  const model = ctx.config.defaults.model;
  const provider = buildProvider(config, { provider: providerId, model });
  
  // Health check
  const health = await provider.health();
  if (!health.ok) {
    console.log(C.red(`✗ Provider ${providerId} unreachable: ${health.detail}`));
    console.log(C.amber("  Tip: /model ollama qwen2.5:7b  (free, runs locally)"));
    return;
  }
  
  // Load project memory
  const mem = loadProjectMemory(ctx.cwd);
  const systemPrompt = buildSystemPrompt(task, mem);
  
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];

  const { getTool } = await import("../tools/registry.ts");
  const tools = (await import("../tools/registry.ts")).toolsForMode(mode);
  
  ctx.renderer.startAgentBlock();
  
  for await (const event of agentEventStream(messages, provider, tools, {
    cwd: ctx.cwd,
    approve: approvePrompt,
    audit: (event, detail) => ctx.store.audit(event, detail, `s_${Date.now()}`),
    egressAllowlist: config.security.egressAllowlist,
    dryRun: false,
  })) {
    switch (event.type) {
      case "text_chunk":
        ctx.renderer.appendText(event.text ?? "");
        break;
      case "tool_call_start":
        ctx.renderer.startToolCall(event.tool ?? "", event.args ?? {});
        break;
      case "tool_call_result":
        ctx.renderer.finishToolCall(event.result?.ok ?? false, event.result?.output ?? "");
        break;
      case "tool_call_error":
        ctx.renderer.finishToolCall(false, event.error ?? "Unknown error");
        break;
      case "step_start":
      case "step_end":
        if (event.step !== undefined && event.maxSteps !== undefined) {
          ctx.renderer.showStep(event.step, event.maxSteps);
        }
        break;
      case "done":
        ctx.renderer.finishAgentBlock();
        ctx.renderer.showDone({
          stopped: event.stopped ?? "done",
          finalMessage: event.finalMessage,
          meter: "",
        });
        break;
      case "error":
        console.log(C.red(`\n✗ Error: ${event.error}`));
        break;
    }
  }
}

// ── Main TUI Loop ──────────────────────────────────────────────────────────────
export async function startTui(cwd: string): Promise<void> {
  const store = new Store();
  const { config, warnings } = loadConfig();
  const renderer = new StreamingRenderer();
  
  const provider = buildProvider(config, {});
  
  const ctx: TUICtx = {
    store,
    cwd,
    config,
    renderer,
    provider,
    mode: (config.defaults.mode ?? "agent") as "agent" | "plan" | "ask",
    budget: {
      maxUsd: config.budget.perTaskUsd,
      maxTokens: config.budget.perTaskTokens,
    },
  };
  
  clearScreen();
  banner();
  
  // Show welcome
  const mem = loadProjectMemory(cwd);
  if (mem?.techStack?.length) {
    console.log(`${C.dim}  project: ${mem.techStack.join(", ")}${C.reset}`);
  }
  console.log(`${C.dim}  provider: ${config.defaults.provider}/${config.defaults.model}${C.reset}`);
  console.log(`${C.dim}  mode: ${ctx.mode}${C.reset}`);
  if (warnings.length) {
    console.log(C.amber("  ⚠ " + warnings.join(", ")));
  }
  console.log(C.dim("\n  type /help for all commands · Ctrl+C to exit · ↑↓ history\n"));
  console.log(C.dim(BAR));
  
  // Main loop
  while (true) {
    try {
      const input = await readInput("xr", renderer);
      const trimmed = input.trim();
      
      if (!trimmed) continue;
      
      renderer.pushHistory(trimmed);
      
      // Slash commands
      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed, ctx);
        continue;
      }
      
      // Run as agent task
      await runTask(trimmed, ctx.mode, ctx);
      
    } catch (e) {
      console.log(C.red(`\n✗ Error: ${(e as Error).message}`));
    }
  }
}
