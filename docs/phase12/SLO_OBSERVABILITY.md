# XR 6.1 — SLO and Observability Guide

**Module:** `src/enterprise/operations/`

---

## 1. The rule

> **Do not promise an SLO you cannot measure.**

Every objective declares whether XR can actually measure it, from which signal, and — when it cannot — exactly what is missing. An SLO with no samples reports `unmeasurable`. It never reports `meeting`.

---

## 2. The catalog

| SLO | Objective | Window | Measurable | Source |
|---|---|---|---|---|
| `runtime_availability` | 99.5% | 30d | yes | local plane heartbeat |
| `task_completion` | 98% | 7d | yes | execution terminal states |
| `task_recovery` | 95% | 30d | yes | Phase 4 checkpoint recovery |
| `approval_delivery` | p95 ≤ 5000ms | 7d | yes | approval-escalation events |
| `worker_health` | 99% | 7d | yes | worker heartbeats |
| `provider_routing_availability` | 99% | 7d | yes | provider selection outcomes |
| `backup_success` | 99% | 30d | yes | backup verification records |
| `audit_export` | 99% | 30d | yes | export manifest status |
| `security_event_response` | p95 ≤ 60min | 90d | yes | incident detect → contain |
| `upgrade_rollback` | 99% | 180d | **no** | see below |

### Why `upgrade_rollback` is unmeasurable

> Upgrade telemetry is not collected from installed deployments by design (XR does not phone home). This SLO is measurable only for locally recorded upgrades and is reported per-deployment, not fleet-wide.

We could have quietly published a 99% number computed from nothing. We don't.

---

## 3. Statuses

| Status | Meaning |
|---|---|
| `meeting` | Within objective, error budget healthy |
| `at_risk` | Within objective, but ≤25% of the error budget remains |
| `breaching` | Outside the objective |
| `unmeasurable` | No samples, or the signal does not exist |
| `not_applicable` | The SLO does not apply to this deployment profile |

`worker_health` reports `not_applicable` on `personal_local` — there are no remote workers to measure.

---

## 4. Recording samples

```ts
// Ratio SLOs
services.slo.observe("task_completion", 98, 100);      // batch
services.slo.observeOutcome("task_completion", true);  // single event

// Latency SLOs
services.slo.observeLatency("approval_delivery", 842);
```

### Wiring to real signals

```ts
// Task completion
executionBus.on("terminal", (e) => {
  services.slo.observeOutcome("task_completion", e.state === "succeeded");
});

// Approval delivery
approvals.on("delivered", (e) => {
  services.slo.observeLatency("approval_delivery", e.deliveredAt - e.createdAt);
});

// Backup success
services.slo.observeOutcome("backup_success", verification.status === "verified");

// Audit export
services.slo.observeOutcome("audit_export", manifest.status === "complete");

// Security response
const ms = services.incidents.responseTimeMs(incidentId);
if (ms !== undefined) services.slo.observeLatency("security_event_response", ms);

// Worker health
services.slo.observe("worker_health", healthyWorkers, totalWorkers);
```

---

## 5. Error budgets

For a ratio SLO with objective `O` and measured `M`:

```
allowed failure   = 1 − O
actual failure    = 1 − M
budget remaining  = 1 − (actual failure / allowed failure)
```

Objective 98%, measured 99% → allowed 2%, actual 1% → **50% budget remaining**.

Latency SLOs use **p95** and have no error budget; `at_risk` triggers within 125% of the objective.

---

## 6. Reading status

```bash
xr enterprise slo
xr enterprise slo --json
xr enterprise status
```

```
runtime_availability           meeting                     99.94% / 99.50%
    9994/10000 = 99.940% against an objective of 99.500%. Error budget remaining: 88.0%.
worker_health                  not_applicable                   — / 99.00%
    Not applicable to deployment profile 'personal_local'.
upgrade_rollback               unmeasurable                     — / 99.00%
    Upgrade telemetry is not collected from installed deployments by design…
```

---

## 7. Aggregate operational status

```ts
const status = buildOperationalStatus({
  profile: "team_private",
  deployment: deploymentStatus,          // Phase 11
  sloReports: services.slo.reportAll(),
  incidents: services.incidents.list(),
  backup: { lastBackupAt, lastVerifiedAt, successRate: services.recovery.backupSuccessRate() },
  recovery: { lastDrill: services.recovery.lastDrill() },
  quarantinedCapabilities: services.supplyChain.activeRevocations().length,
  revokedDelegations: services.authority.list({ state: "revoked" }).length,
});
```

Overall rolls up as: `offline` › `critical` › `degraded` › `healthy`.

### Alert conditions

| Condition | Severity | Trigger |
|---|---|---|
| `slo.*.breaching` | error | SLO outside objective |
| `slo.*.at_risk` | warning | Error budget ≤25% |
| `incident.*` | critical | Open critical incident |
| `incident.*.untriaged` | warning/critical | Detected but not triaged |
| `backup.none` | warning | No backup recorded |
| `backup.unverified` | warning | Backups exist, none verified |
| `backup.failures` | error | Verification success rate < 99% |
| `recovery.no_drill` | warning | No restore drill recorded |
| `recovery.targets_missed` | error | RPO/RTO not met |
| `workers.degraded` | warning/critical | Unhealthy workers |

```ts
alertsAtOrAbove(status, "error").forEach((a) => pager.send(a));
```

---

## 8. A bare deployment is honest, not green

A fresh `personal_local` install reports:

```
overall:  degraded
Alerts (2)
  warning  backup     No backup has been recorded for this deployment.
  warning  recovery   No restore drill has been recorded.
```

That is correct. A deployment with no backup and no tested restore **is** degraded. Reporting "healthy" would be a lie of omission.

---

## 9. Integrating with external monitoring

XR is pull-based; it does not stream to a SIEM (deferred to a later phase).

```bash
# Prometheus textfile collector
xr enterprise status --json | jq -r '
  .slos[] | select(.measured != null) |
  "xr_slo_measured{slo=\"\(.definition.id)\",status=\"\(.status)\"} \(.measured)"
' > /var/lib/node_exporter/xr.prom

# Alert on anything at error or above
xr enterprise status --json | jq -e '[.alerts[] | select(.severity=="error" or .severity=="critical")] | length == 0'
```

---

## 10. Limitations

| Limitation | Detail |
|---|---|
| Samples are in-memory | Bounded per SLO (default 10k). Persist externally for long windows. |
| No fleet aggregation | XR does not phone home. SLOs are per-deployment. |
| Latency uses p95 only | p50/p99 are not currently computed. |
| No streaming export | Pull-based only; webhook/SIEM fan-out is deferred. |
| SLOs measure XR | Not the AI provider's own availability. |

---

## 11. Related

- `ENTERPRISE_TRUST_ARCHITECTURE.md` §7
- `INCIDENT_RESPONSE.md` — the `security_event_response` objective
- `BACKUP_RECOVERY.md` — the `backup_success` objective
- Controls OP-01, OP-02 in `CERTIFICATION_EVIDENCE.md`
