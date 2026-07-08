/**
 * XR Business OS — Business Event Bus
 * 
 * Bridges into XR's existing core/event-bus.ts.
 * Business modules emit events here; automation engine subscribes.
 */

import { BusinessDatabase } from './database.js';
import type { BusinessEvent } from './types.js';

export type EventHandler = (event: BusinessEvent) => void | Promise<void>;

export class BusinessEventBus {
  private handlers = new Map<string, EventHandler[]>();
  private globalHandlers: EventHandler[] = [];

  constructor(private db: BusinessDatabase) {}

  /**
   * Subscribe to a specific event type.
   * Supports wildcards: 'deal.*' matches 'deal.created', 'deal.updated', etc.
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to all events.
   */
  onAll(handler: EventHandler): () => void {
    this.globalHandlers.push(handler);
    return () => {
      const idx = this.globalHandlers.indexOf(handler);
      if (idx !== -1) this.globalHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit a business event.
   */
  async emit(type: string, data: {
    workspaceId: string;
    source: string;
    payload: Record<string, unknown>;
    actorId?: string;
  }): Promise<BusinessEvent> {
    const event: BusinessEvent = {
      id: BusinessDatabase.generateId(),
      workspaceId: data.workspaceId,
      type,
      source: data.source,
      data: data.payload,
      actorId: data.actorId,
      timestamp: BusinessDatabase.now(),
    };

    // Persist event
    this.db.prepare(`
      INSERT INTO biz_events (id, workspace_id, type, source, data, actor_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.workspaceId, event.type, event.source,
      JSON.stringify(event.data), event.actorId ?? null, event.timestamp);

    // Dispatch to handlers
    await this.dispatch(event);

    return event;
  }

  /**
   * Get recent events for a workspace.
   */
  getRecent(workspaceId: string, limit = 50): BusinessEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_events WHERE workspace_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(workspaceId, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      workspaceId: r.workspace_id,
      type: r.type,
      source: r.source,
      data: JSON.parse(r.data),
      actorId: r.actor_id,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get events by type.
   */
  getByType(workspaceId: string, type: string, limit = 50): BusinessEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_events WHERE workspace_id = ? AND type = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(workspaceId, type, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      workspaceId: r.workspace_id,
      type: r.type,
      source: r.source,
      data: JSON.parse(r.data),
      actorId: r.actor_id,
      timestamp: r.timestamp,
    }));
  }

  private async dispatch(event: BusinessEvent): Promise<void> {
    // Exact match handlers
    const exactHandlers = this.handlers.get(event.type) ?? [];

    // Wildcard match handlers (e.g., 'deal.*' matches 'deal.created')
    const wildcardHandlers: EventHandler[] = [];
    for (const [pattern, handlers] of this.handlers.entries()) {
      if (pattern.endsWith('.*') && event.type.startsWith(pattern.slice(0, -1))) {
        wildcardHandlers.push(...handlers);
      }
    }

    // All handlers
    const allHandlers = [...exactHandlers, ...wildcardHandlers, ...this.globalHandlers];

    // Execute all handlers (non-blocking, collect errors)
    const errors: Error[] = [];
    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (err) {
        errors.push(err as Error);
      }
    }

    if (errors.length > 0) {
      console.error(`[BusinessEventBus] ${errors.length} handler error(s) for ${event.type}:`, errors);
    }
  }
}
