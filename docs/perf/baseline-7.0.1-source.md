# XR Perf Baseline — v7.0.1 (source)

Generated: 2026-07-31T20:49:59.499Z · samples per scenario: 21
Environment: linux/x64 · Bun 1.3.14

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
| Version (fast path, cold) | cold | 21 | 54.5 | 55.7 | 35.6 | 56.3 | 21/21 |
| Version (fast path, warm) | warm | 20 | 35.3 | 47.4 | 33.1 | 47.4 | 20/20 |
| Help (fast path, cold) | cold | 21 | 37.1 | 42.6 | 34.4 | 46.9 | 21/21 |
| Help (fast path, warm) | warm | 20 | 38.6 | 43.9 | 34.4 | 43.9 | 20/20 |
| Doctor readiness | warm | 20 | 412.0 | 474.4 | 347.3 | 474.4 | 20/20 |
| Workspace list (kernel boot) | warm | 20 | 110.7 | 140.4 | 99.4 | 140.4 | 20/20 |
| Route decision (in-process bench) | warm | 21 | 0.0 | 0.0 | 0.0 | 0.0 | 21/21 |
| Dashboard first render (HTTP) | warm | 21 | 13.3 | 15.6 | 10.9 | 16.0 | 21/21 |
| Retrieval @100k items (in-process bench) | warm | 21 | 24.8 | 33.7 | 21.7 | 39.8 | 21/21 |

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> `bun run scripts/perf-baseline.ts --mode source`.
