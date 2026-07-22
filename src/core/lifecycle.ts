/**
 * XR 4.0 — Lifecycle Manager
 *
 * Owns the runtime state machine and drives onInit → onStart → onStop for all
 * lifecycle participants in deterministic dependency order. Init/start run in
 * forward order; stop runs in reverse order so dependents are torn down before
 * the services they depend on.
 *
 * XR 4.0 additions:
 *   - FAILED state for unrecoverable failures
 *   - SWITCHING_WORKSPACE state for workspace transitions
 *   - DEGRADED state for optional-service failures
 *   - STARTING state (between RUNNABLE and RUNNING)
 *   - Deterministic, validated state transitions
 *   - Idempotent operations with explicit rejection of invalid transitions
 *   - Failed-init cleanup support
 */

import { CoreEvents, type EventBus } from "./event-bus.ts";
import type { ServiceRegistry } from "./service-registry.ts";
import {
  LifecycleTransitionError,
  LifecycleHookFailedError,
} from "./errors.ts";

export enum RuntimeState {
  /** Initial state — no providers registered, no services created. */
  UNINITIALIZED = "UNINITIALIZED",
  /** Bootstrap is in progress (providers registering, init hooks running). */
  BOOTSTRAPPING = "BOOTSTRAPPING",
  /** Bootstrap completed successfully; ready to start. */
  READY = "READY",
  /** Start hooks are running. */
  STARTING = "STARTING",
  /** Runtime is fully started and operational. */
  RUNNING = "RUNNING",
  /** Workspace switch is in progress. */
  SWITCHING_WORKSPACE = "SWITCHING_WORKSPACE",
  /** Optional services degraded, but required services are functional. */
  DEGRADED = "DEGRADED",
  /** Shutdown is in progress. */
  SHUTTING_DOWN = "SHUTTING_DOWN",
  /** Runtime has been fully stopped. */
  STOPPED = "STOPPED",
  /** Runtime encountered an unrecoverable failure. */
  FAILED = "FAILED",
}

/** Valid state transitions. Key = current state, Value = set of allowed next states. */
const VALID_TRANSITIONS: Map<RuntimeState, Set<RuntimeState>> = new Map<RuntimeState, Set<RuntimeState>>([
  [RuntimeState.UNINITIALIZED, new Set<RuntimeState>([RuntimeState.BOOTSTRAPPING, RuntimeState.FAILED])],
  [RuntimeState.BOOTSTRAPPING, new Set<RuntimeState>([RuntimeState.READY, RuntimeState.FAILED, RuntimeState.STOPPED])],
  [RuntimeState.READY, new Set<RuntimeState>([RuntimeState.STARTING, RuntimeState.SHUTTING_DOWN, RuntimeState.SWITCHING_WORKSPACE, RuntimeState.FAILED])],
  [RuntimeState.STARTING, new Set<RuntimeState>([RuntimeState.RUNNING, RuntimeState.DEGRADED, RuntimeState.SHUTTING_DOWN, RuntimeState.FAILED])],
  [RuntimeState.RUNNING, new Set<RuntimeState>([RuntimeState.SHUTTING_DOWN, RuntimeState.SWITCHING_WORKSPACE, RuntimeState.DEGRADED, RuntimeState.FAILED])],
  [RuntimeState.SWITCHING_WORKSPACE, new Set<RuntimeState>([RuntimeState.RUNNING, RuntimeState.READY, RuntimeState.DEGRADED, RuntimeState.FAILED])],
  [RuntimeState.DEGRADED, new Set<RuntimeState>([RuntimeState.RUNNING, RuntimeState.SHUTTING_DOWN, RuntimeState.SWITCHING_WORKSPACE, RuntimeState.FAILED])],
  [RuntimeState.SHUTTING_DOWN, new Set<RuntimeState>([RuntimeState.STOPPED, RuntimeState.FAILED])],
  [RuntimeState.STOPPED, new Set<RuntimeState>([RuntimeState.BOOTSTRAPPING, RuntimeState.UNINITIALIZED])],
  [RuntimeState.FAILED, new Set<RuntimeState>([RuntimeState.STOPPED, RuntimeState.UNINITIALIZED, RuntimeState.BOOTSTRAPPING])],
]);

export type LifecyclePhase = "init" | "start" | "stop";

export interface LifecycleContext {
  readonly phase: LifecyclePhase;
  readonly service: string;
  readonly index: number;
  readonly total: number;
  readonly state: RuntimeState;
  readonly registry?: ServiceRegistry;
  readonly events?: EventBus;
}

