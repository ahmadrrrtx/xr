# XR 6.1 — Enterprise Trust Architecture

**Phase 12 — Enterprise Trust and Operations**
**Status:** implemented in `src/enterprise/`

---

## 1. What this phase is, and what it is not

Phase 12 makes XR **governable, supportable, measurable, and operable** by organizations, without weakening local autonomy or user trust.

**It is:** enforceable policy, delegated authority, verifiable audit export, measurable SLOs, incident response, supply-chain response, tested disaster recovery, release/support policy, and evidence prepared for an independent assessment.

**It is not:** a compliance badge. Every control in this phase is code plus a test. Where a guarantee depends on humans or on an external auditor, it says so explicitly and is not counted as a technical control.

---

## 2. Guiding invariants

These five statements are enforced by tests, not just documentation.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Organization policy may **tighten** safety, never loosen it. | `policy/engine.ts` — most-restrictive-wins; `test/enterprise/policy.test.ts` |
| I2 | No policy layer, **including platform defaults**, may hide user-visible safety information. | `policy/layers.ts` visibility invariants; `test/enterprise/security-adversarial.test.ts` |
| I3 | Delegated authority is always a **strict subset** of the delegator's authority. | `authority/delegation.ts`; `test/enterprise/authority.test.ts` |
| I4 | Audit stays **tamper-evident even after redaction**. | `audit/redaction.ts` digest commitment; `test/enterprise/audit-export.test.ts` |
| I5 | Enterprise features are **additive** — `personal_local` works fully offline. | `index.ts` `createEnterpriseServices`; `test/enterprise/governance-matrix.test.ts` |

---

## 3. Trust boundaries

Phase 12 adds **B11** to XR's existing boundary map.

```
                    ┌─────────────────────────────────────────┐
   Untrusted   B1   │  Shield / Guard        (Phase 3)         │
   content    ────► │  prompt-injection, tool-abuse defense    │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
   Agent       B2   │  Risk classification   (Phase 3)         │
   intent     ────► │  RiskTier: tier0 / tier1 / tier2         │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
               B3   │  Placement / isolation (Phase 3)         │
                    │  in-process → restricted → ns → container│
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
               B4   │  AuthorityGrant issuance (Phase 3)       │
               B5   │  CredentialBroker — refs, never secrets  │
                    └───────────────┬─────────────────────────┘
                                    ▼
   ┌────────────────────────────────┴─────────────────────────┐
   │                    PHASE 12 ADDITIONS                     │
   │                                                           │
   │  B11  Organization administration → user visibility       │
   │       ────────────────────────────────────────────        │
   │       An administrator may restrict what an AI can do.    │
   │       An administrator may NOT hide what it did, what     │
   │       policy applied, what data was in scope, or that an  │
   │       incident affected the user.                         │
   │                                                           │
   │       This boundary is one-way and non-negotiable.        │
   └───────────────────────────────────────────────────────────┘
```

Existing boundaries B6 (capability provenance), B7 (tenant isolation), B8 (control/data plane), B9 (audit chain), and B10 (deployment profile gate) are **extended**, not replaced.

---

## 4. Policy architecture

### 4.1 Six layers

| Layer | Privilege | Specificity | Who authors it |
|---|---|---|---|
| `platform_default` | 5 (highest) | 0 | XR itself — the safety floor |
| `deployment` | 4 | 1 | Deployment operator |
| `organization` | 3 | 2 | Organization administrators |
| `workspace` | 2 | 3 | Workspace administrators |
| `user_task` | 1 | 4 | The user, per task |
| `capability` | 0 (lowest) | 5 | A capability, about itself |

**Privilege** controls who may *author* a layer. **Specificity** controls which value wins for ordinary preferences.

### 4.2 Two resolution rules

```
Is the key a user-visibility invariant?
  ├── YES → effective value is ALWAYS true.
  │         Any layer proposing false is REJECTED and RECORDED
  │         as a critical override attempt.
  │
  └── NO → Is the key safety-relevant?
            ├── YES → MOST RESTRICTIVE value across ALL layers wins.
            │         Weaker proposals are recorded as warnings.
            │         A privileged layer cannot loosen a strict one.
            │
            └── NO  → MOST SPECIFIC layer wins (normal precedence).
```

