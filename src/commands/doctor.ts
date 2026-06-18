/**
 * XR — Doctor Command
 * Stage 2 health check backed by the installation subsystem.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { printStatus } from "../install/system.ts";

export class DoctorCommand implements Command {
  name = "doctor";
  description = "system health, dependency and audit check";
  usage = "xr doctor [--network] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    await printStatus(ctx.args);
  }
}
