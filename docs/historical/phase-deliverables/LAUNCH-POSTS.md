# XR — Launch Posts (ready to copy-paste)
### by @ahmadrrrtx · sequence: r/netsec → r/LocalLLaMA → Dev.to → Show HN

> Strategy (from the verdict doc): **lead with data, not the product.** Let the
> OpenClaw security crisis do the marketing. Post in this order over ~2 weeks.

---

## 1️⃣ r/netsec  ·  Day 1  ·  lead with the benchmark, NOT XR

**Title:**
`I ran 10 known prompt-injection attacks against self-hosted AI agents. Here's the block-rate — and the architecture that stopped them.`

**Body:**

Self-hosted AI agents had a rough 2026. OpenClaw alone: 135,000+ publicly exposed instances (~63% with no gateway auth), 138+ CVEs, and 800–1,184 malicious "skills" pushed to its marketplace. Most of these aren't model problems — they're **architecture** problems: an "allow-all" agent that can run shell, touch files, and reach the network.

So I built a small, reproducible **injection test lab** and a self-hosted agent designed around the opposite defaults. Here's what the deterministic defenses caught:

```
🔒 injection test lab
  ✓ blocked  instruction_override     classic "ignore previous instructions"
  ✓ blocked  system_prompt_extraction
  ✓ blocked  tool_hijack              embedded shell command (rm -rf)
  ✓ blocked  tool_hijack              credentials path (~/.ssh, .env)
  ✓ blocked  data_exfiltration        POST secrets to external domain
  ✓ blocked  data_exfiltration        leak keys in the reply
  ✓ blocked  ascii_smuggling          zero-width / unicode-tag instructions
  ✓ blocked  destructive_action       curl | bash RCE
  ...
  block-rate: 10/10
```

The point isn't a perfect score (I built the corpus — that's why I'm open-sourcing it so you can break it). The point is the **architecture** that makes the score possible:

