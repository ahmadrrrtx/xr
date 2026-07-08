/**
 * XR 3.0 — The Unified XR OS Kernel
 * Orchestrates and integrates every major subsystem of the AI Operating System.
 */

import { Container } from "./container.ts";
import { EventBus } from "./event-bus.ts";
import { CommandRegistry } from "./command-registry.ts";
import { LifecycleManager, RuntimeState } from "./lifecycle.ts";
import { WorkspaceManager } from "./workspace.ts";
import { BackgroundServiceManager } from "./services.ts";

import { Store } from "../state/db.ts";
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

import { SessionStore } from "../state/stores/session-store.ts";
import { AuditStore } from "../state/stores/audit-store.ts";
import { MemoryStore } from "../state/stores/memory-store.ts";
import { CostStore } from "../state/stores/cost-store.ts";
import { UserMemoryStore } from "../state/stores/user-memory-store.ts";
import { WorkflowStore } from "../state/stores/workflow-store.ts";

export class XRKernel {
  public static readonly VERSION = "3.0.0";
  
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
   */
  async bootstrap(): Promise<void> {
    const activeWorkspace = this.workspaces.getActiveContext();
    const workspaceStore = new Store(activeWorkspace.dbPath);

    // Core Stores
    this.container.register("legacyStore", workspaceStore);
    this.container.register("store", workspaceStore);

    // Specialized Stores for backward compatibility
    this.container.register("sessionStore", new SessionStore());
    this.container.register("auditStore", new AuditStore(activeWorkspace.dbPath));
    this.container.register("memoryStore", new MemoryStore());
    this.container.register("costStore", new CostStore());
    this.container.register("userMemoryStore", new UserMemoryStore());
    this.container.register("workflowStore", new WorkflowStore(activeWorkspace.dbPath));

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
    this.events.emit("kernel.bootstrapped", { version: XRKernel.VERSION });
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
    
    // Close Database & Specialized Stores
    try {
      this.container.resolve<Store>("store").close();
    } catch {}

    for (const name of [
      "sessionStore",
      "auditStore",
      "memoryStore",
      "costStore",
      "userMemoryStore",
      "workflowStore",
    ]) {
      try {
        this.container.resolve<{ close(): void }>(name).close();
      } catch {}
    }
  }

  /**
   * Registers default OS background maintenance & monitor routines.
   */
  private registerCoreBackgroundJobs(): void {
    // 1. Health Status & Security Scanner (runs every 30 seconds)
    this.services.registerJob({
      id: "security_monitor",
      name: "Shield Security Threat and Lolbins Monitor",
      intervalMs: 30000,
      run: async () => {
        try {
          const shield = this.container.resolve<XRShieldService>("shield");
          const threats = shield.runScan("quick");
          if (threats.length > 0) {
            this.events.emit("security.threats_detected", { threats });
          }
        } catch {}
      }
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
      }
    });

    // 3. Durable Memory Expiry and Pruning Loop (runs every 5 minutes)
    this.services.registerJob({
      id: "memory_pruner",
      name: "Durable Memory Expiry & Pruner",
      intervalMs: 300000,
      run: async () => {
        try {
          const store = this.container.resolve<Store>("store");
          const pruned = store.pruneExpiredMemory();
          if (pruned > 0) {
            this.events.emit("memory.pruned", { pruned, timestamp: Date.now() });
          }
        } catch {}
      }
    });
  }

  /**
   * Switches active workspace scope and re-initiates store context cleanly.
   */
  async switchWorkspace(id: string): Promise<void> {
    this.events.emit("workspace.switching", { from: this.workspaces.getActiveId(), to: id });
    
    // Shutdown services first
    this.services.stopAll();
    
    // Unregister current DB
    try {
      this.container.resolve<Store>("store").close();
    } catch {}
    
    this.workspaces.setActiveId(id);
    
    // Bootstrap workspace-specific resources
    const activeWorkspace = this.workspaces.getActiveContext();
    const newStore = new Store(activeWorkspace.dbPath);
    
    this.container.unregister("legacyStore");
    this.container.unregister("store");
    this.container.register("legacyStore", newStore);
    this.container.register("store", newStore);

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
