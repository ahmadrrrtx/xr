/**
 * XR Business OS — Projects Module
 * 
 * Project management, task tracking, milestones, and time logging.
 * 
 * Integrates with:
 * - AI Workers: Project Manager manages tasks
 * - Automation: Task assignment, deadline alerts
 * - Calendar: Task due dates sync
 * - HR: Time tracking for employees
 */

import type { BusinessDatabase } from '../../core/database.js';
import type { BusinessEventBus } from '../../core/bus.js';
import type { AuditTrail } from '../../core/audit.js';
import type { Project, Task, Milestone, TaskStatus, TaskPriority, PaginatedResult, PaginationParams } from '../../core/types.js';

export interface ProjectsModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
  audit: AuditTrail;
}

export class ProjectsModule {
  constructor(private config: ProjectsModuleConfig) {}

  // ─── PROJECTS ───

  async createProject(workspaceId: string, params: {
    name: string;
    description?: string;
    status?: Project['status'];
    visibility?: Project['visibility'];
    ownerId: string;
    startDate?: string;
    endDate?: string;
    tags?: string[];
  }): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: Project = {
      id, workspaceId, name: params.name, description: params.description,
      status: params.status ?? 'planning', visibility: params.visibility ?? 'team',
      ownerId: params.ownerId, members: [{ memberId: params.ownerId, role: 'lead' }],
      startDate: params.startDate, endDate: params.endDate,
      tags: params.tags ?? [], createdAt: now, updatedAt: now,
    };

    this.config.db.prepare(`
      INSERT INTO biz_projects (id, workspace_id, name, description, status, visibility, owner_id, members, start_date, end_date, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.name, params.description ?? null,
      project.status, project.visibility, params.ownerId,
      JSON.stringify(project.members), params.startDate ?? null, params.endDate ?? null,
      JSON.stringify(project.tags), now, now);

    await this.config.bus.emit('project.created', {
      workspaceId, source: 'projects',
      payload: { projectId: id, name: params.name },
    });

    return project;
  }

  getProject(id: string): Project | null {
    const row = this.config.db.prepare('SELECT * FROM biz_projects WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToProject(row);
  }

  listProjects(workspaceId: string, params?: PaginationParams & { status?: string; ownerId?: string }): PaginatedResult<Project> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.ownerId) { where += ' AND owner_id = ?'; vals.push(params.ownerId); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_projects ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_projects ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return { data: data.map(r => this.rowToProject(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'visibility' | 'tags' | 'startDate' | 'endDate'>>): Promise<Project | null> {
    const fields: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); vals.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); vals.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); vals.push(updates.status); }
    if (updates.visibility !== undefined) { fields.push('visibility = ?'); vals.push(updates.visibility); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
    if (updates.startDate !== undefined) { fields.push('start_date = ?'); vals.push(updates.startDate); }
    if (updates.endDate !== undefined) { fields.push('end_date = ?'); vals.push(updates.endDate); }

    if (fields.length === 0) return this.getProject(id);
    fields.push('updated_at = ?'); vals.push(new Date().toISOString()); vals.push(id);

    this.config.db.prepare(`UPDATE biz_projects SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getProject(id);
  }

  // ─── TASKS ───

