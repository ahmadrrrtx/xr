/**
 * XR Business OS — Unified Contact Management
 * 
 * Foundation for CRM, Sales, Support, and all modules.
 * Contacts are the central entity that connects everything.
 */

import { BusinessDatabase } from './database.ts';
import type { Contact, ContactNote, ContactActivity, ContactType, ContactStatus, PaginatedResult, PaginationParams, FilterParams } from './types.ts';

export class ContactManager {
  constructor(private db: BusinessDatabase) {}

  /**
   * Create a new contact.
   */
  create(workspaceId: string, params: {
    type: ContactType;
    status?: ContactStatus;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    title?: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
    source?: string;
    ownerId?: string;
  }): Contact {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();

    this.db.prepare(`
      INSERT INTO biz_contacts (id, workspace_id, type, status, name, email, phone, company, title, tags, custom_fields, source, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, workspaceId, params.type, params.status ?? 'lead', params.name,
      params.email ?? null, params.phone ?? null, params.company ?? null,
      params.title ?? null, JSON.stringify(params.tags ?? []),
      JSON.stringify(params.customFields ?? {}), params.source ?? null,
      params.ownerId ?? null, now, now
    );

    // Emit activity
    this.addActivity(id, {
      type: 'contact.created',
      title: `Contact "${params.name}" created`,
      actorId: params.ownerId ?? 'system',
    });

    return this.getById(id)!;
  }

  /**
   * Get contact by ID.
   */
  getById(id: string): Contact | null {
    const row = this.db.prepare(
      'SELECT * FROM biz_contacts WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;
    return this.rowToContact(row);
  }

  /**
   * Update contact.
   */
  update(id: string, updates: Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>): Contact | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
    if (updates.phone !== undefined) { fields.push('phone = ?'); values.push(updates.phone); }
    if (updates.company !== undefined) { fields.push('company = ?'); values.push(updates.company); }
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.customFields !== undefined) { fields.push('custom_fields = ?'); values.push(JSON.stringify(updates.customFields)); }
    if (updates.source !== undefined) { fields.push('source = ?'); values.push(updates.source); }
    if (updates.ownerId !== undefined) { fields.push('owner_id = ?'); values.push(updates.ownerId); }
    if (updates.score !== undefined) { fields.push('score = ?'); values.push(updates.score); }

    if (fields.length === 0) return this.getById(id);

    fields.push('updated_at = ?');
    values.push(BusinessDatabase.now());
    values.push(id);

    this.db.prepare(
      `UPDATE biz_contacts SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);

    return this.getById(id);
  }

  /**
   * Delete contact.
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM biz_contacts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * List contacts with pagination and filtering.
   */
  list(workspaceId: string, params?: PaginationParams & { filters?: FilterParams[] }): PaginatedResult<Contact> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;
    const sortBy = params?.sortBy ?? 'created_at';
    const sortOrder = params?.sortOrder ?? 'desc';

    let whereClause = 'WHERE workspace_id = ?';
    const whereValues: unknown[] = [workspaceId];

    // Apply filters
    if (params?.filters) {
      for (const filter of params.filters) {
        const sqlOp = this.operatorToSql(filter.operator);
        whereClause += ` AND ${filter.field} ${sqlOp} ?`;
        whereValues.push(this.prepareFilterValue(filter));
      }
    }

    // Count total
    const countRow = this.db.prepare(
      `SELECT COUNT(*) as count FROM biz_contacts ${whereClause}`
    ).get(...whereValues) as any;
    const total = countRow?.count ?? 0;

    // Fetch page
    const data = this.db.prepare(
      `SELECT * FROM biz_contacts ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`
    ).all(...whereValues, limit, offset) as any[];

