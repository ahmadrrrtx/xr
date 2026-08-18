# Memory recall benchmark (Phase 09)

Deterministic dataset + measured latency. No invented numbers.

```
bun run scripts/memory-recall-bench.ts
```

Writes `latest.json` here and `benchmarks/context/latest.json`.

Target: retrieval p95 ≤ 250 ms (this host measured ~3.5 ms warm / ~3.3 ms cold on 50 seeded entries).
