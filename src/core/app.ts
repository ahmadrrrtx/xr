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
// Phase 3 · T1 — providers are loaded per boot profile via provider-modules
// (literal-path dynamic imports), so a command never evaluates the provider
// modules it does not boot (Commandment 11). No static import here.
import { loadDefaultProviders } from "./provider-modules.ts";
import { DEFAULT_PROVIDER_ORDER } from "./boot-profile.ts";
import { StallDetector } from "./stall-detector.ts";

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

  /** Phase 3 · T1 — narrowed to the boot profile (if any) during bootstrap. */
  private providers: ServiceProvider[] = [];
  /** Phase 3 · T3 — event-loop stall monitor (attached at start()). */
  public readonly stallDetector = new StallDetector({ events: this.events });
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
   * Bootstraps the runtime: registers the standard providers (or, with a
   * command-scoped boot profile, only the providers the command needs), runs
   * them, wires lifecycle participants in dependency order, and runs onInit.
   *
   * Storage contract: exactly one WorkspaceStore connection is opened (by the
   * state provider) and shared by every repo and service.
   *
   * Phase 3 · T1 — command-scoped boot: `opts.profile` is a provider-id list
   * (see src/core/boot-profile.ts). A command boots only the subsystems it
   * needs (Article VI · Rule 4; Commandment 11). `null`/absent = full boot.
   */
  async bootstrap(opts?: { profile?: string[] | null }): Promise<this> {
    if (this.booted) return this; // Idempotent

    // Phase 3 · T3 — async workspace state load + provisioning BEFORE any
    // provider runs, so the kernel boot path performs no synchronous
    // filesystem I/O (Article XII · Rule 4).
    await this.workspaces.load();

    if (this.providers.length === 0) {
      // Phase 3 · T1 — per-module loading: only the modules the boot will
      // actually run are evaluated (profile = subset, absent = full set).
      const want = opts?.profile;
      const order = want ? want : [...DEFAULT_PROVIDER_ORDER];
      this.providers = await loadDefaultProviders(order);
    }

    // Phase 3 · T1 — profile filter. Providers are a fixed, ordered set; a
    // profile picks the subset. Unlisted providers are NOT registered, so
    // their services cannot be resolved (fail fast, never silently missing).
    if (opts?.profile) {
      const wanted = new Set(opts.profile);
      this.providers = this.providers.filter((p) => wanted.has(p.id));
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
   * Starts long-running background services, runs onStart hooks,
   * and performs XR 4.3 startup recovery.
   * Requires bootstrap() to have completed.
   */
  async start(): Promise<this> {
    if (!this.booted) {
      throw new StartBeforeBootstrapError();
    }
    if (this.started) return this; // Idempotent

    this.registerCoreBackgroundJobs();
    await this.lifecycle.start();

    // Phase 3 · T3 — watch the event loop for stalls while the runtime is up.
    this.stallDetector.attach();

    this.started = true;
    this.events.emit(CoreEvents.KernelStarted, { timestamp: Date.now() });

    // XR 4.3 — Startup Recovery: discover and classify interrupted work
    await this.runStartupRecovery();

    return this;
  }

  /**
   * XR 4.3 — Discover unfinished work and classify recovery.
   * Runs after the runtime is started but before reporting full readiness
   * if unresolved work affects safety.
   */
  private async runStartupRecovery(): Promise<void> {
    try {
      const execService = this.registry.tryResolve(Tokens.Execution);
      if (!execService || typeof (execService as any).startupRecovery !== "function") return;

      const workspaceId = this.workspaces.getActiveId();
      const results = await (execService as any).startupRecovery(workspaceId);

      if (results && results.length > 0) {
        const resumed = results.filter((r: any) => r.recoveryState === "resumed");
        const blocked = results.filter((r: any) => r.recoveryState === "recovery_blocked");
        const pending = results.filter((r: any) => r.recoveryState === "startup_recovery_pending");

        if (blocked.length > 0 || pending.length > 0) {
          this.events.emit("recovery.pending" as any, {
            total: results.length,
            resumed: resumed.length,
            blocked: blocked.length,
            needsApproval: pending.length,
            timestamp: Date.now(),
          });
        }

        /**
         * Phase 06 · Step 36 — HONEST recovery banner. The banner reports
         * exactly what happened: discovery is not recovery. "Recovered" is
         * only claimed for executions actually resumed from a verified
         * checkpoint; everything else is reported as awaiting approval or
         * blocked (needs review).
         */
        const parts: string[] = [];
        if (resumed.length > 0) parts.push(`${resumed.length} recovered from a verified checkpoint`);
        if (pending.length > 0) parts.push(`${pending.length} awaiting approval (side-effect status unknown)`);
        if (blocked.length > 0) parts.push(`${blocked.length} blocked (needs review)`);
        const unresolved = pending.length + blocked.length;
        // eslint-disable-next-line no-console
        console.warn(
          `\n  ⚠ XR found ${results.length} interrupted execution(s) from a previous run: ` +
            `${parts.join(", ")}. ` +
            (unresolved > 0
              ? `Run \`xr status\` or \`xr execution --recovery\` for details.\n`
              : `Details: \`xr status\`.\n`),
        );
      }
    } catch (err) {
      // Startup recovery is best-effort — never prevent the runtime from starting.
      this.events.emit("recovery.failed" as any, {
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Gracefully shuts the runtime down: interrupts active execution work,
   * stops background jobs, runs onStop hooks in reverse dependency order,
   * and closes the unified store.
   */
  async shutdown(): Promise<this> {
    // XR 4.3 — Mark active executions as interrupted before stopping services
    const execService = this.registry.tryResolve(Tokens.Execution);
    if (execService && typeof (execService as any).onStop === "function") {
      try {
        await (execService as any).onStop();
      } catch {
        /* best-effort */
      }
    }

    // Phase 3 · T3 — stop the stall monitor first so shutdown work is not
    // measured as a stall.
    this.stallDetector.detach();

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
   * Phase 3 · T1 — the provider ids this runtime booted under. Empty before
   * bootstrap; the full default set when no profile was used. Used by the
   * boot-profile tests and the boot trace.
   */
  bootedProviderIds(): string[] {
    return this.providers.map((p) => p.id);
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

    // XR 4.3 — Recovery health
    let recoveryPending = 0;
    let recoveryBlocked = 0;
    try {
      const execService = this.registry.tryResolve(Tokens.Execution);
      if (execService && typeof (execService as any).getRecoveryPending === "function") {
        const pending = (execService as any).getRecoveryPending(this.workspaces.getActiveId());
        recoveryPending = pending.filter((r: any) => r.recoveryState === "startup_recovery_pending" || r.safeToResume).length;
        recoveryBlocked = pending.filter((r: any) => r.recoveryState === "recovery_blocked").length;
      }
    } catch {
      // best-effort
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
      recovery: {
        pending: recoveryPending,
        blocked: recoveryBlocked,
      },
    });
  }

  // ── Default provider set ────────────────────────────────────────────────
  // Phase 3 · T1: the default set is loaded per boot profile from
  // src/core/provider-modules.ts (see bootstrap()). `use()` remains the
  // programmatic composition API for tests and embedders.

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

    // Phase 1 (T2): WAL maintenance — periodic checkpoint(RESTART) so the WAL
    // stays bounded. RESTART only succeeds when no readers are attached; the
    // store falls back to TRUNCATE internally.
    this.backgroundServices.registerJob({
      id: "wal_maintenance",
      name: "WAL Checkpoint Maintenance",
      intervalMs: 900000, // every 15 minutes
      owner: "xr.kernel",
      restartOnWorkspaceSwitch: true,
      run: async () => {
        try {
          const store = this.registry.resolve(Tokens.Store);
          const result = store.checkpointWal("RESTART");
          if (!result.ok) {
            this.events.emit("wal.checkpoint_failed" as any, {
              detail: result.detail,
              timestamp: Date.now(),
            });
          }
        } catch {
          /* best-effort maintenance */
        }
      },
    });

    /**
     * Phase 06 · Steps 31–33 — checkpoint pruning scheduler (daily).
     *
     * Design constraints honored:
     *   - runs at most once per PRUNE_INTERVAL_MS even though the job ticks
     *     hourly (last-run timestamp lives in durable maintenance metadata,
     *     so restarts neither repeat nor forget the schedule);
     *   - only deletes eligible checkpoints of TERMINATED executions past
     *     retention; unresolved work and unacknowledged cancellations are
     *     protected inside pruneDetailed();
     *   - bounded batch (1000 rows per run);
     *   - never blocks startup (first tick happens on the interval, and the
     *     due-check makes the immediate post-boot tick a fast no-op);
     *   - a failed prune records the failure and never crashes the runtime;
     *   - structured observability: prune started/completed/failed events +
     *     tamper-evident audit entry with counts (never payloads).
     */
    const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
    const PRUNE_TICK_MS = 60 * 60 * 1000; // hourly due-check
    this.backgroundServices.registerJob({
      id: "checkpoint_pruner",
      name: "Durable-Execution Checkpoint Pruner (daily)",
      intervalMs: PRUNE_TICK_MS,
      owner: "xr.kernel",
      restartOnWorkspaceSwitch: true,
      run: async () => {
        try {
          const execService = this.registry.tryResolve(Tokens.Execution);
          if (!execService) return; // execution fabric not booted in this profile
          const checkpoints = execService.checkpoints;

          const lastRaw = checkpoints.getMaintenanceMeta("checkpoint_prune_last_at");
          const lastAt = lastRaw ? Number.parseInt(lastRaw, 10) : Number.NaN;
          if (Number.isFinite(lastAt) && Date.now() - lastAt < PRUNE_INTERVAL_MS) {
            return; // not due yet — fast no-op
          }

          this.events.emit("checkpoint.prune_started" as any, { timestamp: Date.now() });
          const result = checkpoints.pruneDetailed();
          checkpoints.setMaintenanceMeta("checkpoint_prune_last_at", String(Date.now()));

          const detail = {
            deleted: result.deleted,
            durationMs: result.durationMs,
            ok: !result.error,
            ...(result.error ? { error: result.error.slice(0, 200) } : {}),
          };
          try {
            const audit = this.registry.tryResolve(Tokens.AuditStore);
            audit?.audit(result.error ? "checkpoint.prune_failed" : "checkpoint.prune_completed", detail);
          } catch {
            /* audit is best-effort; pruning observability must not fail pruning */
          }
          this.events.emit((result.error ? "checkpoint.prune_failed" : "checkpoint.prune_completed") as any, {
            ...detail,
            timestamp: Date.now(),
          });
        } catch {
          /* a broken scheduler must never take down the runtime */
        }
      },
    });
  }
}
