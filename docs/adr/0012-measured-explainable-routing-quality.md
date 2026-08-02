# ADR 0012 — Measured, Explainable Routing Quality (Phase 5)

**Status:** Ratified (Phase 5, 2026-08-02)
**Applies to:** Model/provider capability gating, health-driven failover,
fallback diversity, degradation levels, context preservation on failover,
and routing SLOs
**Constitutional basis:** Charter §9.2 (automatic routing must be
explainable), §9.5 (manual override is always available), §9.7 (failover
must preserve context), §9.8 (behavior measured, never vendor-claimed),
Art. III/VI (one routing authority, one provider plane), Art. IV (strict
typing, fail closed, no claims without evidence), Art. VII (provider-
agnosticism; future model classes enter through the contract)
**Builds on:** ADR 0004 (single routing authority) — the authority is
enriched, never duplicated

---

## Context

Phase 0–4 delivered a single routing authority with deterministic scoring,
a recorded decision, and locality enforcement. The Phase 5 audit
(`docs/phase5-routing/01-AUDIT-REPORT.md`) found ten gaps between that
substrate and the phase's routing-quality requirements. The ones that
shaped this ADR:

- **G2 — capability metadata was vendor-claimed.** Static presets declared
  capabilities (tool use, structured output, …) and scoring trusted those
  declarations as ground truth. `IntelligenceService.recordOutcome()`
  existed but was never called from the runtime, so no measured signal
  ever reached a decision.
- **G3 — no health memory.** Routing had no rolling view of provider
  reliability and no circuit breaker; an erroring provider was re-selected
  every turn.
- **G4 — fallback without discipline.** No diversity preference (a fallback
  could be the same provider with another label), no error classification,
  no retry budget, no defined degradation levels, escalation was a bare
  handoff string.
- **G5 — context preservation was asserted, not measured.** Mid-conversation
  failover forwarded the full history, but nothing measured how much context
  actually survived.
- **G6 — no routing SLOs.** The 20 ms selection budget was enforced by a
  perf-gate bench, not observed on live traffic.

## Decision

All five mechanisms live **inside the existing single authority**
(`IntelligenceRouter` / `RoutingService` / `IntelligenceService`). No second
router, no new public surface, no hot-path I/O.

### 1. Behavioral contracts are measured offline, then gate selection

`src/intelligence/behavioral.ts` — `BehavioralEvaluator` runs bounded
probes (structured output, tool use, false-refusal, context retention)
against a provider **offline** (`xr providers measure`, never from
`route()`), producing a `BehavioralContract` with `source: "measured"`.
Contracts persist to `$XR_HOME/cache/intelligence/behavioral.json`.

