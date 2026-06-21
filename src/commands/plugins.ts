/** XR Stage 10 — plugin command registry adapters. */
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/db.ts";
import { handlePluginsCommand } from "../plugins/cli.ts";

function resolveStore(ctx: CommandContext): Store {
  try {
    return ctx.container.resolve<Store>("legacyStore");
  } catch {
    return new Store();
  }
}

export class PluginsCommand implements Command {
  name = "plugins";
  description = "discover, inspect, install, enable, disable, update, and remove XR plugins";
  usage = "xr plugins [list|search|install|inspect|enable|disable|remove|update|permissions|status]";

  async execute(ctx: CommandContext): Promise<void> {
    await handlePluginsCommand(ctx.args, resolveStore(ctx));
  }
}

/** Shorthand: `xr plugin <id> <command> ...` == `xr plugins run <id> <command> ...`. */
export class PluginRunCommand implements Command {
  name = "plugin";
  description = "run a command contributed by an enabled plugin";
  usage = "xr plugin <plugin-id> <command> [args...]";

  async execute(ctx: CommandContext): Promise<void> {
    await handlePluginsCommand(["run", ...ctx.args], resolveStore(ctx));
  }
}