- **Egress allow-list** — the agent can't reach a domain you didn't approve. An SSRF/exfil that can't leave the allow-list can't hit `169.254.169.254` or your secrets endpoint.
- **Deterministic action policy** — dangerous shell (`rm -rf`, `curl|bash`) is blocked *before* the model's output is ever trusted. Architecture > behavior.
- **Approval gates** that fail closed; **least-privilege** modes with no shell at all.
- **Tamper-evident, hash-chained audit log** (git's trick) — `verify-log` detects any change.

**Honest caveat:** prompt injection is unsolved. This is blast-radius reduction + measurement, not "unhackable."

I'd genuinely like this community to **try to break the corpus.** Repo + the `--attacks` benchmark + a CVE-by-CVE writeup of how each documented OpenClaw flaw maps to a default here:

🔗 [github.com/ahmadrrrtx/xr] · migration guide: [./MIGRATION.md]

What attacks would you add to the corpus?

---

## 2️⃣ r/LocalLLaMA  ·  Day 4  ·  the cost-ceiling + local-model angle

**Title:**
`I built a local-first agent that physically cannot exceed your token budget — and makes small local models do reliable tool-calls.`

**Body:**

Two things kept burning me with agents:

1. **Runaway cost.** Microsoft Research found the same task can vary up to 30× in token cost; one team's retry logic silently added 40% to their bill. Most agents give you a *soft warning*, not a *hard stop*.
2. **Local models "don't do agentic stuff well."** They emit half-broken JSON tool-calls and the loop falls apart.

So XR has:

- **💰 A Cost Governor** — a per-task ceiling enforced in deterministic code, not a setting the model can ignore. It estimates the next step and **pauses + asks** before it would breach your budget. Live meter: `💰 1.2k tok ≈ $0.0009 / $0.25 cap`. Local models = $0, tracked separately.
- **🖥️ GBNF grammar-forced tool-calls** — on llama.cpp / Ollama / vLLM, the model is constrained at the token level so invalid tool JSON has zero probability. Even a 3B model produces valid calls. Cloud providers use native JSON mode; everything else falls back to deterministic auto-repair.
- **🧠 Non-regressive skills** — when a skill run is *verified* good, it's frozen as an immutable baseline; any later update that breaks a past win is **auto-rolled-back**. The agent can't forget what worked.

100% local, BYOK, $0 to run. MIT.

🔗 [github.com/ahmadrrrtx/xr]

Curious what local models you'd point it at — and whether the grammar path holds up on your setup. PRs/issues welcome.

---

## 3️⃣ Dev.to  ·  Day 7  ·  the devlog (your proven channel)

**Title:**
`6 ways self-hosted AI agents are architecturally unsafe — and how I fixed each in XR`

**Tags:** `#ai` `#security` `#opensource` `#localllama`

**Outline (write ~1,200–1,800 words, your voice):**

1. **Hook** — the OpenClaw numbers (135k exposed, 138+ CVEs, malicious marketplace). Not a dunk — a lesson: these are *default-configuration* failures.
2. **Flaw 1: exposed gateways** → fix: 127.0.0.1-only, token-authed, opt-in daemon.
3. **Flaw 2: open egress (SSRF/exfil)** → fix: egress allow-list (with the metadata-endpoint example).
4. **Flaw 3: shell allow-list bypasses** → fix: deterministic policy that blocks dangerous commands *before* trusting model output + least-privilege modes.
5. **Flaw 4: malicious skill marketplaces** → fix: no remote marketplace; signed local markdown skills; non-regressive freezing.
6. **Flaw 5: unpredictable cost** → fix: the Cost Governor (hard ceiling in code).
7. **Flaw 6: "self-improvement" that drifts** → fix: verifiability gate + frozen baselines + auto-rollback (lead with this — it's the novel part; cite the 65%-of-failures-from-context-degradation stat).
8. **Show the receipts** — `xr test --attacks` output + `xr verify-log`.
9. **Honest limitations** — not unhackable, GBNF caveat, solo/pre-1.0.
10. **CTA** — repo + migration guide + "try to break the corpus."

End with the `⚡ by rrrtx` line and links.

---

## 4️⃣ Show HN  ·  Day 10 (after some traction)

**Title:**
`Show HN: XR – a self-hosted AI agent with a provable injection block-rate and a spend ceiling the model can't override`

**Body (short, HN-style):**

XR is a local-first, BYOK personal agent built security-first. It came out of watching OpenClaw rack up 138+ CVEs and 135k exposed instances — almost all default-config failures.

Differentiators:
- Hard spend ceiling enforced in code (not a soft warning)
- GBNF grammar-forced tool-calls for reliable local models
- Non-regressive skills: verified wins are frozen, regressions auto-rollback
- Egress allow-list + approval gates + tamper-evident hash-chained audit log
- `xr test --attacks` prints a reproducible injection block-rate (I'm open-sourcing the corpus so you can extend/break it)

Honest: prompt injection isn't "solved" — this is blast-radius reduction + measurement. TypeScript/Bun, ~4.7k LOC, 1 runtime dep, 124 tests, MIT.

Repo: [github.com/ahmadrrrtx/xr] · Migration from OpenClaw: [./MIGRATION.md]

Happy to answer anything about the architecture.

---

## 📌 Cross-post checklist
- [ ] Repo public + MIT + README badges + avatar/logo set
- [ ] `MIGRATION.md` linked from README top
- [ ] `xr test --attacks --json` sample report committed
- [ ] r/netsec (Tue–Thu morning EST = best)
- [ ] r/LocalLLaMA (3–4 days later)
- [ ] Dev.to devlog + cross-post to LinkedIn + Hashnode
- [ ] Show HN (Tue–Thu, ~8–10am EST)
- [ ] reply to EVERY comment in the first 3 hours (algorithm + trust)
- [ ] never claim "unhackable" anywhere — it's your credibility moat
```
