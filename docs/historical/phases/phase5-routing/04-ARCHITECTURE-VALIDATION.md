# Phase 5 — STEP 4 · Architecture Validation (before code)

**Method:** every design element passes the ADR Decision Rules (Constitution Part Five) and the Phase 5 validators: no second router, no provider-specific loop logic, no weakened locality, no permanent provider dependency, no behavioral evaluation on the hot path, no masked fallback, no net-new feature surface.

## Design overview

All routing-quality code lands in **the one routing home: `src/intelligence/`** (L1 provider/model plane, §2.2). No new top-level module (Art. V). New files:

| File | Responsibility | Edits kernel/loop? |
|---|---|---|
| `src/intelligence/difficulty.ts` | Deterministic task-difficulty estimator (pure, inspectable signals) | no |
| `src/intelligence/behavioral.ts` | Behavioral contract types + persisted measured-metadata store + offline evaluator | no |
| `src/intelligence/health.ts` | Rolling health scores + circuit breaker (closed/open/half-open) + persisted snapshots | no |
| `src/intelligence/degradation.ts` | Three-tier error classification, retry budget + jittered backoff, degradation levels, escalation package, `ResilientProvider` (chain executor, context-preserving) | no |
| `src/intelligence/slo.ts` | Routing SLO collector (selection p50/p95, fallback rate, degradation rate, cost-per-quality, CPR), bounded JSONL sink | no |
| `src/intelligence/failover.ts` | Context-anchor manifest + CPR measure shared by runtime records and the harness | no |

Edits (minimal, additive): `types.ts` (difficulty/fidelity/restrict fields, extension capabilities, reason codes), `evaluator.ts` (restrict + fidelity-floor + breaker rejections, extension capabilities), `scorer.ts` (fidelity dimension from measured contracts; availability from rolling health), `router.ts` (honor `enableAutomatic`; difficulty injection; health-gate; explainability factors), `service.ts` (own stores; feed router; return `ResilientProvider`; wire `recordOutcome`), `fallback.ts` (diversity-first ordering; breaker filter), `routing-service.ts` (leave legacy path intact; shared diversity ordering), `config.ts` (additive `intelligencePlane` fields + migration 17→18), `commands/providers.ts` (`measure`, `slo`, richer `explain`), daemon providers routes (`/api/providers/slo`), `core/providers/intelligence.ts` (wire stores).

## Per-task validation

### T1 — Explainable automatic routing + override (G1, G7, G8)
- ADR-2 single-authority: ✅ decision logic stays in `router.ts`; difficulty is a pure input function, not a router.
- ADR-1 boundary: L1 intelligence plane. ✅ No duplicate home.
- Explainability: difficulty score + signals + fidelity source + health state join `decision.factors`/`explanation`; `considered`/`rejected` already structured.
- Override completeness: pin (exists) · preferred (exists) · local_only/private_only (exists) · **restrict-to-set** (new `restrictProviders`, evaluator code `user_restriction`) · `enableAutomatic:false` honored (preferred_with_fallback on defaults, no roaming).
- Rejected design: difficulty via model call (hot-path latency + provider dependence) — spec'd deterministic.
- Test: `routing-v5.test.ts`, `difficulty.test.ts`.

### T2 — Measured behavioral contracts (G2, G10)
- Hot-path rule: evaluator runs **offline/async only** (`xr providers measure` / operator call + tests). `route()` reads the persisted store (cached, TTL). Perf gate asserts decision p95 <20ms preserved. ✅
- Measured-not-claimed: contract fields { structuredOutputFidelity, toolUseFidelity, refusalRate/patterns, contextRetention, overallFidelity, samples, measuredAt, source:"measured" } derive **only** from probe outcomes validated against expected schemas/anchors. Cold start = static prior, explicitly labeled `source:"declared"` and never mixed with measured numbers.
- Scoring integration: `quality` dimension blends measured fidelities weighted by requirements; absent contract → existing static class as prior, note says `prior`.
- Capability-gate: `TaskRequirements.minFidelity` (difficulty-implied or explicit) rejects measured contracts below floor — code `fidelity_below_floor` (new rejection code; additive to union).
- Test: `behavioral.test.ts` (scripted providers: one high- one low-fidelity → measured contracts differ; cheapest-meets-floor selection).

### T3 — Rolling health + breaker + diverse fallback + degradation + escalation (G3, G4)
- One concern/one home: health lives in `health.ts`; the router consumes via a narrow `RoutingHealthView` interface (composition, Art. IV.5).
- Breaker semantics (R3): rolling window; trip on errorRate≥threshold with min samples **or** qualityFailureRate≥threshold; cooldown→half-open single probe→close on success/re-open on failure with jittered, capped backoff. While open: evaluator rejects `health_unavailable` (message names breaker), chain builder skips. Recorded to SLO.
- Diversity-first ordering: cross-provider steps before same-provider (stable); locality guard unchanged; both paths share one ordering function.
- Error classification: `classifyError` → transient (429/5xx/timeout/network) | permanent (auth/404/model-missing) | semantic (invalid_response/refusal/contract violation). Retry only transient, in-place, ≤ budget; permanent/semantic advance the chain (semantic additionally records quality failure → breaker input).
- Fallback never silent: every chain advance emits a visible notice (existing warn style) **and** a recorded event {decisionId, from, to, trigger, class, level}; exhaustion throws `RoutingEscalationError` with `EscalationPackage` — never fakes success (Art. IV.2/X.3; "masked fallback" validator).
- Retry budget: jittered exponential backoff, capped total attempts and total sleep; pure functions, seedable — test asserts bound.
- Escalation package: attempts+reasons+level+repair path; **redaction** of key/token patterns; test asserts no secret material.
- Test: `breaker.test.ts`, `fallback-v5.test.ts`.

