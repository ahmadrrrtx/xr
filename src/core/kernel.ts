/**
 * XR 4.0 — XRKernel (Backward-Compatible Facade over XRApp)
 *
 * XRApp (./app.ts) is the real runtime bootstrap engine. XRKernel remains as
 * a thin, stable facade so existing consumers — the CLI router, the workspace
 * command, and the hermetic kernel tests — keep working unchanged while all
 * wiring flows through XRApp and the typed ServiceRegistry.
 *
 * New code should depend on XRApp / ServiceRegistry / Tokens directly. This
 * class exists to make the Phase 1 stabilization a non-breaking migration.
 *
 * Version identity is the single source of truth in src/core/version.ts.
 *
 * XR 4.0: Forwards new health, lifecycle state, and diagnostic methods.
 */

import { XRApp } from "./app.ts";
import { ServiceRegistry } from "./service-registry.ts";
import { EventBus } from "./event-bus.ts";
import { CommandRegistry } from "./command-registry.ts";
import { LifecycleManager, RuntimeState } from "./lifecycle.ts";
import { WorkspaceManager } from "./workspace.ts";
import { BackgroundServiceManager } from "./services.ts";
import { CORE_VERSION, PKG } from "./version.ts";
import type { KernelHealth } from "./health.ts";

export class XRKernel {
  /** @deprecated Use CORE_VERSION from src/core/version.ts — kept for backward compat. */
  public static readonly VERSION = CORE_VERSION;

  /** Canonical version identity (single source of truth). */
  public static readonly PKG = PKG;
  public static readonly CORE_VERSION = CORE_VERSION;

  private readonly app: XRApp;

  constructor() {
    this.app = new XRApp();
  }

  /** The underlying bootstrap engine. */
  get runtime(): XRApp {
    return this.app;
  }

  /** The typed service registry. */
  get registry(): ServiceRegistry {
    return this.app.registry;
  }

  /**
   * @deprecated Use `kernel.registry`. Kept as a zero-cost alias so any
   * remaining `kernel.container` reference keeps resolving typed tokens.
   */
  get container(): ServiceRegistry {
    return this.app.registry;
  }

  get events(): EventBus {
    return this.app.events;
  }

  get commands(): CommandRegistry {
    return this.app.commands;
  }

  get lifecycle(): LifecycleManager {
    return this.app.lifecycle;
  }

  get workspaces(): WorkspaceManager {
    return this.app.workspaces;
  }

  /** @deprecated Use `kernel.backgroundServices`. Alias kept for compat. */
  get services(): BackgroundServiceManager {
    return this.app.backgroundServices;
  }

  get backgroundServices(): BackgroundServiceManager {
    return this.app.backgroundServices;
  }

  /** Bootstrap the full XR runtime (registers services, runs onInit). */
  async bootstrap(): Promise<void> {
    await this.app.bootstrap();
  }

  /** Start long-running background services and run onStart hooks. */
  async start(): Promise<void> {
    await this.app.start();
  }

  /** Gracefully shut down background services, run onStop, close the store. */
  async shutdown(): Promise<void> {
    await this.app.shutdown();
  }

  /** Switch the active workspace and rebind workspace-bound resources. */
  async switchWorkspace(id: string): Promise<void> {
    await this.app.switchWorkspace(id);
  }

  /** Execute a registered CLI/TUI command. */
  async executeCommand(name: string, args: string[], cwd: string): Promise<void> {
    await this.app.executeCommand(name, args, cwd);
  }

  // ── XR 4.0: New kernel API methods ─────────────────────────────────────

  /** Get the current lifecycle state. */
  getState(): RuntimeState {
    return this.app.getState();
  }

  /** Whether the runtime is fully operational. */
  isReady(): boolean {
    return this.app.isReady();
  }

  /** Whether the runtime has been bootstrapped. */
  isBootstrapped(): boolean {
    return this.app.isBootstrapped();
  }

  /** Whether the runtime has been started. */
  isStarted(): boolean {
    return this.app.isStarted();
  }

  /**
   * Build a kernel health snapshot. Cheap, pure operation — reads current
   * state without side effects. Suitable for CLI, daemon API, and tests.
   */
  getHealth(): KernelHealth {
    return this.app.getHealth();
  }
}
