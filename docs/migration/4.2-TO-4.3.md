# XR 4.2 → 4.3 Migration Guide

## Summary

XR 4.3 adds additive schema tables for durable agency. No existing data is modified. All XR 4.2 execution and workflow records remain readable.

## Schema Changes

### New Tables (additive / CREATE TABLE IF NOT EXISTS)

All new tables use `CREATE TABLE IF NOT EXISTS` — they are idempotent and safe to run multiple times.

1. **`execution_checkpoints`** — durable checkpoints at safe semantic boundaries
2. **`execution_leases`** — ownership guards preventing duplicate execution
3. **`execution_recoveries`** — durable records of recovery decisions  
4. **`execution_cancellations`** — cancellation requests that survive restart
5. **`environment_attachments`** — environment lifecycle tracking for recovery

### No Modifications to Existing Tables

- `execution_records` — unchanged
- `agent_workflows` / `agent_tasks` — unchanged
- All other tables — unchanged

## Migration Steps

### Automatic Migration

The migration runs automatically on first XR 4.3 startup:
1. `ExecutionRepo.migrate()` — existing table, idempotent
2. `CheckpointManager.migrate()` — new tables, idempotent
3. `LeaseManager.migrate()` — new tables, idempotent
4. `RecoveryManager.migrate()` — new tables, idempotent

### Manual Steps (if needed)

No manual steps required. The migration is fully automatic.

### Backup

```bash
# Before upgrading
cp -r ~/.xr/workspaces ~/.xr/workspaces.backup
```

## Legacy Active-Work Classification

On first XR 4.3 startup, any execution records in active states (running, queued, observing, awaiting_*) will be:

1. **Discovered** by `ExecutionRepo.findInterrupted()`
2. **Classified** by `RecoveryManager.classify()`
3. **Default action**: if no checkpoint exists, classification is `unknown_side_effect` → `requires_approval`

Records are **never** silently auto-resumed if their side-effect status is unknown.

## Rollback

### Code Rollback

```bash
git checkout v4.2.0  # or the last 4.2 tag
bun install
```

### Schema Rollback

New tables are additive-only. XR 4.2 will simply ignore them (they are not queried). No rollback SQL is required.

### Data Safety

- All 4.2 data remains intact and readable
- New 4.3 tables contain only metadata; user/execution/workflow data is unchanged
- Fallback: if recovery is unsafe, disable automatic resume via configuration

## Configuration

New recovery settings have safe defaults:

- `DURABILITY_BOUNDS.MAX_ACTIVE_EXECUTIONS` = 50
- `DURABILITY_BOUNDS.MAX_RECOVERY_OPERATIONS` = 5
- `DURABILITY_BOUNDS.RECOVERY_TIMEOUT_MS` = 30000
- `DURABILITY_BOUNDS.CHECKPOINT_RETENTION_MS` = 7 days
- `DURABILITY_BOUNDS.LEASE_TTL_MS` = 5 minutes

No new user-facing configuration is required. All settings use bounded, safe defaults.
