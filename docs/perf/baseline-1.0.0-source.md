# XR Perf Baseline — v1.0.0 (source)

Generated: 2026-08-15T10:05:17.177Z · samples per scenario: 21
Environment: linux/x64 · Bun 1.3.14

| Scenario | Mode | Samples | p50 ms | p95 ms | min | max | Success |
|---|---|---:|---:|---:|---:|---:|---:|
| Version (fast path, cold) | cold | 21 | 32.3 | 33.2 | 27.9 | 33.5 | 21/21 |
| Version (fast path, warm) | warm | 20 | 30.4 | 33.3 | 28.5 | 33.3 | 20/20 |
| Help (fast path, cold) | cold | 21 | 32.5 | 43.1 | 30.1 | 46.0 | 21/21 |
| Help (fast path, warm) | warm | 20 | 32.5 | 35.0 | 30.7 | 35.0 | 20/20 |
| Doctor readiness | warm | 20 | 291.9 | 319.8 | 274.7 | 319.8 | 20/20 |
| Workspace list (kernel boot) | warm | 20 | 96.5 | 102.3 | 88.7 | 102.3 | 20/20 |
| Route decision (in-process bench) | warm | 21 | 0.0 | 0.0 | 0.0 | 0.0 | 21/21 |
| Dashboard first render (HTTP) | warm | 21 | 10.8 | 12.0 | 8.2 | 12.4 | 21/21 |
| Retrieval @100k items (in-process bench) | warm | 21 | 20.6 | 26.2 | 18.2 | 27.0 | 21/21 |

> This artifact is the regression-gate baseline. Do not hand-edit; regenerate with
> `bun run scripts/perf-baseline.ts --mode source`.
