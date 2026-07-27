/**
 * XR — Core Service Providers
 *
 * Each provider owns one subsystem and is the single place that knows how to
 * construct and register its services. XRApp runs them in order during
 * bootstrap (and re-runs the workspace-scoped ones on workspace switch).
 *
 * Adding a future stage (memory engine, research, plugin marketplace, …) is
 * purely additive: write a provider here and register it via XRApp.use().
 * The bootstrap sequence in app.ts never needs to change.
 *
 * Providers reference service implementations directly, but the token/type
 * plumbing in ./app.ts and ./tokens.ts is imported as types only, so there is
 * no runtime import cycle back into the core bootstrap.
 *
 * XR 4.0: Providers now declare `kernelScope` metadata for diagnostics.
 */

import type { ProviderContext, ServiceProvider } from "./app.ts";
import { Tokens } from "./tokens.ts";

import { WorkspaceStore } from "../state/workspace-store.ts";
import { SessionRepo } from "../state/repos/session-repo.ts";
import { AuditRepo } from "../state/repos/audit-repo.ts";
import { CostRepo } from "../state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import { SkillRepo } from "../state/repos/skill-repo.ts";
import { WorkflowRepo } from "../state/repos/workflow-repo.ts";

import { ConfigService } from "../services/config-service.ts";
import { ProviderService } from "../services/provider-service.ts";
import { BudgetService } from "../services/budget-service.ts";
import { PluginService } from "../services/plugin-service.ts";
import { McpService } from "../services/mcp-service.ts";
import { SkillService } from "../services/skill-service.ts";
import { AgentService } from "../services/agent-service.ts";
import { MultiAgentService } from "../services/multi-agent-service.ts";
import { IntelligenceService } from "../intelligence/service.ts";
import { ContextService } from "../context/service.ts";
import { CapabilityService } from "../capabilities/service.ts";

import { XRShieldService } from "../security/shield.ts";
import { BusinessOS } from "../business/index.ts";
import { ExecutionService } from "../execution/service.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../execution/repository.ts";

// XR 4.2 — Trust & Isolation.
import { TrustService } from "../trust/service.ts";
import { CredentialBroker } from "../trust/credentials.ts";
import { AuthorityRegistry } from "../trust/authority.ts";
import { EnvironmentManager } from "../trust/environment/manager.ts";
import { InProcessBackend } from "../trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../trust/environment/namespace.ts";
import { ContainerBackend } from "../trust/environment/container.ts";

// XR 6.1 — Enterprise Trust & Operations.
import { EnterpriseService } from "../enterprise/index.ts";

/**
 * State layer: opens exactly one WorkspaceStore for the active workspace and
 * registers it (plus its backward-compat alias) and the typed repos that are
 * views over that single connection.
 *
 * Workspace-scoped: re-run on switch to rebind store + repos to the new DB.
 */
export class StateServiceProvider implements ServiceProvider {
  readonly id = "state";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    const activeWorkspace = ctx.app.workspaces.getActiveContext();
    const store = new WorkspaceStore(activeWorkspace.id, activeWorkspace.dbPath);

    // One unified store; LegacyStore is the same instance for back-compat.
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

    // Repos are typed views over the single connection.
    ctx.registry.registerValue(Tokens.SessionStore, new SessionRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.AuditStore, new AuditRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.CostStore, new CostRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.UserMemoryStore, new UserMemoryRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.SkillStore, new SkillRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
    ctx.registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store), {
      kernelScope: "workspace",
      owner: "state",
    });
  }
}

/** Configuration service — no collaborators. */
export class ConfigServiceProvider implements ServiceProvider {
  readonly id = "config";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Config,
      () => new ConfigService(),
      { lifecycle: true, dependsOn: [], kernelScope: "process", owner: "config" },
    );
  }
}

/** LLM provider service — depends on config. */
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

/**
 * XR 4.4 — Universal Intelligence Plane.
 * Capability catalog, candidate filtering, explainable routing, fallback policy.
 * Degraded catalog state must not mark XR core unhealthy — reported via detail.
 */
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

/**
 * Budget service — depends on the cost repo (resolved in its constructor).
 * Workspace-scoped so it rebinds to the new cost repo after a switch.
 */
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

/** Plugin service — depends on config and the store. */
export class PluginServiceProvider implements ServiceProvider {
  readonly id = "plugins";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Plugins,
      (registry) => new PluginService(registry),
      { lifecycle: true, dependsOn: [Tokens.Config, Tokens.Store], kernelScope: "process", owner: "plugins" },
    );
  }
}

/** MCP service — depends on the store. */
export class McpServiceProvider implements ServiceProvider {
  readonly id = "mcp";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Mcp,
      (registry) => new McpService(registry),
      { lifecycle: true, dependsOn: [Tokens.Store], kernelScope: "process", owner: "mcp" },
    );
  }
}

/** Skill service — self-contained (manages its own marketplace store). */
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


/** XR 5.2 — Capability Ecosystem service. Workspace-scoped because descriptors
 * include workspace-owned plugin/MCP/workflow state, but it does not own those
 * registries. */
