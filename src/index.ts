#!/usr/bin/env bun
/**
 * XR — The AI Agent You Can Actually Trust
 * by @ahmadrrrtx
 */

import { XRRuntime } from "./core/runtime.ts";
import { Container } from "./core/container.ts";
import { RunAgentCommand } from "./commands/run-agent.ts";
import { DoctorCommand } from "./commands/doctor.ts";
import { ConfigCommand } from "./commands/config.ts";
import { BudgetCommand } from "./commands/budget.ts";
import { ConfigService } from "./services/config-service.ts";
import { ProviderService } from "./services/provider-service.ts";
import { AgentService } from "./services/agent-service.ts";
import { BudgetService } from "./services/budget-service.ts";
import { PluginService } from "./services/plugin-service.ts";
import { SessionStore } from "./state/stores/session-store.ts";
import { AuditStore } from "./state/stores/audit-store.ts";
import { MemoryStore } from "./state/stores/memory-store.ts";
import { CostStore } from "./state/stores/cost-store.ts";
import { UserMemoryStore } from "./state/stores/user-memory-store.ts";
import { banner, info, ok, warn, colors as C } from "./interfaces/cli.ts";

async function main(): Promise<void> {
  const runtime = new XRRuntime();
  const container = runtime.container;

  // 1. Register Storage Services
  container.register("sessionStore", new SessionStore());
  container.register("auditStore", new AuditStore());
  container.register("memoryStore", new MemoryStore());
  container.register("costStore", new CostStore());
  container.register("userMemoryStore", new UserMemoryStore());

  // 2. Register Core Services
  container.register("config", new ConfigService(container));
  container.register("providers", new ProviderService(container));
  container.register("budget", new BudgetService(container));
  container.register("plugins", new PluginService(container));
  container.register("agent", new AgentService(container));

  // 3. Register Commands
  runtime.commands.register(new RunAgentCommand());
  runtime.commands.register(new DoctorCommand());
  runtime.commands.register(new ConfigCommand());
  runtime.commands.register(new BudgetCommand());
  // ... other commands will be added here

  try {
    await runtime.bootstrap();
    await runtime.start();

    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      banner();
      console.log(`${C.bold("Usage")}  xr "your task"           run a task`);
      console.log(`  xr doctor                system health check`);
      return;
    }

    const commandName = argv[0];
    const args = argv.slice(1);

    // Check if it's a registered command
    if (runtime.commands.get(commandName)) {
      await runtime.executeCommand(commandName, args, process.cwd());
    } else {
      // Default to running the agent if not a known command
      await runtime.executeCommand("run", argv, process.cwd());
    }
  } catch (e) {
    console.error(C.red("fatal error during runtime execution:"), e);
    process.exit(1);
  } finally {
    await runtime.shutdown();
    // Close all stores
    container.resolve<SessionStore>("sessionStore").close();
    container.resolve<AuditStore>("auditStore").close();
    container.resolve<MemoryStore>("memoryStore").close();
    container.resolve<CostStore>("costStore").close();
    container.resolve<UserMemoryStore>("userMemoryStore").close();
  }
}

main();
