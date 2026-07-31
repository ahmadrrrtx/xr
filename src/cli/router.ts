/**
 * XR 3.1.5 (Helios) — CLI router
 *
 * Resolves argv → fast path | registered command | default `run` task.
 * Preserves full backwards compatibility with legacy command names.
 * Version is now derived from src/core/version.ts single source of truth.
 */

import { XRKernel } from "../core/kernel.ts";
import { RunAgentCommand } from "../commands/run-agent.ts";
import { DoctorCommand } from "../commands/doctor.ts";
import { ConfigCommand } from "../commands/config.ts";
import { BudgetCommand } from "../commands/budget.ts";
import { ProvidersCommand } from "../commands/providers.ts";
import { MemoryCommand } from "../commands/memory.ts";
import { ContextCommand } from "../commands/context.ts";
import { PluginsCommand, PluginRunCommand } from "../commands/plugins.ts";
import { McpCommand } from "../commands/mcp.ts";
import { WorkspaceCommand } from "../commands/workspace.ts";
import {
  ControlCommand,
  EnvironmentCommand,
  InstallCommand,
  ModelsCommand,
  OnboardingCommand,
  RepairCommand,
  ResearchCommand,
  ResetCommand,
  StatusCommand,
  UpdateCommand,
  VoiceCommand,
  SpeakCommand,
  ListenCommand,
} from "../commands/install.ts";
import { UninstallCommand } from "../commands/uninstall.ts";
import { AgentsCommand } from "../commands/agents.ts";
import { SkillsCommand, SkillsAliasCommand } from "../commands/skills.ts";
import { CapabilitiesCommand, CapabilityAliasCommand } from "../commands/capabilities.ts";
import { ShieldCommand } from "../commands/shield.ts";
import { TrustCommand } from "../commands/trust.ts";
import { AuditCommand } from "../commands/audit.ts";
import { SessionCommand } from "../commands/session.ts";
import { AttacksCommand } from "../commands/attacks.ts";
import { AskCommand, PlanCommand } from "../commands/ask-plan.ts";
import { LogsCommand } from "../commands/logs.ts";
import { BusinessCommand, BizAliasCommand } from "../commands/business.ts";
import { EnterpriseCommand, EnterpriseAliasCommand } from "../commands/enterprise.ts";
import { EvaluateCommand, EvalAliasCommand } from "../commands/evaluate.ts";
import { serve } from "../daemon/server.ts";
import { CORE_VERSION, CODENAME, PKG, versionInfo } from "../core/version.ts";
import {
  resolveCommandName,
  getCatalogEntry,
  allAliasesAndNames,
  XR_VERSION,
  XR_CLI_CODENAME,
  DISPLAY_VERSION,
  type CatalogEntry,
} from "./catalog.ts";
import { showHelp, showCommandHelp } from "./help.ts";
import { parseGlobalFlags, EXIT, type GlobalFlags } from "./flags.ts";
import { setOutputFlags, emitJson, isJsonMode, printDidYouMean, printError } from "./output.ts";
import { handleFatal, usageError, CliError } from "./errors.ts";

// ── Command registration ──────────────────────────────────────────────────────

function registerCommands(kernel: XRKernel): void {
  kernel.commands.register(new RunAgentCommand());
  kernel.commands.register(new AskCommand());
  kernel.commands.register(new PlanCommand());
  kernel.commands.register(new InstallCommand());
  kernel.commands.register(new OnboardingCommand());
  kernel.commands.register(new DoctorCommand());
  kernel.commands.register(new StatusCommand());
  kernel.commands.register(new RepairCommand());
  kernel.commands.register(new UpdateCommand());
  kernel.commands.register(new ResetCommand());
  kernel.commands.register(new UninstallCommand());
  kernel.commands.register(new ConfigCommand());
  kernel.commands.register(new BudgetCommand());
  kernel.commands.register(new ProvidersCommand());
  kernel.commands.register(new ModelsCommand());
  kernel.commands.register(new VoiceCommand());
  kernel.commands.register(new SpeakCommand());
  kernel.commands.register(new ListenCommand());
  kernel.commands.register(new ControlCommand());
  kernel.commands.register(new EnvironmentCommand());
  kernel.commands.register(new ResearchCommand());
  kernel.commands.register(new MemoryCommand());
  kernel.commands.register(new ContextCommand());
  kernel.commands.register(new PluginsCommand());
  kernel.commands.register(new PluginRunCommand());
  kernel.commands.register(new McpCommand());
  kernel.commands.register(new SkillsCommand());
  kernel.commands.register(new SkillsAliasCommand());
  kernel.commands.register(new CapabilitiesCommand());
  kernel.commands.register(new CapabilityAliasCommand());
  kernel.commands.register(new AgentsCommand());
  kernel.commands.register(new ShieldCommand());
  kernel.commands.register(new TrustCommand());
  kernel.commands.register(new WorkspaceCommand());
  kernel.commands.register(new AuditCommand());
  kernel.commands.register(new SessionCommand());
  kernel.commands.register(new AttacksCommand());
  kernel.commands.register(new LogsCommand());
  kernel.commands.register(new BusinessCommand());
  kernel.commands.register(new BizAliasCommand());
  kernel.commands.register(new EnterpriseCommand());
  kernel.commands.register(new EnterpriseAliasCommand());
  kernel.commands.register(new EvaluateCommand());
  kernel.commands.register(new EvalAliasCommand());
}

