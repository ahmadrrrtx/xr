/**
 * XR Business OS — HR Module
 * 
 * People directory, time-off management, and employee records.
 * 
 * Integrates with:
 * - Core RBAC: Member management
 * - AI Workers: HR Manager handles people ops
 * - Scheduling: Time-off calendar integration
 * - Projects: Time tracking
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { Employee, TimeOffRequest, TimeOffType } from '../../core/types.ts';

export interface HRModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class HRModule {
  constructor(private config: HRModuleConfig) {}

  // ─── EMPLOYEES ───

  createEmployee(workspaceId: string, params: {
    memberId: string; department?: string; position?: string;
    startDate?: string; salary?: number; currency?: string;
  }): Employee {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_employees (id, workspace_id, member_id, department, position, start_date, salary, currency, status, custom_fields, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?)
    `).run(id, workspaceId, params.memberId, params.department ?? null,
      params.position ?? null, params.startDate ?? null,
      params.salary ?? null, params.currency ?? null, now);

    return { id, workspaceId, ...params, status: 'active', customFields: {}, createdAt: now };
  }

  getEmployee(id: string): Employee | null {
    const row = this.config.db.prepare('SELECT * FROM biz_employees WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEmployee(row);
  }

  listEmployees(workspaceId: string, params?: { department?: string; status?: string }): Employee[] {
    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.department) { where += ' AND department = ?'; vals.push(params.department); }
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }

    const rows = this.config.db.prepare(`SELECT * FROM biz_employees ${where} ORDER BY department, member_id`).all(...vals) as any[];
    return rows.map(r => this.rowToEmployee(r));
  }

  // ─── TIME OFF ───

  async requestTimeOff(employeeId: string, params: {
    type: TimeOffType; startDate: string; endDate: string; days: number; reason?: string;
  }): Promise<TimeOffRequest> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_time_off (id, employee_id, type, start_date, end_date, days, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, employeeId, params.type, params.startDate, params.endDate, params.days, params.reason ?? null, now);

    await this.config.bus.emit('hr.timeoff_requested', {
      workspaceId: this.getEmployee(employeeId)?.workspaceId ?? '',
      source: 'hr',
      payload: { requestId: id, employeeId, type: params.type, days: params.days },
    });

    return { id, employeeId, ...params, status: 'pending', createdAt: now };
  }

  async approveTimeOff(requestId: string, approvedBy: string): Promise<TimeOffRequest | null> {
    this.config.db.prepare("UPDATE biz_time_off SET status = 'approved', approved_by = ? WHERE id = ?").run(approvedBy, requestId);
    const row = this.config.db.prepare('SELECT * FROM biz_time_off WHERE id = ?').get(requestId) as any;
    if (!row) return null;

    await this.config.bus.emit('hr.timeoff_approved', {
      workspaceId: this.getEmployee(row.employee_id)?.workspaceId ?? '',
      source: 'hr',
      payload: { requestId, approvedBy },
    });

    return this.rowToTimeOff(row);
  }

  async rejectTimeOff(requestId: string): Promise<void> {
    this.config.db.prepare("UPDATE biz_time_off SET status = 'rejected' WHERE id = ?").run(requestId);
  }

  getTimeOffRequests(employeeId: string): TimeOffRequest[] {
    const rows = this.config.db.prepare('SELECT * FROM biz_time_off WHERE employee_id = ? ORDER BY start_date DESC').all(employeeId) as any[];
    return rows.map(r => this.rowToTimeOff(r));
  }

  /**
   * Get people directory with employee details.
   */
  getDirectory(workspaceId: string): { employee: Employee; department?: string; position?: string; status: string }[] {
    return this.listEmployees(workspaceId).map(e => ({
      employee: e, department: e.department, position: e.position, status: e.status,
    }));
  }

  private rowToEmployee(row: any): Employee {
    return {
      id: row.id, workspaceId: row.workspace_id, memberId: row.member_id,
      department: row.department, position: row.position, startDate: row.start_date,
      endDate: row.end_date, salary: row.salary, currency: row.currency,
      status: row.status, customFields: JSON.parse(row.custom_fields), createdAt: row.created_at,
    };
  }

  private rowToTimeOff(row: any): TimeOffRequest {
    return {
      id: row.id, employeeId: row.employee_id, type: row.type,
      startDate: row.start_date, endDate: row.end_date, days: row.days,
      reason: row.reason, status: row.status, approvedBy: row.approved_by, createdAt: row.created_at,
    };
  }

  isHealthy(): boolean { return true; }
}
