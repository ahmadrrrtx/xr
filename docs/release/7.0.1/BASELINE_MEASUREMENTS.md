# XR 7.0.1 Baseline Measurements

Generated: 2026-07-31T09:34:33.456Z

Environment: Bun 1.3.14, linux/x64, 1985 MiB RAM.

Methodology: 3 samples per deterministic local-only scenario using an isolated XR_HOME (`/tmp/xr-baseline-1785490468599`). Values are wall-clock measurements for this host and are not claims of cross-hardware benchmark precision.

| Scenario | Command | Success | Median ms | p95 ms | Peak RSS MiB | Notes |
|---|---|---:|---:|---:|---:|---|
| cli-version | `bun run src/index.ts --version` | 3/3 | 174.8 | 177.5 | 44.3 |  |
| cli-help | `bun run src/index.ts help` | 3/3 | 176.6 | 178.0 | 51.9 |  |
| doctor-json | `bun run src/index.ts doctor --json` | 3/3 | 459.9 | 460.3 | 54.0 | Exit 1 is the CORRECT result on a host with no reachable provider (Phase 0 · T4): doctor reports task-readiness, not installation status. Exit 0 here would mean XR is lying about being able to work. |
| workspace-list | `bun run src/index.ts workspace list --json` | 3/3 | 407.2 | 408.0 | 56.2 |  |
| doctor-perf | `bun run src/index.ts doctor --perf --json` | 3/3 | 404.0 | 416.0 | 53.1 | In-process CLI microbenchmarks; not full cold-start precision. |

Machine-readable report: `baseline-measurements.json`.
