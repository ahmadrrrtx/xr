# XR 6.1 — Incident Response Guide

**Applies to:** XR 6.1.0+
**Module:** `src/enterprise/incidents/workflow.ts`
**Assurance:** the state machine and evidence integrity are **technical**; exercise cadence and staffing are **operational**.

---

## 1. Scope

This guide covers detection, containment, remediation, and postmortem for security incidents affecting an XR deployment. It applies to all deployment profiles — a `personal_local` user runs the same workflow at smaller scale.

---

## 2. Incident lifecycle

```
  detected ──┬──► triaged ──┬──► contained ──┬──► remediating ──► resolved ──► postmortem
             │              │                │                        ▲
             ├──────────────┴──► quarantined─┴────────────────────────┘
             │
             └──────────────────────────────────────────────► resolved
```

| State | Meaning | Exit criteria |
|---|---|---|
| `detected` | Something suspicious was observed. | Triaged, or contained directly if severity demands it. |
| `triaged` | Scope, severity, and affected assets are understood. | A containment plan exists. |
| `contained` | The active harm has stopped. | Root cause work can begin safely. |
| `quarantined` | A specific capability/publisher/worker is isolated. | Safe version restored or removed. |
| `remediating` | Fixes are being applied. | Fix verified. |
| `resolved` | No ongoing impact. | Postmortem written. |
| `postmortem` | Analysis complete and recorded. | Terminal. |

**Fast paths are intentional.** `detected → contained` and `detected → quarantined` are legal. Contain first; document second.

---

## 3. Supported incident kinds

| Kind | Typical trigger | First containment action |
|---|---|---|
| `capability_abuse` | A skill/plugin exceeds its declared behavior. | `quarantine_capability` |
| `credential_exposure` | A secret appears in logs, a repo, or an export. | `rotate_credential`, `revoke_identity` |
| `isolation_failure` | A task escapes its risk tier or sandbox. | `disable_worker`, raise `minRiskTier` |
| `tenant_data_leakage` | Data crosses an organization or workspace boundary. | `revoke_delegation`, scope audit export |
| `provider_compromise` | An AI provider or upstream service is breached. | `block_provider` |
| `malicious_package` | A capability ships hostile code. | `quarantine_capability`, `revoke_publisher` |
| `audit_failure` | The audit chain fails verification or writes stop. | Preserve evidence, halt destructive retention |
| `worker_compromise` | A worker's identity or host is compromised. | `disable_worker`, `revoke_identity` |

---

## 4. User notification is not optional

These kinds **always** set `userVisibleImpact`, regardless of severity:

- `tenant_data_leakage`
- `credential_exposure`
- `isolation_failure`
- `audit_failure`

Any incident at `critical` or `high` severity also sets it.

**An administrator cannot clear this flag.** Users in scope must be able to see that an incident affected their workspace. This is the `showIncidentImpact` policy invariant, enforced in `policy/layers.ts` and tested in `security-adversarial.test.ts`.

---

## 5. Runbook

### 5.1 Declare

```bash
xr enterprise incident declare \
  --kind malicious_package \
  --severity critical \
  --title "Skill exfiltrating credentials" \
  --summary "outbound POSTs to unknown host observed after update to 1.3.0"
```

```ts
const incident = services.incidents.declare({
  kind: "malicious_package",
  severity: "critical",
  title: "Skill exfiltrating credentials",
  summary: "Outbound POSTs to an unknown host after 1.3.0.",
  detectedBy: "shield",
  affected: ["skill:acme-crm"],
});
```

### 5.2 Preserve evidence — do this BEFORE containment

Containment mutates state. Snapshot first.

```ts
services.incidents.captureEvidence({
  incidentId,
  kind: "capability_snapshot",
  description: "Capability state at detection",
  capturedBy: "responder",
  payload: { capabilityId: "skill:acme-crm", version: "1.3.0", lifecycleState: "enabled" },
});

services.incidents.captureEvidence({
  incidentId,
  kind: "audit_range",
  description: "Audit records covering the incident window",
  capturedBy: "responder",
  payload: { fromSequence: 41200, toSequence: 41890 },
});
```

Evidence is hash-committed at capture. Verify at any time:

```ts
services.incidents.verifyEvidence(incidentId); // { ok, checked, tampered }
```

> **Note:** `SupplyChainResponseService.revoke()` snapshots automatically before quarantining, so capability evidence is preserved even if you skip this step.

### 5.3 Contain

```ts
services.incidents.contain({
  incidentId,
  actorId: "responder",
  reason: "Confirmed credential exfiltration.",
  actions: [
    { kind: "quarantine_capability", targetId: "skill:acme-crm" },
    { kind: "revoke_delegation", targetId: "del_abc123" },
    { kind: "rotate_credential", targetId: "cred_crm_token" },
  ],
});
```

