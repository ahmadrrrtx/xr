/**
 * XR — XRApp bootstrap (kernel v2)
 *
 * Replaces the hand-written DI in src/core/kernel.ts. Now the kernel:
 *   - builds a typed ServiceRegistry (Container v2)
 *   - registers ONE WorkspaceStore (unified storage; no dual-DB drift)
 *   - registers each subsystem as a Module with lifecycle hooks
 *   - switchWorkspace swaps the SINGLE store (all repos follow)
 *
 * This is the permanent foundation Stage 1+ builds on.
 */

import { ServiceRegistry, type Module } from "./container.ts";
import { LifecycleManager, RuntimeState } from "./lifecycle.ts";
import { EventBus } from "./event-bus.ts";
import { WorkspaceManager, type WorkspaceContext } from "./workspace.ts";
import { WorkspaceStore } from "../state/store.ts"; // proposed unified store
import { ConfigService } from "../services/config-service.ts";
import { ProviderService } from "../services/provider-service.ts";
import { bootstrapProviders } from "../providers/factory.ts"; // explicit, no import-time side effects

export class XRApp {
  readonly services = new ServiceRegistry();
  readonly lifecycle = new LifecycleManager();
  readonly bus = new EventBus();
  private ws = new WorkspaceManager();

  constructor(private opts: { workspaceId?: string } = {}) {}

  private storeFor(ctx: WorkspaceContext): WorkspaceStore {
    return new WorkspaceStore(ctx.id, ctx.dbPath);
  }

  async bootstrap(): Promise<void> {
    const active = this.ws.getActiveContext();
    const store = this.storeFor(active);

    // ---- Core infrastructure ----
    this.services.register("store", store);
    this.services.register("workspaceManager", this.ws);
    this.services.register("config", new ConfigService());
    this.services.register("providers", new ProviderService(this.services));
    // ... register memory / security / control / plugins / mcp / research /
    // voice / agents / cost / local services here, each as a Module.

    // ---- Providers: explicit bootstrap (no registerBuiltins() import side-effect) ----
    bootstrapProviders(this.services.get("providers"));

    // ---- Register modules for ordered lifecycle ----
    // this.services.registerModule(memoryModule);
    // this.services.registerModule(securityModule);
    // ...

    await this.services.initModules();
    await this.lifecycle.init();
    this.bus.emit("app.bootstrapped", { version: "3.1.5" });
  }

  async start(): Promise<void> {
    await this.services.startModules();
    await this.lifecycle.start();
    this.bus.emit("app.started", { ts: Date.now() });
  }

  async shutdown(): Promise<void> {
    await this.services.stopModules();
    await this.lifecycle.stop();
    this.services.tryGet<WorkspaceStore>("store")?.close();
  }

  /** Swap the SINGLE store; every repo follows. No dual-DB drift. */
  async switchWorkspace(id: string): Promise<void> {
    const ctx = this.ws.ensureWorkspace(id, id);
    const next = this.storeFor(ctx);
    const prev = this.services.tryGet<WorkspaceStore>("store");
    this.services.register("store", next);
    // re-point any service that cached the old store via a lifecycle hook
    await this.services.initModules();
    prev?.close();
    this.bus.emit("workspace.switched", { id });
  }

  getState(): RuntimeState {
    return this.lifecycle.getState();
  }
}
