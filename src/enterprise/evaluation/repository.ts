/**
 * XR 7.0 — Evaluation result repository (Phase 13).
 *
 * Append-only storage for evaluation runs, using the SAME SQLite path XR
 * already uses. Phase 13 does not introduce a second datastore, a telemetry
 * pipeline, or a distributed analytics platform.
 *
 * Integrity rules:
 *   - Results are append-only. There is no update path for a stored run body.
 *   - Every read recomputes the digest and reports mismatch.
 *   - A run may be INVALIDATED, never deleted. Invalidation is additive and
 *     preserves the original digest, so negative results cannot be erased.
 */

import { verifyIntegrity } from "./provenance.ts";
import {
  EVALUATION_SCHEMA_VERSION,
  type EvaluationRun,
  type RunInvalidation,
  type SuiteResult,
} from "./types.ts";

/** Minimal DB surface — matches the shape used across XR repositories. */
export interface EvaluationDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get<T = unknown>(...params: unknown[]): T | null | undefined;
    all<T = unknown>(...params: unknown[]): T[];
  };
}

/** Adapt a WorkspaceStore-like object into the EvaluationDb shape. */
export function adaptStoreForEvaluation(store: {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}): EvaluationDb {
  return {
    exec: (sql) => store.exec(sql),
    prepare: (sql) => {
      const stmt = store.prepare(sql);
      return {
        run: (...p) => stmt.run(...p),
        get: <T = unknown>(...p: unknown[]) => stmt.get(...p) as T | null | undefined,
        all: <T = unknown>(...p: unknown[]) => stmt.all(...p) as T[],
      };
    },
  };
}

interface RunRow {
  run_id: string;
  schema_version: string;
  product_version: string;
  commit_sha: string;
  started_at: number;
  finished_at: number | null;
  deployment_profile: string;
  registry_digest: string;
  digest: string;
  body: string;
  invalidated_at: number | null;
  invalidation_reason: string | null;
  invalidated_by: string | null;
}

export interface StoredRun {
  readonly run: EvaluationRun;
  /** Recomputed-at-read integrity check. */
  readonly integrityValid: boolean;
  readonly integrityDetail: string;
}

export interface RunQuery {
  readonly productVersion?: string;
  readonly deploymentProfile?: string;
  readonly limit?: number;
  /** Include runs that have been invalidated. Default false. */
  readonly includeInvalidated?: boolean;
}

