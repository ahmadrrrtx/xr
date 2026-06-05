![XR — cybernetic guardian avatar](https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png)

# ⚡ XR — The AI Agent You Can Actually Trust

**`BYOK` · `local-first` · `local model intelligence` · `spend-capped` · `tamper-evident` · `safe computer control` · `multi-step planner` · `plan memory`**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Tests](https://img.shields.io/badge/tests-165%20passing-34e2a0?style=flat-square)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-9a6bff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20·%20macOS%20·%20Windows%20·%20Termux-00d2ff?style=flat-square)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-v0.8.2-22e0ff?style=flat-square)](#)

---

> **You bring the key. We ship none.**
> XR runs on *your* provider API key or *your* local model — it costs **us $0 to maintain** and **you $0 to trust.**

---

## 🚀 Install in 30 Seconds

```bash
# Linux / macOS / Termux
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

```powershell
# Windows
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

```bash
# First-time setup wizard (picks provider, model, budget)
xr onboarding
```

After install:

```bash
xr "build me a hello-world TypeScript project with tests"
xr doctor                         # check everything is healthy
xr serve                          # open the local dashboard at 127.0.0.1:7842
```

---

## ✨ What Makes XR Different

| | Most AI agents | **XR** |
|---|---|---|
| **Provider** | locked to vendor | BYOK — any of 12+ providers, or **fully local** via Ollama |
| **Cost** | "soft" warnings | **hard ceiling enforced in code** (`checkBeforeStep()`) |
| **Security** | trust us | **deterministic injection benchmark**, signed block-rate report |
| **Audit** | scrollback only | **SHA-256 hash chain** — tamper-evident, offline, free |
| **Computer Control** | wild west | **safe-by-construction** — classify → preview → approve → audit |
| **Multi-step planner** | hidden prompts | **typed Action[] schema** validated with Zod, every step previewed |
| **Browser automation** | none / hardcoded | **Playwright backend** — DOM selectors, opt-in, lazy-loaded |
| **Plan memory** | none | **cached deterministic plans** — second run skips the LLM |
| **Dashboard** | cloud-only | **127.0.0.1 only**, token-authed, live approvals, no telemetry |
| **Voice** | cloud STT | **local Whisper + Kokoro** by default, push-to-talk |

---

## 🎯 Core Features

### 🖥 Safe Computer Control (v0.8 + v0.8.1 + v0.8.2)
The killer feature of XR — your AI can actually control the computer, and you can actually trust it.

```bash
xr control start                              # opt-in (off by default)
xr control plan "open github.com and search for ahmadrrrtx" --yes
```

Four execution layers, all enforced in code:
1. **Action schema** — every action is a typed, Zod-validated `Action` variant. Garbage cannot reach the OS.
2. **Risk classifier** — pure function returns `safe | sensitive | destructive`. Single source of truth.
3. **Approval gate** — safe runs immediately; sensitive prompts; destructive *always* prompts (even with `--yes`).
4. **Hash-chained audit** — every plan, exec, denial, memory hit is appended to the tamper-evident log.

Approvals work from **both** the CLI prompt **and** the dashboard "Approve / Deny" buttons — whichever responds first wins.

### 🧭 Multi-Step Planner (v0.8.1)
Type or speak a natural-language task; XR's planner LLM emits a validated `Action[]` plan. You preview it (dry-run default), then approve to execute.

```bash
xr control plan "fill the contact form on example.com"               # dry-run
xr control plan "fill the contact form on example.com" --step        # confirm each
xr control plan "fill the contact form on example.com" --yes         # auto-approve sensitive
```

The planner cannot smuggle dangerous actions: every emitted action is re-classified before execution.

### 🌐 Browser Automation (Playwright, v0.8.1)
First-class browser variant in the Action schema. DOM selectors instead of brittle coordinates.

```bash
xr control browser status                   # check Playwright availability
xr control browser install                  # one-shot: install + chromium (~150 MB)
xr control browser close                    # close the session
```

Browser ops are inherently safer than desktop ops (selectors are deterministic). `submit`, sensitive `fill`, `javascript:` and executable `goto` targets are auto-classified destructive.

### 🧠 Plan Memory (v0.8.2)
Successful plans get cached deterministically. The next time you run the same task, XR skips the LLM entirely — zero cost, instant response, **same safety pipeline.**

```bash
xr control plan "open github notifications" --yes   # first run: LLM plans (~$0.002)
xr control plan "open github notifications" --yes   # next run: ⚡ recalled, $0.00
xr control memory list                              # see what XR remembers
xr control memory show "open github notifications"  # inspect actions
xr control memory forget "open github notifications"
xr control memory clear                             # forget everything
```

**Hard safety gates** (refuses to memoize):
- Plans with `sensitive: true` actions (passwords / secrets)
- Plans with destructive actions (form submits, `Enter`, `file://`, executables)
- Failed, dry-run, or partial runs
- Plans longer than 20 actions

**Recall re-validates everything**: cached actions are re-parsed against the current Zod schema and re-classified. Schema drift or newly-destructive actions silently invalidate the cache so the planner falls back to the LLM.

### 🧠 Local Model Intelligence (v0.5)
```bash
xr models recommend         # auto-detects RAM/CPU → picks the right Ollama model
xr models install            # one-click download
xr models test               # smoke test
```
Hybrid routing: cloud for hard tasks, local for cheap ones, with automatic fallback when the budget is exhausted.

### 🔬 Research Mode (v0.7)
```bash
xr research "compare Rust vs Go for embedded development"
xr research deep "best self-hosted alternatives to Cloudflare Tunnel"
xr research plan "topic"      # generate a structured research plan
xr research export            # export latest report to markdown
```
Source-first, multi-search-engine, deduplicated, with inline citations.

### 🤖 JARVIS-Level Vision Loop
```bash
xr --computer "open Safari and search for AI agents"
```
Vision-driven screenshot → LLM reasons → action loop. Different from `xr control` — this is for *open-ended* tasks where the planner doesn't know the steps in advance.

### 💰 Cost Governor — Enforced in Code
```bash
xr --budget 0.10 "write me a full React app"
```
The agent **literally cannot exceed your budget**. `checkBeforeStep()` runs before every model call and blocks if the next step would breach the ceiling.

### 🛡️ Provable Security
```bash
xr test --attacks --json   # → signed publishable block-rate report
```
Runs a deterministic prompt-injection attack corpus and prints the block-rate with SHA-256 signature.

### 🔒 Tamper-Evident Audit Log
```bash
xr verify-log              # → "✓ Audit chain intact (N entries)"
```
SHA-256 hash chain (git's trick, $0, offline). Every control event, every tool call, every approval is in the chain. Any tampering is detected.

### 🧠 Non-Regressive Skills
Every successful verified task can be frozen as an immutable baseline. Any update that breaks a past win is **auto-rolled-back**.

### 🐳 Docker Sandbox
Shell commands optionally run in an isolated container with dropped capabilities and no network.

### 🎙️ Voice Control
```bash
xr voice start                              # wake word → STT → agent → TTS
xr speak "hello world"
xr listen
```
Voice commands route through the **same** safety pipeline as the CLI — voice can never bypass approvals. Recognized control intents:
- *"Open the app Safari"* → `app`
- *"Go to https://example.com"* → `open`
- *"Type this message: hello"* → `type`
- *"Press cmd+tab"* → `key`
- *"Focus the Chrome window"* → `focus`
- *"Scroll down"* → `scroll`

### 📊 Dashboard (v0.8.1)
```bash
xr serve                    # opens 127.0.0.1:7842
```
- Cost cockpit (live)
- Security posture (injection block-rate)
- Audit explorer (with hash chain)
- **Computer Control** panel with:
  - Capability matrix (kbd / mouse / launcher / browser)
  - Pending approvals with Approve/Deny buttons
  - Live event stream
  - 🧠 Remembered plans list with per-row forget + clear-all

### 📱 Multi-Channel
- **CLI** — full TUI with streaming + slash commands
- **Telegram** — ✅/❌ approval buttons, user allow-list
- **Dashboard** — 127.0.0.1:7842 with live audit, cost cockpit, security posture, computer control

---

## 📋 Every Command

### Core

```bash
xr "your task"                            # run a task (default: agent mode)
xr "..." --mode plan                      # plan mode (no side effects)
xr "..." --mode ask                       # ask mode (read-only)
xr "..." --budget 0.25                    # hard $ ceiling for this task
xr "..." --provider openai --model gpt-4o # override provider + model
xr "..." --dry-run                        # simulate everything
xr "..." --max-steps 20                   # safety rail
xr "..." --json                           # JSON output
```

### Computer Control (v0.8 → v0.8.2)

```bash
# Setup
xr control status                         # show capabilities + missing deps
xr control test                           # dry-run a self-test plan
xr control start                          # enable in config
xr control stop                           # disable completely

# Single actions
xr control app   "Visual Studio Code"     # launch an app
xr control open  "https://example.com"    # open a URL or path
xr control type  "hello world"            # type into focused window
xr control click "640,480" [--right|--double]
xr control move  "640,480"
xr control scroll <up|down|left|right> [n]
xr control key   "ctrl+c"                 # any combo
xr control focus "Chrome"                 # focus an existing window

# Multi-step (planner)
xr control plan  "open github and search for ahmadrrrtx"    # dry-run default
xr control plan  "..." --step                               # confirm each step
xr control plan  "..." --yes                                # auto-approve sensitive
xr control plan  "..." --no-memory                          # skip cache + don't store
cat plan.json | xr control run                              # run pre-built JSON plan

# Browser (Playwright, opt-in)
xr control browser status
xr control browser install
xr control browser close

# Memory (v0.8.2)
xr control memory list
xr control memory show <baseline-id | task>
xr control memory forget <baseline-id | task>
xr control memory clear

# Disable everything
xr control stop
XR_CONTROL_DISABLED=1 xr control ...      # env override (always wins)
```

### Vision-loop computer use

```bash
xr --computer "open browser, search for X, summarize the top result"
```

### Providers & local models

```bash
xr providers                              # list with key/no-key status
xr providers add groq                     # interactive add (secure prompt)
xr providers set ollama qwen2.5:7b        # set default

xr models                                 # local model status
xr models recommend                       # auto-detect hardware → suggest model
xr models install [id]                    # download & configure Ollama model
xr models test [id]                       # smoke test
```

### Budget

```bash
xr budget                                 # status (cap, spend, remaining)
xr budget set 5                           # set monthly cap (USD)
xr budget history                         # spend by model
xr budget reset                           # zero the current period
xr cost                                   # lifetime cost summary
```

### Research (v0.7)

```bash
xr research "topic"                       # quick research
xr research deep "topic"                  # multi-source deep dive
xr research plan "topic"                  # generate a research plan
xr research export                        # latest report → markdown
```

### Voice

```bash
xr voice                                  # show voice stack status
xr voice test                             # mic → STT → TTS loopback
xr voice start                            # interactive PTT loop
xr voice stop
xr speak "text"
xr listen                                 # capture a single command
```

### Dashboard

```bash
xr serve                                  # http://127.0.0.1:7842/dashboard?token=...
xr serve --port 8000 --token mytoken
```

### Skills + Memory (project)

```bash
xr skills                                 # list learned skills
xr index                                  # build local RAG index
xr memory                                 # project memory status
```

### System

```bash
xr doctor                                 # full health check (config, provider,
                                          #  local model, audit chain, voice,
                                          #  computer control, budget, sandbox)
xr verify-log                             # verify tamper-evident audit chain
xr config                                 # show config.json
xr reset                                  # factory reset (deletes config + db)
xr test --attacks                         # run injection benchmark
xr --tui                                  # interactive terminal UI
```

### Flags (any command)

| Flag | Meaning |
|---|---|
| `--mode <agent\|plan\|ask>` | execution mode |
| `--provider <id>` | override provider |
| `--model <id>` | override model |
| `--budget <usd>` | hard $ ceiling |
| `--max-tokens <n>` | per-task token cap |
| `--max-steps <n>` | loop safety rail |
| `--dry-run` | simulate everything |
| `--json` | machine-readable output |
| `--yes`, `-y` | auto-approve sensitive (NEVER destructive) |
| `--step` | confirm every step (control / plan) |
| `--no-memory` | skip plan cache (control only) |

---

## 🔐 Security & Safety Model

### Computer-Control safety gates (always on)

| Action class | Behavior |
|---|---|
| **safe** (move, scroll, focus) | runs immediately |
| **sensitive** (open, type, click, key, app, browser fill) | prompts unless `--yes` |
| **destructive** (shell-like text, `Enter`, `Shift+Del`, `file://`, executable URLs, `submit`, sensitive fill) | **always** prompts — ignores `--yes` |

### Approval surfaces (both work simultaneously)
- CLI prompt — appears in the terminal that issued the command
- Dashboard buttons — appears in the 🖥️ panel; whoever answers first wins

### Disable switches
- `xr control stop` — sets `config.control.enabled = false`
- `XR_CONTROL_DISABLED=1` env var — always wins, even over config

### Memory safety (v0.8.2)
- Caches only **fully successful** auto-mode plans
- Refuses plans containing `sensitive: true` or destructive actions
- Recall **re-validates + re-classifies** every action — schema drift or risk escalation invalidates the entry
- `xr control memory list/show/forget/clear` give full user visibility

### Secret handling
- Never stored in plaintext when an OS-backed store is available:
  - macOS Keychain (`security`)
  - Linux Secret Service (`secret-tool`)
- File fallback at `~/.xr/.env` with `chmod 600`
- Audit log auto-redacts `sk-…`, `Bearer …`, and any `sensitive: true` value

### Audit log
- Append-only, SHA-256 hash-chained
- Every entry: control plan, execution, denial, memory store/hit/forget, agent tool call, security event, budget pause
- Verify with `xr verify-log`

---

## 🗺️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│              User (CLI · TUI · Voice · Telegram)         │
└─────────────────────────┬────────────────────────────────┘
                          │
                ┌─────────▼──────────┐
                │   src/index.ts     │  command router
                └─────────┬──────────┘
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
┌───────▼─────┐  ┌────────▼───────┐  ┌──────────▼──────────┐
│  Agent loop │  │ Control layer  │  │   Daemon (xr serve) │
│  core/      │  │ control/       │  │   daemon/           │
└──┬────────┬─┘  └─┬────────────┬─┘  └──────────┬──────────┘
   │        │     │            │               │
   │  ┌─────▼──┐  │       ┌────▼─────┐    ┌────▼────────┐
   │  │ Tools  │◄─┘       │ Planner  │    │ Dashboard   │
   │  │tools/  │          │ Memory   │    │ /api/control│
   │  └────────┘          │ Browser  │    └─────────────┘
   │                      │ Executor │
   │                      └──────────┘
   │
┌──▼─────────┐  ┌──────────────┐  ┌─────────────┐
│ Providers  │  │ Cost gov.    │  │ State / DB  │
│ providers/ │  │ cost/        │  │ state/ +    │
│ (12+ BYOK) │  │ + budget mgr │  │ memory/     │
└────────────┘  └──────────────┘  └─────────────┘
                                          │
                                  ┌───────▼──────┐
                                  │ SQLite (WAL) │
                                  │ + hash chain │
                                  └──────────────┘
```

### Repo layout
```
src/
  ├── core/             # agent loop + shared types
  ├── providers/        # 12+ BYOK adapters (OpenAI-compat + native)
  ├── local/            # Ollama hardware detection + recommendation
  ├── cost/             # spend cap, governor, pricing, manager
  ├── security/         # injection attack corpus, guards, secrets
  ├── reliability/      # JSON repair, model profiles, GBNF grammar
  ├── skills/           # non-regressive skill engine
  ├── memory/           # RAG + project fingerprint
  ├── computer/         # vision-loop computer use (xr --computer)
  ├── control/          # ✨ v0.8 safe control layer (xr control)
  │     ├── types.ts        # Action schema (Zod)
  │     ├── classify.ts     # risk classifier (pure)
  │     ├── adapter.ts      # OS + dep detection
  │     ├── executor.ts     # the ONLY file that touches the OS
  │     ├── service.ts      # classify → approve → execute pipeline
  │     ├── audit.ts        # redacting audit wrapper
  │     ├── approvals.ts    # CLI ↔ dashboard race queue
  │     ├── planner.ts      # NL → Action[] (memory-first)
  │     ├── browser.ts      # lazy Playwright backend
  │     ├── memory.ts       # ✨ v0.8.2 plan memory
  │     └── cli.ts          # xr control … subcommands
  ├── tools/            # agent tools (files, web, system, control)
  ├── voice/            # STT/TTS/wake word, voice→control router
  ├── research/         # v0.7 research mode
  ├── daemon/           # xr serve (127.0.0.1 dashboard)
  ├── interfaces/       # CLI helpers, onboarding, TUI
  └── index.ts          # main router
test/                   # 165+ tests, all platforms
```

---

## 🧪 Tests

```bash
bun test                              # full suite
bun test test/control.test.ts         # v0.8 safety pipeline
bun test test/control-plan.test.ts    # v0.8.1 planner + browser + approvals
bun test test/control-memory.test.ts  # v0.8.2 memory layer
```

---

## 🌐 Platform Notes

| OS | Built-in deps | Recommended install for full computer control |
|----|---------------|------------------------------------------------|
| **macOS** | `osascript`, `open` | `brew install cliclick` (for mouse move/click) |
| **Linux (X11)** | — | `sudo apt install xdotool wmctrl xdg-utils` |
| **Linux (Wayland)** | — | synthetic input blocked by Wayland — XR refuses gracefully |
| **Windows** | PowerShell (built-in) | — |

For **browser automation** on any platform:
```bash
xr control browser install   # ~150 MB chromium
```

---

## 📦 Configuration

Config lives at `~/.xr/config.json` (auto-created on first run). Schema is versioned and self-healing — invalid keys never crash XR.

```jsonc
{
  "version": 6,
  "defaults": { "mode": "agent", "provider": "ollama", "model": "qwen2.5:7b" },
  "budget": { "perTaskUsd": 0.25, "perTaskTokens": 250000 },
  "security": {
    "egressAllowlist": ["searx.be", "api.github.com", "registry.npmjs.org"],
    "requireApproval": ["write_file", "delete", "shell", "send"]
  },
  "localModels": { "runtime": "ollama", "enabled": true, "routing": "hybrid" },
  "control": {
    "enabled": false,            // opt-in via `xr control start`
    "defaultMode": "auto",
    "stepDelayMs": 250,
    "memory": {
      "enabled": true,           // plan cache (v0.8.2)
      "maxEntries": 500
    }
  }
}
```

### Env overrides
| Variable | Effect |
|---|---|
| `XR_HOME` | override config dir (default `~/.xr`) |
| `XR_CONTROL_DISABLED=1` | hard-disable computer control |
| `XR_BROWSER_HEADLESS=1` | run Playwright headless |
| `XR_STT_URL` / `XR_TTS_URL` | voice endpoints |
| `XR_SEARXNG` | research search backend |
| `XR_WAKE_WORD=true` | enable wake-word listening |
| `GROQ_API_KEY`, `OPENAI_API_KEY`, … | BYOK provider keys |

---

## 🔧 Quick Recipes

**Use Groq for free, fast inference:**
```bash
xr providers add groq          # paste key (stored in OS keychain if available)
xr providers set groq llama-3.3-70b-versatile
```

**Fully offline (local model only):**
```bash
xr models install qwen2.5:7b
xr providers set ollama qwen2.5:7b
```

**Automate a repeatable web workflow with zero ongoing cost:**
```bash
xr control start
xr control browser install
xr control plan "log into example.com and download the latest report" --yes
# First run uses LLM. Every subsequent run: ⚡ recalled from memory.
```

**Watch live what XR is doing across all surfaces:**
```bash
# Terminal 1
xr serve                                      # dashboard at 127.0.0.1:7842

# Terminal 2
xr "build me a CRUD app and run the tests"   # see every step in the dashboard

# Optionally answer approvals from the dashboard instead of the terminal.
```

---

## 🛡️ Why Trust XR

- **Open source** — every line of safety code is auditable in this repo
- **Local-first** — no telemetry, no analytics, no remote config
- **BYOK** — your key, your tokens, your bills
- **Hard caps** — the agent cannot exceed your budget; the planner cannot bypass approvals
- **Hash-chained audit** — tampering is detectable, `xr verify-log` proves it
- **Disable anything** — config flags + env overrides for every subsystem
- **Tested** — 165+ tests including the entire safety pipeline

---

## 🗺️ Roadmap (post-v0.8.2)

- 📊 Telemetry-free **usage analytics** export (CSV / JSON) — opt-in
- 🔌 **MCP server** mode (XR as an MCP host for other agents)
- 🌳 Multi-account profiles (`xr profile use work`)
- 🧪 **Browser test recorder** — record a workflow once → save as a memory entry
- ☁️ Sync remembered plans across machines via your own Git repo (no cloud)
- 🪟 **Wayland** synthetic input via `ydotool` integration

---

## 🤝 Contributing

```bash
git clone https://github.com/ahmadrrrtx/xr
cd xr && bun install
bun test                  # all tests must pass
bun run typecheck         # 0 errors required
```

Open issues + PRs welcome. Big things to help with:
- Wayland support for `xr control`
- More browser-action verbs (download, upload, screenshot regions)
- Provider adapters for new model APIs
- Translations of the onboarding wizard

---

## 📜 License

MIT © [Muhammad Ahmad (@ahmadrrrtx)](https://github.com/ahmadrrrtx)

---

<p align="center">
<b>XR — the AI agent you can actually trust.</b><br>
<sub>by rrrtx · BYOK · local-first · spend-capped · tamper-evident</sub>
</p>
