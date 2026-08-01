/** Provider: capabilities — capability ecosystem service (workspace-scoped). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { CapabilityService } from "../../platform/capabilities/service.ts";

export class CapabilityServiceProvider implements ServiceProvider {
  readonly id = "capabilities";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Capabilities,
      (registry) => {
        const store = registry.resolve(Tokens.Store);
        const config = registry.resolve(Tokens.Config).get();
        return new CapabilityService(store, config);
      },
      {
        lifecycle: true,
        dependsOn: [Tokens.Store, Tokens.Config],
        kernelScope: "workspace",
        owner: "capabilities",
      },
    );
  }
}
