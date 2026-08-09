# Routing SLOs (Phase 5)

Routing quality is observed as numbers. The collector (`src/intelligence/
slo.ts`, `RoutingSlo`) records at the single choke point every decision
passes through; the sink is a local JSONL file — **never sent anywhere**.

---

## 1. Sink

`$XR_HOME/cache/intelligence/routing-slo.jsonl` — append-only, bounded to
the newest 500 lines per process (memory and file stay consistent; no
double counting across reloads).

## 2. Events

| `kind` | When | Fields of note |
|---|---|---|
| `selection` | every `route()` (automatic, pin, unavailable) | `ms`, `mode`, `manual`, `unavailable` |
| `fallback` | each executed failover hop | `from`, `to`, `trigger`, `level`, `cpr?` |
| `breaker` | a circuit opens | `target`, `state`, `reason` |
| `degradation` | level reached rises | `level`, `reason` |
| `cpq` | a successful outcome with usage | `target`, `costUsd`, `fidelity` |

## 3. Reported indicators (`RoutingSlo.report()`)

| Indicator | Target | Lens |
|---|---|---|
| selection p50 / p95 ms | **p95 < 20 ms** | `SELECTION_BUDGET_MS = 20` |
| `selection.withinBudget` | true | p95 vs budget |
| manual rate, unavailable rate | observed | integrity of automatic routing |
| fallback total / rate per selection | observed | stability |
| fallbacks `byTrigger` | — | transient/permanent/semantic mix |
| fallbacks `byLevel` | prefer L1 | degradation posture |
| degradation events | observed | — |
| cost-per-quality | cost ÷ (fidelity·0.01) per 0.1pt | measured cost × measured fidelity |
| CPR mean | **≥ 0.95** | `CPR_TARGET = 0.95` |
| breaker trips | low | health stability |

Cold start is honest: zero selections report p50/p95 of 0 and
"within budget"; zero failover samples report CPR 1 with
`n=0 → no failover samples` — never implied compliance.

## 4. Where to read them

- CLI: `xr providers slo [--json]` — report + breaker table.
- Daemon: `GET /api/providers/slo` — `{ report, breakers, measuredContracts }`.
- File: the JSONL sink itself (events are one per line).

## 5. Relationship to the perf gate

The perf gate (`bun run perf:gate`) benches route selection against the
same 20 ms ceiling — that is the *budget guarantee on the code*. The SLO
stream is the *observed behavior on live decisions*. Both exist; neither
substitutes for the other. `routing-slo.test.ts` asserts the live observed
p95 over 300 real `route()` calls stays < 20 ms.

## 6. Privacy & cost

Events contain provider/model ids, timings, levels, and counts. No message
content, no prompts, no credentials. Fallback events carry CPR and anchor
*count* (not anchors). The file lives under the workspace cache and is
subject to the same locality rules as every other XR state.
