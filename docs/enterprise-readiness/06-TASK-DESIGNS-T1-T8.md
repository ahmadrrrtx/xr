# Phase 10 · Ratified Gated-Build Designs (T1–T8)

**Status:** Design ratified (ADR-0024/0025/0026); **build gated** on the
demand criteria in `05-DEMAND-GATE.md`. These designs are the starting point
when the gate reopens; each ends with its acceptance test (from
`02-GAP-ANALYSIS.md`). Nothing here weakens local-first; nothing claims
certification.

---

## T1 — One real identity path (OIDC primary / SAML later + SCIM + RBAC + attribution)

**Files (planned):** `src/enterprise/identity/oidc-client.ts`,
`src/enterprise/identity/scim-server.ts`, `src/enterprise/identity/rbac.ts`,
`src/enterprise/identity/types.ts`; replace `deployment/identity/service.ts`
in-memory issuance (deprecation cycle per Art. XXVII).

**Design:**
1. **OIDC client** — Authorization Code + PKCE; JWKS fetch + key rotation;
   ID-token verification (issuer match, audience, expiry, nonce, `azp`
   where applicable); `sub`/`email`/group claims → local actor.
2. **SCIM 2.0 endpoint** — `GET/POST /Users`, `PATCH` (incl. `active:false`),
   group membership; IdP push = JIT provisioning + deprovisioning.
3. **RBAC** — roles resolved **locally** from claims at org/project/env
   scope (research R2: "the IdP proves identity, the application enforces
   roles"); role→scope mapping is policy data, most-restrictive-wins.
4. **Attribution** — every action's audit record carries the named-human
   actorId (existing Phase-1 chain).
5. **Local-only** — no IdP configured ⇒ the local actor path is unchanged;
   the identity service degrades to the current behavior with zero config.

**Acceptance:** mock-OIDC end-to-end (auth → JIT → SCIM deprovision removes
access → action attributable to the human) **+ local-only-without-IdP boot
and task**.

## T2 — Verified tenancy + secrets + instant revocation

**Files (planned):** `src/enterprise/tenancy/enforcer.ts`,
`src/enterprise/tenancy/adversarial-suite.ts`, reuse Phase-4 credential
brokering (`src/integrations/credentials.ts`), `src/enterprise/revocation/
kill-switch.ts`.

**Design:**
1. Boundary enforcement at the execution/data layer — workspace access
   checks applied by the runtime on every state/capability/audit read and
   write (fail closed on ambiguity).
2. Secrets: encrypted at rest in the vault; per-task scoped credentials
   injected by the broker; **never** in the agent/sandbox environment
   (env-inspection guard + test).
3. Instant revocation: token/identity revocation invalidates in-flight
   executions (terminated at the next envelope checkpoint) and purges
   queued tasks; every revocation is an audited event.

**Acceptance:** adversarial cross-tenant suite (tenant A vs tenant B across
state/audit/capabilities/secrets) → **leakage = 0**; env-inspection test →
no credential material in agent/sandbox; revocation test → in-flight +
queued stop, audited.

## T3 — Audit → SIEM (OTLP) + retention/legal-hold

**Files (planned):** `src/enterprise/audit/siem-exporter.ts` (wraps the
Phase-8 OTLP exporter — one exporter authority), `src/enterprise/audit/
retention-executor.ts`, `src/enterprise/audit/legal-hold-export.ts`.

**Design:**
1. SIEM export: subscribe to the audit chain (and existing OTel logs
   pipeline), redact via the existing `redaction.ts` **before**
   serialization, cardinality-bounded batching, configurable endpoint
   (Splunk/OTLP-compatible / Datadog via OTLP), opt-in per deployment.
2. Retention executor: scheduled job applies `retention.ts` schedules
   (archive/delete); **legal hold blocks deletion and reports the conflict**
   (never a silent skip — existing invariant).
3. Legal-hold/e-discovery export: immutable, hash-verified subset with
   chain integrity.

**Acceptance:** local OTLP collector receives redacted per-action records
(user/action/object/outcome/timestamp); retention deletes on schedule; legal
hold blocks deletion (reported); e-discovery export hash-verified.

## T4 — SLOs + incident ops + kill-switch + disclosure

**Files (planned):** `src/enterprise/operations/slo-pipeline.ts`,
`src/enterprise/incidents/kill-switch.ts`, `docs/security/advisories/TEMPLATE.md`.

**Design:**
1. SLO pipeline samples declared signals → status computed from real
   samples only (`unmeasurable` stays honest); multi-user profiles only.
2. Kill-switch: atomic revocation wired into incident response actions;
   stops in-flight + queued tasks; audited; user-visible impact flags
   honored (existing invariant).
3. Disclosure: `SECURITY.md` flow already exists; add a published
   advisories register with a template and evidence dates.

**Acceptance:** SLO report from seeded samples only; kill-switch stops
in-flight + queued (audited); advisory template validates.

## T5 — Compliance evidence (operated + independently assessed)

**Files (planned):** `src/enterprise/certification/framework-map.ts`
(generator), extend `certification/evidence.ts`.

**Design:** framework mapping (SOC 2 TSC / ISO 27001 Annex A → operated
control → `implementedIn` → `testedBy`) generated into an exportable pack;
`externallyCertified` remains false; assessment status field tracked
("not engaged"). No certification claim until a licensed/accredited assessor
issues evidence — the claim-linter continues to govern public surfaces.

**Acceptance:** every mapped control resolves to a real file + passing test;
pack header asserts `externallyCertified: false`.

## T6 — Remote execution (gated, behind the Phase-2 envelope)

**Files (planned):** `src/enterprise/placement/backend-adapter.ts`
(one adapter first), extend `deployment/control-plane` as local coordinator
only; `src/enterprise/placement/policy.ts`.

**Design:** portable `TaskCapsule` carries authority/approval/provenance
across placements; a backend adapter executes the capsule **under the
envelope's recorded policy decision** (no second execution path);
`allowRemotePlacement` default false, most-restrictive-wins; offline +
eventual sync via the existing SyncEngine contract; personal_local compiles
zero remote code.

**Acceptance:** capsule moves between placements without authority/
provenance loss; remote denies what local policy denies; offline queue +
eventual sync; local-only bundle has no remote code.

## T7 — Outcome benchmark program

**Files (planned):** `benchmarks/outcomes/` scenario set + seed,
`scripts/benchmark-run.ts`, `docs/benchmarks/RESULTS.md` (published).

**Design:** fixed scenario set on the existing adjudicator
(`evaluation/runner.ts`), seeded + reproducible (two clean runs identical),
results published with methodology; superiority claims only on measured
dimensions.

**Acceptance:** reproducibility check (identical outcomes across clean
checkouts) + published results artifact.

## T8 — Sustainability/governance + contributor pipeline

**Files (planned):** `docs/OWNERS.md` (succession intent),
`docs/developer/CONTRIBUTOR_LADDER.md`, keep `docs/enterprise-readiness/
03-RESEARCH.md` (foundation path) current.

**Design:** owner-succession records; good-first-issue ladder with tracked
outcomes; foundation-path research reviewed quarterly; no cloud-only lock-in
(Art. XXIX.1). Second-owner structure is CI-assertable **when a contributor
joins** (ownership-map check extended).

**Acceptance:** ownership check requires ≥1 area owned by a non-default
owner (post-contributor); first-PR dry-run passes from the onboarding docs;
research doc carries sources + dates.
