# Project SENTINEL — Building a Security-First AI Agent That Actually Wins
### Deep research & strategy brief for Muhammad Ahmad (@ahmadrrrtx)
*Compiled 2026-06-03. $0-cost, fully open-source, community-fame oriented.*

---

## 0. TL;DR (read this if nothing else)

You want to build your **own agent** (like OpenClaw / Hermes / Nemo) but **security-first** — one that closes the flaws the others have.

**The honest verdict from the research:**
1. ✅ It is **possible** and it's a *great* personal-brand play — IF you scope it correctly.
2. ❌ You **cannot** promise "zero flaws / every single vulnerability fixed." Even Anthropic's own reference MCP server shipped with 3 RCE CVEs, and OpenAI/Anthropic/Google all publicly admit prompt injection **cannot be fully solved** in current LLM architectures. Promising "unhackable" will destroy your credibility the day someone breaks it.
3. ✅ The thing that *will* make you famous and is genuinely **better**: build the **first small, auditable, secure-by-architecture agent** that implements the proven academic defenses (CaMeL / Dual-LLM / capability-based permissions) that NONE of the popular agents ship by default. You win on *architecture*, not on size.

**Your unbeatable angle:** "Every popular agent bolts security on as an afterthought. SENTINEL is the first agent where security IS the architecture — and I can prove it with a public attack benchmark." That is a story Dev.to / Reddit / HN / Product Hunt will actually share.

---

## 1. Why "better than OpenClaw/Hermes/Nemo on features" is the wrong fight

The open-source agent space is brutally saturated and funded:

| Tool | Stars | Backing |
|------|-------|---------|
| OpenCode | ~162k | community |
| OpenHands | ~74k | $18.8M Series A |
| Cline | ~61k | funded, SOC2 |
| Goose (Block) | ~45k | Block Inc. |
| Aider | ~44k | community |
| Roo / Kilo | 16–22k | $8M seed |

Sources: [opensourcealternatives.to], [pinggy.io], [wetheflywheel.com], [pasqualepillitteri.it].

You will **not** out-feature an $18.8M team solo for free. So don't try. **Compete on a dimension they're weak on: security-by-design.** That's a niche where a solo dev with a sharp architecture and a great writeup can absolutely dominate the conversation.

---

## 2. What's actually broken in the popular agents (your opportunity list)

Real 2026 incidents — these are the flaws you will *visibly* not have:

- **Plaintext credentials.** OpenClaw stores API keys in cleartext (`~/.openclaw/credentials/`, `.env`). The "lethal trifecta." CVE-2026-21852 stole Claude Code API keys via proxy redirect.
  → *NemoClaw's fix (inject creds as env vars at runtime, never store in config) is cited as the correct model.*
- **Malicious skills / supply chain.** ClawHavoc: **1,184 malicious skills** on ClawHub; poisoned `SKILL.md` files; 76 confirmed malicious payloads. No scanner had a detection category for this.
- **Poisoned config = instant RCE.** Claude Code `.claude/settings.json` Hooks ran shell commands *before* the trust dialog (CVE-2025-59536). `.mcp.json` auto-approved all MCP servers.
- **Over-permissioned runtimes.** "Comment and Control" (CVSS 9.4): a code-review agent had `bash` it didn't need, read `$ANTHROPIC_API_KEY`, posted it as a PR comment. Stripping bash would have blocked the whole chain.
- **Indirect prompt injection.** A single malicious PR/issue title became a full exfiltration command. Link previews in Discord/Telegram turned into exfil channels for OpenClaw.
- **No egress control.** Agents could `curl` to any domain → exfiltration trivial.
- **Exposed servers.** 135,000+ OpenClaw instances and 1,467 MCP servers exposed with no auth.
- **MCP design flaws.** TOCTOU race conditions, path traversal, env-var leakage via heredocs (Claw Chain, CVE-2026-44112/115/118).

Sources: [blog.cyberdesserts.com], [venturebeat.com], [thehackernews.com], [cybersecuritynews.com], [ibm.com], [microsoft.com], [opus.pro].

**Each bullet above maps to a feature you ship that they don't. That's your differentiation table for the launch post.**

---

## 3. The architecture that makes SENTINEL genuinely "better"

This is the core. Don't invent new crypto — *implement the proven academic patterns that nobody ships by default.*

### 3.1 The non-negotiable principle
> **Treat the LLM itself as an untrusted, compromised component.** Security must come from deterministic code *around* the model, not from asking the model to "be careful." Prompting-based defenses collapse to 95–100% attack success under adaptive attack. Only *architectural* defenses hold. (CaMeL paper, "Attacker Moves Second" paper.)

### 3.2 The seven layers (defense-in-depth)

