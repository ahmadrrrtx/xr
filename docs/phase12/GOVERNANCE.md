# XR — Project Governance

**Applies from:** XR 6.1.0
**Nature:** this is organizational and operational process, supported by code. It is deliberately **not** encoded as runtime logic.

---

## 1. Why this document exists

Phase 12 makes XR governable by organizations. That is hollow if the project itself has no transparent process for how decisions get made, how vulnerabilities are handled, and how breaking changes are approved.

This document states those processes plainly, including their current limitations.

---

## 2. Current structure — stated honestly

XR is presently maintained by a **single primary maintainer** (Muhammad Ahmad, `@ahmadrrrtx`).

**This is a governance concentration risk**, and it is recorded as such rather than dressed up as a committee. Concretely:

- There is no independent quorum for release approval.
- There is no separate security team.
- Bus factor is 1.

**Mitigations in place:** every safety-relevant decision is encoded as a test, not as maintainer judgment. The CI gate (typecheck + full suite + version consistency + the certification honesty guard) blocks a release regardless of who proposes it. The audit trail, threat model, and control catalog are public and machine-checkable.

**Path forward:** additional maintainers with review authority, and a security contact separate from the primary maintainer.

---

## 3. Release approval

| Release type | Requirement |
|---|---|
| Patch (`6.1.x`) | All CI gates green; no critical open defect |
| Minor (`6.x.0`) | CI gates + phase validation report + migration notes |
| Major (`x.0.0`) | CI gates + migration guide + deprecation window observed |
| Security patch | CI gates + advisory; may skip the normal cadence |

**Blocking defect classes** — no release ships with an unresolved critical issue in: tenancy isolation, authority/privilege, audit integrity, backup/restore, incident handling, supply-chain response, or migration.

**Mandatory gates:**

```bash
bun run typecheck            # 0 errors
bun test                     # 0 failures
bun run set-version:check    # version consistency
xr enterprise evidence       # honesty guard passes
```

---

## 4. Security disclosure

**Report privately.** Do not open a public issue for a security vulnerability.

See `SECURITY.md` for the current contact and PGP details.

| Severity | Acknowledge | Initial assessment | Target fix |
|---|---|---|---|
| Critical | 48 hours | 5 days | 14 days |
| High | 72 hours | 7 days | 30 days |
| Medium | 7 days | 14 days | Next minor |
| Low | 14 days | 30 days | Backlog |

> These are **targets for a single-maintainer project**, not a contractual SLA. If a target will be missed, the reporter is told.

**Coordinated disclosure:** default embargo is 90 days or until a fix ships, whichever is sooner. Reporters are credited unless they decline. Advisories are published with the fix.

### What counts as a vulnerability

**In scope:** privilege escalation; tenant/workspace data leakage; audit tampering or redaction bypass; sandbox/isolation escape; credential exposure; policy bypass — **especially any way to suppress user-visible safety information**; supply-chain bypass of revocation; restore poisoning.

**Out of scope:** a capability doing what its declared permissions allow; a user's own configuration weakening their own deployment; missing hardening on a deliberately permissive `personal_local` default; theoretical issues without a demonstrable path.

---

## 5. Capability certification

Certification (Phase 9) is automated contract testing, not a human review. It verifies descriptor schema, declared-vs-effective authority, package integrity, risk placement, interface contracts, and context-scope honesty.

> Certification proves a capability **declares itself accurately**. It does not prove the code is benign. This distinction is stated in control SC-05.

**Revocation authority:** the maintainer may revoke any capability or publisher for malicious behavior, an unpatched vulnerability, or repeated policy violation. Revocations preserve evidence first (SC-02) and are published.

---

## 6. Breaking changes and deprecation

**A breaking change requires:** a written rationale, a migration path, a deprecation window, and release-note documentation.

```
Announce ──► Warn at runtime ──► Remove
(release notes)  (≥1 minor)      (next major, earliest)
```

Schema surfaces under compatibility policy: `pluginApiVersion`, `capsuleSchemaVersion`, `backupSchemaVersion`, `policySchemaVersion`, `auditExportFormatVersion`.

---

## 7. Contribution review

| Change type | Requirement |
|---|---|
| Documentation | Maintainer review |
| Bug fix | Review + a regression test |
| Feature | Review + tests + docs |
| **Security-relevant** | Review + tests + **adversarial test** + threat-model update |
| Architecture change | Design note before implementation |

**Security-relevant** means anything touching `src/enterprise/`, `src/trust/`, `src/security/`, `src/capabilities/` authority, audit, or tenancy.

**A contribution is rejected if it:** weakens a safety invariant without an accepted exception; adds a way for an administrator to hide information from users; introduces a second identity system; makes a hosted control plane mandatory for local operation; or claims a certification not obtained.

---

## 8. Architecture exceptions

Some invariants may be waived only through an explicit, recorded exception.

**Never waivable:**

1. User-visibility invariants cannot be suppressed.
2. Delegated authority cannot exceed the delegator's authority.
3. Audit records cannot be silently altered.
4. `personal_local` cannot require a control plane.
5. External certification cannot be claimed without an attestation.

**Requesting an exception:** state the invariant, why it cannot be met, the compensating control, the risk assessment, and an expiry date. Approved exceptions are recorded in the threat model with an `acceptedBy` field and reviewed at expiry. Unaccepted medium/high residual risks surface automatically in `unresolvedRisks` in every evidence pack.

---

## 9. Incident publication

XR publishes a postmortem for any incident that affected users of a released version.

**Published:** timeline, root cause, impact scope, corrective actions, affected versions.
**Not published:** exploit details before users can patch, user data, reporter identity without consent.

**Timing:** within 30 days of resolution, or with the fix for an actively exploited issue.

---

## 10. Decision log

Significant architectural decisions are recorded in the phase deliverables (`PHASE*_AUDIT_DELIVERABLE.md`, `docs/phase*/`), including alternatives considered and deferrals. Phase 12's deferrals are listed in `PHASE12_AUDIT_DELIVERABLE.md` §10.

---

## 11. Related

- `SECURITY.md` — disclosure contact and process
- `CERTIFICATION_EVIDENCE.md` — controls and their honest limitations
- `RELEASE_SUPPORT.md` — channels, windows, compatibility
- `ENTERPRISE_TRUST_ARCHITECTURE.md` — the invariants this governance protects
