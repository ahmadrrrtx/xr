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

import { XRShieldService } from "../security/shield.ts";
import { BusinessOS } from "../business/index.ts";

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
    ctx.registry.registerValue(Tokens.Store, store, { description: "unified workspace store" });
    ctx.registry.registerValue(Tokens.LegacyStore, store, {
      description: "alias of Store (back-compat)",
    });

    // Repos are typed views over the single connection.
    ctx.registry.registerValue(Tokens.SessionStore, new SessionRepo(store));
    ctx.registry.registerValue(Tokens.AuditStore, new AuditRepo(store));
    ctx.registry.registerValue(Tokens.CostStore, new CostRepo(store));
    ctx.registry.registerValue(Tokens.UserMemoryStore, new UserMemoryRepo(store));
    ctx.registry.registerValue(Tokens.SkillStore, new SkillRepo(store));
    ctx.registry.registerValue(Tokens.WorkflowStore, new WorkflowRepo(store));
  }
}

/** Configuration service — no collaborators. */
export class ConfigServiceProvider implements ServiceProvider {
  readonly id = "config";

  register(ctx: ProviderContext): void {
    ctx.registry.registerSingleton(
      Tokens.Config,
      () => new ConfigService(),
      { lifecycle: true, dependsOn: [] },
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
      { lifecycle: true, dependsOn: [Tokens.Config] },
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
      { lifecycle: true, dependsOn: [Tokens.CostStore] },
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
      { lifecycle: true, dependsOn: [Tokens.Config, Tokens.Store] },
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
      { lifecycle: true, dependsOn: [Tokens.Store] },
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
      { lifecycle: true, dependsOn: [] },
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
        ],
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
    });
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
