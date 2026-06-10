/**
 * XR — Config Command
 * Manage application configuration.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { ConfigService } from "../services/config-service.ts";
import { colors as C } from "../interfaces/cli.ts";

export class ConfigCommand implements Command {
  name = "config";
  description = "view current configuration";

  async execute(ctx: CommandContext): Promise<void> {
    const { container } = ctx;
    const configService = container.resolve<ConfigService>("config");
    console.log(`${C.bold("Config path:")} ${C.dim(configService.getPath())}\n`);
    console.log(JSON.stringify(configService.get(), null, 2));
  }
}
