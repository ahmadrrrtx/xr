/** XR Stage 10 — plugin command registry adapters. */
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/workspace-store.ts";
import { handlePluginsCommand } from "../plugins/cli.ts";

/**
 * 0.2 Storage Unification: Resolve the single workspace store from the
 * container. Never creates a new Store() as a fallback.
 */
function resolveStore(ctx: CommandContext): Store {
  return ctx.container.resolve<Store>("store");
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
