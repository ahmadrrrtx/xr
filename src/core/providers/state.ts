/** Provider: state — one unified WorkspaceStore + typed repos (workspace-scoped). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { WorkspaceStore } from "../../state/workspace-store.ts";
import { SessionRepo } from "../../state/repos/session-repo.ts";
import { AuditRepo } from "../../state/repos/audit-repo.ts";
import { CostRepo } from "../../state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../../state/repos/user-memory-repo.ts";
import { SkillRepo } from "../../state/repos/skill-repo.ts";
import { WorkflowRepo } from "../../state/repos/workflow-repo.ts";

export class StateServiceProvider implements ServiceProvider {
  readonly id = "state";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    const activeWorkspace = ctx.app.workspaces.getActiveContext();
    const store = new WorkspaceStore(activeWorkspace.id, activeWorkspace.dbPath);

    ctx.registry.registerValue(Tokens.Store, store, {
      description: "unified workspace store",
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.LegacyStore, store, {
      description: "alias of Store (back-compat)",
      kernelScope: "workspace",
      owner: "state",
    });

    ctx.registry.registerValue(Tokens.SessionStore, new SessionRepo(store), { kernelScope: "workspace", owner: "state" });
    ctx.registry.registerValue(Tokens.AuditStore, new AuditRepo(store), { kernelScope: "workspace", owner: "state" });
    ctx.registry.registerValue(Tokens.CostStore, new CostRepo(store), { kernelScope: "workspace", owner: "state" });
    ctx.registry.registerValue(Tokens.UserMemoryStore, new UserMemoryRepo(store), { kernelScope: "workspace", owner: "state" });
    ctx.registry.registerValue(Tokens.SkillStore, new SkillRepo(store), { kernelScope: "workspace", owner: "state" });
    ctx.registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store), { kernelScope: "workspace", owner: "state" });
  }
}
