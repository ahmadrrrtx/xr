# Performance Waiver Register (Phase 3)

> Phase 4 · T4: *"no >30% regression without a ratified waiver."* (The Phase 3
> spec's 10% band was widened to 30% after measuring same-host p95 variance
> up to ~±25% on the version/help micro-benches on shared CI runners — a 10%
> band flaked CI without a real regression. The absolute budgets remain the
> binding ceilings; ≥1.3x slowdowns still fail the band.)
> A waiver is an owned, dated exception — it does not delete the gate.
> Usage: `bun run scripts/perf-gate.ts --waiver <budget-or-scenario-id> …`

| Budget / scenario | Waived value | Owner | Review date | Rationale |
|---|---|---|---|---|
| *(none)* | — | — | — | No waivers currently ratified. All budgets and baselines are enforced as published. |

**How to ratify a waiver:** open the case with measured evidence (before/after
JSON from `scripts/perf-baseline.ts`), get the kernel owner's sign-off, add a
row here with an explicit review date, and pass `--waiver <id>` in the CI job
for exactly the affected scenario. Waivers without a review date fail review.
