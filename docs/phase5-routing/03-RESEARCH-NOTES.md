# Phase 5 — STEP 3 · Research Notes (principles adopted, with sources)

Principles are adopted, not copied. Each entry records the principle + how XR applies it. Nothing below introduces a provider dependency or a learned default router.

---

## R1 — Cost-per-quality, capability-gated, difficulty-aware routing (RouteLLM, ICLR 2025)

**Source:** Ong et al., "RouteLLM: Learning to Route LLMs from Preference Data" (ICLR 2025) — arXiv:2406.18665. [3](https://arxiv.org/pdf/2406.18665) · [1](https://www.themoonlight.io/en/review/routellm-learning-to-route-llms-with-preference-data)

**Principles:**
- Estimate query difficulty and route to the **cheapest model whose capability ≥ difficulty** ("cost-per-quality" / capability-gated selection). RouteLLM's published results: ~85% cost reduction at ~95% recovered quality via matrix-factorization routers.
- Evaluation metrics: **CPT** (call-performance threshold — minimum share of strong-model calls to reach a target quality) and **APGR** (average performance-gap recovered across cost points).
- Desirable router properties: single-model invocation per query, generalization, adaptability without retraining.

**XR adoption (deterministic, not learned):**
- A **deterministic difficulty estimator** (`difficulty.ts`) derives a 0..1 difficulty from observable, secret-free task features (task length/structure signals, required capabilities, context demand, tool-use need). No model call, no ML on the hot path (Art. IV/XII; the estimator is inspectable and its features appear in `decision.factors`).
- Selection becomes **capability-gated cost-per-quality**: candidates whose *measured* fidelity ≥ difficulty-implied floor are eligible; among those, the scorer's cost/latency/locality terms pick the cheapest sufficient. A learned/preference router remains **optional research only — never the default, never opaque** (Exit-gate guard #2).
- We track **cost-per-quality** in routing SLOs (R5) — the measurable echo of CPT/APGR without claiming RouteLLM's trained-router numbers.

## R2 — Routing inputs

**Source:** Charter §9.4 (constitutional); reinforced by gateway field guides [2](https://futureagi.com/blog/what-is-llm-fallback-strategy-2026/).

**Principle:** routing decides on task intent/difficulty, capability, measured behavioral fidelity, cost, latency, availability, locality/privacy, modality, and historical outcome. Context-aware (semantic) matching where useful.
**XR adoption:** all nine inputs exist after T1–T3; historical outcome stays confidence-gated (existing `IntelligenceMetrics` rule: ≥3 samples, confidence ≥0.3) and now actually fed (G2 closure wires `recordOutcome`).

## R3 — Fallback & reliability: the 2026 ops consensus

**Sources:** 2026 production-gateway comparisons and field guides — [1](https://futureagi.com/blog/best-ai-gateways-llm-failover-fallback-2026/) (gateway scorecard: passive rolling-window aggregation + circuit breaking; hysteresis; retry budgets; 4-state health machines), [2](https://futureagi.com/blog/what-is-llm-fallback-strategy-2026/) (five stable fallback strategies; canonical cross-provider chains covering independent failure domains; retry-budget as binding constraint; MTTR targets), [3](https://dev.to/sandhu93/circuit-breaker-for-llm-provider-failure-53f6) (CLOSED→OPEN→HALF-OPEN pattern, sliding window, single-flight probing caveats), [5](https://www.buildmvpfast.com/blog/building-with-unreliable-ai-error-handling-fallback-strategies-2026) (backoff 1s→30s with jitter, ≤3 retries, tiered user-visible degradation).

**Principles adopted:**
1. **Rolling health score** per provider (windowed success/latency aggregation, hysteresis), not binary ok/fail.
2. **Circuit breaker** that trips on error-rate **and quality degradation** (e.g., structured-output validity collapse), with reset (cooldown) + **half-open** single-probe; while open, the router excludes the provider *with a reason*.
3. **Target-diverse fallback chains** — different provider *and* different failure domain (independent rate-limit pool / region); the canonical chain is 2–3 deep.
4. **Three-tier error classification:** transient (retry+fallback ok), permanent (fallback ok, no retry), semantic (contract/refusal/quality — fallback only to a model with sufficient fidelity; never blind retry).
5. **Jittered exponential backoff capped by a retry budget** — retries cannot starve the fallback dispatch (retry budget is the binding constraint, per [2]).
6. **Validation gates** before downstream effects (schema+logic+safety) — XR already has the envelope/approval gates (Phase 2/4); routing never bypasses them.
7. **Graceful-degradation levels + human escalation with a full context package** — defined ladder (L0 full → L1 equivalent-fidelity fallback → L2 reduced-capability fallback → L3 cached/queued or refusal with repair path) and an escalation record carrying the decision, attempts, health, and repair action; **never a silent reroute** (Charter §9.5; Art. X.3).

## R4 — Stateful failover & CPR (ContinuityBench)

**Source:** Pandey & Chakravarty, "ContinuityBench: A Benchmark and Systems Study of Stateful Failover in Multi-Provider LLM Routing," arXiv:2607.15899 (2026) — [1](https://arxiv.org/abs/2607.15899) · [harness](https://github.com/Vishal-sys-code/continuity-bench)

**Principles:**
- High API uptime ≠ conversational continuity: naive stateless failover preserves uptime but **silently discards conversation history**. Their stateful proxy (History-Forwarding) achieved **99.20% CPR** vs. ~0% for stateless forwarding (N=750 failover events).
- Metrics: **CPR** (Continuity Preservation Rate) and **CLO** (Continuity Latency Overhead).
- The residual failures were **fallback-model instruction-following errors, not forwarding mechanism failures** — i.e., measure the *fallback model's* fidelity, not just the pipe. Async exponential backoff with jitter prevents retry storms against strict-limit fallback APIs.

**XR adoption:**
- XR's `FallbackProvider` already forwards full history (the winning mechanism) — Phase 5 makes it **measured**: a failover-injection harness asserts factual anchors reach the fallback (CPR target ≥0.95 on the harness corpus), records CPR into routing SLOs, and measures the fallback model's instruction-following fidelity through the behavioral-contract evaluator (R1/T2) — addressing exactly the failure mode ContinuityBench identifies.
- Failover is *visible* (existing `console.warn`) and now also *recorded* (decision id + trigger + anchors), never silent.

## R5 — Routing observability SLOs

**Sources:** OTel GenAI conventions guide — [2](https://openobserve.ai/blog/opentelemetry-for-llms/) (p95 latency by provider/model, token-budget utilization, error rate by type, cost per 1k requests); TrueFoundry gateway metrics — [3](https://www.truefoundry.com/blog/observability-in-ai-gateway) (p50/p95/p99, TTFT, cost per model/provider, **routing visibility: which backend, why, whether fallback/retry occurred**, guardrail/policy activity); production-monitoring guide — [1](https://valuestreamai.com/blog/ai-monitoring-in-production-guide-2026) (cost per query as a first-class metric).

**Principles adopted (routing-scoped, not the Phase 8 platform):**
- SLOs: **selection p95 <20ms** (existing budget), **fallback rate**, **degradation rate**, **cost-per-quality**, **CPR**.
- Metrics: total routing decisions, fallback/guardrail-block totals, selection p50/p95; all secret-free (ids, classes, durations, counts only).
- Export: bounded in-process collector + a `routing SLO` report surface (JSON + CLI), so Phase 8 can consume without redesign.

---

## Rejected-on-principle (recorded per Art. XXVI)

- **Learned/preference router as default** — rejected: opaque + unverifiable per decision (Art. IV.5, VIII-claims); remains optional research behind a flag, never default.
- **Shared-state (Redis-class) breaker as the default** — rejected for core: XR is local-first single-process-first; in-process breaker with optional workspace-shared persistence later (noted as future work; single-process breaker is *correct* for the CLI/daemon today).
- **Active probing loops on every provider** — rejected as default: paid traffic and hot-path latency; XR uses passive aggregation + on-demand half-open probes (consistent with [1]'s passive+circuit-breaker class).