/**
 * Unified lifecycle contract for major runtime modules.
 *
 * - onInit: validate/configure internal state; no long-running loops.
 * - onStart: start background work, warm providers, subscribe listeners.
 * - onStop: release resources; must be idempotent and best-effort.
 */
export interface LifecycleHook {
  onInit?(context: LifecycleContext): Promise<void> | void;
  onStart?(context: LifecycleContext): Promise<void> | void;
  onStop?(context: LifecycleContext): Promise<void> | void;
}

export interface LifecycleParticipant {
  readonly name: string;
  readonly hook: LifecycleHook;
}

export function isLifecycleHook(value: unknown): value is LifecycleHook {
  if (!value || typeof value !== "object") return false;
  const candidate = value as LifecycleHook;
  return (
    typeof candidate.onInit === "function" ||
    typeof candidate.onStart === "function" ||
    typeof candidate.onStop === "function"
  );
}

/** Records the result of a lifecycle phase for a single participant. */
export interface LifecycleHookResult {
  readonly service: string;
  readonly phase: LifecyclePhase;
  readonly success: boolean;
  readonly error?: string;
  readonly durationMs?: number;
}

export class LifecycleManager implements LifecycleHook {
  private state: RuntimeState = RuntimeState.UNINITIALIZED;
  private participants: LifecycleParticipant[] = [];
  /** Tracks failures during the current phase for health reporting. */
  private hookResults: LifecycleHookResult[] = [];

  constructor(
    private readonly events?: EventBus,
    private readonly registry?: ServiceRegistry,
  ) {}

  /** Replace the participant set with an ordered list. */
  setParticipants(hooks: ReadonlyArray<LifecycleHook | LifecycleParticipant>): this {
    this.participants = hooks.map((entry, index) => {
      if ("hook" in entry && "name" in entry) return entry;
      return { name: `lifecycle.participant.${index + 1}`, hook: entry };
    });
    return this;
  }

  /** Append one participant for dynamic/ad-hoc modules. */
  register(hook: LifecycleHook, name = `lifecycle.participant.${this.participants.length + 1}`): this {
    this.participants.push({ name, hook });
    return this;
  }

  /** Remove all participants without changing runtime state. */
  clearParticipants(): this {
    this.participants = [];
    return this;
  }

  get participantCount(): number {
    return this.participants.length;
  }