In the decision path (fail-closed): a **measured** contract below the
task's fidelity floor rejects the model with code `fidelity_below_floor`;
a measured fidelity **overrides** the static quality prior in scoring
(factor note *"measured fidelity X (n=N)"* vs *"quality from static prior
(unmeasured)"*). Unmeasured models route on static priors exactly as
before — cold start is never penalized.

**Unreachable is not zero.** A provider that returns no turn to *any* probe
is *unreachable*: the evaluator throws, `measureModels` records an honest
skip naming the transport failure, and **no contract is saved**. Conflating
transport failure with measured capability would publish a false
"measured 0.00" the gates would then enforce (Art. IV).

### 2. Rolling health + circuit breaker feed the authority

`src/intelligence/health.ts` — `RoutingHealth` keeps a rolling per-target
window (default 32 samples, min 4) and a three-state breaker
(closed → open → half-open) that trips on **error rate ≥ 0.5** *and* on
**quality-failure rate ≥ 0.6**, with jittered capped cooldown backoff
(30 s → 5 min). The evaluator rejects breaker-open targets with code
`health_unavailable` naming *"circuit open"*; scoring nudges away from
degrading targets before they trip. Pins skip the breaker (manual override
is complete, §9.5) — but security policy (locality, credentials) never is.
State persists to `$XR_HOME/cache/intelligence/health.json`.

### 3. Disciplined fallback with defined degradation levels

`src/intelligence/degradation.ts` — three-tier error classification
(transient / permanent / semantic), in-place retry for **transient only**
inside a total time budget with jittered backoff, and `ResilientProvider`
executing the decision's chain: each hop re-verifies locality (defense in
depth), skips breaker-open targets, prefers cross-provider diversity
(chain reasons name *"cross-provider"* vs *"same-provider distinct
model"*), and emits a visible failover notice **and** an SLO event —
fallback is never silent. Degradation is explicit and monotone:
`L0_full → L1_equivalent_fallback → L2_reduced_fallback → L3_escalation`.
Level assignment is measured-first (fallback fidelity within 0.1 of the
selected model ⇒ L1), static-class prior otherwise. Exhaustion throws
`RoutingEscalationError` carrying an `EscalationPackage` (redacted
context manifest, attempt log, health snapshot) for human review.

### 4. Context preservation is measured, with a target

`src/intelligence/failover.ts` — every failover hop serializes the full
conversation (History-Forwarding per ContinuityBench) and records a
context manifest: message count, payload SHA-256, anchor coverage, and a
per-hop CPR (context preservation ratio). `CPR_TARGET = 0.95`. Live
failover events carry CPR into the SLO stream; the acceptance test
measures **CPR = 1.0** on a 7-message-deep conversation failing at turn 4,
with a stateless control at **≤ 1/3** proving the measurement isn't
vacuous.

### 5. SLOs are recorded at the choke point

`src/intelligence/slo.ts` — `RoutingSlo` records selection latency
(p50/p95 against `SELECTION_BUDGET_MS = 20`), manual/unavailable rates,
fallback totals by trigger and level, breaker trips, cost-per-quality
(measured cost × measured fidelity), and CPR versus target — appended to
`$XR_HOME/cache/intelligence/routing-slo.jsonl` (bounded, local-only).
`xr providers slo` and `GET /api/providers/slo` render the same data.
Recording is best-effort and never blocks routing.

### 6. Task difficulty derives the fidelity floor

`src/intelligence/difficulty.ts` — a deterministic, explainable estimator
(signals enumerated in the decision factors) classifies work as
easy/standard/hard/frontier with floors 0.40/0.60/0.75/0.85. The floor
gates **measured** fidelity only. `intelligencePlane.difficultyRouting:
false` disables the floor; `minOverallFidelity` pins it; a request-level
`difficulty` hint overrides the estimate. All three are operator authority
over a heuristic — exactly the override posture §9.5 requires.

## What this ADR deliberately does NOT do

- **No learned router as default.** RouteLLM informs the vocabulary
  (cost-per-quality, capability-gated, difficulty) but the default router
  remains deterministic and explainable (Charter §9.2). A learned router
  may appear later as research, behind the same contract.
- **No behavioral evaluation on the hot path.** Probes are paid/slow and
  must stay operator-triggered.
- **No claims beyond measured data.** `xr` never reports "certified model
  quality"; it reports measured fidelity with sample counts and dates, or
  honestly reports unmeasured.
- **No duplicate authority.** Nothing in `src/providers/` selects models;
  ADR 0004 continues to hold, now tested at the service level too.

## Consequences

**Positive.** Selection explains itself (factors, difficulty, measured vs
static basis). Flapping providers isolate themselves and recover with
half-open probes. Failover preserves conversation context with a measured
budget. Operators see routing health as numbers, not vibes. The three
stores are local JSON/JSONL — no egress, no secrets (contracts carry
fidelities, never payloads; escalation packages redact).

**Costs.** ~1 620 LOC of new intelligence modules, six new stores' worth of
local files, and one CLI/docs surface each for `measure` and `slo`. The
breaker is per-process (see `KNOWN-LIMITATIONS.md`): daemon sessions on one
host learn independently until a shared store lands in a later phase.

**Invariants preserved.** Locality lattice on every hop; credentials never
in metadata or logs; hot path allocation-bounded (perf gate: route decision
0.0 ms vs 20 ms budget; 300-decision live p95 test); Phase 0–4 suite intact
(2 358 → 2 432 tests, all green); size/boundary/hot-path gates green.

## Verification

Every mechanism above is asserted by effect-measuring tests
(`test/intelligence/`: 74 new tests across 10 suites). The mapping from
claim → evidence lives in `docs/phase5-routing/05-TEST-RESULTS.md`; the
constitution compliance review in `06-FINAL-REVIEW.md`.
