# Memory recall benchmark (Phase 09)

Deterministic dataset + measured latency. No invented numbers.

```
bun run scripts/memory-recall-bench.ts
```

Writes `latest.json` here and `benchmarks/context/latest.json`.

Target: retrieval p95 ≤ 250 ms (this host measured ~3.5 ms warm / ~3.3 ms cold on 50 seeded entries).

`suite-latency.json` is a frozen sample from an earlier run. The latency test
(`test/context/phase09-latency.test.ts`) does **not** rewrite it: it writes its
measurement to `$XR_BENCH_OUT_DIR/memory-recall/suite-latency.json` (set it to
keep the numbers, e.g. as a CI artifact), or else under the suite's own temp
root, which `test/helpers/suite-tmp.ts` deletes after the run (XR-LAUNCH-033). CI checks that the test lanes leave the checkout clean
(`scripts/assert-clean-tree.sh`).
