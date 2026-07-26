/**
 * XR 5.0 — Workflow Repository
 *
 * Persists workflow definitions and runs using the existing workspace store.
 * Definitions and runs are stored as JSON in SQLite with indexed lookup columns.
 */

import type { WorkspaceStore } from "../state/workspace-store.ts";
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowRunState,
  HumanDecision,
} from "./types.ts";

const DEF_TABLE = "workflow_definitions";
const RUN_TABLE = "workflow_runs";
const DECISION_TABLE = "workflow_human_decisions";

export class WorkflowRepository {
  constructor(private readonly store: WorkspaceStore) {
    this.migrate();
  }

  /** Idempotent schema migration. */
  migrate(): void {
    this.store.exec(`
      CREATE TABLE IF NOT EXISTS ${DEF_TABLE} (
        definition_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        schema_version TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        tags TEXT,
        authored_by TEXT,
        published_at INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        supersedes TEXT,
        parameters_json TEXT,
        definition_json TEXT NOT NULL,
        PRIMARY KEY (definition_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_wf_def_active ON ${DEF_TABLE}(active, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wf_def_name ON ${DEF_TABLE}(name, version DESC);
    `);

    this.store.exec(`
      CREATE TABLE IF NOT EXISTS ${RUN_TABLE} (
        run_id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        definition_version INTEGER NOT NULL,
        state TEXT NOT NULL,
        name TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        nodes_completed INTEGER NOT NULL DEFAULT 0,
        nodes_failed INTEGER NOT NULL DEFAULT 0,
        nodes_blocked INTEGER NOT NULL DEFAULT 0,
        nodes_awaiting_human INTEGER NOT NULL DEFAULT 0,
        cost_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        error TEXT,
        tags TEXT,
        initiated_by_json TEXT,
        run_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wf_run_state ON ${RUN_TABLE}(state, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wf_run_def ON ${RUN_TABLE}(definition_id, created_at DESC);
    `);

    this.store.exec(`
      CREATE TABLE IF NOT EXISTS ${DECISION_TABLE} (
        decision_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        decided_by_json TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        comment TEXT,
        evidence_json TEXT,
        requested_at INTEGER NOT NULL,
        decided_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resulting_transition TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wf_dec_run ON ${DECISION_TABLE}(run_id);
      CREATE INDEX IF NOT EXISTS idx_wf_dec_pending ON ${DECISION_TABLE}(run_id, decided_at);
    `);
  }

  // ── Definitions ──────────────────────────────────────────────────────────

