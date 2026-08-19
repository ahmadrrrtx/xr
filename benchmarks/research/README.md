# Research benchmarks

`offline-bench.ts` measures the deterministic research layers (URL guard,
canonicalization/dedupe, citations, source normalization, budget, end-to-end
runner with a mock provider). Run:

```bash
bun run benchmarks/research/offline-bench.ts
```

Live provider benchmarks (real SearXNG / Firecrawl search, scrape, crawl
throughput, TT-first-source) are **not** included: they require API keys and
network, and would be non-deterministic in CI. They are the correct next step
once a Firecrawl key and a SearXNG instance are provisioned for benchmarking.

Per §43 (measure first, then budget): the offline layers above are the basis
for any future latency budgets; no target is asserted until measured against
real hardware/provider behavior.