### 4.3 The safety key registry

Registered in `SAFETY_KEY_SPECS` (`policy/layers.ts`). Adding a key here automatically gives it most-restrictive resolution:

`minRiskTier`, `requireApprovalAbove`, `allowNetworkEgress`, `allowFilesystemWrite`, `allowProcessSpawn`, `allowRemotePlacement`, `allowUnsignedCapabilities`, `allowUncertifiedCapabilities`

`requireApprovalAbove` inverts: a **lower** threshold means more approvals, so it is stricter.

### 4.4 The visibility invariants

Non-overridable at every layer:

| Key | Meaning |
|---|---|
| `showApprovalRequests` | Users always see approval requests involving their work. |
| `showPolicyEffects` | Users always see which policy restricted an action. |
| `showDataScope` | Users always see what data an action can read or write. |
| `showActionProvenance` | Users always see which actor/capability acted. |
| `showCapabilityTrust` | Users always see trust, signature, and quarantine state. |
| `showIncidentImpact` | Users always see incidents affecting their workspace. |

### 4.5 Decision traces

Every resolution returns a full trace: each candidate, whether it applied, and why. Nothing is silent.

```ts
const resolution = resolvePolicy(rules, { organizationId: "org1" });
explainPolicyKey(resolution, "allowNetworkEgress");
// → "allowNetworkEgress = false (most restrictive, from organization)"
//   "→ organization: false — applied: most restrictive value"
//   "  platform_default: true — not applied: weaker than effective value"

resolution.rejectedOverrides; // every weakening attempt, never dropped
```

### 4.6 Bundles

Policy ships as **versioned, reversible bundles** with a content hash and a lineage. Activation supersedes the previous bundle; rollback restores it. A bundle is re-validated at activation **and** at rollback, so a rollback can disable administrative changes but can never reinstate an unsafe policy.

---

## 5. Delegated authority

No new identity system. Subjects are opaque references to existing Phase 11 `RemoteIdentity.identityId` or business `Member.id` / `AIWorker.id`.

```
Alice (human)
  scopes:  fs:read, net:egress, deal:update
  ceiling: tier2_isolated
     │
     │  delegates  ──►  requested: fs:read, net:egress, admin:billing
     │                  ┌──────────────────────────────────────┐
     │                  │ admin:billing is NOT held by Alice    │
     │                  │ → STRIPPED, recorded in deniedScopes  │
     │                  └──────────────────────────────────────┘
     ▼
Sales Worker (AI)
  scopes:  fs:read, net:egress          ← strict subset
  ceiling: tier1_restricted             ← min(requested, delegator)
  depth:   1                            ← bounded at 4
```

**Properties:**
- Scopes support one trailing wildcard segment (`fs:*` holds `fs:read`).
- The risk ceiling only ever narrows down a chain.
- Revocation is immediate and **cascades** to every descendant.
- Cross-organization delegation is refused.
- Delegations carry a review due date and become `pending_review` when overdue.
- A review may only **reduce** scope.
- Organization policy narrows effective authority, and every removal is recorded in `restrictedByPolicy` with a reason — visible to the user, never silent.

---

## 6. Audit: verifiable redaction

The hard problem: redaction normally destroys tamper-evidence.

**XR's solution:**

```
Original record                          Redacted export record
─────────────────                        ──────────────────────
detail: { token: "sk-live-xyz",          detail: { token: "sha256:d3d920a7…",
          note:  "deploy" }                        note:  "deploy" }
prevHash: abc…                           prevHash: abc…      ← UNCHANGED
hash:     def…                           hash:     def…      ← UNCHANGED
                                         redactedFields: [{
                                           path: "token",
                                           mode: "hash",
                                           originalDigest: "d3d920a7…",  ← commitment
                                           reason: "Credential material…"
                                         }]
                                         originalHash: def…
```

- Chain verification still works — hashes are untouched.
- An auditor **with** source access runs `proveRedactionFaithful()` to confirm the redaction removed only what it claimed.
- An auditor **without** source access still verifies the chain.
- `proveRedactionFaithful()` also detects a record that *claims* redaction while still carrying the original value.

### Export guarantees

