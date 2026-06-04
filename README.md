![XR — cybernetic guardian avatar](https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png)

# ⚡ XR — The AI Agent You Can Actually Trust

**`BYOK` · `local-first` · `spend-capped` · `tamper-evident` · `JARVIS-level control`**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Tests](https://img.shields.io/badge/tests-124%20passing-34e2a0?style=flat-square)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-9a6bff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20·%20macOS%20·%20Windows%20·%20Termux-00d2ff?style=flat-square)](https://bun.sh)

---

> **You bring the key. We ship none.**
> XR runs on *your* provider API key or *your* local model — it costs **us $0 to maintain** and **you $0 to trust.**

---

## 🚀 Install in 30 Seconds

```bash
# One command. Any OS. That's it.
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

Windows PowerShell:
```powershell
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

Then just type:
```bash
xr "hello, who are you"
```

Or run the interactive setup wizard:
```bash
xr --onboard
```

---

## ✨ What Makes XR Different

| Feature | XR | Claude Code | OpenClaw | Hermes |
|---|---|---|---|---|
| **One-command install** | ✅ `curl\|bash` | ✅ | ✅ | ✅ |
| **Full TUI (slash commands, history)** | ✅ | ✅ | ⚠️ | ✅ |
| **JARVIS computer control (screenshots)** | ✅ | ❌ | ❌ | ❌ |
| **System control (volume, clipboard, apps)** | ✅ | ❌ | ⚠️ | ⚠️ |
| **Hard spend ceiling (code-enforced)** | ✅ | ❌ | ❌ | ❌ |
| **Tamper-evident audit log (SHA-256 chain)** | ✅ | ❌ | ❌ | ❌ |
| **Injection benchmark (runnable block-rate)** | ✅ | ❌ | ❌ | ❌ |
| **Egress allow-list (anti-exfil)** | ✅ | ❌ | ❌ | ⚠️ |
| **Non-regressive skills (auto-rollback)** | ✅ | ❌ | ❌ | ✅ |
| **Self-improving (learns from experience)** | ✅ | ❌ | ❌ | ✅ |
| **Docker sandbox for shell commands** | ✅ | ❌ | ⚠️ | ✅ |
| **Voice control (wake word → STT → TTS)** | ✅ | ❌ | ✅ | ✅ |
| **BYOK + $0 to run** | ✅ | ❌ | ⚠️ | ✅ |
| **Cross-platform (Win/Mac/Linux/Termux)** | ✅ | ✅ | ✅ | ✅ |

---

## 🎯 Core Features

### 🧠 JARVIS-Level Computer Control
```bash
xr --computer "open Safari and search for AI agents"
```
XR sees your screen via screenshots, reasons about what's on it, and takes actions — click, type, scroll, open apps — just like you would. It's the difference between *asking* an agent to do something and *showing* it what to do.

### 💰 Cost Governor — Enforced in Code
```bash
xr --budget 0.10 "write me a full React app"
```
The agent **literally cannot exceed your budget**. It's not a suggestion — `checkBeforeStep()` runs before every model call and blocks if the next step would breach the ceiling.

### 🛡️ Provable Security
```bash
xr test --attacks --json   # → signed publishable block-rate report
```
Runs a 10-attack corpus through the deterministic defenses and prints a publishable block-rate with SHA-256 signature. No marketing — real numbers.

### 🔒 Tamper-Evident Audit Log
```bash
xr verify-log              # → "✓ Audit chain intact (N entries)"
```
SHA-256 hash chain (git's trick, $0, offline, private). Any tampering is detected and reported. Redacts API keys before storage.

### 🧠 Non-Regressive Skills
Every successful verified task can be frozen as an immutable baseline. Any update that breaks a past win is **auto-rolled-back**. The agent cannot forget what worked.

### 🔄 Self-Improving
After every successful task, XR analyzes what it did. If verifiable and complex enough, it creates a skill that improves during use. Cross-session memory via SQLite FTS5 search.

### 🐳 Docker Sandbox
Shell commands run in an isolated container by default (optional). Dropped capabilities, no network, memory-limited. The `rm -rf /` and `curl | bash` attacks are structurally impossible.

### 🎙️ Voice Control
```bash
xr --voice
```
Wake word → Whisper STT → agent → Kokoro TTS. Local by default. Say "Hey XR, open Safari and check my calendar."

### 📱 Multi-Channel
- **CLI** — full TUI with streaming + slash commands
- **Telegram** — ✅/❌ approval buttons, user allow-list
- **Dashboard** — 127.0.0.1:7842 with live audit, cost cockpit, security posture

---

## 📋 Every Command

| Command | What it does |
|---|---|
| `xr "task"` | Run a task (default: agent mode) |
| `xr --tui` | Interactive terminal UI (Claude Code-style) |
| `xr --onboard` | 5-minute setup wizard |
| `xr --computer "task"` | JARVIS GUI automation |
| `xr --mode plan "task"` | Read-only analysis |
| `xr --mode ask "task"` | Q&A only |
| `xr --budget 0.50 "task"` | Hard USD ceiling |
| `xr --max-steps 30 "task"` | Max agent steps |
| `xr --dry-run "task"` | Simulate — touch nothing |
| `xr --provider groq "task"` | Use specific provider |
| `xr doctor` | System health + audit chain |
| `xr test --attacks` | Security benchmark (block-rate) |
| `xr verify-log` | Verify tamper-evident chain |
| `xr skills` | List available skills |
| `xr index` | Index project for local RAG |
| `xr memory` | Project memory + RAG status |
| `xr cost` | Lifetime cost by model |
| `xr serve` | Local dashboard (127.0.0.1:7842) |
| `xr telegram` | Secure phone remote |
| `xr voice` | Voice stack check |
| `xr sandbox` | Docker sandbox status |
| `xr export` | Signed audit report |

**Slash commands (inside TUI):** `/ask`, `/plan`, `/mode`, `/model`, `/budget`, `/doctor`, `/attacks`, `/skills`, `/index`, `/memory`, `/cost`, `/verify-log`, `/export`, `/shell`, `/exit`, `/help`

---

## 🏗️ Architecture

```
┌──────── INTERFACES ────────────────────────────────────────┐
│  CLI (TUI + streaming) · Dashboard · Telegram · Voice     │
└──────────────────────┬────────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────────┐
│ AGENT LOOP — Observe → Think → Act                        │
│ • Cost Governor (hard ceiling, enforced before each step) │
│ • Policy Engine (egress allow-list + approval gates)      │
│ • GBNF Grammar (100% valid tool-calls on local models)    │
│ • Auto-Repair (validation sandwich: grammar → repair → Z) │
└──────┬───────────────────┬───────────────────┬─────────────┘
       │                   │                   │
  ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
  │ Tools   │        │ Memory  │        │ Skills  │
  │ File    │        │ RAG     │        │ Auto-   │
  │ Web     │        │ FTS5    │        │ learn   │
  │ Shell   │        │ Cross-  │        │ Non-    │
  │ System  │        │ session │        │ regress │
  │ (JARVIS)│        │         │        │         │
  └─────────┘        └─────────┘        └─────────┘
                       │
              ┌────────▼────────┐
              │ STATE (SQLite)   │
              │ Sessions        │
              │ Tamper-evident  │
              │   audit chain   │
              │ Skills/baselines│
              │ Cost events     │
              │ Schedules       │
              └─────────────────┘
```

**Stack:** TypeScript (strict) · Bun runtime · SQLite · **1 runtime dep (`zod`)** · ~6,000 lines · 124 tests

---

## 🔐 Security Model (Honest)

> ⚠️ **XR does not claim to be "unhackable."** Prompt injection is unsolved industry-wide. What XR does is **minimize blast radius** and let you **measure it**.

- **Egress allow-list** — agent can't reach a domain you didn't approve
- **Approval gates** — write/delete/shell need explicit approval, fail-closed on timeout
- **Docker sandbox** — shell runs in isolated container, dropped capabilities
- **Secret redaction** — API keys redacted before audit log storage
- **Path escape prevention** — every file tool rejects `../` escapes (tested)
- **Tamper-evident chain** — SHA-256 hash chain, `xr verify-log` detects any change
- **`xr test --attacks`** — publishes a reproducible block-rate you can verify

---

## 🛡️ Coming from OpenClaw?

**135,000+ exposed instances. 138+ CVEs. 800+ malicious skills.**

XR closes that attack surface by default — egress allow-list, 127.0.0.1-only, signed local skills, tamper-evident audit, hard spend ceiling, Docker sandbox shell. Switch in ~10 minutes.

👉 **[Read the full Migration Guide →](MIGRATION.md)**

---

## 🚀 Quick Start

```bash
# Install (one command, any OS)
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash

# Run a task on a LOCAL model ($0)
bun run src/index.ts "list files and explain them"

# With a cloud key (never stored by XR)
GROQ_API_KEY=sk-... bun run src/index.ts "build me a portfolio website"

# Hard budget ceiling
bun run src/index.ts --budget 0.25 "write me a full REST API"

# Interactive TUI (Claude Code-style)
bun run src/index.ts --tui

# JARVIS computer control
bun run src/index.ts --computer "open Safari and search for flights"

# One-command Docker (everything included)
docker compose up
```

**Add shell alias:**
```bash
echo "alias xr='bun run $(pwd)/src/index.ts'" >> ~/.bashrc
source ~/.bashrc
# Now just type: xr "your task"
```

---

## 🧰 System Requirements

- **OS:** Linux, macOS, Windows (PowerShell/Git Bash), Android (Termux)
- **Runtime:** Bun 1.0+ (or npm as fallback)
- **LLM:** Ollama (local, free) or any OpenAI-compatible API key
- **RAM:** 4GB minimum (8GB recommended for local models)
- **Storage:** ~100MB for XR + whatever your model needs

---

## 📂 Project Structure

```
xr/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── core/                 # Agent loop, types
│   │   ├── agent.ts          # Observe → Think → Act loop
│   │   └── types.ts          # Shared TypeScript types
│   ├── config/               # Zod-validated config with migrations
│   ├── cost/                 # Cost Governor + pricing table
│   ├── security/             # Guard, injection corpus, test lab
│   │   ├── guard.ts          # Deterministic policy engine
│   │   ├── attacks.ts        # 10-attack injection corpus
│   │   └── lab.ts            # Publishable block-rate reporter
│   ├── tools/                # All tool implementations
│   │   ├── files.ts          # read/write with path safety
│   │   ├── system.ts         # Shell (sandboxed + approval)
│   │   ├── web.ts            # Fetch/search (egress-gated)
│   │   └── egress.ts         # URL allow-list gate
│   ├── computer/             # JARVIS computer control
│   │   ├── index.ts          # Screenshot → action loop
│   │   ├── system-control.ts # Cross-platform OS tools
│   │   └── sandbox.ts        # Docker container isolation
│   ├── voice/                # STT + TTS + wake word
│   │   ├── stt.ts            # Whisper (local or cloud)
│   │   └── tts.ts            # Kokoro (local or cloud)
│   ├── memory/               # RAG + FTS5 cross-session memory
│   │   ├── rag.ts            # Local RAG index
│   │   ├── embed.ts          # Ollama embeddings + lexical fallback
│   │   └── compact.ts        # Context window management
│   ├── skills/               # Non-regressive skills
│   │   ├── loader.ts         # Markdown SOP loader
│   │   ├── engine.ts         # Freezing + regression guard
│   │   ├── verifier.ts       # Objective verifiers
│   │   └── autolearn.ts      # Hermes-style auto-learning
│   ├── state/                # SQLite state + audit chain
│   │   └── db.ts             # Sessions, audit log, cost events
│   ├── providers/            # LLM provider abstraction
│   ├── reliability/          # GBNF grammar + auto-repair
│   ├── daemon/               # Local dashboard (127.0.0.1:7842)
│   ├── telegram/             # Secure phone remote
│   ├── automation/           # Cron scheduler (natural language)
│   ├── export/               # Signed audit reports
│   ├── update/               # Self-healing updates
│   ├── interfaces/           # CLI UI + onboarding wizard
│   └── mcp/                  # MCP tool ecosystem
├── skills/                   # Pre-built signed skills (markdown SOPs)
├── test/                     # 124 passing tests
├── docs/                     # Planning + research docs
├── install.sh                # One-command Linux/macOS installer
├── install.ps1               # One-command Windows installer
├── Dockerfile                # Single-container deploy
└── docker-compose.yml        # One-command full stack
```

---

## 🛠️ Development

```bash
git clone https://github.com/ahmadrrrtx/xr
cd xr && bun install
bun test            # 124 tests
bun run src/index.ts doctor   # System health
bun run src/index.ts --tui    # Interactive UI
```

---

## ⚠️ Honest Limitations

- **Prompt injection**: unsolved industry-wide. XR minimizes blast radius, publishes a block-rate, but cannot claim immunity
- **Local models**: weak models (<3B params) may produce invalid tool calls without GBNF grammar (use Ollama with grammar mode)
- **Voice**: requires Whisper server (local or cloud) and optional TTS server
- **Computer use**: requires a screenshot tool (`screencapture` on macOS, `scrot`/`gnome-screenshot` on Linux, .NET on Windows)

---

## 📄 License

MIT — by [Muhammad Ahmad (@ahmadrrrtx)](https://github.com/ahmadrrrtx)

**Use XR. Trust it. Improve it.**
