/**
 * XR — Lifecycle Manager
 * Manages the startup and shutdown sequence of the XR Runtime.
 */

export enum RuntimeState {
  UNINITIALIZED = "UNINITIALIZED",
  BOOTSTRAPPING = "BOOTSTRAPPING",
  READY = "READY",
  RUNNING = "RUNNING",
  SHUTTING_DOWN = "SHUTTING_DOWN",
  STOPPED = "STOPPED",
}

export interface LifecycleHook {
  onInit?(): Promise<void>;
  onStart?(): Promise<void>;
  onStop?(): Promise<void>;
}

export class LifecycleManager {
  private state: RuntimeState = RuntimeState.UNINITIALIZED;
  private hooks: Set<LifecycleHook> = new Set();

  /**
   * Register a component to the lifecycle.
   */
  register(hook: LifecycleHook): void {
    this.hooks.add(hook);
  }

  /**
   * Current state of the runtime.
   */
  getState(): RuntimeState {
    return this.state;
  }

  /**
   * Transition to a new state.
   */
  private setState(state: RuntimeState): void {
    this.state = state;
  }

  /**
   * Initialize all registered components.
   */
  async init(): Promise<void> {
    this.setState(RuntimeState.BOOTSTRAPPING);
    for (const hook of this.hooks) {
      if (hook.onInit) await hook.onInit();
    }
    this.setState(RuntimeState.READY);
  }

  /**
   * Start the runtime.
   */
  async start(): Promise<void> {
    if (this.state !== RuntimeState.READY) {
      throw new Error(`Runtime must be READY before starting. Current state: ${this.state}`);
    }
    this.setState(RuntimeState.RUNNING);
    for (const hook of this.hooks) {
      if (hook.onStart) await hook.onStart();
    }
  }

  /**
   * Gracefully shut down the runtime.
   */
  async stop(): Promise<void> {
    this.setState(RuntimeState.SHUTTING_DOWN);
    for (const hook of this.hooks) {
      if (hook.onStop) await hook.onStop();
    }
    this.setState(RuntimeState.STOPPED);
  }
}
