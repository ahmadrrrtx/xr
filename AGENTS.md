# AGENTS.md — how to work in this repository

A briefing for coding agents (and humans in a hurry). Human onboarding lives in
[README.md](README.md); the full contributor guide is [CONTRIBUTING.md](CONTRIBUTING.md).
**The law this codebase cites is [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md)** — if a rule
below feels arbitrary, the Article behind it is there.

## What this repo is

XR is a local-first, provider-neutral AI agent runtime: a Bun-written CLI + daemon + agent
loop, governed in the execution path (policy gate, approvals, budget governor, hash-chained
audit), with a Tauri v2 + React desktop shell, a mobile PWA, and a Next.js website.

```
src/        core runtime (cli, commands, execution, core, services, providers, tools,
            security, xr-shield, state, context, daemon, bots, mcp, plugins, voice, …)
desktop/    Tauri v2 shell (src = React UI; src-tauri = Rust shell + commands)
mobile/     mobile companion PWA · cloud/ = optional hosted control plane (independent version)
satellites/ extracted packages (@rrrtx/xr-enterprise, @rrrtx/business-os) — released separately
skills/     bundled skill manifests · test/ = suite mirroring src/ · scripts/ = gates & release machinery
docs/       product/development/release/security/historical · website/ = marketing site (Next.js)
```

## Setup

```bash
bun install --frozen-lockfile        # bun 1.3+ (pinned in .bun-version); node >= 20 for npm-installed builds
cd desktop && bun install            # REQUIRED before any typecheck that touches desktop (preflight fails with this exact hint)
```

## Routine commands

| Task | Command |
|---|---|
| Full gate battery (must be green before a PR) | `bun run ci` |
| Test suite | `bun test` (segmented per directory in low-memory environments) |
| Typecheck | `bun run typecheck` (root) · `node_modules` in `desktop/` required for desktop tsconfig |
| Gates (individually) | `release:check` · `claim-lint` · `channel:check` · `placeholder-lint` · `desktop:sink-lint` · `platform:parity:check` · `changelog:check` · `baseline:inventory` · `ci-capability-gate` · `api:schema:check` · `client:check` · `api:compat` · `boundaries` · `size-gate` · `hot-path-lint` · `ownership:check` · `website:marketplace:check` |
| Desktop shell build/test | `cd desktop && bun run build` · `cargo check --all-targets` + `cargo test --lib` in `desktop/src-tauri` (sidecar binary must exist first: `bun run scripts/compile-sidecar.ts`) |

## Hard rules (CI-enforced, do not bypass)

1. **Claims need evidence.** Every public claim is re-checked by `bun run claim-lint`; the README
   tuple block and the `<!-- XR:RELEASE-IDENTITY -->` region are machine-generated — never edit
   them by hand (run `bun run release:stamp`). Found an inaccurate claim? It is a bug; fix the
   claim or the code, not neither.
2. **Never weaken a security property, never silence a failing test.** Fix the cause or mark the
   test with an explicit skip + tracked reason. Approval, policy, budget and audit paths are
   fail-closed by design.
3. **One computation authority.** Surfaces must call the same engine; do not fork logic per
   surface. Runner is the only code that may drive the agent loop.
4. **Layering is pinned.** surfaces → services → execution/core → state; tools/providers are
   leaves. Core imports **nothing** from `satellites/` (enforced three ways). `bun run boundaries`
   + `test/architecture/*` fail on violations.
5. **Size discipline.** `bun run size-gate` holds an explicit LOC ceiling with named, reasoned
   waivers only (`docs/perf/SIZE-WAIVERS.json`).
6. **Claim/Aritcle citations must exist.** the constitution gate fails if code cites an
   `Article N` not present in `docs/CONSTITUTION.md`.

## Working style

- One reviewable commit per issue; conventional-commit style (`feat(cli): …`, `fix(ci): …`).
- Regression test with every fix; keep the full suite green on every commit.
- Verify, never assume: run the code, tests, builds. If something cannot be reproduced, say so
  instead of guessing.
- Security concerns → [SECURITY.md](SECURITY.md) (private disclosure channel).
