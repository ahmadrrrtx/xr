/**
 * XR Business OS — Meetings Module
 * 
 * Meeting scheduling, notes, transcription, and action items.
 * 
 * Integrates with:
 * - Scheduling Module: Calendar integration
 * - Voice Stack: Meeting transcription via STT
 * - AI Workers: Meeting preparation and follow-up
 * - Automation: Meeting reminders, follow-up workflows
 * - Integrations: Zoom, Google Meet, Cal.com
 */

import type { BusinessDatabase } from '../../core/database.js';
import type { BusinessEventBus } from '../../core/bus.js';
import type { Meeting, MeetingAttendee } from '../../core/types.js';

export interface MeetingsModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class MeetingsModule {
  constructor(private config: MeetingsModuleConfig) {}

  createMeeting(workspaceId: string, params: {
    title: string; description?: string; startTime: string; endTime: string;
    timezone?: string; location?: string; meetingUrl?: string;
    organizerId: string; attendees: Omit<MeetingAttendee, 'response'>[];
    agenda?: string; relatedTo?: { type: string; id: string };
  }): Meeting {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const attendees: MeetingAttendee[] = params.attendees.map(a => ({ ...a, response: 'pending' }));

    this.config.db.prepare(`
      INSERT INTO biz_meetings (id, workspace_id, title, description, start_time, end_time, timezone, location, meeting_url, organizer_id, attendees, agenda, status, related_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
    `).run(id, workspaceId, params.title, params.description ?? null,
      params.startTime, params.endTime, params.timezone ?? 'UTC',
      params.location ?? null, params.meetingUrl ?? null, params.organizerId,
      JSON.stringify(attendees), params.agenda ?? null,
      params.relatedTo ? JSON.stringify(params.relatedTo) : null, now, now);

    // Create calendar event
    this.config.bus.emit('meeting.created', {
      workspaceId, source: 'meetings',
      payload: { meetingId: id, title: params.title, startTime: params.startTime, attendees: attendees.map(a => a.email) },
    });

    return this.getMeeting(id)!;
  }

  getMeeting(id: string): Meeting | null {
    const row = this.config.db.prepare('SELECT * FROM biz_meetings WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToMeeting(row);
  }

  listMeetings(workspaceId: string, params?: {
    memberId?: string; startDate?: string; endDate?: string; status?: Meeting['status'];
  }): Meeting[] {
    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.startDate) { where += ' AND start_time >= ?'; vals.push(params.startDate); }
    if (params?.endDate) { where += ' AND end_time <= ?'; vals.push(params.endDate); }
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }

    const rows = this.config.db.prepare(`SELECT * FROM biz_meetings ${where} ORDER BY start_time DESC`).all(...vals) as any[];
    let meetings = rows.map(r => this.rowToMeeting(r));

    if (params?.memberId) {
      meetings = meetings.filter(m =>
        m.organizerId === params.memberId ||
        m.attendees.some(a => a.memberId === params.memberId)
      );
    }

    return meetings;
  }

  updateMeeting(id: string, updates: Partial<Pick<Meeting, 'title' | 'description' | 'startTime' | 'endTime' | 'location' | 'meetingUrl' | 'agenda' | 'status'>>): Meeting | null {
    const fields: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); vals.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); vals.push(updates.description); }
    if (updates.startTime !== undefined) { fields.push('start_time = ?'); vals.push(updates.startTime); }
    if (updates.endTime !== undefined) { fields.push('end_time = ?'); vals.push(updates.endTime); }
    if (updates.location !== undefined) { fields.push('location = ?'); vals.push(updates.location); }
    if (updates.meetingUrl !== undefined) { fields.push('meeting_url = ?'); vals.push(updates.meetingUrl); }
    if (updates.agenda !== undefined) { fields.push('agenda = ?'); vals.push(updates.agenda); }
    if (updates.status !== undefined) { fields.push('status = ?'); vals.push(updates.status); }

    if (fields.length === 0) return this.getMeeting(id);
    fields.push('updated_at = ?'); vals.push(new Date().toISOString()); vals.push(id);
    this.config.db.prepare(`UPDATE biz_meetings SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getMeeting(id);
  }

  /**
   * Add meeting notes.
   */
  addNotes(id: string, notes: string): Meeting | null {
    this.config.db.prepare('UPDATE biz_meetings SET notes = ?, updated_at = ? WHERE id = ?')
      .run(notes, new Date().toISOString(), id);
    return this.getMeeting(id);
  }

  /**
   * Add meeting transcript.
   */
  addTranscript(id: string, transcript: string): Meeting | null {
    this.config.db.prepare('UPDATE biz_meetings SET transcript = ?, updated_at = ? WHERE id = ?')
      .run(transcript, new Date().toISOString(), id);
    return this.getMeeting(id);
  }

  /**
   * Update attendee response.
   */
  updateAttendeeResponse(meetingId: string, email: string, response: MeetingAttendee['response']): void {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return;

    const attendees = meeting.attendees.map(a =>
      a.email === email ? { ...a, response } : a
    );

    this.config.db.prepare('UPDATE biz_meetings SET attendees = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(attendees), new Date().toISOString(), meetingId);
  }

  /**
   * Get upcoming meetings for a member.
   */
  getUpcoming(memberId: string, limit = 10): Meeting[] {
    const now = new Date().toISOString();
    const rows = this.config.db.prepare(
      "SELECT * FROM biz_meetings WHERE start_time > ? AND status = 'scheduled' ORDER BY start_time ASC LIMIT ?"
    ).all(now, limit * 3) as any[];

    return rows
      .map(r => this.rowToMeeting(r))
      .filter(m => m.organizerId === memberId || m.attendees.some(a => a.memberId === memberId))
      .slice(0, limit);
  }

  private rowToMeeting(row: any): Meeting {
    return {
      id: row.id, workspaceId: row.workspace_id, title: row.title,
      description: row.description, startTime: row.start_time, endTime: row.end_time,
      timezone: row.timezone, location: row.location, meetingUrl: row.meeting_url,
      organizerId: row.organizer_id, attendees: JSON.parse(row.attendees),
      agenda: row.agenda, notes: row.notes, transcript: row.transcript,
      recordingUrl: row.recording_url, status: row.status,
      relatedTo: row.related_to ? JSON.parse(row.related_to) : undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
