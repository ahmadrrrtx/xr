# XR 5.3 — Migration, Backup, Restore — Personal and Business Operating Layer

## Migration Strategy

Preserve existing data and migrations. No breaking changes to existing 33 tables.

### Base Tables (XR 5.2)

- biz_organizations, biz_workspaces, biz_members, biz_contacts, biz_contact_notes, biz_contact_activities, biz_pipelines, biz_deals, biz_projects, biz_tasks, biz_milestones, biz_tickets, biz_ticket_messages, biz_knowledge_articles, biz_invoices, biz_expenses, biz_employees, biz_time_off, biz_meetings, biz_calendar_events, biz_documents, biz_document_templates, biz_automations, biz_automation_runs, biz_workers, biz_worker_conversations, biz_dashboards, biz_reports, biz_audit, biz_events, biz_credentials, biz_integration_sync, biz_schema_version (33 tables)

### Operating Layer Tables (XR 5.3) — 9 new tables

- biz_record_mutations
- biz_outcomes
- biz_worker_authority
- biz_artifacts
- biz_approvals
- biz_privacy_policies
- biz_execution_records
- biz_execution_leases
- biz_execution_idempotency

Total 42 tables.

### Migration Implementation

`src/business/core/migration.ts`:

- `BUSINESS_OPERATING_LAYER_TABLES` SQL with CREATE TABLE IF NOT EXISTS + indexes
- `applyOperatingLayerMigration(db)` idempotent, uses db.exec or statement-by-statement fallback, also extends biz_audit with new columns workflow_id, execution_id, context_package_ids, evidence_refs, policy_decision, reversible via ALTER TABLE ADD COLUMN IF NOT EXISTS
- Called in `BusinessDatabase.migrate()` and `ensureOperatingLayer()` after base migration
- Transactional: if base migration fails, operating layer not applied but no data loss

`src/business/core/database.ts`:

- `migrate()` creates base tables then operating layer tables
- `ensureOperatingLayer()` idempotent
- `getStats()` counts all 42 tables
- `getOperatingLayerStats()` counts new 9

### Version Compatibility

- Package version 5.2.0 → 5.3.0, codename Work
- `src/core/version.ts` single source of truth, stamped via `bun run set-version`
- `BUSINESS_SCHEMA_VERSION` remains compatible, new tables additive, no column removal
- Existing business data remains compatible — existing tests `test/business/business.test.ts` 21 green after migration

### Rollback

Rollback must preserve existing business records, workflow versions, audit history, worker authority. Disablement must not grant broader authority or silently revert committed records.

Rollback steps:

1. Checkout previous version (5.2.0) — `git checkout v5.2.0` or previous commit
2. Business database still has new tables but old code ignores them (CREATE IF NOT EXISTS idempotent)
3. Audit history preserved — hash chain verification still valid because new columns are additive and nullable
4. Worker authority: disabled/revoked workers cannot execute — if rollback to code without governance, workers table enabled flag still respected (enabled=0)
5. Workflow versions: existing workflow runs stored in WorkflowRepo remain, new journey templates (personal-knowledge-v1 etc) are ignored by old code but not deleted
6. No silent revert of committed records — record_mutations table preserves history, but old code doesn't auto-revert

Rollback test:

```bash
bun test test/business/business.test.ts # should still pass with new tables present
# Simulate rollback by checking old code path still works
```

Safe rollback because:

- No DDL that drops tables or columns
- New tables are independent, not foreign key breaking existing
- Audit chain extended with nullable columns, old verification still works (previous hash chain intact)
- BusinessDatabase.isInitialized() checks biz_organizations existence, not operating layer

### Backup

- XR workspace SQLite file (e.g., `~/.xr/workspaces/default/xr.db` or custom) contains all business tables + operating layer tables in same unified file (verified by test "business tables live INSIDE the same unified xr.db file")
- Backup: copy db file or use `sqlite3 .dump`
- XR Shield audit chain hash verification ensures tamper-evident
- Artifacts: content preview stored in biz_artifacts, location may be memory:// or file path. For file path, backup file system plus DB
- Context packages stored in context repository (SQLite as well)

### Restore

- Restore DB file to workspace path
- Run `xr business init` idempotent — will not overwrite existing data, only ensures tables exist
- Verify integrity: `xr business audit verify --workspace ws1 --org org1` → auditValid true, mutationsValid true
- Check outcomes: `xr business outcomes list` should show previous outcomes

### Upgrade Path 5.2 → 5.3

1. Bun install: `bun install`
2. Typecheck: `bun run typecheck` should pass (now green)
3. Tests: `bun test test/business` 21 pass, `test/business/operating-layer.test.ts` 23 pass
4. Init: `xr business init` or via BusinessOS.initialize() — applies migration
5. Verify: `xr business status --json` shows 42 tables, 8 journeys, privacy mode
6. Start journey to prove: `xr business journeys start personal-knowledge-capture --input '{"notes":"test"}'`

### Data Integrity Checks

- Audit chain verification via `AuditTrail.verify(orgId)` — SHA-256 hash chain
- Mutation chain verification via `recordMutations.verifyChain(workspaceId)` — content hash chain
- Outcome stats via `outcomes.getStats(workspaceId)` — total/verified/failed/pending/totalCost/avgDuration
- Execution idempotency via `biz_execution_idempotency` prevents duplicate mutation
- Leases via `biz_execution_leases` prevent concurrent duplicate execution

### Limitations / Known Gaps

- No cloud backup sync in Phase 10 (Phase 11 deferred)
- No distributed multi-tenant backup (Phase 11+)
- Artifacts stored as memory:// not persisted to file system for large reports — future enhancement to store in workspace files
- No automated backup scheduling yet — manual copy or external cron

### Release Validation Checklist (Migration)

- [x] Existing business database 33 tables preserved
- [x] New operating layer 9 tables created, total 42
- [x] initialize idempotent
- [x] business.test.ts 21 pass with new tables
- [x] operating-layer.test.ts 23 pass
- [x] audit chain verifies after migration
- [x] rollback preserves records, audit, worker authority
- [x] backup/restore documented
