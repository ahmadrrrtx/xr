# XR 6.1 — Release, Compatibility, and Support Policy

**Module:** `src/enterprise/release/channels.ts`

---

## 1. Channels

| Channel | Active support | Security-only | Use for |
|---|---|---|---|
| `stable` | 180 days | +185 days (365 total) | Production |
| `lts` | 545 days | +185 days (730 total) | Slow upgrade cycles |
| `beta` | 60 days | — | Preview; no guarantees |
| `edge` | 30 days | — | Continuous builds; no guarantees |

```bash
xr enterprise release
xr enterprise release --channel lts
```

### Support states

| State | Meaning |
|---|---|
| `supported` | Bug fixes, security fixes, and support |
| `security_only` | Security fixes only — plan an upgrade |
| `end_of_life` | No further fixes |
| `prerelease` | Not covered by a support window |

> Support windows are a **project commitment**, not a contractual SLA. Commercial support is a separate arrangement.

---

## 2. Compatibility surfaces

Each release declares the versions it speaks:

| Surface | Meaning |
|---|---|
| `pluginApiVersion` | Plugin host ABI |
| `capsuleSchemaVersion` | Portable task capsule format |
| `backupSchemaVersion` | Backup manifest and component format |
| `policySchemaVersion` | Policy bundle and rule format |
| `auditExportFormatVersion` | Audit export format |
| `minUpgradeFrom` | Oldest version that may upgrade directly |

```bash
xr enterprise release --json | jq '.[0].compatibility'
```

---

## 3. Upgrade rules

```
1. Major version change            → BREAKING
2. Below minUpgradeFrom            → BREAKING (upgrade via an intermediate release)
3. Schema/API version delta        → migration may be required
4. Patch/minor within a major      → compatible
```

```ts
const check = services.releases.checkCompatibility("6.0.0", "6.1.0");
check.ok;                 // true
check.migrationRequired;  // whether migrations will run
check.breaking;           // blocking changes
check.warnings;           // schema deltas
```

### XR 6.0 → 6.1

| Surface | 6.0 | 6.1 | Impact |
|---|---|---|---|
| Plugin API | 3 | 3 | none |
| Capsule schema | `xr-6.0.0/capsule-v1` | unchanged | none |
| Backup schema | `xr-6.0.0/capsule-v1` | unchanged | none |
| Policy schema | — | `xr-6.1.0/enterprise-v1` | **new** (additive) |
| Audit export format | — | `xr-6.1.0/audit-export-v1` | **new** (additive) |
| `minUpgradeFrom` | — | `6.0.0` | direct upgrade from 6.0.x |

**6.1 is additive.** No existing data is migrated or rewritten. Deployments that never touch enterprise features behave exactly as they did on 6.0.

---

## 4. Rollback

Rollback is supported **within the same major version**, to a target that is not end-of-life.

```bash
xr enterprise release rollback-check --from 6.1.0 --to 6.0.0
```

### The six invariants

A rollback is **blocked** unless all six survive it:

| # | Invariant | Why |
|---|---|---|
| 1 | Local operation | The deployment must still run without a control plane |
| 2 | Policy safety | Safety-relevant policy must still resolve and enforce |
| 3 | Audit integrity | The hash chain must still verify |
| 4 | Backups | Existing backups must remain readable |
| 5 | Incident evidence | Evidence must remain present and hash-consistent |
| 6 | Capability revocation | Revocations must still be enforced |

```ts
const validation = validateRollback({
  fromVersion: "6.1.0",
  toVersion: "6.0.0",
  compatibility: services.releases.checkCompatibility("6.1.0", "6.0.0"),
  probe: {
    localOperationAvailable: true,
    policySafetyIntact: true,
    auditChainVerifies: store.verifyChain().valid,
    backupsReadable: true,
    incidentEvidenceIntact: services.incidents.verifyEvidence(id).ok,
    revocationsEnforced: true,
  },
});
```

> **Administrative features may be disabled by a rollback. Safety controls may not be bypassed by one.**
>
> Rolling 6.1 → 6.0 removes the enterprise admin surface. It must not re-enable a revoked capability or break the audit chain.

### What a 6.1 → 6.0 rollback actually loses

| Preserved | Lost |
|---|---|
| Audit log and chain | Enterprise CLI surface |
| Backups | Policy bundle administration |
| All Phase 1–11 behavior | Delegation registry (in-memory) |
| Capability quarantine (Phase 9) | SLO samples (in-memory) |
| Task-level least privilege | Incident records (in-memory) |

Persist incident and delegation records externally before rolling back if you need them.

---

## 5. Artifact integrity

```ts
services.releases.recordArtifact({
  version: "6.1.0",
  artifactName: "xr-6.1.0.tgz",
  sha256: "…",
  sizeBytes: 2_481_204,
  builtAt: Date.now(),
  reproducible: true,
  sbomPresent: true,
  sbomRef: "sbom/xr-6.1.0.spdx.json",
  dependencyCount: 4,
});

services.releases.verifyArtifact("6.1.0", "xr-6.1.0.tgz", downloadedBytes);
```

> **Control RM-04 is `partial`.** Digest recording and verification are implemented. Reproducible builds and SBOM generation are release-pipeline responsibilities and are *declared*, not *proven*, by this control.

XR has a deliberately small dependency surface (`zod` at runtime; `typescript`, `@types/bun`, `playwright` in dev), which keeps supply-chain exposure low.

---

## 6. Release checklist

**Gates — all must pass:**

```bash
bun install
bun run typecheck            # 0 errors
bun test                     # 0 failures
bun run set-version:check    # version consistency
bun run baseline:inventory
```

**Phase 12 additions:**

```bash
bun test test/enterprise/                    # all enterprise suites
xr enterprise evidence                       # honesty guard must pass
xr enterprise release rollback-check --from <new> --to <prev>
```

**Blocking defects** — no release with an unresolved critical issue in: tenancy, authority, audit, backup, incident handling, supply chain, migration, or restore.

**Certification claims** are published only with evidence from a completed external assessment.

---

## 7. Deprecation

1. **Announce** in the release notes, with a rationale and a migration path.
2. **Warn** at runtime for at least one minor release.
3. **Remove** no earlier than the next major version.

Breaking changes to `policySchemaVersion` or `auditExportFormatVersion` require a migration path for existing bundles and exports.

---

## 8. Related

- `MIGRATION.md` — cross-version migration guides
- `GOVERNANCE.md` — release approval and exceptions
- `ENTERPRISE_TRUST_ARCHITECTURE.md` §11
- Controls RM-01 … RM-04 in `CERTIFICATION_EVIDENCE.md`
