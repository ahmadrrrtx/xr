![XR — cybernetic guardian avatar](https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png)

<div align="center">

```
▀▄▀ █▀█
█░█ █▀▄
```

# XR — The AI Agent You Can Actually Trust

**`BYOK` · `local-first` · `spend-capped` · `tamper-evident` · `polished UI layer` · `offline-capable` · `safe computer control` · `multi-step planner` · `plan memory` · `durable memory` · `universal provider engine`**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Tests](https://img.shields.io/badge/tests-235%20passing-34e2a0?style=flat-square)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-9a6bff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20·%20macOS%20·%20Windows%20·%20Termux-00d2ff?style=flat-square)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-v1.0-22e0ff?style=flat-square)](#)
[![Stage](https://img.shields.io/badge/stage-5%20UI%20Layer-00FF88?style=flat-square)](#stage-5--user-interfaces)

</div>

---

> **You bring the key. We ship none.**
> XR runs on *your* provider API key or *your* local model — it costs **us $0 to maintain** and **you $0 to trust.**

---

## 🚀 Install XR

```bash
# Linux / macOS / Termux / WSL
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

```powershell
# Windows PowerShell
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

```bash
# After install — first time setup
xr onboarding        # guided setup wizard
xr doctor            # full health check
xr "hello, XR"       # run your first task
xr --tui             # open interactive terminal UI
xr serve             # start local dashboard + chat in browser
```

---

## ✨ What Makes XR Different

|  | Most AI agents | **XR** |
|---|---|---|
| **Provider** | locked to vendor | BYOK — **any of 20+ providers**, or **fully local** via Ollama, LM Studio, llama.cpp, Jan, LocalAI, vLLM, GPT4All, KoboldCPP, Text Generation WebUI, SGLang |
| **Cost** | "soft" warnings | **hard ceiling enforced in code** (`checkBeforeStep()`) |
| **Security** | trust us | **deterministic injection benchmark**, signed block-rate report |
| **Audit** | scrollback only | **SHA-256 hash chain** — tamper-evident, offline, free |
| **Terminal UI** | raw prompts | **Claude Code–style TUI** — spinner, history, status bar, slash commands |
| **Browser UI** | cloud dashboard | **self-hosted chat + dashboard** at `localhost:3141` |
| **Computer Control** | wild west | **safe-by-construction** — classify → preview → approve → audit |
| **Multi-step planner** | hidden prompts | **typed Action[] schema** validated with Zod, every step previewed |
| **Plan memory** | none | **cached deterministic plans** — second run skips the LLM |
| **Dashboard** | cloud-only | **127.0.0.1 only**, token-authed, live approvals, no telemetry |
| **Voice** | cloud STT | **local Whisper + Kokoro** by default, push-to-talk |
| **Runtime** | procedural script | **AI OS Kernel** with DI and Lifecycle management |

---

## 🖥️ Stage 5 — User Interfaces

Stage 5 gives XR a **complete, polished UI layer** across every user-facing surface. XR now feels like a real product.

### Terminal Interface (Claude Code–style TUI)

```bash
xr --tui
```

```
▀▄▀ █▀█  XR — The AI Agent You Can Actually Trust
█░█ █▀▄  by @rrrtx · local-first · BYOK · spend-capped · secure

  Project: my-project  Stack: TypeScript, Bun

  provider: ollama  │  model: qwen2.5:7b  │  mode: agent

  Type a message to talk to XR. Use /help to see all commands.
  Quick: /ask  /plan  /model  /status  /dashboard

  xr [agent] ›  _
```

**What the TUI provides:**
- ✦ Claude Code–style star-burst spinner while XR thinks (`· ✻ ✽ ✶ ✳ ✢`)
- ✦ Command history navigation (↑/↓ arrows, 200 entries)
- ✦ Provider / model / mode / budget status bar on every prompt
- ✦ Structured tool-call display with live status icons
- ✦ Ctrl+C interrupt → safe recovery (not immediate exit)
- ✦ `xr.md` / `.xrrc` / `CLAUDE.md` project context auto-load
- ✦ Graceful non-TTY degradation

**All slash commands — grouped by category:**

```
Chat & Tasks         /ask  /plan  /mode  /model  /budget
Navigation           /dashboard  /chat
System               /status  /doctor  /cost  /index  /help  /clear  /exit
Tools                /memory  /shell
Security             /attacks  /verify-log  /export
Local AI             /skills
```

### Browser Chat Interface

```bash
xr serve
# Opens: http://localhost:3141/chat?token=<TOKEN>
```

A **full ChatGPT-style chat interface** running locally in your browser:
- Streaming SSE responses, token-by-token
- XR branding — not a generic template
- Slash command hint chips: `/plan` `/status` `/research` `/ask` `/memory` `/budget`
- Markdown rendering (code blocks, bold, inline code)
- Typing indicator, clear button, keyboard shortcuts
- Graceful error states with recovery tips

### Browser Dashboard

```bash
xr serve
# Opens: http://localhost:3141/?token=<TOKEN>
```

A **mission-control dashboard** with 12 navigation panels:

| Panel | What it shows |
|---|---|
| **Dashboard** | 4 stat cards (spend, security score, audit chain, skills) + provider health + local AI + memory + recent audit |
| **Chat** | Full streaming chat UI |
| **Status** | Complete system health grid |
| **Providers** | All 12+ providers with status, tier, key configuration |
| **Models** | Local runtime status, installed models |
| **Memory** | All durable memory entries with inline delete |
| **Research** | Research mode quick reference |
| **Plugins** | Plugin install/enable quick reference |
| **Voice** | Voice control quick reference |
| **Security** | Injection lab (run-on-demand), egress list, security posture |
| **Audit Log** | Full SHA-256 chain with integrity badge |
| **Settings** | Privacy, budget, approval gates, CLI reference |

**Dashboard UX features:**
- Command palette: press `?` or `⌘K`
- Keyboard shortcuts: `g d` = Dashboard, `g c` = Chat, `g s` = Security, `g a` = Audit
- Live 30-second auto-refresh
- Toast notifications for all async actions
- Zero external dependencies — works fully offline

### Design System (`src/ui/`)

All terminal styling now routes through a single design-token layer:

```
src/ui/
  theme.ts      Brand palette, ANSI codes, CSS variables, spinner frames
  spinner.ts    Spinner, ProgressBar, StepTracker
  layout.ts     banner(), kv(), table(), box(), helpPanel(), notify()
  index.ts      Public re-export
```

**XR brand identity:**
- Primary: `#00D4FF` cyan
- Success / local: `#00FF88` green
- Warning / cloud: `#F59E0B` amber
- Background: `#0A0A0F`
- Logo: `▀▄▀ █▀█ / █░█ █▀▄` (block-char ASCII art spelling XR)

---

## 🏛️ v1.0 Foundation Runtime — AI OS Kernel

XR has evolved into a **True AI Operating System**. The v1.0 kernel introduces:

- **Service Container (DI)** — lightweight dependency injection managing Agent, Budget, Provider, Plugins with a strictly controlled lifecycle
- **Lifecycle Management** — formal `Bootstrap → Start → Stop` sequence
- **Specialized Store Architecture** — Session, Audit, Memory, Cost, Skill stores decomposed from the monolithic DB
- **Command Registry** — decoupled CLI commands; adding capabilities requires no core router changes
- **Event-Driven Core** — internal Event Bus for decoupled async service communication

---

## 🎯 Core Features

### 🖥 Safe Computer Control (v0.8 → v0.8.2)

```bash
xr control start                                          # opt-in (off by default)
xr control plan "open github.com and search for ahmadrrrtx" --yes
```

Four execution layers, all enforced in code:
1. **Action schema** — every action is a typed, Zod-validated `Action` variant
2. **Risk classifier** — pure function returns `safe | sensitive | destructive`
3. **Approval gate** — safe runs immediately; sensitive prompts; destructive *always* prompts
4. **Hash-chained audit** — every plan, exec, denial, memory hit is tamper-evident

Approvals work from **both** the CLI prompt **and** the dashboard "Approve / Deny" buttons.

### 🧭 Multi-Step Planner (v0.8.1)

```bash
xr control plan "fill the contact form on example.com"         # dry-run
xr control plan "fill the contact form on example.com" --step  # confirm each
xr control plan "fill the contact form on example.com" --yes   # auto-approve sensitive
```

### 🌐 Browser Automation (Playwright, v0.8.1)

```bash
xr control browser status   # check Playwright availability
xr control browser install  # one-shot: install + chromium (~150 MB)
```

### 🧠 Plan Memory (v0.8.2)

```bash
xr control plan "open github notifications" --yes  # first run: LLM plans (~$0.002)
xr control plan "open github notifications" --yes  # next run: ⚡ recalled, $0.00
xr control memory list
```

### 🧠 Durable Memory (v0.9)

```bash
xr memory add "I prefer TypeScript and Bun" --category preference
xr memory add "this project is called XR" --category project --scope xr
xr memory list             # see everything XR remembers
xr memory recall "what do I prefer?"
xr memory search "bun"
xr memory edit mem_ab12 "prefer Bun + Zod"
xr memory remove mem_ab12
xr memory clear            # forget everything (asks first)
xr memory export memories.json
xr memory import memories.json
```

XR remembers **only what you explicitly tell it to.** Everything is local-first, inspectable, editable, and permanently deletable.

**Semantic recall (v0.9):** retrieval uses local embeddings when available (Ollama `nomic-embed-text`), with automatic lexical fallback — fully offline, never crashes.

### 🏠 Stage 4 — Local AI Runtime Manager

```bash
xr models                     # local AI status
xr models runtimes            # detect Ollama, LM Studio, Jan, llama.cpp, vLLM...
xr models recommend [use-case] # hardware-aware recommendation
xr models install [model]     # safe Ollama setup/pull with approval
xr models set <runtime> <model>
xr models test [model]        # local inference smoke test
```

Supported local runtimes: **Ollama** (auto-install) · LM Studio · llama.cpp · Jan · LocalAI · vLLM · GPT4All · KoboldCPP · Text Generation WebUI · SGLang · any OpenAI-compatible endpoint.

### 🔬 Research Mode (v0.7)

```bash
xr research "compare Rust vs Go for embedded development"
xr research deep "best self-hosted alternatives to Cloudflare Tunnel"
xr research plan "topic"   # generate a structured research plan
xr research export         # export latest report to markdown
```

Source-first, multi-engine, deduplicated, with inline citations.

### 🧩 Plugin Ecosystem (v1.0)

```bash
xr plugins install ./plugins/github   # shows permissions, asks to approve
xr plugins enable github              # explicit, conscious step
xr plugin github repo ahmadrrrtx/xr  # run a plugin command
```

Plugins are **local-first, permission-based, sandboxed** — they cannot access the database, raw config, `process.env`, `fetch`, or `node:fs` directly. Every capability must be explicitly granted. Full spec: [docs/PLUGINS.md](docs/PLUGINS.md)

### 🤖 JARVIS-Level Vision Loop

```bash
xr --computer "open Safari and search for AI agents"
```

Vision-driven: screenshot → LLM reasons → action loop. For open-ended tasks where the planner doesn't know steps in advance.

### 💰 Cost Governor — Enforced in Code

```bash
xr --budget 0.10 "write me a full React app"
```

The agent **literally cannot exceed your budget.** `checkBeforeStep()` runs before every model call and blocks if the next step would breach the ceiling.

### 🛡️ Provable Security

```bash
xr test --attacks --json    # signed, publishable block-rate report
```

### 🔒 Tamper-Evident Audit Log

```bash
xr verify-log    # → "✓ Audit chain intact (N entries)"
```

SHA-256 hash chain on every action — git's trick, $0, offline. Any tampering detected instantly.

---

## 📡 Providers

XR supports **20+ providers**. Swap anytime — no restart, no re-config.

| Provider | Type | Notes |
|---|---|---|
| **Ollama** | Local | Auto-detect, model pull, free |
| **Claude** (Anthropic) | Cloud | claude-opus-4, claude-sonnet-4 |
| **OpenAI** | Cloud | gpt-4o, o3 |
| **Gemini** (Google) | Cloud | gemini-2.5-pro |
| **Groq** | Cloud | llama-3.3-70b, ultra-fast |
| **DeepSeek** | Cloud | deepseek-r2, reasoning |
| **Together AI** | Cloud | Open models, batch |
| **Mistral** | Cloud | mistral-large-2 |
| **Cohere** | Cloud | command-r-plus |
| **Cerebras** | Cloud | llama-3.3-70b, fast |
| **OpenRouter** | Cloud | 100+ models, unified |
| **AWS Bedrock** | Cloud | Enterprise |
| + any OpenAI-compatible endpoint | Local/Cloud | Custom base URL |

```bash
xr providers list      # all providers + status
xr providers set openai
xr providers add claude   # enter API key (masked, stored in OS keychain)
xr providers test         # test all configured providers live
```

---

## 🔒 Security — Built In, Not Bolted On

Every security feature is **code-enforced**, not a suggestion:

| Feature | How |
|---|---|
| **Hard budget ceiling** | `checkBeforeStep()` blocks — no exceptions |
| **Tamper-evident audit** | SHA-256 hash chain, offline, `xr verify-log` |
| **Injection defense** | 10-attack benchmark, signed block-rate report |
| **Egress allow-list** | Only configured domains receive data |
| **Approval gates** | `write_file`, `delete`, `shell`, `send` need consent |
| **API key redaction** | Keys never appear in audit log |
| **Local-first** | Nothing leaves your machine by default |
| **Dashboard security** | 127.0.0.1 only, bearer token, `X-Frame-Options: DENY` |

---

## 🖥️ Install Modes

```bash
xr install --mode minimal   # core only
xr install --mode local     # local/free, no API key required
xr install --mode byok      # cloud keys you own
xr install --mode hybrid    # cloud primary + local fallback
xr install --mode full      # all optional packs
```

---

## 🗂 Repository Structure

```
xr/
├── src/
│   ├── ui/               # Stage 5: design system
│   │   ├── theme.ts      # brand palette, ANSI codes, CSS vars
│   │   ├── spinner.ts    # Spinner, ProgressBar, StepTracker
│   │   ├── layout.ts     # terminal layout primitives
│   │   └── index.ts
│   ├── interfaces/       # all user-facing surfaces
│   │   ├── tui.ts        # interactive terminal UI (Claude Code–style)
│   │   ├── cli.ts        # CLI output helpers
│   │   ├── onboard.ts    # setup wizard
│   │   ├── providers.ts  # provider management UI
│   │   └── models.ts     # local AI model UI
│   ├── commands/         # CLI command handlers
│   │   ├── help.ts       # xr help [topic]
│   │   ├── budget.ts
│   │   ├── config.ts
│   │   ├── doctor.ts
│   │   └── ...
│   ├── daemon/           # local server
│   │   ├── server.ts     # xr serve — dashboard + chat + API
│   │   └── dashboard.ts  # full SPA: 12 panels, chat, command palette
│   ├── core/             # agent runtime
│   ├── providers/        # 20+ provider adapters
│   ├── memory/           # durable memory + RAG
│   ├── security/         # injection lab, audit, egress
│   ├── control/          # computer control, planner
│   ├── local/            # local AI runtime manager
│   ├── plugins/          # plugin sandbox
│   ├── research/         # research mode
│   ├── cost/             # budget governor
│   └── config/           # configuration
├── bin/                  # CLI entry point
├── plugins/              # built-in plugins
├── skills/               # learned skills
├── docs/                 # PLUGINS.md, etc.
├── website/              # Next.js marketing site
└── test/                 # test suite
```

---

## ⌨️ Quick Reference

```bash
# One-shot tasks
xr "write a README for this project"
xr "explain this codebase"          --mode ask
xr "refactor auth module"            --budget 0.25
xr "build a REST API"                --mode plan   # plan only

# Interactive TUI
xr --tui                             # full terminal workspace

# Browser interfaces
xr serve                             # dashboard + chat at localhost:3141

# Local AI
xr models                            # status
xr models recommend                  # hardware-aware recommendation
xr models install                    # install recommended model

# Providers
xr providers list
xr providers set ollama
xr providers add claude

# Memory
xr memory add "I prefer TypeScript" --category preference
xr memory list
xr memory clear

# Research
xr research "topic"

# Computer control (opt-in)
xr control start
xr control plan "open browser and go to github.com"

# Security
xr verify-log
xr attacks

# Help
xr help                              # full command reference
xr help tui                          # TUI guide
xr help security                     # security guide
xr help providers                    # providers guide
```

---

## 📋 Compatibility

| Platform | Status |
|---|---|
| Linux (Ubuntu, Debian, Fedora, Arch) | ✅ Full support |
| macOS (Apple Silicon + Intel) | ✅ Full support |
| Windows (PowerShell, WSL) | ✅ Full support |
| Android (Termux) | ✅ Full support |

**Runtime:** [Bun](https://bun.sh) (required) — install with `curl -fsSL https://bun.sh/install | bash`

---

## 🗺 Roadmap

| Stage | Name | Status |
|---|---|---|
| Stage 1 | Core Agent | ✅ Done |
| Stage 2 | Security + Audit | ✅ Done |
| Stage 3 | Research + Plugins | ✅ Done |
| Stage 4 | Local AI Runtime | ✅ Done |
| **Stage 5** | **User Interfaces** | ✅ **Done** |
| Stage 6 | Multi-Agent + Collaboration | 🔜 Next |

---

## 🤝 Contributing

XR is MIT licensed. Contributions welcome.

```bash
git clone https://github.com/ahmadrrrtx/xr
cd xr
bun install
bun test
```

---

## 📄 License

MIT — [LICENSE](LICENSE)

---

<div align="center">

```
▀▄▀ █▀█
█░█ █▀▄
```

**XR** — built by [@rrrtx](https://github.com/ahmadrrrtx) · [xr-gules.vercel.app](https://xr-gules.vercel.app) · MIT

*Local-first. Spend-capped. Tamper-evident. Yours.*

</div>
