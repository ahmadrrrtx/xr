/**
 * XR 3.1 CLI — Enhanced Help and Output System
 *
 * Enhanced CLI with:
 * - Comprehensive help system
 * - Command suggestions
 * - Better error messages
 * - Consistent output styling
 * - Machine-readable output support
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed } from "../ui/theme.ts";
import { SYM } from "../ui/theme.ts";

// ── Help Sections ──────────────────────────────────────────────────────────────

export interface CommandHelp {
  command: string;
  description: string;
  usage: string;
  examples?: string[];
  options?: { flag: string; description: string }[];
  related?: string[];
}

/**
 * All CLI commands with help
 */
export const COMMAND_HELP: CommandHelp[] = [
  // Core
  {
    command: "xr <task>",
    description: "Execute a task using the current provider/model",
    usage: "xr \"refactor the authentication module\"",
    examples: [
      "xr \"What files are in this project?\"",
      "xr \"Help me debug this error\"",
      "xr \"Write a summary of the codebase\"",
    ],
    related: ["xr (no args)", "xr serve"],
  },
  {
    command: "xr (no args)",
    description: "Open the fullscreen Shell (TUI)",
    usage: "xr",
    examples: ["xr"],
    related: ["xr <task>", "xr serve"],
  },
  {
    command: "xr serve",
    description: "Start the dashboard + chat server at localhost:3141",
    usage: "xr serve [--port 3141]",
    examples: ["xr serve", "xr serve --port 8080"],
    related: ["xr", "xr <task>"],
  },

  // Provider management
  {
    command: "xr providers list",
    description: "List all available providers",
    usage: "xr providers list",
    examples: ["xr providers list"],
    related: ["xr providers set", "xr providers add"],
  },
  {
    command: "xr providers set <provider> [model]",
    description: "Switch to a provider and optionally select a model",
    usage: "xr providers set <provider> [model]",
    examples: [
      "xr providers set openai gpt-4o-mini",
      "xr providers set claude",
      "xr providers set ollama qwen2.5:7b",
    ],
    related: ["xr providers list", "xr providers add"],
  },
  {
    command: "xr providers add <provider>",
    description: "Configure a new provider by entering API key",
    usage: "xr providers add <provider>",
    examples: ["xr providers add claude", "xr providers add gemini"],
    related: ["xr providers list", "xr providers set"],
  },
  {
    command: "xr providers test",
    description: "Test connectivity to all configured providers",
    usage: "xr providers test",
    examples: ["xr providers test"],
    related: ["xr providers list"],
  },

  // Model management
  {
    command: "xr models list",
    description: "List available local models",
    usage: "xr models list",
    examples: ["xr models list"],
    related: ["xr models set", "xr providers list"],
  },
  {
    command: "xr models set <runtime> <model>",
    description: "Set the default local model",
    usage: "xr models set <runtime> <model>",
    examples: ["xr models set ollama qwen2.5:7b"],
    related: ["xr models list"],
  },

  // Onboarding
  {
    command: "xr onboarding",
    description: "Run the first-time setup wizard",
    usage: "xr onboarding [--yes]",
    examples: ["xr onboarding", "xr onboarding --yes"],
    related: ["xr doctor"],
  },

  // Health
  {
    command: "xr doctor",
    description: "Check if XR can actually run tasks (exits non-zero if not)",
    usage: "xr doctor [--deep] [--json]",
    examples: [
      "xr doctor",
      "xr doctor --deep",
      "xr doctor --json",
    ],
    related: ["xr onboarding"],
  },

  // Agents
  {
    command: "xr agents list",
    description: "List configured agents",
    usage: "xr agents list",
    examples: ["xr agents list"],
    related: ["xr agents plan", "xr agents create"],
  },
  {
    command: "xr agents plan <task>",
    description: "Run a multi-agent workflow to plan and execute a task",
    usage: "xr agents plan <task>",
    examples: ["xr agents plan \"refactor this repo safely\""],
    related: ["xr agents list"],
  },

  // Skills
  {
    command: "xr skills list",
    description: "List available skills",
    usage: "xr skills list",
    examples: ["xr skills list"],
    related: ["xr skill browse", "xr skill install"],
  },
  {
    command: "xr skill browse",
    description: "Browse and search skills",
    usage: "xr skill browse [query]",
    examples: ["xr skill browse", "xr skill browse file"],
    related: ["xr skills list"],
  },
  {
    command: "xr skill install <skill>",
    description: "Install a skill",
    usage: "xr skill install <skill>",
    examples: ["xr skill install file-ops"],
    related: ["xr skill browse", "xr skills list"],
  },

  // MCP
  {
    command: "xr mcp list",
    description: "List connected MCP servers",
    usage: "xr mcp list",
    examples: ["xr mcp list"],
    related: ["xr mcp add", "xr mcp remove"],
  },
  {
    command: "xr mcp add <name>",
    description: "Add a new MCP server connection",
    usage: "xr mcp add <name> [--transport stdio|sse|http]",
    examples: ["xr mcp add googledocs", "xr mcp add custom --transport http"],
    related: ["xr mcp list"],
  },
  {
    command: "xr mcp remove <name>",
    description: "Remove an MCP server connection",
    usage: "xr mcp remove <name>",
    examples: ["xr mcp remove googledocs"],
    related: ["xr mcp list"],
  },

  // Memory
  {
    command: "xr memory list",
    description: "List saved memories",
    usage: "xr memory list [category]",
    examples: ["xr memory list", "xr memory list project"],
    related: ["xr memory recall", "xr memory delete"],
  },
  {
    command: "xr memory recall <query>",
    description: "Search memories with explainable results",
    usage: "xr memory recall <query>",
    examples: ["xr memory recall \"project preferences\""],
    related: ["xr memory list"],
  },
  {
    command: "xr memory delete <id>",
    description: "Delete a memory entry",
    usage: "xr memory delete <id>",
    examples: ["xr memory delete mem_123"],
    related: ["xr memory list"],
  },
  {
    command: "xr memory prune",
    description: "Remove expired memories",
    usage: "xr memory prune",
    examples: ["xr memory prune"],
    related: ["xr memory list"],
  },

  // Research
  {
    command: "xr research <query>",
    description: "Research a topic (offline by default)",
    usage: "xr research <query> [--allow-public-web]",
    examples: [
      "xr research \"XR AI agent architectures\"",
      "xr research \"TypeScript performance patterns\" --allow-public-web",
    ],
    related: ["xr memory recall"],
  },
  {
    command: "xr research deep <query>",
    description: "Deep research with public web access (requires egress config)",
    usage: "xr research deep <query>",
    examples: ["xr research deep \"latest AI agent frameworks\""],
    related: ["xr research"],
  },

  // Security
  {
    command: "xr audit verify",
    description: "Verify the hash-chained audit log integrity",
    usage: "xr audit verify",
    examples: ["xr audit verify"],
    related: ["xr verify-log"],
  },
  {
    command: "xr verify-log",
    description: "Alias for audit verify (verify offline)",
    usage: "xr verify-log",
    examples: ["xr verify-log"],
    related: ["xr audit verify"],
  },

  // Spending
  {
    command: "xr usage",
    description: "Show token and spend usage",
    usage: "xr usage [--json]",
    examples: ["xr usage", "xr usage --json"],
    related: ["xr budget"],
  },
  {
    command: "xr budget <amount>",
    description: "Set per-task budget in USD",
    usage: "xr budget <amount>",
    examples: ["xr budget 50", "xr budget 0 (unlimited)"],
    related: ["xr usage"],
  },

  // Voice
  {
    command: "xr voice",
    description: "Start voice interaction mode",
    usage: "xr voice",
    examples: ["xr voice"],
    related: ["xr (no args)"],
  },

  // Computer control
  {
    command: "xr computer",
    description: "Show computer control capabilities",
    usage: "xr computer",
    examples: ["xr computer"],
    related: ["xr agents plan"],
  },

  // Configuration
  {
    command: "xr config",
    description: "Show current configuration",
    usage: "xr config [--json]",
    examples: ["xr config", "xr config --json"],
    related: ["xr settings"],
  },

  // Version
  {
    command: "xr --version",
    description: "Show XR version",
    usage: "xr --version",
    examples: ["xr --version"],
    related: [],
  },
  {
    command: "xr --help",
    description: "Show this help message",
    usage: "xr --help",
    examples: ["xr --help"],
    related: [],
  },
];

