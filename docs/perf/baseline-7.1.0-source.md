# XR Perf Baseline — v7.1.0 (source)

Generated: 2026-08-05T16:51:24.243Z · samples per scenario: 21
Environment: linux/x64 · Bun 1.3.14

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
| Version (fast path, cold) | cold | 21 | 35.1 | 35.9 | 33.5 | 37.3 | 21/21 |
| Version (fast path, warm) | warm | 20 | 35.3 | 37.5 | 34.9 | 37.5 | 20/20 |
| Help (fast path, cold) | cold | 21 | 37.8 | 40.0 | 34.8 | 40.2 | 21/21 |
| Help (fast path, warm) | warm | 20 | 37.7 | 40.7 | 37.3 | 40.7 | 20/20 |
| Doctor readiness | warm | 20 | 432.4 | 456.0 | 403.9 | 456.0 | 20/20 |
| Workspace list (kernel boot) | warm | 20 | 107.6 | 117.9 | 96.4 | 117.9 | 20/20 |
| Route decision (in-process bench) | warm | 21 | 0.0 | 0.0 | 0.0 | 0.0 | 21/21 |
| Dashboard first render (HTTP) | warm | 21 | 5.4 | 5.7 | 5.0 | 6.0 | 21/21 |
| Retrieval @100k items (in-process bench) | warm | 21 | 25.5 | 32.9 | 21.4 | 33.7 | 21/21 |

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> `bun run scripts/perf-baseline.ts --mode source`.
