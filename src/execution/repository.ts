/**
 * XR 4.1 — Execution Repository
 *
 * Persists canonical execution records to the workspace SQLite store.
 * Uses the existing WorkspaceStore patterns: one table per aggregate,
 * additive migration, redaction/truncation of large payloads, safe failure
 * handling (persistence failure does not fabricate success).
 *
 * No event sourcing. One row per execution. Blob columns are bounded JSON.
 */
import { EXECUTION_BOUNDS } from "./types.ts";
import type { ExecutionRecord, ExecutionQuery, ExecutionSummary } from "./types.ts";
import { ExecutionPersistenceError } from "./errors.ts";

const TABLE = "execution_records";

/**
 * The WorkspaceStore-style dependency we require. We use a narrow interface
 * so tests can substitute an in-memory fake. WorkspaceStore satisfies this
 * via the methods we rely on (it forwards to the underlying bun:sqlite db
 * through helper methods; we add exec passthroughs below).
 */
export interface ExecutionDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get<T = unknown>(...params: unknown[]): T | null | undefined;
    all<T = unknown>(...params: unknown[]): T[];
    // Match bun:sqlite's generic signatures — use `as any` casts inside caller
  };
}

/**
 * Adapter: wraps a WorkspaceStore (which already has prepare/exec) into the
 * ExecutionDb shape. WorkspaceStore returns `unknown` from get()/all() in its
 * current type signature; this wrapper coerces safely.
 */
export function adaptWorkspaceStore(store: {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}): ExecutionDb {
  return {
    exec: (sql) => store.exec(sql),
    prepare: (sql) => {
      const stmt = store.prepare(sql);
      return {
        run: (...params) => stmt.run(...params),
        get: <T = unknown>(...params: unknown[]) => stmt.get(...params) as T | null | undefined,
        all: <T = unknown>(...params: unknown[]) => stmt.all(...params) as T[],
      };
    },
  };
}

export class ExecutionRepo {
  constructor(private readonly db: ExecutionDb) {}