// ── Help Rendering ─────────────────────────────────────────────────────────────

/**
 * Render full CLI help
 */
export function renderCLIHelp(width: number = 80): string[] {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(xrBold("XR — The AI Agent Runtime You Can Actually Audit"));
  lines.push(xrDim("BYOK · local-first · spend-capped · tamper-evident"));
  lines.push("");
  lines.push(xrDim("Usage:"));
  lines.push(xrBold("  xr <task>"));
  lines.push(xrDim("    Execute a task with the current provider/model"));
  lines.push("");
  lines.push(xrBold("  xr"));
  lines.push(xrDim("    Open the fullscreen Shell (TUI)"));
  lines.push("");
  lines.push(xrBold("  xr serve"));
  lines.push(xrDim("    Start dashboard + chat at localhost:3141"));
  lines.push("");
  lines.push(xrBold("Commands:"));
  lines.push(xrDim("─".repeat(Math.min(width - 4, 60))));
  lines.push("");

  // Group commands by category
  const categories = [
    {
      title: "Provider & Model",
      commands: ["providers list", "providers set", "providers add", "providers test", "models list", "models set"],
    },
    {
      title: "Onboarding & Health",
      commands: ["onboarding", "doctor"],
    },
    {
      title: "Agents & Skills",
      commands: ["agents list", "agents plan", "skills list", "skill browse", "skill install"],
    },
    {
      title: "MCP",
      commands: ["mcp list", "mcp add", "mcp remove"],
    },
    {
      title: "Memory",
      commands: ["memory list", "memory recall", "memory delete", "memory prune"],
    },
    {
      title: "Research",
      commands: ["research", "research deep"],
    },
    {
      title: "Security & Audit",
      commands: ["audit verify", "verify-log"],
    },
    {
      title: "Usage & Spending",
      commands: ["usage", "budget"],
    },
    {
      title: "Voice & Computer",
      commands: ["voice", "computer"],
    },
    {
      title: "Configuration",
      commands: ["config"],
    },
  ];

  for (const category of categories) {
    lines.push(xrBold(category.title));
    for (const cmd of category.commands) {
      const help = COMMAND_HELP.find(c => c.command.includes(cmd));
      const desc = help?.description ?? "";
      lines.push(`  ${xrCyan(cmd.padEnd(22))} ${xrDim(desc)}`);
    }
    lines.push("");
  }

  // Help for specific command
  lines.push(xrDim("─".repeat(Math.min(width - 4, 60))));
  lines.push("");
  lines.push(xrBold("Tips:"));
  lines.push(`  ${SYM.info} ${xrDim("Run ${xrCyan("xr <command> --help")} for details on a specific command")}`);
  lines.push(`  ${SYM.info} ${xrDim("Use ${xrCyan("--json")} flag for machine-readable output")}`);
  lines.push(`  ${SYM.info} ${xrDim("Exit codes: 0=ok  1=error  2=usage  3=network  4=denied  5=not found  130=interrupted")}`);
  lines.push("");
  lines.push(xrDim("Documentation:"));
  lines.push(`  ${xrCyan("xr --help")}                    This help`);
  lines.push(`  ${xrCyan("xr doctor")}                   Health check`);
  lines.push(`  ${xrCyan("xr onboarding")}               First-run wizard`);
  lines.push("");

  return lines;
}

