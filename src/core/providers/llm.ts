/** Provider: providers (LLM provider plane) — depends on config. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { ProviderService } from "../../services/provider-service.ts";

export class LlmServiceProvider implements ServiceProvider {
  readonly id = "providers";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Providers,
      (registry) => new ProviderService(registry),
      { lifecycle: true, dependsOn: [Tokens.Config], kernelScope: "process", owner: "providers" },
    );
  }
}
