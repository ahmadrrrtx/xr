# XR Preview 1 — feature tiers

Plan section 5. The rule: **a feature moves down a tier rather than ship broken.** Tier 1 ships ON.
Tier 2 ships behind an Experimental label with a working path. Tier 3 is hidden or deferred.

These are **proposed tiers**, not an assertion that every advertised capability or in-app label has
been verified. Listed evidence is limited to the specific tests or runs cited; a row that could
not be exercised says so. Owner decisions on the affected Tier 2 / Tier 3 features remain open.

| Feature | Tier | Evidence | Notes / what a user should expect |
|---|---|---|---|
| **Coder CLI** (`xr`, one-shot, `-p`, `--diff`, `--json`, piped stdin, approvals) | **1 — ON** | `test/cli` 262 pass; smoke lane on Linux and Windows; `journey:cli` end to end (install → launch → agent task → update → uninstall) | unattended runs deny shell with exit code 4 |
| **Providers & BYOK** (26 presets, switch, canary, rollback) | **1 — ON** | `test/providers` 120 pass; `consumer-smoke` green against the built-in local preset; real-provider run on Groq (T07, `SMOKE-OK`) | key goes to the sealed broker; ambient `export` is ignored unless `XR_SECRETS_ENV_COMPAT=1` |
| **Spend caps & budget governor** | **1 — ON** | `test/cost` 6, `test/cost-adversarial` 5 (mutation-proven), `test/phase2` 56, `test/phase6` 89 | failed attempts are charged, so a retry storm cannot outrun the cap |
| **Security plane** (policy gate, approvals, secret broker, tamper-evident audit) | **1 — ON** | `test/security` 381, `test/trust` 159; tamper matrix mutation-proven; OWASP pass in `OWASP-LLM-2025.md` | tamper detection is evident, not resistant, against an attacker with SQLite write access |
| **Desktop app** (chat, agents, integrations, settings, approvals, HUD, tray, updater) | **1 — ON (build verified)** | desktop 491 tests, `tsc`/`build`/`lint` clean, Tauri bundles built on Windows + macOS x64/arm64 + Linux in CI | **no human has installed and launched it on a real desktop** — that stays an owner check |
| **Multi-agent & orchestrator** (`xr agents`, workflows, pause/resume/cancel, DAG) | **1 — ON** | `test/agents` 14, `test/phase6` 89 (partitions, worker budget, verifier), `test/automation` 11 | a delegated tree cannot outrun its root cap; closed partitions refuse further work |
| **Researcher** (cited sources, failures surfaced) | **1 — ON** | `test/research` 66 (incl. content guard), `test/context` 316; fetched pages go through the same untrusted framer as tool output | results carry sources; a fetch failure is surfaced, not swallowed |
| **MCP, plugins, skills** (permission prompts, no privilege escalation) | **1 — ON** | `test/plugins` 65, `test/supply-chain` 16, `test/integrations` 49 | a plugin cannot exceed declared permissions; MCP descriptions are poisoning-checked |
| **Daemon & local API** | **1 — ON** | `test/daemon` 308 pass; loopback bind + bearer token; `/budget` is the single source the desktop reads | — |
| **Memory / context** | **1 — ON** | `test/context` 316 pass | poisoning detection is a signature heuristic with an audit trail |
| **Local runtimes** (Ollama, LM Studio, llama.cpp, vLLM…) | **2 — EXPERIMENTAL** | `consumer-smoke` and the release smoke lane drive a local OpenAI-compatible server end to end | works with a local server you run; **not** benchmarked for quality on this 2 GB box, and no local model was run here (T24 **BLOCKED**: no model fits) |
| **Voice mode** (`xr voice setup/test/start`, push-to-talk, hotkey) | **2 — EXPERIMENTAL** | `test/voice` 41 pass (fixture/loopback) | **no audio device on this machine**; real microphone testing is an owner action on Windows/Linux |
| **Computer control & vision agent** | **2 — EXPERIMENTAL, opt-in** | policy + approval tests in `test/security`/`test/trust` | **not exercised**: no Xvfb or GUI here; direct host automation is blocked on Windows/macOS until an isolated handoff exists; Linux desktop control uses approval and capability gates, not a proven tier-2 boundary |
| **Telegram / Discord / WhatsApp interfaces** | **2 — EXPERIMENTAL** | `test/integrations` 49 pass, mock-only paths | needs your own bot token; nothing is stored for an unconfigured connector |
| **Cloud control plane & dashboard sync** | **3 — DEFERRED (not shipped)** | `test/cloud` 36 pass for the local licence/enforcement logic; no hosted infrastructure is confirmed | the README says no cloud account is required and no local feature is paywalled — that is enforced by `test/cloud/license.test.ts`. Preview 1 ships **no** hosted service |
| **npm / Homebrew / WinGet / Scoop / Docker channels** | **3 — DEFERRED** | owner decision D4; `channel:check` tracks the 1.0.0 line they serve today | Preview 1 is a GitHub pre-release only |
| **Archived chats** | **3 — REMOVED** | T03: both session queries filter `archived = 0`, so an archived chat could never be retrieved | the Archive action and its button are withdrawn rather than left as a one-way door |

## What a user should read into this

- **Tier 1 is a proposed shipping classification**, not proof that every listed path works. The gaps are in
  `1.2.0-preview.1/known-limitations.md` and in the OWASP pass.
- **Tier 2 requires a working path and an Experimental label.** Voice and computer control have
  limited fixture/policy evidence; real-device paths and consistent in-app labels are not yet verified.
- **Tier 3 means "not in this release"**, and for cloud that is deliberate: XR is local-first and
  nothing in Preview 1 requires an account.
- **Owner checks include**, and no amount of green CI replaces them: install and launch the
  desktop app on a real Windows PC and a real Linux desktop; a real microphone test; a
  real-provider run with a capped key (already done once on Groq in week 1).
