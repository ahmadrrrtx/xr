# XR v1 — Phase Status

**Durable state table.** This file is the only authority on phase eligibility.
It is updated **after** evidence review, never on an executor's self-report.

**Plan revision:** R1 · **Baseline commit:** `6b9cb599aebbe8d8de8b100370c3a6434c3240e0` ·
**Last updated:** 2026-11-02

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
| `XR-P00` | Governance and evidence substrate | **ACCEPTED** | — | `r2` (`6b9cb59`) | `518c9835` + `4e9ec9e8` + `761df3df` (branch `phase/P00-governance-substrate`, **PR #206**, Quality Gate **green** on hosted CI at `761df3df` — see supplement 01) | **§4.1 BLOCKED — OWNER ACTION:** PATCH ruleset `19119579` (exact payload in `phase-reports/XR-P00-report-r2.md` §16; needs repo admin + D-001/D-022 approval). **D-020 BLOCKED — OWNER DECISION:** `changelog:check` still exits 1; generated entry preview rejected under the executor stop rule (432 lines since `v1.0.0`, see report §5/`E-34`). | Plan Owner: `REVIEW PHASE REPORT XR-P00`. **Repo half independently verified 2026-11-02 (`E-36`):** 3/3 new test pass, both negative tests fire, 4 gates wired at `ci.yml:158-165` (EXIT 0), zero product files, parity 5122/0/41 over 474 files. **AC1/AC2/AC4 remain BLOCKED-OWNER**; `E-37` now shows PR #206 merged with **0 reviews** — the governance gap is observed, not asserted. Executor's report was accurate; no overclaiming found. **Plan Owner ruling 2026-11-02: `VERIFIED` — IN-REPO HALF** (`D-024`, `E-44`). AC1/AC2/AC4 remain owner-blocked and are carried as obligations, **not** absorbed by acceptance; AC5 = FAIL-environmental (OOM). No §7 hard constraint violated. **Owner actions partially discharged 2026-11-02 (`D-025`, `E-45`):** ruleset required-checks de-duplicated and widened to 4 distinct green aggregates, proven by rejected push + blocked merge. AC1 is **PASS on the enforcement half, OPEN on the review half** — approvals/code-owner held at 0/false because a second reviewer does not exist (`E-46`). AC4 now **OPEN — SCHEDULED**: D-020 resolved as Option A gated on the `previousTagFor` prerelease fix (`D-026`), assigned to `XR-P08`; `changelog:check` stays EXIT 1 until then. |
| `XR-P01` | Engine contract, readiness, recovery truth | `READY` | P00 `VERIFIED` | `r1` (`4adcec2`) | — | **`MASTER_PLAN` §P01.5 superseded by prompt §0** (`E-38`): the open `/api/v1/health` cannot carry identity fields (pinned by `origin-host-guard.test.ts:169-171`); the handshake moves to the session-gated `/api/v1/meta/version`. `changelog:check` EXIT 1 (D-020) means `bun run ci` is not a usable phase gate. | **ELIGIBLE TO START — in-repo half only** (`D-024.1` §2). Executor may begin §4 at `4adcec2`. No governance, settings or release-identity action is authorized. |
| `XR-P02` | Onboarding state machine + consent | `PLANNED` | P01 | — | — | **D-004** (owner-authored privacy/terms text); consent sub-task will be `BLOCKED` until supplied | waits on P01 |
| `XR-P03` | Provider single source of truth | `PLANNED` | P01 | — | — | D-011, D-012 approved | waits on P01 |
| `XR-P04` | Truthful runtime data | `PLANNED` | P03 | — | — | — | waits on P03 |
| `XR-P05` | Permission and capability surface | `PLANNED` | P03, P04 | — | — | — | waits on P04 |
| `XR-P06` | Artifact records and safe UX | `PLANNED` | P04, P05 | — | — | D-015, D-016 approved | waits on P05 |
| `XR-P07` | Automations surface | `PLANNED` | P06 | — | — | — | waits on P06 |
| `XR-P08` | Documentation and claims integrity | `PLANNED` (parallel-eligible) | P00 `ACCEPTED` | — | — | **Carries `D-026`:** fix `previousTagFor` prerelease mis-range (2 lines + 1 test), regenerate `CHANGELOG.md`, wire `changelog:check`, delete its `GATE_EXEMPTIONS` entry. | **eligible now** — P00 `ACCEPTED` 2026-11-02 |
| `XR-P09` | Release evidence and platform gates | `PLANNED` | P01–P08 | — | — | Two red CI lanes with **unknown** cause (`E-14`/`E-15`); owner signing material absent (`D-003`, `D-019`) | final gate |

**`XR-P00` r2 executed 2026-11-01; status `IMPLEMENTATION_REPORTED` only (unreviewed; PR #206 open, not merged). In-repo half done; §4.1 and D-020 blocked on owner as above. See `phase-reports/XR-P00-report-r2.md`.**

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
| `main` ruleset deepened: aggregate gates required (**DONE 2026-11-02**, 4 contexts, `E-45`); ≥1 approval + code-owner review **BLOCKED on adding a second reviewer** (`D-025`, `E-46`) | `XR-P00` / `D-025` | `XR-P09` (must still be in force at the tag) |
| Add `Cross-Platform gate` + `Desktop gate` to ruleset `19119579` required checks **once green** — **Owner: `@ahmadrrrtx`** (repo admin); recorded **2026-11-01** by `XR-P00` executor; deliberately NOT required now (red at `6b9cb599` `E-14`; at `230ad998` Cross-Platform green once, Desktop/Journey cancelled — not green evidence) (`D-006`, `D-022`) | `XR-P00` (deferred, `E-34`) | `XR-P09` must add them before acceptance |
| `/api/health` and `/api/v1/health` keep returning exactly `{ok, ts}`; no identity/fingerprint field is added to any unauthenticated path (`E-38`; pinned by `test/daemon/origin-host-guard.test.ts:169-171`) | `XR-P01` §0 / `P01-AC2` | Every phase that touches `system.routes.ts`, `meta.routes.ts` or the `server.ts` open-path list |
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
| `XR-P00` §4.1 | Requires GitHub **admin** to apply the ruleset change to 19119579, and owner approval of D-001/D-022. Executor had no GitHub credentials; exact copy-pasteable payload is in the phase report §16 (`E-34`) | Owner applies payload, then AC1/AC2 verification (rulesets read + rejected push + blocked merge, D-023) can be recorded |
| `XR-P00` changelog step | `bun run ci` is red at HEAD on `changelog:check` (`E-27`); D-020a generated entry preview is 432 lines ranging `v1.0.0..HEAD` (247 commits already under `## 1.1.0`) because `previousTagFor("1.1.1-rc.1")` mis-ranges prereleases — executor stopped per prompt §4.2 (`E-34`) | Owner D-020 decision: fix/accept generated range then generate + wire + delete test exemption, **or** approve D-020b re-scope (incl. `AGENTS.md`) |
| `XR-P02` consent sub-task | No privacy/terms document exists (`D-004`) | Owner supplies or approves the document |
| `XR-P09` signing/provenance | No Apple/Windows certificates, no updater keys | Owner material |
| Any platform claim for Windows/macOS | No native evidence at any commit | Native lane green at candidate SHA |
| `XR-P09` final acceptance | Two red native lanes with unknown cause | Diagnosis on the real runners (`E-15` limit lifted) |

---

## Prompt register

| Phase | Rev | File | Baseline SHA | Plan rev | Generated | Status |
|---|---|---|---|---|---|---|
| `XR-P00` | r1 | `phase-prompts/XR-P00-r1-6b9cb59.md` | `6b9cb59` | R1 | 2026-11-01 | **SUPERSEDED by r2** (r1 assumed `main` was unprotected — wrong, see `E-32`) |
| `XR-P00` | r2 | `phase-prompts/XR-P00-r2-6b9cb59.md` | `6b9cb59` | R1 | 2026-11-01 | **CURRENT** — executed 2026-11-01 from `230ad998`; `IMPLEMENTATION_REPORTED`, awaiting Plan Owner review |
| `XR-P01` | r1 | `phase-prompts/XR-P01-r1-4adcec2.md` | `4adcec2` | R1 | 2026-11-02 | **CURRENT** — P00 `VERIFIED` 2026-11-02 → `READY`; eligible to execute the in-repo half. Supersedes `MASTER_PLAN` §P01.5 (see `E-38` / `D-024`) |
