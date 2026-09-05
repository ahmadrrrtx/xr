/** Provider: state — one unified WorkspaceStore + typed repos (workspace-scoped). */
import type { ProviderContext, ServiceProvider } from "../app.ts";
import { Tokens } from "../tokens.ts";
import { WorkspaceStore, auditKeyingEnabledOnBoot } from "../../state/workspace-store.ts";
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

    // Phase 4 (F-08): establish the per-install Ed25519 audit signing key on
    // the real boot path. Idempotent + race-safe. Unit-test suites set
    // XR_AUDIT_NO_AUTOKEY=1 via the test preload, so constructors stay
    // side-effect-free and audit-count assertions remain exact; the
    // black-box/e2e suites cover the real keying path.
    if (auditKeyingEnabledOnBoot()) {
      try {
        store.provisionAuditKeying("boot");
      } catch {
        /* keying is best-effort at boot; verify --crypto reports the honest
           "key unavailable" state and the chain still appends. */
      }
    }

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
