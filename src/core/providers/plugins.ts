/** Provider: plugins — plugin service, depends on config + store. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { PluginService } from "../../services/plugin-service.ts";

export class PluginServiceProvider implements ServiceProvider {
  readonly id = "plugins";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Plugins,
      (registry) => new PluginService(registry),
      { lifecycle: true, dependsOn: [Tokens.Config, Tokens.Store], kernelScope: "process", owner: "plugins" },
    );
  }
}
