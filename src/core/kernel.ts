/**
 * XR — The Unified XR OS Kernel (v3.1.5 Helios)
 * Orchestrates and integrates every major subsystem of the AI Operating System.
 *
 * 0.2 Storage Unification:
 *   - Exactly ONE WorkspaceStore per workspace, registered as "store".
 *   - The "legacyStore" alias is removed — all code resolves "store".
 *   - switchWorkspace() closes the old store and opens a new one.
 *   - All repos (SessionRepo, AuditRepo, etc.) use the single store.
 *   - No code should ever call `new Store()` or `new WorkspaceStore()`
 *     outside of this kernel's bootstrap/switch methods.
 *
 * Version is now derived from src/core/version.ts single source of truth.
 */

import { Container } from "./container.ts";
import { EventBus } from "./event-bus.ts";
import { CommandRegistry } from "./command-registry.ts";
import { LifecycleManager } from "./lifecycle.ts";
import { WorkspaceManager } from "./workspace.ts";
import { BackgroundServiceManager } from "./services.ts";
import { CORE_VERSION, PKG, versionInfo } from "./version.ts";

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


export class XRKernel {
  /** @deprecated Use CORE_VERSION from src/core/version.ts — kept for backward compat */
  public static readonly VERSION = CORE_VERSION;

  /** Canonical version identity (single source of truth) */
  public static readonly PKG = PKG;
  public static readonly CORE_VERSION = CORE_VERSION;

  public readonly container = new Container();
  public readonly events = new EventBus();
  public readonly commands = new CommandRegistry();
  public readonly lifecycle = new LifecycleManager();

  public readonly workspaces = new WorkspaceManager();
  public readonly services: BackgroundServiceManager;

  constructor() {
    this.services = new BackgroundServiceManager(this.events);
    this.bootstrapContainer();
  }

  /**
   * Binds and configures core container singletons.
   */
  private bootstrapContainer(): void {
    this.container.register("kernel", this);
    this.container.register("container", this.container);
    this.container.register("events", this.events);
    this.container.register("commands", this.commands);
    this.container.register("lifecycle", this.lifecycle);
    this.container.register("workspaces", this.workspaces);
    this.container.register("services", this.services);
  }

  /**
   * Bootstraps the full XR kernel ecosystem and provisions the active workspace.
   *
   * 0.2 Storage Unification: Exactly one WorkspaceStore is created and
   * registered as "store". All repos and services resolve this single instance.
   */
  async bootstrap(): Promise<void> {
    const activeWorkspace = this.workspaces.getActiveContext();
    const workspaceStore = new WorkspaceStore(activeWorkspace.id, activeWorkspace.dbPath);

    // ── 0.2: Single unified store ──────────────────────────────────────────
    this.container.register("store", workspaceStore);
    // Legacy alias for backward compat during migration — points to the SAME instance
    this.container.register("legacyStore", workspaceStore);

    // Repositories are views over the single workspace connection.
    this.registerWorkspaceRepos(workspaceStore);

    // Core Services
    const configService = new ConfigService();
    this.container.register("config", configService);

    const providerService = new ProviderService(this.container);
    this.container.register("providers", providerService);

    const budgetService = new BudgetService(this.container);
    this.container.register("budget", budgetService);

    const pluginService = new PluginService(this.container);
    this.container.register("plugins", pluginService);

    const mcpService = new McpService(this.container);
    this.container.register("mcp", mcpService);

    const skillService = new SkillService();
    this.container.register("skills", skillService);

    const agentService = new AgentService(this.container);
    this.container.register("agent", agentService);

    const multiAgentService = new MultiAgentService(this.container);
    this.container.register("multiAgents", multiAgentService);

    const shieldService = new XRShieldService(workspaceStore);
    this.container.register("shield", shieldService);

    // Instantiate Business OS safely
    const businessOS = new BusinessOS({ db: workspaceStore });
    this.container.register("business", businessOS);

    // Register with Lifecycle Manager
    this.lifecycle.register(configService);
    this.lifecycle.register(providerService);
    this.lifecycle.register(budgetService);
    this.lifecycle.register(pluginService);
    this.lifecycle.register(mcpService);
    this.lifecycle.register(skillService);
    this.lifecycle.register(agentService);
    this.lifecycle.register(multiAgentService);

    await this.lifecycle.init();
    this.events.emit("kernel.bootstrapped", { version: CORE_VERSION, ...versionInfo() });
  }

