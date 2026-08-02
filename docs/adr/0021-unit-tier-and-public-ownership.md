# ADR-0021 — The unit tier as the contributor inner loop, ownership made public

- **Status:** accepted (Phase 8 · T5)
- **Owner:** dx tooling · **Review:** 2026-08-03

## Context
The full suite runs thousands of tests and full CI runs over a dozen jobs —
correct for merging, wrong for the save-loop of someone making their first
PR. Slow loops teach contributors to stop running tests. Separately,
`CODEOWNERS` encoded accountability in glob syntax nobody reads, and "who
owns the daemon?" had no public answer.

## Decision
1. **Curated unit tier** (`scripts/unit-tier.ts`): 19 files covering the
   gates a first PR can actually break — architecture boundaries, API
   contract, phase-0 trust gates, core semantics, dashboard/a11y/UX statics —
   executed by `bun run unit-tier` in one hermetic invocation.
2. **Hard 5-second budget, measured**: the script gates wall time
   (default 5000 ms; measured ~1370 ms on a 2026 dev laptop, ~2.5× headroom
   for slower CI silicon). Over-budget fails with the instruction to move
   slow tests OUT of the tier — raising the budget is not the fix.
3. **Curation is governed**: `test/architecture/unit-tier.test.ts` requires
   every manifest file to exist, forbids browsers/installers/golden-path
   subprocesses and container builds inside the tier, and requires coverage
   of architecture/API/trust/UX groups, with ≥15 entries so it cannot quietly
   shrink to a token check.
4. **Public ownership map**: `docs/OWNERSHIP.md` is generated from
   `CODEOWNERS` (`scripts/ownership-map.ts`); its `--check` runs in CI and in
   `bun run ci`, so the public answer to "who owns this" can never drift from
   the review-routing truth. Phase-8 accountable boundaries (observability
   plane, API contract, a11y/UX gates) gained EXPLICIT owner entries.
5. **First-day path**: CONTRIBUTING.md's quickstart now names the tier
   explicitly (`bun run unit-tier` in the inner loop; `bun run ci` before
   pushing), keeping the <1-day first-PR target reachable.

## Consequences
- Contributors get a sub-2-second truth loop; nothing in the tier needs
  network, browsers, or installers.
- Ownership is discoverable: 142 areas resolve to an accountable owner, CI
  fails on drift or an unowned top-level directory.
- The DX gates are themselves CI-gated (`unit-tier` job in ci.yml), so DX
  cannot rot silently (a DX gate nobody runs is decoration).

## Tests
`test/architecture/unit-tier.test.ts` (6), `test/architecture/ownership.test.ts`
(6); CI job `unit-tier` (ownership `--check` + measured budget gate).
