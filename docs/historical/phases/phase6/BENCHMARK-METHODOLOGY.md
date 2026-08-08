# Phase 6 — Recall Benchmark Methodology

**Artifacts:** `src/context/eval/harness.ts` · `benchmarks/recall/*.json` ·
`scripts/recall-benchmark.ts` · `test/context/recall-benchmark.test.ts` ·
live results: `docs/phase6/measured-recall.json`

Article VIII.5 requires recall quality to be **measured and benchmarked**.
This document defines the measurement precisely enough that anyone can
reproduce it, and states plainly what the numbers do and do not prove.

---

## 1. Protocol

MemoryAgentBench-style (research note R3; arXiv:2507.05257), adapted to be
fully deterministic — the published benchmark's LLM-judge lane is
deliberately NOT used:

1. **Inject-once, query-many.** Each domain fixture is inserted into a fresh
   scratch store through the repository's real write path (including
   backdated `updated_at` for staleness and real `supersede` linkage), then
   every fixture query runs against it.
2. **Four competencies × four domains.** Each fixture exercises all four
   competencies: `accurate_retrieval` (find the fact),
   `test_time_learning` (a later correction/rename must win),
   `long_range_consistency` (a 3-item task-linked chain must ALL surface in
   top-5), `conflict_resolution` (the updated member of an outdated/updated
   pair must rank #1 and the loser must fall — never silent corruption).
   Domains: `code`, `research`, `personal`, `business`.
3. **The REAL pipeline, not a harness shortcut.** Queries go through
   `ContextRetrieval.retrieve()` exactly as the agent drives it: scope-fenced
   SQL → authorize-before-rank (consent, trust ceilings, lifecycle-aware tier
   resolution) → three hybrid channels → RRF fusion → conflict penalties.
   The grant spans all tiers over consented fixture rows — consent is
   inserted as `approved` by construction, so the measurement is recall, not
   authorization.
4. **Deterministic assertions.** Scoring uses item ids only (`expectTop1`,
   `expectInTop5`, `expectAbsent`). No model in the loop ⇒ byte-identical
   results on re-run.
5. **Metrics.** Precision@1, Recall@1, Recall@5 (set recall where multiple
   items are expected), MRR — per competency, per domain, and overall.
6. **Declared targets, enforced** (`RECALL_TARGETS`): per-domain R@5 floor
   0.80; overall R@5 floors AR 0.85 / TTL 0.85 / LRC 0.80 / **CR 0.90**; plus
   zero unreconciled conflict inversions in the suite (asserted separately).
   A miss fails the test and exits the script non-zero — the benchmark is a
   gate, not a report.

## 2. Scale lane (latency, Art. XII)

`scripts/recall-benchmark.ts` additionally seeds **100,000** items
(~3.8 s since the repository's prepare-once fix) and measures retrieval
latency over a mixed query set: budget **p95 < 100 ms @100k**. The same
measurement exists as a test (`test/context/performance.test.ts`) and in the
pre-existing `perf:gate` retrieval bench. Numbers from all lanes are cited in
`05-TEST-RESULTS.md`.

## 3. Running it

```bash
bun scripts/recall-benchmark.ts --write     # prints matrix, writes docs/phase6/measured-recall.json
bun test test/context/recall-benchmark.test.ts   # CI: asserts targets
bun scripts/recall-benchmark.ts --skip-large     # recall-only, no 100k lane
```

Everything is offline (lexical route is the mandatory default), hermetic
(scratch stores under the OS temp dir, cleaned afterwards), and async-safe:
nothing here ever runs on the agent hot path.

## 4. What the numbers PROVE

- Under the fixture conditions, hybrid retrieval surfaces the right consented
  items at the declared floors, in all four competency families, with
  conflict losers falling in 100% of corpus cases.
- Retrieval p95 at 100,000 stored items is under the constitutional budget
  (measured, with the number recorded — currently ≈ 23–26 ms).
- The pipeline used by the benchmark is the same code the agent uses — the
  scores are not a side-channel approximation.

## 5. What they DO NOT prove (honesty obligations)

- **Paraphrase robustness.** The mandatory route is lexical (term-based).
  Fixture queries share vocabulary with their items by design; semantic
  paraphrase recall is a property of an embedding route, not this benchmark.
  (The semantic channel abstains unless a route is configured.)
- **Real-world coverage.** Four small fixtures (11–13 items each) are a
  *floor*, not a distribution match for any user's actual memory. LongMemEval
  / LOCOMO / full MemoryAgentBench runs with LLM-judged lanes remain future
  work (they need either network corpora or a judge model — both outside the
  mandatory-offline gate).
- **Poisoning RATES in the wild.** The integrity corpus asserts 100%
  detection over 30 committed attacks — a detection guarantee over THAT
  corpus, not an estimate of real-world attack success.
- **Cross-user generality.** All fixtures are local, single-workspace,
  single-tenant. Remote/multi-tenant memory is Phase 10/11 scope and is
  explicitly not claimed.

## 6. Drift control (G9)

`test/architecture/one-store.test.ts` enforces that any percentage-level
recall/precision/accuracy statement anywhere in src/, docs/ or README.md is
anchored to this harness or to an external citation. Prose about recall can
therefore never drift silently away from measured reality.
