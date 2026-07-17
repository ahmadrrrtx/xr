/** XR Stage 2 — command adapters for the installation subsystem. */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/workspace-store.ts";
import { installComponent, printStatus, repairXR, resetXR, runInstallWizard, updateXR } from "../install/system.ts";

function legacyStore(ctx: CommandContext): Store {
  try {
    return ctx.container.resolve<Store>("legacyStore");
  } catch {
    return new Store();
  }
}

export class InstallCommand implements Command {
  name = "install";
  description = "run the XR installation/setup wizard";
  usage = "xr install [--mode minimal|local|byok|hybrid|full] [--yes] [--allow-system]";
  async execute(ctx: CommandContext): Promise<void> { await runInstallWizard(ctx.args); }
}

export class OnboardingCommand implements Command {
  name = "onboarding";
  description = "guided first-launch onboarding wizard";
  usage = "xr onboarding";
  async execute(): Promise<void> {
    const { runOnboarding } = await import("../interfaces/onboard.ts");
    await runOnboarding();
  }
}

export class StatusCommand implements Command {
  name = "status";
  description = "show XR installation and component status";
  usage = "xr status [--json] [--network]";
  async execute(ctx: CommandContext): Promise<void> { await printStatus(ctx.args); }
}

export class RepairCommand implements Command {
  name = "repair";
  description = "repair config, permissions and dependencies safely";
  usage = "xr repair [--yes] [--network]";
  async execute(ctx: CommandContext): Promise<void> { await repairXR(ctx.args); }
}

export class UpdateCommand implements Command {
  name = "update";
  description = "update XR with config backup and rollback guard";
  usage = "xr update [--yes]";
  async execute(ctx: CommandContext): Promise<void> { await updateXR(ctx.args); }
}

export class ResetCommand implements Command {
  name = "reset";
  description = "reset XR config/database after writing backups";
  usage = "xr reset [--hard] [--yes]";
  async execute(ctx: CommandContext): Promise<void> { await resetXR(ctx.args); }
}

export class ModelsCommand implements Command {
  name = "models";
  description = "local models: status, list, set, install, test (change model anytime)";
  usage = "xr models [status|list|runtimes|recommend|install|remove|set|test]";
  async execute(ctx: CommandContext): Promise<void> {
    const { handleModelsCommand } = await import("../interfaces/models.ts");
    await handleModelsCommand(ctx.args);
  }
}

export class VoiceCommand implements Command {
  name = "voice";
  description = "voice status/setup/start/test";
  usage = "xr voice [setup|status|devices|test|start|stop|config]";
  async execute(ctx: CommandContext): Promise<void> {
    const { handleVoiceCommand } = await import("../voice/cli.ts");
    await handleVoiceCommand(ctx.args, legacyStore(ctx));
  }
}

export class SpeakCommand implements Command {
  name = "speak";
  description = "speak text once using XR voice TTS";
  usage = "xr speak <text>";
  async execute(ctx: CommandContext): Promise<void> {
    const { handleSpeak } = await import("../voice/cli.ts");
    await handleSpeak(ctx.args.join(" "));
  }
}

export class ListenCommand implements Command {
  name = "listen";
  description = "listen once and print the transcript";
  usage = "xr listen";
  async execute(): Promise<void> {
    const { handleListen } = await import("../voice/cli.ts");
    await handleListen();
  }
}

export class ControlCommand implements Command {
  name = "control";
  description = "safe desktop/browser control and setup";
  usage = "xr control [setup|status|browser|start|stop|plan|...]";
  async execute(ctx: CommandContext): Promise<void> {
    if (ctx.args[0] === "setup") return await installComponent("control", { yes: ctx.args.includes("--yes"), allowSystem: ctx.args.includes("--allow-system") });
    const { handleControlCommand } = await import("../control/cli.ts");
    await handleControlCommand(ctx.args, legacyStore(ctx));
  }
}

export class ResearchCommand implements Command {
  name = "research";
  description = "research mode and setup";
  usage = "xr research [setup|plan|quick|deep|status|...]";
  async execute(ctx: CommandContext): Promise<void> {
    if (ctx.args[0] === "setup") return await installComponent("research", { yes: ctx.args.includes("--yes"), network: ctx.args.includes("--network") });
    const { handleResearchCommand } = await import("../research/cli.ts");
    await handleResearchCommand(ctx.args, legacyStore(ctx));
  }
}
