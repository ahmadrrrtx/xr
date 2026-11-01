# XR v1 — Phase Ledger (compact index)

**Plan revision:** R1 · **Baseline:** `6b9cb599` · **Updated:** 2026-11-01
One line per phase. Full detail lives in `MASTER_PLAN.md` §F; state lives in
`PHASE_STATUS.md`; the authoritative sequence is below.

```
  #   PHASE    TITLE                                     DEPENDS      STATUS      BLOCKING RATIONALE
 ─────────────────────────────────────────────────────────────────────────────────────────────────
  1   XR-P00   Governance & evidence substrate           —            PROMPT r1   ◀ CURRENT (awaiting execution)
  2   XR-P01   Engine contract, readiness, recovery      P00          PLANNED
  3   XR-P02   Onboarding state machine + consent        P01          PLANNED     D-004 owner text
  4   XR-P03   Provider single source of truth           P01          PLANNED
  5   XR-P04   Truthful runtime data                     P03          PLANNED
  6   XR-P05   Permission & capability surface           P03,P04      PLANNED
  7   XR-P06   Artifact records + safe UX                P04,P05      PLANNED
  8   XR-P07   Automations surface                       P06          PLANNED
  ∥   XR-P08   Docs & claims integrity  (parallel)       P00          PLANNED     owner auth to parallelize
  9   XR-P09   Release evidence & platform gates         P01–P08      PLANNED     red CI lanes, owner material
```

## Completed
_none_

## Current
**`XR-P00` — PROMPT_GENERATED (r1).** No prerequisite phases. Prompt is at
`phase-prompts/XR-P00-r1-6b9cb59.md`. Execution requires owner approval of D-001/D-006/D-022
and GitHub **admin** access for the protection change; the in-repo parts (gate wiring,
precedence, gate-inventory test) can proceed without admin and will be reported as such.

## Blocked
| Phase | Blocker | Owner action needed |
|---|---|---|
| `XR-P00` | GitHub admin + approval to enable branch protection | Approve D-001/D-006; grant admin or execute the setting change |
| `XR-P02` (partial) | No privacy/terms document exists | Supply or approve D-004 content |
| `XR-P09` (partial) | No signing material; two red native lanes | Provide certificates/keys; allow runner log access |

## Next eligible action
```
REVIEW PHASE REPORT XR-P00        (after the executor submits its report)
```
`XR-P08` may be requested in parallel once `XR-P00` is ACCEPTED (owner authorization).

## Dependency reminders
- Serial by default. The **only** sanctioned parallel pair is `XR-P08 ∥ XR-P01`…`XR-P07`,
  and only with explicit owner authorization (disjoint ownership: `docs/` + one gate
  script vs. runtime code).
- `XR-P02 ∥ XR-P03` is **not** sanctioned (both touch `StepModelSetup.tsx` and the
  settings store).
- No prompt may be generated for a phase whose prerequisites are not `ACCEPTED`.
- `XR-P09` measures the final tree; nothing runs in parallel with it.