/**
 * Render help for a specific command
 */
export function renderCommandHelp(command: string, width: number = 80): string[] | null {
  const help = COMMAND_HELP.find(c => c.command.toLowerCase().includes(command.toLowerCase()));

  if (!help) return null;

  const lines: string[] = [];
  lines.push("");
  lines.push(xrBold(help.command));
  lines.push(xrDim(help.description));
  lines.push("");
  lines.push(xrDim("Usage:"));
  lines.push(xrCyan(`  ${help.usage}`));
  lines.push("");

  if (help.options && help.options.length > 0) {
    lines.push(xrDim("Options:"));
    for (const opt of help.options) {
      lines.push(`  ${xrCyan(opt.flag.padEnd(16))} ${xrDim(opt.description)}`);
    }
    lines.push("");
  }

  if (help.examples && help.examples.length > 0) {
    lines.push(xrDim("Examples:"));
    for (const ex of help.examples) {
      lines.push(`  ${xrDim("$ xr " + ex)}`);
    }
    lines.push("");
  }

  if (help.related && help.related.length > 0) {
    lines.push(xrDim("Related:"));
    for (const rel of help.related) {
      lines.push(`  ${xrCyan(rel)}`);
    }
    lines.push("");
  }

  return lines;
}

// ── Error Handling ─────────────────────────────────────────────────────────────

