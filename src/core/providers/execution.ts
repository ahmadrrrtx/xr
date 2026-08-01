/** Provider: execution — canonical execution fabric (workspace-scoped). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { ExecutionService } from "../../execution/service.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../execution/repository.ts";
import { IdempotencyStore } from "../../state/idempotency.ts";

export class ExecutionServiceProvider implements ServiceProvider {
  readonly id = "execution";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Execution,
      (registry) => {
        const store = registry.resolve(Tokens.Store);
        const audit = registry.resolve(Tokens.AuditStore);
        const trust = registry.resolve(Tokens.Trust);
        const repo = new ExecutionRepo(adaptWorkspaceStore(store));
        const idempotency = new IdempotencyStore(store);
        return new ExecutionService({
          repo,
          trust,
          idempotency,
          audit: (event, detail) => {
            try {
              audit.audit(event, detail, null);
            } catch {
              /* best-effort */
            }
          },
        });
      },
      {
        lifecycle: true,
        dependsOn: [Tokens.Store, Tokens.AuditStore, Tokens.Trust],
        kernelScope: "workspace",
        owner: "execution",
      },
    );
  }
}
