/**
 * XR 3.1C — Canonical command catalog
 *
 * Single source of truth for help, discovery, aliases, and routing metadata.
 * Aligned with IA §5 (CLI site map) and Navigation vocabulary.
 *
 * Do not invent UX — this mirrors docs/xr-3.1/* terminology exactly.
 */

export type CommandGroup =
  | "start"
  | "work"
  | "context"
  | "intelligence"
  | "extensions"
  | "trust"
  | "system";

export interface CommandExample {
  cmd: string;
  description: string;
}

export interface CatalogEntry {
  /** Canonical command name (what users should learn). */
  name: string;
  /** One-line description (sentence case). */
  description: string;
  /** Usage skeleton. */
  usage: string;
  /** Group for help layout. */
  group: CommandGroup;
  /** Shell-aligned glyph id (from icons.ts vocabulary). */
  glyph?: string;
  /** Legacy / alternate names that still work. */
  aliases?: string[];
  /** Whether the command needs the full kernel boot. */
  needsKernel: boolean;
  /** Whether this is a fast path (no kernel). */
  fastPath?: boolean;
  /** Examples shown in help. */
  examples?: CommandExample[];
  /** Related commands for progressive disclosure. */
  related?: string[];
  /** Topic tags for `xr help <topic>`. */
  topics?: string[];
  /** Hide from primary help (still works + appears in `xr help --all`). */
  hidden?: boolean;
  /** Subcommands summary (for nested help). */
  subcommands?: Array<{ name: string; description: string }>;
}

export const GROUP_LABELS: Record<CommandGroup, string> = {
  start:        "Get started",
  work:         "Work",
  context:      "Context",
  intelligence: "Intelligence",
  extensions:   "Extensions",
  trust:        "Trust & safety",
  system:       "System",
};

export const GROUP_ORDER: CommandGroup[] = [
  "start",
  "work",
  "context",
  "intelligence",
  "extensions",
  "trust",
  "system",
];

/**
 * Canonical catalog. Order within group is intentional (most common first).
 */
