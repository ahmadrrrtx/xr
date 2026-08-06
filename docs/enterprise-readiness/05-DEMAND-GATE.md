# Phase 10 · Demand Gate — Verdict, Evidence & Re-open Criteria

**Date of assessment:** 2026-08-06 · **Verdict: NOT MET (build gated).**

---

## 1. The gate (Phase 10 contract, Parts 1/13)

The capstone is demand-gated: build T1–T8 **only if** Phases 0–9 are boringly
reliable **and** enterprise/multi-user demand is measured and demonstrable.
If demand is not demonstrable → produce readiness/design artifacts and stop.

## 2. Measured evidence (2026-08-06)

| Signal | Value | Source |
|---|---|---|
| Phases 0–9 gate status | ✅ 2750 pass / 0 fail; `bun run ci` exit 0; GH Actions recent success on `a40b9f7` | local run + GitHub API |
| GitHub stars / forks / watchers | 5 / 1 / 0 | api.github.com/repos/ahmadrrrtx/xr |
| GitHub issues (open + closed, ever) | 0 | api.github.com search (total_count: 0) |
| External contributors | 0 (all commits/owners @ahmadrrrtx) | git log + CODEOWNERS |
| npm downloads last 30 days | 955 (last week: 1) | api.npmjs.org/downloads/point |
| npm published version | 3.1.5 (repo: 7.1.0) | api.npmjs.org — package stale |
| Enterprise / multi-user deployment evidence | none found anywhere | repo, issues, web search |
| Community/discussion signals | none | repo, website |

## 3. Interpretation (honest, no spin)

- **Phases 0–9: reliably green** — the reliability leg of the gate passes.
- **Demand: not demonstrable.** 5 stars, one fork, zero issues, zero external
  contributors, negligible downloads on a stale package, and no report of any
  organization running XR — there is no *measured* enterprise or multi-user
  demand. The Constitution's ADR-6 (outcome test) says: no measurable
  outcome → research, don't build. Building OIDC/SCIM, SIEM export, remote
  execution, and a benchmark program for a project with zero users would be
  exactly the speculative, facade-prone scope the gate and Art. XVI exist to
  prevent.
- **What IS already true:** the enterprise surface is large and partially
  operated (policy, authority, audit export, incidents, SLOs, evidence
  packs, backup/recovery, evaluation harness); Phases 0–9 are verifiably
  green; claim hygiene is now enforced by a stronger linter.

## 4. What was produced at the gate (readiness/design, not speculative build)

- 01-AUDIT-REPORT.md — Phase 0–9 re-verification, gate verdict,
  facade-vs-operated inventory, claim-hygiene remediation record.
- 02-GAP-ANALYSIS.md — G1–G8 → T1–T8, each with its proof test.
- 03-RESEARCH.md — enterprise 7 controls, OIDC/SAML+SCIM, compliance
  reality, tenancy/secrets/revocation, foundation stewardship — all cited.
- 04-ARCHITECTURE-VALIDATION.md — per-task Constitution validation +
  local-first preservation tests.
- 06-TASK-DESIGNS-T1-T8.md — the concrete gated designs.
- ADR-0024 / 0025 / 0026 — ratified decisions.
- Claim-hygiene code + linter extension (demand-independent) — done and
  verified (claim-lint ✓, release:check ✓, website build ✓, full CI ✓).

## 5. Re-open criteria (how the gate is measured, not assumed)

The gate reopens when **measured** evidence crosses threshold. Suggested
definitions (owner: maintainer; reviewed quarterly):

1. **Adoption floor:** ≥ 25 GitHub stars **and** ≥ 10 distinct forks with
   activity, **or** ≥ 500 npm downloads/month of a CURRENT release (≥ 7.1.0)
   sustained for 2 consecutive months.
2. **User signal:** ≥ 5 distinct external users reporting issues/PRs/forum
   posts about XR (any language), including ≥ 1 deployment report.
3. **Multi-user demand:** ≥ 1 public report of a multi-user/team deployment
   (self-hosted server, Docker, air-gapped) — blog, issue, or config file
   uploaded by a non-owner — **or** an explicit request from an organization
   for SSO/SCIM/SIEM/remote execution.
4. **Contributor floor:** ≥ 1 external contributor with ≥ 2 merged PRs.

When any two of (1)–(4) hold, re-run this assessment, re-validate the
designs against the Constitution, then build T1–T8 in dependency order with
the proof tests in 02-GAP-ANALYSIS.md. Until then, the designs stay ratified
and the gate stays closed. **No part of this phase weakens local-first or
pre-claims enterprise capability.**

## 6. What "not met" does NOT mean

It does not mean Phase 0–9 regressed (they are green). It does not mean the
enterprise surface is worthless (much is operated). It does not mean claims
are being made without evidence (the opposite — fabricated website claims
were removed and linter-enforced). It means the contract's own test for
*measured demand* is not satisfied, so the build is deferred with a fully
ratified plan.
