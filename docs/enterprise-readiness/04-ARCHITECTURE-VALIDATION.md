# Phase 10 · STEP 4 — Architecture Validation (before code)

**Date:** 2026-08-06 · Validates the gated build plan (ADR-0024/0025/0026 +
`06-TASK-DESIGNS-T1-T8.md`) against the Constitution and Phase 10 scope.
Per task: design decision → Constitution check → local-first-preservation
test → operated-control evidence expectation. A plan that fails any check is
redesigned before code — none of the tasks below weaken local-first, make a
cloud control plane mandatory, claim certification without assessment, or
let remote execution bypass local policy.

---

## T1 — One real identity path (OIDC + SCIM + RBAC + attribution)

- **Design:** OIDC Authorization Code + PKCE client; JWKS-signed ID-token
  verification (issuer/audience/expiry/nonce); SCIM 2.0 endpoint
  (create/update/deactivate) for JIT + deprovisioning; roles resolved
  locally from claims at org/project/env scope; every action binds actorId.
  Local-only profile compiles the identity service with **no IdP** and falls
  back to the existing local actor.
- **Constitution:** Art. IX.3 (attributable actions ✓); Art. XXI (no
  mandatory cloud — the IdP is the *organization's* IdP, opt-in ✓);
  ADR-2 (no second identity authority: this is the first real one, replacing
  the in-memory facade, not duplicating it ✓); ADR-5 (local-only boots with
  no IdP ✓).
- **Local-first preservation test:** boot `personal_local` with zero identity
  config; run a real task; audit attributes it to the local actor. CI-gated.
- **Operated-control evidence:** end-to-end test with a mock OIDC issuer +
  JWKS + SCIM; deprovision removes access; a named human appears in the
  audit record.

## T2 — Verified tenancy + secrets

- **Design:** org/workspace boundary enforcement at the execution/data layer
  (not just policy metadata); per-task credential brokering (reuses Phase-4
  brokering; secrets encrypted at rest, injected per-task, never in agent
  env); instant revocation (in-flight termination + queued purge).
- **Constitution:** Art. IX (isolation follows risk; fail closed ✓);
  Art. XXI.5 (language never conflates data scope with isolation ✓);
  ADR-4 (authority isolated from intelligence, auditable ✓).
- **Local-first preservation test:** single-user workspace has no tenant
  boundary code active; zero overhead on the local hot path (measured).
- **Operated-control evidence:** adversarial cross-tenant suite → leakage =
  0; env-inspection asserts no secrets in agent/sandbox.

## T3 — Audit → SIEM + retention/legal-hold

- **Design:** OTLP/OTel exporter **reusing the Phase-8 exporter** (single
  observability authority — no second exporter), redaction before
  serialization, cardinality bounds; retention executor with legal-hold
  block reporting; legal-hold/e-discovery export.
- **Constitution:** Art. XXI.3 (telemetry opt-in, redacted,
  cardinality-bounded ✓); ADR-2 (reuse Phase-8 OTLP, do not build a second
  exporter ✓); Art. XIX (claim-governed ✓).
- **Local-first preservation test:** with no SIEM configured, export is a
  no-op local file path; nothing leaves the host.
- **Operated-control evidence:** local OTLP collector receives redacted
  per-action records; retention deletes on schedule; legal hold blocks
  deletion and reports the conflict; e-discovery export is hash-verified.

## T4 — SLOs + incident ops + kill-switch + disclosure

- **Design:** measurement pipeline sampling declared signals; SLO report from
  real samples only; atomic revocation/kill-switch wired into incident
  response actions; advisory template + published advisories artifact.
- **Constitution:** Commandment 2 (no fabricated "meeting" — `unmeasurable`
  is already the honest state ✓); Art. IX (fail closed ✓).
- **Local-first preservation test:** SLO sampling off the local hot path;
  personal profile shows `not_applicable` for multi-user SLOs.
- **Operated-control evidence:** kill-switch stops in-flight + queued tasks
  (audited); advisory renders from template; SLO report computed only from
  samples.

## T5 — Compliance evidence (operated + assessed)

- **Design:** generated framework mapping (SOC 2 TSC / ISO 27001 Annex A →
  control → file → test) into an exportable pack; `externallyCertified`
  stays false; external-assessment status tracked as "not engaged".
- **Constitution:** Part Seven permanent rejection of "compliance dashboards
  without enforceable controls" ✓ (every mapped control resolves to a real
  implemented/tested control); Commandment 1 (no claim without evidence —
  certification claims remain linter-governed ✓).
- **Operated-control evidence:** mapping generator output resolves 100% to
  existing files/tests; pack header asserts no external certification.

## T6 — Remote execution (gated, behind the envelope)

- **Design:** portable `TaskCapsule`; one backend adapter behind the Phase-2
  envelope; placement policy (`allowRemotePlacement` default false,
  most-restrictive-wins); offline + eventual sync via the existing SyncEngine
  contract; capsule carries authority/approval/provenance across placements.
- **Constitution:** Art. VI.3 (one envelope, one placement authority ✓ —
  this ADDS a placement target, not a second execution path); Art. XXI
  (locality invariant — remote is opt-in policy, never default ✓); ADR-2
  (no second execution engine ✓); Commandment 4 (remote flows through the
  envelope ✓).
- **Local-first preservation test:** `personal_local` compiles zero remote
  code (asserted by a dependency/bundle test); force-local override still
  hard-gates.
- **Operated-control evidence:** capsule moves between placements without
  authority/provenance loss; a remote action denied by local policy is
  denied by the remote path; offline queue + eventual sync merge without
  duplication.

## T7 — Outcome benchmark program

- **Design:** fixed scenario set + seeded runs on the existing adjudicator;
  published results artifact with reproducibility check in CI; superiority
  claims only on measured dimensions.
- **Constitution:** Art. I (measured outcomes, never count ✓); Commandment 2
  (effects, not transitions ✓).
- **Operated-control evidence:** two clean-checkout runs produce identical
  outcomes; results render into the published artifact.

## T8 — Sustainability/governance + contributor pipeline

- **Design:** ownership succession docs; good-first-issue ladder with tracked
  outcomes; foundation-path research kept current (ADR-0026); no cloud-only
  lock-in (Art. XXIX.1 binding).
- **Constitution:** Art. XXVIII/XXIX/XXX ✓.
- **Operated-control evidence:** ownership check requires a second owner per
  area (assertable when a contributor joins); first-PR dry-run passes from
  the onboarding docs; research doc carries sources + dates.

---

## Cross-cutting validation

| Invariant | Status |
|---|---|
| Local-first preserved (local-only complete & sovereign) | ✓ every task has a local-first preservation test; none adds a mandatory dependency |
| No mandatory cloud control plane | ✓ ADR-0025: control plane stays a local coordinator; remote backend opt-in |
| No certification without operated controls + assessment | ✓ T5 design; claim-linter governs all public surfaces |
| Remote never bypasses local policy/approval/audit | ✓ T6 design (envelope reuse) + proof test |
| No Phase-0–9 regression | ✓ T1–T8 are additive surfaces; existing gates re-run on every build |
| No net-new consumer feature | ✓ all tasks are L6 enterprise deployment profile |
| No new boundary `any`/empty-catch | ✓ accepted engineering standard for T1–T8 builds |
