<div align="center">

<br/>

# ⚡ XR

### The AI agent you can actually trust.

**`BYOK`&nbsp;·&nbsp;`local-first`&nbsp;·&nbsp;`spend-capped`&nbsp;·&nbsp;`non-regressive`&nbsp;·&nbsp;`tamper-evident`**

<br/>

<!-- ░░░ badges ░░░ -->
![status](https://img.shields.io/badge/status-feature--complete-00d2ff?style=for-the-badge)
![tests](https://img.shields.io/badge/tests-124%20passing-34e2a0?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-9a6bff?style=for-the-badge)

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)
![deps](https://img.shields.io/badge/runtime%20deps-1-success?style=flat-square)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff5db8?style=flat-square)

<br/>

<!-- ░░░ the rrrtx tag, hehe ░░░ -->
[![by rrrtx](https://img.shields.io/badge/%E2%9A%A1_by-rrrtx-000000?style=for-the-badge&labelColor=00d2ff)](https://github.com/ahmadrrrtx)

<br/>

> **You bring the key. We ship none.**
> XR runs on _your_ provider API key or _your_ local model — it costs **us $0 to maintain** and **you $0 to trust.**

<br/>

🛡️ **Coming from OpenClaw?** → **[Read the Migration Guide »](./MIGRATION.md)**

</div>

---

## 📑 Table of contents

- [Why XR exists](#-why-xr-exists)
- [The 5 things that make XR different](#-the-5-things-that-make-xr-different)
- [XR vs the field](#-xr-vs-the-field)
- [Quick start](#-quick-start)
- [Every command](#-every-command)
- [Architecture](#-architecture)
- [Security model (honest)](#-security-model-honest)
- [Project structure](#-project-structure)
- [Roadmap & status](#-roadmap--status)
- [License](#-license)

---

## 🎯 Why XR exists

Personal AI agents exploded in 2026 — and then people started leaving them. The pattern in the data is loud and consistent:

| 😩 What users actually complain about | 🛡️ XR's answer |
|---|---|
| 💸 **Unpredictable token bills** (same task varies up to 30×) | A **hard spend ceiling enforced in code** — the model literally can't exceed it |
| 🖥️ **"Local models don't work agentically"** | **Grammar-forced tool-calls** → valid output even on a 3B local model |
| 🤖 **Self-improvement that drifts & forgets** | **Non-regressive skills** — verified wins are frozen, regressions auto-roll-back |
| 🔓 **Security nightmares** (plaintext keys, prompt injection, 135k+ exposed instances) | **Secure-by-architecture** + a runnable injection benchmark |
| 🔧 **Breaks every single update** | **Self-healing config + transactional auto-rollback updates** |

> **XR's thesis:** _security and reliability are the architecture — not a feature you bolt on later._

<br/>

## 🚀 The 5 things that make XR different

<table>
<tr>
<td width="50%" valign="top">

### 💰 Cost Governor
A **hard** per-task spend/token ceiling enforced in deterministic code. XR **pauses and asks** before the next step would breach your budget — it can't silently burn $8.

</td>
<td width="50%" valign="top">

### 🧠 Non-Regressive Skills
Self-improvement that **can't forget a win.** Verified-good action sequences are **frozen as immutable baselines**; any update that breaks one is **auto-rolled-back.** No other agent ships this.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🖥️ Local-Model Reliability
**GBNF grammar-forced tool-calls** make weak local models emit valid output, with per-model profiles + deterministic **auto-repair** as a backstop.

</td>
<td width="50%" valign="top">

### 🔒 Provable Security
**`xr test --attacks`** runs an injection corpus and prints a **publishable block-rate.** Plus an egress allow-list, approval gates, and a **tamper-evident hash-chained audit log.**

</td>
</tr>
<tr>
<td colspan="2" valign="top">

### 🛡️ Self-Healing & BYOK
Updates that **auto-rollback** if a self-test fails. Keys live in **your environment / OS keychain** — XR ships none, stores none, costs nothing to run.

</td>
</tr>
</table>

<br/>

## ⚔️ XR vs the field

| Capability | XR | OpenClaw | Hermes | Claude Code |
|---|:---:|:---:|:---:|:---:|
| Hard spend ceiling (code-enforced) | ✅ | ❌ | ❌ | ❌ |
| Local-model reliability (GBNF) | ✅ | ❌ | ❌ | ❌ |
| Non-regressive skills | ✅ | ❌ | ⚠️ drifts | ❌ |
| Injection benchmark (runnable) | ✅ | ❌ | ❌ | ❌ |
| Tamper-evident audit log | ✅ | ❌ | ❌ | ❌ |
| BYOK + $0 to run | ✅ | ⚠️ | ⚠️ | ❌ |
| Egress allow-list (anti-exfil) | ✅ | ❌ | ❌ | ⚠️ |
| Approval gate for risky actions | ✅ | ⚠️ | ❌ | ⚠️ |

> The moat is the **combination.** No single competitor has columns 1 + 3 + 4 together.

<br/>

## ⚡ Quick start

```bash
# 1. requires Bun  →  https://bun.sh
git clone https://github.com/ahmadrrrtx/xr
cd xr && bun install

# 2. sanity check (124 tests)
bun test

# 3. health: config + provider + tamper-evident audit chain
bun run src/index.ts doctor

# 4. run a task on a LOCAL model ($0), capped + dry-run first
bun run src/index.ts --dry-run "summarize and improve the README"
bun run src/index.ts --budget 0.10 "summarize and improve the README"

# 5. bring your own cloud key (never stored by XR)
GROQ_API_KEY=... bun run src/index.ts --provider groq --model llama-3.3-70b "list files and explain them"
```

**One-command container:**
```bash
docker compose up      # whole agent + dashboard, bound to 127.0.0.1 only
```

<br/>

## 🧰 Every command

| Command | What it does |
|---|---|
| `xr "task"` | Run a task (Agent mode) |
| `xr --mode plan\|ask "task"` | Read-only modes (least-privilege) |
| `xr --budget 0.50 "task"` | Hard **USD** spend ceiling for this task |
| `xr --max-tokens 50000 "task"` | Hard **token** ceiling |
| `xr --dry-run "task"` | Simulate everything — write nothing, run nothing |
| `xr --provider <id> --model <m>` | Use any BYOK provider (Ollama, Groq, OpenAI, …) |
| `xr serve` | 📊 Local dashboard on **127.0.0.1** (token-authed) |
| `xr telegram` | 📱 Secure phone remote (allow-list + ✅/❌ buttons) |
| `xr voice` | 🎙️ Local voice stack (Whisper → agent → Kokoro) |
| `xr skills` | 📚 List the 11 pre-built signed skills |
| `xr index` / `xr memory` | 🧠 Local RAG index + project memory |
| `xr mcp` | 🔌 MCP tool ecosystem (approval + egress wrapped) |
| `xr cron "every mon 9am: audit"` | ⏰ Natural-language scheduler |
| `xr test --attacks [--json]` | 🔒 Injection benchmark (signed report with `--json`) |
| `xr verify-log` | Verify the tamper-evident audit chain |
| `xr export` | 📄 Write a signed, shareable audit report |
| `xr doctor` | Full system health check |

<br/>

## 🏗️ Architecture

```
                         ┌──────── INTERFACES ────────┐
                         │  CLI · Dashboard · Telegram │
                         │           · Voice           │
                         └──────────────┬──────────────┘
                                        │  (trusted user input)
                          ┌─────────────▼─────────────┐
                          │     AGENT CORE  (loop)     │
                          │   Observe → Think → Act    │
                          └───┬──────────┬─────────┬───┘
            ┌─────────────────┘          │         └──────────────────┐
   ┌────────▼────────┐      ┌────────────▼──────────┐     ┌───────────▼─────────┐
   │  COST GOVERNOR  │      │     POLICY ENGINE      │     │  RELIABILITY HARNESS│
   │ hard ceiling 💰 │      │ least-priv · approval  │     │ GBNF grammar 🖥️     │
   └─────────────────┘      │ egress allow-list 🔒   │     │ auto-repair         │
                            └───────────┬────────────┘     └─────────────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │   STATE (SQLite + files)       │
                         │  memory · skills · cost        │
                         │  TAMPER-EVIDENT AUDIT LOG 🛡️   │
                         └────────────────────────────────┘
```

**Stack:** TypeScript (strict) · Bun runtime · SQLite (Drizzle-style raw) · **1 runtime dependency (`zod`)** · ~4,700 lines · 124 tests.

<br/>

## 🔐 Security model (honest)

> ⚠️ **XR does not claim to be "unhackable."** Prompt injection is an unsolved class of vulnerability industry-wide — even Anthropic, OpenAI, and Google say so.

What XR **does** do is **minimize blast radius** with deterministic guardrails — and let you **prove it**:

- 🚪 **Egress allow-list** — the agent can't reach a domain you didn't approve (kills most exfiltration, incl. cloud metadata).
- ✋ **Approval gates** — write/delete/shell/send require explicit approval (CLI / phone button / voice-confirm), **fail-closed on timeout**.
- 🔑 **BYOK + keychain** — secrets never in config files; redacted from logs.
- 🧱 **Least-privilege per mode** — Ask/Plan modes literally have no shell/write tools.
- 🪪 **Tamper-evident audit** — SHA-256 hash-chained log; `xr verify-log` detects any change.
- 🧪 **Provability** — `xr test --attacks` publishes a reproducible block-rate. We considered blockchain for tamper-proofing and chose **hash chains** instead: same guarantee, but **$0, offline, and private.**

**Honest caveat on "100% valid tool-calls":** the grammar guarantee applies to **llama.cpp / Ollama / vLLM** (GBNF) and to cloud providers via **native JSON mode**; everything else uses **deterministic auto-repair** (very high, not literally 100%).

<br/>

## 📂 Project structure

```
xr/
├── src/
│   ├── core/          # agent loop (Observe→Think→Act) + shared types
│   ├── config/        # self-healing, schema-validated config
│   ├── state/         # SQLite + tamper-evident hash-chained audit log
│   ├── providers/     # BYOK adapter + factory (Ollama/Groq/OpenAI/…)
│   ├── cost/          # 💰 governor · pricing · estimator
│   ├── reliability/   # 🖥️ GBNF grammar · auto-repair · model profiles
│   ├── skills/        # 🧠 verifier · non-regressive engine · loader
│   ├── memory/        # 📚 embeddings · local RAG · context compaction
│   ├── security/      # 🔒 attack corpus · guard · injection lab
│   ├── update/        # 🛡️ self-healing transactional updates
│   ├── tools/         # read/write/shell/web — egress + approval gated
│   ├── daemon/        # 📊 localhost dashboard (server + UI)
│   ├── telegram/      # 📱 auth · commands · render · bot
│   ├── voice/         # 🎙️ stt · tts · wake · pipeline
│   ├── mcp/           # 🔌 MCP client (untrusted tools, safely wrapped)
│   ├── automation/    # ⏰ cron scheduler · webhooks
│   ├── export/        # 📄 signed audit report
│   ├── i18n/          # 🌍 EN · Urdu · Arabic · Spanish (RTL-aware)
│   └── index.ts       # ⭐ CLI entry — parses & dispatches all commands
├── skills/            # 11 pre-built signed markdown skills
├── extensions/vscode/ # status-bar cost + security meter
├── test/              # 14 files · 124 tests · 294 assertions
├── Dockerfile · docker-compose.yml · .github/workflows/ci.yml
└── MIGRATION.md       # 🛡️ OpenClaw → XR migration guide
```

<br/>

## 🗺️ Roadmap & status

**Feature-complete (Blocks 0–9):**

`✅ Engine` `✅ Cost Governor` `✅ Local Reliability` `✅ Non-Regressive Skills` `✅ Memory/RAG` `✅ Dashboard` `✅ Telegram` `✅ Voice` `✅ MCP + Cron + Webhooks` `✅ Docker/i18n/Export/CI`

**Next:** open-source the attack bench · third-party audit · launch (r/netsec → r/LocalLLaMA → Dev.to → Show HN).

<br/>

## 📜 License

MIT © [Muhammad Ahmad (**@ahmadrrrtx**)](https://github.com/ahmadrrrtx)

<div align="center">
<br/>

**If OpenClaw made your security team nervous, XR is the migration.**

[![by rrrtx](https://img.shields.io/badge/%E2%9A%A1_built_by-rrrtx-000000?style=for-the-badge&labelColor=00d2ff)](https://github.com/ahmadrrrtx)

<sub>your keys · your model · your rules</sub>

</div>
