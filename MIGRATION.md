<div align="center">

# 🛡️ OpenClaw → XR Migration Guide

### Switch to a self-hosted agent that closes the attack surface OpenClaw left open.

*BYOK · local-first · spend-capped · tamper-evident · by rrrtx*

</div>

---

## Why you're here

OpenClaw is brilliant and moves fast — but its growth came with a documented security crisis:

- **135,000+ publicly exposed instances** (SecurityScorecard, Feb 2026), **~63% with no gateway authentication** at all.
- **138+ CVEs tracked** in the first months of 2026, including a one-click RCE and multiple **CVSS 9.9** privilege-escalation / command-execution flaws.
- **800–1,184 malicious "skills"** flooded the ClawHub marketplace (up to ~20% of it), many delivering infostealer malware.
- The root cause is structural: a **default "allow-all" permission model** on an agent that can run shell, read/write files, and reach the network.

> The standard hardening advice — *"bind the gateway to 127.0.0.1, never 0.0.0.0; add egress control; encrypt credentials; vet every skill; gate risky actions"* — describes **exactly how XR works by default.** XR is the architecture you'd have to bolt onto OpenClaw, shipped from line one.

**This is not an anti-OpenClaw piece.** If your OpenClaw is patched and properly bound, it's usable. This guide is for people who want those guarantees to be *the default*, not a 2–4 hour hardening checklist they have to maintain forever.

---

## The core difference

| | OpenClaw (default) | XR (default) |
|---|---|---|
| Gateway binding | Public-capable; 63% exposed in the wild | **127.0.0.1 only**, token-authed, opt-in (`xr serve`) |
| Permission model | "allow-all" | **Least-privilege per mode** + explicit approval gates |
| Network egress | Open | **Egress allow-list** — can't reach a domain you didn't approve |
| Risky actions | Often auto-run | **Approval gate** (CLI / phone button / voice-confirm), fail-closed |
| Credentials | `.env` plaintext by default | **BYOK** in OS keychain; redacted from logs |
| Skill supply chain | Open marketplace (malicious skills found) | **Signed, local markdown skills**; no remote marketplace install |
| Audit | — | **Tamper-evident SHA-256 hash-chained log** (`xr verify-log`) |
| Cost control | Metered, no hard cap | **Hard spend ceiling enforced in code** |
| Self-improvement | Can drift / regress | **Non-regressive skills** — verified wins are frozen, updates auto-rollback on regression |
| Prove it's safe | — | **`xr test --attacks`** publishes a reproducible injection block-rate |

---

## CVE-by-CVE: what bit OpenClaw, and why XR's design prevents the class

> XR makes **no** "unhackable" claim — prompt injection is unsolved industry-wide. The point below is *architectural blast-radius reduction*: XR removes the **default conditions** that let these become criticals.

| OpenClaw CVE | Class | How XR's architecture prevents the class |
|---|---|---|
| **CVE-2026-25253** (8.8, 1-click RCE via exposed gateway / token exfil) | Exposed gateway | XR's daemon binds **127.0.0.1 only**, is **token-authed**, and is **opt-in**. There is no public gateway to pivot through. |
| **CVE-2026-32922 / 32025** (9.9 / auth) (token-scope / WebSocket origin bypass) | Auth/scope bypass | No internet-facing control plane by default; local token; no remote owner context. |
| **CVE-2026-26322 / GHSA-56f2 / 43526** (SSRF → internal network / metadata) | SSRF / exfil | **Egress allow-list** blocks any host you didn't approve — incl. `169.254.169.254`. An SSRF that can't leave the allow-list can't reach cloud metadata. |
| **CVE-2026-24763 / 25157 / 28363 / 22179 / 32056** (command injection / allowlist bypass / RCE) | Shell exec | `shell` is **approval-gated** *and* dangerous patterns (`rm -rf`, `curl … | bash`, etc.) are **blocked before approval is even asked**. Ask/Plan modes have no shell at all. |
| **CVE-2026-27183** (shell approval bypass) | Approval bypass | Approval is **deterministic code in the loop**, not a model decision; **fail-closed on timeout**. |
| **CVE-2026-26329 / 32846 / 43533** (path traversal / arbitrary file read) | Path escape | Every file tool **rejects paths that escape the working directory** (`..`, absolute paths). |
| **CVE-2026-44114** (workspace dotenv overrides runtime env) | Secret/env tampering | Secrets come from **your environment / keychain**, not workspace files; config is schema-validated. |
| **CVE-2026-45004** (arbitrary code via `setup-api.js` from cwd) | Untrusted code load | XR loads no executable code from the workspace; skills are **inert markdown SOPs**, not Node modules. |
| **824–1,184 malicious ClawHub skills** | Supply chain | XR has **no remote skill marketplace**. Skills are local, signed markdown; learned skills are **frozen + non-regressive**. |
| Prompt injection (e.g. **CVE-2026-30741**) | Injection | Untrusted content is **scanned**, dangerous *actions* are **policy-blocked regardless of model output**, and egress is allow-listed — so a successful injection has a tiny blast radius. Run `xr test --attacks` to see the block-rate. |

