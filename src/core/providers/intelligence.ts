/** Provider: intelligence — universal intelligence plane (routing/catalog/fallback). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { IntelligenceService } from "../../intelligence/service.ts";

export class IntelligenceServiceProvider implements ServiceProvider {
  readonly id = "intelligence";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Intelligence,
      (registry) => new IntelligenceService(registry),
      {
        lifecycle: true,
        dependsOn: [Tokens.Config, Tokens.Providers],
        kernelScope: "process",
        owner: "intelligence",
      },
    );
  }
}
