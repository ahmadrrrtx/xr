/**
 * XR Phase 3 · T1 — Lazy command loaders (compile-safe).
 *
 * THE dynamic-import surface of the CLI. Every path here is a STATIC STRING
 * LITERAL so Bun's `--compile` tracer can resolve it at build time
 * (Global Rule 7: runtime-computed `await import(name)` fails at boot).
 *
 * Rules for contributors (documented in docs/perf/PERF-BUDGETS.md):
 *   - Never compute an import path from runtime values.
 *   - To add a command: add one entry here + a boot profile in
 *     src/core/boot-profile.ts; the router and the kernel stay untouched.
 *
 * The module itself imports nothing heavy: the command modules are loaded
 * only when a command is actually executed.
 */

import type { Command } from "../core/command-registry.ts";

export interface CommandLoaderEntry {
  /** Literal module path — must remain a static string literal. */
  path: string;
  /** Exported class name to construct. */
  symbol: string;
}

/**
 * Registry name → lazy loader. Keys are the registry names the classes
 * register under (see src/cli/route-decision.ts REGISTRY_NAME for aliases).
 */
export const COMMAND_LOADERS: Readonly<Record<string, CommandLoaderEntry>> = {
  // Agent family.
  run: { path: "../commands/run-agent.ts", symbol: "RunAgentCommand" },
  ask: { path: "../commands/ask-plan.ts", symbol: "AskCommand" },
  plan: { path: "../commands/ask-plan.ts", symbol: "PlanCommand" },
  agents: { path: "../commands/agents.ts", symbol: "AgentsCommand" },
  // Lifecycle / install family.
  install: { path: "../commands/install.ts", symbol: "InstallCommand" },
  onboarding: { path: "../commands/install.ts", symbol: "OnboardingCommand" },
  status: { path: "../commands/install.ts", symbol: "StatusCommand" },
  repair: { path: "../commands/install.ts", symbol: "RepairCommand" },
  update: { path: "../commands/install.ts", symbol: "UpdateCommand" },
  reset: { path: "../commands/install.ts", symbol: "ResetCommand" },
  models: { path: "../commands/install.ts", symbol: "ModelsCommand" },
  voice: { path: "../commands/install.ts", symbol: "VoiceCommand" },
  speak: { path: "../commands/install.ts", symbol: "SpeakCommand" },
  listen: { path: "../commands/install.ts", symbol: "ListenCommand" },
  control: { path: "../commands/install.ts", symbol: "ControlCommand" },
  env: { path: "../commands/install.ts", symbol: "EnvironmentCommand" },
  research: { path: "../commands/install.ts", symbol: "ResearchCommand" },
  repo: { path: "../commands/repo.ts", symbol: "RepoCommand" },
  uninstall: { path: "../commands/uninstall.ts", symbol: "UninstallCommand" },
  // Core config / providers.
  config: { path: "../commands/config.ts", symbol: "ConfigCommand" },
  budget: { path: "../commands/budget.ts", symbol: "BudgetCommand" },
  providers: { path: "../commands/providers.ts", symbol: "ProvidersCommand" },
  doctor: { path: "../commands/doctor.ts", symbol: "DoctorCommand" },
  // State surfaces.
  memory: { path: "../commands/memory.ts", symbol: "MemoryCommand" },
  context: { path: "../commands/context.ts", symbol: "ContextCommand" },
  plugins: { path: "../commands/plugins.ts", symbol: "PluginsCommand" },
  plugin: { path: "../commands/plugins.ts", symbol: "PluginRunCommand" },
  mcp: { path: "../commands/mcp.ts", symbol: "McpCommand" },
  session: { path: "../commands/session.ts", symbol: "SessionCommand" },
  logs: { path: "../commands/logs.ts", symbol: "LogsCommand" },
  audit: { path: "../commands/audit.ts", symbol: "AuditCommand" },
  // Phase 06 — execution history + durable-execution recovery surface.
  execution: { path: "../commands/execution.ts", symbol: "ExecutionCommand" },
  telemetry: { path: "../commands/telemetry.ts", symbol: "TelemetryCommand" },
  workspace: { path: "../commands/workspace.ts", symbol: "WorkspaceCommand" },
  // Ecosystem.
  skill: { path: "../commands/skills.ts", symbol: "SkillsCommand" },
  skills: { path: "../commands/skills.ts", symbol: "SkillsAliasCommand" },
  capabilities: { path: "../commands/capabilities.ts", symbol: "CapabilitiesCommand" },
  capability: { path: "../commands/capabilities.ts", symbol: "CapabilityAliasCommand" },
  shield: { path: "../commands/shield.ts", symbol: "ShieldCommand" },
  trust: { path: "../commands/trust.ts", symbol: "TrustCommand" },
  attacks: { path: "../commands/attacks.ts", symbol: "AttacksCommand" },
  // Business / enterprise / evaluation.
  business: { path: "../commands/business.ts", symbol: "BusinessCommand" },
  biz: { path: "../commands/business.ts", symbol: "BizAliasCommand" },
  enterprise: { path: "../commands/enterprise.ts", symbol: "EnterpriseCommand" },
  ent: { path: "../commands/enterprise.ts", symbol: "EnterpriseAliasCommand" },
  evaluate: { path: "../commands/evaluate.ts", symbol: "EvaluateCommand" },
  eval: { path: "../commands/evaluate.ts", symbol: "EvalAliasCommand" },
};

