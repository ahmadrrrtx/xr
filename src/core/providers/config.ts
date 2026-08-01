/** Provider: config — configuration service, no collaborators. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { ConfigService } from "../../services/config-service.ts";

export class ConfigServiceProvider implements ServiceProvider {
  readonly id = "config";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Config,
      () => new ConfigService(),
      { lifecycle: true, dependsOn: [], kernelScope: "process", owner: "config" },
    );
  }
}
