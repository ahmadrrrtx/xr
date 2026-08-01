/** Provider: budget — spend governor, workspace-scoped (rebinds to cost repo). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { BudgetService } from "../../services/budget-service.ts";

export class BudgetServiceProvider implements ServiceProvider {
  readonly id = "budget";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Budget,
      (registry) => new BudgetService(registry),
      { lifecycle: true, dependsOn: [Tokens.CostStore], kernelScope: "workspace", owner: "budget" },
    );
  }
}
