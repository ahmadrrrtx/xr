# How OpenClaw / Hermes Actually Work — and How to Build Something Crazier
### Structural breakdown from the 4 videos + research, for @ahmadrrrtx
*Compiled 2026-06-03. Companion to SENTINEL-agent-research.md.*

---

## 0. The single most important takeaway

> Greg Isenberg's course says it best: **"Every agent harness is just a different car with the same engine."**
> Claude Code, Codex, Antigravity, Manus, OpenClaw, Hermes — *all of them run the exact same loop under the hood.* Learn the engine once and you can build any of them.

That engine is the **Agent Loop: Observe → Think → Act → (repeat until done).**

So "build something crazier than Hermes" does NOT mean inventing a new engine. It means:
1. Build the **same proven engine** (it's genuinely not magical — the Chai aur Code video builds a working OpenClaw clone in one sitting with Bun + Commander + Clack).
2. Then **win on the layers Hermes/OpenClaw are weak at**: security, memory, and proof. That's your "crazier."

---

## 1. What each video actually teaches (decoded)

### 🎥 Video 1 — Chai aur Code: "Build your own OpenClaw" (4h, the *how-to-build*)
This is your **blueprint**. It builds a real OpenClaw clone from scratch. Key structural facts:
- **It's a CLI app**, scaffolded with **Bun** (fast JS runtime), **Commander** (CLI command parsing), **Clack** (interactive prompts), **Figlet** (banner art).
- Entry point is a single executable (`#!/usr/bin/env` shebang, `bin` field in package.json, `bun link` to install it globally as a command).
- It exposes **3 modes**: **Agent Mode** (plans + executes with tools), **Plan Mode** (only plans), **Ask Mode** (Q&A). Plus a **Telegram** control channel.
- The agent **reads context on startup**, then for a task it **picks tools** (e.g. `read_file`, `modify_file`), executes them, and shows you a **diff to approve / review one-by-one / accept** — exactly like Claude Code.
- **Lesson:** the "magic" is ~4 hours of fairly normal Node/TS code. A loop + tool definitions + an LLM call + a confirm step. You can 100% build this.

### 🎥 Video 2 — Mani Kanasani: "5 AI Employees with OpenClaw" (10h, the *production/scale*)
This shows what a **maxed-out, business-grade** agent system looks like — your "feature ceiling" reference. Architecture it reveals:
- **3-tier agent separation: Builder → Orchestrator → Executor.** (Builder constructs platforms; Orchestrator = OpenClaw manages workflows; Executors = specialized agents do the actual work.) This is the pattern that "changed everything" for him.
- **Sub-agents with token budgets** — a main "brain" model + cheaper "muscle" models, routed by cost.
- **"Business Brain" memory in 3 levels**: L1 identity → L2 strategic context → L3 operational playbooks/decision-trees. Plus a **memory architecture** of files (soul/identity, user context, tools, daily logs) to prevent "memory decay."
- **Token-optimization stack (8 layers)**: kill thinking mode, cap context, model routing, session discipline, prompt caching, heartbeat to Ollama, sub-agent isolation → $150/mo down to ~$10.
- **Security chapter (he has a Master's in cybersecurity):** *"17,000 exposed OpenClaw instances, two unpatched zero-days"* — his hardening guide "stops 80% of attacks in 15 min." **This is the gap you industrialize.**
- Mission Control dashboard (Kanban), cronjobs/heartbeats, Discord/Telegram, voice/phone agent, multi-agent orchestration, even agent-to-agent payments (USDC on Base).

### 🎥 Video 3 — Greg Isenberg + Remy: "Building AI Agents that actually work" (the *concepts/engine*)
This is the **clearest explanation of the engine**:
- **Chat = question→answer. Agent = goal→result.** An agent plans, executes, loops, and delivers.
- **The Agent Loop = Observe → Think → Act**, repeated until the task's completion criteria (set in the prompt) are met.
- **An agent = 4 components:** ① **LLM** (the brain), ② **Loop** (keeps going, no babysitting), ③ **Tools** (what it can do), ④ **Context** (what it knows). The platform that runs this = an **agent harness**.
- **Context engineering > prompt engineering:** load the agent with rich context (`agents.md` / `claude.md`) so a 2-word prompt gives great output.
- **Memory that compounds:** a `memory.md` file + the rule *"when I correct you, update memory.md"* → self-improving loop, fewer errors over time.
- **MCP** = universal translator between agent and tools (Gmail, Calendar, Stripe, Notion…).
- **Skills = reusable SOPs as markdown** — explain a process once, invoke it forever; they compound (~3–5/week).
- **Security = scoping access.** Give read-only where possible; control tool permissions so a compromise has small blast radius. He literally calls OpenClaw *"the wild west."*

### 🎥 Video 4 — Julian Goldie: "Hermes vs OpenClaw — who wins" (the *competitive intel*)
This tells you **exactly why Hermes is beating OpenClaw** — i.e., what users reward:
- **Hermes wins on smoothness & reliability.** OpenClaw "breaks a lot more." On OpenRouter, Hermes' usage is climbing while OpenClaw's is declining since Hermes launched (Feb 2026).
- **Hermes was built by a top lab (Nous Research)** and **"evolves over time / gets better,"** while OpenClaw "got worse."
- **Hermes wins on organized knowledge/docs** (people return to learn).
- **Hermes ships what people actually want:** Kanban boards, **persistent goals** (their take on the "Ralph loop" for autonomy), **MCP catalogs**, and **Hermes Desktop** — a free GUI so you don't need the terminal.
- **The killer insight:** OpenClaw ships "shiny/flashy features 99% won't use"; Hermes ships *useful, listened-to* features and a **friendly non-terminal gateway**.

---

## 2. The universal anatomy (what you must build, minimum)

Combining all four videos, every one of these agents = the same 6 parts:

```
┌─────────────────────────────────────────────┐
│  AGENT HARNESS (CLI / Desktop / Telegram)    │
│                                              │
│   1. LLM (brain)  ──┐                         │
│   2. AGENT LOOP ────┤ Observe → Think → Act   │
│   3. TOOLS ─────────┘ (read/write file, shell,│
│        web, MCP servers…)                     │
│   4. CONTEXT  (agents.md / system prompt)     │
│   5. MEMORY   (memory.md, compounding)        │
│   6. SKILLS   (markdown SOPs, reusable)       │
│                                              │
│   + Approval/diff step before risky actions   │
└─────────────────────────────────────────────┘
```

If you build those 6, you have an OpenClaw/Hermes-class agent. Everything else (Kanban, voice, Discord, multi-agent) is **features bolted on top**.

---

## 3. How to build something CRAZIER than Hermes (the strategy)

Hermes wins on **smooth + reliable + useful + friendly gateway + evolves over time**. OpenClaw loses on **buggy + wild-west security + flashy-useless**. So to beat *both*, combine Hermes' strengths with the one thing **neither** has nailed: **security + provable trust + true self-improvement.** Your three superpowers:

### 🥇 Superpower 1 — Secure by architecture (your real moat)
Hermes is smooth but NOT secure-by-design. OpenClaw is "the wild west" with 17k exposed instances + zero-days. **Nobody in this race ships the academic defenses by default.** You do:
- **Dual-LLM / CaMeL** (privileged planner never sees untrusted data; quarantined LLM has no tools).
- **Capability/taint tracking** on every value.
- **Per-task least-privilege tools** (code-review mode literally can't run `bash`).
- **Egress allow-list** (can't reach arbitrary URLs → can't exfiltrate).
- **Wasm sandbox** for all execution.
- **No secrets in config + signed config + audit log.**
- **Deterministic human-approval gates** (the diff-approve step the Chai video already shows — you just harden it).
> (Full spec in `SENTINEL-agent-research.md`.) **Tagline: "Hermes is smooth. SENTINEL is smooth AND you can't prompt-inject it — and I'll prove it."**

### 🥈 Superpower 2 — Memory & self-improvement that actually compounds
Mani's "Business Brain L1-L3" + Greg's "memory.md compounding" + Hermes "evolves over time" all point the same way. Go further:
- **3-tier memory** (identity → strategic → operational) like Mani, but with **anti-decay** (your Dev.to Hermes post already explored *self-writing manuals* — lean into that, it's YOUR proven angle).
- **Skills as signed markdown SOPs** that compound — but **scanned/verified** (no ClawHub-style poisoning).
- A genuine **self-improvement loop**: the agent updates its own playbooks AND its own *security policies* from experience. That's a story nobody else tells.

### 🥉 Superpower 3 — Friendly gateway + proof, not flash
Julian's video proves users reward the **friendly non-terminal gateway** (Hermes Desktop) and **organized knowledge**, and punish flashy-useless features.
- Ship a **clean Telegram/Desktop gateway** from day 1 (Chai video shows the Telegram integration is easy).
- Publish a **public attack benchmark + block-rate** every release = your "organized knowledge" + your proof + your marketing in one. **No competitor does this.**

---

## 4. Recommended architecture for YOUR agent ("SENTINEL")

```
        ┌──────────── GATEWAYS ────────────┐
        │  CLI  ·  Telegram  ·  Desktop GUI │
        └───────────────┬───────────────────┘
                        │  (trusted user input only)
              ┌─────────▼──────────┐
              │   PRIVILEGED LLM    │  plans, calls tools
              │   (never sees       │  — Groq/Gemini free tier
              │    untrusted data)  │
              └─────────┬──────────┘
                        │ typed values only
        ┌───────────────▼────────────────┐
        │   DETERMINISTIC POLICY ENGINE    │  OPA/Rego — capabilities,
        │   (taint + least privilege)      │  egress allow-list, approval gates
        └───────────────┬────────────────┘
            allowed │            │ needs untrusted data
                    │            ▼
                    │   ┌──────────────────┐
                    │   │ QUARANTINED LLM   │ reads web/files/emails,
                    │   │ (NO tools)        │ returns structured data only
                    │   └──────────────────┘  — Ollama local / cheap model
                    ▼
        ┌────────────────────────────┐
        │  WASM SANDBOX (execution)   │  no network, no host FS
        └─────────────┬──────────────┘
                      ▼
        ┌────────────────────────────┐
        │  MEMORY (3-tier, anti-decay)│ + SKILLS (signed, scanned)
        │  + TAMPER-EVIDENT AUDIT LOG │
        └────────────────────────────┘
```

This is the OpenClaw/Hermes anatomy (Section 2) with your 7 security layers woven through it. Same engine, hardened chassis.

---

## 5. The $0 build stack (confirmed from videos + research)

| Part | Tool (free/OSS) | Seen in |
|---|---|---|
| Runtime + CLI | **Bun** + Commander + Clack + Figlet | Chai aur Code |
| LLM (privileged) | Groq / Gemini free tier | your own posts |
| LLM (quarantined) | **Ollama** (Llama/Qwen/DeepSeek) local | Mani (heartbeat to Ollama) |
| Tools protocol | **MCP** | Greg/Remy |
| Context/Memory/Skills | markdown files (`agents.md`, `memory.md`, `skills/*.md`) | Greg/Remy + Mani |
| Policy engine | **OPA + Rego** | research |
| Sandbox | **Wasmtime/Wasmer** | research |
| Egress proxy | mitmproxy / tiny custom | research |
| Gateways | Telegram Bot API + (later) Tauri/Electron desktop | Chai + Julian |
| Hosting/demo | your **$7 VPS** + GitHub Actions | your own post |
| Attack benchmark | AgentDojo-style suite | research |

**Total: $0.**

---

## 6. Build roadmap (revised with the video learnings)

- **Phase 0 — The engine.** Follow the Chai blueprint: Bun CLI + Commander, Agent/Plan/Ask modes, the Observe→Think→Act loop, `read_file`/`modify_file` tools, diff-approve step. ✅ You now have a working OpenClaw clone. → Devlog #1.
- **Phase 1 — Context + memory + skills.** Add `agents.md`, compounding `memory.md`, markdown skills (Greg/Remy). → Devlog #2.
- **Phase 2 — Harden (your moat).** Dual-LLM split, OPA policy engine, least-privilege tools, no-secrets-in-config, signed config. → Devlog #3 ("I made the diff-approve step uncheatable").
- **Phase 3 — Contain.** Wasm sandbox + egress allow-list + tamper-evident audit log. → Devlog #4.
- **Phase 4 — Prove.** AgentDojo-style attack suite, publish block-rate, threat model. → **Launch post: "I tried to break OpenClaw & Hermes with one prompt — then built an agent they couldn't break."**
- **Phase 5 — Gateway + polish.** Telegram + Desktop GUI, clean docs/README + architecture diagram. → Product Hunt + Reddit (r/LocalLLaMA, r/netsec) + HN + LinkedIn.

---

## 7. Honest reality check (so you don't get burned)

- ✅ **Building the engine is realistic** — the Chai video proves a working clone is ~4 hours of normal code.
- ✅ **Beating Hermes on *security + proof* is realistic solo.** That's a niche the big harnesses ignore.
- ⚠️ **Beating Hermes on *raw smoothness/features* solo is NOT** — Nous Research is a top lab and it "evolves over time." Don't fight there. Fight on trust.
- ❌ **Never claim "unhackable / fixes every flaw."** Prompt injection is unsolved industry-wide (even Anthropic admits it). Claim *"smallest blast radius + published block-rate,"* run responsible disclosure, and you'll earn the respect that makes you famous.

> **Bottom line:** Build the same engine everyone builds (Section 2), wrap it in the security chassis nobody ships (Section 3-4), prove it with a public benchmark (Superpower 3), and tell the story in public (your Dev.to muscle). *That* is "crazier than Hermes" — not more features, but the first agent people can actually trust, with receipts.

---

### Video sources
- Chai aur Code — *Build your own OpenClaw* — youtube.com/watch?v=nGareZEhdpI
- Mani Kanasani — *5 AI Employees with OpenClaw* — youtube.com/watch?v=E7fCvH-W61U
- Greg Isenberg + Remy Gaskell — *Building AI Agents that actually work* — youtube.com/watch?v=eA9Zf2-qYYM
- Julian Goldie — *Hermes vs OpenClaw: who wins* — youtube.com/watch?v=VCZbNRS8TOk