export class EvaluationRepository {
  constructor(private readonly db: EvaluationDb) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_runs (
        run_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        product_version TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        deployment_profile TEXT NOT NULL,
        registry_digest TEXT NOT NULL,
        digest TEXT NOT NULL,
        body TEXT NOT NULL,
        invalidated_at INTEGER,
        invalidation_reason TEXT,
        invalidated_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_eval_runs_version ON evaluation_runs(product_version);
      CREATE INDEX IF NOT EXISTS idx_eval_runs_started ON evaluation_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS evaluation_scenario_index (
        run_id TEXT NOT NULL,
        suite_id TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        scenario_version INTEGER NOT NULL,
        dimension TEXT NOT NULL,
        scenario_set TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        PRIMARY KEY (run_id, scenario_id)
      );
      CREATE INDEX IF NOT EXISTS idx_eval_scen_scenario ON evaluation_scenario_index(scenario_id);
      CREATE INDEX IF NOT EXISTS idx_eval_scen_dimension ON evaluation_scenario_index(dimension);
    `);
  }

  /**
   * Persist a run. Append-only: re-saving the same run id is refused rather
   * than overwriting, so a later run cannot quietly replace a worse earlier one.
   */
  save(run: EvaluationRun): void {
    const existing = this.db
      .prepare(`SELECT run_id FROM evaluation_runs WHERE run_id = ?`)
      .get<{ run_id: string }>(run.provenance.runId);
    if (existing) {
      throw new Error(
        `Evaluation run "${run.provenance.runId}" already exists. Results are append-only; ` +
          `use invalidate() to mark a result superseded rather than overwriting it.`,
      );
    }

    this.db
      .prepare(
        `INSERT INTO evaluation_runs
         (run_id, schema_version, product_version, commit_sha, started_at, finished_at,
          deployment_profile, registry_digest, digest, body, invalidated_at, invalidation_reason, invalidated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)`,
      )
      .run(
        run.provenance.runId,
        run.provenance.schemaVersion,
        run.provenance.productVersion,
        run.provenance.commit,
        run.provenance.startedAt,
        run.provenance.finishedAt ?? null,
        run.provenance.configuration.deploymentProfile,
        run.provenance.registryDigest,
        run.integrity.digest,
        JSON.stringify({ provenance: run.provenance, suites: run.suites }),
      );

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO evaluation_scenario_index
       (run_id, suite_id, scenario_id, scenario_version, dimension, scenario_set, status, duration_ms)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const suite of run.suites) {
      for (const s of suite.scenarios) {
        stmt.run(
          run.provenance.runId,
          suite.suiteId,
          s.scenarioId,
          s.scenarioVersion,
          s.dimension,
          s.set,
          s.status,
          s.durationMs,
        );
      }
    }
  }

  get(runId: string): StoredRun | null {
    const row = this.db.prepare(`SELECT * FROM evaluation_runs WHERE run_id = ?`).get<RunRow>(runId);
    if (!row) return null;
    return this.hydrate(row);
  }

  list(query: RunQuery = {}): StoredRun[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.productVersion) {
      clauses.push("product_version = ?");
      params.push(query.productVersion);
    }
    if (query.deploymentProfile) {
      clauses.push("deployment_profile = ?");
      params.push(query.deploymentProfile);
    }
    if (!query.includeInvalidated) clauses.push("invalidated_at IS NULL");

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
    const rows = this.db
      .prepare(`SELECT * FROM evaluation_runs ${where} ORDER BY started_at DESC LIMIT ?`)
      .all<RunRow>(...params, limit);
    return rows.map((r) => this.hydrate(r));
  }

  /** Most recent valid run for a product version, if any. */
  latestFor(productVersion: string, deploymentProfile?: string): StoredRun | null {
    const runs = this.list({
      productVersion,
      ...(deploymentProfile ? { deploymentProfile } : {}),
      limit: 1,
    });
    return runs[0] ?? null;
  }

  /**
   * Mark a run invalid.
   *
   * The body is NEVER deleted or rewritten — §17 requires that rollback never
   * happens by deleting negative results. The original digest stays verifiable.
   */
  invalidate(runId: string, reason: string, invalidatedBy: string, now = Date.now()): RunInvalidation {
    const stored = this.get(runId);
    if (!stored) throw new Error(`Unknown evaluation run "${runId}"`);
    if (stored.run.invalidation) return stored.run.invalidation;

    this.db
      .prepare(
        `UPDATE evaluation_runs SET invalidated_at = ?, invalidation_reason = ?, invalidated_by = ? WHERE run_id = ?`,
      )
      .run(now, reason, invalidatedBy, runId);

    return Object.freeze({
      invalidatedAt: now,
      reason,
      invalidatedBy,
      originalDigest: stored.run.integrity.digest,
    });
  }

  /**
   * Invalidate every run whose scenario registry differs from the current one.
   * Used when scenario definitions change in a way that makes prior results
   * incomparable.
   */
  invalidateForRegistryChange(currentRegistryDigest: string, reason: string, by: string, now = Date.now()): string[] {
    const rows = this.db
      .prepare(`SELECT run_id FROM evaluation_runs WHERE registry_digest != ? AND invalidated_at IS NULL`)
      .all<{ run_id: string }>(currentRegistryDigest);
    const invalidated: string[] = [];
    for (const r of rows) {
      this.invalidate(r.run_id, reason, by, now);
      invalidated.push(r.run_id);
    }
    return invalidated;
  }

  /** Verify every stored run's integrity by recomputation. */
  verifyAll(): { runId: string; valid: boolean; detail: string }[] {
    const rows = this.db.prepare(`SELECT * FROM evaluation_runs ORDER BY started_at ASC`).all<RunRow>();
    return rows.map((row) => {
      const stored = this.hydrate(row);
      return { runId: row.run_id, valid: stored.integrityValid, detail: stored.integrityDetail };
    });
  }

  /** Historical statuses for one scenario, newest first. */
  history(scenarioId: string, limit = 20): {
    runId: string;
    productVersion: string;
    status: string;
    scenarioVersion: number;
    startedAt: number;
  }[] {
    return this.db
      .prepare(
        `SELECT i.run_id AS runId, r.product_version AS productVersion, i.status AS status,
                i.scenario_version AS scenarioVersion, r.started_at AS startedAt
         FROM evaluation_scenario_index i
         JOIN evaluation_runs r ON r.run_id = i.run_id
         WHERE i.scenario_id = ? AND r.invalidated_at IS NULL
         ORDER BY r.started_at DESC
         LIMIT ?`,
      )
      .all(scenarioId, Math.max(1, Math.min(limit, 200))) as {
      runId: string;
      productVersion: string;
      status: string;
      scenarioVersion: number;
      startedAt: number;
    }[];
  }

  count(): number {
    return this.db.prepare(`SELECT COUNT(*) AS c FROM evaluation_runs`).get<{ c: number }>()?.c ?? 0;
  }

  private hydrate(row: RunRow): StoredRun {
    const parsed = JSON.parse(row.body) as { provenance: EvaluationRun["provenance"]; suites: SuiteResult[] };
    const run: EvaluationRun = Object.freeze({
      provenance: parsed.provenance,
      suites: parsed.suites,
      integrity: Object.freeze({
        algorithm: "sha256" as const,
        digest: row.digest,
        registryDigest: row.registry_digest,
      }),
      ...(row.invalidated_at
        ? {
            invalidation: Object.freeze({
              invalidatedAt: row.invalidated_at,
              reason: row.invalidation_reason ?? "unspecified",
              invalidatedBy: row.invalidated_by ?? "unknown",
              originalDigest: row.digest,
            }),
          }
        : {}),
    });

    const check = verifyIntegrity(run);
    const schemaOk = row.schema_version === EVALUATION_SCHEMA_VERSION;

    return Object.freeze({
      run,
      integrityValid: check.valid,
      integrityDetail: check.valid
        ? schemaOk
          ? "digest recomputed and matches the stored value"
          : `digest matches, but the run was written under schema "${row.schema_version}" (current: "${EVALUATION_SCHEMA_VERSION}")`
        : `INTEGRITY MISMATCH: stored ${check.expected.slice(0, 16)}…, recomputed ${check.actual.slice(0, 16)}…`,
    });
  }
}
