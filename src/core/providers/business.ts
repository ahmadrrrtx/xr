/** Provider: business — Business OS (L5 extension), bound to the store. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { BusinessOS } from "../../business/index.ts";

export class BusinessServiceProvider implements ServiceProvider {
  readonly id = "business";
  readonly workspaceScoped = true;

  private instance: BusinessOS | null = null;
  private enabled = false;

  register(ctx: ProviderContext): void {
    const store = ctx.registry.resolve(Tokens.Store);
    this.instance = new BusinessOS({ db: store });
    this.enabled = this.isBusinessEnabled(ctx);
    ctx.registry.registerValue(Tokens.Business, this.instance, {
      lifecycle: this.enabled,
      dependsOn: [Tokens.Store],
      kernelScope: "workspace",
      owner: "business",
    });
  }

  async init(): Promise<void> {
    if (this.enabled && this.instance) {
      await this.instance.initialize();
    }
  }

  private isBusinessEnabled(ctx: ProviderContext): boolean {
    try {
      const config = ctx.registry.resolve(Tokens.Config);
      return config.get().business?.enabled ?? false;
    } catch {
      // Config unavailable during very early init — default to off.
      return false;
    }
  }
}