| Concern | Behavior |
|---|---|
| Access control | Pluggable authorizer; denials produce a `denied` manifest and a logged entry. |
| Scope | Filtered by organization and workspace — cross-tenant export is impossible. |
| Restricted data | Withheld unless `includeRestricted` is explicitly authorized. |
| Truncation | **Never silent.** Status becomes `partial` with an `incompleteReason`. |
| Source failure | Produces a `failed` manifest, never a throw. |
| Integrity | Content hash, first/last chain hashes, and an independent `chainVerified` flag. |
| Access logging | Every export, view, and verify is recorded. |

### Retention and legal hold

Per-event-class retention with archive/delete actions. An active legal hold **blocks** deletion and reports it as an explicit `hold_blocked` conflict — the deletion-vs-retention case the roadmap requires. Runs default to `dryRun: true`.

---

## 7. Operations and SLOs

Ten objectives, each declaring whether XR can actually measure it.

| SLO | Objective | Window | Measurable | Source |
|---|---|---|---|---|
| `runtime_availability` | 99.5% | 30d | yes | local plane heartbeat |
| `task_completion` | 98% | 7d | yes | execution terminal states |
| `task_recovery` | 95% | 30d | yes | Phase 4 checkpoint recovery |
| `approval_delivery` | p95 ≤ 5s | 7d | yes | approval-escalation events |
| `worker_health` | 99% | 7d | yes | worker heartbeats |
| `provider_routing_availability` | 99% | 7d | yes | routing outcomes |
| `backup_success` | 99% | 30d | yes | backup verification records |
| `audit_export` | 99% | 30d | yes | export manifest status |
| `security_event_response` | p95 ≤ 60m | 90d | yes | incident detect→contain |
| `upgrade_rollback` | 99% | 180d | **no** | XR does not phone home |

**No samples ⇒ `unmeasurable`, never `meeting`.** An SLO outside the active profile reports `not_applicable`.

---

## 8. Incident response

```
  detected ──┬──► triaged ──┬──► contained ──┬──► remediating ──► resolved ──► postmortem
             │              │                │                        ▲
             ├──────────────┴──► quarantined─┴────────────────────────┘
             │
             └──────────────────────────────────────────────► resolved
```

Fast paths exist so an operator can **contain first and triage afterwards**.

- Evidence is hash-committed at capture and verifiable later.
- Response actions run through injected handlers that bridge to the real subsystems (capability quarantine, delegation revocation, worker disable, backup restore).
- Incidents of kind `tenant_data_leakage`, `credential_exposure`, `isolation_failure`, or `audit_failure` — or of `critical`/`high` severity — **always** set `userVisibleImpact`, and that flag cannot be cleared by an administrator.

---

## 9. Supply-chain response

Builds on Phase 9 provenance/signing/certification; adds the response side.

**Critical ordering:** evidence is snapshotted **before** quarantine, so a malicious capability cannot erase its own trail by being disabled.

```
revoke()
  1. snapshot affected capabilities      ← evidence preserved FIRST
  2. record the revocation entry
  3. quarantine via Phase 9 service
  4. create affected-deployment notices
  5. declare an incident (malicious / compromised publisher)
```

Revocation scopes: `capability`, `capability_version` (semver ranges like `>=1.2.0 <1.4.1`), and `publisher` (all of their capabilities at once).

Organization catalogs (`allowlist` / `denylist` / `open`) with `requireSigned` and `requireCertified` are evaluated **after** revocation, so a permissive catalog can never resurrect a revoked capability.

---

## 10. Backup and disaster recovery

```
restore(plan)
  └─► preflight()
        ├─ verify()          integrity digest recomputed
        ├─ credential scan   backups must reference secrets, never embed them
        ├─ version check     major versions must match
        ├─ profile check     multi-user backup ⇏ single-user profile
        └─ component check   requested components exist
              │
              ├── blockers?  ──► RESTORE REFUSED, nothing applied
              └── clean      ──► apply components, report per-component outcome
```

This preflight gate is the control against **restore poisoning**. Partial restores report component-level results plus consistency warnings when related components (execution+checkpoints, workflow+execution, audit+policy) diverge.