  saveDefinition(def: WorkflowDefinition): void {
    this.store.prepare(`
      INSERT OR REPLACE INTO ${DEF_TABLE}
        (definition_id, version, name, description, schema_version, node_count, tags,
         authored_by, published_at, content_hash, active, supersedes, parameters_json, definition_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      def.definitionId, def.version, def.name, def.description ?? null,
      def.schemaVersion, def.nodes.length, JSON.stringify(def.tags),
      JSON.stringify(def.authoredBy), def.publishedAt, def.contentHash,
      def.active ? 1 : 0, def.supersedes ?? null,
      def.parameters ? JSON.stringify(def.parameters) : null,
      JSON.stringify(def),
    );
  }

  getDefinition(definitionId: string, version?: number): WorkflowDefinition | null {
    if (version !== undefined) {
      const row = this.store.prepare(
        `SELECT definition_json FROM ${DEF_TABLE} WHERE definition_id = ? AND version = ?`
      ).get(definitionId, version) as { definition_json: string } | undefined;
      return row ? JSON.parse(row.definition_json) : null;
    }
    // Latest version
    const row = this.store.prepare(
      `SELECT definition_json FROM ${DEF_TABLE} WHERE definition_id = ? ORDER BY version DESC LIMIT 1`
    ).get(definitionId) as { definition_json: string } | undefined;
    return row ? JSON.parse(row.definition_json) : null;
  }

  listDefinitions(opts: { limit?: number; activeOnly?: boolean } = {}): WorkflowDefinition[] {
    const limit = opts.limit ?? 50;
    if (opts.activeOnly) {
      const rows = this.store.prepare(
        `SELECT definition_json FROM ${DEF_TABLE} WHERE active = 1 ORDER BY published_at DESC LIMIT ?`
      ).all(limit) as { definition_json: string }[];
      return rows.map(r => JSON.parse(r.definition_json));
    }
    const rows = this.store.prepare(
      `SELECT definition_json FROM ${DEF_TABLE} ORDER BY published_at DESC LIMIT ?`
    ).all(limit) as { definition_json: string }[];
    return rows.map(r => JSON.parse(r.definition_json));
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  saveRun(run: WorkflowRun): void {
    const allStates = [...run.nodeStates.values()];
    // Serialize Map as entries array for JSON
    const runForJson = { ...run, nodeStatesArray: [...run.nodeStates.entries()] };
    this.store.prepare(`
      INSERT OR REPLACE INTO ${RUN_TABLE}
        (run_id, definition_id, definition_version, state, name, node_count,
         nodes_completed, nodes_failed, nodes_blocked, nodes_awaiting_human,
         cost_json, created_at, updated_at, started_at, ended_at, error, tags,
         initiated_by_json, run_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.runId, run.definitionId, run.definitionVersion,
      run.state, run.definitionSnapshot.name, allStates.length,
      allStates.filter(ns => ns.state === "completed" || ns.state === "skipped" || ns.state === "compensated").length,
      allStates.filter(ns => ns.state === "failed").length,
      allStates.filter(ns => ns.state === "blocked").length,
      allStates.filter(ns => ns.state === "waiting_approval" || ns.state === "waiting_review").length,
      JSON.stringify(run.cost),
      run.createdAt, run.updatedAt, run.startedAt ?? null, run.endedAt ?? null,
      run.error ?? null, JSON.stringify(run.tags),
      JSON.stringify(run.initiatedBy),
      JSON.stringify(runForJson),
    );
  }

  getRun(runId: string): WorkflowRun | null {
    const row = this.store.prepare(
      `SELECT run_json FROM ${RUN_TABLE} WHERE run_id = ?`
    ).get(runId) as { run_json: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.run_json) as any;
    // Deserialize Map from entries array
    if (Array.isArray(parsed.nodeStatesArray)) {
      parsed.nodeStates = new Map(parsed.nodeStatesArray);
      delete parsed.nodeStatesArray;
    } else if (parsed.nodeStates && typeof parsed.nodeStates === "object" && !(parsed.nodeStates instanceof Map)) {
      parsed.nodeStates = new Map(Object.entries(parsed.nodeStates));
    }
    return parsed as WorkflowRun;
  }

  listRuns(opts: { limit?: number; state?: WorkflowRunState; definitionId?: string }): WorkflowRunSummary[] {
    const limit = opts.limit ?? 20;
    let sql = `SELECT run_id, definition_id, definition_version, state, name, node_count,
      nodes_completed, nodes_failed, nodes_blocked, nodes_awaiting_human,
      cost_json, created_at, updated_at, started_at, ended_at, error
      FROM ${RUN_TABLE} WHERE 1=1`;
    const params: unknown[] = [];
    if (opts.state) { sql += " AND state = ?"; params.push(opts.state); }
    if (opts.definitionId) { sql += " AND definition_id = ?"; params.push(opts.definitionId); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = (this.store.prepare(sql).all as any)(...params) as any[];
    return rows.map((r: any) => ({
      runId: r.run_id, definitionId: r.definition_id, definitionVersion: r.definition_version,
      name: r.name, state: r.state as WorkflowRunState, nodeCount: r.node_count,
      nodesCompleted: r.nodes_completed, nodesFailed: r.nodes_failed,
      nodesBlocked: r.nodes_blocked, nodesAwaitingHuman: r.nodes_awaiting_human,
      cost: JSON.parse(r.cost_json ?? "{}"),
      createdAt: r.created_at, updatedAt: r.updated_at,
      startedAt: r.started_at, endedAt: r.ended_at, error: r.error,
    }));
  }

  // ── Human Decisions ──────────────────────────────────────────────────────

  saveHumanDecision(decision: HumanDecision): void {
    this.store.prepare(`
      INSERT OR REPLACE INTO ${DECISION_TABLE}
        (decision_id, run_id, node_id, kind, decided_by_json, decision_json, comment,
         evidence_json, requested_at, decided_at, expires_at, resulting_transition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.decisionId, decision.runId, decision.nodeId, decision.kind,
      JSON.stringify(decision.decidedBy), JSON.stringify(decision.decision),
      decision.comment ?? null, JSON.stringify(decision.evidenceShown),
      decision.requestedAt, decision.decidedAt, decision.expiresAt,
      decision.resultingTransition,
    );
  }

  getHumanDecision(decisionId: string): HumanDecision | null {
    const row = this.store.prepare(
      `SELECT * FROM ${DECISION_TABLE} WHERE decision_id = ?`
    ).get(decisionId) as any;
    if (!row) return null;
    return this.rowToDecision(row);
  }

  getPendingDecisions(opts: { limit?: number } = {}): HumanDecision[] {
    const limit = opts.limit ?? 50;
    const rows = this.store.prepare(
      `SELECT d.* FROM ${DECISION_TABLE} d
       JOIN ${RUN_TABLE} r ON d.run_id = r.run_id
       WHERE r.state IN ('awaiting_approval', 'awaiting_review')
       ORDER BY d.requested_at DESC LIMIT ?`
    ).all(limit) as any[];
    return rows.map(r => this.rowToDecision(r));
  }

  getDecisionsForRun(runId: string): HumanDecision[] {
    const rows = this.store.prepare(
      `SELECT * FROM ${DECISION_TABLE} WHERE run_id = ? ORDER BY decided_at DESC`
    ).all(runId) as any[];
    return rows.map(r => this.rowToDecision(r));
  }

  private rowToDecision(row: any): HumanDecision {
    return {
      decisionId: row.decision_id,
      runId: row.run_id,
      nodeId: row.node_id,
      kind: row.kind,
      decidedBy: JSON.parse(row.decided_by_json),
      decision: JSON.parse(row.decision_json),
      comment: row.comment,
      evidenceShown: JSON.parse(row.evidence_json ?? "[]"),
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      expiresAt: row.expires_at,
      resultingTransition: row.resulting_transition,
    };
  }
}
