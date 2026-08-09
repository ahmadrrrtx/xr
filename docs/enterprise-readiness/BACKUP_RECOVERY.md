# XR 6.1 — Backup and Disaster Recovery Guide

**Module:** `src/enterprise/recovery/operations.ts`
**Builds on:** Phase 11 `BackupService` (`src/deployment/backup/service.ts`)

---

## 1. The controlling principle

> **An unverified backup is not a backup. A restore that has never been tested is not a recovery plan.**

XR refuses to restore a backup that does not verify. This is deliberate: restoring corrupted or attacker-supplied state is worse than not restoring at all.

---

## 2. Backup scope

| Component | Contents |
|---|---|
| `execution_records` | Task execution history |
| `workflow_states` | Workflow run state |
| `checkpoints` | Durable-agency checkpoints |
| `audit_records` | Hash-chained audit log |
| `artifacts_metadata` | Artifact references (not payloads) |
| `workspace_config` | Workspace settings |
| `memory_records` | Context and memory |
| `user_preferences` | User settings |
| `policy_records` | Policy bundles and authority records |

### Credentials are never backed up

Backups contain credential **references** (`ref:cred_abc`), never raw secrets. Verification actively scans for embedded credential material and **blocks restore** if any is found.

```ts
scanObjectForCredentials({ config: { apiKey: "sk-live-123" } });  // ["config.apiKey"]  → BLOCKED
scanObjectForCredentials({ config: { apiKey: "ref:cred_abc" } }); // []                 → allowed
```

---

## 3. Verification

```bash
xr enterprise recovery verify bk_20260728_0300
```

```
Backup verification — bk_20260728_0300
  status:            verified
  manifest hash:     matches
  components:        9/9 ok
  credential safety: clean
```

| Status | Meaning | Restorable |
|---|---|---|
| `verified` | Digest matches, components consistent, no credentials | yes |
| `unverified` | Content could not be read to recompute the digest | **no** |
| `corrupt` | Digest mismatch — altered or damaged | **no** |
| `incomplete` | Component metadata inconsistent | **no** |

---

## 4. Restore preflight — the anti-poisoning gate

```
restore(plan)
  └─► preflight()
        ├─ integrity      recompute and compare the manifest digest
        ├─ credentials    scan for embedded secrets
        ├─ version        major versions must match
        ├─ profile        multi-user backup ⇏ single-user profile
        ├─ components     requested components exist in the backup
        └─ consistency    warn when a consistency group is split
              │
              ├── any blocker  ──► RESTORE REFUSED — nothing applied
              └── clean        ──► apply, report per-component outcome
```

```ts
const plan = services.recovery.createPlan({ backupId, mode: "full", requestedBy: "ops" });
const pre  = services.recovery.preflight(plan);

if (!pre.ok) {
  console.error("Blocked:", pre.blockers);
  // e.g. "Backup did not verify (status: corrupt). Restore is refused to prevent
  //       restoring corrupted or tampered data."
}
```

### Cross-deployment restore rules

| Source → Target | Allowed | Why |
|---|---|---|
| same → same | yes | — |
| `personal_local` → `team_private` | yes | Target has a richer tenancy model |
| `team_private` → `personal_local` | **no** | Target has no tenancy model to enforce the boundaries the data assumes |
| `managed_cloud` → `private_local_server` | **no** | Same reason |

### Consistency groups

Restoring one member of a group without the others produces state the runtime cannot reason about:

- `execution_records` + `checkpoints`
- `workflow_states` + `execution_records`
- `audit_records` + `policy_records`

Partial restores that split a group produce explicit consistency warnings.

---

## 5. Restoring

```ts
// Always dry-run first.
const dry = services.recovery.restore(
  services.recovery.createPlan({ backupId, mode: "dry_run", requestedBy: "ops" }),
);

// Then apply.
const { outcome } = services.recovery.restore(
  services.recovery.createPlan({ backupId, mode: "full", requestedBy: "ops" }),
);

outcome.ok;                   // false if any component failed
outcome.partial;              // true if only some components applied
outcome.componentsRestored;
outcome.componentsFailed;
outcome.consistencyWarnings;  // e.g. "execution_records restored but checkpoints did not"
outcome.rtoMs;
```

A partial restore is reported honestly rather than presented as success.

---

## 6. RPO and RTO

Declared per deployment profile (Phase 11 `RecoveryConfig`), measured by Phase 12.

```bash
xr enterprise recovery targets
```

```
Recovery targets
  RPO target: 1440 min   measured: 42
  RTO target: 240 min    measured: unknown
  RPO measured as time since last successful backup (42 min).
  RTO not measured: no restore or drill recorded.
```

**Unmeasured values report `unknown`, never a guess.** An unmeasured RTO is a gap in your recovery plan, and XR says so instead of hiding it.

---

## 7. Drills — the evidence that backups work

```bash
xr enterprise recovery drill bk_20260728_0300          # dry run
xr enterprise recovery drill bk_20260728_0300 --apply  # real restore (non-production!)
```

```ts
const drill = services.recovery.drill({
  backupId,
  executedBy: "ops-oncall",
  notes: "Monthly Q3 drill",
  lastBackupAt: lastBackup.createdAt,
});

drill.ok;           // preflight clean AND restore succeeded
drill.assessment;   // measured RPO/RTO vs targets
```

**Recommended cadence** (operational control DR-05):

| Deployment | Verification | Dry-run drill | Applied drill |
|---|---|---|---|
| `personal_local` | weekly | monthly | quarterly |
| `private_local_server` | daily | monthly | quarterly |
| `team_private` | daily | weekly | quarterly |
| `managed_cloud` | daily | weekly | monthly |
| `hybrid` | daily | weekly | monthly |

Run applied drills against a **restore target**, never production.

---

## 8. Operational runbook

### Routine (automate)

```bash
xr enterprise recovery verify "$LATEST_BACKUP_ID" --json | jq -e '.status == "verified"'
```

Feed the result into the `backup_success` SLO:

```ts
services.slo.observeOutcome("backup_success", verification.status === "verified");
```

### Disaster

1. **Stop writes** to the damaged deployment.
2. **Identify a candidate:** `xr enterprise recovery verify <id>` — work backwards until one verifies.
3. **Preflight:** review blockers and warnings. Do not override.
4. **Dry run:** confirm component coverage.
5. **Restore:** apply, then review `componentsFailed` and `consistencyWarnings`.
6. **Verify after:** run `xr enterprise audit verify` — the chain must still verify.
7. **Re-review** residency and tenancy settings if this was a cross-deployment restore.
8. **Record** the incident and measured RTO.

### If no backup verifies

Do **not** force a restore. Escalate, declare an incident, preserve every candidate backup as evidence, and rebuild from the last known-good state plus replayed audit history.

---

## 9. Limitations

| Limitation | Detail |
|---|---|
| Credential detection is heuristic | Based on key names and value shape. A secret in a free-text field may evade it. |
| Integrity ≠ authenticity | SHA-256 proves the content is unchanged, not who produced it. Signed backups are deferred. |
| Applied drills mutate state | Run against a restore target, not production. |
| XR restores XR state | Host-level OS, filesystem, and container images are out of scope. |
| RPO/RTO are per-deployment | XR does not collect fleet-wide recovery telemetry by design. |

---

## 10. Related

- `SLO_OBSERVABILITY.md` — the `backup_success` objective
- `INCIDENT_RESPONSE.md` — `restore_backup` as a response action
- `ENTERPRISE_TRUST_ARCHITECTURE.md` §10
- Controls DR-01 … DR-05 in `CERTIFICATION_EVIDENCE.md`
