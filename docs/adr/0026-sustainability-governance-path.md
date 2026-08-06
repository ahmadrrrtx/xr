# ADR-0026 — Sustainability & Governance: Contributor Pipeline + Foundation-Path Research

- **Status:** Accepted — *research ratified; structural steps gated*
  (Phase 10 · T8 design)
- **Owner:** Governance Lead (interim: @ahmadrrrtx)
- **Date:** 2026-08-06
- **Constitution:** Art. XXVIII (contribution standards), Art. XXIX (open
  governance, vendor neutrality), Art. XXX (decade-scale evolution),
  ADR-6 (outcome test), Part Twelve.6 (periodic independent assurance).

## Context

Audit findings: CONTRIBUTING, CODEOWNERS, CoC-adjacent docs, SECURITY
disclosure and issue/PR templates exist and are maintained; the ownership map
covers 151 areas — **but every area is owned by @ahmadrrrtx**. This is a
bus-factor-1 project with zero external contributors (0 issues, 0 forks with
activity, 5 stars). The Constitution demands ≥1 owner per subsystem and
transparent governance, and the Phase 10 contract requires a contributor
pipeline and a researched foundation-stewardship path (no premature
bureaucracy).

## Decision

1. **Foundations are research, not bureaucracy.** The Linux Foundation /
   CNCF / OpenSSF stewardship path is documented with sources
   (`docs/enterprise-readiness/03-RESEARCH.md`). Rationale: stewardship is
   justified by adoption scale and governance need, both absent today; a
   foundation application without a community would be premature.
2. **The contributor pipeline is ratcheted, not invented:** good-first-issue
   ladder, one-concern PR rule, owner review (all already in CONTRIBUTING);
   the next ratchet is a *documented owner-succession* section so any
   subsystem can be handed over without tribal knowledge.
3. **Bus-factor mitigation starts now (cheap, local):** an `OWNERS` intent
   record (who could take each area) and a "decisions are public" note are
   design-level; recruiting a second owner is gated on there being a second
   contributor (demand).
4. **No cloud-only lock-in** — already constitutional law (Art. XXIX.1);
   this ADR adds the explicit commitment that any future governance body
   cannot introduce a mandatory cloud control plane.

## Research findings (summarized; sources in 03-RESEARCH.md)

- Foundations (LF/CNCF/OpenSSF) provide neutral fiduciary, legal/IP umbrella,
  governance infrastructure and CRA/security alignment — valuable **once a
  project has a community to steward**.
- Sustained contributor capacity is the known antidote to maintainer burnout
  and bus-factor risk; mentorship pipelines are the standard mechanism.
- Security hardening (Scorecard/SLSA) is available now regardless of
  foundation membership.

## Review

Re-evaluate when external contributors reach a sustained threshold (see
`05-DEMAND-GATE.md`) or at the quarterly architecture review.
