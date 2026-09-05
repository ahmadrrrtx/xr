# Fallback & Degradation Playbook (Phase 5)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


What happens when a selected provider misbehaves at runtime — mechanically,
in order, with the knobs and the evidence.

---

## 1. The machinery

`IntelligenceService.resolveProvider()` returns a `ResilientProvider`
wrapping the selected provider plus the decision's fallback chain
(`src/intelligence/degradation.ts`). Every agent turn then flows:

```
chat()
 ├─ target = selected (L0_full), then chain steps in order
 ├─ per target:
 │    ├─ localityGuard(target) — refuse hop (recorded) if policy forbids
 │    ├─ health.permit(target) — deny_open ⇒ skip (recorded, never called);
 │    │                          probe ⇒ half-open probe attempt
 │    ├─ attempt chat()
 │    │    ├─ success → health sample, probe resolve, outcome → metrics,
 │    │    │            cpq SLO, RETURN turn
 │    │    └─ failure → classify (transient | permanent | semantic)
 │    │         ├─ transient → in-place retry within retry budget
 │    │         │             (jittered backoff, total time cap)
 │    │         ├─ permanent → NO retry
 │    │         └─ semantic  → NO retry; recorded as quality failure
 │    │                       (feeds the quality leg of the breaker)
 │    └─ exhausted target → next chain step (failover)
 ├─ chain exhausted → RoutingEscalationError + EscalationPackage (L3)
 └─ NEVER silent: every hop logs a visible notice AND an SLO event
```

## 2. Error classification (three tiers)

| Class | Examples | Response |
|---|---|---|
| `transient` | connection reset, timeout, 429, 5xx | retry in place (budget-bounded), then failover |
| `permanent` | 401/403, invalid model, malformed request | failover immediately — retrying can't help |
| `semantic` | empty/invalid turn, junk tool call | failover; counted as **quality** failure |

`RoutingHealth` trips the breaker when either leg crosses threshold in the
rolling window: `errorRate ≥ 0.5` **or** `qualityFailRate ≥ 0.6` (min 4
samples, window 32). Both legs matter: a provider that answers but answers
garbage is as ineligible as one that times out.

## 3. Diversity-first chains

`buildFallbackChain()` orders steps cross-provider before same-provider
(new model), and each step's reason says which it is
(`· cross-provider` / `· same-provider distinct model`). Rationale
(research note R3): the most common real outage is provider-scoped — a
same-provider fallback dies with the primary. Breaker-open steps are
excluded at chain-build time *and* rechecked at execution time.

## 4. Degradation levels (explicit, monotone)

| Level | Meaning | How assigned |
|---|---|---|
| `L0_full` | the selected target | — |
| `L1_equivalent_fallback` | measured fidelity within 0.1 of selected (or same/higher static class) | measured-first |
| `L2_reduced_fallback` | everything else | honest capability drop |
| `L3_escalation` | chain exhausted | human takes over |

The level reached is on the `ResilientProvider` (`degradationLevel`), on
each SLO fallback event, and in the escalation package.

## 5. Retry policy (per workspace config)

`intelligencePlane.retry`: `maxInPlaceRetries: 1`, `baseDelayMs: 250`,
`maxDelayMs: 4000`, `totalBudgetMs: 8000`, `jitterRatio: 0.3`. Retry never
exceeds the total budget; jitter decorrelates concurrent tenants; delays
cap at `maxDelayMs`.

## 6. Escalation

`RoutingEscalationError.escalation` (`EscalationPackage`):

- `attempts` — per target: outcome (`succeeded | failed | skipped`),
  class/reason, duration;
- `contextManifest` — message count, roles, payload SHA-256, anchor
  coverage, CPR of the conversation that *would* have been preserved;
- `healthSnapshot` — gates at escalation time;
- `decisionId` — join with the recorded decision;
- **secrets redacted** (`sk-…`/bearer tokens → `[redacted]` — tested).

Surface it to the user, do not retry the same chain blindly; the breaker
will half-open-probe recovery on its own schedule.

## 7. Observability map

| Signal | Where |
|---|---|
| failover notice (human) | stderr warning at hop time |
| fallback SLO (trigger, level, CPR) | `$XR_HOME/cache/intelligence/routing-slo.jsonl` |
| breaker trip SLO | same stream, `kind: "breaker"` |
| degradation SLO | same stream, `kind: "degradation"` |
| live gates | `xr providers slo` (breaker table) |
| outcomes → future routing | `IntelligenceMetrics.statsFor()` (confidence-gated) |

## 8. Operator checklist

1. Provider flapping? `xr providers slo` → breaker table, trip reasons.
2. Sudden quality drop (semantic class)? outcomes feed routing; consider
   `xr providers measure --provider P` to refresh the behavioral contract.
3. Frequent L2 hops? inspect preference/capability declarations — the
   chain is following the decision record, which explains itself.
4. Everything exhausted? that's L3 with an escalation package — act on the
   package; the system chose honesty over a plausible-sounding answer.
