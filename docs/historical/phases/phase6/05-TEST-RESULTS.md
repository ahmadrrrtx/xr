# 05 — Test Results (Phase 6)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Date:** 2026-08-02 · **Branch:** `feat/phase6-context-quality` @ `f7feb44`
· **Method:** every number below is copied from a tool's actual output; the
commands to reproduce each one are given inline.

---

## 1. Full suite (the headline)

```bash
bun test        # 2475 pass · 0 fail · 184 files · 9,859 expect() calls · 37s
```

| | baseline @ `841e12a` | Phase 6 @ `f7feb44` | delta |
|---|---|---|---|
| tests passing | 2,432 (175 files) | **2,475 (184 files)** | **+43, zero regressions, zero weakened** |
| expect() calls | 9,228 | 9,859 | +631 |

New Phase-6 test files (42 tests) + 1 perf test:

| file | tests | pins |
|---|---|---|
| `test/context/hybrid.test.ts` | 6 | channels score independently; RRF lets a metadata winner outrank the pure text winner — measured, not asserted; semantic abstains (never garbage cosine); hybrid ≥ lexical recall on planted sets |
| `test/context/navigation.test.ts` | 5 | memory tools in-loop; head-to-head: navigation beats single-shot on a planted task thread |
| `test/context/integrity.test.ts` | 6 | 30-attack corpus 100% quarantined; SQL-bypass + forged-instruction + post-assembly-revocation rows dropped at RENDER time; benign lookalikes not quarantined |
| `test/context/conflicts.test.ts` | 5 | supersession auto-resolves; contradictions surface; resolve supersedes loser without ever rewriting its trust |
| `test/context/undo.test.ts` | 6 | undo restores before-images **byte-for-byte** (correct/revoke/delete + legacy user_memory edit); double-undo refused |
| `test/context/lifecycle.test.ts` | 5 | fidelity: decisions/corrections/dates/sources/uncertainty survive folding; originals never deleted; trust bound; fail-closed compression |
| `test/context/recall-benchmark.test.ts` | 3 | 4 domains × 4 competencies exercised; measured targets met; conflict integrity guarantee |
| `test/context/local-only.test.ts` | 2 | full knowledge path + the benchmark itself run with the network killed |
| `test/architecture/one-store.test.ts` | 4 | `src/memory/` never reappears; canonical tables single-module; no private-DB repository; no bare recall % claims |
| `test/context/performance.test.ts` (+1) | +1 | **retrieval p95 measured at 100,000 items** |

## 2. Measured recall (Article VIII.5)

Source artifacts: `docs/phase6/measured-recall.json` (written by
`bun scripts/recall-benchmark.ts --write`, run at 2026-08-02T12:40Z) and the
CI suite above. Protocol: `BENCHMARK-METHODOLOGY.md`.

| domain | competency | R@5 | P@1 | MRR | queries |
|---|---|---|---|---|---|
| code | accurate_retrieval | 1.000 | 1.000 | 1.000 | 4 |
| code | test_time_learning | 1.000 | 1.000 | 1.000 | 1 |
| code | long_range_consistency | 1.000 | 0.000 | 0.333 | 1 |
| code | conflict_resolution | 1.000 | 1.000 | 1.000 | 2 |
| research | accurate_retrieval | 1.000 | 1.000 | 1.000 | 3 |
| research | test_time_learning | 1.000 | 1.000 | 1.000 | 1 |
| research | long_range_consistency | 1.000 | 0.000 | 0.500 | 1 |
| research | conflict_resolution | 1.000 | 1.000 | 1.000 | 1 |
| personal | accurate_retrieval | 1.000 | 1.000 | 1.000 | 3 |
| personal | test_time_learning | 1.000 | 1.000 | 1.000 | 1 |
| personal | long_range_consistency | 1.000 | 0.000 | 0.500 | 1 |
| personal | conflict_resolution | 1.000 | 1.000 | 1.000 | 1 |
| business | accurate_retrieval | 1.000 | 1.000 | 1.000 | 3 |
| business | test_time_learning | 1.000 | 1.000 | 1.000 | 1 |
| business | long_range_consistency | 1.000 | 0.000 | 0.333 | 1 |
| business | conflict_resolution | 1.000 | 1.000 | 1.000 | 1 |
| **OVERALL** | | **R@5 1.000 · R@1 0.846 · P@1 0.846 · MRR 0.910** | | | **26** |

Honest reading: recall set-recall (R@5) is 1.000 everywhere; LRC queries have
no single "top 1 expected" item (they expect a 3-item SET, hence P@1/MRR are
structurally lower there — the set surfaces in full). Conflict losers fall in
100% of corpus cases. All declared targets (per-domain R@5 ≥ 0.8; overall
AR/TTL ≥ 0.85, LRC ≥ 0.8, CR ≥ 0.9) **met**. `evaluateTargets` report: zero
violations.

**During this work the benchmark FOUND three real bugs** (its purpose, and
the reason recall must be measured): tier resolution silently rejected
verbatim task evidence (`defaultTierForItem` fix); the grant-tier narrowing
hid memory/task items from candidacy (harness grant fix); `fuseRRF` returned
input order instead of fused rank order (now rank-ordered).

## 3. Scale (Article XII — p95 < 100 ms @ 100k, measured in three lanes)

| lane | command | measured |
|---|---|---|
| benchmark scale lane | `bun scripts/recall-benchmark.ts --write` | seeded 100,000 in 3.8 s; **avg 18.83 ms, p95 22.54 ms** |
| test-suite lane | `bun test test/context/performance.test.ts` | p95 @100k asserted < 100 ms (passes) |
| perf:gate lane (pre-existing) | `bun run perf:gate` | warm **25.9 ms** / budget 250 ms — PASS |

All lanes ≥ 3.8× inside the constitutional budget.

## 4. Gates (all run at `f7feb44`)

| gate | result |
|---|---|
| `bun run typecheck` | clean (0 errors) |
| `bun test` | **2475 pass / 0 fail / 184 files** |
| `bun run boundaries` | 0 violations, 534 modules, 1,681 deps |
| `bun run size-gate` | under-800 or waived; two Phase-6 waivers re-recorded (`types.ts` 1056, `repository.ts` 1398) with owner/plan/review |
| `bun run hot-path-lint` | 0 fast-path sync calls |
| `bun run claim-lint` | no unsupported claims; 8 evidenced |
| `bun run golden-path` (XR_HOME set) | 17/17 checks, `chainValid: true` |
| `bun run perf:gate` | all budgets PASS (route 0.0 ms; dashboard 5.7 ms; retrieval @100k 25.9 ms) |
| `bun scripts/recall-benchmark.ts` | all declared targets met, exit 0 |

## 5. Anti-poisoning / local-only evidence

- Poisoning corpus: `benchmarks/poisoning-corpus.json` — 30 attacks across
  14 classes; detection **30/30 quarantined or dropped at admission/render**
  (asserted, `test/context/integrity.test.ts`).
- Network-off: `test/context/local-only.test.ts` replaces `fetch` with a
  fail-loud stub, then runs record → hybrid retrieve → memory tools → promote
  → compress → inject **and the whole benchmark**: both pass offline.
- One-store: `test/architecture/one-store.test.ts` (4 checks) green.

## 6. Constitution hot-checks re-run after every fix

- injected packages carry `integrityFindings`/`integrityRejected`; quarantines
  forced to the quarantine channel at render time (fail closed).
- undo restores byte-for-byte; double-undo refused; resolution rows markable
  undone; legacy `user_memory` edits ledger-wrapped (ADR 0006 F1 covered).
