/**
 * XR — Lifecycle Manager
 *
 * Owns the runtime state machine and drives onInit → onStart → onStop for all
 * lifecycle participants in deterministic dependency order. Init/start run in
 * forward order; stop runs in reverse order so dependents are torn down before
 * the services they depend on.
 */

import { CoreEvents, type EventBus } from "./event-bus.ts";
import type { ServiceRegistry } from "./service-registry.ts";

export enum RuntimeState {
  UNINITIALIZED = "UNINITIALIZED",
  BOOTSTRAPPING = "BOOTSTRAPPING",
  READY = "READY",
  RUNNING = "RUNNING",
  SHUTTING_DOWN = "SHUTTING_DOWN",
  STOPPED = "STOPPED",
}

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

export class LifecycleManager implements LifecycleHook {
  private state: RuntimeState = RuntimeState.UNINITIALIZED;
  private participants: LifecycleParticipant[] = [];

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
    return this.state === RuntimeState.RUNNING;
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
    if (this.state === RuntimeState.READY || this.state === RuntimeState.RUNNING) return;
    if (this.state !== RuntimeState.UNINITIALIZED && this.state !== RuntimeState.STOPPED) {
      throw new Error(`Cannot initialize lifecycle from state ${this.state}.`);
    }

    this.setState(RuntimeState.BOOTSTRAPPING);
    for (let i = 0; i < this.participants.length; i++) {
      await this.invoke("init", this.participants[i]!, i, false);
    }
    this.setState(RuntimeState.READY);
  }

  async start(): Promise<void> {
    if (this.state === RuntimeState.RUNNING) return;
    if (this.state !== RuntimeState.READY) {
      throw new Error(`Runtime must be READY before starting. Current state: ${this.state}.`);
    }

    for (let i = 0; i < this.participants.length; i++) {
      await this.invoke("start", this.participants[i]!, i, false);
    }
    this.setState(RuntimeState.RUNNING);
  }

  async stop(): Promise<void> {
    if (this.state === RuntimeState.STOPPED || this.state === RuntimeState.UNINITIALIZED) {
      this.setState(RuntimeState.STOPPED);
      return;
    }

    this.setState(RuntimeState.SHUTTING_DOWN);
    for (let i = this.participants.length - 1; i >= 0; i--) {
      await this.invoke("stop", this.participants[i]!, i, true);
    }
    this.setState(RuntimeState.STOPPED);
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

    try {
      await method.call(participant.hook, context);
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
      this.events?.emit(CoreEvents.LifecycleHookFailed, {
        phase,
        service: participant.name,
        index,
        total: this.participants.length,
        state: this.state,
        error: message,
        timestamp: Date.now(),
      });
      if (!failSoft) throw error;
    }
  }
}
