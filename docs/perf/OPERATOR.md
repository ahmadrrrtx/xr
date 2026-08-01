# XR Phase 3 — Operator Guide (performance & the compiled binary)

## Installing the compiled binary (default distribution path)

Two first-class install paths, both free of the legacy node→Bun spawn wrapper:

1. **install.sh / install.ps1 (binary-first, Phase 3 · T2):** the installer
   downloads the standalone binary for your platform
   (`xr-linux-x64`, `xr-linux-arm64`, `xr-darwin-arm64`, `xr-darwin-x64`,
   `xr-windows-x64.exe`) from the GitHub release feed into `$XR_HOME/dist/`,
   verifies it boots, and installs a launcher that **execs the binary
   directly**. If the release feed is unreachable it falls back to the source
   checkout (contributor path).
2. **npm (`bin/xr`, Bun required):** the launcher prefers `dist/<platform>`
   when present, otherwise runs the CLI from source in-process. The legacy
   `bin/xr.cjs` (node→Bun spawn) is retained only for environments that invoke
   the package through `node` directly — it is no longer the default.

Expected latencies on a modern machine (p95, warm):

| Command | Binary | Source |
|---|---:|---:|
| `xr --version` | ~70 ms | ~90 ms |
| `xr --help` | ~80 ms | ~100 ms |
| `xr doctor --json` | ~90 ms | ~90 ms |
| `xr config get provider` | ~70 ms | ~100 ms |

## Updating

`xr update` now understands the **binary layout** (one contract across
git/npm/binary, Phase 1 · T11): it downloads the platform binary for the
release-manifest version into a staging slot, runs the health canary
(`--version` + `doctor`) against an isolated XR_HOME, then performs the
blue-green atomic swap with automatic rollback on failure. Binaries are
**unsigned** — integrity verification via signing arrives in Phase 9.

## Diagnosing a slow command

```sh
XR_TRACE_BOOT=1 xr <command>        # per-phase boot trace on stderr
xr providers metrics                # streaming metrics (TTFT, tokens/s, …)
xr doctor                           # readiness
```

If a command feels slow, the trace shows which phase dominates
(kernel-import / register / start / execute) and the stall detector
(`XRApp.stallDetector`) reports any event-loop block > 200 ms.

## The regression gate (for release managers)

Every PR runs the `perf-gate` CI job: the scenario matrix is measured in an
isolated XR_HOME and compared against the published budgets
(`scripts/perf/budgets.json`) and the versioned baseline
(`docs/perf/baseline-7.0.1-source.json`, 10% noise budget). A failure without
a ratified waiver blocks merge. Baselines are regenerated per release:
`bun run perf:baseline --samples 21 --mode source` (commit the artifact).
