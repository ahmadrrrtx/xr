/** Provider: context — knowledge & context OS (workspace-scoped). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { ContextService } from "../../context/service.ts";

export class ContextServiceProvider implements ServiceProvider {
  readonly id = "context";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Context,
      (registry) => {
        const store = registry.resolve(Tokens.Store);
        return new ContextService(registry, store);
      },
      {
        lifecycle: true,
        dependsOn: [Tokens.Store, Tokens.Intelligence],
        kernelScope: "workspace",
        owner: "context",
      },
    );
  }
}
