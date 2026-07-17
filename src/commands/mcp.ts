/**
 * XR Stage 11 — MCP Command
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/workspace-store.ts";
import { handleMcpCommand } from "../mcp/cli.ts";

/** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
function resolveStore(ctx: CommandContext): Store {
  return ctx.container.resolve<Store>("store");
}

export class McpCommand implements Command {
  name = "mcp";
  description = "MCP Platform — discover, register, inspect, enable, and use Model Context Protocol servers";
  usage = "xr mcp [list|add|remove|enable|disable|inspect|tools|resources|prompts|health|search|doctor]";

  async execute(ctx: CommandContext): Promise<void> {
    await handleMcpCommand(ctx.args, resolveStore(ctx));
  }
}
