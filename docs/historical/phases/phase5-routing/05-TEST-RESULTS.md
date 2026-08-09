# 05 — Test Results (Phase 5)

**Date:** 2026-08-02 · **Commit base:** `14c208c` (7.0.1) · **Runner:** bun test (Linux CI-compatible)

Every Phase 5 test asserts **effects** (measurable outcomes), not mocks of
its own assertions. This file maps each requirement to its evidence.

---

## 1. Suite totals

| | Baseline (pre-Phase 5) | Phase 5 final |
|---|---|---|
| Tests | 2 358 pass / 0 fail | **2 432 pass / 0 fail** |
| Test files | 165 | **175** |
| expect() calls | ~9 190 | **9 228** |

New intelligence suites (74 tests, 10 files; `bun test test/intelligence/`
runs **198 tests** including the 5 pre-existing suites):

| Suite | Tests | Proves (effects) |
|---|---|---|
| `difficulty.test.ts` | 7 | deterministic estimator: signal thresholds, labels, floor mapping, overrides |
| `behavioral.test.ts` | 9 | evaluator measures scripted good/bad/refuser providers correctly; **unreachable provider ⇒ no contract** (Art. IV); persistence secret-free; measured fidelity gates selection + overrides static prior |
| `breaker.test.ts` | 11 | outage trips breaker; **quality-degradation trips breaker**; half-open probe closes/recovery, failure re-opens with backoff; router excludes open targets *naming "circuit open"*; persistence across instances |
| `fallback-v5.test.ts` | 13 | 3-tier classification; jitter bound; transient in-place retry then diverse failover; permanent = no retry; semantic counts as quality; locality guard skips poisoned hops; breaker-open hops never called; escalation package redaction (`sk-…` → `[redacted]`) |
| `failover-cpr.test.ts` | 4 | **CPR = 1.0 ≥ 0.95** on a 7-message-deep conversation failing at turn 4 (anchors `BlueComet-77`, `Port 8421`, `Dr. Ingrid Halvorsen`); **stateless control ≤ 1/3** (measurement non-vacuous); runtime failover record carries context evidence |
| `routing-v5.test.ts` | 10 | representative task classes route explainably; difficulty signals in factors; seeded bad metadata overridden by pin (with warning); restrict-to-set (`user_restriction`); `enableAutomatic:false` ⇒ no roaming; explicit difficulty override; `difficultyRouting:false`; `minOverallFidelity` wins; `local_only`/`private_only` |
| `routing-slo.test.ts` | 6 | aggregation; cold-start honesty; JSONL persistence (no double counting); windowing; **300 live `route()` decisions ⇒ p95 < 20 ms** |
| `locality-v5.test.ts` | 6 | tripped locals under `local_only` ⇒ honest unavailable (never cloud); poisoned chain's cloud hop never called; chain builder excludes cloud; measurement honors locality; no_cloud lattice; **Phase 5 stores contain no egress calls** (static grep) |
| `model-class-contract.test.ts` | 5 | synthetic provider + extension capability `video_temporal_reasoning` routes when required; fails closed when undeclared; **`git diff` of `src/core`/agent loop/execution is EMPTY** (Art. VII — contract extension, not redesign) |
| `service-v5.test.ts` | 3 | `resolveProvider()` executes the real chain (failover observed: primary×2 then fallback); runtime outcomes feed `IntelligenceMetrics` (**G2 closure: `recordOutcome` now called in production**); breaker config from workspace; sustained outage ⇒ honest unavailable at the authority |

## 2. Acceptance metrics (Part 13 exit gate)

| Requirement | Evidence | Result |
|---|---|---|
| Measured CPR, target ≥ 0.95 | `failover-cpr.test.ts` | **CPR = 1.0** (stateful arm), control ≤ 0.34 |
| Route decision p95 < 20 ms | perf gate + `routing-slo.test.ts` | bench 0.0 ms; **live 300-decision p95 < 20 ms** |
| Fallback diversity | chain reasons + `fallback-v5` | `· cross-provider` / `· same-provider distinct model` |
| Breaker on errors AND quality | `breaker.test.ts` ×2 trip paths | both legs trip independently |
| Degradation levels | L0–L3 in `fallback-v5`, `service-v5` | monotone, recorded |
| Human escalation | `RoutingEscalationError` package | redacted, tested |
| Locality invariant | `locality-v5.test.ts` (6 effects) | enforced every hop |
| Future model class via contract | `model-class-contract.test.ts` | zero core edits (git-diff proof) |
| No Phase 0–4 regression | full suite | 2 358 baseline tests all still green |

## 3. Gate battery (all green, Linux)

```
typecheck           clean (tsc --noEmit)
bun test            2 432 pass / 0 fail / 175 files
release:check       6 surfaces in sync at 7.0.1
claim-lint          8 evidenced claims, 0 unsupported
baseline:inventory  regenerated (7.0.1)
boundaries          0 violations (526 modules)
size-gate           all modules ≤800 LOC or waived-plan (config.ts 1101, waiver updated)
hot-path-lint       0 fast-path sync FS/process calls
perf:gate           ALL budgets PASS — route decision 0.0 ms vs 20 ms
golden-path         17/17 checks, chainValid: true
```

## 4. Live smoke evidence (operator surfaces)

- `xr providers route [--json]` — explanation carries difficulty + signals +
  diversity-annotated chain.
- `xr providers route --provider ollama --model qwen2.5:3b` — manual pin
  honored, `mode: manual`.
- `xr providers measure --provider ollama` — filter exact (only ollama
  iterated); daemon down ⇒ honest `provider unreachable …` skips, **no
  contracts written**. (Also fixed here: the global CLI parser was
  swallowing `--provider/--model` before subcommands — re-injection added
  in `src/cli/router.ts`.)
- `xr providers slo [--json]` — cold start reports zeros with
  "within budget"; breaker table present; notes the sink is local-only.

## 5. How to reproduce

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck && bun test
bun run release:check && bun run claim-lint && bun run baseline:inventory
bun run boundaries && bun run size-gate && bun run hot-path-lint && bun run perf:gate
XR_HOME=$(mktemp -d) bun run golden-path
bun test test/intelligence/        # 198 intelligence tests
```