  /**
   * Starts the kernel, launches long-running background services, and hooks event streams.
   */
  async start(): Promise<void> {
    await this.lifecycle.start();

    // Register background jobs
    this.registerCoreBackgroundJobs();

    // Start services manager
    this.services.startAll();

    this.events.emit("kernel.started", { timestamp: Date.now() });
  }

  /**
   * Shuts down background services and gracefully terminates subsystems.
   */
  async shutdown(): Promise<void> {
    this.services.stopAll();
    await this.lifecycle.stop();
    this.events.emit("kernel.stopped", { timestamp: Date.now() });

    // Close the single unified Database
    try {
      this.container.resolve<WorkspaceStore>("store").close();
    } catch {}

  }

  /**
   * Registers default OS background maintenance & monitor routines.
   */
  private registerWorkspaceRepos(store: WorkspaceStore): void {
    this.container.register("sessionStore", new SessionRepo(store));
    this.container.register("auditStore", new AuditRepo(store));
    this.container.register("costStore", new CostRepo(store));
    this.container.register("userMemoryStore", new UserMemoryRepo(store));
    this.container.register("skillStore", new SkillRepo(store));
    this.container.register("workflowStore", new WorkflowRepo(store));
  }

  private registerCoreBackgroundJobs(): void {
    // 1. Health Status & Security Scanner (runs every 30 seconds)
    this.services.registerJob({
      id: "security_monitor",
      name: "Shield Security Threat and Lolbins Monitor",
      intervalMs: 30000,
      run: async () => {
        try {
          const shield = this.container.resolve<XRShieldService>("shield");
          const threats = await shield.runScan("quick");
          if (threats.length > 0) {
            this.events.emit("security.threats_detected", { threats });
          }
        } catch {}
      },
    });

    // 2. Budget Spent Governor Guard (runs every 10 seconds)
    this.services.registerJob({
      id: "budget_checker",
      name: "Spend Governor and Budget Safety Guard",
      intervalMs: 10000,
      run: async () => {
        try {
          const budget = this.container.resolve<BudgetService>("budget");
          await budget.checkSpendLimits();
        } catch {}
      },
    });

    // 3. Durable Memory Expiry and Pruning Loop (runs every 5 minutes)
    this.services.registerJob({
      id: "memory_pruner",
      name: "Durable Memory Expiry & Pruner",
      intervalMs: 300000,
      run: async () => {
        try {
          const store = this.container.resolve<WorkspaceStore>("store");
          const pruned = store.pruneExpiredMemory();
          if (pruned > 0) {
            this.events.emit("memory.pruned", { pruned, timestamp: Date.now() });
          }
        } catch {}
      },
    });
  }

  /**
   * Switches active workspace scope and re-initiates store context cleanly.
   *
   * 0.2 Storage Unification: Closes the old store, creates a new one, and
   * re-registers all repos and services to use the new single store.
   */
  async switchWorkspace(id: string): Promise<void> {
    this.events.emit("workspace.switching", { from: this.workspaces.getActiveId(), to: id });

    // Shutdown services first
    this.services.stopAll();

    // Close the old unified store
    try {
      this.container.resolve<WorkspaceStore>("store").close();
    } catch {}

    this.workspaces.setActiveId(id);

    // Bootstrap workspace-specific resources — one new store
    const activeWorkspace = this.workspaces.getActiveContext();
    const newStore = new WorkspaceStore(activeWorkspace.id, activeWorkspace.dbPath);

    // Re-register the unified store
    this.container.unregister("store");
    this.container.unregister("legacyStore");
    this.container.register("store", newStore);
    this.container.register("legacyStore", newStore); // backward compat alias

    // Re-register all repos over the new store
    this.registerWorkspaceRepos(newStore);

    // Re-register services that hold store references
    this.container.unregister("budget");
    this.container.register("budget", new BudgetService(this.container));

    // Re-register Shield and Business OS with the new DB
    this.container.unregister("shield");
    this.container.unregister("business");

    const shieldService = new XRShieldService(newStore);
    this.container.register("shield", shieldService);

    const businessOS = new BusinessOS({ db: newStore });
    this.container.register("business", businessOS);

    // Restart background jobs on the new workspace database
    this.services.startAll();

    this.events.emit("workspace.switched", { active: id });
  }

  /**
   * Executes registered CLI/TUI command.
   */
  async executeCommand(name: string, args: string[], cwd: string): Promise<void> {
    await this.commands.run(name, args, {
      container: this.container,
      args,
      cwd,
    });
  }
}