/**
 * Error types with suggestions
 */
export interface CLIError {
  code: string;
  message: string;
  suggestion?: string;
  exitCode?: number;
}

/**
 * Known CLI errors with helpful suggestions
 */
export const KNOWN_CLI_ERRORS: Record<string, CLIError> = {
  "NO_PROVIDER_CONFIGURED": {
    code: "NO_PROVIDER_CONFIGURED",
    message: "No provider is configured. XR needs a provider to execute tasks.",
    suggestion: "Run 'xr onboarding' to set up a provider, or 'xr providers add <provider>' to add one.",
    exitCode: 1,
  },
  "PROVIDER_UNREACHABLE": {
    code: "PROVIDER_UNREACHABLE",
    message: "The configured provider cannot be reached.",
    suggestion: "Check your internet connection. Try 'xr providers test' to verify connectivity.",
    exitCode: 3,
  },
  "API_KEY_INVALID": {
    code: "API_KEY_INVALID",
    message: "The API key for this provider appears to be invalid.",
    suggestion: "Run 'xr providers add <provider>' to enter a new API key.",
    exitCode: 1,
  },
  "MODEL_NOT_FOUND": {
    code: "MODEL_NOT_FOUND",
    message: "The requested model is not available.",
    suggestion: "Run 'xr models list' to see available models, or 'xr providers set <provider> [model]' to choose a different one.",
    exitCode: 5,
  },
  "BUDGET_EXCEEDED": {
    code: "BUDGET_EXCEEDED",
    message: "The task budget has been exceeded.",
    suggestion: "Increase the budget with 'xr budget <amount>' or use a local model to avoid per-token costs.",
    exitCode: 4,
  },
  "RATE_LIMIT": {
    code: "RATE_LIMIT",
    message: "Rate limit exceeded. Try again later.",
    suggestion: "Wait a moment and try again, or use a local model if available.",
    exitCode: 3,
  },
  "TASK_CANCELLED": {
    code: "TASK_CANCELLED",
    message: "The task was cancelled.",
    suggestion: "No action needed — the task stopped safely.",
    exitCode: 130,
  },
  "PERMISSION_DENIED": {
    code: "PERMISSION_DENIED",
    message: "XR does not have permission to perform this action.",
    suggestion: "Check your permissions with 'xr config' or run XR with appropriate permissions.",
    exitCode: 4,
  },
  "INTERNAL_ERROR": {
    code: "INTERNAL_ERROR",
    message: "An internal error occurred.",
    suggestion: "Try again. If the problem persists, check the logs or report an issue.",
    exitCode: 1,
  },
};

/**
 * Render an error with suggestion
 */
export function renderCLIError(error: CLIError | string, width: number = 80): string[] {
  const lines: string[] = [];

  const known = typeof error === "string"
    ? (KNOWN_CLI_ERRORS[error] ?? { code: "UNKNOWN", message: error, suggestion: undefined, exitCode: 1 })
    : error;

  lines.push("");
  lines.push(xrRed("┌" + "─".repeat(Math.min(width - 4, 50)) + "┐"));
  lines.push(xrRed(`│ ${SYM.error} Error: ${known.code}`));
  lines.push(xrRed(`│ ${known.message}`));
  lines.push(xrRed("│"));

  if (known.suggestion) {
    lines.push(xrAmber(`│ ${SYM.warn} Try: ${known.suggestion}`));
    lines.push(xrAmber("│"));
  }

  lines.push(xrRed("└" + "─".repeat(Math.min(width - 4, 50)) + "┘"));
  lines.push("");

  return lines;
}

