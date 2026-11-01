# XR v1 — Phase Status

**Durable state table.** This file is the only authority on phase eligibility.
It is updated **after** evidence review, never on an executor's self-report.

**Plan revision:** R1 · **Baseline commit:** `6b9cb599aebbe8d8de8b100370c3a6434c3240e0` ·
**Last updated:** 2026-11-01

**Allowed statuses:** `PLANNED` · `READY` · `PROMPT_GENERATED` · `IN_PROGRESS` ·
`IMPLEMENTATION_REPORTED` · `VERIFYING` · `BLOCKED` · `FAILED` · `VERIFIED` ·
`ACCEPTED` · `DEFERRED` · `SUPERSEDED`

**Promotion rules**

| Transition | Requires |
|---|---|
| `PLANNED` → `READY` | All prerequisite phases `ACCEPTED`; prerequisite decisions resolved; no unresolved blocker |
| `READY` → `PROMPT_GENERATED` | A versioned prompt saved under `phase-prompts/` |
| `PROMPT_GENERATED` → `IN_PROGRESS` | Executor reports starting with a start SHA |
| `IN_PROGRESS` → `IMPLEMENTATION_REPORTED` | On-disk report under `phase-reports/` with commands + exit codes |
| `IMPLEMENTATION_REPORTED` → `VERIFYING` | Plan Owner obtains the actual diff and re-runs the claimed checks where possible |
| `VERIFYING` → `VERIFIED` | Every acceptance criterion mapped to evidence; no unsatisfied hard constraint |
| `VERIFIED` → `ACCEPTED` | Required approvals (owner, where applicable) recorded in `DECISIONS.md` |
| any → `FAILED` | Evidence contradicts the report, or a hard constraint was violated |
| any → `BLOCKED` | A named prerequisite is missing (record it exactly) |

---

## Status table

| Phase | Title | Status | Depends on | Prompt rev | Impl. commit | Unresolved blockers | Next permitted action |
|---|---|---|---|---|---|---|---|
| `XR-P00` | Governance and evidence substrate | **PROMPT_GENERATED** | — | `r1` (`6b9cb59`) | — | **D-001 / D-006 owner approval** (branch protection + required-check set) and **D-022** (required-check contexts). Gate wiring (D-021) is pre-approved; `changelog:check` sequencing needs **D-020**. GitHub **admin access** is required for the settings change. | Executor runs `phase-prompts/XR-P00-r1-6b9cb59.md`; Plan Owner reviews via `REVIEW PHASE REPORT XR-P00` |
| `XR-P01` | Engine contract, readiness, recovery truth | `PLANNED` | P00 | — | — | — | waits on P00 `ACCEPTED` |
| `XR-P02` | Onboarding state machine + consent | `PLANNED` | P01 | — | — | **D-004** (owner-authored privacy/terms text); consent sub-task will be `BLOCKED` until supplied | waits on P01 |
| `XR-P03` | Provider single source of truth | `PLANNED` | P01 | — | — | D-011, D-012 approved | waits on P01 |
| `XR-P04` | Truthful runtime data | `PLANNED` | P03 | — | — | — | waits on P03 |
| `XR-P05` | Permission and capability surface | `PLANNED` | P03, P04 | — | — | — | waits on P04 |
| `XR-P06` | Artifact records and safe UX | `PLANNED` | P04, P05 | — | — | D-015, D-016 approved | waits on P05 |
| `XR-P07` | Automations surface | `PLANNED` | P06 | — | — | — | waits on P06 |
| `XR-P08` | Documentation and claims integrity | `PLANNED` (parallel-eligible) | P00 | — | — | — | may be requested after P00 `ACCEPTED` with owner authorization |
| `XR-P09` | Release evidence and platform gates | `PLANNED` | P01–P08 | — | — | Two red CI lanes with **unknown** cause (`E-14`/`E-15`); owner signing material absent (`D-003`, `D-019`) | final gate |

**`XR-P00` prompt generated (r1). No phase has been executed. Baseline is audit-only.**

---

## Evidence obligations that outlive their phase

These must stay satisfied until `XR-P09` closes; if evidence is lost, the related phase
reverts from `ACCEPTED` to `VERIFYING`.

| Obligation | Established by | Re-verify at |
|---|---|---|
| Linux parity suite green at `6b9cb599`: 5,119 pass / 0 fail / 41 skip / 473 files (`E-12`) | Audit baseline | Every phase exit, and at the candidate tag |
| Root + desktop typecheck green (`E-11`) | Audit baseline | Every phase exit |
| Production bundle contains zero seed probes (`E-09`) | Audit baseline | `XR-P04`, `XR-P09` |
| 26 providers served live (`E-06`) | Audit baseline | `XR-P03`, `XR-P09` |
| `main` protection enabled with required checks (`D-001`) | `XR-P00` | `XR-P09` (must still be on at the tag) |
| Two native CI lanes green at the candidate SHA (`E-14` currently red) | `XR-P09` | tag time |

---

## Deliberately empty sections (no fabrication)

- **Assigned executors:** none. Execution agents are assigned per phase at prompt
  generation time; the identity is recorded in the prompt file and copied here.
- **Implementation commits:** none. No phase has run.
- **Verification evidence:** none for phases; only baseline audit evidence exists and is
  recorded in `EVIDENCE_LOG.md`.

---

## Blocked-and-must-not-be-proceeded-with

| Item | Why | What unblocks |
|---|---|---|
| `XR-P00` execution | Requires GitHub admin to change protection settings, and D-001/D-006 approval | Owner approval + admin access |
| `XR-P00` changelog step | `bun run ci` is red at HEAD on `changelog:check` (`E-27`); fixing it writes a changelog entry for an unpublished identity | D-020 decision |
| `XR-P02` consent sub-task | No privacy/terms document exists (`D-004`) | Owner supplies or approves the document |
| `XR-P09` signing/provenance | No Apple/Windows certificates, no updater keys | Owner material |
| Any platform claim for Windows/macOS | No native evidence at any commit | Native lane green at candidate SHA |
| `XR-P09` final acceptance | Two red native lanes with unknown cause | Diagnosis on the real runners (`E-15` limit lifted) |

---

## Prompt register

| Phase | Rev | File | Baseline SHA | Plan rev | Generated | Status |
|---|---|---|---|---|---|---|
| `XR-P00` | r1 | `phase-prompts/XR-P00-r1-6b9cb59.md` | `6b9cb59` | R1 | 2026-11-01 | issued, awaiting execution |
