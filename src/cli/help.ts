/**
 * XR 3.1.5 (Helios) — Rich help system
 *
 * Progressive disclosure: overview → group → command → topic.
 * Spec: IA §5, Accessibility §4 (80-col, plain language), Design System voice.
 */

import {
  CATALOG,
  GROUP_LABELS,
  GROUP_ORDER,
  catalogByGroup,
  getCatalogEntry,
  resolveCommandName,
  searchCatalog,
  XR_VERSION,
  XR_CLI_CODENAME,
  type CatalogEntry,
} from "./catalog.ts";
import {
  banner,
  heading,
  tip,
  code,
  xrCyan,
  xrDim,
  xrBold,
  xrGreen,
  xrAmber,
  xrViolet,
  emitJson,
  isJsonMode,
  printDidYouMean,
} from "./output.ts";
import { allAliasesAndNames } from "./catalog.ts";

const COL = 38;

function padCmd(cmd: string, width = COL): string {
  const bare = cmd.length;
  if (bare >= width) return cmd + " ";
  return cmd + " ".repeat(width - bare);
}

function printEntryLine(entry: CatalogEntry, prefix = "xr "): void {
  const label = prefix + entry.name;
  console.log(`  ${xrCyan(padCmd(label))} ${xrDim(entry.description)}`);
}

// ── Main help ─────────────────────────────────────────────────────────────────

