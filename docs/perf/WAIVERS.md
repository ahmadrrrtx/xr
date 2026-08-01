# Performance Waiver Register (Phase 3)

> Part 19 of the Phase 3 spec: *"no >10% regression without a ratified waiver."*
> A waiver is an owned, dated exception — it does not delete the gate.
> Usage: `bun run scripts/perf-gate.ts --waiver <budget-or-scenario-id> …`

| Budget / scenario | Waived value | Owner | Review date | Rationale |
|---|---|---|---|---|
| *(none)* | — | — | — | No waivers currently ratified. All budgets and baselines are enforced as published. |

**How to ratify a waiver:** open the case with measured evidence (before/after
JSON from `scripts/perf-baseline.ts`), get the kernel owner's sign-off, add a
row here with an explicit review date, and pass `--waiver <id>` in the CI job
for exactly the affected scenario. Waivers without a review date fail review.