RPO/RTO are **measured**, and report `undefined` rather than guessing when no backup or drill exists. `drill()` records a dry-run or applied restore as the evidence that backups are actually tested.

---

## 11. Release, support, and rollback

Channels: `stable` (180d active / 365d security), `lts` (545/730), `beta` (60), `edge` (30).

Compatibility checks cover major-version changes, the minimum-upgrade floor, and deltas in plugin API, capsule, backup, policy, and audit-export schema versions.

**Rollback validation** enforces the roadmap §15 invariants — a rollback is blocked unless it preserves all six:

1. local operation
2. policy safety
3. audit integrity
4. backups
5. incident evidence
6. capability revocation

Administrative features may be disabled by a rollback. Safety controls may not be bypassed by one.

---

## 12. Deployment governance matrix

| Control | personal_local | private_local_server | team_private | managed_cloud | hybrid |
|---|---|---|---|---|---|
| Organization administration | not applicable | optional | ✅ | ✅ | ✅ |
| Delegated authority | ✅ (local) | ✅ | ✅ | ✅ | ✅ |
| Audit chain | ✅ always | ✅ | ✅ | ✅ | ✅ |
| Audit export | local file | local file | org-scoped | org-scoped | org-scoped |
| Retention / legal hold | user | admin | admin | admin | admin |
| SLO reporting | local | local | org | org | org |
| Incidents | ✅ | ✅ | ✅ | ✅ | ✅ |
| Supply-chain revocation | ✅ | ✅ | ✅ | ✅ | ✅ |
| Backup / DR | local | local/remote | remote | managed | both |
| **Control plane required** | **never** | no | no | yes | no |

`createEnterpriseServices()` performs no network I/O, opens no database, and requires no control plane. Verified by `test/enterprise/governance-matrix.test.ts`.

---

## 13. Module map

```
src/enterprise/
├── types.ts                      single source of truth for all contracts
├── index.ts                      barrel + createEnterpriseServices()
├── policy/
│   ├── layers.ts                 layers, safety registry, visibility invariants
│   ├── engine.ts                 resolution, traces, rejected overrides
│   └── bundles.ts                versioned, reversible bundles
├── authority/
│   └── delegation.ts             subset enforcement, cascade revocation, review
├── audit/
│   ├── redaction.ts              verifiable redaction + faithfulness proof
│   ├── export.ts                 controlled export + integrity manifest
│   └── retention.ts              schedules, legal hold, conflict reporting
├── operations/
│   ├── slo.ts                    catalog, SLI computation, error budgets
│   └── status.ts                 aggregate operational status + alerts
├── incidents/
│   └── workflow.ts               7-state machine, evidence, response actions
├── supplychain/
│   └── response.ts               revocation, quarantine, catalogs, notices
├── recovery/
│   └── operations.ts             verification, preflight, drills, RPO/RTO
├── release/
│   └── channels.ts               channels, support windows, rollback validation
└── certification/
    └── evidence.ts               control catalog, threat model, honesty guard
```

---

## 14. What is technical, operational, and external

This distinction is mandatory and machine-checked (`assertNoFalseCertificationClaim`).

| Assurance | Meaning | Examples |
|---|---|---|
| **technical** | Enforced by code, proven by a passing test. | policy resolution, subset delegation, redaction integrity, restore refusal |
| **operational** | Depends on the organization following a documented process. | access reviews, drill cadence, support windows, incident exercises |
| **external_required** | Cannot be satisfied by XR alone. | independent assessment, SOC 2, penetration test |

**XR claims no external certification.** All `external_required` controls are `not_implemented` and say so.

---

## 15. Related documents

- `POLICY_AND_AUTHORITY.md` — administrator guide
- `AUDIT_EXPORT.md` — export/redaction/retention API guide
- `INCIDENT_RESPONSE.md` — incident runbook and exercises
- `SUPPLY_CHAIN_RESPONSE.md` — capability incident guide
- `BACKUP_RECOVERY.md` — backup/restore/DR guide
- `SLO_OBSERVABILITY.md` — SLO and operations guide
- `RELEASE_SUPPORT.md` — release channels and compatibility
- `CERTIFICATION_EVIDENCE.md` — evidence pack and its limitations
- `GOVERNANCE.md` — project governance and exception process
