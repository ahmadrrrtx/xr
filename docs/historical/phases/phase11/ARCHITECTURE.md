# XR 6.0 — Phase 11: Local, Cloud, and Hybrid Operating Plane

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Architecture Design

### Mission

Make the same XR task, authority, workflow, context, capability, artifact, audit, and outcome semantics portable across all deployment modes — personal laptop, local server, private server, private worker host, managed cloud, and hybrid environments.

### Central Rule

> Cloud and remote execution extend XR's operating plane; they do not create a second XR semantics.

---

## 1. Deployment Profiles

XR 6.0 defines five canonical deployment profiles:

| Profile | Identity Model | Offline | Remote Workers | Control Plane |
|---------|---------------|---------|----------------|---------------|
| **Personal Local** | Single-user local | ✅ Full | ❌ | ❌ |
| **Private Local Server** | Private token | ✅ Full | ❌ | ❌ |
| **Team Private** | Organization RBAC | ✅ Full | ✅ | ✅ |
| **Managed Cloud** | Managed auth | ❌ | ✅ | ✅ |
| **Hybrid** | Organization RBAC | ✅ Full | ✅ | ✅ |

Each profile declares capabilities, limitations, data paths, identity model, and recovery semantics.

### Profile Selection

Profiles are selected based on environment:
- No network → `personal_local`
- Organization + remote workers + cloud config → `hybrid`
- Organization + cloud → `managed_cloud`
- Organization + workers → `team_private`
- Default → `personal_local`

---

## 2. Control Plane / Data Plane Separation

```
┌────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                           │
│  Identity  │  Placement Decisions  │  Policy  │  Status    │
│            │  (metadata only)      │          │            │
├────────────────────────────────────────────────────────────┤
│                    DATA PLANE                              │
│  Execution Backends  │  Model Calls  │  Sensitive Data     │
│  (local/remote)      │  Tool Runs    │  Context/Artifacts  │
├────────────────────────────────────────────────────────────┤
│                    LOCAL PLANE                             │
│  Offline Operation  │  Cached State  │  Checkpoints        │
│  Queue Permitted Work  │  Audit Trail                     │
└────────────────────────────────────────────────────────────┘
```

The control plane:
- Makes scheduling and placement decisions
- Manages identity and policy
- Aggregates status
- Does NOT automatically receive sensitive payloads

The data plane:
- Executes actual work (model calls, tools, etc.)
- Handles sensitive data
- Runs in local, container, or remote environments

The local plane:
- Operates when disconnected
- Preserves checkpoints and audit
- Queues work for later sync

---

## 3. Portable Task Capsules

Task capsules are the portable, versioned, integrity-checked unit of work transfer.

```
TaskCapsule {
  schemaVersion    — "xr-6.0.0/capsule-v1"
  capsuleId        — Unique identifier
  executionId      — Execution fabric identity (carried, not replaced)
  actor            — Who initiated the work
  intent           — Goal/constraints (safe, no secrets)
  authority        — Policy version, risk tier, approval ref
  placement        — Requirements, preferences, exclusions
  context          — References (not raw data), consent scope
  requirements     — Capabilities, providers, modalities, hardware
  limits           — Cost, duration, retries
  recovery         — Checkpoint ref, resumability
  artifacts        — References with transfer policy
  provenance       — Origin, transfer chain, audit trail ref
  residency        — Allowed/forbidden regions, classification
  integrityHash    — SHA-256 of canonical payload
  signature?       — Optional signed verification
}
```

### Capsule Rules

1. **NEVER** embed raw secrets
2. Bounded in size (validated on build)
3. Integrity-hashed (SHA-256 of canonical JSON)
4. Optionally signed
5. Transfer chain tracked in provenance
6. Residency constraints enforced
7. Schema versioned for compatibility

---

## 4. Worker Lifecycle

```
Registering → Attesting → Active ↔ Draining → Drained
                              ↓                   ↓
                         Quarantined          Revoked
```

### Worker Operations

- **Register**: Submit identity, endpoint, capabilities, attestation
- **Attest**: Verify identity (self-signed, CA, TPM, hardware token)
- **Admit**: Move to active state
- **Heartbeat**: Regular health/liveness reporting
- **Drain**: Stop accepting new tasks
- **Revoke**: Permanently deny access
- **Quarantine**: Isolate suspicious worker

### Security Rules

- Workers must authenticate with verified attestation
- Instance ID must match on heartbeat
- Revoked workers cannot re-register with same identity
- Quarantined workers require manual investigation
- Stale workers (no heartbeat within timeout) auto-marked offline

---

## 5. Placement Policy

Placement decisions are explainable and manually overrideable.

### Factors (weighted)

