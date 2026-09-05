/**
 * XR Business OS — Finance Module
 * 
 * Invoicing, expenses, P&L tracking, and financial reporting.
 * 
 * Integrates with:
 * - Sales Module: Generate invoices from closed deals
 * - AI Workers: Financial Analyst provides insights
 * - Automation: Invoice generation, payment reminders
 * - Communication: Send invoices via email
 * - Integrations: Stripe, PayPal for payments
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { AuditTrail } from '../../core/audit.ts';
import type { Invoice, InvoiceLineItem, InvoiceStatus, Expense, PaginatedResult, PaginationParams } from '../../core/types.ts';

export interface FinanceModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
  audit: AuditTrail;
}

export class FinanceModule {
  constructor(private config: FinanceModuleConfig) {}

  // ─── INVOICES ───

  async createInvoice(workspaceId: string, params: {
    contactId: string; dealId?: string; currency?: string; lineItems: Omit<InvoiceLineItem, 'id' | 'amount'>[];
    notes?: string; issuedAt?: string; dueAt?: string;
  }): Promise<Invoice> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Generate invoice number
    const lastInvoice = this.config.db.prepare(
      'SELECT number FROM biz_invoices WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(workspaceId) as any;
    const number = `INV-${String((lastInvoice ? parseInt(lastInvoice.number.replace('INV-', '')) : 0) + 1).padStart(5, '0')}`;

    // Calculate totals
    const lineItems: InvoiceLineItem[] = params.lineItems.map(li => ({
      id: crypto.randomUUID(), description: li.description, quantity: li.quantity,
      unitPrice: li.unitPrice, amount: li.quantity * li.unitPrice, taxRate: li.taxRate,
    }));
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    const tax = lineItems.reduce((sum, li) => sum + (li.amount * (li.taxRate ?? 0) / 100), 0);
    const total = subtotal + tax;

    this.config.db.prepare(`
      INSERT INTO biz_invoices (id, workspace_id, number, contact_id, deal_id, status, currency, line_items, subtotal, tax, total, issued_at, due_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, number, params.contactId, params.dealId ?? null,
      params.currency ?? 'USD', JSON.stringify(lineItems), subtotal, tax, total,
      params.issuedAt ?? null, params.dueAt ?? null, params.notes ?? null, now, now);

    await this.config.bus.emit('invoice.created', {
      workspaceId, source: 'finance',
      payload: { invoiceId: id, number, total, contactId: params.contactId },
    });

    return this.getInvoice(id)!;
  }

  getInvoice(id: string): Invoice | null {
    const row = this.config.db.prepare('SELECT * FROM biz_invoices WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToInvoice(row);
  }

  async updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice | null> {
    const now = new Date().toISOString();
    const updates = ['status = ?', 'updated_at = ?'];
    const vals: unknown[] = [status, now];

    if (status === 'sent') { updates.push('issued_at = ?'); vals.push(now); }
    if (status === 'paid') { updates.push('paid_at = ?'); vals.push(now); }

    vals.push(id);
    this.config.db.prepare(`UPDATE biz_invoices SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    const invoice = this.getInvoice(id);
    if (invoice) {
      await this.config.bus.emit(`invoice.${status}`, {
        workspaceId: invoice.workspaceId, source: 'finance',
        payload: { invoiceId: id, number: invoice.number, total: invoice.total },
      });
    }

    return invoice;
  }

  listInvoices(workspaceId: string, params?: PaginationParams & { status?: InvoiceStatus; contactId?: string }): PaginatedResult<Invoice> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.contactId) { where += ' AND contact_id = ?'; vals.push(params.contactId); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_invoices ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_invoices ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return { data: data.map(r => this.rowToInvoice(r)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── EXPENSES ───

  async createExpense(workspaceId: string, params: {
    category: string; description: string; amount: number; currency?: string;
    date: string; receiptUrl?: string; memberId?: string;
  }): Promise<Expense> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_expenses (id, workspace_id, category, description, amount, currency, date, receipt_url, member_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, workspaceId, params.category, params.description, params.amount,
      params.currency ?? 'USD', params.date, params.receiptUrl ?? null, params.memberId ?? null, now);

    return { id, workspaceId, ...params, currency: params.currency ?? 'USD', status: 'pending', createdAt: now };
  }

  listExpenses(workspaceId: string, params?: PaginationParams & { status?: string; category?: string }): PaginatedResult<Expense> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 25;
    const offset = (page - 1) * limit;

    let where = 'WHERE workspace_id = ?';
    const vals: unknown[] = [workspaceId];
    if (params?.status) { where += ' AND status = ?'; vals.push(params.status); }
    if (params?.category) { where += ' AND category = ?'; vals.push(params.category); }

    const total = (this.config.db.prepare(`SELECT COUNT(*) as c FROM biz_expenses ${where}`).get(...vals) as any)?.c ?? 0;
    const data = this.config.db.prepare(`SELECT * FROM biz_expenses ${where} ORDER BY date DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as any[];

    return {
      data: data.map(r => ({
        id: r.id, workspaceId: r.workspace_id, category: r.category, description: r.description,
        amount: r.amount, currency: r.currency, date: r.date, receiptUrl: r.receipt_url,
        memberId: r.member_id, status: r.status, createdAt: r.created_at,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  // ─── FINANCIAL REPORTS ───

  getPnL(workspaceId: string, startDate: string, endDate: string): {
    revenue: number; expenses: number; profit: number; margin: number;
    revenueByMonth: Record<string, number>; expensesByCategory: Record<string, number>;
  } {
    const revenue = (this.config.db.prepare(
      "SELECT COALESCE(SUM(total), 0) as v FROM biz_invoices WHERE workspace_id = ? AND status = 'paid' AND paid_at BETWEEN ? AND ?"
    ).get(workspaceId, startDate, endDate) as any)?.v ?? 0;

    const expenses = (this.config.db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as v FROM biz_expenses WHERE workspace_id = ? AND status IN ('approved', 'reimbursed') AND date BETWEEN ? AND ?"
    ).get(workspaceId, startDate, endDate) as any)?.v ?? 0;

    const profit = revenue - expenses;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const expensesByCategory: Record<string, number> = {};
    const catRows = this.config.db.prepare(
      "SELECT category, COALESCE(SUM(amount), 0) as v FROM biz_expenses WHERE workspace_id = ? AND status IN ('approved', 'reimbursed') AND date BETWEEN ? AND ? GROUP BY category"
    ).all(workspaceId, startDate, endDate) as any[];
    for (const r of catRows) expensesByCategory[r.category] = r.v;

    return { revenue, expenses, profit, margin, revenueByMonth: {}, expensesByCategory };
  }

  private rowToInvoice(row: any): Invoice {
    return {
      id: row.id, workspaceId: row.workspace_id, number: row.number,
      contactId: row.contact_id, dealId: row.deal_id, status: row.status,
      currency: row.currency, lineItems: JSON.parse(row.line_items),
      subtotal: row.subtotal, tax: row.tax, total: row.total,
      issuedAt: row.issued_at, dueAt: row.due_at, paidAt: row.paid_at,
      notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  isHealthy(): boolean { return true; }
}