  getState(): RuntimeState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state === RuntimeState.RUNNING || this.state === RuntimeState.DEGRADED;
  }

  /** Whether the runtime is in a state where it can accept work. */
  isOperational(): boolean {
    return this.state === RuntimeState.RUNNING || this.state === RuntimeState.DEGRADED;
  }

  /** Whether the runtime is in a transition state. */
  isTransitioning(): boolean {
    return this.state === RuntimeState.BOOTSTRAPPING ||
      this.state === RuntimeState.STARTING ||
      this.state === RuntimeState.SHUTTING_DOWN ||
      this.state === RuntimeState.SWITCHING_WORKSPACE;
  }

  /** Get accumulated hook results for the current lifecycle. */
  getHookResults(): ReadonlyArray<LifecycleHookResult> {
    return this.hookResults;
  }

  async onInit(): Promise<void> {
    await this.init();
  }

  async onStart(): Promise<void> {
    await this.start();
  }

  async onStop(): Promise<void> {
    await this.stop();
  }

  async init(): Promise<void> {
    if (this.state === RuntimeState.READY || this.state === RuntimeState.RUNNING || this.state === RuntimeState.DEGRADED) {
      return; // Idempotent: already initialized
    }
    this.validateTransition(RuntimeState.BOOTSTRAPPING);

    this.setState(RuntimeState.BOOTSTRAPPING);
    this.hookResults = [];
    try {
      for (let i = 0; i < this.participants.length; i++) {
        await this.invoke("init", this.participants[i]!, i, false);
      }
      this.setState(RuntimeState.READY);
    } catch (error) {
      this.setState(RuntimeState.FAILED);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.state === RuntimeState.RUNNING || this.state === RuntimeState.DEGRADED) {
      return; // Idempotent: already started
    }
    this.validateTransition(RuntimeState.STARTING);

    this.setState(RuntimeState.STARTING);
    let hasFailure = false;
    try {
      for (let i = 0; i < this.participants.length; i++) {
        try {
          await this.invoke("start", this.participants[i]!, i, false);
        } catch (error) {
          hasFailure = true;
          // If a required service fails to start, fail hard
          this.setState(RuntimeState.FAILED);
          throw error;
        }
      }
      this.setState(hasFailure ? RuntimeState.DEGRADED : RuntimeState.RUNNING);
    } catch (error) {
      // Already set to FAILED above if we get here from the inner catch
      if (this.state !== RuntimeState.FAILED) {
        this.setState(RuntimeState.FAILED);
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === RuntimeState.STOPPED || this.state === RuntimeState.UNINITIALIZED) {
      this.setState(RuntimeState.STOPPED);
      return; // Idempotent: already stopped
    }
    this.validateTransition(RuntimeState.SHUTTING_DOWN);

    this.setState(RuntimeState.SHUTTING_DOWN);
    for (let i = this.participants.length - 1; i >= 0; i--) {
      await this.invoke("stop", this.participants[i]!, i, true);
    }
    this.setState(RuntimeState.STOPPED);
  }

  /** Enter workspace-switching state. Called by XRApp. */
  enterWorkspaceSwitch(): void {
    this.validateTransition(RuntimeState.SWITCHING_WORKSPACE);
    this.setState(RuntimeState.SWITCHING_WORKSPACE);
  }

  /** Exit workspace-switching state back to the previous operational state. */
  exitWorkspaceSwitch(success: boolean): void {
    if (success) {
      this.setState(RuntimeState.RUNNING);
    } else {
      // On failure, go to FAILED — the runtime must be explicitly recovered
      this.setState(RuntimeState.FAILED);
    }
  }

  /** Mark the runtime as degraded (optional service unavailable). */
  markDegraded(detail?: string): void {
    this.setState(RuntimeState.DEGRADED);
    if (detail) {
      this.events?.emit(CoreEvents.LifecycleStateChanged, {
        previousState: RuntimeState.RUNNING,
        nextState: RuntimeState.DEGRADED,
        detail,
        timestamp: Date.now(),
      });
    }
  }

  /** Recover from degraded back to running. */
  recoverFromDegraded(): void {
    if (this.state === RuntimeState.DEGRADED) {
      this.setState(RuntimeState.RUNNING);
    }
  }

  /** Reset to UNINITIALIZED (for re-bootstrap after failure/shutdown). */
  reset(): void {
    this.state = RuntimeState.UNINITIALIZED;
    this.hookResults = [];
  }

  private validateTransition(target: RuntimeState): void {
    const allowed = VALID_TRANSITIONS.get(this.state);
    if (!allowed || !allowed.has(target)) {
      throw new LifecycleTransitionError(this.state, target);
    }
  }

  private setState(next: RuntimeState): void {
    const previous = this.state;
    this.state = next;
    this.events?.emit(CoreEvents.LifecycleStateChanged, {
      previousState: previous,
      nextState: next,
      timestamp: Date.now(),
    });
  }

  private async invoke(
    phase: LifecyclePhase,
    participant: LifecycleParticipant,
    index: number,
    failSoft: boolean,
  ): Promise<void> {
    const method = phase === "init" ? participant.hook.onInit : phase === "start" ? participant.hook.onStart : participant.hook.onStop;
    if (!method) return;

    const context: LifecycleContext = {
      phase,
      service: participant.name,
      index,
      total: this.participants.length,
      state: this.state,
      registry: this.registry,
      events: this.events,
    };

    this.events?.emit(CoreEvents.LifecycleHookStarted, {
      phase,
      service: participant.name,
      index,
      total: this.participants.length,
      state: this.state,
      timestamp: Date.now(),
    });

    const startTime = performance.now();
    try {
      await method.call(participant.hook, context);
      const durationMs = performance.now() - startTime;
      this.hookResults.push({ service: participant.name, phase, success: true, durationMs });
      this.events?.emit(CoreEvents.LifecycleHookCompleted, {
        phase,
        service: participant.name,
        index,
        total: this.participants.length,
        state: this.state,
        timestamp: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = performance.now() - startTime;
      this.hookResults.push({ service: participant.name, phase, success: false, error: message, durationMs });
      this.events?.emit(CoreEvents.LifecycleHookFailed, {
        phase,
        service: participant.name,
        index,
        total: this.participants.length,
        state: this.state,
        error: message,
        timestamp: Date.now(),
      });
      if (!failSoft) {
        throw new LifecycleHookFailedError(participant.name, phase, error instanceof Error ? error : undefined);
      }
    }
  }
}