Moves to `quarantined` when a capability or publisher was quarantined; otherwise `contained`. Fails if **no** action succeeded — the incident stays open rather than falsely appearing handled.

### 5.4 Remediate and resolve

```ts
services.incidents.transition(incidentId, "remediating", "responder", "Restoring 1.2.9.");
services.supplyChain.restoreSafeVersion({
  capabilityId: "skill:acme-crm",
  version: "1.2.9",
  actorId: "responder",
  reason: "Last known-good version.",
});
services.incidents.transition(incidentId, "resolved", "responder", "Safe version restored, credentials rotated.");
```

`restoreSafeVersion` refuses to restore a version that is itself revoked.

### 5.5 Postmortem

```ts
services.incidents.postmortem({
  incidentId,
  writtenBy: "security-lead",
  rootCause: "Publisher account compromised; malicious 1.3.0 signed with a stolen key.",
  impact: "One workspace. CRM token exposed, rotated within 22 minutes. No customer data left the deployment.",
  timelineSummary: "Detected 14:02, contained 14:11, resolved 14:24.",
  correctiveActions: [
    "Require hardware-backed signing keys for network-capable capabilities.",
    "Alert on first outbound host never seen before for a capability.",
  ],
  publish: true,
});
```

---

## 6. Response actions and their bridges

| Action | Bridges to | Reversible |
|---|---|---|
| `quarantine_capability` | Phase 9 `CapabilityService.quarantine` | yes |
| `revoke_publisher` | `SupplyChainResponseService.revokePublisher` | no |
| `revoke_delegation` | `DelegationRegistry.revoke` (cascades) | yes |
| `revoke_identity` | Phase 11 `IdentityService.revokeIdentity` | no |
| `disable_worker` | Phase 11 worker registry | yes |
| `block_provider` | Provider routing layer | yes |
| `rotate_credential` | `CredentialBroker` | no |
| `restore_backup` | `RecoveryOperations.restore` | no |
| `notify` | Notification surface | no |

Handlers are injected at construction. A missing handler records a **failed** action rather than silently doing nothing.

---

## 7. Response-time objective

`security_event_response` targets **p95 ≤ 60 minutes** from detection to first containment over a 90-day window.

```ts
const ms = services.incidents.responseTimeMs(incidentId);
if (ms !== undefined) services.slo.observeLatency("security_event_response", ms);
```

---

## 8. Incident exercises (operational control IR-04)

Run each scenario at least **annually**; run the capability and credential scenarios **semi-annually**.

| # | Scenario | Kind | Success criteria |
|---|---|---|---|
| E1 | A signed skill begins exfiltrating data after an update. | `malicious_package` | Evidence captured before quarantine; publisher revoked; safe version restored; users notified. |
| E2 | A worker token is committed to a public repository. | `credential_exposure` | Identity revoked; delegations cascade-revoked; credential rotated; user-visible flag set. |
| E3 | A task escapes its tier-1 sandbox. | `isolation_failure` | Worker disabled; `minRiskTier` raised by policy; incident user-visible. |
| E4 | Workspace A reads Workspace B's records. | `tenant_data_leakage` | Delegation revoked; scoped audit export produced; postmortem published. |
| E5 | The audit chain fails verification. | `audit_failure` | Retention deletion halted via legal hold; break point identified; chain evidence preserved. |
| E6 | An AI provider discloses a breach. | `provider_compromise` | Provider blocked; affected executions identified; routing failover verified. |
| E7 | A publisher's signing key is stolen. | `compromised_publisher` | All their capabilities quarantined; installs blocked; notices acknowledged. |
| E8 | A backup is found to be corrupt during a drill. | operational | Restore refused by preflight; alternate backup located; RPO impact recorded. |

**Record for each exercise:** date, participants, scenario, detection time, containment time, what worked, what did not, and corrective actions. Store alongside the certification evidence pack.

> These exercises are an **operational** control. XR provides the workflow and records the results; it cannot run the exercise for you.

---

## 9. CLI reference

```bash
xr enterprise incident list [--open] [--severity critical] [--json]
xr enterprise incident show <incidentId> [--json]
xr enterprise incident declare --kind <kind> --severity <sev> --title <t> --summary <s>
xr enterprise incident evidence <incidentId> --kind <kind> --description <d>
xr enterprise incident contain <incidentId> --action <kind>:<targetId> --reason <r>
xr enterprise incident transition <incidentId> --to <state> --detail <d>
xr enterprise incident search <query>
```

---

## 10. What this guide does not cover

- **Legal and regulatory notification deadlines.** Jurisdiction-specific; consult counsel. XR's legal-hold mechanism supports preservation but does not advise on obligations.
- **Customer communications.** XR records `userVisibleImpact` and publishes postmortems; drafting external comms is organizational.
- **Forensic imaging of the host.** Out of scope; XR preserves its own records only.