/**
 * Literal-path dynamic import per command module (Global Rule 7:
 * compile-safe for `bun --compile`). Adding a command requires one case
 * here — never a computed path.
 */
async function importCommandModule(path: string): Promise<Record<string, new () => Command>> {
  switch (path) {
    case "../commands/run-agent.ts":
      return (await import("../commands/run-agent.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/ask-plan.ts":
      return (await import("../commands/ask-plan.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/agents.ts":
      return (await import("../commands/agents.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/install.ts":
      return (await import("../commands/install.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/uninstall.ts":
      return (await import("../commands/uninstall.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/config.ts":
      return (await import("../commands/config.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/budget.ts":
      return (await import("../commands/budget.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/providers.ts":
      return (await import("../commands/providers.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/doctor.ts":
      return (await import("../commands/doctor.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/memory.ts":
      return (await import("../commands/memory.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/context.ts":
      return (await import("../commands/context.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/plugins.ts":
      return (await import("../commands/plugins.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/mcp.ts":
      return (await import("../commands/mcp.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/session.ts":
      return (await import("../commands/session.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/logs.ts":
      return (await import("../commands/logs.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/telemetry.ts":
      return (await import("../commands/telemetry.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/audit.ts":
      return (await import("../commands/audit.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/execution.ts":
      return (await import("../commands/execution.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/workspace.ts":
      return (await import("../commands/workspace.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/skills.ts":
      return (await import("../commands/skills.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/capabilities.ts":
      return (await import("../commands/capabilities.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/shield.ts":
      return (await import("../commands/shield.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/trust.ts":
      return (await import("../commands/trust.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/attacks.ts":
      return (await import("../commands/attacks.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/business.ts":
      return (await import("../commands/business.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/enterprise.ts":
      return (await import("../commands/enterprise.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/evaluate.ts":
      return (await import("../commands/evaluate.ts")) as unknown as Record<string, new () => Command>;
    case "../commands/repo.ts":
      return (await import("../commands/repo.ts")) as unknown as Record<string, new () => Command>;
    default:
      throw new Error(`command-loaders: no literal import for "${path}"`);
  }
}

/**
 * Materialize a command from the loader map. `symbol` is looked up on the
 * imported module via a typed cast (no boundary `any`): the module shape is
 * known statically from COMMAND_LOADERS, and the cast goes through `unknown`.
 */
export async function loadCommand(name: string): Promise<Command> {
  const entry = COMMAND_LOADERS[name];
  if (!entry) throw new Error(`No lazy loader registered for command "${name}"`);
  const mod = await importCommandModule(entry.path);
  const Ctor = mod[entry.symbol];
  if (typeof Ctor !== "function") {
    throw new Error(`Lazy loader for "${name}": export "${entry.symbol}" not found in ${entry.path}`);
  }
  return new Ctor();
}

/** Install every lazy loader onto a command registry (no module imports run). */
export function installCommandLoaders(commands: {
  registerLazy(name: string, description: string, load: () => Promise<Command>): unknown;
}): void {
  for (const [name, entry] of Object.entries(COMMAND_LOADERS)) {
    commands.registerLazy(name, `lazy:${entry.symbol}`, () => loadCommand(name));
  }
}