**Layer 1 — Dual-LLM / CaMeL pattern (control ⊥ data separation)** ⭐ your headline feature
- **Privileged LLM**: sees only the *trusted* user request, makes the plan, calls tools. NEVER sees untrusted content (web pages, file contents, emails, tool outputs).
- **Quarantined LLM**: processes untrusted content, has **zero tool access**, returns only structured/typed data.
- A deterministic layer passes typed values between them. Untrusted data can never alter control flow.
- CaMeL solved 67–77% of AgentDojo attacks *with provable guarantees*; FIDES stopped 100% in MS internal tests. Refs: arXiv 2503.18813 (CaMeL), Simon Willison's Dual-LLM, Microsoft FIDES.

**Layer 2 — Capability-based permissions (taint tracking)**
- Every value carries metadata: confidentiality (who may read) + integrity (how trusted the source). Tool calls are gated by policy on these labels. Data from an untrusted source can't be used as an argument to a sensitive tool. (CaMeL capabilities / FIDES info-flow control.)

**Layer 3 — Least-privilege, capability-scoped tools (no wildcards)**
- No action permitted by default — every tool is *explicitly* allow-listed per task. Task-scoped permissions that auto-expire when the task ends. Code-review mode literally cannot have `bash`. (Microsoft "Defense in depth" — agents as microservices.)

**Layer 4 — Sandboxed execution**
- All agent-run code/commands execute in an isolated sandbox with **no network, no host FS, minimal privileges.** Prefer **WebAssembly/Wasm capability sandbox** over Docker (Docker = perimeter "all or nothing"; Wasm = mathematically verifiable, unforgeable capability tokens). Container fallback for heavy workloads. (Medium/oracle_43885, OWASP cheat sheet.)

**Layer 5 — Egress allow-list (the exfiltration killer)**
- Route ALL agent HTTP/DNS through a proxy that blocks any domain not on an approved list. *An agent that can't reach arbitrary URLs can't exfiltrate, no matter what's injected.* This is the single highest-ROI deterministic control. (AWS Bedrock pattern, zylos.ai.)

**Layer 6 — Deterministic human-in-the-loop gates**
- Hard, code-enforced approval (not a prompt) for: file delete, command exec, sending email/messages, creating API keys, financial actions, anything externally visible. Default-deny on timeout. (OWASP cheat sheet, flutteris.com.)

**Layer 7 — Secure by config + observability**
- No credentials ever in config files. Secrets only injected as ephemeral, scoped, time-limited env vars / tokens from a vault. Config files (`.sentinel/*.json`) are **signed + verified**; no "hooks" that auto-run shell. Every consequential action logged with a human-readable reasoning chain (tamper-evident audit log) for replay. Plus **Spotlighting** (randomized delimiters / datamarking) on any untrusted text as cheap baseline hygiene.

### 3.3 Bonus differentiator — ship your own attack benchmark
Build SENTINEL with a **public adversarial test suite** (model it on AgentDojo). On every release, publish the attack-success-rate. *Nobody else in the open-source agent space publishes "we tested 200 injection attacks, X% blocked."* This is your proof, your marketing, and your moat all at once.

---

## 4. The "$0 / fully open-source" stack

| Concern | Free/OSS choice |
|---|---|
| LLM (both privileged & quarantined) | Groq free tier + Gemini free tier (you already use both!) / local via **Ollama** (Llama, Qwen, DeepSeek) for the quarantined model |
| Policy engine | **Open Policy Agent (OPA)** + Rego (deterministic, externalized rules) |
| Schema/type validation | **Pydantic** (Python) / **Zod** (TS) |
| Sandbox | **Wasmtime / Wasmer** (Wasm), fallback `bubblewrap`/Docker |
| Egress proxy | tiny local allow-list proxy (mitmproxy / custom) |
| Audit log | append-only JSONL + hash chain |
| Tracing | **OpenTelemetry** (free) |
| Attack benchmark | fork ideas from **AgentDojo** (open) |
| Hosting/demo | your existing $7 VPS (you already wrote that post!) + GitHub Actions free CI |

**Total cost: $0.** Everything above is permissively licensed and free-tier friendly.

---

## 5. What to ADD vs. what NOT to add

### ✅ ADD (these ARE the product)
- Dual-LLM / CaMeL control-data separation
- Capability/taint tracking on every value
- Per-task least-privilege tool allow-list (no wildcards)
- Wasm sandbox for all execution
- Egress allow-list proxy
- Deterministic human-approval gates
- Secrets-never-in-config + signed config files
- Tamper-evident audit log w/ reasoning chains
- Public attack benchmark + published block-rate

### ❌ DON'T ADD (scope creep / credibility traps)
- ❌ A skill/plugin marketplace at launch — that's exactly the attack surface that sank ClawHub. Add it *later* with signing + scanning, or not at all.
- ❌ "Auto-update skills" / remote-code skills — the #1 supply-chain vector.
- ❌ Claims of "100% secure / unhackable / fixes every flaw" — guaranteed to backfire.
- ❌ 50 model providers / huge feature surface — you can't out-breadth the funded teams. Stay lean.
- ❌ Multi-agent swarms on day 1 — adds attack surface (rogue agents, inter-agent injection). Single secure agent first.
- ❌ Reinventing CaMeL/FIDES from scratch poorly — study them, implement faithfully, credit them.

