/**
 * XR Business OS — CRM Module
 * 
 * Unified contact management, relationship tracking, and activity logging.
 * Built on top of core/contacts.ts with CRM-specific features.
 * 
 * Integrates with:
 * - Memory Engine: Stores contact interactions as memory
 * - Research Engine: Enriches contact data
 * - AI Workers: Sales Director uses CRM data
 * - Plugin Platform: Gmail, Slack for communication tracking
 * - MCP Platform: HubSpot, Salesforce sync
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { ContactManager } from '../../core/contacts.ts';
import type { PipelineManager } from '../../core/pipeline.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { AuditTrail } from '../../core/audit.ts';
import type { Contact, Deal, Pipeline, PaginatedResult, PaginationParams, FilterParams, SearchResult } from '../../core/types.ts';

export interface CRMModuleConfig {
  db: BusinessDatabase;
  contacts: ContactManager;
  pipelines: PipelineManager;
  bus: BusinessEventBus;
  audit: AuditTrail;
}

export class CRMModule {
  constructor(private config: CRMModuleConfig) {}

  // ─── CONTACTS ───

  /**
   * Create a contact with CRM-specific logic.
   */
  async createContact(workspaceId: string, actorId: string, params: Parameters<ContactManager['create']>[1]): Promise<Contact> {
    const contact = this.config.contacts.create(workspaceId, params);

    // Emit event
    await this.config.bus.emit('contact.created', {
      workspaceId,
      source: 'crm',
      payload: { contactId: contact.id, name: contact.name, type: contact.type },
      actorId,
    });

    // Audit log
    this.config.audit.log({
      orgId: '', // resolved from workspace
      workspaceId,
      actorId,
      actorType: 'member',
      action: 'create',
      resource: 'contacts',
      resourceId: contact.id,
      changes: { contact: { before: null, after: contact } },
    });

    return contact;
  }

  /**
   * Update a contact.
   */
  async updateContact(id: string, actorId: string, updates: Parameters<ContactManager['update']>[1]): Promise<Contact | null> {
    const before = this.config.contacts.getById(id);
    const contact = this.config.contacts.update(id, updates);

    if (contact) {
      await this.config.bus.emit('contact.updated', {
        workspaceId: contact.workspaceId,
        source: 'crm',
        payload: { contactId: id, changes: updates },
        actorId,
      });

      this.config.audit.log({
        orgId: '',
        workspaceId: contact.workspaceId,
        actorId,
        actorType: 'member',
        action: 'update',
        resource: 'contacts',
        resourceId: id,
        changes: { before, after: contact },
      });
    }

    return contact;
  }

  /**
   * Delete a contact.
   */
  async deleteContact(id: string, actorId: string): Promise<boolean> {
    const contact = this.config.contacts.getById(id);
    const deleted = this.config.contacts.delete(id);

    if (deleted && contact) {
      await this.config.bus.emit('contact.deleted', {
        workspaceId: contact.workspaceId,
        source: 'crm',
        payload: { contactId: id, name: contact.name },
        actorId,
      });

      this.config.audit.log({
        orgId: '',
        workspaceId: contact.workspaceId,
        actorId,
        actorType: 'member',
        action: 'delete',
        resource: 'contacts',
        resourceId: id,
      });
    }

    return deleted;
  }

  /**
   * List contacts with filtering and pagination.
   */
  listContacts(workspaceId: string, params?: PaginationParams & { filters?: FilterParams[] }): PaginatedResult<Contact> {
    return this.config.contacts.list(workspaceId, params);
  }

  /**
   * Search contacts.
   */
  searchContacts(workspaceId: string, query: string): Contact[] {
    return this.config.contacts.search(workspaceId, query);
  }

  /**
   * Get contact statistics.
   */
  getContactStats(workspaceId: string) {
    return this.config.contacts.getStats(workspaceId);
  }

  /**
   * Add a note to a contact.
   */
  async addNote(contactId: string, actorId: string, content: string, type?: string) {
    const note = this.config.contacts.addNote(contactId, {
      authorId: actorId,
      content,
      type: type as any,
    });

    await this.config.bus.emit('contact.note_added', {
      workspaceId: this.config.contacts.getById(contactId)?.workspaceId ?? '',
      source: 'crm',
      payload: { contactId, noteId: note.id, type: note.type },
      actorId,
    });

    return note;
  }

  /**
   * Get contact activity feed.
   */
  getContactActivity(contactId: string) {
    return this.config.contacts.getActivities(contactId);
  }

  /**
   * Get contact notes.
   */
  getContactNotes(contactId: string) {
    return this.config.contacts.getNotes(contactId);
  }

  // ─── COMPANIES ───

  /**
   * Get company (grouping of person contacts by company field).
   */
  getCompany(workspaceId: string, companyName: string) {
    const contacts = this.config.contacts.getByCompany(workspaceId, companyName);
    const deals = this.config.pipelines.listDeals(workspaceId, { contactId: contacts[0]?.id });
    return {
      name: companyName,
      contacts,
      totalDeals: deals.total,
      totalValue: deals.data.reduce((sum, d) => sum + d.value, 0),
    };
  }

  // ─── SEARCH ───

  /**
   * Global CRM search across contacts, deals, notes.
   */
  globalSearch(workspaceId: string, query: string): SearchResult[] {
    const results: SearchResult[] = [];

    // Search contacts
    const contacts = this.config.contacts.search(workspaceId, query, 10);
    for (const c of contacts) {
      results.push({
        entity: 'contact',
        id: c.id,
        title: c.name,
        subtitle: [c.company, c.email].filter(Boolean).join(' · '),
        score: 1,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Health check.
   */
  isHealthy(): boolean {
    try {
      this.config.db.prepare('SELECT 1 FROM biz_contacts LIMIT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}
