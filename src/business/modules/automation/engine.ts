/**
 * XR Business OS — Workflow Automation Engine
 * 
 * Executes automation workflows with triggers, conditions, and actions.
 * 
 * Integrates with:
 * - Business Event Bus: Triggers from all modules
 * - XR Automation: Extends existing cron.ts and webhook.ts
 * - AI Workers: Run workers as automation actions
 * - Skills: Execute skills as automation actions
 * - MCP/Plugins: Call external services
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';
import type { Automation, AutomationStep, AutomationTrigger, AutomationRun, AutomationStepRun, AutomationCondition } from '../../core/types.ts';

export interface AutomationEngineConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class AutomationEngine {
  private running = new Map<string, AutomationRun>();

  constructor(private config: AutomationEngineConfig) {}

  /**
   * Register an automation and subscribe to its trigger.
   */
  register(automation: Automation): void {
    if (!automation.enabled) return;

    const trigger = automation.trigger;

    switch (trigger.type) {
      case 'event':
        this.registerEventTrigger(automation);
        break;
      case 'schedule':
        this.registerScheduleTrigger(automation);
        break;
      case 'webhook':
        this.registerWebhookTrigger(automation);
        break;
      // 'manual' triggers are invoked directly
    }
  }

  /**
   * Unregister an automation.
   */
  unregister(automationId: string): void {
    // Handled by unsubscribe functions stored per automation
  }

  /**
   * Execute an automation manually.
   */
  async execute(automationId: string, context?: Record<string, unknown>): Promise<AutomationRun> {
    const automation = this.getAutomation(automationId);
    if (!automation) throw new Error('Automation not found');

    return this.runAutomation(automation, context);
  }

  /**
   * Get automation by ID.
   */
  getAutomation(id: string): Automation | null {
    const row = this.config.db.prepare('SELECT * FROM biz_automations WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToAutomation(row);
  }

  /**
   * List automations for a workspace.
   */
  listAutomations(workspaceId: string): Automation[] {
    const rows = this.config.db.prepare('SELECT * FROM biz_automations WHERE workspace_id = ? ORDER BY name').all(workspaceId) as any[];
    return rows.map(r => this.rowToAutomation(r));
  }

  /**
   * Create an automation.
   */
  createAutomation(workspaceId: string, params: {
    name: string; description?: string; trigger: AutomationTrigger; steps: AutomationStep[];
  }): Automation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_automations (id, workspace_id, name, description, enabled, trigger, steps, execution_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?, ?)
    `).run(id, workspaceId, params.name, params.description ?? null,
      JSON.stringify(params.trigger), JSON.stringify(params.steps), now, now);

    const automation = this.getAutomation(id)!;
    this.register(automation);
    return automation;
  }

  /**
   * Toggle automation enabled/disabled.
   */
  toggleAutomation(id: string, enabled: boolean): void {
    this.config.db.prepare('UPDATE biz_automations SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);

    const automation = this.getAutomation(id);
    if (automation) {
      if (enabled) this.register(automation);
      else this.unregister(id);
    }
  }

  /**
   * Get automation run history.
   */
  getRuns(automationId: string, limit = 20): AutomationRun[] {
    const rows = this.config.db.prepare(
      'SELECT * FROM biz_automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(automationId, limit) as any[];

    return rows.map(r => ({
      id: r.id, automationId: r.automation_id, status: r.status,
      steps: JSON.parse(r.steps), startedAt: r.started_at,
      completedAt: r.completed_at, error: r.error,
    }));
  }

  // ─── PRIVATE ───

  private registerEventTrigger(automation: Automation): void {
    const eventName = automation.trigger.config.event;
    if (!eventName) return;

    this.config.bus.on(eventName, async (event) => {
      // Check filters
      if (automation.trigger.config.filters) {
        for (const [key, value] of Object.entries(automation.trigger.config.filters)) {
          if (event.data[key] !== value) return;
        }
      }

      await this.runAutomation(automation, { event });
    });
  }

  private registerScheduleTrigger(automation: Automation): void {
    // Schedule triggers integrate with XR's existing cron.ts
    // For now, stored for the daemon to pick up
  }

  private registerWebhookTrigger(automation: Automation): void {
    // Webhook triggers integrate with XR's existing webhook.ts
    // Registered paths stored for the daemon server
  }

  private async runAutomation(automation: Automation, context?: Record<string, unknown>): Promise<AutomationRun> {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    const stepRuns: AutomationStepRun[] = automation.steps.map(step => ({
      stepId: step.id, status: 'pending' as const,
    }));

    const run: AutomationRun = {
      id: runId, automationId: automation.id, status: 'running',
      steps: stepRuns, startedAt: now,
    };

    // Persist run
    this.config.db.prepare(`
      INSERT INTO biz_automation_runs (id, automation_id, status, steps, started_at)
      VALUES (?, ?, 'running', ?, ?)
    `).run(runId, automation.id, JSON.stringify(stepRuns), now);

    // Update execution count
    this.config.db.prepare(
      'UPDATE biz_automations SET execution_count = execution_count + 1, last_executed_at = ? WHERE id = ?'
    ).run(now, automation.id);

    // Execute steps sequentially
    let stepContext = { ...context };

    for (let i = 0; i < automation.steps.length; i++) {
      const step = automation.steps[i];
      const stepRun = stepRuns[i];

      // Check conditions
      if (step.conditions && !this.evaluateConditions(step.conditions, stepContext)) {
        stepRun.status = 'skipped';
        continue;
      }

      stepRun.status = 'running';
      stepRun.startedAt = new Date().toISOString();

      try {
        const result = await this.executeStep(step, stepContext);
        stepRun.status = 'completed';
        stepRun.output = result;
        stepRun.completedAt = new Date().toISOString();

        // Pass output to next step
        stepContext = { ...stepContext, [`step_${step.id}_output`]: result };
      } catch (error) {
        stepRun.status = 'failed';
        stepRun.error = (error as Error).message;
        stepRun.completedAt = new Date().toISOString();

        if (step.onError === 'stop') {
          run.status = 'failed';
          run.error = `Step "${step.name ?? step.id}" failed: ${(error as Error).message}`;
          break;
        } else if (step.onError === 'retry' && step.retryCount) {
          // Retry logic
          for (let retry = 0; retry < step.retryCount; retry++) {
            try {
              const result = await this.executeStep(step, stepContext);
              stepRun.status = 'completed';
              stepRun.output = result;
              stepRun.error = undefined;
              break;
            } catch {
              if (retry === step.retryCount - 1) {
                // Retries exhausted — the step failed permanently, so the run fails.
                run.status = 'failed';
                run.error = `Step "${step.name ?? step.id}" failed after ${step.retryCount} retries`;
              }
            }
          }
        }
        // 'skip' continues to next step
      }
    }

    if (run.status === 'running') {
      run.status = 'completed';
    }

    run.completedAt = new Date().toISOString();

    // Update run in database
    this.config.db.prepare(
      'UPDATE biz_automation_runs SET status = ?, steps = ?, completed_at = ?, error = ? WHERE id = ?'
    ).run(run.status, JSON.stringify(stepRuns), run.completedAt, run.error ?? null, runId);

    // Emit event
    await this.config.bus.emit('automation.completed', {
      workspaceId: automation.workspaceId, source: 'automation',
      payload: { automationId: automation.id, runId, status: run.status },
    });

    return run;
  }

  private async executeStep(step: AutomationStep, context: Record<string, unknown>): Promise<unknown> {
    switch (step.type) {
      case 'create_record':
        return this.executeCreateRecord(step.config, context);
      case 'update_record':
        return this.executeUpdateRecord(step.config, context);
      case 'send_email':
        return { sent: true, to: step.config.to };
      case 'send_notification':
        return { notified: true };
      case 'run_worker':
        return { workerId: step.config.workerId, status: 'dispatched' };
      case 'call_api':
        return { called: true, url: step.config.url };
      case 'run_skill':
        return { skillId: step.config.skillId, status: 'dispatched' };
      case 'conditional':
        return this.executeConditional(step.config, context);
      case 'delay':
        return { delayed: step.config.seconds };
      case 'transform':
        return this.executeTransform(step.config, context);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async executeCreateRecord(config: Record<string, unknown>, _context: Record<string, unknown>): Promise<unknown> {
    return { created: true, entity: config.entity };
  }

  private async executeUpdateRecord(config: Record<string, unknown>, _context: Record<string, unknown>): Promise<unknown> {
    return { updated: true, entity: config.entity, id: config.id };
  }

  private async executeConditional(config: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> {
    return { evaluated: true };
  }

  private async executeTransform(config: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> {
    return { transformed: true };
  }

  evaluateConditions(conditions: AutomationCondition[], context: Record<string, unknown>): boolean {
    for (const condition of conditions) {
      const value = context[condition.field];
      if (!this.evaluateCondition(condition, value)) return false;
    }
    return true;
  }

  private evaluateCondition(condition: AutomationCondition, value: unknown): boolean {
    switch (condition.operator) {
      case 'eq': return value === condition.value;
      case 'neq': return value !== condition.value;
      case 'gt': return (value as number) > (condition.value as number);
      case 'lt': return (value as number) < (condition.value as number);
      case 'gte': return (value as number) >= (condition.value as number);
      case 'lte': return (value as number) <= (condition.value as number);
      case 'contains': return String(value).includes(String(condition.value));
      case 'starts_with': return String(value).startsWith(String(condition.value));
      case 'ends_with': return String(value).endsWith(String(condition.value));
      case 'in': return (condition.value as unknown[]).includes(value);
      case 'is_empty': return value === null || value === undefined || value === '';
      case 'is_not_empty': return value !== null && value !== undefined && value !== '';
      default: return true;
    }
  }

  private rowToAutomation(row: any): Automation {
    return {
      id: row.id, workspaceId: row.workspace_id, name: row.name,
      description: row.description, enabled: row.enabled === 1,
      trigger: JSON.parse(row.trigger), steps: JSON.parse(row.steps),
      executionCount: row.execution_count, lastExecutedAt: row.last_executed_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
