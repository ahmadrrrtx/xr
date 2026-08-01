/** Provider: mcp — MCP service, depends on the store. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { McpService } from "../../services/mcp-service.ts";

export class McpServiceProvider implements ServiceProvider {
  readonly id = "mcp";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Mcp,
      (registry) => new McpService(registry),
      { lifecycle: true, dependsOn: [Tokens.Store], kernelScope: "process", owner: "mcp" },
    );
  }
}
