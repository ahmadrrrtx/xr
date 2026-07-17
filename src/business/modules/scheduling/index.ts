/**
 * XR Business OS — Scheduling Module
 * 
 * Calendar management, appointments, and availability.
 * 
 * Integrates with:
 * - Meetings Module: Schedule meetings
 * - Integrations: Google Calendar, Outlook, Cal.com sync
 * - AI Workers: Schedule briefings and check-ins
 * - Automation: Reminders and follow-ups
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { CalendarEvent } from '../../core/types.ts';

export interface SchedulingModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class SchedulingModule {
  constructor(private config: SchedulingModuleConfig) {}

  createEvent(workspaceId: string, params: {
    title: string; description?: string; startTime: string; endTime: string;
    allDay?: boolean; timezone?: string; recurrence?: string; color?: string;
    visibility?: CalendarEvent['visibility']; source?: CalendarEvent['source'];
    externalId?: string; memberId: string;
  }): CalendarEvent {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_calendar_events (id, workspace_id, title, description, start_time, end_time, all_day, timezone, recurrence, color, visibility, source, external_id, member_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.title, params.description ?? null,
      params.startTime, params.endTime, params.allDay ? 1 : 0,
      params.timezone ?? 'UTC', params.recurrence ?? null, params.color ?? null,
      params.visibility ?? 'default', params.source ?? 'local',
      params.externalId ?? null, params.memberId, now);

    return this.getEvent(id)!;
  }

  getEvent(id: string): CalendarEvent | null {
    const row = this.config.db.prepare('SELECT * FROM biz_calendar_events WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEvent(row);
  }

  listEvents(workspaceId: string, params: {
    memberId?: string; startDate: string; endDate: string;
  }): CalendarEvent[] {
    let where = 'WHERE workspace_id = ? AND start_time >= ? AND end_time <= ?';
    const vals: unknown[] = [workspaceId, params.startDate, params.endDate];
    if (params.memberId) { where += ' AND member_id = ?'; vals.push(params.memberId); }

    const rows = this.config.db.prepare(`SELECT * FROM biz_calendar_events ${where} ORDER BY start_time`).all(...vals) as any[];
    return rows.map(r => this.rowToEvent(r));
  }

  updateEvent(id: string, updates: Partial<Pick<CalendarEvent, 'title' | 'description' | 'startTime' | 'endTime' | 'allDay' | 'color' | 'recurrence'>>): CalendarEvent | null {
    const fields: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); vals.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); vals.push(updates.description); }
    if (updates.startTime !== undefined) { fields.push('start_time = ?'); vals.push(updates.startTime); }
    if (updates.endTime !== undefined) { fields.push('end_time = ?'); vals.push(updates.endTime); }
    if (updates.allDay !== undefined) { fields.push('all_day = ?'); vals.push(updates.allDay ? 1 : 0); }
    if (updates.color !== undefined) { fields.push('color = ?'); vals.push(updates.color); }
    if (updates.recurrence !== undefined) { fields.push('recurrence = ?'); vals.push(updates.recurrence); }

    if (fields.length === 0) return this.getEvent(id);
    vals.push(id);
    this.config.db.prepare(`UPDATE biz_calendar_events SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getEvent(id);
  }

  deleteEvent(id: string): boolean {
    const result = this.config.db.prepare('DELETE FROM biz_calendar_events WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Check availability for a member.
   */
  getAvailability(memberId: string, date: string, timezone = 'UTC'): {
    busySlots: { start: string; end: string }[];
    freeSlots: { start: string; end: string }[];
  } {
    const dayStart = `${date}T09:00:00`;
    const dayEnd = `${date}T17:00:00`;

    const rows = this.config.db.prepare(
      "SELECT start_time, end_time FROM biz_calendar_events WHERE member_id = ? AND start_time >= ? AND end_time <= ? ORDER BY start_time"
    ).all(memberId, dayStart, dayEnd) as any[];

    const busySlots = rows.map(r => ({ start: r.start_time, end: r.end_time }));
    const freeSlots: { start: string; end: string }[] = [];

    let cursor = dayStart;
    for (const slot of busySlots) {
      if (cursor < slot.start) {
        freeSlots.push({ start: cursor, end: slot.start });
      }
      cursor = slot.end;
    }
    if (cursor < dayEnd) {
      freeSlots.push({ start: cursor, end: dayEnd });
    }

    return { busySlots, freeSlots };
  }

  private rowToEvent(row: any): CalendarEvent {
    return {
      id: row.id, workspaceId: row.workspace_id, title: row.title,
      description: row.description, startTime: row.start_time, endTime: row.end_time,
      allDay: row.all_day === 1, timezone: row.timezone, recurrence: row.recurrence,
      color: row.color, visibility: row.visibility, source: row.source,
      externalId: row.external_id, memberId: row.member_id, createdAt: row.created_at,
    };
  }

  isHealthy(): boolean { return true; }
}
