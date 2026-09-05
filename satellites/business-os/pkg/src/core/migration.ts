/**
 * XR 5.3 — Business Database Migration — Additional tables for Operating Layer
 * Preserves existing data, versioned migrations.
 *
 * New tables:
 * - biz_record_mutations
 * - biz_outcomes
 * - biz_worker_authority
 * - biz_artifacts
 * - biz_approvals
 * - biz_privacy_policies
 * - biz_execution_records
 * - biz_execution_leases
 * - biz_execution_idempotency
 */

export const BUSINESS_OPERATING_LAYER_TABLES = `
-- Record Mutations (authoritative record authority)
CREATE TABLE IF NOT EXISTS biz_record_mutations (
  mutation_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  module TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  worker_ref TEXT,
  workflow_definition_id TEXT,
  workflow_version INTEGER,
  workflow_run_id TEXT,
  workflow_node_id TEXT,
  execution_refs TEXT NOT NULL DEFAULT '[]',
  policy_decision TEXT,
  approval_ref TEXT,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  context_package_ids TEXT NOT NULL DEFAULT '[]',
  previous_value TEXT,
  change_set TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  reversible INTEGER NOT NULL DEFAULT 0,
  restore_path TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_mutations_workspace ON biz_record_mutations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_mutations_entity ON biz_record_mutations(module, entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_biz_mutations_run ON biz_record_mutations(workflow_run_id);

-- Outcomes (verified outcomes)
CREATE TABLE IF NOT EXISTS biz_outcomes (
  outcome_id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  journey_category TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  records_changed TEXT NOT NULL DEFAULT '[]',
  artifacts TEXT NOT NULL DEFAULT '[]',
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  cost_estimated_usd REAL NOT NULL DEFAULT 0,
  cost_actual_usd REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verified_by TEXT,
  failure_reason TEXT,
  reversible INTEGER NOT NULL DEFAULT 1,
  restore_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_outcomes_workspace ON biz_outcomes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_outcomes_journey ON biz_outcomes(journey_id);
CREATE INDEX IF NOT EXISTS idx_biz_outcomes_run ON biz_outcomes(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_biz_outcomes_status ON biz_outcomes(status);

-- Worker Authority Profiles
CREATE TABLE IF NOT EXISTS biz_worker_authority (
  profile_id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_ids TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'single-workspace',
  allowed_workflows TEXT NOT NULL DEFAULT '[]',
  context_scope TEXT NOT NULL DEFAULT '{}',
  capabilities TEXT NOT NULL DEFAULT '[]',
  tool_scope TEXT NOT NULL DEFAULT '{}',
  provider_scope TEXT NOT NULL DEFAULT '{}',
  budget TEXT NOT NULL DEFAULT '{}',
  risk TEXT NOT NULL DEFAULT '{}',
  approval TEXT NOT NULL DEFAULT '{}',
  data_access TEXT NOT NULL DEFAULT '{}',
  success_criteria TEXT NOT NULL DEFAULT '{}',
  escalation TEXT NOT NULL DEFAULT '{}',
  revocation TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_worker_auth_workspace ON biz_worker_authority(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_worker_auth_org ON biz_worker_authority(org_id);

-- Artifacts
CREATE TABLE IF NOT EXISTS biz_artifacts (
  artifact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  org_id TEXT,
  workflow_run_id TEXT,
  node_id TEXT,
  contract_kind TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  location TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  linked_records TEXT NOT NULL DEFAULT '[]',
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  content_preview TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_artifacts_workspace ON biz_artifacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_artifacts_run ON biz_artifacts(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_biz_artifacts_kind ON biz_artifacts(contract_kind);

-- Approvals / Escalations
CREATE TABLE IF NOT EXISTS biz_approvals (
  approval_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_run_id TEXT,
  node_id TEXT,
  requested_by_kind TEXT NOT NULL,
  requested_by_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  channels TEXT NOT NULL DEFAULT '[]',
  recipients TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '[]',
  artifacts TEXT NOT NULL DEFAULT '[]',
  record_mutation_id TEXT,
  context_summary TEXT,
  context_package_ids TEXT NOT NULL DEFAULT '[]',
  uncertainty TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_biz_approvals_workspace ON biz_approvals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_approvals_run ON biz_approvals(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_biz_approvals_status ON biz_approvals(status);

-- Privacy Policies
CREATE TABLE IF NOT EXISTS biz_privacy_policies (
  policy_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'private',
  rules TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_privacy_workspace ON biz_privacy_policies(workspace_id);

-- Execution Records (business-level view of canonical execution)
CREATE TABLE IF NOT EXISTS biz_execution_records (
  execution_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  module TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  workflow_definition_id TEXT,
  workflow_run_id TEXT,
  workflow_node_id TEXT,
  capability_kind TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  trust_tier TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_exec_records_workspace ON biz_execution_records(workspace_id);
CREATE INDEX IF NOT EXISTS idx_biz_exec_records_entity ON biz_execution_records(module, entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_biz_exec_records_run ON biz_execution_records(workflow_run_id);

-- Execution Leases (prevent duplicate mutation)
CREATE TABLE IF NOT EXISTS biz_execution_leases (
  workspace_id TEXT NOT NULL,
  lease_key TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, lease_key, execution_id)
);
CREATE INDEX IF NOT EXISTS idx_biz_exec_leases_key ON biz_execution_leases(workspace_id, lease_key);

-- Idempotency
CREATE TABLE IF NOT EXISTS biz_execution_idempotency (
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key)
);
`;

export const BUSINESS_OPERATING_LAYER_TABLE_NAMES = [
  'biz_record_mutations',
  'biz_outcomes',
  'biz_worker_authority',
  'biz_artifacts',
  'biz_approvals',
  'biz_privacy_policies',
  'biz_execution_records',
  'biz_execution_leases',
  'biz_execution_idempotency',
] as const;

/**
 * Apply migration to database that already has base tables.
 * Idempotent.
 */
export function applyOperatingLayerMigration(db: any): void {
  // Split by statements? SQLite can handle exec of multiple statements if using exec.
  // Use db.exec if available, else prepare.
  try {
    if (typeof db.exec === 'function') {
      db.exec(BUSINESS_OPERATING_LAYER_TABLES);
    } else {
      // Fallback: split by ';' and run each
      const statements = BUSINESS_OPERATING_LAYER_TABLES.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          db.prepare(stmt).run();
        } catch (e) {
          // Ignore if already exists
          if (!(e as Error).message.includes('already exists')) {
            console.warn(`[Migration] Statement failed:`, (e as Error).message, stmt.slice(0, 100));
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[Migration] Operating layer migration failed:`, (e as Error).message);
    // Try statement by statement
    const statements = BUSINESS_OPERATING_LAYER_TABLES.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      try {
        db.prepare(stmt).run();
      } catch {}
    }
  }

  // Extend biz_audit with new columns if missing (for provenance linkage)
  try {
    const cols = db.prepare(`PRAGMA table_info(biz_audit)`).all() as any[];
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('workflow_id')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN workflow_id TEXT`).run();
    }
    if (!colNames.includes('execution_id')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN execution_id TEXT`).run();
    }
    if (!colNames.includes('context_package_ids')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN context_package_ids TEXT`).run();
    }
    if (!colNames.includes('evidence_refs')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN evidence_refs TEXT`).run();
    }
    if (!colNames.includes('policy_decision')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN policy_decision TEXT`).run();
    }
    if (!colNames.includes('reversible')) {
      db.prepare(`ALTER TABLE biz_audit ADD COLUMN reversible INTEGER DEFAULT 0`).run();
    }
  } catch {}
}
