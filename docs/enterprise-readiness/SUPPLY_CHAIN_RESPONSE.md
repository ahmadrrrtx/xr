# XR 6.1 — Capability Supply-Chain Response Guide

**Module:** `src/enterprise/supplychain/response.ts`
**Builds on:** Phase 9 capability provenance, signing, and certification

---

## 1. Prevention vs. response

Phase 9 built **prevention**: publisher identity, package integrity, signature status, certification tests.

Phase 12 builds **response**: what you do at 2am when a trusted capability turns out to be hostile.

---

## 2. The critical ordering

```
revoke()
  1. SNAPSHOT affected capabilities   ← evidence preserved FIRST
  2. record the revocation entry
  3. quarantine via the Phase 9 service
  4. create affected-deployment notices
  5. declare an incident (malicious / compromised publisher)
```

Step 1 comes before step 3 on purpose. Quarantining mutates capability state. If you quarantine first, you may destroy the very evidence you need to understand what happened — and a malicious capability could exploit that ordering to erase its own trail.

This ordering is enforced by test (`SC-02`).

---

## 3. Revocation scopes

| Scope | Blocks | Use when |
|---|---|---|
| `capability` | All versions of one capability | The capability itself is bad |
| `capability_version` | A semver range | A specific range is vulnerable |
| `publisher` | Every capability from a publisher | The publisher is compromised |

### Examples

```bash
# One capability, all versions
xr enterprise supplychain revoke skill:acme-crm \
  --reason malicious --detail "Exfiltrates credentials to an unknown host."

# A vulnerable version range
xr enterprise supplychain revoke skill:acme-crm \
  --range ">=1.2.0 <1.4.1" --reason vulnerable --detail "CVE-2026-1234 — SSRF."

# An entire compromised publisher
xr enterprise supplychain revoke pub_acme \
  --publisher --reason compromised_publisher --detail "Signing key stolen (confirmed)."
```

### Reasons and their severity

| Reason | Notice severity | Recommended action |
|---|---|---|
| `malicious` | critical | Remove now, rotate credentials, review audit trail |
| `compromised_publisher` | critical | Remove all their capabilities, rotate credentials |
| `vulnerable` | error | Update to a fixed version, or disable |
| `policy_violation` | warning | Review policy, remove or request an exception |
| `unverified` | warning | Obtain a signed, certified build |
| `abandoned` | info | Plan migration to a maintained alternative |

`malicious` and `compromised_publisher` automatically declare an incident.

---

## 4. Semver range matching

```ts
satisfiesRange("1.3.0", ">=1.2.0 <1.4.1");  // true
satisfiesRange("1.1.0", ">=1.2.0 <1.4.1");  // false
satisfiesRange("1.4.1", ">=1.2.0 <1.4.1");  // false — upper bound exclusive
satisfiesRange("2.0.0", "*");               // true
```

Comparators: `>=`, `>`, `<=`, `<`, `=`. Space-separated terms are ANDed. Prereleases sort before their release.

---

## 5. Install and update blocking

Every install/update path should consult the revocation list.

```ts
const decision = services.supplyChain.checkInstall(capabilityId, version, publisherId);
if (!decision.allowed) throw new Error(decision.reason);
```

```bash
xr enterprise supplychain check skill:acme-crm --version 1.3.0
```

```
✗ Install BLOCKED: Version 1.3.0 falls in revoked range '>=1.2.0 <1.4.1'
  (vulnerable): CVE-2026-1234 — SSRF.
```

A version-range revocation with **no version supplied** is also blocked — XR will not guess.

---

## 6. Organization capability catalogs

```ts
services.supplyChain.setCatalog({
  catalogId: "cat_prod",
  organizationId: "acme",
  name: "Production-approved",
  mode: "allowlist",                    // allowlist | denylist | open
  entries: [
    { capabilityId: "skill:research", minVersion: "2.0.0" },
    { capabilityId: "plugin:jira",    minVersion: "1.4.0", maxVersion: "1.9.9" },
  ],
  requireSigned: true,
  requireCertified: true,
  version: 1,
  updatedBy: "member_alice",
  updatedAt: Date.now(),
});
```

