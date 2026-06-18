![XR — cybernetic guardian avatar](https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png)

# ⚡ XR — The AI Agent You Can Actually Trust

**`BYOK` · `local-first` · `local model intelligence` · `spend-capped` · `tamper-evident` · `safe computer control` · `multi-step planner` · `plan memory` · `durable memory` · `universal provider engine`**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![SQLite](https://img.shields.io/badge/SQLite-state-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Tests](https://img.shields.io/badge/tests-219%20passing-34e2a0?style=flat-square)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-9a6bff?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows%20%C2%B7%20Termux-00d2ff?style=flat-square)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-v1.0.0-22e0ff?style=flat-square)](#)

---

> **You bring the key. We ship none.**
> XR runs on *your* provider API key or *your* local model — it costs **us $0 to maintain** and **you $0 to trust.**

---

## 🚀 Install XR

The bootstrapper installs the XR core and then launches the resumable setup wizard. Optional local AI, voice, browser automation and desktop control packs are opt-in.

```bash
# Linux / macOS / Termux / WSL
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

```powershell
# Windows PowerShell
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

```bash
# Re-run safely any time
xr install                         # setup wizard
xr doctor                          # health check
xr repair                          # safe repair
xr update                          # update with rollback guard
xr status                          # component status
```

Install modes:

```bash
xr install --mode minimal          # core only
xr install --mode local            # local/free via Ollama where available
xr install --mode byok             # cloud keys you own
xr install --mode hybrid           # cloud primary + local fallback
xr install --mode full             # asks for all optional packs
```

After install:

```bash
xr models recommend
xr models install                  # optional local model pull
xr "hello"
```

---

## 🏛️ v1.0 Foundation Runtime: The AI OS Kernel

XR has evolved from a modular agent script into a **True AI Operating System**. The v1.0 Foundation Runtime introduces a hardened kernel that ensures stability, security, and infinite extensibility.

- **Service Container (DI)**: A lightweight dependency injection system that manages services (Agent, Budget, Provider, Plugins) with a strictly controlled lifecycle.
- **Lifecycle Management**: Formal `Bootstrap` → `Start` → `Stop` sequence ensuring all subsystems are healthy before the agent takes the wheel.
- **Specialized Store Architecture**: The monolithic database has been decomposed into specialized, isolated stores (Session, Audit, Memory, Cost, Skill), preventing state corruption and enabling independent scaling.
- **Command Registry**: Decoupled CLI commands. Adding a new system capability no longer requires modifying the core router.
- **Event-Driven Core**: An internal Event Bus allowing decoupled services to communicate asynchronously without tight coupling.

---

## ✨ What Makes XR Different

| | Most AI agents | **XR** |
|---|---|---|
| **Provider** | locked to vendor | BYOK — **any of 20+ providers**, or **fully local** via Ollama, LM Studio, vLLM, LocalAI, Jan |
| **Cost** | "soft" warnings | **hard ceiling enforced in code** (`checkBeforeStep()`) |
| **Security** | trust us | **deterministic injection benchmark**, signed block-rate report |
| **Audit** | scrollback only | **SHA-256 hash chain** — tamper-evident, offline, free |
| **Computer Control** | wild west | **safe-by-construction** — classify → preview → approve → audit |
| **Multi-step planner** | hidden prompts | **typed Action[] schema** validated with Zod, every step previewed |
| **Browser automation** | none / hardcoded | **Playwright backend** — DOM selectors, opt-in, lazy-loaded |
| **Plan memory** | none | **cached deterministic plans** — second run skips the LLM |
| **Dashboard** | cloud-only | **127.0.0.1 only**, token-authed, live approvals, no telemetry |
| **Voice** | cloud STT | **local Whisper + Kokoro** by default, push-to-talk |
| **Runtime** | procedural script | **AI OS Kernel** with DI and Lifecycle management |

---

## 🎯 Core Features

### 🖥 Safe Computer Control (v0.8 → v0.8.2)
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

> **Plan memory ≠ durable memory.** Plan memory caches *control plans*; durable memory (below) stores *your* preferences, projects and facts.

### 🧠 Durable Memory (v0.9)

XR remembers your preferences, projects, and long-term facts — **only what you explicitly ask it to.** No silent auto-save, no hidden background capture. Everything is local-first, inspectable, editable, and permanently deletable.

```bash
xr memory add "I prefer TypeScript and Bun" --category preference
xr memory add "this project is called XR" --category project --scope xr
xr memory list                              # see everything XR remembers
xr memory recall "what do I prefer?"        # exactly what chat/voice will surface
xr memory search "bun"                      # keyword search
xr memory edit  mem_ab12 "prefer Bun + Zod" # change an entry
xr memory remove mem_ab12                   # forget one entry (permanent)
xr memory clear                             # forget everything (asks first)
xr memory export memories.json              # take your memory with you
xr memory import memories.json              # merge a bundle (dedupes)
```

In chat and voice it's conversational:

```text
"Remember I prefer TypeScript and Bun"        → saved as a preference
"Remember this project is called XR"          → saved as project context
"What do you know about my preferences?"      → reads them back
"Forget this note"                            → deletes it
"Don't remember my email"                     → a do-not-remember rule
```

**Categories (namespaces):** `preference` · `project` · `workflow` · `fact` · `exclusion`

**How recall works:** when you run a task, XR surfaces *only the few entries relevant to that task* as one clearly-labelled reference block — never every memory on every prompt. `exclusion` rules are never surfaced and actively block matching content from ever being stored.

**Semantic recall (v0.9):** retrieval uses **embeddings** (local Ollama `nomic-embed-text`) for meaning-based matching, with an automatic, dimension-safe **lexical fallback** so it works even with no embedding model — fully offline, never crashes. Embeddings are cached per entry and computed lazily on first recall (or warmed with `xr memory reindex`). Force deterministic keyword scoring with `xr memory recall "…" --lexical`, or disable globally with `memory.semanticRecall: false`.

**Summarization (v0.9):** keep long-lived memory tidy with `xr memory summarize` — it folds **old, low-importance** entries (per category/scope) into compact digests. It's a two-phase, **approval-first** flow: it *proposes* what would fold, then asks before changing anything (`--dry-run` to preview, `-y` to skip the prompt). Deterministic, and `exclusion` rules are never folded.

```bash
xr memory summarize --dry-run               # preview the proposal, change nothing
xr memory summarize --days 60 --max-importance 2   # tune the criteria
xr memory summarize -y                       # apply (folds old notes → digests)
```

**Short-term ≠ long-term:** ephemeral conversation recaps live in a separate `session_summaries` store (`xr memory summaries`) and never leak into durable memory.

**Privacy & control**
- Local-first: stored in `~/.xr/xr.db`, never synced anywhere by default.
- Explicit by default: only what you ask is stored.
- Disable entirely: `memory.enabled: false` in config, or `XR_MEMORY_DISABLED=1`.
- Logs/telemetry never contain raw memory content — only ids and counts.
- Research findings are saved only on request: `xr research remember [id]`.

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

### 🧩 Plugin Ecosystem (1.0)
```bash
xr plugins install ./plugins/github   # shows permissions, asks to approve
xr plugins enable github              # explicit, conscious step
xr plugin github repo ahmadrrrtx/xr   # run a plugin command
```
XR gains new integrations and skills through **plugins**, not by editing core
code. Plugins are **local-first, permission-based, and sandboxed by design**:

- A plugin only ever sees a frozen **host** — never the database, raw config,
  `process.env`, `fetch`, or `node:fs`.
- A capability (`net`, `fs`, `secrets`, `memory`, `provider`, …) exists **only**
  for a permission you explicitly granted.
- Plugins **inherit and cannot bypass** the egress allow-list, spend caps,
  memory rules, and the tamper-evident audit log.
- The entrypoint is hashed at install; a tampered plugin is refused as
  `untrusted`. A broken plugin is isolated — **XR core never goes down**.
- Plugin tools reach the agent as `plugin.<id>.<name>` and are approval-gated.

Full spec, permission model, and a writing guide: **[docs/PLUGINS.md](docs/PLUGINS.md)**.

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
xr serve --port 8000 --token mytoken
```
- Cost cockpit (live)
- Security posture (injection block-rate)
- Audit explorer (with hash chain)
- **Computer Control** panel with:
  - Capability matrix (kbd / mouse / launcher / browser)
  - Pending approvals with Approve/Deny buttons
  - Live event stream
  - 🧠 Remembered plans list with per-row forget + clear-all
- **🧠 Durable Memory** panel (v0.9):
  - Live view of saved preferences, projects & facts (category-colored, importance stars)
  - Per-entry forget + clear-all (read-only otherwise — add/edit stay CLI-only)
  - Do-not-remember (`exclusion`) rules are never shown in the browser

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
xr "..." --json                           # machine-readable output
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

### 🌐 Universal Provider Engine (Stage 3)

XR's provider engine is a **first-class runtime subsystem**. It supports 20+
hosted and local providers, custom OpenAI-compatible endpoints, automatic
routing, health checks, and secure key management — all through a single clean
abstraction.

**Supported providers out of the box:**

- **Free cloud:** Groq, Google Gemini, DeepSeek, Cerebras
- **Cheap cloud:** OpenRouter, Together AI, Mistral AI, Fireworks, SambaNova, Hugging Face
- **Premium:** OpenAI, Anthropic Claude, Cohere, xAI (Grok), Perplexity
- **Enterprise:** AWS Bedrock
- **Local / self-hosted:** Ollama, LM Studio, Jan, LocalAI, vLLM
- **Custom:** any OpenAI-compatible endpoint you define

**Provider commands:**

```bash
xr providers list                          # all providers, key status, capabilities
xr providers status                        # active provider, routing, health
xr providers test                         # health-check ALL registered providers
xr providers test <id>                     # test one provider (auth + connectivity + model)
xr providers set <id> [model]              # switch active provider + optional model
xr providers add                           # interactive wizard: custom endpoint
xr providers remove <id>                   # remove a custom provider
xr providers refresh                       # re-sync custom providers from config
```

**Provider routing strategies** (set in config or override per task):

```bash
xr "task" --strategy localFirst           # prefer local, fallback to cloud
xr "task" --strategy cloudFirst           # prefer cloud, fallback to local
xr "task" --strategy cheapest             # lowest-cost available provider
xr "task" --strategy hybrid               # primary + local fallback (default)
```

**Provider override for a single task:**

```bash
xr "task" --provider openai --model gpt-4o
xr "task" --provider anthropic --model claude-3-5-sonnet-20241022
xr "task" --provider ollama --model qwen2.5:14b
xr "task" --provider openrouter --model anthropic/claude-3.5-sonnet
```

**Custom endpoint example (e.g., LM Studio, vLLM, enterprise proxy):**

```bash
xr providers add
# → prompts for ID, label, base URL (http://localhost:1234/v1), model, API key
xr providers set my-proxy llama-3-8b
xr providers test my-proxy
```

Key management is **secure by default**: OS-backed stores (macOS Keychain,
Linux Secret Service, Windows DPAPI) are used when available. File fallback is
chmod 600. Keys are **never** printed in diagnostics or logs.

### Local Models

```bash
xr models                                 # local model status
xr models recommend                       # auto-detect hardware → suggest model
xr models install [id]                    # download & configure Ollama model
xr models test [id]                       # smoke test
xr models set <id>                        # select and configure routing
xr models remove <id>                     # remove a pulled model
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

### Plugins (1.0)

```bash
xr plugins                                # list installed plugins + status
xr plugins inspect ./plugins/hello        # manifest + permissions (no code runs)
xr plugins install ./plugins/hello        # install a local plugin (asks to approve)
xr plugins enable hello                   # enable (separate, conscious step)
xr plugins permissions hello              # what can this plugin access?
xr plugin hello greet rrrtx               # run a command a plugin contributes
xr plugins update hello [path]            # update (rejects NEW permission asks)
xr plugins disable hello                  # disable cleanly
xr plugins remove hello                   # uninstall + delete files
xr plugins doctor                         # per-plugin health
```

Flags: `--yes/-y`, `--enable`, `--grant net,secrets`, `--json`. See
[docs/PLUGINS.md](docs/PLUGINS.md) for the manifest spec, permission model, and
how to write a plugin.

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

### Skills + RAG (project)

```bash
xr skills                                 # list learned skills
xr index                                  # build local RAG index of the project
```

### Durable Memory (v0.9)

```bash
xr memory add "note" --category preference
xr memory list
xr memory search "keyword"
xr memory recall "what do I prefer?"
xr memory edit <id> "new text"
xr memory remove <id>
xr memory clear                           # asks first
xr memory export bundle.json
xr memory import bundle.json
xr memory summarize --dry-run             # preview old → digests
xr memory reindex                         # warm embedding cache
```

### Config & Utilities

```bash
xr config                                 # dump current config (sanitized)
xr config edit                            # open in $EDITOR
xr repair                                 # fix permissions, reinstall deps
xr status                                 # system check
xr doctor                                 # full health check + provider matrix
xr doctor --json                          # machine-readable health report
xr update                                 # update with rollback guard
xr reset [--hard]                         # wipe config + database (backup first)
```

---

## 🛠️ Architecture

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CLI /      │     │  Dashboard   │     │   Telegram   │
│   Voice      │     │  (127.0.0.1) │     │   Webhook    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    Command Registry         │
              │    (runtime dispatch)       │
              └─────────────┬─────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
   ┌─────▼─────┐   ┌───────▼───────┐   ┌──────▼──────┐
   │  Agent    │   │  Provider     │   │   Budget    │
   │  Service  │   │  Engine       │   │  Service    │
   │           │   │  (routing)    │   │             │
   │  ┌─────┐  │   │               │   │             │
   │  │ LLM │◄─┼───┼──►20+ providers│   │             │
   │  │Loop │  │   │  local/cloud   │   │  ┌──────┐  │
   │  └──┬──┘  │   │  custom/BYOK   │   │  │Spend │  │
   │     │     │   │  fallback      │   │  │Cap   │  │
   │  ┌──▼──┐  │   │  health check  │   │  └──────┘  │
   │  │Tools│  │   └───────────────┘   └──────────────┘
   │  └─────┘  │
   └───────────┘
         │
   ┌─────▼──────┐
   │  Stores     │
   │  (SQLite)   │
   │  session    │
   │  audit      │
   │  memory     │
   │  cost       │
   │  skill      │
   └─────────────┘
```

---

## 🏗️ Project Structure

```text
src/
  core/          # runtime, DI, lifecycle, command registry, event bus
  providers/     # 🌐 Universal Provider Engine
    presets.ts       # 20+ provider metadata definitions
    registry.ts      # dynamic provider registry + custom provider sync
    routing.ts       # localFirst/cloudFirst/cheapest/hybrid strategies
    health.ts        # auth-safe health checks + full provider matrix
    capabilities.ts  # typed capability schema (vision, tool-use, streaming, …)
    openai-compat.ts # universal adapter for any OpenAI-compatible endpoint
    custom.ts        # thin wrapper for user-defined custom providers
    factory.ts       # backward-compatible facade (preserves all old exports)
    native/          # non-OpenAI adapters (Anthropic, Google, Mistral, Cohere, Bedrock, Cerebras)
  services/      # provider-service, agent-service, budget-service, plugin-service, config-service
  commands/      # CLI command implementations (run, install, providers, doctor, …)
  config/        # schema-validated, versioned config loader (v9) with migrations
  install/       # system.ts — platform detection, wizard, health checks
  security/      # secrets.ts — OS-backed keychain / secret-tool / DPAPI + file fallback
  interfaces/    # CLI UI helpers (ask, confirm, password, colors)
  local/         # hardware detection, Ollama integration, model registry
  state/         # specialized stores (session, audit, memory, cost, user-memory)
  automation/    # Playwright / browser automation
  computer/      # desktop control primitives (mouse, keyboard, window)
  plugins/       # plugin system loader, sandbox, permission gate
  voice/         # STT / TTS pipeline
  cost/          # pricing tables, spend tracking
  reliability/   # grammar, profiles, repair — deterministic output shaping
  …
```

---

## 🧪 Testing

```bash
bun test                         # run the full test suite
bun run typecheck                # TypeScript strict check (zero errors)
bun run dev                      # watch mode for development
```

---

## 📝 License

MIT — see [LICENSE](LICENSE).

---

**XR is not a chatbot. XR is an AI Operating System.**

> Built by [@ahmadrrrtx](https://github.com/ahmadrrrtx) · Stage 3: Universal Provider Engine
