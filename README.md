![XR — cybernetic guardian avatar](https://raw.githubusercontent.com/ahmadrrrtx/xr/main/assets/avatar.png)

# ⚡ XR — The AI Agent You Can Actually Trust

**`BYOK` · `local-first` · `local model intelligence` · `spend-capped` · `tamper-evident`**

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

Local-first setup:
```bash
xr onboarding          # choose Local-only or Hybrid
xr models recommend    # inspect hardware and pick a model
xr models install      # download the recommended Ollama model
xr models test         # smoke-test local inference
```

Or run the interactive onboarding:
```bash
xr onboarding
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


### 🧠 Local Model Intelligence (v0.5)
```bash
xr models recommend      # detect RAM/VRAM/CPU/disk and explain the recommendation
xr models install        # pull the recommended Ollama model and save it
xr models set qwen2.5:7b # choose local-only / hybrid / cloud-first routing
xr models test           # verify Ollama + selected model respond
```
XR now detects your hardware, recommends a practical Ollama model, optionally downloads it, saves the selected model in config, and uses it as the default or deterministic cloud fallback. Local-only mode works with no API keys. Hybrid/cloud-first mode can use cloud providers when configured and fall back to local when the primary provider fails.

### 🔬 Research Mode (v0.7)
```bash
xr research "best budget laptops for software development"   # quick
xr research deep "compare Ollama vs cloud providers"          # deeper
xr research plan "is RISC-V ready for laptops?"               # plan only
xr research export                                            # → signed markdown report
```
XR's research mode is **source-first, not answer-first**. It builds a research plan,
searches the web (egress-gated), ranks and de-duplicates sources by a transparent
trust heuristic, fetches the top pages, extracts citation-tied evidence notes, detects
contradictions, and synthesizes a structured report — **short answer + executive summary
+ full report + open questions + sources table**.

It will **never fabricate a source or fake certainty**:
- Every note is tied to a source id (`[s1]`) and tagged `fact` / `inference` / `opinion`.
- A note is only marked **verified** when XR actually fetched the page — snippet-only
  notes are flagged `unverified` and their confidence is downgraded.
- If search is unavailable, XR says so and refuses to invent an answer.
- Research uses the **same provider routing, local fallback, and spend caps** as the rest
  of XR — token/$ spend is always shown, never silent. Reports are SHA-256 signed.

`quick` = fewer sources / faster · `deep` = more sources / richer synthesis. Reports are
saved to `~/.xr/research/` as markdown + a machine-readable JSON sidecar. Voice/chat flows
auto-route to research when you say *"research…", "investigate…", "compare…"*.

> Requires a search host (default SearXNG `searx.be`) to be on your egress allow-list.
> `xr doctor` reports research health. Set `XR_SEARXNG` to use your own instance.

### 🧠 JARVIS-Level Computer Control
```bash
xr --computer "open Safari and search for AI agents"
```
XR sees your screen via screenshots, reasons about what's on it, and takes actions — click, type, scroll, open apps — just like you would. It's the difference between *asking* an agent to do something and *showing* it what to do.

### 🖥 Safe Computer Control (v0.8)
A deterministic, explicit automation layer for real workflows. Every action is **classified**, **previewed**, and **approved** before it runs — and the whole subsystem is **off by default**.

```bash
xr control start                              # opt-in, writes config.control.enabled = true
xr control status                             # capabilities + missing deps
xr control test                               # dry-run a representative plan (executes nothing)
xr control app   "Visual Studio Code"         # launch an app
xr control open  "https://github.com/ahmadrrrtx/xr"
xr control type  "hello from xr"              # types into the focused window
xr control click "640,480" --double
xr control key   "cmd+tab"                    # any combo
xr control scroll down 5
xr control stop                               # hard-disable
```

**Safety model**

- **Safe** actions (move/scroll/focus) run immediately.
- **Sensitive** actions (open/type/click/key/app) prompt — `--yes` skips that prompt only for these.
- **Destructive** actions (shell-like text, `Enter`, `Shift+Delete`, `file://`, executables, `javascript:`, sensitive=true) **always** prompt, even with `--yes`.
- `--dry-run` previews a plan and executes nothing.
- `--step` confirms every single action.
- `XR_CONTROL_DISABLED=1` or `xr control stop` hard-disables the entire subsystem.
- Every plan, execution, denial, and disable event is appended to the tamper-evident audit log. Sensitive text is redacted before storage.

**Platform notes**

| OS | Built-in | Recommended install |
|----|----------|---------------------|
| macOS | `osascript`, `open` | `brew install cliclick` for mouse move/click |
| Linux (X11) | — | `sudo apt install xdotool wmctrl xdg-utils` |
| Windows | PowerShell (built-in) | — |

`xr doctor` reports computer-control health alongside the other systems.

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
### Core

| Command | What it does |
|---|---|
| `xr "task"` | Run a task (default: agent mode) |
| `xr onboarding` | Interactive setup wizard |
| `xr config` | View current configuration |
| `xr doctor` | System health + audit chain + research/voice/budget check |
| `xr reset` | Factory reset (deletes config & db) |
| `xr cost` | Lifetime cost & token summary |
| `xr skills` | List learned skills + frozen baselines |
| `xr verify-log` | Verify the tamper-evident audit chain |
| `xr test` / `xr --attacks` | Run the prompt-injection block-rate benchmark (`--json` for signed report) |

### Flags

| Flag | What it does |
|---|---|
| `--tui` | Interactive terminal UI |
| `--computer "task"` | JARVIS GUI / desktop automation |
| `--voice` | Start voice interaction |
| `--mode plan\|ask\|agent` | Operation mode (plan/ask are read-only) |
| `--provider <id>` `--model <id>` | Override provider / model |
| `--budget <usd>` | Hard per-task USD ceiling |
| `--max-tokens <n>` `--max-steps <n>` | Per-task token / step ceilings |
| `--dry-run` | Simulate side effects, touch nothing |
| `--json` | Machine-readable output (where supported) |
| `--help` | Show help |

### Providers & local models

| Command | What it does |
|---|---|
| `xr providers` | List providers + key status (subcommands: `list`, `add`, `set`, `test`, `remove`) |
| `xr models` | Local model status (default) |
| `xr models list` | List supported Ollama local models |
| `xr models recommend` | Detect RAM/VRAM/CPU/disk and recommend a model |
| `xr models install [id]` | Download/configure an Ollama model |
| `xr models set [id]` | Select local model + routing (`local-only`/`hybrid`/`cloud-first`) |
| `xr models test [id]` | Smoke-test local inference |
| `xr models remove [id]` (alias `rm`) | Remove an Ollama model |

### Budget

| Command | What it does |
|---|---|
| `xr budget` (or `status`) | View spend caps + usage |
| `xr budget set <amount>` | Set monthly spend cap (USD) |
| `xr budget reset` | Reset recorded spending |
| `xr budget history` | Spend history by model |

### Voice

| Command | What it does |
|---|---|
| `xr voice` (or `status`) | Voice stack status |
| `xr voice test` | STT→TTS loopback test |
| `xr voice start` / `stop` | Start/stop interactive voice mode |
| `xr speak "text"` | Make XR speak text |
| `xr listen` | Capture one voice command |

### 🔬 Research (v0.7)

| Command | What it does |
|---|---|
| `xr research "topic"` | Source-first research (quick depth) |
| `xr research quick "topic"` | Fast: fewer sources, faster summary |
| `xr research deep "topic"` | Deeper: more sources, richer synthesis |
| `xr research plan "topic"` | Generate research questions + strategy only |
| `xr research status [id]` | Show current/most-recent session |
| `xr research sources [id]` | List collected sources + trust |
| `xr research summarize [id]` | (Re)synthesize a report from collected notes |
| `xr research export [id] [path]` | Write report → markdown (+ JSON sidecar), signed |
| `xr research list` | Recent research sessions |

Research flags: `--provider`, `--model`, `--budget <usd>` (per-research ceiling for cloud).

> **Note on roadmap commands:** `xr serve` (dashboard), `xr telegram`, `xr index`/`xr memory`
> (RAG), `xr sandbox`, `xr export`, `xr mcp`, and `xr cron` correspond to subsystems that exist
> in the codebase but are **not yet wired into the CLI dispatcher** — they are slated for a
> follow-up release. The commands in the tables above are the ones implemented and verified today.

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
              │ Research        │
              │   sessions      │
              │ Schedules       │
              └─────────────────┘
```

**Stack:** TypeScript (strict) · Bun runtime · SQLite · **1 runtime dep (`zod`)** · 134 tests (133 passing)

### 🔬 Research Mode — under the hood (`src/research/`)

Research is a **clean, self-contained module**, decoupled from provider auth, budget, voice,
and control. Every layer takes its inputs explicitly and returns plain data, so the workflow
is **deterministic, repeatable, and testable**. It *reuses* XR's existing systems instead of
forking them — same provider routing + local fallback, same spend caps, same egress
allow-list, same tamper-evident audit log.

```
topic
  │  (engine.ts orchestrates the whole flow, persisting after every step)
  ├─ 1. plan        makePlan()         → objective, research questions, queries, strategy
  ├─ 2. search      WebSearchCapability → raw hits per query (egress-gated SearXNG)
  ├─ 3. rank        rankSources()      → trust-scored, de-duplicated Source[]
  ├─ 4. fetch       fetch top sources  → full page text (best effort)
  ├─ 5. extract     extractFromSource  → Notes (each cited + verified-flagged)
  ├─ 6. synthesize  synthesize()       → short answer, summary, report, contradictions
  └─ export         renderReport()     → signed markdown (+ JSON sidecar)
```

| File | Responsibility | Key exports |
|------|----------------|-------------|
| `research/types.ts` | Data model + depth budgets | `ResearchSession`, `Source`, `Note`, `Synthesis`, `DEPTH_BUDGETS` |
| `research/search.ts` | Egress-gated search/fetch capability | `WebSearchCapability`, `SearchCapability`, `parseSearxOutput` |
| `research/ranking.ts` | Deterministic trust scoring + dedupe | `scoreDomain`, `rankSources`, `domainOf` |
| `research/llm.ts` | Tools-free structured LLM call + JSON repair | `structuredCall`, `extractJson` |
| `research/plan.ts` | Plan generation (+ deterministic fallback) | `makePlan`, `fallbackPlan`, `queriesFromPlan` |
| `research/extract.ts` | Per-source evidence extraction | `extractFromSource` |
| `research/synthesize.ts` | Synthesis + contradiction detection | `synthesize`, `fallbackSynthesis` |
| `research/report.ts` | Citation-aware markdown rendering + signing | `renderReport`, `verifyReport` |
| `research/budget.ts` | Adapts `CostGovernor` to the engine | `GovernedResearchBudget`, `LocalResearchBudget` |
| `research/engine.ts` | The orchestrator (the flow above) | `runResearch`, `summarizeExisting`, `newSession` |
| `research/cli.ts` | `xr research …` command handlers | `handleResearchCommand` |

**Integrity guarantees (enforced in code, covered by `test/research.test.ts`):**

- **Source-first, not answer-first** — sources are collected before any conclusion.
- **Citation-aware** — every note references a `sourceId`; the report cites `[s1]`, `[s2]`.
- **No fake verification** — a note is `verified` **only** if the page was actually *fetched*;
  snippet-only notes are flagged `unverified` and their confidence is downgraded.
- **Honest uncertainty** — facts / inference / opinion are distinguished; contradictions and
  open questions are surfaced, not hidden.
- **Deterministic ranking** — trust comes from transparent domain heuristics, never an LLM.
- **No silent spend** — token/$ usage is metered and shown; over a cap, research stops
  gracefully with partial results saved.
- **Graceful degradation** — if search is unavailable, XR says so and produces an honest
  "no conclusion" report instead of inventing an answer.
- **Tamper-evident reports** — each markdown report carries a SHA-256 signature (`verifyReport`).

Depth budgets (`DEPTH_BUDGETS` in `research/types.ts`):

| depth | queries | results/query | max sources | fetched | questions |
|-------|---------|---------------|-------------|---------|-----------|
| quick | 3       | 5             | 8           | 3       | 3         |
| deep  | 6       | 6             | 16          | 8       | 6         |

Reports are saved to `~/.xr/research/` as `<id>-<slug>.md` + a `.json` sidecar. Voice/chat
flows auto-route to research when you say *"research…", "investigate…", "compare…"*. Requires
a search host (default SearXNG `searx.be`, override `XR_SEARXNG`) on the egress allow-list;
`xr doctor` reports research readiness. See `docs/research/RESEARCH-MODE-v0.7.md` for the
full design.

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
- **LLM:** Ollama (local, free) or supported BYOK cloud providers
- **RAM:** 4GB minimum (8GB+ recommended for local 7B models; 16GB+ for 14B)
- **Storage:** ~100MB for XR + ~2.5–20GB per downloaded local model

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
- **Local runtime**: v0.5 implements Ollama only. Other local runtimes can be added behind the same abstraction later.
- **Local models**: recommendations are deterministic heuristics based on RAM/VRAM/CPU/disk, not ML benchmarking. Small models can be slower or less reliable for complex agent tasks.
- **Voice**: requires Whisper server (local or cloud) and optional TTS server
- **Computer use**: requires a screenshot tool (`screencapture` on macOS, `scrot`/`gnome-screenshot` on Linux, .NET on Windows)

---

## 📄 License

MIT — by [Muhammad Ahmad (@ahmadrrrtx)](https://github.com/ahmadrrrtx)

**Use XR. Trust it. Improve it.**