export class CapabilityServiceProvider implements ServiceProvider {
  readonly id = "capabilities";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Capabilities,
      (registry) => {
        const store = registry.resolve(Tokens.Store);
        const config = registry.resolve(Tokens.Config).get();
        return new CapabilityService(store, config);
      },
      {
        lifecycle: true,
        dependsOn: [Tokens.Store, Tokens.Config],
        kernelScope: "workspace",
        owner: "capabilities",
      },
    );
  }
}

/**
 * Agent service — the composition root of the reasoning-action loop; depends
 * on most domain services and the state repos.
 */
export class AgentServiceProvider implements ServiceProvider {
  readonly id = "agent";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Agent,
      (registry) => new AgentService(registry),
      {
        lifecycle: true,
        dependsOn: [
          Tokens.Config,
          Tokens.Providers,
          Tokens.Budget,
          Tokens.Plugins,
          Tokens.Mcp,
          Tokens.Skills,
          Tokens.SessionStore,
          Tokens.UserMemoryStore,
          Tokens.CostStore,
          Tokens.AuditStore,
          Tokens.Store,
          Tokens.Execution,
        ],
        kernelScope: "workspace",
        owner: "agent",
      },
    );
  }
}

/** Multi-agent supervisor runtime — depends on stores, events, and the agent. */
export class MultiAgentServiceProvider implements ServiceProvider {
  readonly id = "multi-agents";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.MultiAgents,
      (registry) => new MultiAgentService(registry),
      {
        lifecycle: true,
        dependsOn: [
          Tokens.Store,
          Tokens.AuditStore,
          Tokens.WorkflowStore,
          Tokens.Events,
          Tokens.Agent,
        ],
        kernelScope: "workspace",
        owner: "multi-agents",
      },
    );
  }
}

/**
 * Security shield — bound to the store and participates in lifecycle so scans
 * and state persistence follow the same onInit/onStart/onStop contract as the
 * rest of the runtime. Workspace-scoped so it rebinds after a switch.
 */
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

/**
 * XR 4.2 — Trust & Isolation. Process-scoped (backends/broker/registry are
 * host-level, not workspace-level). Its onInit detects which local isolation
 * backends are actually usable (bubblewrap/userns/container) so high-risk
 * placement decisions are grounded in reality and can FAIL CLOSED. Authority
 * grants remain ephemeral and workspace-tagged; the ExecutionService consumes
 * this service to admit/verify/clean high-risk actions.
 */
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

/**
 * Execution Fabric — the canonical execution service. Workspace-scoped so
 * that its repository rebinds to the active workspace store on switch.
 * Depends on the audit repo (for correlation) and, in XR 4.2, on the Trust &
 * Isolation service (for risk-tiered placement). Available to agent, control,
 * MCP, plugin, skill, research, and business services.
 */
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
        return new ExecutionService({
          repo,
          trust,
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

/**
 * XR 4.5 — Knowledge and Context OS. Workspace-scoped so the context
 * repository, grants, and provenance ledger rebind to the active workspace
 * store on switch (cross-workspace contamination is impossible by construction).
 *
 * Depends on Store (schema + items) and Intelligence (embedding/reranking model
 * selection — this service NEVER selects a provider itself).
 */
export class ContextServiceProvider implements ServiceProvider {
  readonly id = "context";
  readonly workspaceScoped = true;

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Context,
      (registry) => {
        const store = registry.resolve(Tokens.Store);
        return new ContextService(registry, store);
      },
      {
        lifecycle: true,
        dependsOn: [Tokens.Store, Tokens.Intelligence],
        kernelScope: "workspace",
        owner: "context",
      },
    );
  }
}

/**
 * Business OS — bound to the store. Registered unconditionally (so the
 * `xr business` command can inspect/init it even when disabled), but
 * initialized and added to the lifecycle only when config enables it.
 * Workspace-scoped so it rebinds to the new store after a switch.
 */
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

/**
 * XR 6.1 — Enterprise Trust & Operations.
 *
 * Composes all Phase 12 services (policy, authority, audit export, SLO,
 * incident response, vulnerability disclosure, supply-chain response,
 * release channels, backup/DR, deployment diagnostics, security assessment,
 * governance) into a single EnterpriseService facade.
 *
 * Process-scoped because enterprise policies and operational state are
 * deployment-wide, not workspace-scoped. Local deployments retain full
 * autonomy — enterprise features are additive.
 */
export class EnterpriseServiceProvider implements ServiceProvider {
  readonly id = "enterprise";

  register(ctx: ProviderContext): void {
    const config = ctx.registry.resolve(Tokens.Config).get();
    const profile = config.deployment?.profile ?? "personal_local";
    const version = config.version ?? "6.1.0";

    ctx.registry.registerSingleton(
      Tokens.Enterprise,
      () => new EnterpriseService({
        profile,
        currentVersion: version,
        audit: (event, detail) => {
          try {
            const audit = ctx.registry.resolve(Tokens.AuditStore);
            audit.audit(event, detail, null);
          } catch {
            /* best-effort */
          }
        },
      }),
      {
        lifecycle: true,
        dependsOn: [Tokens.Config, Tokens.AuditStore],
        kernelScope: "process",
        owner: "enterprise",
      },
    );
  }
}
