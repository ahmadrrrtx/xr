![XR — cybernetic guardian avatar](assets/avatar.png)

<div align="center">

```
▀▄▀ █▀█
█░█ █▀▄
```

# XR — The AI Agent Runtime You Can Actually Audit

**BYOK · local-first · spend-capped · tamper-evident · provider-neutral · plugin + MCP platform**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-9a6bff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20·%20macOS%20·%20Windows%20·%20Termux-00d2ff?style=flat-square)](https://bun.sh/)

</div>

<!-- XR:RELEASE-IDENTITY:BEGIN -->
<!-- GENERATED from release.manifest.json — do not edit by hand. Run: bun run release:stamp -->

**Version:** `7.1.0 (Truth)` · **Package:** [`@rrrtx/xr`](https://www.npmjs.com/package/@rrrtx/xr) · **License:** MIT

> **Status: Public Beta.** @rrrtx/xr is honestly labeled beta software: install and use it,
> expect the documented golden path to work on the validated platforms, and check the
> [support matrix](docs/release/SUPPORT_MATRIX.md) and
> [known-limitations register](docs/release/7.1.0/known-limitations.md) before adopting it
> for anything critical. `v*-beta.*` tags land on the prerelease channel (npm `beta` dist-tag,
> GitHub prerelease) for early adopters; feedback goes through the
> [beta loop](docs/release/BETA.md).

> **Version source of truth:** [`release.manifest.json`](release.manifest.json). Every surface —
> `src/core/version.ts`, `package.json`, this README, `install.sh`, `install.ps1` and the website —
> is stamped from that one file, and CI fails the build if any of them drift
> (Constitution Article XXII.1).

XR — a local-first, provider-neutral AI agent runtime. BYOK, spend-capped, tamper-evident audit, plugin/MCP extensibility.

**Bundled skills:** 65 (counted from `skills/` at release time.)
<!-- XR:RELEASE-IDENTITY:END -->

> **You bring the key. We ship none.** XR runs on *your* provider API key or *your* local
> model. Nothing leaves your machine unless you configured it to.

---

## What XR is — and what it is not

XR is a **local-first, provider-neutral AI agent runtime**: a CLI, fullscreen shell, local
dashboard and automation engine that plans and executes multi-step tasks against your
filesystem, tools and models — under a deterministic policy gate, human approval on
consequential actions, per-task spend ceilings, and a hash-chained audit log you can verify
offline. Every capability claim on this page is backed by evidence recorded in
[`release.manifest.json`](release.manifest.json) and re-checked in CI by `bun run claim-lint`.

**XR is:**

- a **self-hosted agent runtime** — no mandatory cloud, no telemetry;
- **provider-neutral** — 26 presets, 16 hosted (BYOK) + 10 local runtimes, one switch command;
- **governed** — policy, approvals, budgets and audit are enforced in the execution path, not promised in docs;
- **extensible** — skills, plugins and MCP servers reachable identically from every surface;
- **MIT-licensed** and readable end to end.

**XR is not:**

- **not certified** against SOC 2, ISO 27001, HIPAA, PCI-DSS or FedRAMP — no external audit exists;
- **not a sandbox** — in-process policy enforcement, not kernel or VM isolation;
- **not a hosted product** — there is no XR cloud;
- **not a substitute** for a human reviewing consequential actions;
- **not finished** — the [known-limitations register](docs/security/KNOWN_LIMITATIONS.md) is a
  first-class release artifact, and the release docs state precisely what beta means today
  ([support matrix](docs/release/SUPPORT_MATRIX.md)).

---

## Install & first task

**One canonical build, many channels.** Every channel installs the same signed artifacts
(cosign keyless signatures + SHA256SUMS + SBOM + SLSA provenance — verify with
[`docs/release/VERIFYING_RELEASES.md`](docs/release/VERIFYING_RELEASES.md)). The default
distribution is the compiled per-target binary; source checkout is the contributor path.

| Channel | Platform | Command | Status |
|---|---|---|---|
| **Binary (default, verified)** | Linux / macOS / Termux / WSL | `curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh \| bash` | install-success survey (≥99% gate) runs nightly per OS family — job introduced by Phase 9, first runner evidence lands with the merge; locally 3/3 @ 7.1.0 |
| **Binary (default, verified)** | Windows PowerShell | `iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)` | same job, Windows lane |
| **Homebrew** | macOS / Linux | `brew install ahmadrrrtx/tap/xr` | formula generated + verified in CI; tap publication from the first tagged release |
| **WinGet** | Windows | `winget install ahmadrrrtx.XR` | manifests generated + verified in CI; community-repo submission follows the first tagged release |
| **Scoop** | Windows | download `scoop/xr.json` from the release · `scoop install ./xr.json` | manifest generated + verified in CI |
| **.deb** | Debian / Ubuntu | download `xr_<ver>_amd64.deb` from the [release](https://github.com/ahmadrrrtx/xr/releases) · `sudo dpkg -i xr_*_amd64.deb` | real `dpkg` install + remove tested on every PR |
| **Docker** | any container runtime | `docker run ghcr.io/ahmadrrrtx/xr:latest` | image built + scanned in CI; GHCR publication from the first tagged release |
| **npm** | any | `bun add -g @rrrtx/xr` | published by the release workflow with OIDC provenance |
| **Prerelease (beta channel)** | any | tags `v*-beta.*` → npm `beta` dist-tag · `docker run ghcr.io/ahmadrrrtx/xr:beta` | prerelease handling is part of the release workflow |

Channel configs are **generated from the release manifest** and drift-gated
(`bun run channel:check` runs in CI), so a channel can never fall behind the release it
serves. Publication status per channel is tracked in
[`docs/release/SUPPORT_MATRIX.md`](docs/release/SUPPORT_MATRIX.md).

```bash
# After install
xr onboarding        # guided first-run wizard (memory + optional voice)
xr doctor            # health check — exits non-zero if XR cannot actually work
xr "hello, XR"       # your first task
xr                   # the fullscreen shell
xr serve             # dashboard + chat at http://localhost:3141 (127.0.0.1, token-authed)
```

New here? Follow the golden path: [`docs/development/GETTING_STARTED.md`](docs/development/GETTING_STARTED.md).

---

## Architecture

### Design principles

1. **One computation authority per question.** Whatever answers a question for you answers it
   for every surface and for CI — doctor's readiness engine is the onboarding capability scan;
   the cross-platform test suite is one file list (`scripts/platform-parity.ts`) executed per
   OS; channel configs are generated, never handwritten.
2. **No bypass around the runner.** Every agent turn flows through a single execution
   envelope → runner → loop pipeline. Policy, approvals, budget, cancellation and audit are
   properties of the pipeline, so they cannot be skipped by an interface.
3. **Honest outcomes.** A run ends `success`, `failed`, or `cancelled` — never a fake
   completion. Cooperative cancellation is real (checkpoints inside the loop); when an action
   cannot be interrupted, XR stamps the honest outcome instead of claiming it stopped cleanly.
4. **State you can inspect.** One SQLite database per install, hash-chained audit events,
   exportable sessions, reproducible inventory.
5. **Fast path stays fast.** Commands boot only the subsystems they need (boot profiles), the
   hot path performs zero synchronous FS/process I/O (lint-enforced), and budgets are CI-gated.

### The runtime map

```
                        terminals · browsers · CI scripts · chat clients
                                        │
   ┌────────────────────────── SURFACES ┴──────────────────────────────────────┐
   │  xr <task> (CLI)   fullscreen Shell   Telegram bot   `xr serve` daemon     │
   │  src/commands/*    src/interfaces/    src/telegram   src/daemon — 127.0.0.1│
   │                    shell + TUI                       dashboard, token auth │
   └──────────────────────────────────┬────────────────────────────────────────┘
                                      │  one contract: AgentService.execute(request)
                        ┌─────────────▼──────────────┐
                        │   EXECUTION FABRIC          │   src/execution
                        │   envelope · state machine  │   idempotency keys
                        │   leases · checkpoints      │   cancellation tokens
                        │   runner = sole loop caller │   inspection/repository
                        └─────────────┬──────────────┘
                                      ▼
                        ┌────────────────────────────┐
                        │   AGENT LOOP src/core/agent │  steps with checkpoints
                        │   chat → tools → observe    │  plan/act hybrid
                        │   turn-repair (strict JSON) │  src/reliability
                        │   memory & provenance writes│
                        └───┬───────────┬───────────┬─┘
                            │           │           │
        ┌───────────────────▼──┐  ┌─────▼───────┐  ┌▼─────────────────────┐
        │ PROVIDERS            │  │ TOOLS        │  │ MEMORY & CONTEXT      │
        │ src/providers        │  │ src/tools    │  │ src/context           │
        │ 26 presets, 5 native │  │ files/git/   │  │ retrieval, embeddings │
        │ adapters + OpenAI-   │  │ shell/browse │  │ compression, conflicts│
        │ compatible transport │  │ guarded      │  │ session summaries     │
        │ health() + failover  │  │ registry     │  │ src/research engine   │
        └──────────────────────┘  └──────────────┘  └───────────────────────┘
                            │           │           │
   ┌─────────────── TRUST PLANE (cross-cutting, enforced in the same pipeline) ───────────┐
   │ policy gate src/security/guard · approvals src/control/approvals · budget governor    │
   │ src/cost · egress allowlist (egress-proxy) · secrets vault (OS keychain else AES-256- │
   │ GCM sealed file) · hash-chained audit log src/state/workspace-store → xr audit verify │
   └──────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                 ┌────────────────────▼─────────────────────┐
                 │ LOCAL STATE (src/state)                   │
                 │ SQLite workspace store · migrations       │
                 │ write-gate · repos · idempotency          │
                 └───────────────────────────────────────────┘

   EXTENSIBILITY (invoked by the loop, governed by the same trust plane)
   skills/ 65 bundled · plugins src/plugins (manifest + permissions)
   MCP servers src/mcp (allowlist, transports) · templates 11 built-in workflows
```

### What happens to one task

Every surface — `xr "…"`, the Shell, Telegram, the daemon chat — funnels into the same call.
This is the exact pipeline each request travels (checkpoints enforced in code):

```
request
  │
  ▼
AgentService.execute ──▶ execution envelope        state machine + idempotency + audit seed
  │                          │
  │                          ▼
  │                     RUNNER (the only code allowed to drive the loop)
  │                          │
  │            ┌─────────────┴── per step ────────────────────────────────┐
  │            │ ⓪ abort checkpoint → cancelled? stop now, honestly      │
  │            │ ① chat completion — provider failover, tokens metered   │
  │            │ ② turn-repair: model output must satisfy the strict     │
  │            │   turn contract (src/reliability) or the step fails     │
  │            │ ③ post-chat abort checkpoint                            │
  │            │ ④ for each tool call:                                   │
  │            │     • approval needed? denied ⇒ tool error, never run   │
  │            │     • policy gate (risk classes, egress allow-list)     │
  │            │     • budget governor — exceeded ⇒ stop, spend-capped   │
  │            │     • execute tool → observation appended               │
  │            │     • between-calls abort checkpoint                    │
  │            │ ⑤ memory delta + provenance events                      │
  │            └── until done · budget stop · cancelled · guardrail ─────┘
  │
  ▼
outcome: success | failed | cancelled           — never "completed" by default
  │
  ▼
audit chain: every event SHA-256-linked into the install's hash chain;
verify offline with `xr audit verify` / `xr verify-log`
```

Interrupt semantics are real: in the Shell, `Ctrl+C` / `Esc` stop the current run (a pending
approval is denied fail-closed first); `xr run` maps the first `SIGINT` to a cooperative wrap
and exits `130`, a second `SIGINT` forces exit. `stopWorkflow` cancels the in-flight worker of
a multi-agent run; the worker fails honestly ("interrupted"), never reports completion.

### The trust plane in detail

| Mechanism | Where | What it enforces |
|---|---|---|
| Policy gate | `src/security/guard.ts`, `policies.ts` | Risk-classed rules over every tool effect; dangerous classes require approval |
| Approvals | `src/control/approvals.ts` | Human consent for consequential actions, per workspace, auditable |
| Budget governor | `src/cost/governor.ts` | USD + token ceilings per task, checked before and during steps |
| Egress allow-list | `src/security/egress-proxy.ts` | Only configured domains receive data |
| Secrets | `src/config/config.ts` | OS keychain where available; else AES-256-GCM sealed file (auto-migrates plaintext); values are redacted from status output |
| Audit chain | `src/state/workspace-store.ts`, `src/commands/audit.ts` | SHA-256-linked events; `xr audit verify` / `xr verify-log` verify offline |
| Plugin trust | `src/plugins/` | Manifest permissions, tree hashes, static scan, health checks, disable/remove |

> **Honesty box:** XR enforces **in-process policy**, not kernel/VM isolation; it is a guard
> rail, not a confinement boundary. It is not a substitute for reviewing consequential
> actions. The gaps are written down, not hidden:
> [`docs/security/KNOWN_LIMITATIONS.md`](docs/security/KNOWN_LIMITATIONS.md).

### Multi-agent workflows

`src/services/multi-agent-service.ts` (+ `src/agents/`) runs a planner → reviewer →
synthesizer pipeline with a deterministic security gate between stages:

```bash
xr agents list
xr agents plan "refactor this repo safely"
```

- The **review gate consumes a strict-JSON decision** from the deterministic
  `security_checker`; prose-only reviewers fail closed (an unparsable verdict blocks the run
  rather than waving it through).
- **Honest failure mapping:** transport errors, budget stops and approval stops mark the task
  failed instead of faking completion.
- **Cancellation is workload-aware:** stopping a workflow aborts the in-flight worker via a
  live run map; the worker's outcome is recorded as cancelled, and remaining work is marked,
  never silently dropped.

### Extensibility: skills, plugins, MCP

| Layer | Truth surface | Notes |
|---|---|---|
| **Skills** | `skills/` (bundled set — count in the stamped block above, mechanically verified in CI) | manifest-governed (`xr-skill.json`), unified loader + registry + resolver + validator; `xr skill browse/install/…`; SDK: `init/create/build/package/validate/publish/doctor/test` |
| **Plugins** | `src/plugins/` | explicit permissions, hash verification, lifecycle (discover → install → enable → update → rollback → quarantine → uninstall), certification gate |
| **MCP** | `src/mcp/` | client + manager + registry over stdio/SSE/HTTP transports with an allowlist; `xr mcp …` full command surface |
| **Workflow templates** | `src/templates/workflows/` | 11 built-in multi-step templates |

### Memory, research, voice, control

- **Memory engine** (`src/context/`): consent-first capture (only what you ask it to remember),
  categorized + scoped entries, TTL/expiry with `xr memory prune`, explainable retrieval
  (`xr memory recall "…"` shows match % and why), optional session summaries. Config and
  dashboard panel included.
- **Research engine** (`src/research/`): offline by default; `xr research deep --allow-public-web`
  opts into live fetching with egress rules and per-run budgets; results carry source
  provenance into memory if you allow it.
- **Voice stack** (`src/interfaces/`, commands `xr voice …`): optional, local-first adapters;
  voice can trigger capabilities through the same governed pipeline (approvals still apply).
- **Computer control** (`src/control/`, `src/computer/`): guarded desktop actions behind the
  approval plane; the vision agent is opt-in; platform support and limits are documented per OS.

### Repository map

```
xr/
├─ bin/xr                    compiled-binary-first launcher (falls back to source)
├─ src/
│  ├─ cli/                   router, catalog, lazy command loaders, flags, exit codes
│  ├─ commands/              one file per CLI command (run, doctor, agents, mcp, audit…)
│  ├─ interfaces/            shell + TUI, providers/models pickers, onboarding
│  ├─ core/                  kernel: DI container/lifecycle (app.ts), agent loop (agent.ts)
│  ├─ services/              agent-service, multi-agent-service, budget-, config-, mcp-service
│  ├─ execution/             envelope, runner-equivalents, state machine, adapters, leases
│  ├─ agents/                multi-agent planner/registry/types
│  ├─ providers/             presets, factory, health, native adapters, openai-compat
│  ├─ tools/                 tool registry + guarded tools (files, git, control, egress)
│  ├─ reliability/           turn repair, grammar, profiles
│  ├─ security/              guard, policies, egress-proxy, attack lab, private-ip checks
│  ├─ state/                 SQLite workspace store, repos, write-gate, migrations
│  ├─ context/               memory: assembler, retrieval, embeddings, compression
│  ├─ research/              research engine (offline default, opt-in web)
│  ├─ mcp/  plugins/  skills/  local/  cost/  control/  computer/  telegram/
│  ├─ daemon/                `xr serve`: API routes, dashboard, chat (127.0.0.1)
│  ├─ enterprise/            optional governance/evaluation surfaces
│  ├─ update/  install/      atomic updater + channels; install/uninstall
│  ├─ observability/  ui/    metrics/logs/exporters; design system
│  └─ index.ts               CLI entry
├─ extensions/business-os/   business extension — optional, default-off, effect-verified
├─ skills/                   bundled skill manifests
├─ plugins/                  bundled plugins
├─ scripts/                  gates, release machinery, parity runner, perf budgets
├─ test/                     226-file suite (mirrors src/ areas) + helpers + fixtures
├─ docs/                     product, development, release, security, historical
└─ website/                  docs/marketing site (Next.js; scanned by claim-lint)
```

Layering is enforced in CI: the `boundaries` gate + `test/architecture/*` pin the allowed
dependency directions (surfaces → services → execution/core → state; tools/providers as
leaves), and the ownership map (`bun run ownership:check`) requires every source area to have
an owning document.

---

## Providers

XR ships **26 built-in provider presets — 16 hosted and 10 local runtimes**. Swap anytime —
no restart, no re-config.

> Counted from `PRESETS` in `src/providers/presets.ts`. Provider count is not a measure of
> product quality and is deliberately not scored by `xr evaluate`.

**How they connect:** five hosted providers run dedicated native API adapters (Anthropic,
Google, Mistral, Cohere, AWS Bedrock). Every other preset — the remaining hosted providers
and all ten local runtimes — speaks the **OpenAI-compatible protocol** through one transport
(`src/providers/openai-compat.ts`), and a custom preset can point at any OpenAI-compatible
base URL. (A native Cerebras adapter also ships in `src/providers/native/`; the built-in
Cerebras preset uses Cerebras's OpenAI-compatible endpoint.)

Default models below are the presets' launch defaults (`defaultModel`) — not ceilings:
`xr providers set <id> <model>` switches to any model the provider offers through a
preflight → canary → swap → verify state machine that rolls back automatically if the new
model cannot be reached (`--force` skips the probe).

| Provider | Type | Default model |
|---|---|---|
| **Ollama** | Local | `qwen2.5:7b` — auto-detect, model pull, free |
| **LM Studio, llama.cpp, Jan, LocalAI, vLLM, GPT4All, KoboldCPP, Text-Generation-WebUI, SGLang** | Local | picked per install |
| **Claude** (Anthropic) | Hosted · native adapter | `claude-3-5-sonnet-20241022` |
| **Gemini** (Google) | Hosted · native adapter | `gemini-1.5-flash` |
| **Mistral** | Hosted · native adapter | `mistral-small-latest` |
| **Cohere** | Hosted · native adapter | `command-r-plus-08-2024` |
| **AWS Bedrock** | Hosted · native adapter | `claude-3-sonnet` |
| **OpenAI** | Hosted | `gpt-4o-mini` |
| **Groq** | Hosted | `llama-3.3-70b-versatile` |
| **DeepSeek** | Hosted | `deepseek-chat` |
| **Cerebras** | Hosted | `cerebras/csm-8b` |
| **Together AI** | Hosted | `Llama-3.3-70B-Instruct-Turbo` |
| **Fireworks** | Hosted | `llama-v3p1-70b-instruct` |
| **SambaNova** | Hosted | `Llama-3.1-70B-Instruct` |
| **Hugging Face** | Hosted | `Llama-3.1-8B-Instruct` |
| **OpenRouter** | Hosted | `anthropic/claude-3.5-sonnet` |
| **xAI** | Hosted | `grok-2-latest` |
| **Perplexity** | Hosted | `llama-3.1-sonar-large-128k-online` |
| + any OpenAI-compatible endpoint | Local/Hosted | your base URL |

```bash
xr providers list
xr providers set openai gpt-4o-mini
xr providers add claude     # enter API key (masked; OS keychain, else AES-256-GCM sealed file)
xr providers test           # probe configured providers live
```

Provider canaries also exist for CI: `bun run canary:providers` live-probes each
key-configured preset through its own `health()` and fails on a dead provider (honest SKIP
for unconfigured ones).

---

## Readiness, scripting & exit codes

`xr doctor` answers one question: **can XR actually run a task right now?**

- exits non-zero when no provider is reachable, and says why plus one next action;
- never prints `ok: true` for a system that cannot do work;
- `--deep` adds voice, control, capability and environment probes;
- `xr doctor --json` is the stable machine-readable entrypoint (redacted config, provider
  readiness, `summary.runnable` verdict; secrets are never printed — only presence).

Exit codes are stable for scripting (`docs/guides/cli-compat.md`):

| Code | Meaning |
|---|---|
| `0` | ok |
| `1` | runtime/task failure |
| `2` | usage error |
| `3` | network |
| `4` | denied |
| `5` | not found |
| `130` | interrupted (Ctrl+C / SIGINT) |

---

## Performance — budgets, not boasts

Every performance claim is a **published budget with a measured baseline and a CI regression
gate**:

- `--version` / `--help` **p95 < 150 ms warm / < 300 ms cold** (measured 37.5 / 40.7 ms warm,
  35.9 / 40.0 ms cold on the 7.1.0 baseline);
- `doctor` **< 1 s measured** (456 ms; gate ceiling 1500 ms for shared runners) · route
  decision **< 20 ms** (sub-ms) · dashboard first render **< 1 s** (5.7 ms) · retrieval
  **25–33 ms @100k items** (gate ceiling 250 ms);
- fast path performs **zero synchronous FS/process I/O** (lint-enforced);
- a command boots only the subsystems it needs (boot profiles).

Full budgets, the boot-profile model, the regression gate and profiling tooling:
[`docs/perf/PERF-BUDGETS.md`](docs/perf/PERF-BUDGETS.md). Baseline artifact:
`docs/perf/baseline-7.1.0-source.json` (regenerate per release with `bun run perf:baseline`).

---

## How XR proves itself (quality machinery)

XR's differentiator is that its claims are checked by machines on every PR:

| Gate | What it pins |
|---|---|
| `bun test` + parity suite | **2,812 tests** across 226 files; one computation authority (`scripts/platform-parity.ts`) executed per OS on Linux/macOS/Windows via segmented runs with crash-class retry and self-diagnosing failure annotations |
| `release:check` + `claim-lint` | version identity stamped everywhere; every public claim has evidence; prohibited/supervised terms fail the build |
| `baseline:inventory` | source-derived repository inventory regenerated and compared |
| `boundaries` + `ownership:check` + `size-gate` | layering, area ownership, file-size discipline (waivers are explicit) |
| `api:schema:check` + `client:check` + `api:compat` | daemon OpenAPI schema, generated client, compatibility |
| `channel:check` | channel configs match the release manifest |
| supply chain lanes | osv-scanner + bun audit, gitleaks, license scan, SBOM drift, `-ignore-scripts` hygiene, container scan |
| Quality Gate | single required aggregation check over all of the above |
| `xr evaluate` | outcome-based benchmark harness: scenarios pass only when reality is inspected (artifact on disk, durable record, state transition, audit chain) — see below |

```bash
xr evaluate run --offline      # 14 suites, 38 scenarios, no network required
xr evaluate claims             # every public claim mapped to its evidence
xr evaluate limitations        # what the benchmarks do NOT measure
xr evaluate compare <a> <b>    # regression detection between releases
xr evaluate export <runId>     # hash-verifiable evidence bundle
```

---

## Uninstall & data

`xr uninstall` removes the binary, PATH entry and data directory with explicit flags for what
to keep; the exact matrix is written down in
[`docs/development/GETTING_STARTED.md`](docs/development/GETTING_STARTED.md) and
[`docs/release/SUPPORT_MATRIX.md`](docs/release/SUPPORT_MATRIX.md). Updates and rollback
follow the channel you installed from (`brew upgrade xr`, `winget upgrade ahmadrrrtx.XR`,
`apt-get install --only-upgrade xr`, or `xr update` for the binary/npm/git layouts) and are
atomic with an automatic rollback path.

---

## Documentation map

| Doc | Purpose |
|---|---|
| [`docs/development/GETTING_STARTED.md`](docs/development/GETTING_STARTED.md) | The golden path: install → onboarding → provider → first task → restart/resume → uninstall |
| [`docs/guides/cli-compat.md`](docs/guides/cli-compat.md) | Exit codes, global flags, `--yes` semantics, scripting envs, prompt-piping rules |
| [`docs/security/KNOWN_LIMITATIONS.md`](docs/security/KNOWN_LIMITATIONS.md) | Canonical known-limitations register (living) |
| [`docs/release/SUPPORT_MATRIX.md`](docs/release/SUPPORT_MATRIX.md) | Platform/channel support truth per release |
| [`docs/release/BETA.md`](docs/release/BETA.md) | Beta loop and feedback channel |
| [`docs/release/VERIFYING_RELEASES.md`](docs/release/VERIFYING_RELEASES.md) | cosign/SBOM/SLSA verification walkthrough |
| [`docs/`](docs/README.md) | Full documentation index |

---

## Contributing

Contributions are welcome — read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[security policy](SECURITY.md) first. The quality bar is the same for humans and agents:
every change ships with tests, passes the local gate battery, and keeps claims honest.

```bash
git clone https://github.com/ahmadrrrtx/xr && cd xr
bun install --frozen-lockfile
bun run ci        # typecheck + tests + release:check + claim-lint + inventory
```

## License

MIT — see [LICENSE](LICENSE). XR is free software; there is no paid tier, no telemetry, and
no lock-in.