  async createTask(workspaceId: string, params: {
    projectId?: string;
    parentId?: string;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string;
    reporterId?: string;
    dueDate?: string;
    estimatedHours?: number;
    tags?: string[];
  }): Promise<Task> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id, workspaceId, projectId: params.projectId, parentId: params.parentId,
      title: params.title, description: params.description,
      status: params.status ?? 'todo', priority: params.priority ?? 'medium',
      assigneeId: params.assigneeId, reporterId: params.reporterId,
      dueDate: params.dueDate, estimatedHours: params.estimatedHours,
      tags: params.tags ?? [], dependencies: [], attachments: [],
      createdAt: now, updatedAt: now,
    };

    this.config.db.prepare(`
      INSERT INTO biz_tasks (id, workspace_id, project_id, parent_id, title, description, status, priority, assignee_id, reporter_id, due_date, estimated_hours, tags, dependencies, attachments, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, params.projectId ?? null, params.parentId ?? null,
      params.title, params.description ?? null, task.status, task.priority,
      params.assigneeId ?? null, params.reporterId ?? null, params.dueDate ?? null,
      params.estimatedHours ?? null, JSON.stringify(task.tags),
      JSON.stringify([]), JSON.stringify([]), now, now);

    await this.config.bus.emit('task.created', {
      workspaceId, source: 'projects',
      payload: { taskId: id, title: params.title, projectId: params.projectId, assigneeId: params.assigneeId },
    });

    return task;
  }

  getTask(id: string): Task | null {
    const row = this.config.db.prepare('SELECT * FROM biz_tasks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToTask(row);
  }

  async updateTaskStatus(id: string, status: TaskStatus, actorId?: string): Promise<Task | null> {
    const task = this.getTask(id);
    if (!task) return null;

    this.config.db.prepare('UPDATE biz_tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);

    await this.config.bus.emit('task.status_changed', {
      workspaceId: task.workspaceId, source: 'projects',
      payload: { taskId: id, fromStatus: task.status, toStatus: status },
      actorId,
    });

    return this.getTask(id);
  }

  listTasks(workspaceId: string, params?: PaginationParams & {
    projectId?: string; status?: TaskStatus; priority?: TaskPriority; assigneeId?: string;
  }): PaginatedResult<Task> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.projectId) { where += ' AND project_id = ?'; vals.push(params.projectId); }
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.priority) { where += ' AND priority = ?'; vals.push(params.priority); }
    if (params?.assigneeId) { where += ' AND assignee_id = ?'; vals.push(params.assigneeId); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_tasks ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_tasks ${where} ORDER BY priority DESC, due_date ASC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return { data: data.map(r => this.rowToTask(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get project statistics.
   */
  getProjectStats(projectId: string): {
    total: number; byStatus: Record<string, number>; byPriority: Record<string, number>;
    estimatedHours: number; loggedHours: number; overdue: number;
  } {
    const total = (this.config.db.prepare('SELECT COUNT(*) as c FROM biz_tasks WHERE project_id = ?').get(projectId) as any)?.c ?? 0;

    const byStatus: Record<string, number> = {};
    const sRows = this.config.db.prepare('SELECT status, COUNT(*) as c FROM biz_tasks WHERE project_id = ? GROUP BY status').all(projectId) as any[];
    for (const r of sRows) byStatus[r.status] = r.c;

    const byPriority: Record<string, number> = {};
    const pRows = this.config.db.prepare('SELECT priority, COUNT(*) as c FROM biz_tasks WHERE project_id = ? GROUP BY priority').all(projectId) as any[];
    for (const r of pRows) byPriority[r.priority] = r.c;

    const hours = this.config.db.prepare('SELECT COALESCE(SUM(estimated_hours), 0) as est, COALESCE(SUM(logged_hours), 0) as logged FROM biz_tasks WHERE project_id = ?').get(projectId) as any;
    const now = new Date().toISOString();
    const overdue = (this.config.db.prepare("SELECT COUNT(*) as c FROM biz_tasks WHERE project_id = ? AND due_date < ? AND status NOT IN ('done', 'cancelled')").get(projectId, now) as any)?.c ?? 0;

    return { total, byStatus, byPriority, estimatedHours: hours?.est ?? 0, loggedHours: hours?.logged ?? 0, overdue };
  }

  // ─── MILESTONES ───

  async createMilestone(projectId: string, params: { name: string; description?: string; dueDate: string }): Promise<Milestone> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.config.db.prepare(`
      INSERT INTO biz_milestones (id, project_id, name, description, due_date, status, task_ids, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', '[]', ?)
    `).run(id, projectId, params.name, params.description ?? null, params.dueDate, now);
    return { id, projectId, ...params, status: 'pending', taskIds: [], createdAt: now };
  }

  private rowToProject(row: any): Project {
    return {
      id: row.id, workspaceId: row.workspace_id, name: row.name, description: row.description,
      status: row.status, visibility: row.visibility, ownerId: row.owner_id,
      members: JSON.parse(row.members), startDate: row.start_date, endDate: row.end_date,
      tags: JSON.parse(row.tags), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, parentId: row.parent_id,
      title: row.title, description: row.description, status: row.status, priority: row.priority,
      assigneeId: row.assignee_id, reporterId: row.reporter_id, dueDate: row.due_date,
      estimatedHours: row.estimated_hours, loggedHours: row.logged_hours,
      tags: JSON.parse(row.tags), dependencies: JSON.parse(row.dependencies),
      attachments: JSON.parse(row.attachments), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
