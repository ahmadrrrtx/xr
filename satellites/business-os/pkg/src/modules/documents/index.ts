/**
 * XR Business OS — Documents Module
 * 
 * Document creation, templates, collaboration, and versioning.
 * 
 * Integrates with:
 * - AI Workers: Generate documents from templates
 * - Automation: Auto-generate proposals, contracts, reports
 * - Knowledge Module: Convert docs to articles
 * - Integrations: Google Drive, OneDrive sync
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { Document, DocumentTemplate, TemplateVariable, PaginatedResult, PaginationParams } from '../../core/types.ts';

export interface DocumentsModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class DocumentsModule {
  constructor(private config: DocumentsModuleConfig) {}

  // ─── DOCUMENTS ───

  createDocument(workspaceId: string, params: {
    title: string; content?: string; templateId?: string; folderId?: string;
    ownerId: string; tags?: string[]; relatedTo?: { type: string; id: string };
  }): Document {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // If template, render with template content
    let content = params.content ?? '';
    if (params.templateId) {
      const template = this.getTemplate(params.templateId);
      if (template) content = template.content;
    }

    this.config.db.prepare(`
      INSERT INTO biz_documents (id, workspace_id, title, content, template_id, folder_id, owner_id, collaborators, version, status, tags, related_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, 'draft', ?, ?, ?, ?)
    `).run(id, workspaceId, params.title, content, params.templateId ?? null,
      params.folderId ?? null, params.ownerId,
      JSON.stringify(params.tags ?? []),
      params.relatedTo ? JSON.stringify(params.relatedTo) : null, now, now);

    return this.getDocument(id)!;
  }

  getDocument(id: string): Document | null {
    const row = this.config.db.prepare('SELECT * FROM biz_documents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToDocument(row);
  }

  updateDocument(id: string, updates: Partial<Pick<Document, 'title' | 'content' | 'status' | 'tags'>>): Document | null {
    const doc = this.getDocument(id);
    if (!doc) return null;

    const fields: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); vals.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); vals.push(updates.content); }
    if (updates.status !== undefined) { fields.push('status = ?'); vals.push(updates.status); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }

    fields.push('version = version + 1');
    fields.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(id);

    this.config.db.prepare(`UPDATE biz_documents SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getDocument(id);
  }

  listDocuments(workspaceId: string, params?: PaginationParams & { status?: string; ownerId?: string; folderId?: string }): PaginatedResult<Document> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.ownerId) { where += ' AND owner_id = ?'; vals.push(params.ownerId); }
    if (params?.folderId) { where += ' AND folder_id = ?'; vals.push(params.folderId); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_documents ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_documents ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return { data: data.map(r => this.rowToDocument(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── TEMPLATES ───

  createTemplate(workspaceId: string, params: {
    name: string; description?: string; content: string; category: string; variables?: TemplateVariable[];
  }): DocumentTemplate {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_document_templates (id, workspace_id, name, description, content, category, variables, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.name, params.description ?? null, params.content,
      params.category, JSON.stringify(params.variables ?? []), now);

    return { id, workspaceId, ...params, variables: params.variables ?? [], createdAt: now };
  }

  getTemplate(id: string): DocumentTemplate | null {
    const row = this.config.db.prepare('SELECT * FROM biz_document_templates WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { id: row.id, workspaceId: row.workspace_id, name: row.name, description: row.description, content: row.content, category: row.category, variables: JSON.parse(row.variables), createdAt: row.created_at };
  }

  listTemplates(workspaceId: string, category?: string): DocumentTemplate[] {
    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (category) { where += ' AND category = ?'; vals.push(category); }

    const rows = this.config.db.prepare(`SELECT * FROM biz_document_templates ${where} ORDER BY name`).all(...vals) as any[];
    return rows.map(r => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, description: r.description, content: r.content, category: r.category, variables: JSON.parse(r.variables), createdAt: r.created_at }));
  }

  /**
   * Render a template with variables.
   */
  renderTemplate(templateId: string, variables: Record<string, string>): string | null {
    const template = this.getTemplate(templateId);
    if (!template) return null;

    let content = template.content;
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return content;
  }

  private rowToDocument(row: any): Document {
    return {
      id: row.id, workspaceId: row.workspace_id, title: row.title, content: row.content,
      templateId: row.template_id, folderId: row.folder_id, ownerId: row.owner_id,
      collaborators: JSON.parse(row.collaborators), version: row.version,
      status: row.status, tags: JSON.parse(row.tags),
      relatedTo: row.related_to ? JSON.parse(row.related_to) : undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