  /**
   * Idempotent schema migration. Called from WorkspaceStore.migrate() for
   * unified migration (preferred), and defensively here for direct callers.
   */
  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        run_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        parent_run_id TEXT,
        retry_of TEXT,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        workflow_id TEXT,
        task_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL,
        outcome_kind TEXT,
        actor_kind TEXT NOT NULL,
        actor_name TEXT,
        capability_kind TEXT NOT NULL,
        capability_name TEXT NOT NULL,
        placement TEXT NOT NULL DEFAULT 'in_process',
        is_dry_run INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        cost_usd REAL,
        message TEXT,
        adapter_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exec_workspace ON ${TABLE}(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exec_session ON ${TABLE}(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_exec_workflow ON ${TABLE}(workflow_id, task_id);
      CREATE INDEX IF NOT EXISTS idx_exec_correlation ON ${TABLE}(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_exec_state ON ${TABLE}(workspace_id, state);
      CREATE INDEX IF NOT EXISTS idx_exec_capability ON ${TABLE}(workspace_id, capability_kind, created_at DESC);
    `);
  }

  /** Insert a new execution record (or upsert by run_id). */
  save(record: ExecutionRecord): void {
    try {
      const serialized = this.serialize(record);
      this.db
        .prepare(
          `INSERT INTO ${TABLE} (
            run_id, correlation_id, parent_run_id, retry_of,
            workspace_id, session_id, workflow_id, task_id, attempt,
            state, outcome_kind,
            actor_kind, actor_name,
            capability_kind, capability_name,
            placement, is_dry_run,
            duration_ms, cost_usd, message,
            adapter_version,
            created_at, updated_at, started_at, ended_at,
            record_json
          ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?,
            ?, ?, ?, ?,
            ?
          )
          ON CONFLICT(run_id) DO UPDATE SET
            state = excluded.state,
            outcome_kind = excluded.outcome_kind,
            duration_ms = excluded.duration_ms,
            cost_usd = excluded.cost_usd,
            message = excluded.message,
            updated_at = excluded.updated_at,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            record_json = excluded.record_json`,
        )
        .run(
          record.id.runId,
          record.id.correlationId,
          record.id.parentRunId ?? null,
          record.retryOf ?? null,
          record.id.workspaceId,
          record.id.sessionId ?? null,
          record.id.workflowId ?? null,
          record.id.taskId ?? null,
          record.id.attempt,
          record.state,
          record.outcome?.kind ?? null,
          record.actor.kind,
          actorName(record.actor),
          record.action?.capability.kind ?? "model_call",
          record.action?.capability.name ?? record.intent.summary.slice(0, 80),
          record.action?.placement.kind ?? "in_process",
          record.action?.dryRun ? 1 : 0,
          record.durationMs ?? null,
          record.cost?.actualUsd ?? record.cost?.estimatedUsd ?? null,
          record.outcome?.message?.slice(0, EXECUTION_BOUNDS.MAX_MESSAGE_CHARS) ?? null,
          record.adapterVersion,
          record.createdAt,
          record.updatedAt,
          record.startedAt ?? null,
          record.endedAt ?? null,
          serialized,
        );
    } catch (err) {
      // Persistence failure must NOT fabricate a success outcome. The caller
      // is responsible for converting this into a "failed" or
      // "reconciliation_required" outcome — we just surface it.
      throw new ExecutionPersistenceError(record.id.runId, err instanceof Error ? err : undefined);
    }
  }

  /** Look up one record by run id. */
  get(runId: string): ExecutionRecord | null {
    const row = this.db
      .prepare(`SELECT record_json FROM ${TABLE} WHERE run_id = ?`)
      .get<{ record_json: string }>(runId);
    if (!row) return null;
    try {
      return JSON.parse(row.record_json) as ExecutionRecord;
    } catch {
      return null;
    }
  }

  /** Look up the latest execution record for a correlation id. */
  latestByCorrelation(correlationId: string): ExecutionRecord | null {
    const row = this.db
      .prepare(
        `SELECT record_json FROM ${TABLE} WHERE correlation_id = ? ORDER BY attempt DESC, created_at DESC LIMIT 1`,
      )
      .get<{ record_json: string }>(correlationId);
    if (!row) return null;
    try {
      return JSON.parse(row.record_json) as ExecutionRecord;
    } catch {
      return null;
    }
  }

  /** Check whether a completed execution with the given idempotency key exists. */
  findCompletedByIdempotencyKey(
    workspaceId: string,
    capabilityKind: string,
    capabilityName: string,
    idempotencyKey: string,
  ): ExecutionRecord | null {
    // We embed idempotency key in record_json, so we query candidate rows and filter in-process.
    // To keep this bounded we filter to terminal states of the same capability in the workspace.
    const rows = this.db
      .prepare(
        `SELECT record_json FROM ${TABLE}
         WHERE workspace_id = ? AND capability_kind = ? AND capability_name = ?
           AND state IN ('succeeded','partially_completed','failed','cancelled','timed_out','denied','budget_blocked')
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all<{ record_json: string }>(workspaceId, capabilityKind, capabilityName);
    for (const r of rows) {
      try {
        const rec = JSON.parse(r.record_json) as ExecutionRecord;
        if (rec.action?.idempotencyKey === idempotencyKey) return rec;
      } catch {
        // skip corrupt row
      }
    }
    return null;
  }

  /** Query execution summaries (lightweight — no full record_json). */
  query(query: ExecutionQuery): ExecutionSummary[] {
    const clauses: string[] = ["workspace_id = ?"];
    const params: unknown[] = [query.workspaceId];
    if (query.sessionId) {
      clauses.push("session_id = ?");
      params.push(query.sessionId);
    }
    if (query.workflowId) {
      clauses.push("workflow_id = ?");
      params.push(query.workflowId);
    }
    if (query.taskId) {
      clauses.push("task_id = ?");
      params.push(query.taskId);
    }
    if (query.state) {
      const states = Array.isArray(query.state) ? query.state : [query.state];
      clauses.push(`state IN (${states.map(() => "?").join(",")})`);
      params.push(...states);
    }
    if (query.capabilityKind) {
      clauses.push("capability_kind = ?");
      params.push(query.capabilityKind);
    }
    if (query.actorKind) {
      clauses.push("actor_kind = ?");
      params.push(query.actorKind);
    }
    if (query.sinceMs) {
      clauses.push("created_at >= ?");
      params.push(query.sinceMs);
    }
    if (query.untilMs) {
      clauses.push("created_at <= ?");
      params.push(query.untilMs);
    }
    const limit = Math.min(query.limit ?? EXECUTION_BOUNDS.DEFAULT_HISTORY_LIMIT, EXECUTION_BOUNDS.MAX_HISTORY_LIMIT);
    const offset = query.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT run_id, correlation_id, state, outcome_kind, capability_kind, capability_name,
                actor_kind, actor_name, session_id, workflow_id, task_id, attempt, placement,
                is_dry_run, duration_ms, cost_usd, message, created_at, updated_at
         FROM ${TABLE}
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all<{
        run_id: string;
        correlation_id: string;
        state: string;
        outcome_kind: string | null;
        capability_kind: string;
        capability_name: string;
        actor_kind: string;
        actor_name: string | null;
        session_id: string | null;
        workflow_id: string | null;
        task_id: string | null;
        attempt: number;
        placement: string;
        is_dry_run: number;
        duration_ms: number | null;
        cost_usd: number | null;
        message: string | null;
        created_at: number;
        updated_at: number;
      }>(...params, limit, offset);
    return rows.map((r) => ({
      runId: r.run_id,
      correlationId: r.correlation_id,
      state: r.state as ExecutionSummary["state"],
      outcome: (r.outcome_kind ?? undefined) as ExecutionSummary["outcome"],
      capability: `${r.capability_kind}:${r.capability_name}`,
      actor: r.actor_name ? `${r.actor_kind}:${r.actor_name}` : r.actor_kind,
      sessionId: r.session_id ?? undefined,
      workflowId: r.workflow_id ?? undefined,
      taskId: r.task_id ?? undefined,
      attempt: r.attempt,
      placement: r.placement,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      durationMs: r.duration_ms ?? undefined,
      costUsd: r.cost_usd ?? undefined,
      message: r.message ?? undefined,
      dryRun: r.is_dry_run === 1,
    }));
  }

  /** Count of executions in a workspace (for health/diagnostics). */
  count(workspaceId: string, sinceMs?: number): number {
    if (sinceMs) {
      const row = this.db
        .prepare(`SELECT COUNT(*) c FROM ${TABLE} WHERE workspace_id = ? AND created_at >= ?`)
        .get<{ c: number }>(workspaceId, sinceMs);
      return row?.c ?? 0;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) c FROM ${TABLE} WHERE workspace_id = ?`)
      .get<{ c: number }>(workspaceId);
    return row?.c ?? 0;
  }

  // ── Serialization with redaction/bounds ─────────────────────────────────

  private serialize(record: ExecutionRecord): string {
    // Defensive truncation before persisting. Adapters are expected to keep
    // payloads bounded, but this is our last line of defense.
    const safe = truncateRecord(record);
    return JSON.stringify(safe);
  }
}

function actorName(a: ExecutionRecord["actor"]): string | null {
  switch (a.kind) {
    case "user":
      return a.source;
    case "agent":
      return a.agentId;
    case "system":
      return a.component;
    case "workflow":
      return a.workflowId;
    case "plugin":
      return a.pluginId;
    case "skill":
      return a.skillId;
    case "mcp":
      return a.serverId;
    case "research":
      return a.sessionId;
    case "business":
      return a.module;
    default:
      return null;
  }
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 12) + "…<truncated>";
}

/** Apply payload bounds to a record for safe persistence. Pure function. */
export function truncateRecord<R extends ExecutionRecord>(r: R): R {
  const t = <T>(v: T | undefined, max: number): T | undefined => {
    if (typeof v === "string") return truncate(v, max) as unknown as T;
    return v;
  };
  const logs = r.observation?.logs?.slice(0, EXECUTION_BOUNDS.MAX_LOGS).map((l) => truncate(l, EXECUTION_BOUNDS.MAX_LOG_LINE_CHARS)!) ?? [];
  return {
    ...r,
    intent: {
      ...r.intent,
      summary: truncate(r.intent.summary, EXECUTION_BOUNDS.MAX_SUMMARY_CHARS)!,
    },
    plan: r.plan
      ? {
          ...r.plan,
          summary: truncate(r.plan.summary, EXECUTION_BOUNDS.MAX_SUMMARY_CHARS)!,
          preview: t(r.plan.preview, EXECUTION_BOUNDS.MAX_INPUT_SUMMARY_CHARS),
        }
      : undefined,
    action: r.action
      ? {
          ...r.action,
          inputSummary: truncate(r.action.inputSummary, EXECUTION_BOUNDS.MAX_INPUT_SUMMARY_CHARS)!,
        }
      : undefined,
    observation: r.observation
      ? {
          ...r.observation,
          summary: truncate(r.observation.summary, EXECUTION_BOUNDS.MAX_OBSERVATION_SUMMARY_CHARS)!,
          logs,
        }
      : undefined,
    outcome: r.outcome
      ? {
          ...r.outcome,
          message: truncate(r.outcome.message, EXECUTION_BOUNDS.MAX_MESSAGE_CHARS)!,
        }
      : undefined,
    evidence: r.evidence.slice(0, EXECUTION_BOUNDS.MAX_EVIDENCE),
    artifacts: r.artifacts.slice(0, EXECUTION_BOUNDS.MAX_ARTIFACTS),
    policy: r.policy.slice(-EXECUTION_BOUNDS.MAX_POLICY_DECISIONS),
    history: r.history.slice(-200),
  };
}
