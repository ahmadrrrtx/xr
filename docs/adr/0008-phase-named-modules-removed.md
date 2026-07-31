# ADR 0008 — No phase-named modules: folding six directories into L0–L6 homes

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Top-level structure of `src/`
**Constitutional basis:** Art. V.1 (*"Modules map to the L0–L6 boundary table
(§2.2), not to roadmap phases"*), Art. V.4 (*"phases are not folders"*),
Art. V "Forbidden Practices" (*"Phase-named directories"*)

---

## Context

The Constitution's own rationale for Article V names this defect explicitly:

> *"XR's directory sprawl (baseline/, capabilities/, deployment/, environment/,
> evaluation/, trust/ layered on the core 37) is the structural signature of
> additive phase execution without refactoring."*

The audit confirmed all six were present, and `src/` had **47** top-level
entries against a seven-layer model.

## Decision

Each directory moves to its L0–L6 home. **Relocation, not deletion** — these are
*concerns*, not phases, and no capability is removed.

| From | To | Layer | Rationale |
|---|---|---|---|
| `src/trust/` | `src/runtime/trust/` | L0/L1 | authority + isolation primitives are runtime concerns |
| `src/capabilities/` | `src/platform/capabilities/` | L2 | capability descriptors are Platform (§2.2 L2) |
| `src/environment/` | `src/platform/environment/` | L2 | environment-interaction providers are Platform |
| `src/deployment/` | `src/enterprise/deployment/` | L6 | deployment profiles are Enterprise |
| `src/evaluation/` | `src/enterprise/evaluation/` | L6 | certification evidence is Enterprise |
| `src/baseline/` | `src/enterprise/baseline/` | L6 | evidence tooling is Enterprise |

`src/` top-level entries: **47 → 41**.

## How the moves were made safe

`scripts/phase2-move-module.ts` resolves every import specifier **to a real
path** before rewriting, then re-anchors the moved files' own relative imports
to their new depth. A specifier that merely *contains* a module name — or a
`../../x.ts` that resolves elsewhere — is never mangled. Typecheck was run after
every single move.

## The documentation-reference finding

The moves broke two tests, and that was the evidence discipline working:

- `test/enterprise/certification.test.ts` — *"EVERY REFERENCED SOURCE FILE
  ACTUALLY EXISTS"* caught `SC-05 → src/capabilities/types.ts`.
- `test/environment/adversarial.test.ts` — caught the changed import depth in
  the assertion that the environment service has no private execution path.

These are **claims about where a control is implemented**. A stale path is a
false claim (Art. IV.5), so the evidence catalogue, evaluation suite contracts
and metric definitions were all corrected. A test that fails when a claim goes
stale is exactly the mechanism Phase 0 installed.

## Enforcement

`test/architecture/boundaries.test.ts` asserts no phase-named top-level module
remains, and `.dependency-cruiser.cjs` bans importing any of the old paths
(`no-retired-modules`), so a stale import cannot silently reappear.

## Consequences

**Positive.** Structure now encodes architecture rather than roadmap history. A
new contributor reading `src/` sees layers. The boundary rules can be written
against real layers because the layers now exist as directories.

**Negative.** Large diff churn (~120 files touched) and internal import paths
changed. No public CLI/API path changed, so no user-facing surface broke. The
churn was concentrated in one commit, after the other retirements, precisely so
it would not fight them.

## Reversibility

Pure moves with the old→new map recorded above. Reverting is the same script run
in reverse.

## Removal schedule

| Item | Status |
|---|---|
| all six phase-named top-level modules | **removed** in Phase 2 |
| re-export shims | none were created — the moves were atomic, so no shim needs retiring |