export function showHelp(topic?: string, opts?: { all?: boolean }): void {
  if (topic) {
    showTopicOrCommandHelp(topic);
    return;
  }

  if (isJsonMode()) {
    emitJson({
      version: XR_VERSION,
      codename: XR_CLI_CODENAME,
      commands: CATALOG.filter((c) => opts?.all || !c.hidden).map((c) => ({
        name: c.name,
        description: c.description,
        usage: c.usage,
        group: c.group,
        aliases: c.aliases ?? [],
        needsKernel: c.needsKernel,
      })),
    });
    return;
  }

  banner(`v${XR_VERSION} · CLI ${XR_CLI_CODENAME}`);

  // Quick start — teach, don't just list
  console.log(`  ${xrBold("Quick start")}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrCyan("xr onboarding")}               ${xrDim("first-time setup wizard")}`);
  console.log(`  ${xrCyan("xr")}                          ${xrDim("open the fullscreen Shell")}`);
  console.log(`  ${xrCyan('xr "write a hello world"')}    ${xrDim("run a task (one-shot)")}`);
  console.log(`  ${xrCyan("xr serve")}                    ${xrDim("start Control Center (web)")}`);
  console.log(`  ${xrCyan("xr doctor")}                   ${xrDim("system health check")}`);
  console.log();
  console.log(`  ${xrBold("Change model anytime")}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrCyan("xr providers set <id> [model]")} ${xrDim("primary route (e.g. ollama qwen2.5:7b)")}`);
  console.log(`  ${xrCyan("xr models set <runtime> <model>")} ${xrDim("local runtime selection")}`);
  console.log(`  ${xrDim("Shell: Alt+P · /model <provider> [model]  ·  status bar always shows active model")}`);
  console.log();

  const byGroup = catalogByGroup(Boolean(opts?.all));

  for (const group of GROUP_ORDER) {
    const entries = byGroup.get(group) ?? [];
    if (!entries.length) continue;
    console.log(`  ${xrBold(GROUP_LABELS[group])}`);
    console.log(`  ${xrDim("─".repeat(46))}`);
    for (const entry of entries) {
      printEntryLine(entry);
    }
    console.log();
  }

  // Global flags
  console.log(`  ${xrBold("Global flags")}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  const flags: Array<[string, string]> = [
    ["--help, -h", "show help"],
    ["--version, -v", "print version"],
    ["--json", "machine-readable JSON on stdout"],
    ["--yaml", "YAML output (where supported)"],
    ["--format text|json|yaml|markdown", "output format"],
    ["--quiet, -q", "suppress non-essential output"],
    ["--verbose", "extra detail"],
    ["--debug", "debug mode (also XR_DEBUG=1)"],
    ["--no-color", "disable ANSI color (also NO_COLOR=1)"],
    ["--yes, -y", "assume yes for confirmations"],
    ["--workspace <id>", "target workspace"],
    ["--mode agent|plan|ask", "execution mode"],
    ["--model <name>", "model override"],
    ["--provider <id>", "provider override"],
    ["--budget <usd>", "per-task spend ceiling"],
    ["--dry-run", "simulate without side effects"],
  ];
  for (const [f, d] of flags) {
    console.log(`  ${xrCyan(padCmd(f, 36))} ${xrDim(d)}`);
  }
  console.log();

  // Modes vocabulary (IA)
  console.log(`  ${xrBold("Modes")}  ${xrDim("(same in Shell · Control Center · CLI)")}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrCyan("agent")}  ${xrDim("execute tools, write files, run shell (approvals enforced)")}`);
  console.log(`  ${xrViolet("plan")}   ${xrDim("produce a plan only — no tool execution")}`);
  console.log(`  ${xrDim("ask")}    ${xrDim("answer-only, read-only, cheap")}`);
  console.log();

  console.log(`  ${xrDim("Topic help:")}  ${xrCyan("xr help <topic>")}`);
  console.log(
    `  ${xrDim("Topics:")}  ${["shell", "providers", "models", "memory", "security", "skills", "research", "workspace", "budget", "scripting"]
      .map((t) => xrCyan(t))
      .join("  ")}`,
  );
  console.log();
  console.log(`  ${xrDim("Docs")}     ${xrCyan("https://github.com/ahmadrrrtx/xr")}`);
  console.log(`  ${xrDim("Website")}  ${xrCyan("https://xr-gules.vercel.app")}`);
  console.log();
  tip("A user should not need docs for common tasks — try xr doctor and xr \"hello\".");
  console.log();
}

// ── Command / topic help ──────────────────────────────────────────────────────

function showTopicOrCommandHelp(topic: string): void {
  const t = topic.toLowerCase().trim();

  // Built-in topics first (may share names with commands, e.g. "security")
  if (TOPIC_HANDLERS[t]) {
    TOPIC_HANDLERS[t]!();
    return;
  }

  // Exact command?
  const resolved = resolveCommandName(t) ?? resolveCommandName(t.replace(/^xr\s+/, ""));
  if (resolved) {
    showCommandHelp(resolved);
    return;
  }

  // Fuzzy search catalog
  const hits = searchCatalog(t);
  if (hits.length === 1) {
    showCommandHelp(hits[0]!.name);
    return;
  }
  if (hits.length > 1) {
    if (isJsonMode()) {
      emitJson({ query: t, matches: hits.map((h) => h.name) });
      return;
    }
    banner();
    console.log(`  ${xrBold(`Help matching “${t}”`)}\n`);
    for (const h of hits.slice(0, 12)) printEntryLine(h);
    console.log();
    tip(`Try: xr help ${hits[0]!.name}`);
    console.log();
    return;
  }

  if (isJsonMode()) {
    emitJson({ ok: false, error: { message: `Unknown help topic: ${t}` } });
    return;
  }

  banner();
  console.log(`  ${xrAmber("!")} Unknown help topic: ${xrBold(t)}\n`);
  printDidYouMean(t, [
    ...allAliasesAndNames(),
    "shell",
    "providers",
    "models",
    "memory",
    "security",
    "skills",
    "research",
    "workspace",
    "budget",
    "scripting",
  ]);
  console.log();
  tip("xr help            full command list");
  tip("xr help scripting  flags, exit codes, piping");
  console.log();
}

export function showCommandHelp(name: string): void {
  const entry = getCatalogEntry(name);
  if (!entry) {
    showHelp(name);
    return;
  }

  if (isJsonMode()) {
    emitJson(entry);
    return;
  }

  banner();
  console.log(`  ${xrBold("xr " + entry.name)}  ${xrDim(entry.description)}`);
  console.log();
  console.log(`  ${xrDim("Usage")}`);
  console.log(`    ${xrCyan(entry.usage)}`);
  console.log();

  if (entry.aliases?.length) {
    console.log(`  ${xrDim("Aliases")}  ${entry.aliases.map((a) => xrCyan(a)).join(xrDim(" · "))}`);
    console.log();
  }

  if (entry.subcommands?.length) {
    console.log(`  ${xrDim("Subcommands")}`);
    for (const sub of entry.subcommands) {
      console.log(`    ${xrCyan(padCmd(sub.name, 16))} ${xrDim(sub.description)}`);
    }
    console.log();
  }

  if (entry.examples?.length) {
    console.log(`  ${xrDim("Examples")}`);
    for (const ex of entry.examples) {
      console.log(`    ${xrCyan("$")} ${ex.cmd}`);
      console.log(`      ${xrDim(ex.description)}`);
    }
    console.log();
  }

  if (entry.related?.length) {
    console.log(
      `  ${xrDim("Related")}  ${entry.related.map((r) => xrCyan("xr " + r)).join(xrDim(" · "))}`,
    );
    console.log();
  }

  console.log(`  ${xrDim("Also:")} ${xrCyan("xr help")} · ${xrCyan("xr doctor")} · ${xrCyan("xr --json")} for scripts`);
  console.log();
}

// ── Topics ────────────────────────────────────────────────────────────────────

const TOPIC_HANDLERS: Record<string, () => void> = {
  shell: () => topicShell(),
  tui: () => topicShell(),
  security: () => topicSecurity(),
  trust: () => topicSecurity(),
  providers: () => topicProviders(),
  models: () => topicModels(),
  memory: () => topicMemory(),
  research: () => topicResearch(),
  skills: () => topicSkills(),
  marketplace: () => topicSkills(),
  workspace: () => topicWorkspace(),
  workspaces: () => topicWorkspace(),
  budget: () => topicBudget(),
  cost: () => topicBudget(),
  scripting: () => topicScripting(),
  json: () => topicScripting(),
  ci: () => topicScripting(),
  modes: () => topicModes(),
  mode: () => topicModes(),
  voice: () => {
    showCommandHelp("voice");
  },
  plugins: () => showCommandHelp("plugins"),
  mcp: () => showCommandHelp("mcp"),
  shield: () => showCommandHelp("shield"),
  audit: () => showCommandHelp("audit"),
};

function topicShell(): void {
  banner();
  heading("XR Shell");
  console.log(`  The Shell is the terminal-native fullscreen experience.`);
  console.log(`  (Internal name “TUI” is never shown to users.)\n`);
  console.log(`  Start:  ${xrCyan("xr")}  or  ${xrCyan("xr --tui")}\n`);
  console.log(`  ${xrBold("Essentials")}`);
  console.log(`  ${xrDim("  ·")} Composer always ready — type natural language or /commands`);
  console.log(`  ${xrDim("  ·")} ${xrCyan("Ctrl+K")} command palette`);
  console.log(`  ${xrDim("  ·")} ${xrCyan("g")} then ${xrCyan("d/c/s/w/r/…")} go-to navigation`);
  console.log(`  ${xrDim("  ·")} ${xrCyan("?")} contextual keyboard help`);
  console.log(`  ${xrDim("  ·")} Status bar: workspace · mode · provider/model · spend · audit`);
  console.log(`  ${xrDim("  ·")} Modes: agent / plan / ask (Shift+Tab cycles)\n`);
  tip("Open Control Center anytime: xr serve");
  console.log();
}

function topicSecurity(): void {
  banner();
  heading("XR Security & Trust");
  console.log(`  Security features are ${xrGreen("code-enforced")}, not optional.\n`);
  console.log(`  ${xrGreen("•")} ${xrBold("Tamper-evident audit")}   SHA-256 hash chain on every action`);
  console.log(`  ${xrGreen("•")} ${xrBold("Hard budget ceiling")}    agent cannot exceed the cap`);
  console.log(`  ${xrGreen("•")} ${xrBold("Egress allow-list")}      only configured domains`);
  console.log(`  ${xrGreen("•")} ${xrBold("Injection defense")}      attack lab + signed report`);
  console.log(`  ${xrGreen("•")} ${xrBold("Approval gates")}         consent for risky tools`);
  console.log(`  ${xrGreen("•")} ${xrBold("Local-first")}            no data leaves by default\n`);
  code("xr audit verify", "verify audit chain");
  code("xr attacks", "run injection benchmark");
  code("xr shield status", "security overview");
  code("xr doctor", "full health check");
  console.log();
}

function topicProviders(): void {
  banner();
  heading("Providers");
  console.log(`  ${xrDim("Supported:")} Ollama · Claude · OpenAI · Gemini · Groq · DeepSeek`);
  console.log(`              Together · Mistral · Cohere · Cerebras · OpenRouter · Bedrock\n`);
  console.log(`  ${xrBold("You are never stuck on the default model.")}\n`);
  code("xr providers list", "list + key status + primary");
  code("xr providers set ollama qwen2.5:7b", "change primary model");
  code("xr providers set openai gpt-4o-mini", "switch to cloud (BYOK)");
  code("xr providers add openai", "store API key securely");
  code("xr providers test", "health-check");
  console.log();
  console.log(`  ${xrDim("Also:")} Shell Alt+P · /model <provider> [model] · Control Center → Providers`);
  console.log();
}

function topicModels(): void {
  banner();
  heading("Local models");
  console.log(`  ${xrBold("Change local model anytime — XR is not locked to the onboarding default.")}\n`);
  code("xr models", "status + how to change");
  code("xr models set ollama llama3.2", "change local model (persists)");
  code("xr models recommend", "best model for this machine");
  code("xr models install", "install recommended");
  code("xr models list", "families + runtimes");
  code("xr models test", "smoke-test active model");
  console.log();
  console.log(`  ${xrDim("Also:")} xr providers set · Shell Alt+P · Control Center → Models → Change model`);
  console.log();
}

function topicMemory(): void {
  banner();
  heading("Memory");
  console.log(`  XR remembers ${xrGreen("only what you explicitly tell it to")}. Local-first, inspectable.\n`);
  console.log(`  ${xrBold("Write")}`);
  code('xr memory add "prefer TypeScript" --category preference');
  code('xr memory add "tmp note" --ttl 3600');
  code("xr memory remove <id>");
  console.log();
  console.log(`  ${xrBold("Inspect")}`);
  code("xr memory list");
  code('xr memory recall "query"');
  code("xr memory health");
  console.log();
  tip('Disable: config "memory.enabled": false  or  XR_MEMORY_DISABLED=1');
  console.log();
}

function topicResearch(): void {
  banner();
  heading("Research");
  code('xr research "AI agents 2026"', "run a research job");
  code("xr research deep \"…\"", "deeper multi-source pass");
  code("xr research status", "recent sessions");
  console.log();
}

function topicSkills(): void {
  banner();
  heading("Skills & Marketplace");
  code("xr skills list", "unified runtime catalog");
  code("xr skill search <query>", "search");
  code("xr skill install <id>", "install");
  code("xr skill doctor", "runtime health");
  tip("Full UI: xr serve → Marketplace");
  console.log();
}

function topicWorkspace(): void {
  banner();
  heading("Workspaces");
  console.log(`  A workspace is an isolation boundary: its own memory, audit, sessions, budget.\n`);
  code("xr workspace list");
  code("xr workspace create demo \"Demo project\"");
  code("xr workspace use demo");
  code("xr workspace delete demo");
  console.log();
}

function topicBudget(): void {
  banner();
  heading("Budget");
  console.log(`  Hard per-task ceilings are code-enforced. Soft daily/monthly caps warn.\n`);
  code("xr budget", "status");
  code("xr budget set 10", "monthly cap USD");
  code('xr "task" --budget 0.25', "per-task hard cap");
  console.log();
}

function topicModes(): void {
  banner();
  heading("Modes");
  console.log(`  ${xrCyan("agent")}  execute actions, tools, shell, files — approvals enforced`);
  console.log(`  ${xrViolet("plan")}   step-by-step plan with checkboxes — no side effects`);
  console.log(`  ${xrDim("ask")}    answer only — no tools, cheapest\n`);
  code('xr run "…" --mode plan');
  code('xr ask "…"');
  code('xr plan "…"');
  tip("In Shell: Shift+Tab cycles modes; status bar always shows the active mode.");
  console.log();
}

function topicScripting(): void {
  banner();
  heading("Scripting & automation");
  console.log(`  ${xrBold("Output")}`);
  console.log(`  ${xrDim("  ·")} Human text by default (TTY: color + glyphs)`);
  console.log(`  ${xrDim("  ·")} ${xrCyan("--json")} → machine-readable on stdout`);
  console.log(`  ${xrDim("  ·")} Non-TTY / pipes: no ANSI, no spinners`);
  console.log(`  ${xrDim("  ·")} ${xrCyan("--quiet")} suppresses non-essential lines`);
  console.log(`  ${xrDim("  ·")} Errors → stderr; data → stdout\n`);
  console.log(`  ${xrBold("Exit codes")}`);
  console.log(`  ${xrDim("  0")} success`);
  console.log(`  ${xrDim("  1")} general error`);
  console.log(`  ${xrDim("  2")} invalid usage`);
  console.log(`  ${xrDim("  3")} network / auth`);
  console.log(`  ${xrDim("  4")} security / denied`);
  console.log(`  ${xrDim("  5")} not found`);
  console.log(`  ${xrDim("130")} interrupted (Ctrl+C)\n`);
  console.log(`  ${xrBold("Environment")}`);
  code("NO_COLOR=1", "disable color");
  code("XR_JSON=1", "force JSON");
  code("XR_QUIET=1", "quiet mode");
  code("XR_DEBUG=1", "debug / stack traces");
  code("XR_WORKSPACE=id", "default workspace");
  console.log();
  console.log(`  ${xrBold("Examples")}`);
  code('xr doctor --json | jq .checks');
  code('xr providers list --json');
  code('xr audit verify --json');
  console.log();
}

export { showTopicOrCommandHelp };
