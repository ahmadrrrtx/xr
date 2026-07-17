/**
 * XR Business OS — Support Module
 * 
 * Ticket management, SLA tracking, satisfaction surveys.
 * 
 * Integrates with:
 * - CRM Module: Customer context
 * - Knowledge Module: Auto-suggest articles
 * - AI Workers: Support Manager handles tickets
 * - Communication: Email/chat integration
 * - Automation: Ticket routing, SLA alerts
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { AuditTrail } from '../../core/audit.ts';
import type { Ticket, TicketMessage, TicketStatus, TicketPriority, SLAPolicy, PaginatedResult, PaginationParams } from '../../core/types.ts';

export interface SupportModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
  audit: AuditTrail;
}

export class SupportModule {
  constructor(private config: SupportModuleConfig) {}

  /**
   * Create a support ticket.
   */
  async createTicket(workspaceId: string, params: {
    subject: string;
    description: string;
    priority?: TicketPriority;
    contactId?: string;
    assigneeId?: string;
    channel?: Ticket['channel'];
    tags?: string[];
    sla?: SLAPolicy;
  }): Promise<Ticket> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get next ticket number
    const lastTicket = this.config.db.prepare(
      'SELECT number FROM biz_tickets WHERE workspace_id = ? ORDER BY number DESC LIMIT 1'
    ).get(workspaceId) as any;
    const number = (lastTicket?.number ?? 0) + 1;

    const ticket: Ticket = {
      id,
      workspaceId,
      number,
      subject: params.subject,
      description: params.description,
      status: 'new',
      priority: params.priority ?? 'normal',
      contactId: params.contactId,
      assigneeId: params.assigneeId,
      tags: params.tags ?? [],
      channel: params.channel ?? 'web',
      sla: params.sla,
      createdAt: now,
      updatedAt: now,
    };

    this.config.db.prepare(`
      INSERT INTO biz_tickets (id, workspace_id, number, subject, description, status, priority, contact_id, assignee_id, tags, channel, sla, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, number, params.subject, params.description, 'new',
      params.priority ?? 'normal', params.contactId ?? null, params.assigneeId ?? null,
      JSON.stringify(params.tags ?? []), params.channel ?? 'web',
      params.sla ? JSON.stringify(params.sla) : null, now, now);

    await this.config.bus.emit('ticket.created', {
      workspaceId,
      source: 'support',
      payload: { ticketId: id, number, subject: params.subject, priority: params.priority },
    });

    return ticket;
  }

  /**
   * Get ticket by ID.
   */
  getTicket(id: string): Ticket | null {
    const row = this.config.db.prepare('SELECT * FROM biz_tickets WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToTicket(row);
  }

  /**
   * Update ticket status.
   */
  async updateTicketStatus(id: string, status: TicketStatus, actorId?: string): Promise<Ticket | null> {
    const ticket = this.getTicket(id);
    if (!ticket) return null;

    const now = new Date().toISOString();
    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, now];

    if (status === 'solved' || status === 'closed') {
      updates.push('resolved_at = ?');
      values.push(now);
    }

    values.push(id);
    this.config.db.prepare(`UPDATE biz_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    await this.config.bus.emit(`ticket.${status === 'solved' ? 'resolved' : 'updated'}`, {
      workspaceId: ticket.workspaceId,
      source: 'support',
      payload: { ticketId: id, status, previousStatus: ticket.status },
      actorId,
    });

    return this.getTicket(id);
  }

  /**
   * Add a message to a ticket.
   */
  async addMessage(ticketId: string, params: {
    authorId: string;
    authorType: TicketMessage['authorType'];
    content: string;
    isInternal?: boolean;
  }): Promise<TicketMessage> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_ticket_messages (id, ticket_id, author_id, author_type, content, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, ticketId, params.authorId, params.authorType, params.content,
      params.isInternal ? 1 : 0, now);

    // Set first response time if not set
    const ticket = this.getTicket(ticketId);
    if (ticket && !ticket.firstResponseAt && !params.isInternal && params.authorType !== 'contact') {
      this.config.db.prepare(
        'UPDATE biz_tickets SET first_response_at = ? WHERE id = ?'
      ).run(now, ticketId);
    }

    // Auto-update status
    if (ticket?.status === 'new' && params.authorType !== 'contact') {
      await this.updateTicketStatus(ticketId, 'open');
    }

    return { id, ticketId, ...params, isInternal: params.isInternal ?? false, attachments: [], createdAt: now };
  }

  /**
   * Get messages for a ticket.
   */
  getMessages(ticketId: string): TicketMessage[] {
    const rows = this.config.db.prepare(
      'SELECT * FROM biz_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC'
    ).all(ticketId) as any[];

    return rows.map(r => ({
      id: r.id,
      ticketId: r.ticket_id,
      authorId: r.author_id,
      authorType: r.author_type,
      content: r.content,
      isInternal: r.is_internal === 1,
      attachments: JSON.parse(r.attachments),
      createdAt: r.created_at,
    }));
  }

  /**
   * List tickets with pagination.
   */
  listTickets(workspaceId: string, params?: PaginationParams & {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string;
    contactId?: string;
  }): PaginatedResult<Ticket> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE workspace_id = ?';
    const whereValues: unknown[] = [workspaceId];

    if (params?.status) { whereClause += ' AND status = ?'; whereValues.push(params.status); }
    if (params?.priority) { whereClause += ' AND priority = ?'; whereValues.push(params.priority); }
    if (params?.assigneeId) { whereClause += ' AND assignee_id = ?'; whereValues.push(params.assigneeId); }
    if (params?.contactId) { whereClause += ' AND contact_id = ?'; whereValues.push(params.contactId); }

    const countRow = this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_tickets ${whereClause}`).get(...whereValues) as any;
    const total = countRow?.c ?? 0;

    const data = this.config.db.prepare(
      `SELECT * FROM biz_tickets ${whereClause} ORDER BY ${params?.sortBy ?? 'created_at'} ${params?.sortOrder ?? 'desc'} LIMIT ? OFFSET ?`
    ).all(...whereValues, limit, offset) as any[];

    return { data: data.map(r => this.rowToTicket(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get support statistics.
   */
  getStats(workspaceId: string): {
    total: number;
    open: number;
    pending: number;
    solved: number;
    averageFirstResponseMinutes: number;
    averageResolutionMinutes: number;
    satisfactionAverage: number;
    byPriority: Record<string, number>;
    byChannel: Record<string, number>;
  } {
    const total = (this.config.db.prepare('SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ?').get(workspaceId) as any)?.c ?? 0;
    const open = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? AND status IN ('new', 'open')").get(workspaceId) as any)?.c ?? 0;
    const pending = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? AND status = 'pending'").get(workspaceId) as any)?.c ?? 0;
    const solved = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? AND status IN ('solved', 'closed')").get(workspaceId) as any)?.c ?? 0;

    const byPriority: Record<string, number> = {};
    const pRows = this.config.db.prepare('SELECT priority, COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? GROUP BY priority').all(workspaceId) as any[];
    for (const r of pRows) byPriority[r.priority] = r.c;

    const byChannel: Record<string, number> = {};
    const cRows = this.config.db.prepare('SELECT channel, COUNT(*) as c FROM biz_tickets WHERE workspace_id = ? GROUP BY channel').all(workspaceId) as any[];
    for (const r of cRows) byChannel[r.channel] = r.c;

    return { total, open, pending, solved, averageFirstResponseMinutes: 0, averageResolutionMinutes: 0, satisfactionAverage: 0, byPriority, byChannel };
  }

  private rowToTicket(row: any): Ticket {
    return {
      id: row.id, workspaceId: row.workspace_id, number: row.number,
      subject: row.subject, description: row.description, status: row.status,
      priority: row.priority, contactId: row.contact_id, assigneeId: row.assignee_id,
      tags: JSON.parse(row.tags), channel: row.channel,
      sla: row.sla ? JSON.parse(row.sla) : undefined,
      firstResponseAt: row.first_response_at, resolvedAt: row.resolved_at,
      satisfaction: row.satisfaction, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