// ── Alias → registry name ─────────────────────────────────────────────────────

/**
 * Map catalog aliases to the name registered on the kernel CommandRegistry.
 * Some catalog names differ from registry names (e.g. skills vs skill).
 */
const REGISTRY_NAME: Record<string, string> = {
  shell: "shell", // not registered — fast path
  serve: "serve",
  help: "help",
  version: "version",
  run: "run",
  ask: "ask",
  plan: "plan",
  research: "research",
  agents: "agents",
  agent: "agents",
  control: "control",
  computer: "control",
  env: "env",
  environment: "env",
  voice: "voice",
  speak: "speak",
  listen: "listen",
  workspace: "workspace",
  workspaces: "workspace",
  ws: "workspace",
  session: "session",
  sessions: "session",
  memory: "memory",
  mem: "memory",
  context: "context",
  ctx: "context",
  knowledge: "context",
  config: "config",
  cfg: "config",
  settings: "config",
  trust: "trust",
  isolation: "trust",
  providers: "providers",
  provider: "providers",
  models: "models",
  model: "models",
  budget: "budget",
  cost: "budget",
  spend: "budget",
  skills: "skills",
  skill: "skill",
  marketplace: "skills",
  capabilities: "capabilities",
  capability: "capability",
  caps: "capabilities",
  plugins: "plugins",
  plugin: "plugin",
  mcp: "mcp",
  shield: "shield",
  security: "shield",
  audit: "audit",
  "verify-log": "audit",
  log: "logs",
  logs: "logs",
  attacks: "attacks",
  lab: "attacks",
  "security-lab": "attacks",
  doctor: "doctor",
  health: "doctor",
  check: "doctor",
  status: "status",
  update: "update",
  upgrade: "update",
  repair: "repair",
  reset: "reset",
  install: "install",
  onboarding: "onboarding",
  setup: "onboarding",
  init: "onboarding",
  business: "business",
  biz: "business",
  enterprise: "enterprise",
  ent: "enterprise",
  evaluate: "evaluate",
  eval: "eval",
  benchmark: "evaluate",
  task: "run",
  do: "run",
  exec: "run",
};

function registryNameFor(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (REGISTRY_NAME[lower]) return REGISTRY_NAME[lower];
  const canonical = resolveCommandName(lower);
  if (canonical && REGISTRY_NAME[canonical]) return REGISTRY_NAME[canonical];
  return canonical;
}

// ── Serve ─────────────────────────────────────────────────────────────────────

function parseServePort(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) return Number.parseInt(args[i + 1]!, 10);
    if (arg?.startsWith("--port=")) return Number.parseInt(arg.slice("--port=".length), 10);
  }
  return undefined;
}

