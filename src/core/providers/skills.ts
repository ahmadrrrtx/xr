/** Provider: skills — skill service (self-contained marketplace store). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { SkillService } from "../../services/skill-service.ts";

export class SkillServiceProvider implements ServiceProvider {
  readonly id = "skills";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Skills,
      () => new SkillService(),
      { lifecycle: true, dependsOn: [], kernelScope: "process", owner: "skills" },
    );
  }
}
