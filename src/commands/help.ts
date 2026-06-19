/**
 * XR Stage 5 — Command Discovery Surface
 *
 * "xr help" and "xr" with no args both route here.
 * This is the primary onboarding surface for new users.
 *
 * Design goals:
 *  - Teach, don't just list
 *  - Show the most common paths first
 *  - Group by intent, not alphabetically
 *  - Surface the TUI and dashboard prominently
 *  - Include examples for every major command
 */

import { banner } from "../interfaces/cli.ts";
import { xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, SYM } from "../ui/theme.ts";
import { section, divider, kv, badge, helpPanel } from "../ui/layout.ts";

export function showHelp(topic?: string): void {
  if (topic) {
    showTopicHelp(topic);
    return;
  }

  banner();

  // ── Quick Start ──────────────────────────────────────────────────────────
  console.log(`  ${xrBold("Quick Start")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  console.log(`  ${xrCyan("xr onboarding")}               ${xrDim("first-time setup wizard")}`);
  console.log(`  ${xrCyan('xr "write a hello world"')}    ${xrDim("run a task (one-shot)")}`);
  console.log(`  ${xrCyan("xr --tui")}                    ${xrDim("open interactive terminal UI")}`);
  console.log(`  ${xrCyan("xr serve")}                    ${xrDim("start dashboard + chat server")}`);
  console.log();

  // ── Core Commands ────────────────────────────────────────────────────────
  console.log(`  ${xrBold("Core")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);

  const commands = [
    ["xr <task>",                        "run a task in agent mode"],
    ["xr --tui",                         "interactive TUI (Claude Code–style)"],
    ["xr serve",                         "start local dashboard + chat UI"],
    ["xr onboarding",                    "setup wizard (re-run anytime)"],
    ["xr doctor",                        "system health check"],
    ["xr \"task\" --budget 0.25",         "run with hard spend ceiling"],
    ["xr \"task\" --mode plan",           "plan only, no execution"],
    ["xr \"task\" --mode ask",            "ask only, read-only"],
  ];

  for (const [cmd, desc] of commands) {
    console.log(`  ${xrCyan(cmd.padEnd(38))} ${xrDim(desc)}`);
  }
  console.log();

  // ── Providers & Models ───────────────────────────────────────────────────
  console.log(`  ${xrBold("Providers & Models")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  const provCmds = [
    ["xr providers list",                "list all providers and their status"],
    ["xr providers set <id>",            "switch primary provider"],
    ["xr providers add <id>",            "add an API key"],
    ["xr providers test",                "test all configured providers"],
    ["xr models",                        "local AI status"],
    ["xr models recommend",              "recommend model for this machine"],
    ["xr models install",                "install recommended local model"],
    ["xr models list",                   "list available model families"],
  ];
  for (const [cmd, desc] of provCmds) {
    console.log(`  ${xrCyan(cmd.padEnd(38))} ${xrDim(desc)}`);
  }
  console.log();

  // ── Memory, Research, Plugins ────────────────────────────────────────────
  console.log(`  ${xrBold("Memory · Research · Plugins")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  const memCmds = [
    ['xr memory add "prefer TypeScript"', "save a preference to memory"],
    ["xr memory list",                   "show all saved memories"],
    ["xr memory recall \"query\"",        "what XR would surface + why"],
    ["xr memory search \"text\"",         "keyword search"],
    ["xr memory health",                 "memory health (expired, unused)"],
    ["xr memory remove <id>",            "delete a specific memory"],
    ["xr memory prune",                  "delete expired entries"],
    ["xr memory export | import",        "portable JSON bundle"],
    ['xr research "AI agents 2026"',     "run a research job"],
    ["xr plugins list",                  "list installed plugins"],
    ["xr plugins install ./plugin",      "install a plugin (shows permissions)"],
    ["xr plugins enable <name>",         "enable a specific plugin"],
  ];
  for (const [cmd, desc] of memCmds) {
    console.log(`  ${xrCyan(cmd.padEnd(38))} ${xrDim(desc)}`);
  }
  console.log();

  // ── Security & Audit ─────────────────────────────────────────────────────
  console.log(`  ${xrBold("Security & Audit")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  const secCmds = [
    ["xr verify-log",                    "verify SHA-256 audit chain integrity"],
    ["xr attacks",                       "run injection defense benchmark"],
    ["xr config set security.egress []", "configure egress allow-list"],
    ["xr doctor",                        "full health check"],
  ];
  for (const [cmd, desc] of secCmds) {
    console.log(`  ${xrCyan(cmd.padEnd(38))} ${xrDim(desc)}`);
  }
  console.log();

  // ── Voice & Computer Control ─────────────────────────────────────────────
  console.log(`  ${xrBold("Voice & Computer Control")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  const voiceCmds = [
    ["xr voice start",                   "start voice control (opt-in)"],
    ["xr control start",                 "start safe computer control"],
    ["xr --computer \"open browser\"",    "JARVIS-style automation"],
  ];
  for (const [cmd, desc] of voiceCmds) {
    console.log(`  ${xrCyan(cmd.padEnd(38))} ${xrDim(desc)}`);
  }
  console.log();

  // ── TUI Slash Commands ───────────────────────────────────────────────────
  console.log(`  ${xrBold("TUI Slash Commands")} ${xrDim("(inside xr --tui)")}`);
  console.log(`  ${xrDim("─────────────────────────────────────────────")}`);
  const tuiCmds = [
    ["/ask <question>",    "read-only question"],
    ["/plan <task>",       "plan without executing"],
    ["/model <p> [model]", "switch provider/model"],
    ["/budget <usd>",      "set spend ceiling"],
    ["/status",            "full system status"],
    ["/memory",            "view memory & RAG"],
    ["/attacks",           "run security lab"],
    ["/dashboard",         "open browser dashboard"],
    ["/chat",              "open browser chat UI"],
    ["/help",              "show all slash commands"],
    ["/exit",              "exit XR"],
  ];
  for (const [cmd, desc] of tuiCmds) {
    console.log(`  ${xrCyan(cmd.padEnd(28))} ${xrDim(desc)}`);
  }
  console.log();

  // ── Footer ───────────────────────────────────────────────────────────────
  console.log(`  ${xrDim("For topic help:")} ${xrCyan("xr help <topic>")}`);
  console.log(`  ${xrDim("Topics:")} ${["providers", "models", "memory", "security", "tui", "voice", "research", "plugins"].join("  ")}`);
  console.log();
  console.log(`  ${xrDim("Docs:")} ${xrCyan("https://github.com/ahmadrrrtx/xr")}`);
  console.log(`  ${xrDim("Website:")} ${xrCyan("https://xr-gules.vercel.app")}`);
  console.log();
}

// ── Topic Help ────────────────────────────────────────────────────────────────

function showTopicHelp(topic: string): void {
  const t = topic.toLowerCase().trim();

  if (t === "tui") {
    banner();
    console.log(`  ${xrBold("XR TUI — Interactive Terminal UI")}\n`);
    console.log(`  Start with: ${xrCyan("xr --tui")}\n`);
    console.log(`  The TUI gives you a full agent workspace in your terminal:`);
    console.log(`  ${xrDim("  · Command history (↑/↓ arrows)")}`);
    console.log(`  ${xrDim("  · Real-time spinner while XR thinks")}`);
    console.log(`  ${xrDim("  · Structured tool-call display")}`);
    console.log(`  ${xrDim("  · Provider/model/budget status bar")}`);
    console.log(`  ${xrDim("  · Slash commands for everything")}`);
    console.log(`  ${xrDim("  · /status for full system health")}`);
    console.log(`  ${xrDim("  · /dashboard to open browser control center")}`);
    console.log();
    return;
  }

  if (t === "security") {
    banner();
    console.log(`  ${xrBold("XR Security")}\n`);
    console.log(`  All security features are ${xrGreen("code-enforced")}, not optional.\n`);
    console.log(`  ${xrGreen("•")} ${xrBold("Tamper-evident audit log")}  SHA-256 hash chain on every action`);
    console.log(`  ${xrGreen("•")} ${xrBold("Hard budget ceiling")}       agent cannot exceed the cap`);
    console.log(`  ${xrGreen("•")} ${xrBold("Egress allow-list")}         only configured domains can receive data`);
    console.log(`  ${xrGreen("•")} ${xrBold("Injection defense")}         10-attack benchmark, SHA-256 signed report`);
    console.log(`  ${xrGreen("•")} ${xrBold("Approval gates")}            explicit consent for risky actions`);
    console.log(`  ${xrGreen("•")} ${xrBold("API key redaction")}         keys never stored in audit log`);
    console.log(`  ${xrGreen("•")} ${xrBold("Local-first")}               no data leaves your machine by default`);
    console.log();
    console.log(`  ${xrCyan("xr verify-log")}     verify audit chain`);
    console.log(`  ${xrCyan("xr attacks")}        run injection benchmark`);
    console.log(`  ${xrCyan("xr doctor")}         full health check`);
    console.log();
    return;
  }

  if (t === "providers") {
    banner();
    console.log(`  ${xrBold("XR Providers")}\n`);
    console.log(`  ${xrDim("Supported:")} Ollama · Claude · OpenAI · Gemini · Groq · DeepSeek · Together`);
    console.log(`              Mistral · Cohere · Cerebras · OpenRouter · Bedrock\n`);
    console.log(`  ${xrCyan("xr providers list")}           list all providers and status`);
    console.log(`  ${xrCyan("xr providers set openai")}     switch to OpenAI`);
    console.log(`  ${xrCyan("xr providers add claude")}     add Anthropic API key`);
    console.log(`  ${xrCyan("xr providers test")}           test all configured providers`);
    console.log(`  ${xrCyan("xr providers remove openai")}  remove OpenAI key`);
    console.log();
    return;
  }

  if (t === "memory") {
    banner();
    console.log(`  ${xrBold("XR Memory — Stage 6")}\n`);
    console.log(`  XR remembers ${xrGreen("only what you explicitly tell it to")}. Durable, local-first, inspectable.\n`);
    console.log(`  ${xrBold("Write")}`);
    console.log(`  ${xrCyan('xr memory add "prefer TypeScript" --category preference')}`);
    console.log(`  ${xrCyan('xr memory add "tmp note" --ttl 3600')}      ${xrDim("(expires after 1h)")}`);
    console.log(`  ${xrCyan("xr memory edit <id> \"new text\"")}`);
    console.log(`  ${xrCyan("xr memory remove <id>")}            ${xrDim("(permanent)")}`);
    console.log(`  ${xrCyan("xr memory clear [--scope s]")}`);
    console.log();
    console.log(`  ${xrBold("Inspect")}`);
    console.log(`  ${xrCyan("xr memory list [--category c] [--scope s]")}`);
    console.log(`  ${xrCyan('xr memory recall "query"')}         ${xrDim("(shows match % + why)")}`);
    console.log(`  ${xrCyan('xr memory search "text"')}`);
    console.log(`  ${xrCyan("xr memory health")}                 ${xrDim("(expired, never-recalled)")}`);
    console.log();
    console.log(`  ${xrBold("Maintain / Portability")}`);
    console.log(`  ${xrCyan("xr memory prune")}                  ${xrDim("(delete expired)")}`);
    console.log(`  ${xrCyan("xr memory summarize [--days 30]")}`);
    console.log(`  ${xrCyan("xr memory export [path]")}          ${xrDim("/")} ${xrCyan("xr memory import <path>")}`);
    console.log();
    console.log(`  ${xrBold("Categories")}: preference · project · workflow · fact · exclusion`);
    console.log();
    console.log(`  ${xrDim("Disable anytime: set \"memory.enabled\": false, or XR_MEMORY_DISABLED=1")}`);
    console.log(`  ${xrDim("View in dashboard:")} ${xrCyan("xr serve")} ${xrDim("→")} ${xrCyan("Memory panel")}`);
    console.log();
    return;
  }

  // Default: show full help
  showHelp();
}