/**
 * Try to interpret an error and provide help
 */
export function interpretError(errorMessage: string): CLIError | null {
  const lower = errorMessage.toLowerCase();

  if (lower.includes("no provider") || lower.includes("provider not configured")) {
    return KNOWN_CLI_ERRORS.NO_PROVIDER_CONFIGURED;
  }
  if (lower.includes("unreachable") || lower.includes("connection") || lower.includes("network")) {
    return KNOWN_CLI_ERRORS.PROVIDER_UNREACHABLE;
  }
  if (lower.includes("invalid") && (lower.includes("key") || lower.includes("api"))) {
    return KNOWN_CLI_ERRORS.API_KEY_INVALID;
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("not available"))) {
    return KNOWN_CLI_ERRORS.MODEL_NOT_FOUND;
  }
  if (lower.includes("budget") || lower.includes("exceeded")) {
    return KNOWN_CLI_ERRORS.BUDGET_EXCEEDED;
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return KNOWN_CLI_ERRORS.RATE_LIMIT;
  }
  if (lower.includes("cancelled") || lower.includes("interrupt")) {
    return KNOWN_CLI_ERRORS.TASK_CANCELLED;
  }
  if (lower.includes("permission") || lower.includes("denied") || lower.includes("access")) {
    return KNOWN_CLI_ERRORS.PERMISSION_DENIED;
  }

  return null;
}

// ── Command Suggestions ────────────────────────────────────────────────────────

/**
 * Suggest similar commands when user types something unknown
 */
export function suggestCommands(unknownCmd: string): string[] {
  const lower = unknownCmd.toLowerCase();
  const suggestions: string[] = [];

  // Check for partial matches
  for (const help of COMMAND_HELP) {
    const cmdLower = help.command.toLowerCase();

    if (cmdLower.includes(lower) || lower.includes(cmdLower.split(" ")[0])) {
      suggestions.push(help.command);
    }
  }

  // Check for common typos
  const typoMap: Record<string, string[]> = {
    "provier": ["providers list", "providers set", "providers add"],
    "modle": ["models list", "models set"],
    "skil": ["skills list", "skill browse"],
    "memroy": ["memory list", "memory recall"],
    "reseatch": ["research"],
    "budg": ["budget", "usage"],
    "onborad": ["onboarding"],
    "docotr": ["doctor"],
    "agant": ["agents list", "agents plan"],
    "mcpo": ["mcp list", "mcp add"],
  };

  for (const [typo, correct] of Object.entries(typoMap)) {
    if (lower.includes(typo)) {
      suggestions.push(...correct);
    }
  }

  // Deduplicate and limit
  return [...new Set(suggestions)].slice(0, 5);
}

/**
 * Render command suggestions
 */
export function renderCommandSuggestions(unknownCmd: string, width: number = 80): string[] | null {
  const suggestions = suggestCommands(unknownCmd);

  if (suggestions.length === 0) return null;

  const lines: string[] = [];
  lines.push("");
  lines.push(xrAmber("Did you mean?"));
  for (const suggestion of suggestions) {
    const help = COMMAND_HELP.find(c => c.command === suggestion);
    const desc = help?.description ?? "";
    lines.push(`  ${xrCyan(suggestion.padEnd(22))} ${xrDim(desc)}`);
  }
  lines.push("");
  lines.push(xrDim(`Run ${xrCyan("xr --help")} for all commands`));

  return lines;
}

// ── Machine-Readable Output ─────────────────────────────────────────────────────

/**
 * Format output as JSON
 */
export function toJSON(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

/**
 * Create a success response
 */
export function successResponse(data: unknown, message?: string): string {
  return JSON.stringify({
    status: "success",
    message,
    data,
  }, null, 2);
}

/**
 * Create an error response
 */
export function errorResponse(error: string, code?: string, suggestion?: string): string {
  return JSON.stringify({
    status: "error",
    code,
    error,
    suggestion,
  }, null, 2);
}
