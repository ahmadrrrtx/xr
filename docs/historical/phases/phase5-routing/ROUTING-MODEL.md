# Routing Model (Phase 5)

**Scope:** `src/intelligence/` — the single routing authority. This document
describes the routing model as it exists after Phase 5; it does not replace
ADR 0012 (the *why*).

---

## 1. One authority, one pipeline

Every routing decision — agent loop, CLI, daemon, future surfaces — passes
through `IntelligenceRouter.route()`. Provider construction for execution
passes through `IntelligenceService.resolveProvider()`.

```
RouteRequest
   │
   ▼
resolveRequirements ─ difficulty estimate (difficulty.ts)
   │
   ▼
filter (evaluator.ts)          ← hard gates, fail-closed
   │   locality · credentials · disabled · model class
   │   capability declarations · user pin/restriction
   │   capability extensions (fail closed when undeclared)
   │   measured-fidelity floor   [Phase 5]
   │   circuit-open (health)     [Phase 5]  (pins skip these two — §9.5)
   ▼
score (scorer.ts)              ← soft preferences, weighted
   │   taskFit 1.2 · quality 1.0 · latency 0.7 · cost 0.9
   │   locality 0.8 · preference 1.1 · historical 0.6 · availability 0.5
   │   measured fidelity overrides the static quality prior      [Phase 5]
   │   rolling-health availability adjusts the availability term [Phase 5]
   ▼
select → diversity-first fallback chain (fallback.ts) [Phase 5]
   ▼
RoutingDecision + RoutingDecisionRecord (explainable, persisted)
   ▼
IntelligenceService.resolveProvider()
   └─► ResilientProvider (degradation.ts) executes the chain at runtime
```

## 2. The decision record

`RoutingDecision` carries: selected target, fallback chain (diversity-
annotated), rejected candidates with coded reasons, explanation, factors,
confidence, `manual`, `unavailable`, `difficulty` (score, label, signals),
and `constraints` (the effective policy). `RoutingDecisionRecord` is the
compact persisted form, now including `difficultyScore`.

Rejection codes added in Phase 5: `user_restriction`,
`fidelity_below_floor`, `health_unavailable` (`"circuit open"`).

## 3. Modes

| Mode | How it arises |
|---|---|
| `automatic` | default (hybrid strategy) |
| `manual` | explicit pin (`requirements.pin`, CLI `--provider/--model`) |
| `preferred_with_fallback` | `intelligencePlane.enableAutomatic: false` — workspace default provider is preferred; no roaming |
| `local_only` / `private_only` / `no_cloud` | locality lattice deals in/out providers |

Manual override modes (complete, all explainable):

- **pin** — selects the pinned model; capability *declarations* and the
  measured-fidelity floor are bypassed *for the pin* (the user outranks
  possibly-stale metadata) with overridden declarations surfaced as factor
  warnings; locality/credentials are **never** bypassed.
- **restrict** — `requirements.restrictProviders` limits eligibility;
  everyone else is rejected naming `user_restriction`.
- **difficulty hint** — request-level `difficulty` overrides the estimate.
- **config** — `difficultyRouting: false`, or `minOverallFidelity` pins the
  floor globally.

## 4. Configuration surface (`CONFIG_VERSION 18`)

`intelligencePlane` (all defaults governor-tuned; migration 17→18 fills
them):

```jsonc
{
  "difficultyRouting": true,          // derive fidelity floor from difficulty
  "minOverallFidelity": null,         // pin the floor (wins over difficulty)
  "breaker": { "windowSize": 32, "minSamples": 4,
               "errorRateThreshold": 0.5, "qualityRateThreshold": 0.6,
               "cooldownMs": 30000, "cooldownMaxMs": 300000,
               "jitterRatio": 0.2 },
  "retry":   { "maxInPlaceRetries": 1, "baseDelayMs": 250,
               "maxDelayMs": 4000, "totalBudgetMs": 8000,
               "jitterRatio": 0.3 }
}
```

## 5. Extending the model

- **A new provider** = an adapter + capability declarations. Nothing in
  `src/intelligence/` is provider-specific; locality derives from the
  registered preset's `kind`. (Prove it: `model-class-contract.test.ts`
  adds a synthetic provider and routes to it with zero core edits.)
- **A future model class / capability** = declare an *extension capability*
  on the descriptor and require it via
  `TaskRequirements.require.extensions` — unknown fails closed, no kernel
  or loop edits (Art. VII.4).
- **New rejection/level semantics** = extend evaluator/types — the same
  choke point then enforces them everywhere.

## 6. Performance

Route selection is sync, allocation-bounded, and measured at the choke
point; budget **p95 < 20 ms** (perf gate + `routing-slo.test.ts` live
300-decision check). Behavioral probes, health persistence, and SLO
flushes never run inside `route()`.
