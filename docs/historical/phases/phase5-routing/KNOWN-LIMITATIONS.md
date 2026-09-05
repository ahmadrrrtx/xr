# Known Limitations — Phase 5 Routing Quality

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Honest edges of the mechanisms shipped in Phase 5. None of these are
silent: each points at the test or doc that pins the current behavior.

---

## 1. Circuit breakers are per-process

`RoutingHealth` learns inside one process (agent run, daemon). The
rolling window persists to `health.json`, so state survives restarts of a
same-workspace process — but two daemons on one host learn independently.
A shared store (multi-writer safe) is Phase 6+ work; the file format
already versions itself for that migration.

## 2. Behavioral probes are bounded, not comprehensive

Seven probes per model measure *probe-worthy* behaviors (structured
output, tool use, benign-refusal, retention). They are not a benchmark and
do not estimate answer quality on real tasks. Borderline contracts carry
low `confidence`; routing blends, it does not pretend precision.
Probes cost paid tokens on cloud adapters (CLI warns), and measure at a
point in time — models change; re-run `xr providers measure` after
upgrades.

## 3. CPR measures transport of context, not comprehension

The 0.95 target and the anchor-based ratio verify that history *reaches*
the fallback intact (History-Forwarding per ContinuityBench, measured
1.0 in acceptance tests vs a ≤1/3 stateless control). They cannot measure
whether the fallback model *uses* that context well — the residual
failure class the same research identifies. Semantic-tier errors and the
quality breaker leg are the mitigation in place.

## 4. Retry budgets are per-call, not per-task

`totalBudgetMs` caps one `chat()` invocation's in-place retries. A task
making many calls budgets each independently (task-level budget governance
remains the Phase-3 envelope's job).

## 5. The daemon SLO route reads persisted state

`GET /api/providers/slo` reconstructs from the JSONL/store files (daemon
routes are stateless), so it reflects the *workspace's* recent history
rather than the live agent process's in-memory tail; the newest
un-flushed events (bounded by the flush interval) appear after flush.

## 6. Provider-level capability overrides are UX/catalog-scoped

`providerCapabilities.<id>` (provider-wide) tunes catalog display and
default declarations; the decision path consumes **per-model**
declarations (`providerCapabilities.<id>.models.<model>`) plus extension
records. A seeded *model-level* declaration is honored by routing (and is
exactly what a manual pin can override, with the override surfaced as a
factor). This split is deliberate — declarations describe models, not
vendors.

## 7. Difficulty estimation is a heuristic floor, not a classifier

The estimator is deterministic and explainable (its signals are listed in
every decision's factors), and it only *gates measured fidelity*.
Operators retain three overrides: request `difficulty`, config
`minOverallFidelity`, config `difficultyRouting: false`. A learned
estimator remains research; the default must stay explainable (§9.2).

## 8. Half-open probes consume one real request

Recovery probing lets a single live call through an open breaker; if the
provider is still down, that one call experiences the failure before the
breaker re-opens with backoff. This is the standard hysteresis cost; the
probe is recorded like any other outcome.

## 9. SLO windows

Selection indicators aggregate a rolling 24 h in-memory window; the JSONL
keeps 500 lines/process. Long-window analytics are out of scope (export
the file if needed; it is a stable line format).
