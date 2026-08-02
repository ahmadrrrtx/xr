# Phase 5 — STEP 2 · Gap Analysis

**Inputs:** STEP 1 audit (`01-AUDIT-REPORT.md`), XR Architecture Constitution (Art. VII; Charter §9), Phase 5 Specification.
**Rule:** every gap carries the test/metric that will prove it closed. No gap → task mapping without a measurable acceptance.

---

## Ordered gap list → tasks

### G1 — Automatic-routing default semantics not honored (→ T1)
- **Reality:** `intelligencePlane.enableAutomatic` (default `true`) is schema-only; nothing reads it. Automatic routing is effectively default whenever the intel path is used, but the documented opt-in→default contract (`xr config` semantics) is unenforced, and legacy explicit configs must keep working.
- **Constitution:** Charter §9.5 "automatic routing is opt-in-then-default for new users; manual override always available."
- **Proof:** `test/intelligence/routing-v5.test.ts` — config with `enableAutomatic:false` resolves pins/defaults only (no automatic selection); default config routes automatically; Phase 0/1 pins unchanged.

### G2 — Vendor-claim capability metadata (→ T2, T8)
- **Reality:** `presets.ts` static booleans + regex heuristics; quality derived from **price tier**; `IntelligenceService.recordOutcome()` never called from runtime; no behavioral contract store.
- **Constitution:** Charter §9.8 — behavior (structured-output fidelity, tool fidelity, refusal patterns, context retention) is *measured and recorded*; Art. IV.5 no claim outruns evidence.
- **Proof:** `test/intelligence/behavioral.test.ts` — a synthetic provider's fidelity is measured by the offline evaluator from observed outcomes (not presets); capability-gated selection picks the **cheapest model meeting a required fidelity floor**; measured metadata overrides static claims in the decision path.

### G3 — No rolling health / circuit breaker (→ T3)
- **Reality:** point-in-time health snapshots only; nothing trips on an error window or quality degradation; no half-open probe/reset; FallbackProvider retries blindly.
- **Constitution:** Art. XIII reliability; Charter §9.5 fallback discipline.
- **Proof:** `test/intelligence/breaker.test.ts` — injected outage trips breaker to open; injected *quality* degradation (bad structured output rate) trips it too; cooldown → half-open probe → closed on success; while open, routing skips the provider and the reason is surfaced.

### G4 — Fallback/diversity/degradation/escalation incomplete (→ T3)
- **Reality:** diversity floor exists (different target) but no cross-provider-first ordering, no three-tier error classification (transient/permanent/semantic), no retry budget with jittered backoff, no degradation levels, no structured escalation package.
- **Constitution:** Charter §9.5 target diversity, Art. X.3 trustworthy failure, Art. IV.4 fail closed.
- **Proof:** `test/intelligence/fallback-v5.test.ts` — fallback chain orders cross-provider first; semantic failure (refusal/contract violation) classifies separately from transient; retry budget caps attempts; degradation ladder L0→L3 with measurable transition; escalation package carries decision + health + attempts (no secrets).

### G5 — Failover context preservation unmeasured (→ T4)
- **Reality:** `FallbackProvider.chat` forwards full history (mechanism present), but CPR is unmeasured and unobserveable; no injected-failover test.
- **Constitution:** Art. XIII.4 recovery never silently changes the requested outcome; Charter §9.8 context retention is measured.
- **Proof:** `test/intelligence/failover-cpr.test.ts` — ContinuityBench-style harness: scripted conversation with factual anchors, injected provider failure mid-conversation, fallback receives anchors (CPR = anchors preserved / anchors total ≥ target 0.95), and the failover is logged with the anchors transmitted.

### G6 — No routing SLOs (→ T6)
- **Reality:** no collector for selection latency, fallback rate, degradation rate, cost-per-quality, CPR. `stream-metrics` exists for turns; route decision budget (p95<20ms) is perf-gated but not *reported* as an SLO.
- **Constitution:** Art. I.2 outcome-measured; Art. XII budgets.
- **Proof:** `test/intelligence/routing-slo.test.ts` — collector aggregates decision latencies (p50/p95), fallback rate, degradation transitions, cost-per-quality, CPR; JSON report; p95<20ms asserted in-process.

### G7 — No difficulty estimator / capability-gate (→ T1)
- **Reality:** scoring has quality *preference* but no task-difficulty signal and no capability-gated cheapest-meets-bar selection (RouteLLM principle, deterministic variant).
- **Constitution:** Charter §9.4 outcome-driven routing; Art. VII.3 explainable.
- **Proof:** `test/intelligence/difficulty.test.ts` — deterministic difficulty estimate from observable task features (no model call); a "hard" task routes to a higher-fidelity model and an "easy" one to the cheapest sufficient; both decisions carry the difficulty in `factors`.

### G8 — Explainability not deep; override mode "restrict" missing (→ T1)
- **Reality:** decision reason is solid, but failover events don't carry the decision context; override = pin/preferred/local-only/private-only; no "restrict to set" mode.
- **Proof:** `test/intelligence/routing-v5.test.ts` — restrict-to-set honored in evaluator; failover log includes decision id + trigger + chain step; `xr providers explain` shows difficulty+health+fidelity factors.

### G9 — Future model class unproven (→ T7)
- **Reality:** `ModelClass` union covers many classes incl. `unknown`; custom providers can declare capabilities; but there is no test proving a *synthetic new class* routes via the contract with zero kernel/loop edits, nor an explicit extension point for future classes.
- **Proof:** `test/intelligence/model-class-contract.test.ts` — register a synthetic provider whose model declares a future class via the contract; routing selects it by requirement; **zero** edits to `src/core/`, `src/services/agent-service.ts`, `src/intelligence/router.ts`.

### G10 — No offline behavioral-evaluation harness (→ T2)
- **Reality:** nothing runs structured-output/tool-use/refusal/context-retention probes and writes measured metadata; must be **offline/async**, never on the hot path (Constitution Art. XII; Phase 5 Part 19).
- **Proof:** `test/intelligence/behavioral.test.ts` — evaluator is pure/async, driven by injected transcripts (no live model required in CI); hot-path perf test asserts decision p95 unchanged; evaluator writes the measured-metadata store atomically.

---

## Non-goals (scope fence — Constitution Art. XXVI)

- No learned/preference router (optional research only, never default, never opaque).
- No Phase 6 context-tier/recall work; no Phase 8 observability platform (routing metrics only).
- No new capability providers or UI surfaces; no net-new features.
- No vendor-claim "certification" language; measured data only.

## Deletion/retirement opportunities (Art. XXIV deletion budget)

| Item | Action |
|---|---|
| `intelligencePlane.enableAutomatic` dead config | Wire it (T1) — no deletion; dead config is a defect, honoring it is the fix |
| Quality-from-price-tier assumption in decision path | Superseded by measured fidelity when available (T2/T8); static tier remains only as a cold-start prior, labeled as such |
| Duplicate `Router` instantiation in daemon route | Keep single authority: daemon uses `IntelligenceRouter` **class** with the same policy code path; documented, not a duplicate authority (one policy implementation) |
