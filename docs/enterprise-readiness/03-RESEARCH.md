# Phase 10 · STEP 3 — Research Notes (principles adopted, verified & cited)

**Date:** 2026-08-06 · Purpose: record the principles Phase 10 will adopt
when the demand gate reopens — **adopt principles, never copy code**. Every
entry: principle + source (verified). Sources are cited inline; none are
assumed.

---

## R1 — The enterprise AI-agent "7 non-negotiable controls" (2026)

**Principle:** Enterprise agent deployments are won or lost on controls, not
model quality. The 2026 baseline set is: (1) SSO & SCIM (every agent action
maps to a named human; deprovisioning automatic), (2) SIEM export (agent
activity lands in Splunk/Datadog/Chronicle/Elastic for correlation),
(3) secret scanning on agent PRs, (4) PR policy gates (owner review,
coverage, lint, SAST, secret detection on every agent PR), (5) license
governance, (6) sandbox isolation for agent execution, (7) incident-response
runbooks with a pre-wired kill switch.

**Sources:**
- Digital Applied, *Enterprise Coding Agent Deployment Playbook: 2026* — "SSO
  & SCIM … deprovisioning is automatic"; "SIEM export … Splunk, Datadog,
  Chronicle, or Elastic"; "Pre-wired kill switch, documented runbook,
  rehearsed quarterly". (2026-04-13)
- Northflank, *Enterprise AI coding agent deployment in 2026* — "seven
  non-negotiable controls: SSO integration, SIEM-connected audit logging,
  secret scanning on agent PRs, PR policy gates, license governance, sandbox
  isolation … incident response runbooks"; "88% of enterprise AI agent pilots
  never reach production"; "For SOC 2 Type 2, auditors require demonstrable
  evidence that controls operated consistently across the audit period".
  (2026-05-07)
- beyondscale.tech, *AI Agent Sandboxing: Enterprise Security Guide 2026* —
  sandbox = the new perimeter; OWASP/NVIDIA/Microsoft converged on process
  isolation, egress allowlists, config-file write protection, per-task
  secrets; "Kill switch or circuit breaker configured for rogue agent
  detection". (2026-04-22)

**Adoption into XR Phase 10 design:** T1 (identity), T3 (SIEM export), T4
(kill-switch + runbooks + disclosure), T6 (sandboxed remote execution behind
the envelope). Secret scanning / PR gates / license governance are the
*deploying organization's* controls on their side of the boundary — XR
provides the audit/evidence feed, it does not fake their existence.

## R2 — Identity: OIDC (preferred for new) / SAML + SCIM; JIT + deprovisioning; RBAC

**Principle:** Authentication (OIDC or SAML) and lifecycle (SCIM) are two
halves of one enterprise identity capability; JIT provisioning is the
low-cost onboarding path, SCIM is the production answer for deprovisioning
(SAML alone leaves orphaned accounts); OIDC (JWT, Authorization Code + PKCE)
is the lighter fit for API-first/CLI clients, SAML persists for legacy/
IdP-initiated/compliance-heavy environments; authorization must be enforced
locally from group/role claims — the IdP proves identity, the application
enforces roles.

**Sources:**
- guptadeepak.com CIAM Compass, *SCIM vs SAML: Provisioning vs
  Authentication* — JIT from SAML attributes "solves the onboarding side
  cleanly"; "JIT doesn't handle the deprovisioning side … the account sits
  orphaned"; "Enterprise B2B SaaS needs both". (2026-05-15)
- corma.io, *Understanding SCIM and SAML in Under 5 Minutes* — SCIM = user
  lifecycle sync; "SCIM immediately disables or deletes their account → No
  zombie access remains". (2025-07-18)
- ssojet.com, *Okta SAML vs OIDC for SaaS Vendors* — OIDC for SPA/mobile/API
  clients with PKCE; SAML where enterprise/IdP-initiated flows demand it;
  "support both: the protocol is the customer's decision". (2026-07-17)
- nhimg.org, *SAML vs OIDC for SSO: are your enterprise controls ready?* —
  "Separate authentication from authorization … the IdP proves identity and
  the application enforces roles … locally"; "Prefer SCIM for
  lifecycle-sensitive access"; harden token validation (signature, issuer,
  audience, nonce, expiry). (2026-06-08)

**Adoption:** T1 design — OIDC as the primary identity path (Authorization
Code + PKCE; JWKS-signed ID-token verification with issuer/audience/expiry
checks), SCIM 2.0 endpoint for lifecycle (create/update/deactivate), RBAC
resolved locally from claims at org/project/env scope; SAML recorded as a
future adapter for compliance-heavy orgs, never a silent second path.

## R3 — Compliance: operated controls + independent assessment, never a badge

