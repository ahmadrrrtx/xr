# XR Perf Baseline — v1.0.0 (source)

Generated: 2026-08-13T15:28:15.343Z · samples per scenario: 21
Environment: linux/x64 · Bun 1.3.14

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
| Version (fast path, cold) | cold | 21 | 37.7 | 40.8 | 35.7 | 41.1 | 21/21 |
| Version (fast path, warm) | warm | 20 | 38.0 | 39.8 | 37.5 | 39.8 | 20/20 |
| Help (fast path, cold) | cold | 21 | 40.0 | 42.5 | 37.5 | 51.5 | 21/21 |
| Help (fast path, warm) | warm | 20 | 39.8 | 40.5 | 37.4 | 40.5 | 20/20 |
| Doctor readiness | warm | 20 | 470.0 | 586.2 | 432.1 | 586.2 | 20/20 |
| Workspace list (kernel boot) | warm | 20 | 113.8 | 120.9 | 97.0 | 120.9 | 20/20 |
| Route decision (in-process bench) | warm | 21 | 0.0 | 0.0 | 0.0 | 0.0 | 21/21 |
| Dashboard first render (HTTP) | warm | 21 | 10.1 | 12.1 | 9.5 | 13.3 | 21/21 |
| Retrieval @100k items (in-process bench) | warm | 21 | 24.2 | 28.1 | 21.9 | 29.1 | 21/21 |

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> `bun run scripts/perf-baseline.ts --mode source`.