---

## 6. Honest risk register

| Risk | Reality | Mitigation |
|---|---|---|
| "You promised secure, I broke it" | Prompt injection is *unsolved*; someone will find an edge | Never say "unhackable." Say "architecturally minimized blast radius + published block-rate." Run a bug bounty / responsible disclosure from day 1. |
| Dual-LLM adds latency/cost | 2 model calls per step | Use fast free models (Groq) for quarantined LLM; cache; only invoke quarantined path when untrusted data is present. |
| Utility drop | Strict isolation can reduce task success | Research shows FIDES *increased* task completion 16%; structure can help. Measure it. |
| Solo maintenance burden | Big surface | Stay lean (Section 5 DON'Ts). Lean = maintainable = trustworthy. |
| No CVE tracking for agent flaws | Industry-wide gap | Turn it into content: publish your own advisories/threat model. |

---

## 7. Go-to-market (how this gets you famous — for free)

You already have the audience muscles (Dev.to, LinkedIn, Hermes/OpenClaw posts). Lean in:

1. **Build in public.** Weekly Dev.to devlog: "Building SENTINEL: the secure-by-design agent — part N." Your Hermes/Gemma posts prove this format works for you.
2. **The launch post angle:** *"I tried to break OpenClaw, Claude Code, and Cline with one prompt injection. Then I built an agent they couldn't break — here's the architecture."* (Ties directly to your existing audience + the viral 2026 incidents.)
3. **Lead with the benchmark.** A table of "attack X → blocked/allowed" is inherently shareable on Reddit (r/LocalLLaMA, r/netsec, r/programming), HN, and Product Hunt.
4. **Name + identity.** Suggested names: **SENTINEL**, **Aegis**, **Bastion**, **Citadel**, **Warden**, **Quarantine**. Pick one, grab the GitHub org + npm/pip name, make a clean README with the architecture diagram.
5. **Credibility through honesty.** A "Security Model & Known Limitations" section in your README earns more trust than any "unhackable" claim. Security people *respect* that and amplify it.
6. **SEO/discovery:** topics/tags `ai-agents`, `prompt-injection`, `llm-security`, `camel`, `secure-agent`. Cross-post to LinkedIn + dev.to + Hashnode + Substack.

---

## 8. Suggested build roadmap (when you're ready to code)

- **Phase 0 (proof):** Minimal Dual-LLM loop (privileged planner + quarantined extractor) on Groq/Gemini free tier. One real task end-to-end. → Devlog #1.
- **Phase 1 (deterministic guards):** OPA policy engine + per-task tool allow-list + human-approval gate + secrets-never-in-config. → Devlog #2.
- **Phase 2 (containment):** Wasm sandbox + egress allow-list proxy + signed config + audit log. → Devlog #3.
- **Phase 3 (proof of security):** Attack benchmark (port AgentDojo-style tests) + publish block-rate + threat-model doc. → **Launch post.**
- **Phase 4 (polish):** README + architecture diagram + Product Hunt + Reddit/HN.

---

## 9. Final answer to your three questions

- **Is it possible?** Yes — as a *security-by-architecture* agent, not as a "fixes every flaw / unhackable" agent.
- **What to add?** Section 5 ✅ list — the 7-layer architecture (Dual-LLM, capabilities, least-privilege, Wasm sandbox, egress allow-list, human gates, no-secrets-in-config) + a public attack benchmark.
- **What NOT to add?** Section 5 ❌ list — no marketplace, no auto-updating skills, no "unhackable" claims, no feature-breadth race.
- **How?** Section 8 roadmap, built entirely on free/OSS tools (Section 4), promoted via build-in-public (Section 7).

> Your real moat isn't a bigger agent. It's being **the person who shipped the first small agent you can't prompt-inject — and proved it publicly.**

---

### Key sources
- AI Agent Security Risks 2026 — blog.cyberdesserts.com
- One command turns any repo into a backdoor — venturebeat.com
- Three AI coding agents leaked secrets — venturebeat.com
- OpenClaw flaws / CNCERT warning — thehackernews.com
- Claw Chain (245k servers) — cybersecuritynews.com
- What OpenClaw reveals — ibm.com/think
- RCE in AI agent frameworks (Semantic Kernel) — microsoft.com
- Defense in depth for autonomous agents — microsoft.com
- CaMeL: Defeating Prompt Injections by Design — arXiv 2503.18813
- Type-directed privilege separation — arXiv 2509.25926
- Design patterns vs prompt injection — signals.aktagon.com
- Indirect prompt injection 2026 state (CaMeL/FIDES/Spotlighting) — zylos.ai
- OWASP AI Agent Security Cheat Sheet — cheatsheetseries.owasp.org
- Least privilege for AI agents — doc-e.ai
- Open-source agent comparisons — opensourcealternatives.to, pinggy.io, wetheflywheel.com