**Evaluation order — revocation is checked first:**

```
checkCatalog()
  1. active revocation?      → DENY (a catalog can never resurrect a revoked capability)
  2. requireSigned?          → DENY unsigned
  3. requireCertified?       → DENY uncertified
  4. allowlist / denylist    → decide
  5. min/max version bounds  → decide
```

This ordering means a permissive or misconfigured catalog can never override a security revocation.

---

## 7. Affected-deployment notices

Revocation creates notices for every workspace with the capability installed.

```bash
xr enterprise supplychain notices
```

```
critical  skill:acme-crm    Capability 'skill:acme-crm' has been revoked (malicious).
                            Exfiltrates credentials to an unknown host.
          Remove immediately, rotate any credentials the capability could access,
          and review its audit trail.
```

```ts
services.supplyChain.acknowledgeNotice(noticeId, "member_alice");
```

---

## 8. Restoring a safe version

```ts
const r = services.supplyChain.restoreSafeVersion({
  capabilityId: "skill:acme-crm",
  version: "1.1.9",
  actorId: "ops",
  reason: "Last known-good before the compromise.",
});
```

**Restore is refused if the target version is itself revoked** — you cannot accidentally roll back into the vulnerable range.

```
✗ Restore blocked: Version 1.3.0 falls in revoked range '>=1.2.0 <1.4.1'
```

---

## 9. Lifting a revocation

```ts
services.supplyChain.lift(entryId, "security-lead", "Vendor shipped 1.4.1 with a verified fix.");
```

Use a time-boxed revocation when a fix is expected:

```ts
services.supplyChain.revoke({
  scope: "capability_version",
  targetId: "skill:x",
  versionRange: ">=1.2.0 <1.4.1",
  reason: "vulnerable",
  detail: "CVE-2026-1234; vendor fix expected within 14 days.",
  issuedBy: "security",
  expiresAt: Date.now() + 14 * 86_400_000,
});
```

---

## 10. End-to-end scenario

**A trusted skill starts exfiltrating data after an update.**

```ts
// 1. Declare
const incident = services.incidents.declare({
  kind: "malicious_package",
  severity: "critical",
  title: "skill:acme-crm exfiltrating credentials",
  summary: "Outbound POSTs to an unrecognized host began after 1.3.0.",
  detectedBy: "shield",
  affected: ["skill:acme-crm"],
});

// 2. Revoke — snapshots evidence, quarantines, notifies, all in order
const response = services.supplyChain.revokeVersionRange(
  "skill:acme-crm", ">=1.3.0 <1.4.0", "malicious",
  "Confirmed credential exfiltration.", "security-lead",
);

// 3. Cut the worker's authority
services.authority.revoke(delegationId, "security-lead", "Capability compromised.");

// 4. Restore a safe version
services.supplyChain.restoreSafeVersion({
  capabilityId: "skill:acme-crm", version: "1.2.9",
  actorId: "security-lead", reason: "Last known-good.",
});

// 5. Contain and resolve
services.incidents.transition(incident.incidentId, "quarantined", "security-lead", "Revoked and rolled back.");
services.incidents.transition(incident.incidentId, "resolved", "security-lead", "Safe version restored; credentials rotated.");
```

---

## 11. Limitations

| Limitation | Detail |
|---|---|
| Blocking covers XR's install path | A capability side-loaded outside XR bypasses the check. |
| Signatures prove origin, not intent | A validly signed package can still be malicious. |
| No automated CVE feed | Phase 12 provides the mechanism; feed ingestion is deferred. |
| Snapshots capture metadata | Full package bytes are not archived. |
| Notices are pull-based | XR surfaces them; it does not email or page. |
| No cross-org reputation | Revocations are local or organization-scoped. |

---

## 12. Related

- `INCIDENT_RESPONSE.md` — the incident wrapper around a revocation
- `POLICY_AND_AUTHORITY.md` — `allowUnsignedCapabilities`, `allowUncertifiedCapabilities`
- `docs/CAPABILITIES.md` — Phase 9 provenance and certification
- Controls SC-01 … SC-05 in `CERTIFICATION_EVIDENCE.md`
