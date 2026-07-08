#!/usr/bin/env bun
/**
 * XR — The AI OS Kernel Bootstrap
 * Stage 16: Coherent AI Operating System Core
 */

import { XRKernel } from "./core/kernel.ts";
import { RunAgentCommand } from "./commands/run-agent.ts";
import { DoctorCommand } from "./commands/doctor.ts";
import { ConfigCommand } from "./commands/config.ts";
import { BudgetCommand } from "./commands/budget.ts";
import { ProvidersCommand } from "./commands/providers.ts";
import { MemoryCommand } from "./commands/memory.ts";
import { PluginsCommand, PluginRunCommand } from "./commands/plugins.ts";
import { McpCommand } from "./commands/mcp.ts";
import { WorkspaceCommand } from "./commands/workspace.ts";
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
import { banner, colors as C } from "./interfaces/cli.ts";
import { AgentsCommand } from "./commands/agents.ts";
import { SkillsCommand, SkillsAliasCommand } from "./commands/skills.ts";
import { ShieldCommand } from "./commands/shield.ts";

function registerCommands(kernel: XRKernel): void {
  kernel.commands.register(new RunAgentCommand());
  kernel.commands.register(new InstallCommand());
  kernel.commands.register(new OnboardingCommand());
  kernel.commands.register(new DoctorCommand());
  kernel.commands.register(new StatusCommand());
  kernel.commands.register(new RepairCommand());
  kernel.commands.register(new UpdateCommand());
  kernel.commands.register(new ResetCommand());
  kernel.commands.register(new ConfigCommand());
  kernel.commands.register(new BudgetCommand());
  kernel.commands.register(new ProvidersCommand());
  kernel.commands.register(new ModelsCommand());
  kernel.commands.register(new VoiceCommand());
  kernel.commands.register(new SpeakCommand());
  kernel.commands.register(new ListenCommand());
  kernel.commands.register(new ControlCommand());
  kernel.commands.register(new ResearchCommand());
  kernel.commands.register(new MemoryCommand());
  kernel.commands.register(new PluginsCommand());
  kernel.commands.register(new PluginRunCommand());
  kernel.commands.register(new McpCommand());
  kernel.commands.register(new SkillsCommand());
  kernel.commands.register(new SkillsAliasCommand());
  kernel.commands.register(new AgentsCommand());
  kernel.commands.register(new ShieldCommand());
  kernel.commands.register(new WorkspaceCommand());
}

async function main(): Promise<void> {
  const kernel = new XRKernel();
  
  // Register commands directly in kernel commands registry
  registerCommands(kernel);

  try {
    // Bootstrap & start full OS kernel
    await kernel.bootstrap();
    await kernel.start();

    const argv = process.argv
      .slice(2)
      .filter((a) => a !== "--from-bootstrap");

    // Interactive TUI router
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
      console.log(`  xr workspace              manage isolated workspaces (list/create/use/delete)`);
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
      console.log(`  xr skill browse           XR Skills Marketplace`);
      console.log(`  xr skill install <id>     install/enable a professional Skill`);
      console.log(`  xr agents                 multi-agent supervisor runtime`);
      console.log(`  xr voice setup            optional voice setup (push-to-talk default)`);
      console.log(`  xr voice start            talk to XR safely by voice`);
      console.log(`  xr speak <text>           speak text once`);
      console.log(`  xr listen                 listen once and print transcript`);
      console.log(`  xr control setup          desktop control prerequisites`);
      console.log(`  xr research setup         research prerequisites`);
      console.log(`  xr shield                 AI-powered Security & Privacy layer`);
      console.log(`  xr "your task"            run a task`);
      return;
    }

    const commandName = argv[0];
    const args = argv.slice(1);
    
    if (kernel.commands.get(commandName)) {
      await kernel.executeCommand(commandName, args, process.cwd());
    } else {
      await kernel.executeCommand("run", argv, process.cwd());
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(C.red("fatal:"), msg);
    if (process.env.XR_DEBUG === "1") console.error(e);
    process.exit(1);
  } finally {
    // Graceful kernel shutdown sequence
    await kernel.shutdown();
  }
}

main();
