# XR 7.1.0 Baseline Measurements

Generated: 2026-08-04T17:43:40.241Z

Environment: Bun 1.3.14, linux/x64, 1985 MiB RAM.

Methodology: 3 samples per deterministic local-only scenario using an isolated XR_HOME (`/tmp/xr-baseline-1785865417359`). Values are wall-clock measurements for this host and are not claims of cross-hardware benchmark precision.

| Scenario | Command | Success | Median ms | p95 ms | Peak RSS MiB | Notes |
|---|---|---:|---:|---:|---:|---|
| cli-version | `bun run src/index.ts --version` | 3/3 | 37.9 | 46.2 | 44.0 |  |
| cli-help | `bun run src/index.ts help` | 3/3 | 37.6 | 38.8 | 52.2 |  |
| doctor-json | `bun run src/index.ts doctor --json` | 3/3 | 424.4 | 451.7 | 53.9 | Exit 1 is the CORRECT result on a host with no reachable provider (Phase 0 · T4): doctor reports task-readiness, not installation status. Exit 0 here would mean XR is lying about being able to work. |
| workspace-list | `bun run src/index.ts workspace list --json` | 3/3 | 100.4 | 103.8 | 56.2 |  |
| doctor-perf | `bun run src/index.ts doctor --perf --json` | 3/3 | 355.6 | 363.9 | 52.7 | In-process CLI microbenchmarks; not full cold-start precision. |

Machine-readable report: `baseline-measurements.json`.
