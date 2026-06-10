/**
 * XR — Event Bus
 * A simple event-driven communication system for decoupled services.
 */

export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to a specific event.
   */
  on<T>(event: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from a specific event.
   */
  off<T>(event: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are executed asynchronously to avoid blocking the emitter.
   */
  emit<T>(event: string, payload: T): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        // Wrap in a promise to ensure async execution and avoid crashing the bus
        Promise.resolve().then(() => {
          try {
            handler(payload);
          } catch (e) {
            console.error(`[EventBus] Error in handler for event ${event}:`, e);
          }
        });
      }
    }
  }

  /**
   * Clear all handlers for a specific event.
   */
  clear(event: string): void {
    this.handlers.delete(event);
  }

  /**
   * Clear all registered handlers.
   */
  clearAll(): void {
    this.handlers.clear();
  }
}
