#!/usr/bin/env bun
/**
 * XR — The AI Agent You Can Actually Trust
 * Stage 3 CLI bootstrap.
 */

import { XRRuntime } from "./core/runtime.ts";
import { RunAgentCommand } from "./commands/run-agent.ts";
import { DoctorCommand } from "./commands/doctor.ts";
import { ConfigCommand } from "./commands/config.ts";
import { BudgetCommand } from "./commands/budget.ts";
import { ProvidersCommand } from "./commands/providers.ts";
import { MemoryCommand } from "./commands/memory.ts";
import { PluginsCommand, PluginRunCommand } from "./commands/plugins.ts";
import { McpCommand } from "./commands/mcp.ts";
import {
  ControlCommand,
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
} from "./commands/install.ts";
import { ConfigService } from "./services/config-service.ts";
import { ProviderService } from "./services/provider-service.ts";
import { AgentService } from "./services/agent-service.ts";
import { BudgetService } from "./services/budget-service.ts";
import { PluginService } from "./services/plugin-service.ts";
import { McpService } from "./services/mcp-service.ts";
import { Store } from "./state/db.ts";
import { SessionStore } from "./state/stores/session-store.ts";
import { AuditStore } from "./state/stores/audit-store.ts";
import { MemoryStore } from "./state/stores/memory-store.ts";
import { CostStore } from "./state/stores/cost-store.ts";
import { UserMemoryStore } from "./state/stores/user-memory-store.ts";
import { banner, colors as C } from "./interfaces/cli.ts";

function registerServices(runtime: XRRuntime): void {
  const container = runtime.container;

  container.register("legacyStore", new Store());
  container.register("sessionStore", new SessionStore());
  container.register("auditStore", new AuditStore());
  container.register("memoryStore", new MemoryStore());
  container.register("costStore", new CostStore());
  container.register("userMemoryStore", new UserMemoryStore());

  const configService = new ConfigService();
  container.register("config", configService);

  const providerService = new ProviderService(container);
  container.register("providers", providerService);

  const budgetService = new BudgetService(container);
  container.register("budget", budgetService);

  const pluginService = new PluginService(container);
  container.register("plugins", pluginService);

  const mcpService = new McpService(container);
  container.register("mcp", mcpService);

  const agentService = new AgentService(container);
  container.register("agent", agentService);

  runtime.lifecycle.register(configService);
  runtime.lifecycle.register(providerService);
  runtime.lifecycle.register(budgetService);
  runtime.lifecycle.register(pluginService);
  runtime.lifecycle.register(mcpService);
  runtime.lifecycle.register(agentService);
}

function registerCommands(runtime: XRRuntime): void {
  runtime.commands.register(new RunAgentCommand());
  runtime.commands.register(new InstallCommand());
  runtime.commands.register(new OnboardingCommand());
  runtime.commands.register(new DoctorCommand());
  runtime.commands.register(new StatusCommand());
  runtime.commands.register(new RepairCommand());
  runtime.commands.register(new UpdateCommand());
  runtime.commands.register(new ResetCommand());
  runtime.commands.register(new ConfigCommand());
  runtime.commands.register(new BudgetCommand());
  runtime.commands.register(new ProvidersCommand());
  runtime.commands.register(new ModelsCommand());
  runtime.commands.register(new VoiceCommand());
  runtime.commands.register(new SpeakCommand());
  runtime.commands.register(new ListenCommand());
  runtime.commands.register(new ControlCommand());
  runtime.commands.register(new ResearchCommand());
  runtime.commands.register(new MemoryCommand());
  runtime.commands.register(new PluginsCommand());
  runtime.commands.register(new PluginRunCommand());
  runtime.commands.register(new McpCommand());
}

async function main(): Promise<void> {
  const runtime = new XRRuntime();
  registerServices(runtime);
  registerCommands(runtime);

  try {
    await runtime.bootstrap();
    await runtime.start();

    const argv = process.argv
      .slice(2)
      .filter((a) => a !== "--from-bootstrap");

    // Stage 5/6 — interactive TUI (`xr --tui`). Was previously defined but never
    // routed, so the flag fell through to the agent.
    if (argv[0] === "--tui" || argv[0] === "tui") {
      const { runTUI } = await import("./interfaces/tui.ts");
      await runTUI();
      return;
    }

    if (
      argv.length === 0 ||
      argv[0] === "help" ||
      argv[0] === "--help" ||
      argv[0] === "-h"
    ) {
      banner();
      console.log(`${C.bold("Usage")}`);
      console.log(`  xr install                setup wizard`);
      console.log(`  xr doctor                 health check (incl. memory)`);
      console.log(`  xr status                 component status`);
      console.log(`  xr --tui                  interactive terminal UI`);
      console.log(`  xr repair                 safe repair`);
      console.log(`  xr update                 update with rollback guard`);
      console.log(`  xr providers list         show all providers and keys`);
      console.log(`  xr providers set <id>     set active provider`);
      console.log(`  xr providers test         test provider health`);
      console.log(`  xr models runtimes        detect local AI runtimes`);
      console.log(`  xr models recommend       local runtime/model recommendation`);
      console.log(`  xr models install         install/configure local model with approval`);
      console.log(`  xr memory                 durable memory (status/add/list/…)`);
      console.log(`  xr plugins                discover and manage permissioned plugins`);
      console.log(`  xr voice setup            optional voice setup (push-to-talk default)`);
      console.log(`  xr voice start            talk to XR safely by voice`);
      console.log(`  xr speak <text>           speak text once`);
      console.log(`  xr listen                 listen once and print transcript`);
      console.log(`  xr control setup          desktop control prerequisites`);
      console.log(`  xr research setup         research prerequisites`);
      console.log(`  xr "your task"            run a task`);
      return;
    }

    const commandName = argv[0];
    const args = argv.slice(1);
    if (runtime.commands.get(commandName))
      await runtime.executeCommand(commandName, args, process.cwd());
    else await runtime.executeCommand("run", argv, process.cwd());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(C.red("fatal:"), msg);
    if (process.env.XR_DEBUG === "1") console.error(e);
    process.exit(1);
  } finally {
    await runtime.shutdown();
    const c = runtime.container;
    for (const name of [
      "legacyStore",
      "sessionStore",
      "auditStore",
      "memoryStore",
      "costStore",
      "userMemoryStore",
    ]) {
      try {
        c.resolve<{ close(): void }>(name).close();
      } catch {}
    }
  }
}

main();
