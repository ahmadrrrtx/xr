# Phase 10 · STEP 2 — Gap Analysis

**Date:** 2026-08-06 · Mapped from the audited reality (01-AUDIT-REPORT.md) to
the Constitution (Art. XVI/XXI/XXIX/XXX), the Phase 10 specification (Part 8),
and the engineering standards. Each gap is tagged with the test that will
prove it closed. Order = dependency order (T1 before T2 before T3 …).

---

## G1 — Identity: no real IdP path (→ T1)

**Reality:** `deployment/identity/service.ts` issues in-memory tokens; no
OIDC client, no SAML SP, no SCIM endpoint, no JWT verification, no RBAC role
model, no named-human binding beyond a `Map` key.

**Constitution:** Art. IX.3 (every consequential action attributable);
Art. XVI (enterprise = operated controls); Phase 10 Part 5 (one real identity
path; local-only without IdP).

**Gap:** A real, verifiable identity integration with JIT provisioning and
SCIM deprovisioning, mapping every action to a named human, with RBAC at
org/project/env scope — while local-only mode still boots without any IdP.

**Proof test (acceptance):** an end-to-end test against a mock OIDC IdP
(issuer + JWKS + ID-token verification, audience/issuer/expiry checks) that
(1) authenticates a named human, (2) provisions JIT, (3) deprovisions via
SCIM `PATCH active:false` and removes access, (4) attributes a subsequent
action to that human in the audit record; plus a **local-only test with no
IdP configured** that boots and completes a task with zero identity
configuration.

## G2 — Tenancy: no adversarial boundary proof; secrets guard (→ T2)

**Reality:** tenant boundaries are in-memory metadata; policy scoping is
real; there is no adversarial cross-tenant test at a real execution/data
boundary; no test asserting secrets are absent from the agent/sandbox
environment for placed tasks.

**Constitution:** Art. IX (isolation follows risk), Art. XXI.5 ("data scope"
≠ "security isolation").

**Gap:** Verified isolation of org/workspace at the runtime boundary;
adversarial leakage suite; encrypted credentials that never enter the agent
runtime.

**Proof test:** adversarial cross-tenant suite where tenant A attempts to
read/act on tenant B's workspace state, audit records, capabilities, and
secrets via every public boundary — **leakage = 0**; plus an env-inspection
test asserting the agent/sandbox process environment contains no credential
material for any task.

## G3 — Audit → SIEM: no OTLP export; retention not executed (→ T3)

**Reality:** file-based export (JSONL/JSON/CSV) with redaction and chain
verification is real; `src/enterprise/` never imports `src/observability/`;
retention is a policy module, not a scheduled service.

**Constitution:** Phase 10 Part 5 (per-action audit exported to SIEM via
Phase-8 OTel/OTLP, redacted, cardinality-bounded; retention controls;
legal-hold).

**Gap:** An OTLP/OTel exporter (reusing the Phase-8 exporter) that streams
redacted, cardinality-bounded per-action records to a configurable SIEM
endpoint; a retention executor that archives/deletes on schedule while legal
hold blocks deletion with a reported conflict; legal-hold/e-discovery export.

**Proof test:** spin a local OTLP collector; assert redacted records arrive
with user/action/object/outcome/timestamp and cardinality bounds; advance a
fake clock → records deleted per schedule; place a legal hold → deletion
blocked and reported; legal-hold export returns an immutable, hash-verified
subset.

## G4 — SLOs/incident ops: no measurement pipeline, no atomic kill-switch, no advisory artifact (→ T4)

**Reality:** honest SLO definitions; incident state machine with immutable
evidence; delegation revocation is real; SECURITY.md disclosure exists.

**Gap:** (a) a measurement pipeline that samples the declared signals and
reports SLO status from real samples (never fabricated); (b) an atomic
revocation/kill-switch that stops in-flight and queued tasks; (c) a published
advisory/security-advisories artifact with a template.

**Proof test:** seed the SLO store with samples → report computes status from
samples only; invoke the kill-switch while tasks are in-flight → tasks stop,
queued tasks never start, audit records the switch; advisory template
validates and renders.

## G5 — Compliance evidence (→ T5)

**Reality:** evidence-pack machinery is real and honest; no certification
claimed; **independent assessment not engaged** (correct: organizational act,
gated on demand).

**Gap:** A reproducible framework-mapping artifact (SOC 2 / ISO 27001
control → operated control → evidence/test), exportable per assessment, with
the external-assessment status explicitly tracked as "not engaged".

**Proof test:** the mapping generator runs and every mapped control resolves
to a real `implementedIn` file and `testedBy` test that exists and passes;
the generated pack's header asserts `externallyCertified: false`.

## G6 — Remote execution: simulation only (→ T6)

**Reality:** placement scoring is real; worker registry/control-plane/sync are
in-memory with injected transports; no remote path exists — so no bypass is
possible today, but no capability exists either.

**Gap:** portable task capsules + one backend adapter behind the Phase-2
envelope; placement policies; offline + eventual sync; **remote cannot bypass
local policy/approval/audit**.

**Proof test:** a capsule authored under local policy is placed to a mock
remote backend and back (portability without authority/provenance loss); the
remote path reuses the envelope's policy decision (asserted by a test that
denies a remote action the local policy would deny); local-only deployment
compiles zero remote code.

## G7 — Outcome benchmarks: harness exists, program not running (→ T7)

**Reality:** `evaluation/*` adjudicator is real (self-pass impossible,
budgets, provenance). No published reproducible program/results.

**Gap:** a reproducible benchmark program with a fixed scenario set, seeded
run, published results, and a cadence — proving superiority on measured
dimensions, not feature count.

**Proof test:** two runs of the seeded benchmark from a clean checkout produce
identical outcomes (reproducibility); results render into the published
artifact.

## G8 — Governance: single-owner, no pipeline, no foundation research (→ T8)

**Reality:** 151 areas owned by one person; CONTRIBUTING/CODEOWNERS exist;
foundation path now researched (ADR-0026).

**Gap:** ≥1 owner per subsystem that is not the same human (needs a second
contributor — demand), documented owner succession, a good-first-issue ladder
with tracked outcomes, and the researched foundation path kept current.

**Proof test:** ownership-map check requires every area to have an owner
different from the default in at least one area after a contributor joins
(CI-assertable once there is a second owner); contributor-onboarding docs
pass a first-PR dry run; foundation research doc has sources with dates.

---

## Mapping summary

| Gap | Task | Gate for build |
|---|---|---|
| G1 | T1 | demand gate (05-DEMAND-GATE.md) |
| G2 | T2 | demand gate |
| G3 | T3 | demand gate |
| G4 | T4 | demand gate |
| G5 | T5 | demand gate |
| G6 | T6 | demand gate |
| G7 | T7 | demand gate |
| G8 | T8 | demand gate (partially: docs/ADR done now) |

*None of G1–G8 is a Phase-0–9 regression; all are additive. The claim-hygiene
gaps found in the audit (unsupported website claims) were NOT gated and are
already closed (01-AUDIT-REPORT.md §5).*
