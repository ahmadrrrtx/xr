/**
 * XR — Lifecycle Manager
 *
 * Owns the runtime state machine (UNINITIALIZED → BOOTSTRAPPING → READY →
 * RUNNING → SHUTTING_DOWN → STOPPED) and drives the onInit / onStart / onStop
 * hooks of every participating service.
 *
 * Participants are supplied by XRApp in dependency-respecting order (see
 * ServiceRegistry.lifecycleTokens()). Init and start run forward; stop runs in
 * reverse so a service is always torn down before the services it depends on.
 */

export enum RuntimeState {
  UNINITIALIZED = "UNINITIALIZED",
  BOOTSTRAPPING = "BOOTSTRAPPING",
  READY = "READY",
  RUNNING = "RUNNING",
  SHUTTING_DOWN = "SHUTTING_DOWN",
  STOPPED = "STOPPED",
}

/**
 * Optional lifecycle hooks a service may implement. XRApp discovers
 * participants automatically from the ServiceRegistry, so services no longer
 * register themselves manually.
 */
export interface LifecycleHook {
  onInit?(): Promise<void> | void;
  onStart?(): Promise<void> | void;
  onStop?(): Promise<void> | void;
}

export class LifecycleManager {
  private state: RuntimeState = RuntimeState.UNINITIALIZED;
  private participants: LifecycleHook[] = [];

  /**
   * Replace the entire participant set with an ordered list. XRApp calls this
   * once per bootstrap with the topologically ordered service instances.
   */
  setParticipants(hooks: ReadonlyArray<LifecycleHook>): this {
    this.participants = [...hooks];
    return this;
  }

  /**
   * Append a single participant (forward-compat for ad-hoc registration, e.g.
   * a workspace-scoped service enabled at runtime).
   */
  register(hook: LifecycleHook): this {
    this.participants.push(hook);
    return this;
  }

  /** Remove all participants without changing the state machine. */
  clearParticipants(): this {
    this.participants = [];
    return this;
  }

  /** Number of registered participants. */
  get participantCount(): number {
    return this.participants.length;
  }

  /** Current runtime state. */
  getState(): RuntimeState {
    return this.state;
  }

  /** Whether the runtime is currently running. */
  isRunning(): boolean {
    return this.state === RuntimeState.RUNNING;
  }

  private setState(next: RuntimeState): void {
    this.state = next;
  }

  /**
   * Initialize all participants (forward order). Transitions to READY.
   */
  async init(): Promise<void> {
    this.setState(RuntimeState.BOOTSTRAPPING);
    for (const hook of this.participants) {
      if (hook.onInit) await hook.onInit();
    }
    this.setState(RuntimeState.READY);
  }

  /**
   * Start all participants (forward order). Requires the runtime to be READY.
   */
  async start(): Promise<void> {
    if (this.state !== RuntimeState.READY) {
      throw new Error(
        `Runtime must be READY before starting. Current state: ${this.state}.`,
      );
    }
    this.setState(RuntimeState.RUNNING);
    for (const hook of this.participants) {
      if (hook.onStart) await hook.onStart();
    }
  }

  /**
   * Gracefully stop all participants in REVERSE order, so a service is always
   * shut down before the services it depends on.
   */
  async stop(): Promise<void> {
    if (this.state === RuntimeState.STOPPED) return;
    this.setState(RuntimeState.SHUTTING_DOWN);
    for (let i = this.participants.length - 1; i >= 0; i--) {
      const hook = this.participants[i];
      if (!hook) continue;
      if (hook.onStop) {
        try {
          await hook.onStop();
        } catch {
          // A failing stop hook must not prevent the remaining services from
          // shutting down. Best-effort, fail-soft — mirrors kernel guarantees.
        }
      }
    }
    this.setState(RuntimeState.STOPPED);
  }
}
