/**
 * XR Business OS — Knowledge Module
 * 
 * Wiki, SOPs, runbooks, and internal knowledge base.
 * 
 * Integrates with:
 * - Memory Engine: Knowledge articles indexed for RAG
 * - Research Engine: Auto-generate articles from research
 * - AI Workers: Auto-suggest articles for support tickets
 * - Support Module: Public KB for customers
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { KnowledgeArticle, PaginatedResult, PaginationParams } from '../../core/types.ts';

export interface KnowledgeModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class KnowledgeModule {
  constructor(private config: KnowledgeModuleConfig) {}

  async createArticle(workspaceId: string, params: {
    title: string; content: string; category?: string; tags?: string[];
    status?: KnowledgeArticle['status']; visibility?: KnowledgeArticle['visibility']; authorId: string;
  }): Promise<KnowledgeArticle> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = params.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    this.config.db.prepare(`
      INSERT INTO biz_knowledge_articles (id, workspace_id, title, slug, content, category, tags, status, visibility, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.title, slug, params.content, params.category ?? null,
      JSON.stringify(params.tags ?? []), params.status ?? 'draft', params.visibility ?? 'internal',
      params.authorId, now, now);

    await this.config.bus.emit('knowledge.article_created', {
      workspaceId, source: 'knowledge',
      payload: { articleId: id, title: params.title },
    });

    return this.getArticle(id)!;
  }

  getArticle(id: string): KnowledgeArticle | null {
    const row = this.config.db.prepare('SELECT * FROM biz_knowledge_articles WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToArticle(row);
  }

  getBySlug(workspaceId: string, slug: string): KnowledgeArticle | null {
    const row = this.config.db.prepare('SELECT * FROM biz_knowledge_articles WHERE workspace_id = ? AND slug = ?').get(workspaceId, slug) as any;
    if (!row) return null;
    return this.rowToArticle(row);
  }

  listArticles(workspaceId: string, params?: PaginationParams & { status?: string; category?: string; visibility?: string }): PaginatedResult<KnowledgeArticle> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.category) { where += ' AND category = ?'; vals.push(params.category); }
    if (params?.visibility) { where += ' AND visibility = ?'; vals.push(params.visibility); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_knowledge_articles ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_knowledge_articles ${where} ORDER BY title LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return { data: data.map(r => this.rowToArticle(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  searchArticles(workspaceId: string, query: string): KnowledgeArticle[] {
    const rows = this.config.db.prepare(
      "SELECT * FROM biz_knowledge_articles WHERE workspace_id = ? AND (title LIKE ? OR content LIKE ?) AND status = 'published' ORDER BY view_count DESC LIMIT 10"
    ).all(workspaceId, `%${query}%`, `%${query}%`) as any[];
    return rows.map(r => this.rowToArticle(r));
  }

  async updateArticle(id: string, updates: Partial<Pick<KnowledgeArticle, 'title' | 'content' | 'category' | 'tags' | 'status' | 'visibility'>>): Promise<KnowledgeArticle | null> {
    const fields: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); vals.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); vals.push(updates.content); }
    if (updates.category !== undefined) { fields.push('category = ?'); vals.push(updates.category); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
    if (updates.status !== undefined) { fields.push('status = ?'); vals.push(updates.status); }
    if (updates.visibility !== undefined) { fields.push('visibility = ?'); vals.push(updates.visibility); }

    if (fields.length === 0) return this.getArticle(id);
    fields.push('updated_at = ?'); vals.push(new Date().toISOString()); vals.push(id);

    this.config.db.prepare(`UPDATE biz_knowledge_articles SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getArticle(id);
  }

  incrementView(id: string): void {
    this.config.db.prepare('UPDATE biz_knowledge_articles SET view_count = view_count + 1 WHERE id = ?').run(id);
  }

  markHelpful(id: string): void {
    this.config.db.prepare('UPDATE biz_knowledge_articles SET helpful_count = helpful_count + 1 WHERE id = ?').run(id);
  }

  private rowToArticle(row: any): KnowledgeArticle {
    return {
      id: row.id, workspaceId: row.workspace_id, title: row.title, slug: row.slug,
      content: row.content, category: row.category, tags: JSON.parse(row.tags),
      status: row.status, visibility: row.visibility, authorId: row.author_id,
      viewCount: row.view_count, helpfulCount: row.helpful_count,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
