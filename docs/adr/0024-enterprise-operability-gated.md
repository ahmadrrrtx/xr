# ADR-0024 — Enterprise Operability as a Demand-Gated Deployment Profile

- **Status:** Accepted — *design ratified; build gated* (Phase 10 · enterprise readiness)
- **Owner:** Enterprise Lead (vacant — see ADR-0026; interim: @ahmadrrrtx)
- **Date:** 2026-08-06
- **Constitution:** Art. XVI (enterprise = operated controls + evidence; local
  autonomy preserved), Art. XXI (locality/residency/privacy), Art. XXIX/XXX
  (transparent governance; demand-gated evolution), ADR-5 (local-first test),
  ADR-6 (outcome test), ADR-7 (complexity test).

## Context

XR has a large `src/enterprise/` surface (~22 kLOC, 60+ files, its own test
suite) plus enterprise-flavored website claims. The audit (STEP 1 of the
Phase 10 contract) found a **mixed facade-vs-operated state**: real, tested,
local controls for policy, delegated authority, audit export/retention,
incidents, SLO honesty, backup/recovery, and evidence preparation — but
**facade-only** for identity (in-memory token issuance; no OIDC/SAML/SCIM),
SIEM export (file-based export, not OTLP-wired), remote execution (in-memory
placement/worker/control-plane; no transport), and enforcement-tested
tenancy.

The Phase 10 contract is **demand-gated**: enterprise features are built only
when Phases 0–9 are boringly reliable **and** enterprise/multi-user demand is
measured. At audit time (2026-08-06): Phases 0–9 are verified green
(2750 pass / 0 fail; full `bun run ci` green), but **measured demand does not
exist** (5 stars, 1 fork, 0 user issues, 955 npm downloads/month on a stale
package, zero enterprise/multi-user deployment evidence).

## Decision

1. **Enterprise is an additive, opt-in deployment profile (L6)** — never a
   replacement for local-first, never a mandatory control plane. Local-only
   mode stays complete and sovereign (Art. XXI/XXX).
2. **The build of the enterprise tasks (T1–T8) is GATED on the demand
   condition.** The readiness artifacts — audit report, gap analysis, research
   (with sources), architecture validation, and the T1–T8 designs in
   `docs/enterprise-readiness/` — are ratified now. The code is built only
   when the demand gate reopens (see `05-DEMAND-GATE.md`).
3. **Claim hygiene is NOT gated.** Unsupported public claims are removed
   immediately: the website's fictional SaaS tier structure (SSO/SAML,
   SLAs, Enterprise SSO, trials, contact-sales, VPC tier, commercial license),
   the fabricated marketplace listings with fake download/review counts, the
   Rust-core blog fabrication, "generally available" release labels, and
   unverifiable social-proof headlines. The claim-linter's prohibited-pattern
   list is extended so CI fails on recurrence (Art. XIX.1/XXII.4).
4. **Compliance claims remain governed:** no SOC 2 / ISO 27001 / HIPAA /
   PCI-DSS / FedRAMP certification is claimed until an independent auditor
   issues evidence. The existing `assertNoFalseCertificationClaim` invariant
   and the evidence-pack machinery are the operated-controls groundwork.

## Why this is constitutional

- ADR-5 (local-first test): the design has **no mandatory cloud**. A local
  deployment boots and completes real work with zero enterprise components
  compiled in.
- ADR-6 (outcome test): with no measured enterprise demand, there is no
  measurable outcome for the build; the design is ratified, the build waits.
- ADR-7 (complexity test): OIDC/SCIM/SIEM/remote-execution are the most
  complex surface XR could add; building them speculatively would be exactly
  the "scope creep as facade" failure mode Art. XVI was written to forbid.

## Exceptions

None. This ADR **defers** (does not weaken) the T1–T8 build until demand.

## Review

Re-evaluate when the demand gate metrics in `05-DEMAND-GATE.md` reach
threshold, or at the next quarterly architecture review, whichever is sooner.
