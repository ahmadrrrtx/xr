# XR 3.1.6 Validation Report

Generated: 2026-07-26T23:09:15.914Z

Status: **PASS**

Commit: `9ce62bbb75a1d7c94a5c7e720bb2d3af05d56940`

Environment: Bun 1.3.14, Node v24.3.0, linux/x64.

Isolated XR_HOME: `/tmp/xr-validate-1785107332354`

| Step | Required | Status | Duration ms | Command |
|---|---:|---|---:|---|
| version-sync | yes | pass | 31.8 | `bun run set-version:check` |
| typecheck | yes | pass | 11720.9 | `bun run typecheck` |
| test | yes | pass | 10020.8 | `bun test` |
| inventory | yes | pass | 45.4 | `bun run scripts/baseline-inventory.ts` |
| cli-version | yes | pass | 156.8 | `bun run src/index.ts --version` |
| cli-help | yes | pass | 157.8 | `bun run src/index.ts help` |
| doctor-json | yes | pass | 979.1 | `bun run src/index.ts doctor --json` |
| daemon-unit | yes | pass | 406.5 | `bun test test/daemon.test.ts` |
| install-sh-syntax | yes | pass | 3.5 | `bash -n install.sh` |
| package-dry-run | yes | pass | 36.0 | `bun pm pack --dry-run` |
| windows-install-ps1 | no | skip | 0.0 | `powershell -File install.ps1` |
| docker-build | no | skip | 0.0 | `docker build .` |
| optional-cloud-providers | no | skip | 0.0 | `xr providers test` |

## Skipped optional checks

- windows-install-ps1: Windows validation requires a Windows runner; support matrix marks Windows as not verified in this Linux run.
- docker-build: Docker CLI/daemon is unavailable in this environment; Docker remains blocked for release sign-off until run on a Docker-capable host.
- optional-cloud-providers: Required baseline must not depend on cloud credentials or network.

## Known limitations

- This validation run is Linux-only unless a Windows/macOS runner executes the same command.
- Cloud providers and local model servers are discovery/health-checked but not required without user credentials/runtimes.
- Performance numbers are produced by scripts/measure-baseline.ts and are host-specific.

Machine-readable report: `validation-report.json`.