### T4 — Failover context preservation (G5)
- Mechanism: `ResilientProvider` forwards the **complete** message list + tools on every chain advance (ContinuityBench History-Forwarding — the mechanism that measured 99.2% CPR vs ~0% stateless).
- Measurement: `failover.ts` computes a context-anchor manifest (canonical facts extracted from user/assistant turns of the *injected scripted corpus* and verified present in what the fallback receives). CPR = anchors received / anchors total; recorded to SLO. Harness also runs a **stateless control** (last-turn only) proving CPR≈0 so the harness is not vacuous.
- Fallback instruction-following fidelity: covered by behavioral `contextRetention` measurement (T2) — the ContinuityBench residual failure mode.
- Test: `failover-cpr.test.ts` (CPR ≥ 0.95 target on corpus; stateless control < 0.2).

### T5 — Locality invariant on all new paths (G—cross-cutting)
- Behavioral evaluator refuses to probe cloud providers when policy forbids (skipped, recorded — not silently run); store contains no secrets/prompts (probe ids + scores only).
- Every chain advance re-checks `localityAllowed` (defense in depth, mirrors RoutingService); breaker never re-enables a policy-forbidden provider; degradation never escalates locality silently (blocked steps surface in the escalation package).
- Test: `locality-v5.test.ts` extending the existing invariant suite to the new paths.

### T6 — Routing SLOs (G6)
- Collector is append-bounded JSONL (`cache/intelligence/routing-slo.jsonl`, 500-line cap like stream-metrics) + in-process window aggregation; selection latency recorded at `IntelligenceService.route()`.
- Report: selection count/p50/p95 vs 20ms budget, fallback rate, degradation rate, cost-per-quality (avgUsd, avgFidelity, usdPerFidelityPoint), CPR mean vs 0.95 target. Surfaces: `routingSlo.report()` API, `xr providers slo [--json]`, `GET /api/providers/slo` (same providers API surface, not a new one).
- Test: `routing-slo.test.ts` + perf gate unchanged.

### T7 — Future model classes + adapter-only providers (G9)
- `ModelCapabilities.extensions?: Record<string, CapabilitySupport>` + `TaskRequirements.require.extensions?: string[]` — a future class is declared through the contract; evaluator gates it (unknown fails closed), scorer boosts on match. Zero edits to `src/core/`, `agent-service.ts`, `agent.ts` to add a class.
- Provider-add remains: config `customProviders` entry → preset → descriptors (existing adapter path); test proves route + construct without registry/core edits.
- Test: `model-class-contract.test.ts` asserting (a) synthetic class routes, (b) the diff touches no kernel/loop file (guard via git pathspec).

### T8 — Single router + no vendor-claim assumptions in decision path
- Verification test asserts `src/providers/routing.ts` absent (already exists) + one authority documented.
- Decision path: quality=fidelity-measured-or-prior (labeled); capability tri-state stays a *declaration gate* (fail-closed unknown) while the *selection* value comes from measured fidelity; presets remain cold-start declarations, docs updated to call them declared-not-measured.
- Test: `behavioral.test.ts` (measured overrides static) + existing boundary/locality suites.

## Constitutional gate review (Part Thirteen checklist)

- [x] Boundary: one home (intelligence). [x] Single authority: one router. [x] Substrate-first: builds on verified Phase 2 authority. [x] Authority≠intelligence; fail-closed: breaker/fidelity gates deny by default; escalation is honest. [x] Local-first: locality invariant extended, test-locked. [x] One envelope: provider returned to the same envelope path. [x] Outcome measurable: CPR/SLOs/fallback-diversity metrics. [x] No unevidenced claims: docs link tests; claim-lint surfaces untouched by unsupported language. [x] Migrations reversible: config v18 additive with defaults; old configs parse unchanged (downgrade-safe: unknown fields tolerated). [x] Performance: hot path reads maps; evaluator offline. [x] Deletion budget: no new modules; dead config wired; doc of declared-vs-measured replaces an assumption. [x] Owner: routing plane = Intelligence Plane owner (CODEOWNERS). [x] ADR: 0012 added.

**Validation verdicts:** no element reintroduces a second router; no provider-specific branching in loop; locality strengthened; no permanent dependency (all stores provider-neutral keyed by id); behavioral evaluation strictly offline; failover never masked. **Plan validated → proceed to implementation.**
