# XR 6.1 — Certification Evidence and Its Limitations

**Module:** `src/enterprise/certification/evidence.ts`

---

## 1. Read this first

> **XR is not certified.**
>
> XR has **no** SOC 2 attestation, **no** ISO 27001 certificate, **no** HIPAA validation, **no** PCI-DSS assessment, and **no** FedRAMP authorization.
>
> XR has **not** undergone an independent security assessment or third-party penetration test.

This document describes evidence **prepared for** such an assessment. It is a self-assessment. If you need external assurance, you must engage an assessor — and XR is built to make that engagement productive.

This is not modesty. It is control **T-07** in the threat model: publishing compliance language that implies unearned assurance causes organizations to over-trust the system, which is itself a security failure.

---

## 2. Three kinds of assurance

Every control declares which kind it is. Confusing them is how compliance theater happens.

| Kind | Meaning | Who guarantees it |
|---|---|---|
| **technical** | Enforced by code, proven by a passing test | XR |
| **operational** | Depends on documented process being followed | Your organization |
| **external_required** | Cannot be satisfied by XR alone | An external auditor or assessor |

```bash
xr enterprise evidence
```

```
Controls: 36 total
          32 implemented, 1 partial, 3 not implemented
Assurance: 29 technical, 4 operational, 3 external-required
Externally certified: NO
```

---

## 3. Technical controls (29)

Enforced by code. Each names the file that implements it and the test that proves it.

| ID | Control |
|---|---|
| AC-01 | Layered policy with most-restrictive resolution |
| AC-02 | Non-overridable user-visibility invariants |
| AC-03 | Rejected override attempts are recorded |
| AC-04 | Delegated authority is a strict subset |
| AC-05 | Revocation is immediate and cascades |
| AU-01 | Tamper-evident audit chain |
| AU-02 | Verifiable redaction |
| AU-03 | Controlled audit export with integrity manifest |
| AU-04 | Audit access logging |
| AU-05 | Retention schedules and legal hold |
| OP-01 | Measurable SLOs only |
| OP-02 | Operational status aggregation |
| IR-01 | Incident lifecycle with enforced transitions |
| IR-02 | Immutable incident evidence |
| IR-03 | User-visible incident impact cannot be suppressed |
| SC-01 | Publisher and version-range revocation |
| SC-02 | Evidence preserved before quarantine |
| SC-03 | Install and update blocking |
| SC-04 | Organization capability catalogs |
| SC-05 | Capability provenance and signing |
| DR-01 | Backup integrity verification |
| DR-02 | Restore refused on failed verification |
| DR-03 | Backup credential safety |
| DR-04 | Partial restore consistency reporting |
| RM-02 | Compatibility and migration checks |
| RM-03 | Rollback preserves safety invariants |
| RM-04 | Release artifact integrity *(partial)* |
| TN-01 | Organization and workspace separation |
| TN-02 | Local and private deployment autonomy |

Every source and test path in the catalog is checked to exist by `test/enterprise/certification.test.ts`. A control cannot claim an implementation that isn't there.

---

## 4. Operational controls (4)

XR provides the mechanism and the record. **Your organization must actually do the work.**

| ID | Control | What XR does | What you must do |
|---|---|---|---|
| AC-06 | Periodic access review | Tracks due dates, surfaces the queue, records outcomes | Perform the reviews |
| IR-04 | Incident response exercises | Provides the workflow and records results | Run the exercises |
| DR-05 | Recovery drills with RPO/RTO | Executes and records drills | Schedule them |
| RM-01 | Release channels and support windows | Computes support state | Honor the upgrade cadence |

---

## 5. External-required controls (3) — NOT SATISFIED

| ID | Control | Status |
|---|---|---|
| EX-01 | Independent security assessment | **NOT PERFORMED.** Requires engaging an external assessor. No XR release may claim independent assessment until one is completed and published. |
| EX-02 | SOC 2 Type II attestation | **NOT OBTAINED.** XR makes no SOC 2 claim. |
| EX-03 | Penetration test | **NOT PERFORMED.** XR ships an internal adversarial test suite; that is not a substitute for third-party penetration testing. |

---

