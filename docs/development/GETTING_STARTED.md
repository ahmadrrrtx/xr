# Getting Started with XR — Install to First Task

**Audience:** new users on a supported platform (support matrix:
[`../release/SUPPORT_MATRIX.md`](../release/SUPPORT_MATRIX.md)).
**Time:** about 5 minutes on the golden path.
**This guide describes only what is verified.** The same journey — install →
verify → first answer → restart → resume → second answer → uninstall — runs as
an effect-asserting script in CI (`scripts/golden-path.ts`, exercised by
`test/reliability/golden-path.test.ts`), so the steps below cannot silently rot.

> XR is a **local-first AI agent runtime**, not a hosted product and not an
> operating system. What it is and is not:
> [`README.md — What XR is, and what it is not`](../../README.md#what-xr-is--and-what-it-is-not).

---

## 1. Install

```bash
# Linux / macOS / Termux / WSL — default verified binary channel
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash

# Windows PowerShell (Windows PowerShell 5.1 and PowerShell 7+)
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

To pass options on Windows, download the script first and call it as a file —
`iex` cannot forward arguments:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1 -OutFile install.ps1
.\install.ps1 -AssumeYes -InstallMode minimal -TargetDirectory C:\tools\xr
```

Supported switches: `-AssumeYes` (non-interactive), `-AllowSystem`,
`-InstallMode minimal|local|byok|hybrid|full`, `-TargetDirectory <path>`.

Other channels (Homebrew, WinGet, Scoop, `.deb`, Docker, npm) install the same
signed artifacts — table and per-channel status: [`README.md — Install XR`](../../README.md#-install-xr).
Verify any download before running it: [`../release/VERIFYING_RELEASES.md`](../release/VERIFYING_RELEASES.md).

**Requirements:** Bun ≥ 1.3 for source checkouts (`bun --version`); the binary
channel needs no runtime. `git` is recommended for skills/plugins.

## 2. First-run setup (onboarding)

```bash
xr onboarding
```

The wizard is re-runnable anytime. It walks through provider choice, memory
consent (XR only remembers what you explicitly ask it to), and optional voice
setup. It changes nothing you do not approve.

**Scripting:** `xr onboarding --yes` accepts every prompt at its default —
the same semantics as `xr install --yes`. Two honest consequences: no provider
keys get configured (run `xr provider` afterwards), and if Ollama is installed
and running, the default-true consent downloads the recommended model (a
multi-GB pull) — run `--yes` before installing Ollama if you do not want that.
Do not script the interactive wizard by piping answer sequences: questions
share one stdin and buffered input can be dropped between prompts; an EOF now
resolves each prompt at its default instead of hanging (consent gates fail
closed on EOF — a closed stdin is never read as approval).

Then confirm the install can actually do work:

```bash
xr doctor
xr doctor --json    # stable machine-readable diagnostics
```

`xr doctor` answers one question — *can XR run a task right now?* — and exits
**non-zero** when it cannot, printing why plus one next action. It never prints
`ok: true` for a system that cannot do work. On a fresh install with no
provider key yet, a non-zero exit with a "no reachable provider" message is
honest and expected — fix it in the next step.

## 3. Add a provider (BYOK, or fully local)

XR ships **26 built-in provider presets (16 hosted + 10 local runtimes)**: five
hosted providers on dedicated native adapters (Anthropic, Google, Mistral,
Cohere, AWS Bedrock), everything else over the OpenAI-compatible protocol —
details and default models: [`README.md — Providers`](../../README.md#-providers).

```bash
# Hosted, bring-your-own-key — example: Anthropic
xr providers add claude        # masked prompt; key stored in your OS keychain
                               # (falls back to an AES-256-GCM sealed file —
                               #  see docs/migration/secrets-at-rest.md)

# Fully local, no key — example: Ollama
xr providers set ollama qwen2.5:7b

xr providers list              # what is configured
xr providers test              # live probe of every configured provider
```

`xr providers set <id> <model>` switches through a canary-probe state machine
and rolls back automatically if the new model cannot be reached.

**Custom/gateway endpoints** (proxy, local gateway, self-hosted): use
`xr providers add` (adds a custom OpenAI-compatible preset) or set
`config.providers.<id>.baseUrl` in `~/.xr/config.json`.

To point at an endpoint **via environment variable** (CI, per-shell
gateways), declare the mapping explicitly — XR never honors ambient
`*_BASE_URL` variables without it:

```jsonc
// ~/.xr/config.json
"envOverrides": { "providers.openrouter.baseUrl": "OPENROUTER_BASE_URL" }
```

With that entry, `OPENROUTER_BASE_URL=http://…` changes where tasks go on the
run path (verified end-to-end by `test/config/env-overrides.test.ts`). Applied
overrides are reported as config warnings; set `"envOverridesLocked": true`
to ignore the whole map in locked-down automation. `XR_MEMORY_DISABLED=1` and
`XR_TRUST_HARDENED=0` remain separate single-purpose escape hatches.

**What "ready" means:** `xr doctor` reports a provider ready when a key is
present and the endpoint answers — it does not prove the key is *valid*.
Verify new keys with a real call (`xr providers test`) before relying on them.

## 4. Your first task

```bash
xr "summarise what this directory contains in three bullets"
```

You should see: a plan or direct answer, spend tracked against your per-task
budget (set a ceiling with `--budget 0.10`), and — for anything consequential —
an approval prompt. Everything lands in the local audit log:

```bash
xr verify-log     # → "✓ Audit chain intact (N entries)"
```

Interactive and browser surfaces (same agent, same policy):

```bash
xr                # fullscreen shell (TUI)
xr serve          # local dashboard + chat — 127.0.0.1 only, token-authed
```

## 5. Restart and resume (durable by default)

State lives under `~/.xr` (override with `XR_HOME`). Close and reopen the shell
and your session, audit chain, and any resumable task are still there. A failed
task is reported as failed (never faked as complete) and multi-agent workflows
can be resumed; honest failure mapping is pinned by `test/multi-agent-e2e.test.ts`.

## 6. Uninstall (optional)

```bash
xr uninstall --keep-data     # removes the launcher, keeps ~/.xr
xr uninstall --purge         # removes everything, including your data
```

---

## Know before you rely on it

- **Known limitations (release artifact):**
  [`../release/1.0.0/known-limitations.md`](../release/1.0.0/known-limitations.md) —
  the maintained list of what is *not* yet real, including no third-party
  certifications and policy-not-isolation on some platforms.
- **Workflow engine (A-13):** tool-action nodes run only with an injected
  `WorkflowToolExecutor` (without one they fail as unsupported — they never
  fabricate success); `wait_timer`/event nodes need a scheduler/subscriber and
  do **not** self-advance. Details: known-limitations §4.
- **Memory is consent-gated.** XR never silently remembers; recall explains its
  matches. [`README.md — Memory Engine`](../../README.md#-stage-6--the-memory-engine).
- **Exit codes:** success `0`, task failure `1`, usage error `2` — safe to wrap
  in CI.

## Where to go next

| Goal | Doc |
|---|---|
| Architecture in one page | [`../RUNTIME_KERNEL_ARCHITECTURE.md`](../RUNTIME_KERNEL_ARCHITECTURE.md) |
| CLI surface | [`../cli/`](../cli/) |
| Capabilities: skills, plugins, MCP | [`../CAPABILITIES.md`](../CAPABILITIES.md) |
| Extend XR (authors) | [`../developer/EXTENDING-XR.md`](../developer/EXTENDING-XR.md) |
| Business OS extension (optional, default-off) | [`../business-os-extension.md`](../business-os-extension.md) |
| Security model | [`../security/SECURITY_MODEL.md`](../security/SECURITY_MODEL.md) |
