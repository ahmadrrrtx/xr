/** Provider: trust — trust & isolation service with environment backends. */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { TrustService } from "../../runtime/trust/service.ts";
import { CredentialBroker } from "../../runtime/trust/credentials.ts";
import { AuthorityRegistry } from "../../runtime/trust/authority.ts";
import { EnvironmentManager } from "../../runtime/trust/environment/manager.ts";
import { InProcessBackend } from "../../runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../../runtime/trust/environment/namespace.ts";
import { ContainerBackend } from "../../runtime/trust/environment/container.ts";

export class TrustServiceProvider implements ServiceProvider {
  readonly id = "trust";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Trust,
      () => {
        const broker = new CredentialBroker();
        const registry = new AuthorityRegistry();
        const manager = new EnvironmentManager(
          [
            new InProcessBackend(),
            new RestrictedProcessBackend(),
            new NamespaceSandboxBackend(),
            new ContainerBackend(),
          ],
          broker,
        );
        return new TrustService({ manager, registry, broker });
      },
      {
        lifecycle: true,
        dependsOn: [],
        kernelScope: "process",
        owner: "trust",
      },
    );
  }
}
