# Phase 23 — CLI coding agent · study notes

Status: **study only — no code yet.** Branch `phase/23-cli` (local). Base: `main` @ 93317ca (Phase 22 merged).

## What the brief assumes vs. what the repo contains

| Brief claim | Repo reality (verified) |
|---|---|
| `bin/xr` is a shebang entry to create/fix | `bin/xr` exists: Node-ESM launcher. Runs `dist/xr-<platform>` if present, else `bun run src/index.ts`, else prints a Bun install hint (exit 127). `bin/xr.cjs` is an older duplicate launcher. |
| `src/cli/` is 2920 lines of framework | Confirmed: 2929 lines (router, kernel-boot, flags, output, errors, help, catalog, command-loaders, route-decision). |
| "No TUI/REPL for coding yet"; bare `xr` routes elsewhere | **Bare `xr` in a TTY opens the full-screen Shell** (`src/interfaces/shell/app.ts`, Phase 3.1 `runShell`). Changing the default is a breaking change to a shipped surface. |
| Free-form tasks need a new path | `xr "task"` already routes to the `run` command (agent mode, `--mode agent|plan|ask`, `--budget`). |
| `xr ask "prompt"` should be a one-shot coder alias | `ask` **already exists** as a read-only, no-tools Q&A command (`src/commands/ask-plan.ts`). Name clash. |
| `--version` is a fast path | Confirmed: `bun run src/index.ts --version` → `v1.0.0 (Truth)` in ~40 ms with no kernel boot. |
| Boot profiles exist; add a `coder` profile | `src/core/boot-profile.ts` has `PROVIDER_REQUIRES` + `profileForCommand`. Profiles are derived from per-command `Tokens.*` usage and tested in `test/perf/boot-profile.test.ts`. |
| Agent loop reusable | `src/core/agent.ts` `runAgentLoop(task, mode, deps)` — takes provider, cwd, `say()` sink, `tools.allow/deny`, `history`, stores, `maxSteps`. Streaming events via a sink. |
| Approval plane | `src/security/guard.ts` (`checkAction`, `PolicyDecision`, `scanUntrusted`, `pipe_to_shell` pattern already present) and `src/capabilities/` (`executeCapability`, grants, `loop-grant.ts`). ApprovalStore is referenced by the brief; not yet read in depth. |
| Secrets in keychain via SecretBroker | `src/security/secret-broker.ts` and `secrets.ts` exist. |
| `.xrignore` / repo map | `src/repo/` and `src/context/` exist; not yet read. |
| `docs/CONSTITUTION.md` (brief says `xr-CONSTITUTION.md`) | Present at `docs/CONSTITUTION.md`. Relevant: VI·Rule 4 (lazy startup), XII (perf bounded), XX (tests assert effects), XXI (privacy). |
| npm `@rrrtx/xr` name | **Already published: 1.0.0** (`npm view`). Version bump needed before any publish. |

## Scope conflict in the uploaded docs

Uploaded `xr-IMPLEMENTATION-PLAN.md` and `docs/IMPLEMENTATION-PLAN.md` (line 627) describe Phase 23 as a broad CLI (auth, chat, skills, memory, deploy, init, budget, models…). The build brief scopes it to **one coding-agent command only**. This study follows the brief.

## Environment

- Node v20.20.2, git 2.47.3. Bun was missing; installed `bun@1.3.14` to `~/.local` (global npm install needs root). Repo pins `.bun-version` = 1.3.14.
- No GitHub push credentials in the sandbox (`git ls-remote` works; push would need a token). No `gh`.
- No model API keys in the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` unset). Live-model runs are not possible without one.

## Open decisions (awaiting Ahmad)

1. Bare `xr` in a TTY: replace the Shell with the coding REPL, or keep the Shell and expose the REPL another way?
2. `xr ask`: repoint to one-shot coder, or keep the existing read-only `ask` and rely on `xr "…"` / `xr -p`?
3. Delivery: push credentials for `ahmadrrrtx/xr`, or a local commit plus a patch bundle?
4. Model access for live testing: an API key for the sandbox, or mock-provider tests only?
