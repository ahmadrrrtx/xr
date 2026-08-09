# XR Phase 3 — Before/After Measurements (corrected, fixed harness)

Same host, same harness (`scripts/perf/harness.ts`), isolated XR_HOME, 21 samples,
single-outlier trim. BEFORE = pristine `main` b8be112 measured via a git worktree;
AFTER = Phase 3 tree. (Note: an early harness bug — scenario argv never appended —
was found and fixed before these numbers; the fixed harness measures the actual
commands, not the bare shell path.)

## Process scenarios (p95, ms)

| Scenario | BEFORE | AFTER | Δ | Budget |
|---|---:|---:|---:|---:|
| `--version` warm | 219.2 | **47.4** | −78% | 150 ✅ |
| `--version` cold | 269.5 | **55.7** | −79% | 300 ✅ |
| `--help` warm | 261.0 | **43.9** | −83% | 150 ✅ |
| `--help` cold | 254.4 | **42.6** | −83% | 300 ✅ |
| `doctor --json` warm | 640.7 | **474.4** | −26% | 1500 ✅ |

> Budget column = Constitution Article XII ceilings (150/300 ms). Measured
> values also meet the Phase 3 spec's tighter 100/150 ms targets.

## In-process benches (p95, ms)

| Scenario | BEFORE | AFTER | Budget |
|---|---:|---:|---:|
| route decision | 0.003 | 0.003 | 20 ✅ |
| dashboard first render | 15.4 | 15.6 | 1000 ✅ |
| retrieval @100k | 37.1 | 33.7 | 100 ✅ |

## Boot-profile evidence (AFTER)

| Command | Providers booted | Kernel imported? |
|---|---|---|
| `--version` | none | no |
| `--help` | none | no |
| `config get provider` | config | yes (1 provider) |
| `doctor` | state, config, providers, capabilities | yes (4) |
| `skills list` | skills | yes (1) |
| `run` | agent closure (7) | yes |

## Component measurements

| Component | BEFORE | AFTER |
|---|---|---|
| router static-graph module eval | 213.9 ms | ~13 lightweight modules |
| skills loader `load()` | 79 ms | 22 ms (cache hit) |
| `config get provider` end-to-end | ~172 ms | ~100 ms |
| `memory reindex` (unchanged store) | re-embeds 100% | skips 100% of unchanged rows |
| `bin/xr.cjs` (node→bun spawn) | +35–50 ms/invocation | removed from default path |

## Notes

- Host: 2 vCPU / ~2 GB sandbox with tmpfs /tmp — numbers are host-specific;
  the deltas and budget compliance are the claims, enforced on CI by
  `scripts/perf-gate.ts` against the committed baseline
  (`docs/perf/baseline-7.0.1-source.json`).
