# Phase 5 — STEP 1 · Repository Audit Report

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Phase:** 5 — AI Orchestration & Routing Quality
**Commit audited:** `14c208c` (main, PR #36 merge)
**Date:** 2026-08-02
**Environment:** Linux (container) x86_64 · bun 1.3.14 · tsc 5.5+
**Rule applied:** the repository is the source of truth; every claim below was verified by reading code and running the live gates.

---

## 1. Phase 0–4 Re-verification (the floor)

| Phase / item | Evidence command / artifact | Result | Status |
|---|---|---|---|
| Phase 0 — truth/release (one manifest, version unified) | `bun run release:check` → "all 6 surfaces in sync at 7.0.1 (Truth)" | PASS | **VERIFIED** |
| Phase 0 — claim governance | `bun run claim-lint` → "no unsupported claims · 8 evidenced claims" | PASS | **VERIFIED** |
| Phase 0 — baseline inventory | `bun run baseline:inventory` → wrote `docs/release/7.0.1/inventory.json` | PASS | **VERIFIED** |
| Phase 0 — budget governor (`src/cost/governor.ts`) | code read: per-task USD/token ceilings, `record()` after every turn (`src/core/agent.ts:456`) | Present, enforced on loop | **VERIFIED** |
| Phase 0 — no same-target fallback (T11) | `routing-service.ts` `legacyFallbackAllowed` + `resolveWithDecision` diversity guard; tests in `test/intelligence/locality-invariant.test.ts` | Enforced (different provider OR different model) | **VERIFIED** |
| Phase 1 — single-writer persistence | ADR 0001 (`docs/adr/0001-single-writer-durability-invariant.md`); golden-path check `restart-preserves-audit`, `chain-intact-*` | PASS (17/17 checks, `chainValid:true`) | **VERIFIED** |
| Phase 1 — reliability | `bun test` → **2358 pass / 0 fail / 165 files** | PASS | **VERIFIED** |
| Phase 2 — unified envelope, one registry/router/planner/context/engine | `agent-service.ts` is sole entry (`execute()`); ADRs 0002–0008; `test/architecture/boundaries.test.ts`; `bun run boundaries` → no dependency violations (520 modules) | PASS | **VERIFIED** |
| Phase 2 — ONE routing authority | `src/providers/routing.ts` is **deleted**; `test/intelligence/locality-invariant.test.ts:85` asserts the file does not exist; `RoutingService` (intelligence/routing-service.ts) + `IntelligenceService` are the only selection→construction paths | PASS — no duplicate router | **VERIFIED** (details §2) |
| Phase 2 — enforced L0–L6 boundaries | `bun run boundaries` (dependency-cruiser) → 0 violations; `bun run size-gate` → all modules under 800 LOC or owned waiver | PASS | **VERIFIED** |
| Phase 3 — lazy/compiled runtime + budgets | `bun run perf:gate` → all budgets PASS incl. **Route decision (in-process) 0.0ms vs 20ms budget**; startup 37–43ms warm/cold vs 150/300ms budgets | PASS | **VERIFIED** |
| Phase 3 — hot-path discipline | `bun run hot-path-lint` exit 0 | PASS | **VERIFIED** |
| Phase 3 — model-switch state machine | `src/providers/model-switch.ts` (preflight→warm→canary→swap→verify→done, rollback) | Present; **config-switch only, not mid-conversation failover** | **VERIFIED (scope noted)** |
| Phase 4 — enforceable risk-tier isolation, egress, credential brokering, supply chain | ADR 0009–0011; commit `8c43ae5`; `bun test` trust/security suites green | PASS | **VERIFIED** |
| Full suite green | `bun test`: 2358 pass / 0 fail; `bun run typecheck`: clean | PASS | **VERIFIED** |
| Golden path (install→first answer→audit chain→restart→uninstall) | `XR_HOME=$(mktemp -d) bun run golden-path` → 17 checks, `chainValid:true`, exit 0 | PASS | **VERIFIED** |

**No Phase 0–4 REGRESSION found. Nothing CHANGED vs. reports in ways that contradict the completion documents; two items are narrower than their phase reports implied and are recorded as gaps below (§4) rather than regressions, because they were never claimed to exist.**

---

## 2. Routing-surface audit (the Phase 5 surface)

### 2.1 One routing authority? — YES, verified

- **Canonical authority:** `src/intelligence/routing-service.ts` (`RoutingService`) computes decisions via `IntelligenceRouter` (`src/intelligence/router.ts`) and constructs providers; `src/intelligence/service.ts` (`IntelligenceService`) is the registered platform facade (`Tokens.Intelligence`, provider: `src/core/providers/intelligence.ts`).
- **Duplicate check:** `src/providers/routing.ts` does not exist. Grep for `ProviderRouter` finds only doc comments and tests asserting its removal. `ProviderService.getProvider()` prefers `Tokens.Intelligence` and falls back to `RoutingService` — **same authority class, two entry shims, one implementation**. `IntelligenceRouter` is `new`-ed in three places (routing-service, service, daemon route `/api/providers/route`, enterprise eval suite) but it is a *stateless decision function*; all selection policy lives in one file. **VERIFIED: one authority, no duplicate.**
- **Entry paths into the agent loop:** `AgentService.execute()` → `ProviderService.getProvider()` → `IntelligenceService.resolveProvider()` (or `RoutingService.resolveWithDecision()`). Routing decision is audited (`intelligence.route`) and attached to the envelope plan.

### 2.2 How routing decides today (inventory)

Pipeline (`router.ts`): **filter** (`evaluator.ts`) → **score** (`scorer.ts`) → **select** → **explain**.

- **Hard filters:** routing mode, strict pin, locality policy (`local_only`/`private_only`/`no_cloud`), capability tri-state (unknown fails closed for required caps), modalities, context window, budget absurdity, health (non-stale), credentials.
- **Score dimensions (weights in `DEFAULT_WEIGHTS`):** taskFit 1.2, quality 1.0, latency 0.7, cost 0.9, locality 0.8, preference 1.1, historical 0.6, availability 0.5. Mode-specific weight emphasis exists (cost/latency/quality constrained).
- **Structured reason emitted:** `RoutingDecision` { decisionId, timestamp, mode, requirements, constraints, selected(+score breakdown), fallbackChain, rejected(with codes+messages), considered, explanation, factors, confidence, humanHandoff } + durable `RoutingDecisionRecord`. **Explainability substrate: present.**
- **Automatic routing:** present (mode `automatic`), with manual pin highest-precedence. Modes: manual / preferred_with_fallback / local_only / private_only / automatic / cost_constrained / latency_constrained / quality_constrained / disabled.
- **CLI/API visibility:** `xr providers route|explain|catalog`; daemon `GET /api/providers/route`, `/api/providers/catalog`.

### 2.3 Decision inputs available today

| Input (Constitution §9.4 list) | Present? | Notes |
|---|---|---|
| intent / task class | ✅ | `modelClass` + modalities + `require` |
| **estimated difficulty** | ❌ **NOT FOUND** | no concept of task difficulty anywhere in `src/intelligence/` |
| capability | ✅ | tri-state per model (static presets) |
| **measured behavioral fidelity** | ❌ **NOT FOUND** | no behavioral contract (structured-output fidelity, tool-use fidelity, refusal patterns, context retention) |
| cost | ✅ | tier + static price table (`cost/pricing.ts`); scoring uses tier, not price-per-quality |
| latency | ✅ | static class + `lastMs`; measured via stream-metrics but not fed back to routing |
| availability | ✅ | point-in-time `HealthSnapshot`; **no rolling score, no circuit breaker** |
| locality/privacy | ✅✅ | first-class, fail-closed, tested (60 locality tests) |
| modality | ✅ | modality filtering present |
| historical outcome | ⚠️ **STRUCTURE ONLY** | `IntelligenceMetrics` (success rate, confidence-gated) exists, but **`IntelligenceService.recordOutcome()` is never called from any runtime path** — nothing writes samples in production |

### 2.4 Automatic vs manual; explainability

- Automatic routing exists and is default *when the intelligence plane is invoked*; manual pin always wins; `enabledAutomatic` exists in the config schema (`config.ts:163`, default `true`) **but is never read anywhere** — dead config (gap G1).
- Explainability: structured reason present for every decision including `unavailable` (fail-closed with humanHandoff). Daemon + CLI expose it.

### 2.5 Capability metadata source — VENDOR CLAIMS (static)

- `presets.ts` hard-codes `capabilities` per provider (e.g. `toolUse: true, jsonMode: true`) — **vendor-claimed booleans**.
- `capability.ts` refines via regex heuristics on model IDs and static `CONTEXT_HINTS`; `qualityFor()` derives quality from **price tier**, a vendor/marketing proxy.
- Config overlay `providerEngine.providerCapabilities` allows manual tri-state overrides.
- **No measurement path:** nothing observes a real provider response and updates capability/fidelity metadata. `structuredOkRate` exists in `ModelOutcomeStats` but is never fed (recordOutcome never called). Gap G2.

### 2.6 Health / fallback behavior

- **Health:** `ProviderHealthChecker` = doctor-style, point-in-time, no history. `HealthSnapshot` on descriptors is staleness-tagged. **No rolling health score. No circuit breaker** (no failure window, no open/half-open/closed states, no quality-degradation trip). Gap G3.
- **Fallback chain:** built from ranked compatible candidates; locality-escalation blocked (ranked `local<private<hybrid<cloud`); `mayFallbackOnTrigger` classifies 11 triggers into allow/deny (budget_exhausted, privacy_restriction, unknown_completion deny) — close to a three-tier classification but **no transient/permanent/semantic split and no retry budget / jittered backoff** in the routing plane.
- **Diversity:** different provider *or* different model — satisfies Phase 0 T11; **cross-provider preference is not explicit** (a same-provider/different-model step can precede a cross-provider one, and there is no rate-limit-pool awareness).
- **Degradation levels:** only `humanHandoff {required, reason}`. No defined L0–L3 degradation ladder, no structured escalation package. Gap G4.
- **Fallback at runtime:** `FallbackProvider.chat` retries the whole message list against the secondary when the primary `chat()` throws; warns visibly (not silent). It **does not** consult the breaker, does not record health, and retries once with no backoff.

### 2.7 Mid-conversation failover — context preservation

- Mechanically, `FallbackProvider.chat(messages)` re-sends the **full message list** to the fallback — history forwarding exists (ContinuityBench's core mechanism). ✅
- **CPR is not measured**: no harness asserts that factual anchors survive a mid-conversation failover; nothing measures the fallback model's instruction-following fidelity. The Phase 3 model-switch state machine is a *config* swap machine, unrelated to in-flight conversations. Gap G5.

### 2.8 Locality enforcement today

- `localityAllowed()` + `LocalityPolicyViolation` fail closed on every path including exhaustion; `buildFallbackChain` blocks silent locality escalation; 60 locality-invariant tests green; enterprise eval has a locality scenario. **VERIFIED and strong.** Phase 5 must *extend* it to new subsystems (breaker, behavioral store, metrics) so new code can never reopen an egress bypass.

### 2.9 Routing metrics today

- `IntelligenceMetrics`: bounded in-memory outcome samples (200/30d), confidence-gated stats. Not persisted, not wired (see 2.3).
- `stream-metrics.ts` (Phase 3 T7): per-turn TTFT/tokens/s/cancel/RSS → `$XR_HOME/cache/metrics/streaming.jsonl` (bounded 500 lines). Real measurement sink, provider-agnostic.
- **No routing SLO collector** (selection p95, fallback rate, degradation rate, cost-per-quality, CPR). Route-decision p95<20ms is performance-gated (0.0ms measured) — must be preserved. Gap G6.

---

## 3. Routing-decision inventory (who decides what, today)

| # | Decision point | File | What it decides | Feeds |
|---|---|---|---|---|
| 1 | `IntelligenceRouter.route()` | intelligence/router.ts | selection + fallback chain + reason | everything below |
| 2 | `RoutingService.resolveWithDecision()` | intelligence/routing-service.ts | decision→provider construction; locality defense-in-depth; legacy fallback wiring | CLI-only paths |
| 3 | `IntelligenceService.resolveProvider()` | intelligence/service.ts | decision→provider (+FallbackProvider wrap); catalog cache; `canFallback()` | ProviderService → agent loop |
| 4 | `ProviderService.getProvider()` | services/provider-service.ts | intel-vs-classic shim; wraps `withTurnMetrics` | AgentService |
| 5 | `AgentService.execute()` | services/agent-service.ts | builds agent requirements (chat+toolUse), audits decision, attaches to envelope | envelope runner |
| 6 | `FallbackProvider.chat()` | intelligence/routing-service.ts | one-shot whole-history failover on throw | runtime |
| 7 | daemon `/api/providers/route` | daemon/routes/providers.routes.ts | decision-only explain endpoint | dashboard |

---

## 4. Gap summary (feeds STEP 2; task mapping in §5)

| ID | Gap | Severity |
|---|---|---|
| G1 | `intelligencePlane.enableAutomatic` is dead config — opt-in→default semantics not wired | medium |
| G2 | Capability/fidelity metadata is vendor-claimed static presets; no measured behavioral contracts; `recordOutcome` never called from runtime | **high** |
| G3 | No rolling health score; no circuit breaker (errors + quality degradation, half-open/reset) | **high** |
| G4 | Fallback chain not explicitly target-diverse-first; no three-tier error classification; no retry budget/jittered backoff; no defined degradation levels; escalation = bare handoff | **high** |
| G5 | Mid-conversation failover forwards history but CPR is unmeasured; no failover-injection harness | **high** |
| G6 | No routing SLO collector (selection p95, fallback rate, degradation rate, cost-per-quality, CPR) | medium |
| G7 | No deterministic difficulty estimator feeding capability-gated selection (cost-per-quality principle from RouteLLM absent) | medium |
| G8 | Explainability present but not surfaced inside the loop’s runtime path (factors not attached to failover events); no "restrict" override mode (only pin/preferred) | low-medium |
| G9 | Future-model-class addability not proven by test (synthetic class through contract) | low |
| G10 | Behavioral evaluation must run offline/async — harness does not exist | **high** (enabler for G2) |

**Preserved strengths (do not break):** fail-closed locality; structured decisions; deterministic scoring; p95<20ms route budget; single authority; target-diversity floor; 2358-test suite; perf/boundary/size/claim gates.

## 5. Task mapping (Part 8)

- **T1** ← G1, G7, G8 (explainable auto routing + difficulty + override incl. restrict)
- **T2** ← G2, G10 (measured behavioral contracts + offline evaluator)
- **T3** ← G3, G4 (rolling health + breaker + diversity + degradation + escalation)
- **T4** ← G5 (failover CPR harness)
- **T5** ← locality extension to all new subsystems
- **T6** ← G6 (SLO collector)
- **T7** ← G9 (synthetic model class + adapter-only proof)
- **T8** ← §2.1 verification + replacing vendor-claim assumptions in the decision path with measured data