async function runServeCommand(args: string[]): Promise<void> {
  const port = parseServePort(args);
  const handle = await serve({ port: Number.isFinite(port) ? port : undefined });
  await new Promise<void>((resolve) => {
    const stop = () => {
      try {
        handle.stop();
      } catch {
        /* ignore */
      }
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

// ── Kernel helpers ────────────────────────────────────────────────────────────

async function withKernel(flags: GlobalFlags, fn: (kernel: XRKernel) => Promise<void>): Promise<void> {
  const kernel = new XRKernel();
  registerCommands(kernel);
  await kernel.bootstrap();

  // Workspace override before start (if requested)
  if (flags.workspace) {
    try {
      const list = kernel.workspaces.listWorkspaces();
      if (list.some((w) => w.id === flags.workspace)) {
        await kernel.switchWorkspace(flags.workspace);
      }
    } catch {
      // switchWorkspace needs bootstrap complete; ignore soft failures
    }
  }

  await kernel.start();
  try {
    await fn(kernel);
  } finally {
    await kernel.shutdown();
  }
}

function injectRunOverrides(args: string[], flags: GlobalFlags): string[] {
  const out = [...args];
  // Prefer explicit flags already in args; only inject missing globals
  const has = (flag: string) => out.includes(flag);
  if (flags.mode && !has("--mode")) out.push("--mode", flags.mode);
  if (flags.model && !has("--model")) out.push("--model", flags.model);
  if (flags.provider && !has("--provider")) out.push("--provider", flags.provider);
  if (flags.budget != null && !has("--budget")) out.push("--budget", String(flags.budget));
  if (flags.maxTokens != null && !has("--max-tokens")) out.push("--max-tokens", String(flags.maxTokens));
  if (flags.dryRun && !has("--dry-run")) out.push("--dry-run");
  if (flags.resume && !has("--resume")) out.push("--resume", flags.resume);
  return out;
}

/**
 * Re-attach global flags that the shared parser consumed so legacy command
 * handlers still see `--json`, `--quiet`, etc. on `ctx.args`.
 */
function reinjectGlobalFlags(args: string[], flags: GlobalFlags): string[] {
  const out = [...args];
  const has = (flag: string) => out.includes(flag);
  if (flags.json && !has("--json")) out.push("--json");
  if (flags.yaml && !has("--yaml")) out.push("--yaml");
  if (flags.quiet && !has("--quiet") && !has("-q")) out.push("--quiet");
  if (flags.verbose && !has("--verbose")) out.push("--verbose");
  if (flags.debug && !has("--debug")) out.push("--debug");
  if (flags.yes && !has("--yes") && !has("-y")) out.push("--yes");
  if (flags.noColor && !has("--no-color")) out.push("--no-color");
  if (flags.workspace && !has("--workspace") && !has("-w")) {
    out.push("--workspace", flags.workspace);
  }
  if (flags.format && flags.format !== "text" && !has("--format") && !has("--output") && !has("-o")) {
    out.push("--format", flags.format);
  }
  return out;
}

/**
 * Read the exit code a command signalled through `process.exitCode`.
 *
 * Commands report failure by assigning `process.exitCode`; the router must
 * surface that rather than overwrite it with success (Phase 0 · T11).
 */
function currentExitCode(): number {
  const code = process.exitCode;
  if (typeof code === "number" && code !== 0) return code;
  return EXIT.OK;
}

// ── Unknown command UX ────────────────────────────────────────────────────────

function unknownCommand(name: string): never {
  const candidates = allAliasesAndNames().filter((n) => !n.startsWith("-"));
  printError({
    id: "unknown_command",
    what: `Unknown command: ${name}`,
    why: "That name is not a registered XR command or legacy alias.",
    fix: ["Run xr help to browse commands.", 'Free-form tasks go through: xr "your task"'],
    related: ["xr help", "xr doctor"],
    code: EXIT.USAGE,
  });
  printDidYouMean(name, candidates);
  throw new CliError({
    id: "unknown_command",
    what: `Unknown command: ${name}`,
    code: EXIT.USAGE,
  });
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function runCli(argv: string[]): Promise<number> {
  const cleaned = argv.filter((a) => a !== "--from-bootstrap");
  const flags = parseGlobalFlags(cleaned);
  setOutputFlags(flags);

  const head = flags.args[0];
  const rest = flags.args.slice(1);

  try {
    // ── Version (fast) ────────────────────────────────────────────────────
    if (flags.version || head === "version" || head === "--version" || head === "-v") {
      if (isJsonMode()) {
        emitJson({
          name: PKG.name,
          version: CORE_VERSION,
          codename: CODENAME,
          display: DISPLAY_VERSION,
          cli: CODENAME,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          repo: PKG.repo,
          homepage: PKG.homepage,
          npm: PKG.npm,
          pluginApi: versionInfo().pluginApi,
        });
      } else {
        console.log(`v${CORE_VERSION} (${CODENAME})`);
      }
      return EXIT.OK;
    }

    // ── Help (fast) ───────────────────────────────────────────────────────
    if (flags.help && !head) {
      showHelp(undefined, { all: rest.includes("--all") || rest.includes("-a") });
      return EXIT.OK;
    }
    if (head === "help" || head === "--help" || head === "-h") {
      const topic = rest[0];
      if (topic === "--all" || topic === "-a") showHelp(undefined, { all: true });
      else showHelp(topic);
      return EXIT.OK;
    }
    // `xr <cmd> --help`
    if (head && (flags.help || rest.includes("--help") || rest.includes("-h"))) {
      const resolved = resolveCommandName(head) ?? head;
      showCommandHelp(resolved);
      return EXIT.OK;
    }

    // ── Shell (fast, default) ─────────────────────────────────────────────
    if (!head || head === "shell" || head === "--tui" || head === "tui") {
      const { runTUI } = await import("../interfaces/tui.ts");
      await runTUI();
      return EXIT.OK;
    }

    // ── Serve (fast) ──────────────────────────────────────────────────────
    if (head === "serve") {
      await runServeCommand(rest);
      return EXIT.OK;
    }

    // ── Resolve command ───────────────────────────────────────────────────
    const regName = registryNameFor(head);
    const catalog: CatalogEntry | undefined = getCatalogEntry(head);

    // Known registry command
    if (regName && regName !== "shell" && regName !== "serve" && regName !== "help" && regName !== "version") {
      // Special: audit verify-log legacy was a top-level command that maps to audit verify
      let commandArgs = reinjectGlobalFlags(rest, flags);
      if (head === "verify-log") {
        commandArgs = reinjectGlobalFlags(["verify", ...rest], flags);
      }

      // Inject global mode/budget into run
      if (regName === "run") {
        commandArgs = injectRunOverrides(commandArgs, flags);
      }

      await withKernel(flags, async (kernel) => {
        if (kernel.commands.get(regName)) {
          await kernel.executeCommand(regName, commandArgs, process.cwd());
        } else {
          // Fallback: treat as run task (shouldn't happen for known regName)
          await kernel.executeCommand("run", injectRunOverrides(flags.args, flags), process.cwd());
        }
      });
      // Phase 0 · T11 — propagate the command's exit code. Returning EXIT.OK
      // unconditionally discarded every failure a command reported through
      // process.exitCode, so failed work exited 0.
      return currentExitCode();
    }

    /**
     * ── Default: free-form task → run ───────────────────────────────────────
     *
     * Phase 0 · T11 — one-word tasks must route to task mode.
     *
     * This block previously rejected any single token within edit distance 2 of
     * a command name: `xr hello` printed "Unknown command: hello" (because
     * "hello" is 2 edits from "help") instead of running the task, breaking the
     * documented `xr "your task"` grammar for one-word inputs.
     *
     * The rule is now unambiguous: a RESERVED command name is a command;
     * everything else is a task. Near-miss typos still get a suggestion, but as
     * a non-fatal hint printed alongside the task run — never as a refusal.
     */
    if (head && !head.startsWith("-") && !resolveCommandName(head)) {
      const looksLikeSingleWord = rest.length === 0 && head.length < 24 && !head.includes(" ");
      if (looksLikeSingleWord) {
        const { didYouMean, editDistance } = await import("./output.ts");
        const suggestions = didYouMean(
          head,
          allAliasesAndNames().filter((n) => !n.startsWith("-")),
        );
        const nearest = suggestions[0];
        if (nearest && nearest !== head && editDistance(head.toLowerCase(), nearest.toLowerCase()) <= 2) {
          const { tip } = await import("./output.ts");
          tip(`Running "${head}" as a task. Did you mean the command \`xr ${nearest}\`?`);
        }
      }
    }

    // Free-form run
    await withKernel(flags, async (kernel) => {
      const taskArgs = injectRunOverrides(flags.args, flags);
      if (!taskArgs.length) {
        throw usageError(
          "No task provided",
          'Pass a task: xr "your task"   or open the Shell: xr',
          ["xr help", "xr onboarding"],
        );
      }
      await kernel.executeCommand("run", taskArgs, process.cwd());
    });
    return currentExitCode();
  } catch (e) {
    if (e instanceof CliError && e.id === "unknown_command") {
      return EXIT.USAGE;
    }
    return handleFatal(e);
  }
}

/** For tests / programmatic use */
export { registerCommands, registryNameFor };
