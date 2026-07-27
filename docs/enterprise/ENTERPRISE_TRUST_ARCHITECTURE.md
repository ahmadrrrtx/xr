# XR 6.1 — Enterprise Trust and Operations

**Version:** XR 6.1.0  
**Phase:** 12  
**Status:** RELEASE READY

## Overview

XR 6.1 converts technical trust into institutional trust. It makes XR governable,
supportable, measurable, certifiable, and globally operable for serious
organizations without weakening local autonomy or user trust.

Enterprise readiness is not an admin dashboard. It requires enforceable policy,
identity and organization boundaries, auditable decisions, data retention/export/
redaction, security assurance, release/support guarantees, incident response,
supply-chain response, backup/disaster recovery, SLOs, operational visibility,
and transparent governance.

## Architecture

### Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL ASSURANCE LAYER                      │
│  (Independent audit, certification, vulnerability disclosure)   │
├─────────────────────────────────────────────────────────────────┤
│                    GOVERNANCE LAYER                              │
│  (Proposals, architecture exceptions, contribution procedures)  │
├─────────────────────────────────────────────────────────────────┤
│                    ENTERPRISE OPERATIONS LAYER                   │
│  (SLOs, incidents, backups, releases, diagnostics, supply-chain)│
├─────────────────────────────────────────────────────────────────┤
│                    POLICY & AUTHORITY LAYER                      │
│  (Organization policy, delegated roles, access reviews)         │
├─────────────────────────────────────────────────────────────────┤
│                    AUDIT & EVIDENCE LAYER                        │
│  (Export, redaction, retention, legal holds, integrity proofs)  │
├─────────────────────────────────────────────────────────────────┤
│                    PHASE 11 FOUNDATION                           │
│  (Deployment profiles, tenancy, identity, sync, capsules)       │
└─────────────────────────────────────────────────────────────────┘
```

### Policy Layers (Precedence: highest to lowest)

| Tier | Priority | Examples |
|---|---|---|
| task_override | 10 | Per-task policy override |
| user | 20 | User-level preferences |
| workspace | 30 | Workspace-scoped rules |
| project | 40 | Project-level constraints |
| organization | 50 | Organization-wide policy |
| deployment | 60 | Deployment profile defaults |
| platform_default | 100 | Immutable platform guardrails |

More privileged policy MUST NOT silently hide user-visible actions, approvals,
or data access. Explicit DENY at any tier always wins.

## Modules

### 1. Organization Policy (`src/enterprise/organization-policy.ts`)

- Pre-built policy bundles: `enterprise_baseline`, `compliance_baseline`, `local_autonomy`
- Policy evaluation with precedence resolution
- Immutable platform defaults that cannot be removed
- Audit-only policy effects that don't block but always record

### 2. Delegated Authority (`src/enterprise/delegated-authority.ts`)

- 13 enterprise roles: org_owner, org_admin, security_admin, compliance_officer,
  workspace_admin, audit_viewer, incident_responder, backup_operator,
  capability_manager, slo_viewer, release_manager, ai_worker, ai_worker_restricted
- Role inheritance chains
- Delegation depth enforcement (max 5 levels)
- Periodic authority review tracking
- MFA requirements per role

### 3. Audit Export (`src/enterprise/audit-export.ts`)

- 4 export formats: json, json_lines, csv, signed_bundle
- 5 redaction strategies: full_mask, partial_mask, hash, remove, tokenize
- 14 event classes with default retention schedules (90d to 7yr)
- Legal hold support with scope/time filtering
- Integrity verification via SHA-256 hashing
- Retention enforcement: keep/archive/delete/anonymize

### 4. SLO Operations (`src/enterprise/slo-operations.ts`)

14 measurable SLOs:

| SLO | Target | Window |
|---|---|---|
| Runtime Availability | ≥99.5% | 7d |
| Task Completion Rate | ≥95% | 24h |
| Task Recovery Rate | ≥90% | 7d |
| Approval Delivery Time | P95≤30s | 24h |
| Worker Health | ≥95% | 24h |
| Provider Routing Availability | ≥99% | 24h |
| Backup Success Rate | ≥99% | 7d |
| Audit Export Availability | ≥99% | 30d |
| Security Detection Time | P95≤5min | 30d |
| Security Response Time | P95≤15min | 30d |
| Upgrade Success Rate | ≥98% | 90d |
| Rollback Success Rate | ≥99% | 90d |
| Sync Latency | P95≤5s | 24h |
| Sync Conflict Rate | ≤1% | 24h |

### 5. Incident Response (`src/enterprise/incident-response.ts`)

- 12 incident classes: capability_abuse, credential_exposure, isolation_failure,
  tenant_leakage, data_leakage, provider_compromise, malicious_package,
  audit_failure, worker_compromise, policy_bypass, supply_chain, network_intrusion
- 7 lifecycle states: detected → triaged → contained → quarantined →
  remediating → resolved → postmortem
- Containment actions: quarantine, revoke credentials, revoke capability,
  block network, isolate workspace, halt deployment, notify admin
- Postmortem reports with root cause, impact, lessons learned, prevention

### 6. Vulnerability Disclosure (`src/enterprise/vulnerability-disclosure.ts`)

- Coordinated disclosure with 90-day embargo default
- Full lifecycle: reported → confirmed → fix_in_progress → fixed → disclosed
- CVSS scoring support
- Security contact and PGP key configuration

### 7. Supply-Chain Response (`src/enterprise/supply-chain-response.ts`)

- Revoke publisher/capability
- Quarantine package/version
- Notify affected deployments
- Block installation/update
- Preserve evidence with hash integrity
- Restore safe version
- Record incidents

### 8. Release Channels (`src/enterprise/release-channels.ts`)

- 5 channels: stable (12mo support), lts (36mo), candidate (3mo), beta, edge
- Compatibility matrix with API version, schema version, profile checks
- Migration validation
- Rollback safety checks
- SBOM references

### 9. Backup/DR (`src/enterprise/backup-dr.ts`)

- Backup schedules with frequency, retention, encryption, verification
- 2 built-in DR plans: default (60min RPO/240min RTO), business_critical (15min/60min)
- Restore verification tracking
- RPO/RTO achievable status checks

### 10. Deployment Diagnostics (`src/enterprise/deployment-diagnostics.ts`)

- 9 diagnostic categories: connectivity, identity, policy, audit_integrity,
  backup, security, performance, compatibility, certification
- Quick health checks for critical failures
- Diagnostic report history

### 11. Security Assessment (`src/enterprise/security-assessment.ts`)

- Evidence preparation for independent security review
- Finding management (open, in_progress, resolved, accepted_risk, wont_fix)
- Certification readiness check
- Explicit disclaimer: does NOT claim external certification

### 12. Governance (`src/enterprise/governance.ts`)

- Proposal lifecycle: draft → open → accepted/rejected → implemented
- Architecture exception tracking with mandatory review dates
- Contribution procedures
- Category-based approval requirements

## Security Guarantees

1. **Organization/workspace/tenant separation** — enforced at policy and identity layers
2. **Admin privilege boundaries** — role-based with delegation depth limits
3. **Delegated AI-worker authority** — scoped subjects, bounded risk tiers
4. **Policy precedence** — task-level least privilege preserved
5. **Audit export access** — controlled with redaction
6. **Redaction/retention** — default schedules, legal hold support
7. **Incident quarantine/revocation** — reversible containment actions
8. **Capability supply-chain response** — quarantine, block, restore
9. **Backup credential protection** — encrypted option, integrity verification
10. **Worker/platform revocation** — identity revocation, drain
11. **Disaster restore integrity** — verification tracking
12. **Release artifact integrity** — SBOM references, compatibility checks
13. **Local/private autonomy** — local_autonomy policy bundle prevents remote override
14. **No silent admin override** — all policy decisions are audited with reasons

## Integration Points

### CLI Commands

```bash
xr enterprise:policy:list          # List all policy rules
xr enterprise:policy:bundles       # List policy bundles
xr enterprise:policy:eval <subj>   # Evaluate a policy subject
xr enterprise:authority:roles      # List enterprise roles
xr enterprise:authority:list       # List delegated authorities
xr enterprise:authority:reviews    # List pending authority reviews
xr enterprise:audit:schedules      # List retention schedules
xr enterprise:audit:holds          # List active legal holds
xr enterprise:slo:list             # List SLO definitions
xr enterprise:slo:status           # Show SLO status
xr enterprise:incidents:active     # List active incidents
xr enterprise:incidents:timeline   # Show incident timeline
xr enterprise:supplychain:status   # Show supply-chain status
xr enterprise:release:channels     # Show release channels
xr enterprise:backup:schedules     # List backup schedules
xr enterprise:backup:dr-plans      # List DR plans
xr enterprise:diagnostics:run      # Show latest diagnostic report
xr enterprise:security:evidence    # Show security assessment evidence
xr enterprise:governance:proposals # List governance proposals
xr enterprise:governance:exceptions # List architecture exceptions
xr enterprise:disclaimer           # Show certification disclaimer
```

### Daemon API Endpoints

```
GET /api/enterprise/health
GET /api/enterprise/policy/rules
GET /api/enterprise/policy/bundles
GET /api/enterprise/authority/roles
GET /api/enterprise/authority/list
GET /api/enterprise/audit/schedules
GET /api/enterprise/audit/holds
GET /api/enterprise/slo/list
GET /api/enterprise/slo/status
GET /api/enterprise/incidents
GET /api/enterprise/incidents/active
GET /api/enterprise/supplychain/status
GET /api/enterprise/releases/channels
GET /api/enterprise/backup/schedules
GET /api/enterprise/backup/dr-plans
GET /api/enterprise/diagnostics/latest
GET /api/enterprise/security/evidence
GET /api/enterprise/governance/proposals
GET /api/enterprise/governance/exceptions
GET /api/enterprise/disclaimer
```

## Certification

XR 6.1 provides security assessment evidence and certification readiness checks.
It does NOT claim SOC 2, HIPAA, ISO 27001, PCI DSS, or any other external
certification. Actual certification requires an independent external assessment
by a qualified auditor.

See `enterprise:disclaimer` CLI command or `/api/enterprise/disclaimer` endpoint.

## Migration from XR 6.0

Enterprise controls are additive. Individual/local deployments retain their
existing operating model. Organization features are introduced through explicit
deployment profiles and policy bundles:

1. **Personal/local deployments** — no change; enterprise features available but not required
2. **Team/private deployments** — apply `enterprise_baseline` policy bundle
3. **Managed cloud/hybrid** — apply both `enterprise_baseline` and `compliance_baseline`

## Rollback

- Policy bundles and rules are versioned and reversible
- Organization controls can be disabled per-deployment
- Local operation remains available if enterprise services are unavailable
- Administrative features may be disabled; safety controls may not be bypassed