## 6. The honesty guard

`assertNoFalseCertificationClaim()` runs in CI and blocks a release that:

1. Claims external certification with no attestation listed.
2. Marks an `external_required` control as `implemented`.
3. Claims a technical implementation with no test evidence.
4. Claims implementation with no source reference.
5. Ships an inadequate disclaimer.
6. Contains an unqualified certification claim anywhere in the pack text.

```bash
xr enterprise evidence   # ends with: ✓ Honesty guard passed
```

The guard is itself tested — including negative cases that prove each violation is caught.

---

## 7. Threat model

| ID | Threat | Residual risk |
|---|---|---|
| T-01 | Malicious administrator hides safety information from users | low |
| T-02 | Privilege escalation via delegation chain | low |
| T-03 | Cross-tenant data access through admin tooling | **medium** |
| T-04 | Audit tampering or redaction bypass | low |
| T-05 | Restore poisoning | low |
| T-06 | Compromised capability publisher | **medium** |
| T-07 | Compliance theater | low |
| T-08 | Enterprise features coerce local users into a hosted control plane | low |

### The two medium risks, stated plainly

**T-03 — cross-tenant access.** XR scopes audit export, policy resolution, and admin queries by organization and workspace, and this is tested. However, storage-level isolation depends on the deployment's `TenantBoundary.isolationLevel`. A deployment using `shared_process` isolation relies on application-level enforcement alone. For strong isolation, use `separate_db` or `separate_instance`.

**T-06 — compromised publisher.** XR can revoke a publisher wholesale, block installs, and preserve evidence. It cannot detect that a validly signed package is malicious *before* the signature is trusted. Signature verification proves origin and integrity, not intent.

Neither risk is formally accepted, so both appear in `unresolvedRisks`.

---

## 8. Generating an evidence pack

```bash
xr enterprise evidence
xr enterprise evidence --json > evidence-pack.json
```

```ts
const pack = buildEvidencePack({ xrVersion: "6.1.0", profile: "team_private" });
pack.contentHash;           // stable, content-sensitive digest
pack.externallyCertified;   // false
assertNoFalseCertificationClaim(pack);  // []
```

### After a real assessment

`externallyCertified` becomes `true` **only** when attestations are supplied out of band, and you must be able to produce the corresponding report on request:

```ts
buildEvidencePack({
  xrVersion: "6.1.0",
  profile: "managed_cloud",
  externalCertifications: ["SOC 2 Type II — Example CPA LLP — report dated 2026-06-01"],
});
```

---

## 9. For assessors

**Where to start**

| Question | Look at |
|---|---|
| What are the trust boundaries? | `ENTERPRISE_TRUST_ARCHITECTURE.md` §3 |
| How is policy enforced? | `src/enterprise/policy/engine.ts` |
| Can an admin hide things from users? | `test/enterprise/security-adversarial.test.ts` › "hidden policy override" |
| Is audit tamper-evident after redaction? | `src/enterprise/audit/redaction.ts` |
| What stops restore poisoning? | `src/enterprise/recovery/operations.ts` › `preflight()` |
| Does the local mode really work offline? | `test/enterprise/governance-matrix.test.ts` |

**Reproducing the evidence**

```bash
bun install
bun run typecheck
bun test                      # full suite
bun test test/enterprise/     # Phase 12 only
xr enterprise evidence
```

**Known gaps to probe:** storage-level tenant isolation under `shared_process`; secret detection heuristics in backups and redaction; the absence of externally-anchored signatures on audit exports; in-memory persistence of delegation, incident, and SLO state.

---

## 10. What this pack is not

- Not an audit report.
- Not an attestation.
- Not a guarantee of regulatory compliance in any jurisdiction.
- Not a substitute for your own risk assessment.
- Not evidence about **your** deployment — it describes XR's controls, not your configuration, your operators, or your network.

---

## 11. Related

- `ENTERPRISE_TRUST_ARCHITECTURE.md` — the design these controls implement
- `GOVERNANCE.md` — how exceptions and disclosures are handled
- `SECURITY.md` — vulnerability disclosure
- `test/enterprise/certification.test.ts` — the guard, and its negative tests
