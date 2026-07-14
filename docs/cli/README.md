# XR CLI (3.1C)

The XR CLI is the scriptable, pipeable entry to the same operating system as the Shell and Control Center.

## Quick start

```bash
xr onboarding
xr                  # Shell
xr "hello"          # one-shot agent
xr serve            # Control Center
xr help
xr doctor
```

## Global flags

See `xr help scripting` or `docs/xr-3.1/XR-3.1C-COMMAND-ARCHITECTURE.md`.

## Architecture

| Module | Role |
|---|---|
| `src/cli/router.ts` | argv routing + kernel lifecycle |
| `src/cli/catalog.ts` | command metadata |
| `src/cli/help.ts` | help renderer |
| `src/cli/flags.ts` | global flags + exit codes |
| `src/cli/output.ts` | human/JSON/YAML output |
| `src/cli/errors.ts` | CliError + fatal handler |
| `src/commands/*` | command adapters (backend calls only) |

## Design sources

Immutable product specs under `docs/xr-3.1/` — especially Design System, IA, Navigation, Accessibility, Performance.
