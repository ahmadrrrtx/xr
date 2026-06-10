/**
 * XR — Core Runtime (The Kernel)
 * The central orchestrator for the AI Operating System.
 */

import { Container } from "./container.ts";
import { EventBus } from "./event-bus.ts";
import { CommandRegistry } from "./command-registry.ts";
import { LifecycleManager, RuntimeState } from "./lifecycle.ts";

export class XRRuntime {
  public readonly container = new Container();
  public readonly events = new EventBus();
  public readonly commands = new CommandRegistry();
  public readonly lifecycle = new LifecycleManager();

  constructor() {
    // Register core infrastructure services
    this.container.register("container", this.container);
    this.container.register("events", this.events);
    this.container.register("commands", this.commands);
    this.container.register("lifecycle", this.lifecycle);
  }

  /**
   * Bootstraps the runtime: initializes services and registers commands.
   */
  async bootstrap(): Promise<void> {
    await this.lifecycle.init();
  }

  /**
   * Starts the runtime.
   */
  async start(): Promise<void> {
    await this.lifecycle.start();
  }

  /**
   * Shuts down the runtime gracefully.
   */
  async shutdown(): Promise<void> {
    await this.lifecycle.stop();
  }

  /**
   * Executes a command from the registry.
   */
  async executeCommand(name: string, args: string[], cwd: string): Promise<void> {
    await this.commands.run(name, args, {
      container: this.container,
      args,
      cwd,
    });
  }

  /**
   * Returns the current state of the runtime.
   */
  getState(): RuntimeState {
    return this.lifecycle.getState();
  }
}
