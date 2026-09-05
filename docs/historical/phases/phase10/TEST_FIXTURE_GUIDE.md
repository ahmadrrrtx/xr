# Test Fixture Guide — XR 5.3

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Fixture Creation

```ts
function createTestBiz() {
  const dir = mkdtempSync(join(tmpdir(), 'xr-biz-test-'));
  const sqlite = new Database(join(dir, 'test.db'));
  const db = new BusinessDatabase(sqlite);
  return { dir, sqlite, db };
}

const { db } = createTestBiz();
await db.initialize();
const orgs = new OrganizationManager(db);
const rbac = new RBACManager(db);
const bus = new BusinessEventBus(db);
const audit = new AuditTrail(db);
const operatingLayer = new BusinessOperatingLayer({ db, audit, bus, rbac });
await operatingLayer.initialize();

const org = orgs.create({ name: 'Test Org', slug: 'test-org', ownerId: 'owner-1' });
const members = rbac.listMembers(org.id);
const owner = members[0];
const wsId = db.prepare(`SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1`).get(org.id);
const workspaceId = wsId?.id ?? 'default';
```

## Unit Tests

- Business schemas: BUSINESS_TABLES CREATE TABLE IF NOT EXISTS idempotent
- RBAC: owner has workspace access, non-member denied
- Worker authority: createProfile narrow, enable/disable revokes, budget enforcement
- Workflow nodes: trigger, deterministic, agentic, human_approval, human_review, business_record, tool_action, notification, artifact_output, branch, join, completion, compensation — validated via hashDefinition, graph validation catches cycles/missing deps
- Outcome contracts: createPending, recordChange, attachArtifact/evidence, updateCost, verify, fail, stats
- Record mutations: propose/commit/deny/revert with provenance
- Provenance: artifact creation with hash, verify, listByWorkspace/WorkflowRun
- Artifacts: contract kind/name, sensitivity, linkedRecords
- Escalation rules: classifyAttention avoids fatigue, createRequest, decide, expireStale, workQueue grouping

## Integration Tests

End-to-end journeys via operatingLayer.startJourney:

- Personal knowledge capture: notes → tasks extraction → doc artifact → outcome with artifacts
- Developer project delivery: projectName → create project → milestone → plan doc artifact
- Research evidence report: topic → report artifact research_report with citations → KB article
- Customer support triage: ticket.created event → triage → assign
- Sales deal progression: dealId + stageId → move or approval if high-value
- Project meeting to doc: meetingId + transcript → meeting_notes artifact confidential
- Scheduling: title → create event + meeting
- Finance invoice from deal: dealId → invoice create → approval if >$5k

## Security/Privacy

- Unauthorized record access denied
- Worker escalation for high-risk external write
- Context leakage prevented via sensitivity check
- Privacy policy enforcement local vs private vs hybrid
- Credential broker reference-only

## Reliability

- Checkpoint safety classification: pre-action safe, running naturally_idempotent safe, non_idempotent requires_approval, safe checkpoint auto_resume
- LeaseManager: acquire, second renews same process, different targets separate, cleanup stale
- RecoveryManager: safe vs requires_approval vs blocked vs quarantined, dirty environments detection
- ExecutionBridge: idempotency key same executionId, lease conflict throws

## Data/Migration

- Existing business database 33→42 tables, initialize idempotent, audit chain intact, business.test.ts 21 PASS still
- Migration rollback preserves records, audit, worker authority
- Backup/restore: copy SQLite file, init idempotent, verify integrity auditValid + mutationsValid

## Performance

- Outcome getStats with indexes, listByWorkspace limit 50, workQueue grouping to avoid O(n^2), workflow MAX_TICKS 1000, parallel nodes Promise.allSettled

## User Flows

- At least one fully verified journey for personal, developer, research, customer/business, documents/meetings, scheduling/communication where existing modules support them — tested in operating-layer.test.ts 4 end-to-end

## Running Tests

```bash
bun test test/business/business.test.ts
bun test test/business/operating-layer.test.ts
bun test test/workflow
bun test test/execution
bun test
```

## Fixtures for Manual Testing

- Use `xr business journeys start personal-knowledge-capture --input '{"notes":"- [ ] Task A"}' --json`
- Check outcome via `xr business outcomes show <id> --json`
- Check work queue via `xr business work-queue --json`
- Check workers via `xr business workers list --json`
