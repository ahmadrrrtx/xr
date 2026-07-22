/**
 * XR 4.0 — XRApp (Runtime Composition Root)
 *
 * The single, canonical entry point for bringing the XR runtime online.
 * XRApp owns the typed ServiceRegistry, the event bus, the command registry,
 * the lifecycle manager, the workspace manager, and the background-service
 * manager — and it orchestrates them through a deterministic, dependency-
 * ordered bootstrap → start → shutdown sequence.
 *
 * Service wiring is declarative, not imperative. Each subsystem is a
 * ServiceProvider that registers its own services and declares their
 * dependencies. XRApp simply:
 *
 *   1. runs every provider's register() (in order) to populate the registry;
 *   2. derives the lifecycle participant set from the registry in dependency
 *      order (no manual lifecycle.register() bookkeeping);
 *   3. drives onInit → onStart → onStop through the LifecycleManager.
 *
 * XR 4.0 Runtime Kernel additions:
 *   - Explicit lifecycle state machine (via RuntimeState)
 *   - Deterministic bootstrap/start/shutdown guards
 *   - Workspace switch safety (failure recovery, state tracking)
 *   - Kernel health and diagnostics
 *   - Structured kernel errors
 *   - Background service ownership
 *   - Partial-failure cleanup
 *
 * XRKernel (./kernel.ts) is a thin backward-compatible facade over XRApp so
 * existing consumers keep working unchanged.
 */

import { ServiceRegistry } from "./service-registry.ts";
import { CoreEvents, EventBus } from "./event-bus.ts";
import { CommandRegistry, type CommandContext } from "./command-registry.ts";
import { LifecycleManager, RuntimeState } from "./lifecycle.ts";
import { WorkspaceManager } from "./workspace.ts";
import { BackgroundServiceManager } from "./services.ts";
import { Tokens } from "./tokens.ts";
import { CORE_VERSION, PKG, versionInfo } from "./version.ts";
import {
  buildHealthSnapshot,
  type KernelHealth,
  type ServiceHealthEntry,
  type BackgroundJobHealthEntry,
  type WorkspaceHealthEntry,
} from "./health.ts";
import {
  StartBeforeBootstrapError,
  DuplicateStartError,
  ShutdownBeforeBootstrapError,
  WorkspaceSwitchFailedError,
  WorkspaceNotFoundError,
  RuntimeFailedError,
  ProviderRegistrationFailedError,
  ProviderInitFailedError,
} from "./errors.ts";
// Static import is cycle-free: providers.ts only imports *types* from this
// module (erased at compile time), so there is no runtime back-edge.
import {
  StateServiceProvider,
  ConfigServiceProvider,
  LlmServiceProvider,
  BudgetServiceProvider,
  PluginServiceProvider,
  McpServiceProvider,
  SkillServiceProvider,
  ExecutionServiceProvider,
  AgentServiceProvider,
  MultiAgentServiceProvider,
  ShieldServiceProvider,
  BusinessServiceProvider,
} from "./providers.ts";

/**
 * Context handed to a ServiceProvider. Providers register services into the
 * typed registry and may read workspace/app state to construct them.
 */
export interface ProviderContext {
  readonly registry: ServiceRegistry;
  readonly app: XRApp;
}

/**
 * Extensibility point for the runtime. A provider owns one subsystem and is
 * the only place that knows how to construct and register its services.
 *
 *   • register() — synchronously register tokens into the registry.
 *   • init()     — optional async initialization (e.g. conditional table setup).
 *   • workspaceScoped — when true, the provider is re-run on workspace switch
 *     so workspace-bound resources (store, repos, store-backed services) are
 *     rebound to the new workspace.
 */
export interface ServiceProvider {
  readonly id: string;
  register(ctx: ProviderContext): void;
  init?(ctx: ProviderContext): Promise<void>;
  readonly workspaceScoped?: boolean;
}

