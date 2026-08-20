/**
 * Phase 12 — slash-command catalog (single source of truth).
 *
 * Only commands that have a real backend (CLI command, daemon route, or
 * local catalog) are listed. Surfaces must not invent fake commands.
 *
 * Chat/Dashboard consume this as JSON injected into the served client.
 * TUI dispatch lives in interfaces/shell/slash.ts and must stay in sync
 * (tested by test/ux/phase12-vocabulary.test.ts).
 */

export type SlashSurface = "cli" | "tui" | "chat" | "dashboard";

export interface SlashCommandDef {
  name: string;
  summary: string;
  usage: string;
  /** Where the command is actually wired. */
  surfaces: SlashSurface[];
  /** Honest backend — never a simulated outcome. */
  backend: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: "help",
    summary: "List commands and keyboard shortcuts",
    usage: "/help",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "local-catalog",
  },
  {
    name: "status",
    summary: "System status (workspace, provider, audit, spend)",
    usage: "/status",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/overview + /api/cost + /api/providers",
  },
  {
    name: "model",
    summary: "Show or switch provider/model",
    usage: "/model [provider] [model]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET/POST /api/providers · /api/providers/set · config.defaults",
  },
  {
    name: "provider",
    summary: "Alias of /model",
    usage: "/provider [id] [model]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "same as /model",
  },
  {
    name: "memory",
    summary: "List or search durable memory",
    usage: "/memory [query]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/memory · /api/memory/search",
  },
  {
    name: "research",
    summary: "Recent research jobs / open research view",
    usage: "/research [topic]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/research · GET /api/research/jobs",
  },
  {
    name: "plan",
    summary: "Plan mode (no tool execution) or synthesize a plan",
    usage: "/plan [task]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "mode=plan · POST /api/control/plan",
  },
  {
    name: "tools",
    summary: "Capability/tool inventory (policy-bound)",
    usage: "/tools",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/capabilities",
  },
  {
    name: "permissions",
    summary: "What requires approval — Shield is always on",
    usage: "/permissions",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/config security.requireApproval",
  },
  {
    name: "budget",
    summary: "Spend and caps",
    usage: "/budget [cap]",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/cost · /api/budget",
  },
  {
    name: "session",
    summary: "List durable XR sessions (same store as CLI)",
    usage: "/session",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "GET /api/sessions · xr session list",
  },
  {
    name: "clear",
    summary: "Clear the current chat view (does not erase the audit log)",
    usage: "/clear",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "local view only",
  },
  {
    name: "doctor",
    summary: "Point at the real doctor surface (CLI) + live status",
    usage: "/doctor",
    surfaces: ["tui", "chat", "dashboard"],
    backend: "xr doctor · GET /api/overview (status view; not a doctor pass)",
  },
];

/** Commands that exist as `xr <name>` but are NOT faked as in-chat magic. */
export const CLI_ONLY_HINTS: Array<{ name: string; hint: string }> = [
  { name: "compact", hint: "Context compaction runs inside the engine when the budget requires it. There is no /compact HTTP flag — do not pretend." },
  { name: "repo", hint: "Use `xr repo` in the CLI. Repo map is seeded into the agent when the index is ready." },
];

export function slashNamesFor(surface: SlashSurface): string[] {
  return SLASH_COMMANDS.filter((c) => c.surfaces.includes(surface)).map((c) => c.name);
}

export function formatSlashHelp(surface: SlashSurface): string {
  const rows = SLASH_COMMANDS.filter((c) => c.surfaces.includes(surface));
  const lines = [
    "XR commands (real backends only)",
    "",
    ...rows.map((c) => `/${c.name.padEnd(12)} ${c.summary}`),
    "",
    "Enter send · Shift+Enter newline · Esc interrupt · Ctrl+K palette · Alt+P model",
  ];
  return lines.join("\n");
}
