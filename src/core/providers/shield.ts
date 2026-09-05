/** Provider: shield — security shield bound to the unified store. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { XRShieldService } from "../../hygiene/scanner.ts";

export class ShieldServiceProvider implements ServiceProvider {
  readonly id = "shield";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    const store = ctx.registry.resolve(Tokens.Store);
    ctx.registry.registerValue(Tokens.Shield, new XRShieldService(store), {
      lifecycle: true,
      dependsOn: [Tokens.Store],
      kernelScope: "workspace",
      owner: "shield",
    });
  }
}
