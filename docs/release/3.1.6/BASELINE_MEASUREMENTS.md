# XR 3.1.6 Baseline Measurements

Generated: 2026-07-22T09:48:14.551Z

Environment: Bun 1.3.14, linux/x64, 1992 MiB RAM.

Methodology: 3 samples per deterministic local-only scenario using an isolated XR_HOME (`/tmp/xr-baseline-1784713691031`). Values are wall-clock measurements for this host and are not claims of cross-hardware benchmark precision.

| Scenario | Command | Success | Median ms | p95 ms | Peak RSS MiB | Notes |
|---|---|---:|---:|---:|---:|---|
| cli-version | `bun run src/index.ts --version` | 3/3 | 132.4 | 149.5 | 43.9 |  |
| cli-help | `bun run src/index.ts help` | 3/3 | 119.4 | 122.5 | 52.5 |  |
| doctor-json | `bun run src/index.ts doctor --json` | 3/3 | 348.0 | 352.2 | 54.6 | Optional local runtimes/providers may warn when not installed; required failures are what gate release. |
| workspace-list | `bun run src/index.ts workspace list --json` | 3/3 | 287.9 | 288.0 | 56.8 |  |
| doctor-perf | `bun run src/index.ts doctor --perf --json` | 3/3 | 287.9 | 289.8 | 53.5 | In-process CLI microbenchmarks; not full cold-start precision. |

Machine-readable report: `baseline-measurements.json`.