| Factor | Weight | Description |
|--------|--------|-------------|
| Residency compliance | 1.0 | Hard gate — must comply |
| Data classification | 0.9 | Sensitivity matters |
| Capability match | 0.8 | Worker must have capabilities |
| Health status | 0.7 | Worker must be healthy |
| User preference | 0.6 | Overrides matter |
| Availability | 0.5 | Capacity check |
| Latency preference | 0.5 | Prefer lower latency |
| Cost preference | 0.4 | Prefer lower cost |
| Hardware match | 0.3 | GPU, memory, etc. |

### Decision Flow

1. Check hard gates (residency, user force-local)
2. Score local placement
3. Score each available remote worker
4. Apply user overrides
5. Select best option (prefer local within 10% tolerance)
6. Return explainable decision with factors

---

## 6. Data Residency and Retention

### Classification Levels

| Level | Transfer | Residency |
|-------|----------|-----------|
| Public | Anywhere | Any region |
| Internal | Allowed | Any region |
| Confidential | Restricted | Region-pinned |
| Restricted | Not allowed | Origin only |

### Retention Policy

| Entity | Retention | Archive | Auto-delete |
|--------|-----------|---------|-------------|
| Execution records | 90 days | 30 days | ✅ |
| Audit records | 365 days | 90 days | ❌ (never) |
| Artifacts | 180 days | 60 days | ✅ |
| Context data | 365 days | 90 days | ✅ |
| Checkpoints | 7 days | — | ✅ |

---

## 7. Synchronization

### Sync Modes

- **local_to_remote**: Push local changes
- **remote_to_local**: Pull remote changes
- **bidirectional**: Both directions with conflict detection
- **local_only**: No sync (offline/personal)

### Conflict Resolution

| Strategy | Description |
|----------|-------------|
| local_wins | Local version prevails |
| remote_wins | Remote version prevails |
| manual | Requires human intervention |
| merge_safe_fields | Non-conflicting fields merged |
| authoritative_source | Source of truth by entity type |

**Security entities (policy, worker state) NEVER use last-write-wins.**

---

## 8. Offline Mode

When disconnected:
- ✅ Run eligible local tasks
- ✅ Inspect local state
- ✅ Preserve checkpoints and audit
- ✅ Queue permitted work
- ❌ Remote work is clearly marked unavailable
- ✅ Resynchronize safely when reconnected

---

## 9. Failure Model

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Network partition | Heartbeat timeout | Queue locally, sync on reconnect |
| Worker crash | Missing heartbeat | Mark offline, reassign tasks |
| Control plane outage | Connection failure | Continue local, defer remote |
| Duplicate delivery | Idempotency key check | Reject duplicates |
| Credential expiry | Grant TTL check | Block execution, request renewal |
| Partial artifact transfer | Hash verification | Retry or fail |

**Never duplicate unsafe external side effects because a network response was lost.**

---

## 10. File Structure

```
src/deployment/
  types.ts                    — Core deployment types
  profiles.ts                 — Profile definitions
  capsule.ts                  — Task capsule build/serialize/verify
  placement/
    engine.ts                 — Placement decision engine
  workers/
    registry.ts               — Worker registration/lifecycle
  control-plane/
    service.ts                — Control plane orchestration
  sync/
    engine.ts                 — Synchronization engine
  offline/
    service.ts                — Offline continuity
  residency/
    policy.ts                 — Residency/retention enforcement
  identity/
    service.ts                — Remote identity management
  backup/
    service.ts                — Backup/restore/export
  index.ts                    — Public exports
```

---

## 11. Security Requirements

All tested and enforced:

- ✅ Worker identity and revocation
- ✅ Tenant/workspace isolation
- ✅ Control-plane/data-plane separation
- ✅ Residency policy enforcement
- ✅ Secret non-transfer (capsules never embed secrets)
- ✅ Capsule tampering detection (integrity hash)
- ✅ Replay/duplicate task delivery prevention
- ✅ Authorization downgrade prevention
- ✅ Network partition handling
- ✅ Remote approval integrity
- ✅ Worker cleanup/drain
- ✅ Local offline security preserved

---

## 12. Backward Compatibility

XR 6.0 is additive. All Phase 1–10 contracts are preserved:

- Execution fabric (Phase 2) — Placement extended with remote kinds
- Trust/Isolation (Phase 3) — Authority and risk tiers preserved
- Durable agency (Phase 4) — Checkpoints/leases/recovery preserved
- Intelligence plane (Phase 5) — Routing preserved, locality-aware
- Knowledge/context (Phase 6) — Provenance preserved across transfers
- Workflow OS (Phase 7) — Workflow portability
- Capability ecosystem (Phase 9) — Capability metadata preserved
- Business operating layer (Phase 10) — Outcome/authority preserved

Local-only operation remains complete. No cloud dependency is introduced.

---

**PHASE 11 COMPLETE — XR 6.0 LOCAL CLOUD HYBRID OPERATING PLANE RELEASE READY**
