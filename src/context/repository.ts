/**
 * XR 4.5 — Context repository: additive, idempotent schema + typed CRUD.
 *
 * Design constraints (§9 audit / §10.3):
 *   • ADDITIVE ONLY. No existing table is modified destructively.
 *   • Idempotent. Safe to run on every open, on a fresh DB and on a 4.4 DB.
 *   • No content duplication — user memory stays in `user_memory`; this
 *     repository owns everything that is NOT user memory, plus the shared
 *     provenance / revocation / package / summary ledgers.
 *   • Bounded. Every list method takes a hard limit.
 */

import { randomUUID } from "node:crypto";
import {
  CONTEXT_BOUNDS,
  CONTEXT_SCHEMA_VERSION,
  boundText,
  computeFreshness,
  deriveTitle,
  emptyLinks,
  emptyUncertainty,
  isConsentState,
  isContextType,
  isLifecycleStage,
  isProvenanceKind,
  isTrustStatus,
  type ConsentState,
  type ContextItem,
  type ContextLinks,
  type ContextPackage,
  type ContextScope,
  type ContextType,
  type IndexState,
  type ProvenanceKind,
  type ProvenanceRef,
  type RetentionPolicy,
  type SensitivityLevel,
  type TrustStatus,
} from "./types.ts";

/** Narrow DB surface — mirrors `ExecutionDb` so we reuse the same adapter shape. */
export interface ContextDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get<T = unknown>(...params: unknown[]): T | null | undefined;
    all<T = unknown>(...params: unknown[]): T[];
  };
}

/**
 * Adapter: wraps a WorkspaceStore (which already exposes prepare/exec) into the
 * `ContextDb` shape. WorkspaceStore returns `unknown` from get()/all() in its
 * current signature; this wrapper coerces safely. Mirrors
 * `adaptWorkspaceStore` in `src/execution/repository.ts`.
 */
export function adaptStoreForContext(store: {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}): ContextDb {
  return {
    exec: (sql) => store.exec(sql),
    prepare: (sql) => {
      const stmt = store.prepare(sql);
      return {
        run: (...params) => stmt.run(...params),
        get: <T = unknown>(...params: unknown[]) => stmt.get(...params) as T | null | undefined,
        all: <T = unknown>(...params: unknown[]) => (stmt.all(...params) ?? []) as T[],
      };
    },
  };
}

const ITEMS = "context_items";
const PROV = "context_provenance";
const REVOCATIONS = "context_revocations";
const PACKAGES = "context_packages";
const SUMMARIES = "context_summaries";
const RESOLUTIONS = "context_conflict_resolutions"; // Phase 6 · T4
const OPS = "context_ops"; // Phase 6 · T6 — undo/evidence ledger

// ── Row shapes ─────────────────────────────────────────────────────────────

interface ItemRow {
  id: string;
  version: number;
  type: string;
  title: string;
  content: string;
  workspace_id: string;
  project_scope: string;
  user_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  trust_status: string;
  consent_state: string;
  consent_actor: string | null;
  consent_at: number | null;
  provenance_kind: string;
  provenance_ref: string | null;
  actor_kind: string;
  actor_name: string | null;
  source_observed_at: number | null;
  stale_after: number | null;
  expires_at: number | null;
  superseded_by: string | null;
  confidence: string;
  contradicted_by: string;
  user_confirmed: number;
  open_questions: string;
  sensitivity: string;
  retention: string;
  links_json: string;
  index_state: string;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedding: string | null;
  revoked_at: number | null;
  revoked_reason: string | null;
  deleted_at: number | null;
  tags: string;
  created_at: number;
  updated_at: number;
  last_accessed_at: number | null;
  access_count: number;
  lifecycle_stage: string | null; // Phase 6 · T1 (absent on pre-Phase-6 dbs)
  lifecycle_summarized_by: string | null;
}

export interface ResolutionRow {
  id: string;
  workspace_id: string;
  item_a: string;
  item_b: string;
  kind: string;
  resolution: string;
  decided_by: string;
  reason: string;
  created_at: number;
  undone_at: number | null;
}

export interface OpsRow {
  id: string;
  workspace_id: string;
  op: string;
  target_table: string;
  target_id: string;
  before_json: string;
  after_json: string;
  actor: string;
  reason: string;
  created_at: number;
  undone_at: number | null;
  undo_op_id: string | null;
}

interface ProvRow {
  id: string;
  item_id: string;
  kind: string;
  ref: string;
  label: string | null;
  observed_at: number | null;
  content_hash: string | null;
  created_at: number;
}

interface RevocationRow {
  id: string;
  item_id: string;
  item_kind: string;
  workspace_id: string;
  reason: string;
  actor: string;
  index_invalidated: number;
  created_at: number;
}

interface PackageRow {
  package_id: string;
  version: number;
  schema_version: number;
  workspace_id: string;
  run_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  query_intent: string;
  content_hash: string;
  total_items: number;
  total_chars: number;
  degraded: number;
  package_json: string;
  created_at: number;
}

interface SummaryRow {
  id: string;
  workspace_id: string;
  project_scope: string;
  task_id: string | null;
  summary: string;
  preserved: string;
  lost: string;
  source_item_ids: string;
  generation: number;
  lineage_parent: string | null;
  original_chars: number;
  compressed_chars: number;
  created_at: number;
}

// ── Repository ─────────────────────────────────────────────────────────────

export class ContextRepository {
  constructor(
    private readonly db: ContextDb,
    private readonly workspaceId: string = "default",
  ) {}

