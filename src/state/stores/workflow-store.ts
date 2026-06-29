/**
 * XR Stage 12 — Multi-agent workflow store.
 *
 * Persists workflow graphs and individual tasks for status, resume, audit, and
 * CLI inspection. The JSON payload is the source of truth; flattened columns
 * keep list/status queries cheap.
 */

import { BaseStore } from "../store.ts";
import type { MultiAgentHealth, WorkflowRecord, WorkflowSummary } from "../../agents/types.ts";
import { workflowSummary } from "../../agents/planner.ts";

interface WorkflowRow {
  workflow_id: string;
  kind: string;
  goal: string;
  status: string;
  review_state: string;
  approval_state: string;
  cancellation_state: string;
  current_agent_id: string | null;
  plan_summary: string;
  final_output: string | null;
  data_json: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export class WorkflowStore extends BaseStore {
  constructor(path?: string) {
    super(path);
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflows (
        workflow_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        review_state TEXT NOT NULL,
        approval_state TEXT NOT NULL,
        cancellation_state TEXT NOT NULL,
        current_agent_id TEXT,
        plan_summary TEXT NOT NULL,
        final_output TEXT,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_tasks (
        task_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        parent_task_id TEXT,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        review_state TEXT NOT NULL,
        approval_state TEXT NOT NULL,
        phase TEXT,
        parallel_key TEXT,
        dependencies_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_agent_workflows_status ON agent_workflows(status);
      CREATE INDEX IF NOT EXISTS idx_agent_workflows_updated_at ON agent_workflows(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_workflow_status ON agent_tasks(workflow_id, status);
    `);
  }

  saveWorkflow(record: WorkflowRecord): void {
    const tx = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO agent_workflows (
            workflow_id, kind, goal, status, review_state, approval_state,
            cancellation_state, current_agent_id, plan_summary, final_output,
            data_json, created_at, updated_at, started_at, ended_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(workflow_id) DO UPDATE SET
            kind=excluded.kind,
            goal=excluded.goal,
            status=excluded.status,
            review_state=excluded.review_state,
            approval_state=excluded.approval_state,
            cancellation_state=excluded.cancellation_state,
            current_agent_id=excluded.current_agent_id,
            plan_summary=excluded.plan_summary,
            final_output=excluded.final_output,
            data_json=excluded.data_json,
            created_at=excluded.created_at,
            updated_at=excluded.updated_at,
            started_at=excluded.started_at,
            ended_at=excluded.ended_at`,
        )
        .run(
          record.workflowId,
          record.kind,
          record.goal,
          record.status,
          record.reviewState,
          record.approvalState,
          record.cancellationState,
          record.currentAgentId ?? null,
          record.planSummary,
          record.finalOutput ? JSON.stringify(record.finalOutput) : null,
          JSON.stringify(record),
          record.createdAt,
          record.updatedAt,
          record.startedAt ?? null,
          record.endedAt ?? null,
        );

      this.db.query(`DELETE FROM agent_tasks WHERE workflow_id=?`).run(record.workflowId);
      const insertTask = this.db.query(
        `INSERT INTO agent_tasks (
          task_id, workflow_id, parent_task_id, agent_id, role, name, status,
          review_state, approval_state, phase, parallel_key, dependencies_json,
          data_json, created_at, updated_at, started_at, ended_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const task of record.tasks) {
        insertTask.run(
          task.taskId,
          task.workflowId,
          task.parentTaskId ?? null,
          task.agentId,
          task.role,
          task.name,
          task.status,
          task.reviewState,
          task.approvalState,
          task.phase ?? null,
          task.parallelKey ?? null,
          JSON.stringify(task.dependencies),
          JSON.stringify(task),
          task.createdAt,
          task.updatedAt,
          task.startedAt ?? null,
          task.endedAt ?? null,
        );
      }
    });

    tx();
  }

  getWorkflow(workflowId: string): WorkflowRecord | null {
    const row = this.db
      .query<WorkflowRow, [string]>(`SELECT * FROM agent_workflows WHERE workflow_id=? LIMIT 1`)
      .get(workflowId);
    if (!row) return null;
    try {
      return JSON.parse(row.data_json) as WorkflowRecord;
    } catch {
      return null;
    }
  }

  listWorkflowSummaries(limit = 20): WorkflowSummary[] {
    const rows = this.db
      .query<WorkflowRow, [number]>(
        `SELECT * FROM agent_workflows ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit);
    const out: WorkflowSummary[] = [];
    for (const row of rows) {
      try {
        const record = JSON.parse(row.data_json) as WorkflowRecord;
        out.push(workflowSummary(record));
      } catch {
        // If the JSON is damaged, still surface a best-effort summary.
        out.push({
          workflowId: row.workflow_id,
          kind: row.kind as any,
          goal: row.goal,
          status: row.status as any,
          reviewState: row.review_state as any,
          approvalState: row.approval_state as any,
          cancellationState: row.cancellation_state as any,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          currentAgentId: row.current_agent_id ?? undefined,
          tasksTotal: 0,
          tasksCompleted: 0,
          tasksFailed: 0,
          tasksBlocked: 0,
          tasksAwaitingReview: 0,
        });
      }
    }
    return out;
  }

  health(): MultiAgentHealth {
    const total = this.db
      .query<{ c: number }, []>(`SELECT COUNT(*) c FROM agent_workflows`)
      .get()?.c ?? 0;
    const countByStatus = (status: string) =>
      this.db
        .query<{ c: number }, [string]>(`SELECT COUNT(*) c FROM agent_workflows WHERE status=?`)
        .get(status)?.c ?? 0;

    return {
      enabledAgents: 0,
      totalAgents: 0,
      workflows: {
        total,
        running: countByStatus("running"),
        paused: countByStatus("paused"),
        blocked: countByStatus("blocked"),
        failed: countByStatus("failed"),
      },
    };
  }
}