**Principle:** SOC 2 Type II is an **attestation** produced by a licensed CPA
firm after an observation period (3–12 months) during which the auditor
samples evidence that controls *operated consistently*; it is not a
certificate and not self-attestable. ISO 27001 is a certificate from an
accredited body for an operating ISMS. Auditors use inquiry, observation,
inspection, and re-performance — evidence must exist and be exportable across
the audit window. "Compliance dashboards without enforceable controls" are a
named permanent rejection in the XR Constitution.

**Sources:**
- truvocyber.com, *What Is a SOC 2 Type 2 Report* — "not a certification or a
  badge. It is an independent auditor's opinion on whether an organization's
  controls are suitably designed and operating effectively over a defined
  observation period"; auditor tests by inquiry/observation/inspection/
  re-performance. (2026-07-26)
- ispartnersllc.com, *Why Is SOC 2 an Attestation and Not a Certification* —
  SOC 2 requires an independent third-party auditor from a licensed CPA firm;
  "no universally accepted certification system for SOC 2". (2025-08-26)
- sprintо.com, *SOC 2 Type 2: Requirements, Process, Cost in 2026* — control
  operation over 3–12 months; continuous evidence (access reviews, SSO logs,
  change management, vulnerability scans, incident records, backup tests,
  monitoring). (2026-06-22)
- truvocyber.com, *SOC 2 vs ISO 27001* — SOC 2 produces a shareable
  attestation report; ISO 27001 issues a certificate for an operating ISMS.
  (2026-07-26)

**Adoption:** T5 design — framework mapping (SOC 2 TSC / ISO 27001 Annex A →
XR operated control → `implementedIn` file → `testedBy` test) generated into
an exportable evidence pack; `externallyCertified` stays false until a
licensed/accredited assessor issues evidence; every certification claim in
public surfaces remains governed by the claim-linter. HIPAA/PCI/FedRAMP are
explicitly out of scope until an organization operates them.

## R4 — Tenancy, secrets, revocation

**Principle:** tenant isolation must be tested adversarially (cross-tenant
leakage is a critical finding); credentials are encrypted at rest and
provisioned per-task — never exposed to the agent runtime; revocation must be
instant and cover in-flight and queued work (kill-switch/circuit breaker);
audit must capture user/action/object/outcome/timestamp and the policy
applied.

**Sources:**
- obsidiansecurity.com, *The 2025 AI Agent Security Landscape* — incident
  response: "Isolate the affected agent by revoking tokens"; audit logs with
  timestamp, agent identifier, requested action + target resource,
  authorization decision + policy applied. (2025-10-23)
- Northflank (R1) — RBAC "across organisation, project, and environment";
  audit logs exported to SIEM.
- beyondscale.tech (R1) — "per-task secrets provisioning"; ephemeral sandbox
  destroyed after task.

**Adoption:** T2 design (adversarial cross-tenant suite; per-task credential
brokering reusing Phase-4 brokering; instant revocation incl. in-flight
termination + queued-task purge, both audited).

## R5 — Open-source sustainability & foundation stewardship

**Principle:** Linux Foundation / CNCF / OpenSSF exist to be a neutral
fiduciary and legal/IP umbrella with governance infrastructure; they are the
right destination **once a project has a community to steward** (premature
application without a community is bureaucracy). Sustained contributor
capacity (mentorship pipelines) is the known antidote to maintainer burnout
and bus-factor collapse. OpenSSF Scorecard/SLSA and CRA alignment are
available now, independent of membership. Governance must stay transparent
and tied to risk — lightweight, not bureaucratic.

**Sources:**
- kusari.dev, *What is the CNCF?* — CNCF ensures vendor neutrality,
  "preventing any single company from controlling critical infrastructure";
  neutral home for governance. (2025-11-17)
- develobots.com, *Linux Foundation vs CNCF* — LF provides legal, IP,
  governance, infrastructure backbone; each project keeps its own TSC/
  meritocratic model; "neutral and trusted custodian". (2025-10-03)
- policy.openssf.org, *OpenSSF and The Linux Foundation as Stewards* — LF/
  OpenSSF "happy to accommodate" projects; CRA alignment, Scorecard, SBOM
  guidance, common disclosure processes. (undated, current)
- linuxfoundation.org, *Understanding Open Governance Networks* — open,
  neutral, participatory governance as an LF best practice. (2021-02-11)
- Digital Applied (R1) — PR gates: "COCODEOWNERS file enforced by branch
  protection; at least one human approval from an owner" — mirrors XR's
  existing Art. XXVIII contribution standards.

**Adoption:** ADR-0026 — foundation path documented as research; contributor
pipeline ratcheted; bus-factor mitigation (owner succession) started as docs
now, structure gated on a second contributor.

---

## Principles NOT adopted (with reason)

- **"Compliance dashboards without enforceable controls"** — permanent
  rejection in the Constitution (Part Seven); nothing in this research
  changes that.
- **Copying any vendor's exact control list as a feature checklist** — the 7
  controls are adoption criteria for XR's design, and XR must not claim a
  control it does not operate (Commandment 1).
- **Foundation application now** — research only (ADR-6/7; ADR-0026).
