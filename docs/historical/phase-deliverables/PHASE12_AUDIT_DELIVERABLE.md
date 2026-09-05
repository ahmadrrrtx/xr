# Phase 12 Audit Deliverable — XR 6.1 Enterprise Trust and Operations

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../README.md); for what changed since, see [`docs/HISTORY.md`](../../HISTORY.md).


**Baseline:** XR 6.0.0 (`main` @ `806cbc1`, Phase 11 merged via PR #27)
**Audit date:** 2026-07-28
**Branch:** `feature/phase-12-enterprise-trust-and-operations`

---

## 0. Prerequisite Verification (Roadmap §3)

| Gate | Command | Result |
|---|---|---|
| Version | `package.json` / `src/core/version.ts` | `6.0.0` "Hybrid" — consistent, single source of truth |
| Branch/commit | `git log -1` | `806cbc1` Merge PR #27 phase-11-local-cloud-hybrid-operating-plane |
| Install | `bun install` | 8 packages, clean |
| Typecheck | `bun run typecheck` (`tsc --noEmit`) | **PASS** — 0 errors |
| Full tests | `bun test` | **PASS** — 1256 pass / 0 fail / 4687 assertions / 102 files / 10.37s |
| Deployment tests | `test/deployment/*` (6 files) | PASS (profiles, capsule, placement, workers, sync/offline/residency, security-identity-backup) |
| Tenancy/identity/sync/recovery | `test/deployment/security-identity-backup.test.ts` | PASS |
| Prior security validation | `test/security/`, `test/trust/`, `security.test.ts`, `trust.test.ts` | PASS |

**Verdict: Phase 11 is released and green. Phase 12 may proceed.**

---

## 1. Enterprise Trust Boundary Map

XR's existing trust boundaries, from outermost (least trusted input) to innermost (enforcement):

| # | Boundary | Enforcing code (existing) | Phase 12 obligation |
|---|---|---|---|
| B1 | Untrusted content → agent | `src/security/shield.ts`, `guard.ts`, `attacks.ts` | Must not be weakened by org policy |
| B2 | Agent intent → risk classification | `src/trust/classify.ts` (`RiskTier`) | Org policy may only **raise** tier |
| B3 | Classification → placement/isolation | `src/trust/policy.ts`, `environment/*` (in-process → restricted → namespace → container) | Org policy may only **tighten** placement |
| B4 | Authority grant issuance | `src/trust/authority.ts` (`AuthorityGrant`, `createGrant`, `validateGrant`) | Delegated authority must be a **subset** |
| B5 | Credential resolution | `src/trust/credentials.ts` (`CredentialBroker`, `CredentialRef` — refs never secrets) | Backup/export must never carry raw secrets |
| B6 | Capability provenance/signing | `src/capabilities/certification.ts`, `types.ts` (`CapabilityProvenance`, `signatureStatus`, `CapabilityTrustSignals`) | Add org-level revoke/quarantine response |
| B7 | Tenant/workspace isolation | `src/deployment/types.ts` (`TenantBoundary`, `OrganizationIdentity`), `src/business/core/rbac.ts` | Admin queries must be tenant-scoped |
| B8 | Control plane ↔ data plane | `src/deployment/control-plane/service.ts` (control plane never auto-receives payloads) | Enterprise admin must not become mandatory cloud |
| B9 | Audit hash chain | `src/state/workspace-store.ts:794-870` (`audit()`, `verifyChain()`), `src/business/core/audit.ts` (per-org SHA-256 chain) | Add export/redaction that preserves verifiability |
| B10 | Deployment profile capability gate | `src/deployment/profiles.ts` (`isCapabilityAvailable`) | Enterprise features gated by profile, local stays autonomous |

**Gap found:** no boundary exists today between *organization administration* and *user-visible safety*. An org admin has no defined ceiling. **Phase 12 must add B11: the non-overridable user-visibility invariant.**

---

## 2. Organization / Role / Policy Inventory

### Existing
| Asset | Location | Notes |
|---|---|---|
| `Organization`, `OrgSettings`, `Workspace`, `Member` | `src/business/core/types.ts:13-95` | Business OS org model |
| `OrgRole` = owner/admin/manager/member/viewer/guest | `src/business/core/types.ts:13` | 6 roles |
| `Permission`, `PermissionAction`, `PermissionCondition` | `src/business/core/types.ts:96-112` | CRUD+export/share/admin |
| `RBACManager`, `AccessCheckResult` | `src/business/core/rbac.ts:74-80` | Role→permission resolution |
| `AuthorityBoundaryService`, `AccessKind` | `src/business/core/authority-boundaries.ts:15-30` | Includes `approve` |
| `OrganizationManager` | `src/business/core/organization.ts:24` | Org CRUD |
| `OrganizationIdentity`, `TenantBoundary`, `RemoteIdentity` | `src/deployment/types.ts:483-514` | Phase 11 tenancy |
| `IdentityService` (issue/verify/revoke, scopes, TTL) | `src/deployment/identity/service.ts` | Phase 11 — explicitly "does NOT create enterprise admin features" |
| `AuthorityGrant` (task-scoped, revocable, expiring) | `src/trust/types.ts:170-192` | Task-level least privilege |
| `AIWorker`, `WorkerRole`, `WorkerCapability` | `src/business/core/types.ts:590-620` | AI worker identity |
| `ResidencyPolicy`, `RetentionPolicy`, `RetentionRule` | `src/deployment/types.ts:599-620` | `legalHoldCapable` flag exists but unimplemented |

### Gaps
1. **No layered policy model.** Policy is scattered: `src/security/policies.ts`, `src/trust/policy.ts`, `OrgSettings`, `WorkspaceSettings`. No precedence, no conflict resolution, no trace.
2. **No policy bundles.** Nothing versioned/reversible per roadmap rollback requirement.
3. **No delegated authority record.** `AIWorker` has capabilities but no delegation chain, no delegator, no ceiling, no periodic review.
4. **No authority review/attestation.** No access-review artifact.
5. **Two identity systems risk.** `IdentityService` (Phase 11) and business `Member`/RBAC. Roadmap §6.2 forbids a third. **Decision: Phase 12 creates NO new identity store — it references `RemoteIdentity.identityId` and business `Member.id` as opaque subjects.**

---

## 3. Audit / Retention / Export Map

| Asset | Location | State |
|---|---|---|
| Core hash chain | `src/state/workspace-store.ts:794-870` | `audit(event, detail, sessionId)`, `verifyChain()`, `auditCount()`, `recentAudit()` — SHA-256 `prev_hash`→`hash` |
| `AuditRepo` | `src/state/repos/audit-repo.ts` | Thin wrapper |
| Business audit chain | `src/business/core/audit.ts` | Per-`orgId` chain, `changes` before/after, `verify(orgId)` |
| `xr audit` CLI | `src/commands/audit.ts` | Exists |
| Export/report | `src/export/report.ts` | Generic report export, not audit-grade |
| `RetentionPolicy`/`RetentionRule` | `src/deployment/types.ts:606-620` | **Types only — no enforcement engine** |

### Gaps
1. No **audit event classification** (security / policy / authority / data-access / admin / incident).
2. No **export format** with integrity manifest.
3. No **redaction** — `detail` and `changes` are raw JSON and may contain sensitive values.
4. **Redaction breaks naive hash verification** → must design a verifiable-redaction scheme (commit to original hashes; redacted fields carry per-field digests so the chain still verifies).
5. No **retention scheduler**, no **legal hold**, no **deletion-vs-retention conflict** handling.
6. No **export access control** or **export access log**.
7. No **export failure behavior** (partial export must be marked incomplete, not silently truncated).

---

## 4. SLO / Health / Incident Gap Analysis

| Signal | Exists | Location | Gap |
|---|---|---|---|
| Deployment status | Yes | `DeploymentStatus`, `DeploymentHealthSummary`, `DeploymentIssue` (`types.ts:678-750`) | No SLO objectives/error budget |
| Worker health | Yes | `WorkerHealthReport`, `WorkerHeartbeat`, `WorkerStatusSummary` | Not aggregated into availability SLI |
| Sync status | Yes | `SyncStatusSummary` | Not an SLI |
| Offline status | Yes | `OfflineStatusSummary` | — |
| Backup status | Partial | `BackupService` in-memory manifests | No success-rate SLI, no verification record |
| Reliability | Partial | `src/reliability/*` (grammar, repair, profiles) | Model-output reliability, not operational SLO |
| Incidents | **No** | — | No incident record, state machine, or workflow anywhere |
| Security events | Partial | Shield/attacks detection | No security-event lifecycle or response status |
| Approval delivery | Partial | `src/business/core/approval-escalation.ts` | No latency SLI |

**Conclusion:** XR has rich *health telemetry* and zero *objectives*. Phase 12 adds SLO definitions + SLI computation **only where a measurable source already exists** (roadmap §6.4: "Do not promise SLOs that cannot be measured"). Each SLO must declare its source and be marked `unmeasurable` when the source is absent.

---

## 5. Backup / Disaster Recovery Analysis

| Asset | Location | State |
|---|---|---|
| `BackupService` | `src/deployment/backup/service.ts` | `backup()`, `restore()`, `export()`; in-memory `Map` of manifests |
| `BackupManifest` | `:19-29` | `integrityHash`, `encrypted`, `components[]` |
| `BackupComponentKind` | `:39-48` | 9 kinds incl. `audit_records`, `policy_records` |
| `RecoveryConfig` | `deployment/types.ts:97` | `rpoMinutes`/`rtoMinutes` declared per profile |
| `RestoreResult` | `:58-65` | Has `warnings[]` |

### Gaps
1. No **restore verification** (integrity re-check before apply) → **restore-poisoning risk** (explicitly in roadmap §9 adversarial list).
2. No **backup verification record** / test-restore drill artifact.
3. No **RPO/RTO measurement** against declared targets.
4. No **partial restore** semantics (which components succeeded, what is inconsistent).
5. No **cross-deployment restore** compatibility check (profile/version/schema).
6. No **backup credential protection** statement — must assert secrets are excluded, not encrypted-and-included.

---

## 6. Supply-Chain Response Map

| Asset | Location | State |
|---|---|---|
| Provenance/signing | `src/capabilities/types.ts:72-100` (`CapabilityPublisherIdentity`, `CapabilityProvenance`, `CapabilityPackageIntegrity`) | Phase 9 complete |
| Certification | `src/capabilities/certification.ts` | Contract tests, `CapabilityCertification` |
| Trust signals | `types.ts:226-237` (`vulnerabilityStatus`, `maintenanceStatus`, `evidenceScore`) | Present |
| Quarantine | `src/capabilities/service.ts:274` | Per-capability, local |
| Rollback | `src/capabilities/service.ts:288` | Plugin/skill rollback |
| CLI | `src/commands/capabilities.ts` | `quarantine`, `rollback` already exposed |

### Gaps
1. No **publisher-level revocation** (only per-capability).
2. No **version-range quarantine** (must quarantine `>=1.2.0 <1.4.1`, not just an id).
3. No **install/update blocking** driven by a revocation list.
4. No **affected-deployment notification** record.
5. No **evidence preservation** before quarantine (quarantine currently mutates without snapshotting).
6. No **org capability catalog** (allowlist/denylist as policy).

---

## 7. Release / Support Compatibility Map

| Asset | Location | State |
|---|---|---|
| Version SSOT | `src/core/version.ts` (`PKG`, `CORE_VERSION`, `PLUGIN_API_VERSION`) | Strong |
| Version stamping | `scripts/set-version.ts` (+ `--check` in CI) | Strong |
| CI | `package.json:ci` = typecheck + test + set-version:check + baseline:inventory | Strong |
| Migration | `MIGRATION.md`, `docs/MIGRATION_GUIDE_*`, `src/business/core/migration.ts` | Per-release docs |
| Update/self-heal | `src/update/selfheal.ts` | Exists |
| Install | `install.sh`, `install.ps1`, `Dockerfile` | Exists |
| SECURITY.md | root | Exists — disclosure process present |

### Gaps
1. No **release channels** (stable/lts/beta/edge).
2. No **support window** / EOL declaration per version.
3. No **compatibility matrix** (XR version ↔ plugin API ↔ capsule schema ↔ backup schema).
4. No **rollback validation** gate.
5. No **SBOM / dependency evidence** artifact.

---

## 8. Local / Private / Cloud Governance Matrix

| Control | personal_local | private_local_server | team_private | managed_cloud | hybrid |
|---|---|---|---|---|---|
| Org policy administration | Off (single-user defaults) | Optional | **On** | **On** | **On** |
| Delegated authority | Off | Optional | On | On | On |
| Audit chain | **On (always)** | On | On | On | On |
| Audit export | Local file | Local file | Org-scoped | Org-scoped | Org-scoped |
| Retention/legal hold | User-controlled | Admin | Admin | Admin | Admin |
| SLO reporting | Local only | Local | Org | Org | Org |
| Incidents | Local record | Local | Org | Org | Org |
| Supply-chain revocation list | Local + optional feed | Local + feed | Org catalog | Org catalog | Org catalog |
| Backup/DR | Local | Local/remote | Remote | Managed | Both |
| Control plane required | **Never** | No | No | Yes | No |

**Hard rule carried into implementation:** every enterprise service must construct and operate with **zero network and zero control plane** under `personal_local`. Enforced by test.

---

## 9. File-by-File Proposal

### New — `src/enterprise/` (self-contained subsystem, additive)
| File | Purpose |
|---|---|
| `types.ts` | Single source of truth for all Phase 12 contracts |
| `policy/layers.ts` | 6 policy layers, precedence, non-overridable invariants |
| `policy/engine.ts` | Evaluation, most-restrictive-wins, decision trace, override rejection |
| `policy/bundles.ts` | Versioned, reversible policy bundles |
| `authority/delegation.ts` | Delegated authority, ceiling enforcement, review, revocation |
| `audit/redaction.ts` | Verifiable redaction (per-field digests preserve chain) |
| `audit/export.ts` | Controlled export + integrity manifest + access log + failure reporting |
| `audit/retention.ts` | Retention schedule, legal hold, deletion/retention conflict |
| `operations/slo.ts` | SLO catalog, SLI computation, error budget, `unmeasurable` marking |
| `operations/status.ts` | Aggregate operational status incl. alert-worthy conditions |
| `incidents/workflow.ts` | 7-state incident machine + service + evidence preservation |
| `supplychain/response.ts` | Publisher/version revocation, quarantine, block, notify, restore |
| `recovery/operations.ts` | Backup verification, restore integrity gate, RPO/RTO, partial restore, drills |
| `release/channels.ts` | Channels, support windows, compatibility matrix, rollback validation |
| `certification/evidence.ts` | Evidence pack assembly with explicit limitation/claim separation |
| `index.ts` | Barrel |

### Modified (minimal, additive only)
| File | Change |
|---|---|
| `src/core/version.ts` | `6.0.0` → `6.1.0`, codename `Enterprise` (via `scripts/set-version.ts`) |
| `package.json` | version + description |
| `src/commands/enterprise.ts` | **new** CLI command (policy/authority/audit/slo/incident/supplychain/backup/release/evidence) |
| `src/cli/router.ts` | register `EnterpriseCommand` |
| `src/cli/catalog.ts` | catalog entry, group `trust` |
| `CHANGELOG.md` | 6.1.0 entry |

### Explicitly NOT touched
`src/intelligence/`, `src/providers/`, `src/workflow/`, `src/context/`, `src/memory/`, `src/voice/`, `src/computer/`, `src/research/`, `src/business/modules/` — no new intelligence, workflow, context, browser/voice/vision, or business modules (roadmap §4 "Do not implement").

---

## 10. Phase 13+ Deferrals

Recorded and **not** implemented in 6.1:

1. Public supremacy benchmarks / comparative performance claims (Phase 13).
2. Externally-issued SOC 2 / ISO 27001 / HIPAA attestation — Phase 12 produces *evidence for* assessment only; no certification claim is published.
3. Hosted multi-org control plane SaaS with billing/entitlements.
4. Federated cross-org identity (SAML/SCIM/OIDC IdP integration) — deferred; Phase 12 uses existing `RemoteIdentity`/`Member` subjects.
5. Real-time SIEM streaming/webhook fan-out — Phase 12 provides pull-based export.
6. Automated CVE feed ingestion — Phase 12 provides the revocation-list mechanism and manual/feed-agnostic entry points.
7. Cryptographic signing of audit exports with an external HSM/KMS — Phase 12 uses SHA-256 integrity manifests.
8. Cross-org capability reputation network.

---

## 11. Risk Register Entering Implementation

| Risk | Mitigation in design |
|---|---|
| Compliance theater | Every control is code + test; `EvidencePack` separates `technical` / `operational` / `external_required` and refuses to claim external certification |
| Admin overriding user safety | Non-overridable invariant set; override attempts are **rejected and recorded**, never silently applied |
| Second identity system | Zero new identity storage; subjects are opaque refs to existing ids |
| Redaction breaking audit integrity | Per-field digest commitment scheme; `verifyExport()` proves chain over redacted records |
| Restore poisoning | Integrity gate + component-level verification before apply; refuses unverified restore |
| Local simplicity damage | All enterprise services default to inert under `personal_local`; enforced by test |
| Unmeasurable SLOs | `SloDefinition.measurable` + runtime `unmeasurable` status when source absent |

---

**Audit conclusion: proceed to implementation.**
