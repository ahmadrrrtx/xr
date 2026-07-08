#!/usr/bin/env bun
/**
 * XR 3.1 — product shell bootstrap
 *
 * UX changes:
 *  - `xr` now opens the dedicated fullscreen TUI by default
 *  - `xr help`, `xr serve`, and `xr --version` are fast paths
 *  - the heavy kernel only boots when a command actually needs it
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
import { colors as C } from "./interfaces/cli.ts";
import { AgentsCommand } from "./commands/agents.ts";
import { SkillsCommand, SkillsAliasCommand } from "./commands/skills.ts";
import { ShieldCommand } from "./commands/shield.ts";
import { showHelp } from "./commands/help.ts";
import { serve } from "./daemon/server.ts";

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
      try { handle.stop(); } catch {}
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--from-bootstrap");
  const head = argv[0];

  try {
    // Fast paths — no kernel boot required.
    if (!head || head === "--tui" || head === "tui") {
      const { runTUI } = await import("./interfaces/tui.ts");
      await runTUI();
      return;
    }

    if (head === "--version" || head === "-v" || head === "version") {
      console.log("v3.1.3");
      return;
    }

    if (head === "help" || head === "--help" || head === "-h") {
      showHelp(argv[1]);
      return;
    }

    if (head === "serve") {
      await runServeCommand(argv.slice(1));
      return;
    }

    const kernel = new XRKernel();
    registerCommands(kernel);
    await kernel.bootstrap();
    await kernel.start();

    try {
      const commandName = argv[0];
      const args = argv.slice(1);
      if (commandName && kernel.commands.get(commandName)) {
        await kernel.executeCommand(commandName, args, process.cwd());
      } else {
        await kernel.executeCommand("run", argv, process.cwd());
      }
    } finally {
      await kernel.shutdown();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(C.red("fatal:"), msg);
    if (process.env.XR_DEBUG === "1") console.error(e);
    process.exit(1);
  }
}

main();