export class XRApp {
  /** Canonical version identity (single source of truth lives in version.ts). */
  public static readonly PKG = PKG;
  public static readonly CORE_VERSION = CORE_VERSION;

  public readonly registry = new ServiceRegistry();
  public readonly events = new EventBus();
  public readonly commands = new CommandRegistry();
  public readonly lifecycle = new LifecycleManager(this.events, this.registry);
  public readonly workspaces = new WorkspaceManager();
  public readonly backgroundServices: BackgroundServiceManager;

  private readonly providers: ServiceProvider[] = [];
  private booted = false;
  private started = false;
  /** Tracks the last workspace switch error for health reporting. */
  private lastWorkspaceSwitchError?: { from: string; to: string; step: string; error: string };

  constructor() {
    this.backgroundServices = new BackgroundServiceManager(this.events);
    this.registerInfrastructure();
  }

  /**
   * Add a service provider. Providers are run in insertion order during
   * bootstrap, so callers control the construction order by the order in
   * which they call use(). The standard provider set is registered by
   * registerDefaultProviders() (invoked from bootstrap() unless overridden).
   */
  use(provider: ServiceProvider): this {
    this.providers.push(provider);
    return this;
  }

  /**
   * Bootstraps the full runtime: registers the standard providers, runs them,
   * wires lifecycle participants in dependency order, and runs onInit.
   *
   * Storage contract: exactly one WorkspaceStore connection is opened (by the
   * state provider) and shared by every repo and service.
   */
  async bootstrap(): Promise<this> {
    if (this.booted) return this; // Idempotent

    if (this.providers.length === 0) {
      this.registerDefaultProviders();
    }

    const ctx = this.providerContext();

    // 1. Registration pass — populate the registry in construction order.
    try {
      for (const provider of this.providers) {
        provider.register(ctx);
      }
    } catch (error) {
      this.events.emit(CoreEvents.KernelFailed, {
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
      throw new ProviderRegistrationFailedError(
        "unknown",
        error instanceof Error ? error : undefined,
      );
    }

    // 2. Async init pass — optional, in provider order.
    for (const provider of this.providers) {
      if (provider.init) {
        try {
          await provider.init(ctx);
        } catch (error) {
          this.events.emit(CoreEvents.KernelFailed, {
            error: `Provider "${provider.id}" init failed: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: Date.now(),
          });
          throw new ProviderInitFailedError(
            provider.id,
            error instanceof Error ? error : undefined,
          );
        }
      }
    }

    // 3. Lifecycle wiring — derive participants from the registry in
    //    dependency order and feed them to the LifecycleManager.
    const lifecycleHooks = this.registry.lifecycleParticipants();
    this.lifecycle.setParticipants(lifecycleHooks);

    await this.lifecycle.init();

    this.booted = true;
    this.events.emit(CoreEvents.KernelBootstrapped, { ...versionInfo(), timestamp: Date.now() });
    return this;
  }

  /**
   * Starts long-running background services and runs onStart hooks.
   * Requires bootstrap() to have completed.
   */
  async start(): Promise<this> {
    if (!this.booted) {
      throw new StartBeforeBootstrapError();
    }
    if (this.started) return this; // Idempotent

    this.registerCoreBackgroundJobs();
    await this.lifecycle.start();

    this.started = true;
    this.events.emit(CoreEvents.KernelStarted, { timestamp: Date.now() });
    return this;
  }

  /**
   * Gracefully shuts the runtime down: stops background jobs, runs onStop
   * hooks in reverse dependency order, and closes the unified store.
   */
  async shutdown(): Promise<this> {
    // Best-effort: stop even if not fully booted.
    this.backgroundServices.stopAll();
    try {
      await this.lifecycle.stop();
    } catch {
      /* best-effort stop */
    }
    this.events.emit(CoreEvents.KernelStopped, { timestamp: Date.now() });

    // Close the single unified database connection.
    const store = this.registry.tryResolve(Tokens.Store);
    if (store) {
      try {
        store.close();
      } catch {
        /* best-effort close — never crash shutdown */
      }
    }

    this.started = false;
    this.booted = false;
    return this;
  }

  /**
   * Switches the active workspace scope and rebinds workspace-bound resources
   * to a fresh, isolated store.
   *
   * XR 4.0: Full error handling with failure recovery. If the switch fails
   * midway, the runtime enters FAILED state and the error is recorded.
   * Old workspace data is preserved; the runtime does not silently use a
   * partially-rebound workspace.
   */
  async switchWorkspace(id: string): Promise<this> {
    const fromId = this.workspaces.getActiveId();

    this.events.emit(CoreEvents.WorkspaceSwitching, {
      from: fromId,
      to: id,
      timestamp: Date.now(),
    });

    // Enter switching state (validates transition).
    try {
      this.lifecycle.enterWorkspaceSwitch();
    } catch (error) {
      const err = new WorkspaceSwitchFailedError(fromId, id, "state transition", error instanceof Error ? error : undefined);
      this.lastWorkspaceSwitchError = { from: fromId, to: id, step: "state_transition", error: err.message };
      this.events.emit(CoreEvents.WorkspaceSwitchFailed, {
        from: fromId, to: id, error: err.message, step: "state_transition", timestamp: Date.now(),
      });
      throw err;
    }

    // Step 1: Stop background work against the outgoing store.
    try {
      this.backgroundServices.stopWorkspaceJobs(fromId);
    } catch (error) {
      this.handleWorkspaceSwitchFailure(fromId, id, "stop_background_jobs", error);
    }

    // Step 2: Get the old store reference BEFORE marking stale.
    const oldStore = this.registry.tryResolve(Tokens.Store);

    // Step 3: Mark workspace-scoped services as stale (prevents use of old resources).
    this.registry.markWorkspaceScopedStale();

    // Step 4: Close the outgoing unified store.
    if (oldStore) {
      try {
        oldStore.close();
      } catch {
        /* best-effort — the store may already be closed */
      }
    }

    // Step 4: Activate the new workspace.
    try {
      this.workspaces.setActiveId(id);
    } catch (error) {
      this.handleWorkspaceSwitchFailure(fromId, id, "activate_workspace", error);
    }

    // Step 5: Re-run workspace-scoped providers (store, repos, store-backed services).
    try {
      this.registry.beginRebinding();
      const ctx = this.providerContext();
      for (const provider of this.providers) {
        if (!provider.workspaceScoped) continue;
        provider.register(ctx);
      }
      for (const provider of this.providers) {
        if (!provider.workspaceScoped) continue;
        if (provider.init) await provider.init(ctx);
      }
      this.registry.endRebinding();
    } catch (error) {
      this.registry.endRebinding();
      this.handleWorkspaceSwitchFailure(fromId, id, "rebind_providers", error);
    }

    // Step 6: Refresh lifecycle participants so workspace-scoped replacements are
    //    the instances that will receive future onStop calls.
    try {
      this.lifecycle.setParticipants(this.registry.lifecycleParticipants());
    } catch (error) {
      this.handleWorkspaceSwitchFailure(fromId, id, "refresh_lifecycle", error);
    }

    // Step 7: Resume background work against the new store.
    try {
      this.backgroundServices.setCurrentWorkspace(id);
      this.backgroundServices.startWorkspaceJobs(id);
    } catch (error) {
      this.handleWorkspaceSwitchFailure(fromId, id, "start_background_jobs", error);
    }

    // Success — exit switching state.
    this.lifecycle.exitWorkspaceSwitch(true);
    this.lastWorkspaceSwitchError = undefined;

    this.events.emit(CoreEvents.WorkspaceSwitched, { active: id, timestamp: Date.now() });
    return this;
  }

  /**
   * Execute a registered CLI/TUI command.
   */
  async executeCommand(name: string, args: string[], cwd: string): Promise<void> {
    const commandContext: CommandContext = {
      registry: this.registry,
      args,
      cwd,
    };
    await this.commands.run(name, args, commandContext);
  }

  // ── Health & Diagnostics ────────────────────────────────────────────────

  /**
   * Get the current lifecycle state.
   */
  getState(): RuntimeState {
    return this.lifecycle.getState();
  }

  /**
   * Whether the runtime is fully operational.
   */
  isReady(): boolean {
    return this.lifecycle.isOperational();
  }

  /**
   * Whether the runtime has been bootstrapped.
   */
  isBootstrapped(): boolean {
    return this.booted;
  }

  /**
   * Whether the runtime has been started.
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Build a kernel health snapshot. This is a pure, cheap operation that
   * reads current state without mutating anything.
   */
  getHealth(): KernelHealth {
    const state = this.lifecycle.getState();

    // Build service health entries from registry inspection.
    const serviceEntries: ServiceHealthEntry[] = this.registry.inspectionSnapshot().map((entry) => {
      let readiness: ServiceHealthEntry["readiness"];
      if (entry.stale) {
        readiness = "failed"; // stale = unusable
      } else if (entry.resolved || entry.scope === "value") {
        readiness = "ready";
      } else if (this.registry.has({ id: entry.id } as any)) {
        readiness = "pending"; // registered but not yet resolved
      } else {
        readiness = "not_registered";
      }
      return {
        id: entry.id,
        description: entry.description,
        readiness,
        scope: entry.kernelScope ?? entry.scope,
        lifecycle: entry.lifecycle,
        resolved: entry.resolved,
      };
    });

    // Build background job health.
    const jobEntries: BackgroundJobHealthEntry[] = this.backgroundServices.listJobs().map((job) => ({
      id: job.id,
      name: job.name,
      active: job.active,
      intervalMs: job.intervalMs,
      owner: job.owner,
      workspaceId: job.workspaceId,
      failureCount: job.failureCount,
    }));

    // Workspace health.
    const store = this.registry.tryResolve(Tokens.Store);
    const workspace: WorkspaceHealthEntry = {
      activeId: this.workspaces.getActiveId(),
      storeOpen: !!store,
      connectionCount: store ? 1 : 0,
      dbPath: store?.dbPath,
    };

    // Collect errors.
    const errors: Array<{ service?: string; detail?: string }> = [];
    if (this.lastWorkspaceSwitchError) {
      errors.push({
        service: "workspace.switch",
        detail: `${this.lastWorkspaceSwitchError.from} → ${this.lastWorkspaceSwitchError.to}: ${this.lastWorkspaceSwitchError.error}`,
      });
    }
    for (const result of this.lifecycle.getHookResults()) {
      if (!result.success) {
        errors.push({ service: result.service, detail: result.error });
      }
    }

    return buildHealthSnapshot({
      runtimeState: state,
      bootstrapped: this.booted,
      started: this.started,
      version: {
        version: PKG.version,
        codename: PKG.codename,
        display: `${PKG.version} (${PKG.codename})`,
      },
      services: serviceEntries,
      backgroundJobs: jobEntries,
      workspace,
      errors: errors.length ? errors : undefined,
    });
  }

  // ── Default provider set ────────────────────────────────────────────────

  /**
   * Registers the standard XR provider set in construction order. Order
   * matters because some services resolve collaborators in their constructor.
   * Override (clear + use(...)) to customize the runtime composition.
   */
  protected registerDefaultProviders(): void {
    this.use(new StateServiceProvider());
    this.use(new ConfigServiceProvider());
    this.use(new LlmServiceProvider());
    this.use(new BudgetServiceProvider());
    this.use(new PluginServiceProvider());
    this.use(new McpServiceProvider());
    this.use(new SkillServiceProvider());
    this.use(new ExecutionServiceProvider());
    this.use(new AgentServiceProvider());
    this.use(new MultiAgentServiceProvider());
    this.use(new ShieldServiceProvider());
    this.use(new BusinessServiceProvider());
  }

  /** Registers the infra services XRApp itself owns. */
  private registerInfrastructure(): void {
    this.registry.registerValue(Tokens.App, this, { description: "XR runtime application" });
    this.registry.registerValue(Tokens.Registry, this.registry);
    this.registry.registerValue(Tokens.Events, this.events);
    this.registry.registerValue(Tokens.Commands, this.commands);
    this.registry.registerValue(Tokens.Lifecycle, this.lifecycle);
    this.registry.registerValue(Tokens.Workspaces, this.workspaces);
    this.registry.registerValue(Tokens.BackgroundServices, this.backgroundServices, {
      lifecycle: true,
      dependsOn: [Tokens.Shield, Tokens.Budget, Tokens.Store],
      description: "background service / job manager",
    });
  }

  private providerContext(): ProviderContext {
    return { registry: this.registry, app: this };
  }

  /**
   * Handle workspace switch failure: record the error, emit event,
   * mark lifecycle as failed.
   */
  private handleWorkspaceSwitchFailure(
    from: string,
    to: string,
    step: string,
    error: unknown,
  ): never {
    const msg = error instanceof Error ? error.message : String(error);
    this.lastWorkspaceSwitchError = { from, to, step, error: msg };
    this.lifecycle.exitWorkspaceSwitch(false);
    this.events.emit(CoreEvents.WorkspaceSwitchFailed, {
      from, to, error: msg, step, timestamp: Date.now(),
    });
    throw new WorkspaceSwitchFailedError(from, to, step, error instanceof Error ? error : undefined);
  }

  /**
   * Registers the default OS background maintenance & monitor routines.
   * Each job resolves its collaborators lazily through typed tokens, so a job
   * never holds a stale reference after a workspace switch.
   */
  private registerCoreBackgroundJobs(): void {
    // 1. Security monitor — quick shield scan every 30s.
    this.backgroundServices.registerJob({
      id: "security_monitor",
      name: "Shield Security Threat and Lolbins Monitor",
      intervalMs: 30000,
      owner: "xr.kernel",
      restartOnWorkspaceSwitch: true,
      run: async () => {
        try {
          const shield = this.registry.resolve(Tokens.Shield);
          const threats = await shield.runScan("quick");
          if (threats.length > 0) {
            this.events.emit(CoreEvents.SecurityThreatsDetected, { threats, timestamp: Date.now() });
          }
        } catch {
          /* best-effort monitor — never crash the job loop */
        }
      },
    });

    // 2. Budget governor — spend guard every 10s.
    this.backgroundServices.registerJob({
      id: "budget_checker",
      name: "Spend Governor and Budget Safety Guard",
      intervalMs: 10000,
      owner: "xr.kernel",
      restartOnWorkspaceSwitch: true,
      run: async () => {
        try {
          const budget = this.registry.resolve(Tokens.Budget);
          const status = budget.getStatus();
          if (status.isOverBudget) {
            this.events.emit(CoreEvents.BudgetOverLimit, { status, timestamp: Date.now() });
          }
        } catch {
          /* best-effort */
        }
      },
    });

    // 3. Memory pruner — expiry loop every 5 minutes.
    this.backgroundServices.registerJob({
      id: "memory_pruner",
      name: "Durable Memory Expiry & Pruner",
      intervalMs: 300000,
      owner: "xr.kernel",
      restartOnWorkspaceSwitch: true,
      run: async () => {
        try {
          const store = this.registry.resolve(Tokens.Store);
          const pruned = store.pruneExpiredMemory();
          if (pruned > 0) {
            this.events.emit(CoreEvents.MemoryPruned, { pruned, timestamp: Date.now() });
          }
        } catch {
          /* best-effort */
        }
      },
    });
  }
}
