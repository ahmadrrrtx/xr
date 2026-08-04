# XR Perf Baseline — v7.1.0 (source)

Generated: 2026-08-04T17:45:04.698Z · samples per scenario: 21
Environment: linux/x64 · Bun 1.3.14

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
| Version (fast path, cold) | cold | 21 | 37.6 | 42.0 | 35.2 | 44.4 | 21/21 |
| Version (fast path, warm) | warm | 20 | 39.5 | 40.8 | 37.2 | 40.8 | 20/20 |
| Help (fast path, cold) | cold | 21 | 42.5 | 55.4 | 39.8 | 59.7 | 21/21 |
| Help (fast path, warm) | warm | 20 | 39.5 | 48.2 | 37.0 | 48.2 | 20/20 |
| Doctor readiness | warm | 20 | 439.5 | 477.4 | 421.0 | 477.4 | 20/20 |
| Workspace list (kernel boot) | warm | 20 | 112.4 | 122.2 | 102.4 | 122.2 | 20/20 |
| Route decision (in-process bench) | warm | 21 | 0.0 | 0.0 | 0.0 | 0.0 | 21/21 |
| Dashboard first render (HTTP) | warm | 21 | 5.4 | 6.2 | 5.1 | 6.7 | 21/21 |
| Retrieval @100k items (in-process bench) | warm | 21 | 22.9 | 31.3 | 19.8 | 33.1 | 21/21 |

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> `bun run scripts/perf-baseline.ts --mode source`.
