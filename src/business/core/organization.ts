/**
 * XR Business OS — Organization Management
 * 
 * Top-level tenant. Users belong to one organization.
 * Integrates with XR's Memory Engine for persistence.
 */

import { BusinessDatabase } from './database.ts';
import type { Organization, OrgSettings, OrgRole } from './types.ts';

const DEFAULT_ORG_SETTINGS: OrgSettings = {
  defaultCurrency: 'USD',
  timezone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  language: 'en',
  fiscalYearStart: 1,
  auditRetentionDays: 365,
  maxWorkspaces: 10,
  maxMembers: 50,
  allowedIntegrations: [],
  blockedIntegrations: [],
};

export class OrganizationManager {
  constructor(private db: BusinessDatabase) {}

  /**
   * Create a new organization.
   */
  create(params: {
    name: string;
    slug: string;
    domain?: string;
    plan?: Organization['plan'];
    settings?: Partial<OrgSettings>;
    ownerId: string;
  }): Organization {
    const id = BusinessDatabase.generateId();
    const now = BusinessDatabase.now();
    const settings = { ...DEFAULT_ORG_SETTINGS, ...params.settings };

    this.db.prepare(`
      INSERT INTO biz_organizations (id, name, slug, domain, plan, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.name, params.slug, params.domain ?? null, params.plan ?? 'free',
      JSON.stringify(settings), now, now);

    // Create default workspace
    const wsId = BusinessDatabase.generateId();
    this.db.prepare(`
      INSERT INTO biz_workspaces (id, org_id, name, slug, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(wsId, id, 'Default', 'default', JSON.stringify({
      defaultCurrency: settings.defaultCurrency,
      timezone: settings.timezone,
      modules: ['crm', 'sales', 'support', 'projects', 'analytics'],
      integrations: [],
      aiWorkersEnabled: true,
      automationEnabled: true,
    }), now, now);

    // Add owner as member
    const memberId = BusinessDatabase.generateId();
    this.db.prepare(`
      INSERT INTO biz_members (id, org_id, user_id, email, name, role, workspaces, status, created_at)
      VALUES (?, ?, ?, '', 'Owner', ?, ?, 'active', ?)
    `).run(memberId, id, params.ownerId, 'owner',
      JSON.stringify([{ workspaceId: wsId, role: 'owner' as OrgRole, modules: [] }]), now);

    return this.getById(id)!;
  }

  /**
   * Get organization by ID.
   */
  getById(id: string): Organization | null {
    const row = this.db.prepare(
      'SELECT * FROM biz_organizations WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;
    return this.rowToOrg(row);
  }

  /**
   * Get organization by slug.
   */
  getBySlug(slug: string): Organization | null {
    const row = this.db.prepare(
      'SELECT * FROM biz_organizations WHERE slug = ?'
    ).get(slug) as any;

    if (!row) return null;
    return this.rowToOrg(row);
  }

  /**
   * Update organization.
   */
  update(id: string, updates: Partial<Pick<Organization, 'name' | 'domain' | 'logo' | 'plan' | 'settings'>>): Organization | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.domain !== undefined) { fields.push('domain = ?'); values.push(updates.domain); }
    if (updates.logo !== undefined) { fields.push('logo = ?'); values.push(updates.logo); }
    if (updates.plan !== undefined) { fields.push('plan = ?'); values.push(updates.plan); }
    if (updates.settings !== undefined) { fields.push('settings = ?'); values.push(JSON.stringify(updates.settings)); }

    if (fields.length === 0) return this.getById(id);

    fields.push('updated_at = ?');
    values.push(BusinessDatabase.now());
    values.push(id);

    this.db.prepare(
      `UPDATE biz_organizations SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);

    return this.getById(id);
  }

  /**
   * Delete organization (cascade deletes workspaces and all data).
   */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM biz_organizations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * List all organizations for a user.
   */
  listForUser(userId: string): Organization[] {
    const rows = this.db.prepare(`
      SELECT o.* FROM biz_organizations o
      JOIN biz_members m ON m.org_id = o.id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY o.name
    `).all(userId) as any[];

    return rows.map(r => this.rowToOrg(r));
  }

  /**
   * Update organization settings.
   */
  updateSettings(id: string, settings: Partial<OrgSettings>): Organization | null {
    const org = this.getById(id);
    if (!org) return null;
    return this.update(id, { settings: { ...org.settings, ...settings } });
  }

  private rowToOrg(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      domain: row.domain,
      logo: row.logo,
      plan: row.plan,
      settings: JSON.parse(row.settings),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
