# XR 6.1 — Audit Export, Redaction, and Retention Guide

**Modules:** `src/enterprise/audit/`
**Builds on:** the Phase 1+ hash-chained audit log in `src/state/workspace-store.ts`

---

## 1. The problem this solves

Redaction normally destroys tamper-evidence. Strip a field from an audit record and its hash no longer matches, so the chain breaks and the record becomes unverifiable — exactly when you most need to prove it wasn't altered.

XR solves this with **digest-committed redaction**.

```
Original record                        Exported (redacted) record
─────────────────                      ──────────────────────────
detail: { token: "sk-live-xyz",        detail: { token: "sha256:d3d920a7…",
          note:  "deploy prod" }                 note:  "deploy prod" }
prevHash: abc…                         prevHash: abc…       ← UNCHANGED
hash:     def…                         hash:     def…       ← UNCHANGED
                                       redactedFields: [{
                                         path: "token",
                                         mode: "hash",
                                         originalDigest: "d3d920a7…",
                                         reason: "Credential material…"
                                       }]
```

**Result:**
- Chain verification still works — hashes are untouched.
- An auditor **with** source access can prove the redaction was faithful.
- An auditor **without** source access can still verify the chain.
- The redaction itself is recorded — nothing is silently removed.

---

## 2. Audit event classes

Every record is classified, which drives retention and export filtering.

| Class | Contents | Default sensitivity | Default retention |
|---|---|---|---|
| `security` | shield blocks, threat detections | confidential | 730d |
| `incident` | incident lifecycle | confidential | 730d |
| `authority` | grants, delegations, revocations | internal | 365d |
| `policy` | bundle changes, override attempts | internal | 365d |
| `administration` | admin/config actions | internal | 365d |
| `supply_chain` | capability revoke/quarantine | internal | 365d |
| `data_access` | reads, exports | confidential | 180d |
| `recovery` | backup/restore | internal | 180d |
| `execution` | task runs | internal | 90d |
| `system` | everything else | internal | 90d |

---

## 3. Exporting

### CLI

```bash
xr enterprise audit export --out audit.jsonl
xr enterprise audit export --format csv --out audit.csv
xr enterprise audit export --classes security,incident --out security.jsonl
xr enterprise audit export --org acme --workspace eng --out eng.jsonl
xr enterprise audit export --json                      # manifest only
```

### Reading the manifest

```
Audit export
  export id:    exp_d8b115d9b7a34c3d
  status:       complete
  records:      1284
  redacted:     37 field(s)
  chain:        verified
  content hash: ecca35f67bafa17c…
```

| Field | Meaning |
|---|---|
| `status` | `complete` · `partial` · `denied` · `failed` |
| `chainVerified` | Whether the exported set forms an unbroken chain |
| `contentHash` | SHA-256 over the serialized payload |
| `withheldCount` | Restricted records excluded by access control |
| `incompleteReason` | **Always populated** when status is not `complete` |

### Truncation and withholding are never silent

```
status:  partial
note:    Result truncated at 1000 records (4820 matched).
         312 restricted record(s) withheld — includeRestricted was not authorized.
```

If XR cannot give you everything you asked for, it says so in the manifest. There is no path that quietly returns a short export.

### Programmatic

```ts
const result = services.auditExport.export({
  requestedBy: "member_alice",
  organizationId: "acme",
  fromAt: Date.now() - 30 * 86_400_000,
  eventClasses: ["security", "authority"],
  format: "jsonl",
  redactionRules: [
    { ruleId: "pii.email", path: "user.email", mode: "mask", reason: "GDPR minimization" },
    { ruleId: "pii.ip",    path: "client.ip",  mode: "hash", reason: "Pseudonymize" },
  ],
  reason: "Q3 access review",
});

writeFileSync("audit.jsonl", result.serialized);
writeFileSync("manifest.json", JSON.stringify(result.manifest, null, 2));
```

---

## 4. Redaction

### Modes

| Mode | Effect | Use when |
|---|---|---|
| `remove` | Field deleted | The value must not leave, in any form |
| `mask` | `al****ce` — shape kept | Support needs to see the shape |
| `hash` | `sha256:d3d920a7…` | You need to correlate without revealing |

### Always-on defaults

These apply to every export unless explicitly skipped:

`token`, `secret`, `password`, `apiKey`, `authorization`, `credential`, `privateKey`

### Custom rules

```ts
const rules: RedactionRule[] = [
  { ruleId: "pii.ssn",   path: "customer.ssn",  mode: "remove", reason: "PII" },
  { ruleId: "pii.email", path: "customer.email", mode: "mask",  reason: "GDPR" },
  { ruleId: "all.detail", path: "*", mode: "remove", reason: "Metadata-only export",
    appliesAtOrAbove: "confidential" },
];
```

- `path` supports dot notation: `user.profile.email`
- `path: "*"` redacts every top-level field
- `appliesAtOrAbove` limits a rule to records at/above a sensitivity

