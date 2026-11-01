# XR v1 Release Implementation Set

> **This directory is the authoritative implementation record for the XR v1
> release effort.** It was created by the Plan Owner after independently verifying
> the supplied external audit against the repository at
> `6b9cb599aebbe8d8de8b100370c3a6434c3240e0`.
>
> **Precedence (decision D-005):** for questions of *what to build next, in what order,
> with what evidence*, these documents win over every earlier planning document
> (`docs/IMPLEMENTATION-PLAN.md`, `docs/IMPLEMENTATION_PLAN.md`,
> `docs/implementation/*`, `docs/release/IMPLEMENTATION_PLAN.md`,
> `docs/release/V1-RELEASE-LEDGER-2026-10-28.md`). Those remain valid as history and
> must not be deleted. `AGENTS.md` and `docs/CONSTITUTION.md` still govern *how* work is
> done and are not superseded by anything here.

## Documents

| File | What it is | Read it when |
|---|---|---|
| [`MASTER_PLAN.md`](MASTER_PLAN.md) | Verified current state, target architecture, ten ordered phases with acceptance criteria, dependency graph, release gates, scope boundaries | Before anything else |
| [`AUDIT_VERIFICATION.md`](AUDIT_VERIFICATION.md) | Every supplied finding (`AUD-nnn`) with a verdict and evidence, plus twelve independently discovered defects (`XRD-nnn`) | When you need to know *whether* something is actually broken |
| [`EVIDENCE_LOG.md`](EVIDENCE_LOG.md) | Chronological record of every command run, its exit code, and every environment limitation | When you need the raw proof, or to know what was **not** verified |
| [`DECISIONS.md`](DECISIONS.md) | Dated decisions with options, reasoning, trade-offs and approval status | Before changing scope, ordering, architecture or governance |
| [`PHASE_STATUS.md`](PHASE_STATUS.md) | Durable per-phase state table + promotion rules + obligations that outlive phases | Before generating or accepting any phase |
| [`PHASE_LEDGER.md`](PHASE_LEDGER.md) | One-line-per-phase index, completed/current/blocked, next eligible action | For a 30-second status |
| `phase-prompts/` | Versioned, self-contained prompts for execution agents (**empty until requested**) | When issuing `GENERATE PHASE PROMPT <id>` |
| `phase-reports/` | Per-attempt executor reports, including failed and abandoned attempts | When issuing `REVIEW PHASE REPORT <id>` |

## Operating protocol (summary)

1. One phase at a time, one fresh execution agent per phase, one versioned prompt.
2. A phase prompt is generated **only** on the command `GENERATE PHASE PROMPT XR-Pnn`,
   and only when its prerequisites are `ACCEPTED`.
3. An executor never marks its own phase accepted. The Plan Owner reviews the **actual
   diff and test output**, then promotes `VERIFIED` → `ACCEPTED`.
4. A phase that fails gets a narrow `GENERATE FIX PROMPT XR-Pnn`; the failure stays on
   disk.
5. Nothing is silently rewritten: superseded documents and prompts are linked, not
   deleted.

## What is explicitly **not** true yet

- No product code has been changed by this planning work.
- No phase has been executed.
- Two CI lanes are **red** at the verified commit (`Cross-Platform CI` macOS parity,
  `Desktop App` Linux journey) with **unknown** cause.
- `main` has branch protection **disabled**.
- No Windows, macOS, audio, keychain or live-provider verification exists.