export const CATALOG: CatalogEntry[] = [
  // ── Get started ───────────────────────────────────────────────────────────
  {
    name: "shell",
    description: "open the fullscreen XR Shell (default when you run xr alone)",
    usage: "xr [shell|--tui|tui]",
    group: "start",
    glyph: "terminal",
    aliases: ["tui", "--tui"],
    needsKernel: false,
    fastPath: true,
    examples: [
      { cmd: "xr", description: "open Shell" },
      { cmd: "xr --tui", description: "explicit Shell alias" },
    ],
    related: ["serve", "run", "onboarding"],
    topics: ["shell", "tui", "start"],
  },
  {
    name: "serve",
    description: "start Control Center (local web dashboard + chat)",
    usage: "xr serve [--port <n>]",
    group: "start",
    glyph: "dashboard",
    needsKernel: false,
    fastPath: true,
    examples: [
      { cmd: "xr serve", description: "listen on 127.0.0.1:3141" },
      { cmd: "xr serve --port 4000", description: "custom port" },
    ],
    related: ["shell", "status", "doctor"],
    topics: ["dashboard", "control-center", "start"],
  },
  {
    name: "onboarding",
    description: "guided first-run setup (re-runnable anytime)",
    usage: "xr onboarding",
    group: "start",
    glyph: "home",
    aliases: ["setup", "init"],
    needsKernel: true,
    examples: [{ cmd: "xr onboarding", description: "run the wizard" }],
    related: ["doctor", "providers", "models"],
    topics: ["start", "setup"],
  },
  {
    name: "help",
    description: "show command help and examples",
    usage: "xr help [topic|command]",
    group: "start",
    glyph: "info",
    aliases: ["--help", "-h"],
    needsKernel: false,
    fastPath: true,
    examples: [
      { cmd: "xr help", description: "full overview" },
      { cmd: "xr help memory", description: "topic help" },
      { cmd: "xr providers --help", description: "command help" },
    ],
    related: ["doctor", "onboarding"],
    topics: ["help", "start"],
  },
  {
    name: "version",
    description: "print XR version",
    usage: "xr version | xr --version | xr -v",
    group: "start",
    glyph: "info",
    aliases: ["--version", "-v"],
    needsKernel: false,
    fastPath: true,
    topics: ["start"],
  },

  // ── Work ──────────────────────────────────────────────────────────────────
  {
    name: "run",
    description: "run a task in agent mode (default for free-form input)",
    usage: 'xr run "<task>" [--mode agent|plan|ask] [--model p/m] [--budget usd]',
    group: "work",
    glyph: "chat",
    aliases: ["task", "do", "exec"],
    needsKernel: true,
    examples: [
      { cmd: 'xr "summarize this repo"', description: "one-shot agent run" },
      { cmd: 'xr run "add tests" --budget 0.25', description: "hard spend cap" },
      { cmd: 'xr run "explain auth" --mode ask', description: "read-only ask" },
      { cmd: 'xr run "migrate db" --mode plan', description: "plan only" },
    ],
    related: ["ask", "plan", "shell", "session"],
    topics: ["run", "agent", "work"],
    subcommands: [],
  },
  {
    name: "ask",
    description: "answer a question without tools (read-only, cheap)",
    usage: 'xr ask "<question>" [--model p/m]',
    group: "work",
    glyph: "chat",
    needsKernel: true,
    examples: [
      { cmd: 'xr ask "what does this error mean?"', description: "read-only Q&A" },
    ],
    related: ["run", "plan", "research"],
    topics: ["ask", "work", "modes"],
  },
  {
    name: "plan",
    description: "produce a step-by-step plan without executing tools",
    usage: 'xr plan "<task>" [--model p/m]',
    group: "work",
    glyph: "activity",
    needsKernel: true,
    examples: [
      { cmd: 'xr plan "ship OAuth safely"', description: "planning mode" },
    ],
    related: ["run", "ask", "agents"],
    topics: ["plan", "work", "modes"],
  },
  {
    name: "research",
    description: "source-first research with citable reports",
    usage: 'xr research "<topic>" [quick|deep|plan|status|setup]',
    group: "work",
    glyph: "research",
    needsKernel: true,
    examples: [
      { cmd: 'xr research "AI agents 2026"', description: "run research" },
      { cmd: "xr research status", description: "recent research sessions" },
    ],
    related: ["run", "ask", "memory"],
    topics: ["research", "work"],
    subcommands: [
      { name: "quick", description: "fast research pass" },
      { name: "deep", description: "deeper multi-source research" },
      { name: "plan", description: "plan only" },
      { name: "status", description: "list research sessions" },
      { name: "setup", description: "install research dependencies" },
    ],
  },
  {
    name: "agents",
    description: "multi-agent supervisor workflows",
    usage: "xr agents [list|plan|run|status|stop|resume|inspect]",
    group: "work",
    glyph: "activity",
    aliases: ["agent"],
    needsKernel: true,
    examples: [
      { cmd: "xr agents list", description: "registered agents" },
      { cmd: 'xr agents plan "refactor safely"', description: "workflow plan" },
      { cmd: 'xr agents run "security review"', description: "run workflow" },
    ],
    related: ["run", "plan", "session"],
    topics: ["agents", "work"],
  },
  {
    name: "control",
    description: "safe desktop and browser computer control",
    usage: "xr control [status|start|stop|plan|setup|browser|…]",
    group: "work",
    glyph: "computer",
    aliases: ["computer"],
    needsKernel: true,
    examples: [
      { cmd: "xr control status", description: "capability check" },
      { cmd: "xr control setup", description: "install control stack" },
    ],
    related: ["shield", "run"],
    topics: ["control", "computer", "work"],
  },
  {
    name: "voice",
    description: "voice input/output (opt-in)",
    usage: "xr voice [setup|status|start|stop|test|devices|config]",
    group: "work",
    glyph: "voice",
    needsKernel: true,
    examples: [
      { cmd: "xr voice setup", description: "configure STT/TTS" },
      { cmd: "xr voice status", description: "voice stack health" },
    ],
    related: ["speak", "listen"],
    topics: ["voice", "work"],
  },
  {
    name: "speak",
    description: "speak text once (TTS)",
    usage: "xr speak <text>",
    group: "work",
    glyph: "voice",
    needsKernel: true,
    hidden: true,
    topics: ["voice"],
  },
  {
    name: "listen",
    description: "listen once and print transcript (STT)",
    usage: "xr listen",
    group: "work",
    glyph: "voice",
    needsKernel: true,
    hidden: true,
    topics: ["voice"],
  },

  // ── Context ───────────────────────────────────────────────────────────────
  {
    name: "workspace",
    description: "list, create, switch, or delete workspaces",
    usage: "xr workspace [list|create|use|switch|delete] …",
    group: "context",
    glyph: "workspaces",
    aliases: ["workspaces", "ws"],
    needsKernel: true,
    examples: [
      { cmd: "xr workspace list", description: "show workspaces" },
      { cmd: "xr workspace create demo \"Demo\"", description: "create" },
      { cmd: "xr workspace use demo", description: "switch active" },
    ],
    related: ["session", "memory", "status"],
    topics: ["workspace", "context"],
    subcommands: [
      { name: "list", description: "list workspaces" },
      { name: "create", description: "create a workspace" },
      { name: "use", description: "switch active workspace (alias: switch)" },
      { name: "delete", description: "delete a non-default workspace" },
    ],
  },
  {
    name: "session",
    description: "list, inspect, or export past sessions",
    usage: "xr session [list|show|export] [id]",
    group: "context",
    glyph: "sessions",
    aliases: ["sessions"],
    needsKernel: true,
    examples: [
      { cmd: "xr session list", description: "recent sessions" },
      { cmd: "xr session show <id>", description: "session detail + steps" },
      { cmd: "xr session export <id>", description: "export transcript" },
    ],
    related: ["run", "workspace", "audit"],
    topics: ["session", "context"],
    subcommands: [
      { name: "list", description: "list recent sessions" },
      { name: "show", description: "show session detail" },
      { name: "export", description: "export session as markdown/json" },
    ],
  },
  {
    name: "memory",
    description: "durable, inspectable, user-controlled memory",
    usage: "xr memory [list|add|search|recall|remove|health|export|…]",
    group: "context",
    glyph: "memory",
    aliases: ["mem"],
    needsKernel: true,
    examples: [
      { cmd: 'xr memory add "prefer TypeScript" --category preference', description: "save a preference" },
      { cmd: "xr memory list", description: "show memories" },
      { cmd: 'xr memory recall "coding style"', description: "semantic recall" },
    ],
    related: ["workspace", "config", "session"],
    topics: ["memory", "context"],
  },
  {
    name: "config",
    description: "view or update configuration",
    usage: "xr config [get|set|path|reset] [key] [value]",
    group: "context",
    glyph: "settings",
    aliases: ["cfg", "settings"],
    needsKernel: true,
    examples: [
      { cmd: "xr config", description: "print full config JSON" },
      { cmd: "xr config path", description: "show config file path" },
      { cmd: "xr config get defaults.provider", description: "read a key" },
    ],
    related: ["providers", "budget", "doctor"],
    topics: ["config", "settings", "context"],
    subcommands: [
      { name: "get", description: "get a config value by dotted path" },
      { name: "set", description: "set a config value" },
      { name: "path", description: "print config file path" },
      { name: "reset", description: "reset config (with backup)" },
    ],
  },

  // ── Intelligence ──────────────────────────────────────────────────────────
  {
    name: "providers",
    description: "manage LLM providers — list, set primary model, add keys, test",
    usage: "xr providers [list|set|add|remove|test|status|refresh]",
    group: "intelligence",
    glyph: "provider",
    aliases: ["provider"],
    needsKernel: true,
    examples: [
      { cmd: "xr providers list", description: "all providers + key status + primary" },
      { cmd: "xr providers set ollama qwen2.5:7b", description: "change active model (never stuck on default)" },
      { cmd: "xr providers set openai gpt-4o-mini", description: "switch to cloud primary (BYOK)" },
      { cmd: "xr providers test", description: "health-check providers" },
    ],
    related: ["models", "budget", "status", "onboarding"],
    topics: ["providers", "models", "intelligence"],
  },
  {
    name: "models",
    description: "local models — recommend, install, list, set, test (change model anytime)",
    usage: "xr models [status|list|recommend|install|remove|set|test|runtimes]",
    group: "intelligence",
    glyph: "model",
    aliases: ["model"],
    needsKernel: true,
    examples: [
      { cmd: "xr models", description: "status + how to change model" },
      { cmd: "xr models set ollama llama3.2", description: "change local model (persists)" },
      { cmd: "xr models recommend", description: "best model for this machine" },
      { cmd: "xr models install", description: "install recommended local model" },
      { cmd: "xr models list", description: "available families" },
    ],
    related: ["providers", "doctor", "status", "onboarding"],
    topics: ["models", "local", "intelligence"],
  },
  {
    name: "budget",
    description: "view and set spend caps",
    usage: "xr budget [status|set|reset] [amount]",
    group: "intelligence",
    glyph: "budget",
    aliases: ["cost", "spend"],
    needsKernel: true,
    examples: [
      { cmd: "xr budget", description: "current caps + usage" },
      { cmd: "xr budget set 10", description: "monthly cap $10" },
    ],
    related: ["run", "status", "providers"],
    topics: ["budget", "cost", "intelligence"],
  },

  // ── Extensions ────────────────────────────────────────────────────────────
  {
    name: "skills",
    description: "unified skills runtime + marketplace",
    usage: "xr skills [list|search|install|enable|disable|inspect|doctor|…]",
    group: "extensions",
    glyph: "skills",
    aliases: ["skill", "marketplace"],
    needsKernel: true,
    examples: [
      { cmd: "xr skills list", description: "installed + catalog skills" },
      { cmd: "xr skill search react", description: "search marketplace" },
      { cmd: "xr skill install react_expert", description: "install a skill" },
    ],
    related: ["plugins", "mcp"],
    topics: ["skills", "marketplace", "extensions"],
  },
  {
    name: "plugins",
    description: "discover, install, enable, and manage plugins",
    usage: "xr plugins [list|search|install|enable|disable|remove|status]",
    group: "extensions",
    glyph: "plugins",
    aliases: ["plugin"],
    needsKernel: true,
    examples: [
      { cmd: "xr plugins list", description: "installed plugins" },
      { cmd: "xr plugins install ./my-plugin", description: "install from path" },
    ],
    related: ["skills", "mcp"],
    topics: ["plugins", "extensions"],
  },
  {
    name: "mcp",
    description: "Model Context Protocol servers",
    usage: "xr mcp [list|add|remove|enable|disable|tools|health|doctor]",
    group: "extensions",
    glyph: "mcp",
    needsKernel: true,
    examples: [
      { cmd: "xr mcp list", description: "registered servers" },
      { cmd: "xr mcp health", description: "server health" },
    ],
    related: ["plugins", "skills"],
    topics: ["mcp", "extensions"],
  },

  // ── Trust & safety ────────────────────────────────────────────────────────
  {
    name: "shield",
    description: "local security, privacy, and system integrity",
    usage: "xr shield [status|scan|processes|startup|privacy|doctor|…]",
    group: "trust",
    glyph: "shield",
    aliases: ["security"],
    needsKernel: true,
    examples: [
      { cmd: "xr shield status", description: "security overview" },
      { cmd: "xr shield scan", description: "quick threat scan" },
    ],
    related: ["audit", "doctor", "attacks"],
    topics: ["shield", "security", "trust"],
  },
  {
    name: "audit",
    description: "tamper-evident audit log: tail, verify, export",
    usage: "xr audit [tail|verify|export] [--limit n]",
    group: "trust",
    glyph: "audit",
    aliases: ["verify-log", "log"],
    needsKernel: true,
    examples: [
      { cmd: "xr audit tail", description: "recent audit entries" },
      { cmd: "xr audit verify", description: "verify SHA-256 chain" },
      { cmd: "xr audit export", description: "signed markdown report" },
    ],
    related: ["shield", "session", "doctor"],
    topics: ["audit", "security", "trust"],
    subcommands: [
      { name: "tail", description: "show recent entries" },
      { name: "verify", description: "verify hash chain integrity" },
      { name: "export", description: "export signed audit report" },
    ],
  },
  {
    name: "attacks",
    description: "run prompt-injection defense benchmark",
    usage: "xr attacks [--json]",
    group: "trust",
    glyph: "shield",
    aliases: ["lab", "security-lab"],
    needsKernel: true,
    examples: [
      { cmd: "xr attacks", description: "run injection lab" },
      { cmd: "xr attacks --json", description: "machine-readable report" },
    ],
    related: ["shield", "audit", "doctor"],
    topics: ["security", "trust", "attacks"],
  },

  // ── System ────────────────────────────────────────────────────────────────
  {
    name: "doctor",
    description: "full system health check + repair hints",
    usage: "xr doctor [--network] [--json] [--perf]",
    group: "system",
    glyph: "status",
    aliases: ["health", "check"],
    needsKernel: true,
    examples: [
      { cmd: "xr doctor", description: "human-readable health report" },
      { cmd: "xr doctor --json", description: "CI-friendly JSON" },
      { cmd: "xr doctor --perf", description: "startup microbenchmarks" },
    ],
    related: ["status", "repair", "onboarding"],
    topics: ["doctor", "system", "health"],
  },
  {
    name: "status",
    description: "installation and component status",
    usage: "xr status [--json] [--network]",
    group: "system",
    glyph: "status",
    needsKernel: true,
    examples: [{ cmd: "xr status", description: "component overview" }],
    related: ["doctor", "providers", "budget"],
    topics: ["status", "system"],
  },
  {
    name: "update",
    description: "check for updates and install with rollback guard",
    usage: "xr update [--yes]",
    group: "system",
    glyph: "running",
    aliases: ["upgrade"],
    needsKernel: true,
    examples: [{ cmd: "xr update", description: "update XR" }],
    related: ["doctor", "version"],
    topics: ["update", "system"],
  },
  {
    name: "repair",
    description: "repair config, permissions, and dependencies safely",
    usage: "xr repair [--yes] [--network]",
    group: "system",
    glyph: "settings",
    needsKernel: true,
    examples: [{ cmd: "xr repair", description: "safe repair pass" }],
    related: ["doctor", "reset"],
    topics: ["repair", "system"],
  },
  {
    name: "reset",
    description: "reset config/database after writing backups",
    usage: "xr reset [--hard] [--yes]",
    group: "system",
    glyph: "warning",
    needsKernel: true,
    hidden: true,
    related: ["repair", "doctor"],
    topics: ["reset", "system"],
  },
  {
    name: "install",
    description: "installation / setup wizard",
    usage: "xr install [--mode minimal|local|byok|hybrid|full] [--yes]",
    group: "system",
    glyph: "home",
    needsKernel: true,
    hidden: true,
    related: ["onboarding", "doctor"],
    topics: ["install", "system"],
  },
  {
    name: "logs",
    description: "show recent XR runtime / audit activity",
    usage: "xr logs [--limit n] [--json]",
    group: "system",
    glyph: "audit",
    aliases: ["log"],
    needsKernel: true,
    examples: [
      { cmd: "xr logs", description: "recent activity" },
      { cmd: "xr logs --limit 20", description: "last 20 entries" },
    ],
    related: ["audit", "doctor", "status"],
    topics: ["logs", "system"],
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

const byName = new Map<string, CatalogEntry>();
const aliasToCanonical = new Map<string, string>();

function rebuildIndex(): void {
  byName.clear();
  aliasToCanonical.clear();
  for (const entry of CATALOG) {
    byName.set(entry.name, entry);
    aliasToCanonical.set(entry.name, entry.name);
    for (const a of entry.aliases ?? []) {
      aliasToCanonical.set(a, entry.name);
      // Also allow --flag style aliases without double-dash key collision
      if (a.startsWith("--")) aliasToCanonical.set(a.slice(2), entry.name);
    }
  }
}
rebuildIndex();

export function getCatalogEntry(name: string): CatalogEntry | undefined {
  const canonical = aliasToCanonical.get(name) ?? aliasToCanonical.get(name.toLowerCase());
  if (!canonical) return byName.get(name);
  return byName.get(canonical);
}

export function resolveCommandName(input: string): string | undefined {
  return aliasToCanonical.get(input) ?? aliasToCanonical.get(input.toLowerCase());
}

export function allCommandNames(): string[] {
  return CATALOG.map((c) => c.name);
}

export function allAliasesAndNames(): string[] {
  const names = new Set<string>();
  for (const c of CATALOG) {
    names.add(c.name);
    for (const a of c.aliases ?? []) names.add(a);
  }
  return [...names];
}

export function catalogByGroup(includeHidden = false): Map<CommandGroup, CatalogEntry[]> {
  const map = new Map<CommandGroup, CatalogEntry[]>();
  for (const g of GROUP_ORDER) map.set(g, []);
  for (const entry of CATALOG) {
    if (entry.hidden && !includeHidden) continue;
    map.get(entry.group)!.push(entry);
  }
  return map;
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return CATALOG.filter((c) => {
    if (c.name.includes(q)) return true;
    if (c.description.toLowerCase().includes(q)) return true;
    if (c.aliases?.some((a) => a.includes(q))) return true;
    if (c.topics?.some((t) => t.includes(q))) return true;
    return false;
  });
}

/** Product version shown by `xr --version` (kept in sync with package / kernel). */
export const XR_VERSION = "3.1.5";
export const XR_CLI_CODENAME = "3.1C";
