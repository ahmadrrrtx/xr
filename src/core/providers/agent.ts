/** Provider: agent — the AgentService composition root of the reasoning loop. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { AgentService } from "../../services/agent-service.ts";

export class AgentServiceProvider implements ServiceProvider {
  readonly id = "agent";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Agent,
      (registry) => new AgentService(registry),
      {
        lifecycle: true,
        dependsOn: [
          Tokens.Config,
          Tokens.Providers,
          Tokens.Budget,
          Tokens.Plugins,
          Tokens.Mcp,
          Tokens.Skills,
          Tokens.SessionStore,
          Tokens.UserMemoryStore,
          Tokens.CostStore,
          Tokens.AuditStore,
          Tokens.Store,
          Tokens.Execution,
        ],
        kernelScope: "workspace",
        owner: "agent",
      },
    );
  }
}
