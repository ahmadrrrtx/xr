/** Provider: multi-agents — multi-agent supervisor runtime. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { MultiAgentService } from "../../services/multi-agent-service.ts";

export class MultiAgentServiceProvider implements ServiceProvider {
  readonly id = "multi-agents";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.MultiAgents,
      (registry) => new MultiAgentService(registry),
      {
        lifecycle: true,
        dependsOn: [
          Tokens.Store,
          Tokens.AuditStore,
          Tokens.WorkflowStore,
          Tokens.Events,
          Tokens.Agent,
        ],
        kernelScope: "workspace",
        owner: "multi-agents",
      },
    );
  }
}