    return {
      data: data.map(r => this.rowToContact(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Search contacts by name, email, or company.
   */
  search(workspaceId: string, query: string, limit = 20): Contact[] {
    const rows = this.db.prepare(`
      SELECT * FROM biz_contacts 
      WHERE workspace_id = ? AND (
        name LIKE ? OR email LIKE ? OR company LIKE ?
      )
      ORDER BY name
      LIMIT ?
    `).all(workspaceId, `%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];

    return rows.map(r => this.rowToContact(r));
  }

  /**
   * Get contacts by company.
   */
  getByCompany(workspaceId: string, company: string): Contact[] {
    const rows = this.db.prepare(
      "SELECT * FROM biz_contacts WHERE workspace_id = ? AND company = ? ORDER BY name"
    ).all(workspaceId, company) as any[];

    return rows.map(r => this.rowToContact(r));
  }

  /**
   * Get contacts by owner.
   */
  getByOwner(workspaceId: string, ownerId: string): Contact[] {
    const rows = this.db.prepare(
      "SELECT * FROM biz_contacts WHERE workspace_id = ? AND owner_id = ? ORDER BY name"
    ).all(workspaceId, ownerId) as any[];

    return rows.map(r => this.rowToContact(r));
  }

  /**
   * Add a note to a contact.
   */
  addNote(contactId: string, params: {
    authorId: string;
    content: string;
    type?: ContactNote['type'];
  }): ContactNote {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();

    this.db.prepare(`
      INSERT INTO biz_contact_notes (id, contact_id, author_id, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, contactId, params.authorId, params.content, params.type ?? 'note', now);

    // Update last contacted
    this.db.prepare(
      'UPDATE biz_contacts SET last_contacted_at = ?, updated_at = ? WHERE id = ?'
    ).run(now, now, contactId);

    return { id, contactId, ...params, type: params.type ?? 'note', createdAt: now };
  }

  /**
   * Get notes for a contact.
   */
  getNotes(contactId: string): ContactNote[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_contact_notes WHERE contact_id = ? ORDER BY created_at DESC'
    ).all(contactId) as any[];

    return rows.map(r => ({
      id: r.id,
      contactId: r.contact_id,
      authorId: r.author_id,
      content: r.content,
      type: r.type,
      createdAt: r.created_at,
    }));
  }

  /**
   * Add activity log entry.
   */
  addActivity(contactId: string, params: {
    type: string;
    title: string;
    description?: string;
    metadata?: Record<string, unknown>;
    actorId: string;
  }): ContactActivity {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();

    this.db.prepare(`
      INSERT INTO biz_contact_activities (id, contact_id, type, title, description, metadata, actor_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, contactId, params.type, params.title,
      params.description ?? null, JSON.stringify(params.metadata ?? {}),
      params.actorId, now);

    return { id, contactId, ...params, metadata: params.metadata ?? {}, timestamp: now };
  }

  /**
   * Get activity feed for a contact.
   */
  getActivities(contactId: string, limit = 50): ContactActivity[] {
    const rows = this.db.prepare(
      'SELECT * FROM biz_contact_activities WHERE contact_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(contactId, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      contactId: r.contact_id,
      type: r.type,
      title: r.title,
      description: r.description,
      metadata: JSON.parse(r.metadata),
      actorId: r.actor_id,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get contact statistics for a workspace.
   */
  getStats(workspaceId: string): {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    recentlyAdded: number;
  } {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as c FROM biz_contacts WHERE workspace_id = ?'
    ).get(workspaceId) as any)?.c ?? 0;

    const byStatus: Record<string, number> = {};
    const statusRows = this.db.prepare(
      'SELECT status, COUNT(*) as c FROM biz_contacts WHERE workspace_id = ? GROUP BY status'
    ).all(workspaceId) as any[];
    for (const r of statusRows) byStatus[r.status] = r.c;

    const byType: Record<string, number> = {};
    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as c FROM biz_contacts WHERE workspace_id = ? GROUP BY type'
    ).all(workspaceId) as any[];
    for (const r of typeRows) byType[r.type] = r.c;

    const bySource: Record<string, number> = {};
    const sourceRows = this.db.prepare(
      "SELECT COALESCE(source, 'unknown') as s, COUNT(*) as c FROM biz_contacts WHERE workspace_id = ? GROUP BY s"
    ).all(workspaceId) as any[];
    for (const r of sourceRows) bySource[r.s] = r.c;

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentlyAdded = (this.db.prepare(
      'SELECT COUNT(*) as c FROM biz_contacts WHERE workspace_id = ? AND created_at > ?'
    ).get(workspaceId, weekAgo) as any)?.c ?? 0;

    return { total, byStatus, byType, bySource, recentlyAdded };
  }

  private rowToContact(row: any): Contact {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      type: row.type,
      status: row.status,
      name: row.name,
      email: row.email,
      phone: row.phone,
      avatar: row.avatar,
      company: row.company,
      title: row.title,
      tags: JSON.parse(row.tags),
      customFields: JSON.parse(row.custom_fields),
      source: row.source,
      ownerId: row.owner_id,
      score: row.score,
      lastContactedAt: row.last_contacted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private operatorToSql(op: string): string {
    const map: Record<string, string> = {
      eq: '=', neq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=',
      contains: 'LIKE', starts_with: 'LIKE', ends_with: 'LIKE', in: 'IN', between: 'BETWEEN',
    };
    return map[op] ?? '=';
  }

  private prepareFilterValue(filter: FilterParams): unknown {
    switch (filter.operator) {
      case 'contains': return `%${filter.value}%`;
      case 'starts_with': return `${filter.value}%`;
      case 'ends_with': return `%${filter.value}`;
      default: return filter.value;
    }
  }
}