*(Sources: jgamblin/OpenClawCVEs, cyberdesserts, sangfor, skywork, blink — Feb–May 2026.)*

---

## Migrate in ~10 minutes

### 1. Install
```bash
git clone https://github.com/ahmadrrrtx/xr
cd xr && bun install
bun test            # 124 tests should pass
```

### 2. Point it at your model (BYOK — you keep your keys)
```bash
# local & free (recommended): just have Ollama running
bun run src/index.ts doctor

# or bring a cloud key
export GROQ_API_KEY=...      # never stored by XR; read from your env
```

### 3. Set your guardrails (these are XR's defaults, but make them yours)
`~/.xr/config.json`:
```json
{
  "budget": { "perTaskUsd": 0.25, "perTaskTokens": 250000 },
  "security": {
    "egressAllowlist": ["api.github.com", "registry.npmjs.org"],
    "requireApproval": ["write_file", "delete", "shell", "send"]
  }
}
```

### 4. Run a task — safely
```bash
# dry-run first: see every change, write nothing
bun run src/index.ts --dry-run "summarize and improve the README"

# real run, capped at 10 cents
bun run src/index.ts --budget 0.10 "summarize and improve the README"
```

### 5. Prove it's safe (the part OpenClaw can't do)
```bash
bun run src/index.ts test --attacks          # block-rate report
bun run src/index.ts verify-log              # audit chain intact?
bun run src/index.ts export                  # signed report you can share
```

### 6. Map your OpenClaw workflow

| OpenClaw thing | XR equivalent |
|---|---|
| Telegram control | `xr telegram` — same convenience, but **user-id allow-list** + ✅/❌ approval buttons |
| Skills (ClawHub) | `xr skills` — 11 built-in signed skills; write your own as markdown SOPs |
| Cron jobs | `xr cron "every monday 9am: run security audit"` |
| Always-on / gateway | `xr serve` — dashboard on **127.0.0.1 only** |
| MCP tools | `xr mcp` — consumed with approval + egress + audit wrappers |
| Voice | `xr voice` — local Whisper/Kokoro, voice-confirm for risky actions |

---

## What you keep, what you gain, what you give up

**Keep:** autonomy, Telegram, cron, skills, MCP, voice, local-first, $0 to run.
**Gain:** spend ceiling you can't blow, egress allow-list, approval gates, tamper-evident audit, non-regressive skills, a runnable injection benchmark.
**Give up:** a giant open skill marketplace (by design — that's the part that got compromised) and a public gateway (also by design).

---

## Honest limitations

- XR is **not "unhackable."** No agent is. It minimizes blast radius and lets you *measure* it.
- The "100% valid tool-calls" guarantee applies to **llama.cpp / Ollama / vLLM** (GBNF grammar) and to cloud providers via **native JSON mode**; everything else falls back to **deterministic auto-repair** (very high, not 100%).
- XR is solo-maintained and pre-1.0. It's lean on purpose — fewer features, fewer attack surfaces.

---

<div align="center">

**If OpenClaw made your security team nervous, XR is the migration.**

`git clone` · `bun test` · `xr test --attacks` — then decide.

*by [@ahmadrrrtx](https://github.com/ahmadrrrtx)*

</div>