### Verifying a redaction was faithful

```ts
const proof = proveRedactionFaithful(originalRecords, exportedRecords);
// { ok: true, checked: 37, mismatches: [] }
```

This catches three distinct attacks:
1. A digest that doesn't match the original value.
2. A record whose `originalHash` doesn't match the source.
3. A record that **claims** a field was redacted while still carrying the value.

```ts
const leaks = detectRedactionBypass(exportedRecords);
// scans for API-key, JWT, and private-key patterns that survived redaction
```

---

## 5. Verifying an export

```bash
xr enterprise audit verify        # verify the live chain
```

```ts
const verification = services.auditExport.verify(result);
// { ok, contentHashMatches, chainIntact, recordCountMatches, errors, verifiedAt }
```

Verification re-runs chain checking **independently** of what the manifest claims, so a forged manifest cannot vouch for itself.

---

## 6. Access control and access logging

Exports are authorized through a pluggable authorizer that should delegate to your existing RBAC — XR does not invent new roles.

```ts
const authorizer: AuditExportAuthorizer = {
  canExport: ({ actorId, organizationId, includeRestricted }) => {
    if (!rbac.can(actorId, "audit:export", organizationId)) {
      return { granted: false, reason: "Requires the audit:export permission." };
    }
    if (includeRestricted && !rbac.can(actorId, "audit:export:restricted", organizationId)) {
      return { granted: false, reason: "Restricted export requires audit:export:restricted." };
    }
    return { granted: true };
  },
};
```

Every attempt — granted or denied — is logged:

```bash
xr enterprise audit access
```

```
2026-07-28T09:14:02.000Z  granted  export   member_alice (1284 records)
2026-07-28T09:12:44.000Z  denied   export   member_bob (0 records)
    Requires the audit:export permission.
```

**Denial never throws.** It returns a `denied` manifest, so calling code handles it as data.

---

## 7. Retention and legal hold

### Schedules

```ts
services.retention.setSchedule(defaultRetentionSchedule({ createdBy: "admin", organizationId: "acme" }));
```

Each rule specifies `retainDays`, optional `archiveAfterDays`, and `deleteOnExpiry`.

### Running retention

```bash
xr enterprise audit retention           # dry run (default)
xr enterprise audit retention --apply   # actually delete
```

```
Retention run (dry run)
  evaluated:    12840
  retained:     11203
  archived:     1502
  deleted:      0
  hold-blocked: 135
```

**Dry run is the default.** XR will not delete audit history unless you explicitly ask.

### Legal hold — the deletion/retention conflict

An active hold **blocks** scheduled deletion and reports it as an explicit conflict.

```bash
xr enterprise audit hold place --reason "Litigation Acme v. Doe (case 2026-114)"
xr enterprise audit hold list
xr enterprise audit hold release hold_abc123
```

```
Legal-hold conflicts (135)
  wsa_4021 — Retention expired at 90d but legal hold 'hold_abc123'
             blocks deletion: Litigation Acme v. Doe (case 2026-114)
```

This is the important behavior: the conflict is **reported**, not silently resolved in either direction. Holds can be scoped by organization, workspace, event class, and time range.

---

## 8. Wiring your own audit source

```ts
import { createEnterpriseServices, adaptWorkspaceAuditRows } from "@rrrtx/xr/enterprise";

const services = createEnterpriseServices({
  profile: "team_private",
  currentVersion: "6.1.0",
  audit: (event, detail) => store.audit(event, detail),
  auditSource: () => adaptWorkspaceAuditRows(
    store.auditChainRange({ limit: 10_000 }),   // ascending order, includes prev_hash
    { organizationId: "acme" },
  ),
  exportAuthorizer: authorizer,
});
```

> **Important:** use `auditChainRange()`, not `recentAudit()`. The latter omits `prev_hash` and returns newest-first, which makes a legitimate export look like a chain break.

---

## 9. Limitations — stated plainly

| Limitation | Detail |
|---|---|
| Hash chains detect, they do not prevent | An operator with filesystem access can delete the store. Off-host replication is an **operational** control. |
| Digests reveal equality | Two identical redacted values produce the same digest. Low-entropy fields (e.g. a boolean) remain guessable. |
| Integrity is not a signature | Export integrity uses SHA-256, not an HSM/KMS signature. External anchoring is deferred to a later phase. |
| Deletion is delegated | XR evaluates retention and reports; the actual delete runs through a handler your deployment owns. |
| Bypass detection is pattern-based | `detectRedactionBypass` covers common secret formats, not every possible secret. |

---

## 10. Related

- `ENTERPRISE_TRUST_ARCHITECTURE.md` — how audit fits the overall trust model
- `POLICY_AND_AUTHORITY.md` — who may export
- `INCIDENT_RESPONSE.md` — preserving audit ranges as incident evidence
- `CERTIFICATION_EVIDENCE.md` — controls AU-01 through AU-05
