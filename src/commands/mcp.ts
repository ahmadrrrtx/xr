/**
 * XR Stage 11 — MCP Command
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/db.ts";
import { handleMcpCommand } from "../mcp/cli.ts";

function resolveStore(ctx: CommandContext): Store {
  try {
    return ctx.container.resolve<Store>("legacyStore");
  } catch {
    return new Store();
  }
}

export class McpCommand implements Command {
  name = "mcp";
  description = "MCP Platform — discover, register, inspect, enable, and use Model Context Protocol servers";
  usage = "xr mcp [list|add|remove|enable|disable|inspect|tools|resources|prompts|health|search|doctor]";

  async execute(ctx: CommandContext): Promise<void> {
    await handleMcpCommand(ctx.args, resolveStore(ctx));
  }
}
