/**
 * XR — Typed Event Bus
 *
 * The runtime uses one shared EventBus instance (registered as Tokens.Events).
 * Event names are centralized in CoreEvents and payloads are described by
 * XRCoreEventMap. Unknown extension events are still supported for plugins and
 * future stages, but core runtime code should emit through CoreEvents so event
 * naming and payload shape stay consistent.
 */

import type { VersionInfo } from "./version.ts";

export type EventHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>;
export type Unsubscribe = () => void;

export const CoreEvents = {
  LifecycleStateChanged: "lifecycle.state_changed",
  LifecycleHookStarted: "lifecycle.hook.started",
  LifecycleHookCompleted: "lifecycle.hook.completed",
  LifecycleHookFailed: "lifecycle.hook.failed",

  KernelBootstrapped: "kernel.bootstrapped",
  KernelStarted: "kernel.started",
  KernelStopped: "kernel.stopped",

  WorkspaceSwitching: "workspace.switching",
  WorkspaceSwitched: "workspace.switched",

  ServicesStarted: "services.started",
  ServicesStopped: "services.stopped",
  ServiceJobRegistered: "services.job.registered",
  ServiceJobUnregistered: "services.job.unregistered",
  ServiceJobSucceeded: "services.job.succeeded",
  ServiceJobFailed: "services.job.failed",

  SecurityThreatsDetected: "security.threats_detected",
  BudgetOverLimit: "budget.over_limit",
  MemoryPruned: "memory.pruned",

  AgentWorkflowCreated: "agents.workflow.created",
  AgentWorkflowUpdated: "agents.workflow.updated",
  AgentWorkflowCancelled: "agents.workflow.cancelled",
  AgentTaskStarted: "agents.task.started",
  AgentTaskReady: "agents.task.ready",
  AgentTaskBlocked: "agents.task.blocked",
  AgentTaskCompleted: "agents.task.completed",
  AgentTaskFailed: "agents.task.failed",
  AgentTaskNote: "agents.task.note",
} as const;

export type CoreEventName = typeof CoreEvents[keyof typeof CoreEvents];

export interface LifecycleEventPayload {
  state?: string;
  previousState?: string;
  nextState?: string;
  phase?: "init" | "start" | "stop";
  service?: string;
  index?: number;
  total?: number;
  timestamp: number;
}

export interface XRCoreEventMap {
  [CoreEvents.LifecycleStateChanged]: LifecycleEventPayload;
  [CoreEvents.LifecycleHookStarted]: LifecycleEventPayload;
  [CoreEvents.LifecycleHookCompleted]: LifecycleEventPayload;
  [CoreEvents.LifecycleHookFailed]: LifecycleEventPayload & { error: string };

  [CoreEvents.KernelBootstrapped]: VersionInfo & { timestamp: number };
  [CoreEvents.KernelStarted]: { timestamp: number };
  [CoreEvents.KernelStopped]: { timestamp: number };

  [CoreEvents.WorkspaceSwitching]: { from: string; to: string; timestamp: number };
  [CoreEvents.WorkspaceSwitched]: { active: string; timestamp: number };

  [CoreEvents.ServicesStarted]: { timestamp: number; jobs: number };
  [CoreEvents.ServicesStopped]: { timestamp: number };
  [CoreEvents.ServiceJobRegistered]: { id: string; name: string; intervalMs: number; timestamp: number };
  [CoreEvents.ServiceJobUnregistered]: { id: string; timestamp: number };
  [CoreEvents.ServiceJobSucceeded]: { id: string; name: string; timestamp: number };
  [CoreEvents.ServiceJobFailed]: { id: string; name: string; error: string; timestamp: number };

  [CoreEvents.SecurityThreatsDetected]: { threats: unknown[]; timestamp: number };
  [CoreEvents.BudgetOverLimit]: { status: unknown; timestamp: number };
  [CoreEvents.MemoryPruned]: { pruned: number; timestamp: number };

  [CoreEvents.AgentWorkflowCreated]: Record<string, unknown>;
  [CoreEvents.AgentWorkflowUpdated]: Record<string, unknown>;
  [CoreEvents.AgentWorkflowCancelled]: Record<string, unknown>;
  [CoreEvents.AgentTaskStarted]: Record<string, unknown>;
  [CoreEvents.AgentTaskReady]: Record<string, unknown>;
  [CoreEvents.AgentTaskBlocked]: Record<string, unknown>;
  [CoreEvents.AgentTaskCompleted]: Record<string, unknown>;
  [CoreEvents.AgentTaskFailed]: Record<string, unknown>;
  [CoreEvents.AgentTaskNote]: Record<string, unknown>;
}

export class EventBus<TEventMap extends object = XRCoreEventMap> {
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();

  /** Subscribe to a typed core event. Returns an unsubscribe function. */
  on<K extends keyof TEventMap & string>(event: K, handler: EventHandler<TEventMap[K]>): Unsubscribe;
  /** Subscribe to an extension/custom event. Returns an unsubscribe function. */
  on<TPayload = unknown>(event: string, handler: EventHandler<TPayload>): Unsubscribe;
  on(event: string, handler: EventHandler<any>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribe once; handler is removed before the first invocation. */
  once<K extends keyof TEventMap & string>(event: K, handler: EventHandler<TEventMap[K]>): Unsubscribe;
  once<TPayload = unknown>(event: string, handler: EventHandler<TPayload>): Unsubscribe;
  once(event: string, handler: EventHandler<any>): Unsubscribe {
    const unsubscribe = this.on(event, async (payload: unknown) => {
      unsubscribe();
      await handler(payload);
    });
    return unsubscribe;
  }

  /** Unsubscribe a handler from an event. */
  off<K extends keyof TEventMap & string>(event: K, handler: EventHandler<TEventMap[K]>): void;
  off<TPayload = unknown>(event: string, handler: EventHandler<TPayload>): void;
  off(event: string, handler: EventHandler<any>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(event);
  }

  /**
   * Emit without awaiting handlers. Handler errors are isolated and logged so
   * one subscriber cannot crash the runtime or block the emitter.
   */
  emit<K extends keyof TEventMap & string>(event: K, payload: TEventMap[K]): void;
  emit<TPayload = unknown>(event: string, payload: TPayload): void;
  emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((error) => {
          console.error(`[EventBus] Error in handler for event ${event}:`, error);
        });
    }
  }

  /** Emit and wait for all current subscribers to settle. Useful in tests. */
  async emitAndWait<K extends keyof TEventMap & string>(event: K, payload: TEventMap[K]): Promise<void>;
  async emitAndWait<TPayload = unknown>(event: string, payload: TPayload): Promise<void>;
  async emitAndWait(event: string, payload: unknown): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    const failures: unknown[] = [];
    await Promise.all([...set].map(async (handler) => {
      try {
        await handler(payload);
      } catch (error) {
        failures.push(error);
      }
    }));
    if (failures.length > 0) {
      console.error(`[EventBus] ${failures.length} handler error(s) for event ${event}:`, failures);
    }
  }

  /** Clear handlers for a specific event. */
  clear(event: string): void {
    this.handlers.delete(event);
  }

  /** Clear every registered handler. */
  clearAll(): void {
    this.handlers.clear();
  }

  /** Diagnostics snapshot for doctor/tests. */
  listenerCount(event?: string): number {
    if (event) return this.handlers.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
}