  /**
   * Idempotent, additive schema migration. Called from WorkspaceStore.migrate().
   * Never throws — a migration probe must never block startup.
   */
  migrate(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${ITEMS} (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL DEFAULT 1,
          type TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          project_scope TEXT NOT NULL DEFAULT 'global',
          user_id TEXT,
          task_id TEXT,
          agent_id TEXT,
          trust_status TEXT NOT NULL DEFAULT 'unknown',
          consent_state TEXT NOT NULL DEFAULT 'legacy_unknown',
          consent_actor TEXT,
          consent_at INTEGER,
          provenance_kind TEXT NOT NULL DEFAULT 'unknown',
          provenance_ref TEXT,
          actor_kind TEXT NOT NULL DEFAULT 'unknown',
          actor_name TEXT,
          source_observed_at INTEGER,
          stale_after INTEGER,
          expires_at INTEGER,
          superseded_by TEXT,
          confidence TEXT NOT NULL DEFAULT 'unknown',
          contradicted_by TEXT NOT NULL DEFAULT '',
          user_confirmed INTEGER NOT NULL DEFAULT 0,
          open_questions TEXT NOT NULL DEFAULT '',
          sensitivity TEXT NOT NULL DEFAULT 'unknown',
          retention TEXT NOT NULL DEFAULT 'durable',
          links_json TEXT NOT NULL DEFAULT '{}',
          index_state TEXT NOT NULL DEFAULT 'none',
          embedding_model TEXT,
          embedding_dim INTEGER,
          embedding TEXT,
          revoked_at INTEGER,
          revoked_reason TEXT,
          deleted_at INTEGER,
          tags TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_accessed_at INTEGER,
          access_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_scope ON ${ITEMS}(workspace_id, project_scope, type);
        CREATE INDEX IF NOT EXISTS idx_ctx_trust ON ${ITEMS}(workspace_id, trust_status);
        CREATE INDEX IF NOT EXISTS idx_ctx_live ON ${ITEMS}(workspace_id, deleted_at, revoked_at);
        CREATE INDEX IF NOT EXISTS idx_ctx_task ON ${ITEMS}(workspace_id, task_id);
        CREATE INDEX IF NOT EXISTS idx_ctx_updated ON ${ITEMS}(workspace_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ${PROV} (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          ref TEXT NOT NULL,
          label TEXT,
          observed_at INTEGER,
          content_hash TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_prov_item ON ${PROV}(item_id);
        CREATE INDEX IF NOT EXISTS idx_ctx_prov_ref ON ${PROV}(kind, ref);

        CREATE TABLE IF NOT EXISTS ${REVOCATIONS} (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          item_kind TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          actor TEXT NOT NULL,
          index_invalidated INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_revoke_item ON ${REVOCATIONS}(item_id);
        CREATE INDEX IF NOT EXISTS idx_ctx_revoke_ws ON ${REVOCATIONS}(workspace_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS ${PACKAGES} (
          package_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          schema_version INTEGER NOT NULL,
          workspace_id TEXT NOT NULL,
          run_id TEXT,
          task_id TEXT,
          agent_id TEXT,
          query_intent TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          total_items INTEGER NOT NULL,
          total_chars INTEGER NOT NULL,
          degraded INTEGER NOT NULL DEFAULT 0,
          package_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (package_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_pkg_run ON ${PACKAGES}(run_id);
        CREATE INDEX IF NOT EXISTS idx_ctx_pkg_created ON ${PACKAGES}(workspace_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS ${SUMMARIES} (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_scope TEXT NOT NULL,
          task_id TEXT,
          summary TEXT NOT NULL,
          preserved TEXT NOT NULL DEFAULT '',
          lost TEXT NOT NULL DEFAULT '',
          source_item_ids TEXT NOT NULL DEFAULT '',
          generation INTEGER NOT NULL DEFAULT 1,
          lineage_parent TEXT,
          original_chars INTEGER NOT NULL DEFAULT 0,
          compressed_chars INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_sum_task ON ${SUMMARIES}(workspace_id, task_id);
        CREATE INDEX IF NOT EXISTS idx_ctx_sum_created ON ${SUMMARIES}(workspace_id, created_at DESC);

        -- Phase 6 · T4: conflict resolutions (user-visible, undoable).
        CREATE TABLE IF NOT EXISTS ${RESOLUTIONS} (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_a TEXT NOT NULL,
          item_b TEXT NOT NULL,
          kind TEXT NOT NULL,
          resolution TEXT NOT NULL,
          decided_by TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          undone_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_res_ws ON ${RESOLUTIONS}(workspace_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ctx_res_items ON ${RESOLUTIONS}(item_a, item_b);

        -- Phase 6 · T6: the undo/evidence ledger for every mutating context op.
        CREATE TABLE IF NOT EXISTS ${OPS} (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          op TEXT NOT NULL,
          target_table TEXT NOT NULL,
          target_id TEXT NOT NULL,
          before_json TEXT NOT NULL,
          after_json TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          undone_at INTEGER,
          undo_op_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ctx_ops_ws ON ${OPS}(workspace_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ctx_ops_target ON ${OPS}(target_table, target_id);
      `);

      // Phase 6 · T1 — additive column: evidence lifecycle stage.
      // Guarded ALTER (idempotent): existing rows are 'verbatim' via DEFAULT.
      const cols = this.q(`PRAGMA table_info(${ITEMS})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "lifecycle_stage")) {
        this.db.exec(`ALTER TABLE ${ITEMS} ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'verbatim'`);
      }
      if (!cols.some((c) => c.name === "lifecycle_summarized_by")) {
        this.db.exec(`ALTER TABLE ${ITEMS} ADD COLUMN lifecycle_summarized_by TEXT`);
      }
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ctx_lifecycle ON ${ITEMS}(workspace_id, lifecycle_stage)`);
    } catch {
      /* never block startup on a migration probe */
    }
  }

  // ── Prepared-statement cache ─────────────────────────────────────────────
  //
  // The WriteGate (Phase 1) strongly retains every distinct prepared Statement
  // until connection close, so per-call prepare is an UNBOUNDED leak plus a
  // latency tax — measured during Phase 6 scale work: ~16KB RSS per distinct
  // statement and a >100s stall once ~53k distinct statements accumulated
  // (the @100k-item benchmark could not even be seeded). Retrieval itself
  // compounds this: the semantic channel resolves embeddings per candidate, so
  // a single query previously compiled hundreds of statements.
  //
  // Identical SQL is therefore compiled once per repository instance and
  // reused. Statements are pure SQL+bindings — reuse is semantics-preserving
  // (the single-writer connection serializes all mutation either way), and
  // the gate still tracks exactly one statement per distinct SQL string.
  private readonly statements = new Map<string, ReturnType<ContextDb["prepare"]>>();

  private q(sql: string): ReturnType<ContextDb["prepare"]> {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const stmt = this.db.prepare(sql);
    this.statements.set(sql, stmt);
    return stmt;
  }

  // ── Items ────────────────────────────────────────────────────────────────

  insertItem(input: {
    id?: string;
    type: ContextType;
    content: string;
    title?: string;
    scope: ContextScope;
    trustStatus: TrustStatus;
    consentState: ConsentState;
    consentActor?: string | null;
    consentAt?: number | null;
    provenanceKind: ProvenanceKind;
    provenanceRef?: string | null;
    actorKind: string;
    actorName?: string | null;
    sourceObservedAt?: number | null;
    staleAfter?: number | null;
    expiresAt?: number | null;
    confidence?: string;
    sensitivity?: SensitivityLevel;
    retention?: RetentionPolicy;
    links?: ContextLinks;
    tags?: string[];
    lifecycleStage?: string;
    now?: number;
  }): string {
    const now = input.now ?? Date.now();
    const id = input.id ?? `ctx_${randomUUID()}`;
    const content = boundText(input.content, CONTEXT_BOUNDS.maxItemChars);
    const tags = (input.tags ?? []).slice(0, CONTEXT_BOUNDS.maxTagsPerItem).map((t) => t.trim()).filter(Boolean);

    this.q(
        `INSERT INTO ${ITEMS} (
          id, version, type, title, content,
          workspace_id, project_scope, user_id, task_id, agent_id,
          trust_status, consent_state, consent_actor, consent_at,
          provenance_kind, provenance_ref, actor_kind, actor_name,
          source_observed_at, stale_after, expires_at, superseded_by,
          confidence, contradicted_by, user_confirmed, open_questions,
          sensitivity, retention, links_json,
          index_state, embedding_model, embedding_dim, embedding,
          revoked_at, revoked_reason, deleted_at,
          tags, created_at, updated_at, last_accessed_at, access_count,
          lifecycle_stage, lifecycle_summarized_by
        ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?)`,
      )
      .run(
        id,
        1,
        input.type,
        input.title ?? deriveTitle(content),
        content,
        input.scope.workspaceId,
        input.scope.projectScope,
        input.scope.userId ?? null,
        input.scope.taskId ?? null,
        input.scope.agentId ?? null,
        input.trustStatus,
        input.consentState,
        input.consentActor ?? null,
        input.consentAt ?? null,
        input.provenanceKind,
        input.provenanceRef ?? null,
        input.actorKind,
        input.actorName ?? null,
        input.sourceObservedAt ?? null,
        input.staleAfter ?? null,
        input.expiresAt ?? null,
        null,
        input.confidence ?? "unknown",
        "",
        0,
        "",
        input.sensitivity ?? "unknown",
        input.retention ?? "durable",
        JSON.stringify(input.links ?? {}),
        "none",
        null,
        null,
        null,
        null,
        null,
        null,
        tags.join(","),
        now,
        now,
        null,
        0,
        input.lifecycleStage ?? "verbatim",
        null,
      );

    return id;
  }

  getItem(id: string): ContextItem | null {
    const row = this.q(`SELECT * FROM ${ITEMS} WHERE id = ?`).get<ItemRow>(id);
    return row ? rowToItem(row) : null;
  }

  /**
   * List candidate items for retrieval. Scope filtering happens in SQL so an
   * unauthorized row never enters process memory (§9.1: filter before ranking).
   */
  listCandidates(opts: {
    workspaceId: string;
    projectScope?: string;
    types?: readonly ContextType[];
    taskId?: string;
    agentId?: string;
    includeRevoked?: boolean;
    includeDeleted?: boolean;
    includeExpired?: boolean;
    limit?: number;
    now?: number;
  }): ContextItem[] {
    const now = opts.now ?? Date.now();
    const clauses: string[] = ["workspace_id = ?"];
    const params: unknown[] = [opts.workspaceId];

    if (opts.projectScope) {
      clauses.push(`(project_scope = 'global' OR project_scope = ?)`);
      params.push(opts.projectScope);
    }
    if (opts.types && opts.types.length) {
      clauses.push(`type IN (${opts.types.map(() => "?").join(",")})`);
      params.push(...opts.types);
    }
    // Task-bound items are only visible inside their task.
    if (opts.taskId) {
      clauses.push(`(task_id IS NULL OR task_id = ?)`);
      params.push(opts.taskId);
    } else {
      clauses.push(`task_id IS NULL`);
    }
    // Agent-bound items are only visible to their agent.
    if (opts.agentId) {
      clauses.push(`(agent_id IS NULL OR agent_id = ?)`);
      params.push(opts.agentId);
    } else {
      clauses.push(`agent_id IS NULL`);
    }
    if (!opts.includeRevoked) clauses.push(`revoked_at IS NULL`);
    if (!opts.includeDeleted) clauses.push(`deleted_at IS NULL`);
    if (!opts.includeExpired) {
      clauses.push(`(expires_at IS NULL OR expires_at > ?)`);
      params.push(now);
    }
    // Quarantined content is never a retrieval candidate.
    clauses.push(`consent_state != 'quarantined'`);

    const limit = Math.min(opts.limit ?? CONTEXT_BOUNDS.maxCandidates, CONTEXT_BOUNDS.maxCandidates);
    params.push(limit);

    const rows = this.q(
        `SELECT * FROM ${ITEMS} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all<ItemRow>(...params);
    return rows.map(rowToItem);
  }

  /** List for inspection UIs — includes revoked/deleted when asked. */
  listForInspection(opts: {
    workspaceId: string;
    type?: ContextType;
    projectScope?: string;
    includeRevoked?: boolean;
    includeDeleted?: boolean;
    limit?: number;
  }): ContextItem[] {
    const clauses: string[] = ["workspace_id = ?"];
    const params: unknown[] = [opts.workspaceId];
    if (opts.type) {
      clauses.push("type = ?");
      params.push(opts.type);
    }
    if (opts.projectScope) {
      clauses.push("(project_scope = 'global' OR project_scope = ?)");
      params.push(opts.projectScope);
    }
    if (!opts.includeRevoked) clauses.push("revoked_at IS NULL");
    if (!opts.includeDeleted) clauses.push("deleted_at IS NULL");
    const limit = Math.min(opts.limit ?? 200, 1000);
    params.push(limit);
    return this.q(`SELECT * FROM ${ITEMS} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
      .all<ItemRow>(...params)
      .map(rowToItem);
  }

  updateItemContent(id: string, content: string, opts: { now?: number } = {}): boolean {
    const cur = this.getItem(id);
    if (!cur) return false;
    const now = opts.now ?? Date.now();
    const bounded = boundText(content, CONTEXT_BOUNDS.maxItemChars);
    this.q(
        `UPDATE ${ITEMS} SET content = ?, title = ?, version = version + 1, updated_at = ?,
         index_state = 'invalidated', embedding = NULL WHERE id = ?`,
      )
      .run(bounded, deriveTitle(bounded), now, id);
    return true;
  }

  setConsent(
    id: string,
    state: ConsentState,
    opts: { actor?: string; now?: number } = {},
  ): boolean {
    const now = opts.now ?? Date.now();
    this.q(
        `UPDATE ${ITEMS} SET consent_state = ?, consent_actor = ?, consent_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      )
      .run(state, opts.actor ?? null, now, now, id);
    return true;
  }

  /**
   * Revoke an item: excluded from all future retrieval AND its cached vector is
   * invalidated so no index path can resurrect it (§9.8).
   */
  revokeItem(
    id: string,
    reason: string,
    opts: { actor?: string; now?: number } = {},
  ): { ok: boolean; indexInvalidated: boolean } {
    const cur = this.getItem(id);
    if (!cur) return { ok: false, indexInvalidated: false };
    const now = opts.now ?? Date.now();
    this.q(
        `UPDATE ${ITEMS} SET revoked_at = ?, revoked_reason = ?, consent_state = 'revoked',
         index_state = 'invalidated', embedding = NULL, embedding_model = NULL, embedding_dim = NULL,
         updated_at = ?, version = version + 1 WHERE id = ?`,
      )
      .run(now, boundText(reason, 256), now, id);
    this.recordRevocation({
      itemId: id,
      itemKind: "context_item",
      workspaceId: cur.scope.workspaceId,
      reason,
      actor: opts.actor ?? "user",
      indexInvalidated: true,
      now,
    });
    return { ok: true, indexInvalidated: true };
  }

  /** Soft-delete then hard-delete: the row is removed, the ledger entry stays. */
  deleteItem(id: string, opts: { actor?: string; reason?: string; now?: number } = {}): boolean {
    const cur = this.getItem(id);
    if (!cur) return false;
    const now = opts.now ?? Date.now();
    this.recordRevocation({
      itemId: id,
      itemKind: "context_item",
      workspaceId: cur.scope.workspaceId,
      reason: opts.reason ?? "user_delete",
      actor: opts.actor ?? "user",
      indexInvalidated: true,
      now,
    });
    this.q(`DELETE FROM ${PROV} WHERE item_id = ?`).run(id);
    this.q(`DELETE FROM ${ITEMS} WHERE id = ?`).run(id);
    return true;
  }

  /** Record a correction: old item points at the new one. */
  supersede(oldId: string, newId: string, opts: { now?: number } = {}): boolean {
    const now = opts.now ?? Date.now();
    this.q(`UPDATE ${ITEMS} SET superseded_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(newId, now, oldId);
    return true;
  }

  markStale(id: string, at: number): boolean {
    this.q(`UPDATE ${ITEMS} SET stale_after = ?, updated_at = ? WHERE id = ?`).run(at, Date.now(), id);
    return true;
  }

  setEmbedding(id: string, vec: number[] | null, model: string, dim: number): void {
    try {
      this.q(
          `UPDATE ${ITEMS} SET embedding = ?, embedding_model = ?, embedding_dim = ?, index_state = ? WHERE id = ?`,
        )
        .run(
          vec && vec.length ? JSON.stringify(vec) : null,
          vec && vec.length ? model : null,
          vec && vec.length ? dim : null,
          vec && vec.length ? "indexed" : "failed",
          id,
        );
    } catch {
      /* best-effort */
    }
  }

  getEmbedding(id: string): { vec: number[]; model: string; dim: number } | null {
    const row = this.q(`SELECT embedding, embedding_model, embedding_dim, index_state FROM ${ITEMS} WHERE id = ?`)
      .get<{ embedding: string | null; embedding_model: string | null; embedding_dim: number | null; index_state: string }>(id);
    if (!row || !row.embedding || row.index_state === "invalidated") return null;
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (!Array.isArray(vec) || !vec.length) return null;
      return { vec, model: row.embedding_model ?? "unknown", dim: row.embedding_dim ?? vec.length };
    } catch {
      return null;
    }
  }

  /** Invalidate every cached vector in a workspace (e.g. embedding model change). */
  invalidateIndex(workspaceId: string): number {
    const r = this.q(
        `UPDATE ${ITEMS} SET index_state = 'invalidated', embedding = NULL WHERE workspace_id = ? AND index_state = 'indexed'`,
      )
      .run(workspaceId);
    return (r as { changes?: number })?.changes ?? 0;
  }

  touchAccess(ids: readonly string[], now: number = Date.now()): void {
    if (!ids.length) return;
    const stmt = this.q(
      `UPDATE ${ITEMS} SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
    );
    for (const id of ids) {
      try {
        stmt.run(now, id);
      } catch {
        /* best-effort */
      }
    }
  }

  countItems(workspaceId: string): number {
    return (
      this.q(`SELECT COUNT(*) c FROM ${ITEMS} WHERE workspace_id = ? AND deleted_at IS NULL`)
        .get<{ c: number }>(workspaceId)?.c ?? 0
    );
  }

  statsByType(workspaceId: string): Array<{ type: string; c: number }> {
    return this.q(
        `SELECT type, COUNT(*) c FROM ${ITEMS} WHERE workspace_id = ? AND deleted_at IS NULL GROUP BY type ORDER BY c DESC`,
      )
      .all<{ type: string; c: number }>(workspaceId);
  }

  /** Prune expired items whose retention policy allows it. */
  pruneExpired(workspaceId: string, now: number = Date.now()): number {
    const r = this.q(
        `DELETE FROM ${ITEMS} WHERE workspace_id = ? AND expires_at IS NOT NULL AND expires_at <= ? AND retention IN ('ttl','session','task')`,
      )
      .run(workspaceId, now);
    return (r as { changes?: number })?.changes ?? 0;
  }

  // ── Provenance ───────────────────────────────────────────────────────────

  addProvenance(itemId: string, ref: ProvenanceRef, now: number = Date.now()): string | null {
    const existing = this.q(`SELECT COUNT(*) c FROM ${PROV} WHERE item_id = ?`)
      .get<{ c: number }>(itemId);
    if ((existing?.c ?? 0) >= CONTEXT_BOUNDS.maxProvenancePerItem) return null;
    const id = `prv_${randomUUID()}`;
    this.q(
        `INSERT INTO ${PROV} (id, item_id, kind, ref, label, observed_at, content_hash, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        itemId,
        ref.kind,
        boundText(ref.ref, 1024),
        ref.label ? boundText(ref.label, 256) : null,
        ref.observedAt ?? null,
        ref.contentHash ?? null,
        now,
      );
    return id;
  }

  getProvenance(itemId: string): ProvenanceRef[] {
    return this.q(`SELECT * FROM ${PROV} WHERE item_id = ? ORDER BY created_at ASC LIMIT ?`)
      .all<ProvRow>(itemId, CONTEXT_BOUNDS.maxProvenancePerItem)
      .map((r) => ({
        kind: (isProvenanceKind(r.kind) ? r.kind : "unknown") as ProvenanceKind,
        ref: r.ref,
        ...(r.label ? { label: r.label } : {}),
        ...(r.observed_at !== null ? { observedAt: r.observed_at } : {}),
        ...(r.content_hash ? { contentHash: r.content_hash } : {}),
      }));
  }

  /** Find every item that cites a given reference (e.g. all uses of a URL). */
  findByProvenanceRef(kind: ProvenanceKind, ref: string, limit = 50): string[] {
    return this.q(`SELECT item_id FROM ${PROV} WHERE kind = ? AND ref = ? LIMIT ?`)
      .all<{ item_id: string }>(kind, ref, Math.min(limit, 200))
      .map((r) => r.item_id);
  }

  // ── Revocation ledger ────────────────────────────────────────────────────

  /**
   * Append-only revocation record. Survives a UI rollback (§19: preserve
   * provenance/revocation records even if new UI is disabled).
   */
  recordRevocation(input: {
    itemId: string;
    itemKind: string;
    workspaceId: string;
    reason: string;
    actor: string;
    indexInvalidated: boolean;
    now?: number;
  }): string {
    const id = `rev_${randomUUID()}`;
    this.q(
        `INSERT INTO ${REVOCATIONS} (id, item_id, item_kind, workspace_id, reason, actor, index_invalidated, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.itemId,
        input.itemKind,
        input.workspaceId,
        boundText(input.reason, 256),
        input.actor,
        input.indexInvalidated ? 1 : 0,
        input.now ?? Date.now(),
      );
    return id;
  }

  /** Is this id revoked according to the ledger? Used at resume-revalidation. */
  isRevoked(itemId: string): boolean {
    const r = this.q(`SELECT COUNT(*) c FROM ${REVOCATIONS} WHERE item_id = ?`)
      .get<{ c: number }>(itemId);
    return (r?.c ?? 0) > 0;
  }

  /** Bulk revocation check — one query for a whole package. */
  revokedAmong(itemIds: readonly string[]): Set<string> {
    if (!itemIds.length) return new Set();
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = this.q(`SELECT DISTINCT item_id FROM ${REVOCATIONS} WHERE item_id IN (${placeholders})`)
      .all<{ item_id: string }>(...itemIds);
    return new Set(rows.map((r) => r.item_id));
  }

  listRevocations(workspaceId: string, limit = 100): RevocationRow[] {
    return this.q(`SELECT * FROM ${REVOCATIONS} WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all<RevocationRow>(workspaceId, Math.min(limit, 500));
  }

  // ── Packages ─────────────────────────────────────────────────────────────

  /** Persist a package for checkpoint/resume. Bodies are NOT duplicated. */
  savePackage(pkg: ContextPackage, links: { runId?: string; taskId?: string; agentId?: string } = {}): void {
    try {
      // Store ids + metadata only — never the item bodies (bounded payload).
      const slim = {
        packageId: pkg.packageId,
        version: pkg.version,
        schemaVersion: pkg.schemaVersion,
        createdAt: pkg.createdAt,
        queryIntent: boundText(pkg.queryIntent, 512),
        grant: {
          requester: pkg.grant.requester,
          scope: pkg.grant.scope,
          allowedTiers: pkg.grant.allowedTiers,
          maxItems: pkg.grant.maxItems,
          maxChars: pkg.grant.maxChars,
          auditRef: pkg.grant.auditRef,
        },
        tiers: pkg.tiers.map((t) => ({
          tier: t.tier,
          compressed: t.compressed,
          chars: t.chars,
          itemIds: t.items.map((i) => i.item.id),
          itemVersions: t.items.map((i) => i.item.version),
        })),
        totalItems: pkg.totalItems,
        totalChars: pkg.totalChars,
        degraded: pkg.degraded,
        degradedReasons: pkg.degradedReasons,
        contentHash: pkg.contentHash,
        revalidation: pkg.revalidation ?? null,
      };
      this.q(
          `INSERT OR REPLACE INTO ${PACKAGES} (package_id, version, schema_version, workspace_id, run_id, task_id, agent_id, query_intent, content_hash, total_items, total_chars, degraded, package_json, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          pkg.packageId,
          pkg.version,
          pkg.schemaVersion,
          pkg.grant.scope.workspaceId,
          links.runId ?? null,
          links.taskId ?? pkg.grant.scope.taskId ?? null,
          links.agentId ?? pkg.grant.scope.agentId ?? null,
          boundText(pkg.queryIntent, 512),
          pkg.contentHash,
          pkg.totalItems,
          pkg.totalChars,
          pkg.degraded ? 1 : 0,
          JSON.stringify(slim),
          pkg.createdAt,
        );
    } catch {
      /* package persistence is best-effort; never fails a run */
    }
  }

  getPackage(packageId: string, version?: number): { row: PackageRow; slim: Record<string, unknown> } | null {
    const row =
      version === undefined
        ? this.q(`SELECT * FROM ${PACKAGES} WHERE package_id = ? ORDER BY version DESC LIMIT 1`)
            .get<PackageRow>(packageId)
        : this.q(`SELECT * FROM ${PACKAGES} WHERE package_id = ? AND version = ?`)
            .get<PackageRow>(packageId, version);
    if (!row) return null;
    try {
      return { row, slim: JSON.parse(row.package_json) as Record<string, unknown> };
    } catch {
      return { row, slim: {} };
    }
  }

  getPackagesForRun(runId: string, limit = 20): PackageRow[] {
    return this.q(`SELECT * FROM ${PACKAGES} WHERE run_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all<PackageRow>(runId, Math.min(limit, 100));
  }

  prunePackages(now: number = Date.now()): number {
    const cutoff = now - CONTEXT_BOUNDS.packageRetentionMs;
    const r = this.q(`DELETE FROM ${PACKAGES} WHERE created_at < ?`).run(cutoff);
    return (r as { changes?: number })?.changes ?? 0;
  }

  // ── Summaries ────────────────────────────────────────────────────────────

  saveSummary(input: {
    workspaceId: string;
    projectScope: string;
    taskId?: string | null;
    summary: string;
    preserved: readonly string[];
    lost: readonly string[];
    sourceItemIds: readonly string[];
    generation: number;
    lineageParent?: string | null;
    originalChars: number;
    compressedChars: number;
    now?: number;
  }): string {
    const id = `sum_${randomUUID()}`;
    this.q(
        `INSERT INTO ${SUMMARIES} (id, workspace_id, project_scope, task_id, summary, preserved, lost, source_item_ids, generation, lineage_parent, original_chars, compressed_chars, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.projectScope,
        input.taskId ?? null,
        input.summary,
        input.preserved.join(","),
        input.lost.join(","),
        input.sourceItemIds.join(","),
        input.generation,
        input.lineageParent ?? null,
        input.originalChars,
        input.compressedChars,
        input.now ?? Date.now(),
      );
    return id;
  }

  getSummary(id: string): SummaryRow | null {
    return this.q(`SELECT * FROM ${SUMMARIES} WHERE id = ?`).get<SummaryRow>(id) ?? null;
  }

  listSummaries(workspaceId: string, opts: { taskId?: string; limit?: number } = {}): SummaryRow[] {
    const limit = Math.min(opts.limit ?? 50, 200);
    if (opts.taskId) {
      return this.q(`SELECT * FROM ${SUMMARIES} WHERE workspace_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all<SummaryRow>(workspaceId, opts.taskId, limit);
    }
    return this.q(`SELECT * FROM ${SUMMARIES} WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all<SummaryRow>(workspaceId, limit);
  }

  /** Walk a summary's lineage back to its roots (bounded). */
  summaryLineage(id: string): SummaryRow[] {
    const chain: SummaryRow[] = [];
    let cur = this.getSummary(id);
    let guard = 0;
    while (cur && guard++ < CONTEXT_BOUNDS.maxSummaryGeneration + 2) {
      chain.push(cur);
      if (!cur.lineage_parent) break;
      cur = this.getSummary(cur.lineage_parent);
    }
    return chain;
  }

  // ── Export (§9.8) ────────────────────────────────────────────────────────

  exportAll(workspaceId: string): {
    format: "xr-context";
    version: 1;
    exportedAt: number;
    workspaceId: string;
    items: Array<ContextItem & { provenance: ProvenanceRef[] }>;
    revocations: RevocationRow[];
    summaries: SummaryRow[];
  } {
    const items = this.listForInspection({
      workspaceId,
      includeRevoked: true,
      includeDeleted: true,
      limit: 1000,
    }).map((i) => ({ ...i, provenance: this.getProvenance(i.id) }));
    return {
      format: "xr-context",
      version: 1,
      exportedAt: Date.now(),
      workspaceId,
      items,
      revocations: this.listRevocations(workspaceId, 500),
      summaries: this.listSummaries(workspaceId, { limit: 200 }),
    };
  }

  // ── Phase 6 · T1: evidence lifecycle helpers ──────────────────────────────

  /** Live rows with a given lifecycle stage. */
  listByLifecycle(
    workspaceId: string,
    stage: string,
    opts: { type?: ContextType; limit?: number } = {},
  ): ContextItem[] {
    const rows = this.q(
        `SELECT * FROM ${ITEMS}
         WHERE workspace_id = ? AND lifecycle_stage = ? AND deleted_at IS NULL AND revoked_at IS NULL
           ${opts.type ? "AND type = ?" : ""}
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .all<ItemRow>(
        ...(opts.type
          ? [workspaceId, stage, opts.type, opts.limit ?? 200]
          : [workspaceId, stage, opts.limit ?? 200]),
      );
    return rows.map(rowToItem);
  }

  /** Update lifecycle stage (+ the summary that stands for an externalized original). */
  setLifecycleStage(
    id: string,
    stage: string,
    summarizedBy?: string | null,
    now: number = Date.now(),
  ): boolean {
    const r = this.q(
        `UPDATE ${ITEMS} SET lifecycle_stage = ?, lifecycle_summarized_by = COALESCE(?, lifecycle_summarized_by), updated_at = ?, version = version + 1 WHERE id = ?`,
      )
      .run(stage, summarizedBy ?? null, now, id);
    return (r as { changes?: number }).changes === 1;
  }

  /** All live (non-deleted, non-revoked) rows of a workspace, bounded. */
  scopeCandidates(
    workspaceId: string,
    opts: { projectScope?: string; limit?: number; types?: ContextType[] } = {},
  ): ContextItem[] {
    const typeFilter = opts.types?.length
      ? `AND type IN (${opts.types.map(() => "?").join(",")})`
      : "";
    const scopeFilter = opts.projectScope ? `AND (project_scope = ? OR project_scope = 'global')` : "";
    const rows = this.q(
        `SELECT * FROM ${ITEMS}
         WHERE workspace_id = ? AND deleted_at IS NULL AND revoked_at IS NULL
           ${scopeFilter} ${typeFilter}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all<ItemRow>(
        workspaceId,
        ...(opts.projectScope ? [opts.projectScope] : []),
        ...(opts.types ?? []),
        opts.limit ?? 500,
      );
    return rows.map(rowToItem);
  }

  /** Record a contradiction pointer on an item (content-free metadata change). */
  setContradictedBy(id: string, otherIds: readonly string[], now: number = Date.now()): boolean {
    const r = this.q(`UPDATE ${ITEMS} SET contradicted_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(otherIds.join(","), now, id);
    return (r as { changes?: number }).changes === 1;
  }

  /** Hard-expire one item (selective forgetting; reversible via ops ledger). */
  expireItem(id: string, expiresAt: number, now: number = Date.now()): boolean {
    const r = this.q(`UPDATE ${ITEMS} SET expires_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
      .run(expiresAt, now, id);
    return (r as { changes?: number }).changes === 1;
  }

  /** Reachable children for navigation: items folded into summary `summaryId`. */
  externalizedBy(summaryId: string): ContextItem[] {
    const rows = this.q(`SELECT * FROM ${ITEMS} WHERE lifecycle_summarized_by = ? AND deleted_at IS NULL`)
      .all<ItemRow>(summaryId);
    return rows.map(rowToItem);
  }

  // ── Phase 6 · T4: conflict resolutions ────────────────────────────────────

  saveResolution(input: {
    workspaceId: string;
    itemA: string;
    itemB: string;
    kind: string;
    resolution: string;
    decidedBy: string;
    reason?: string;
    now?: number;
  }): string {
    const id = `res_${randomUUID()}`;
    this.q(
        `INSERT INTO ${RESOLUTIONS} (id, workspace_id, item_a, item_b, kind, resolution, decided_by, reason, created_at, undone_at)
         VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .run(
        id,
        input.workspaceId,
        input.itemA,
        input.itemB,
        input.kind,
        input.resolution,
        input.decidedBy,
        input.reason ?? "",
        input.now ?? Date.now(),
      );
    return id;
  }

  listResolutions(workspaceId: string, opts: { includeUndone?: boolean; limit?: number } = {}): ResolutionRow[] {
    return this.q(
        `SELECT * FROM ${RESOLUTIONS} WHERE workspace_id = ? ${opts.includeUndone ? "" : "AND undone_at IS NULL"}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all<ResolutionRow>(workspaceId, opts.limit ?? 100);
  }

  /** Active resolution (if any) for an unordered item pair. */
  resolutionFor(itemA: string, itemB: string): ResolutionRow | null {
    const row = this.q(
        `SELECT * FROM ${RESOLUTIONS} WHERE undone_at IS NULL AND
           ((item_a = ? AND item_b = ?) OR (item_a = ? AND item_b = ?))
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get<ResolutionRow>(itemA, itemB, itemB, itemA);
    return row ?? null;
  }

  markResolutionUndone(id: string, undoOpId?: string, now: number = Date.now()): boolean {
    const r = this.q(`UPDATE ${RESOLUTIONS} SET undone_at = ? WHERE id = ? AND undone_at IS NULL`)
      .run(now, id);
    void undoOpId;
    return (r as { changes?: number }).changes === 1;
  }

  // ── Phase 6 · T6: undo/evidence ledger ────────────────────────────────────

  /** Raw row snapshot for undo before/after images. */
  rawRow(table: string, id: string): Record<string, unknown> | null {
    const allowed = new Set([ITEMS, RESOLUTIONS, OPS, "user_memory"]);
    if (!allowed.has(table)) return null;
    const row = this.q(`SELECT * FROM ${table} WHERE id = ?`).get<Record<string, unknown>>(id);
    return row ?? null;
  }

  recordOp(input: {
    workspaceId: string;
    op: string;
    targetTable: string;
    targetId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    actor: string;
    reason?: string;
    now?: number;
  }): string {
    const id = `op_${randomUUID()}`;
    this.q(
        `INSERT INTO ${OPS} (id, workspace_id, op, target_table, target_id, before_json, after_json, actor, reason, created_at, undone_at, undo_op_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)`,
      )
      .run(
        id,
        input.workspaceId,
        input.op,
        input.targetTable,
        input.targetId,
        JSON.stringify(input.before ?? null),
        JSON.stringify(input.after ?? null),
        input.actor,
        input.reason ?? "",
        input.now ?? Date.now(),
      );
    return id;
  }

  listOps(workspaceId: string, opts: { includeUndone?: boolean; limit?: number } = {}): OpsRow[] {
    return this.q(
        `SELECT * FROM ${OPS} WHERE workspace_id = ? ${opts.includeUndone ? "" : "AND undone_at IS NULL"}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all<OpsRow>(workspaceId, opts.limit ?? 100);
  }

  getOp(id: string): OpsRow | null {
    const row = this.q(`SELECT * FROM ${OPS} WHERE id = ?`).get<OpsRow>(id);
    return row ?? null;
  }

  markOpUndone(id: string, undoOpId: string, now: number = Date.now()): boolean {
    const r = this.q(`UPDATE ${OPS} SET undone_at = ?, undo_op_id = ? WHERE id = ? AND undone_at IS NULL`)
      .run(now, undoOpId, id);
    return (r as { changes?: number }).changes === 1;
  }

  /** Attach the after-image to an in-flight ledger op. */
  recordOpFinalize(opId: string, after: Record<string, unknown> | null): boolean {
    const r = this.q(`UPDATE ${OPS} SET after_json = ? WHERE id = ? AND after_json = 'null'`)
      .run(JSON.stringify(after ?? null), opId);
    return (r as { changes?: number }).changes === 1;
  }

  /** Hard-delete a row (undo of an insert). Internal to the undo ledger. */
  purgeRow(table: string, id: string): boolean {
    const allowed = new Set([ITEMS, RESOLUTIONS, "user_memory"]);
    if (!allowed.has(table)) return false;
    const r = this.q(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return (r as { changes?: number }).changes === 1;
  }

  /**
   * Restore a raw row snapshot (insert-or-replace) — used ONLY by undo, which
   * is why this accepts raw rows rather than domain values. Callers must
   * pass a snapshot previously produced by `rawRow`.
   */
  restoreRow(table: string, id: string, snapshot: Record<string, unknown>): boolean {
    const allowed = new Set([ITEMS, RESOLUTIONS, "user_memory"]);
    if (!allowed.has(table)) return false;
    const cols = Object.keys(snapshot);
    if (!cols.includes("id")) return false;
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    this.q(sql).run(...cols.map((c) => snapshot[c]));
    return true;
  }
}

// ── Row mapping ────────────────────────────────────────────────────────────

function splitList(s: string): string[] {
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

function rowToItem(r: ItemRow): ContextItem {
  let links: ContextLinks = emptyLinks();
  try {
    links = JSON.parse(r.links_json) as ContextLinks;
  } catch {
    links = emptyLinks();
  }

  const freshness = computeFreshness({
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sourceObservedAt: r.source_observed_at,
    staleAfter: r.stale_after,
    expiresAt: r.expires_at,
    supersededBy: r.superseded_by,
  });

  return {
    id: r.id,
    version: r.version,
    type: (isContextType(r.type) ? r.type : "knowledge") as ContextType,
    content: r.content,
    title: r.title || deriveTitle(r.content),
    scope: {
      workspaceId: r.workspace_id,
      projectScope: r.project_scope,
      ...(r.user_id ? { userId: r.user_id } : {}),
      ...(r.task_id ? { taskId: r.task_id } : {}),
      ...(r.agent_id ? { agentId: r.agent_id } : {}),
    },
    trustStatus: (isTrustStatus(r.trust_status) ? r.trust_status : "unknown") as TrustStatus,
    consentState: (isConsentState(r.consent_state) ? r.consent_state : "legacy_unknown") as ConsentState,
    consentActor: r.consent_actor,
    consentAt: r.consent_at,
    provenanceKind: (isProvenanceKind(r.provenance_kind) ? r.provenance_kind : "unknown") as ProvenanceKind,
    provenanceRef: r.provenance_ref,
    actorKind: (r.actor_kind as ContextItem["actorKind"]) ?? "unknown",
    actorName: r.actor_name,
    freshness,
    uncertainty: {
      confidence: (["high", "medium", "low", "unknown"].includes(r.confidence)
        ? r.confidence
        : "unknown") as ContextItem["uncertainty"]["confidence"],
      contradictedBy: splitList(r.contradicted_by),
      userConfirmed: r.user_confirmed === 1,
      openQuestions: r.open_questions ? r.open_questions.split("\u0000").filter(Boolean) : [],
    },
    sensitivity: (r.sensitivity as SensitivityLevel) ?? "unknown",
    retention: (r.retention as RetentionPolicy) ?? "durable",
    links,
    lifecycleStage: (
      r.lifecycle_stage && isLifecycleStage(r.lifecycle_stage) ? r.lifecycle_stage : "verbatim"
    ) as ContextItem["lifecycleStage"],
    lifecycleSummarizedBy: r.lifecycle_summarized_by ?? null,
    indexState: (r.index_state as IndexState) ?? "none",
    embeddingSpace:
      r.embedding_model && r.embedding_dim ? { model: r.embedding_model, dim: r.embedding_dim } : null,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason,
    deletedAt: r.deleted_at,
    supersededBy: r.superseded_by,
    tags: splitList(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
    accessCount: r.access_count,
  };
}

/** Build a ContextItem in memory (used to adapt `user_memory` rows). */
export function buildItem(input: Partial<ContextItem> & Pick<ContextItem, "id" | "type" | "content" | "scope">): ContextItem {
  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  return {
    version: 1,
    title: input.title ?? deriveTitle(input.content),
    trustStatus: "unknown",
    consentState: "legacy_unknown",
    provenanceKind: "unknown",
    actorKind: "unknown",
    freshness:
      input.freshness ??
      computeFreshness({ createdAt, updatedAt, expiresAt: null, staleAfter: null, supersededBy: null }),
    uncertainty: input.uncertainty ?? emptyUncertainty(),
    sensitivity: "unknown",
    retention: "durable",
    links: emptyLinks(),
    indexState: "none",
    tags: [],
    accessCount: 0,
    ...input,
    createdAt,
    updatedAt,
  } as ContextItem;
}

export { CONTEXT_SCHEMA_VERSION };
