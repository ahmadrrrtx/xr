# 01 — Product Requirements Document (PRD)
### SENTINEL · v1.0 · 2026-06-03

---

## 1. Problem statement

Personal AI agents (OpenClaw, Hermes, and the long tail of "claws") have exploded, but real users (Reddit, Dev.to) are abandoning them for five concrete reasons:

1. **They break constantly** — *"so annoying spending time fixing the config constantly every update"* (17 upvotes); *".23, .24, .25 all broken."*
2. **Unpredictable cost** — same task varies up to **30× in token cost** with "no transparency and no guarantees" (ZDNet, Microsoft Research).
3. **Local models don't work well** — *"wondering why it doesn't do agentic things well — they don't use a local Ollama."*
4. **They're a security risk** — plaintext keys, prompt injection, *"stupid idiots installed this security risk on their device"* (18 upvotes).
5. **Self-improvement drifts** — agents "forget the last skill while learning the next," "regress every time" (Cambridge ICML, VentureBeat).

**Nobody ships an agent that is simultaneously trustworthy, cost-capped, local-first-reliable, non-regressive, and update-safe.** That is the gap.

## 2. Vision & goals

**Vision:** The first personal AI agent you can actually trust — BYOK, local-first, spend-capped, non-regressive, injection-tested.

**Goals (v1.0):**
- G1 — Zero vendor cost to the maintainer (ship no keys/models) and predictable cost to the user.
- G2 — Make local LLMs reliably agentic (100% valid tool calls).
- G3 — Never break on update or config change.
- G4 — Self-improvement that provably never regresses.
- G5 — Security users can verify with one command.

**Non-goals (v1.0):** skill marketplace, multi-agent swarms, on-chain/payments, voice/phone, mobile-native apps. (Deliberately deferred — "finish features, don't pile new ones.")

## 3. Target users & personas

| Persona | Who | Top need |
|---|---|---|
| **Local Larry** (primary) | r/LocalLLaMA privacy/offline dev | Local model that *actually* works agentically |
| **Budget Bilal** | Indie dev / student on free tiers | Never get a surprise token bill |
| **Burned Beth** | Ex-OpenClaw user sick of breakage | An agent that doesn't break every update |
| **Security Sam** | Eng who won't run "wild west" software | Provable safety, no plaintext keys |
| **Builder Ahmad** (you) | Building in public for community fame | A clean, defensible, shippable story |

## 4. Features (prioritized — MoSCoW)

### MUST (v1.0 core)
- **F1 Agent Engine** — Observe→Think→Act loop; Agent / Plan / Ask modes; diff-approve gate.
- **F2 Universal Provider Layer** — BYOK any provider via manifest; encrypted key vault; live health check + auto-failover.
- **F3 Cost Governor** — per-task hard ceiling; live meter; auto model-routing; context compression; early-stop on no-progress.
- **F4 Local-Model Reliability Harness** — GBNF grammar-forced tool calls; auto-repair; per-model capability profiles.
- **F5 Tools** — read_file, write_file (diff+approve), shell (sandboxed), web_fetch (egress allow-list), search.
- **F6 Memory** — 3-tier (identity / strategic / operational), uncapped, structured, retrieval-based.
- **F7 Pre-configured Skills** — signed markdown SOPs (starter pack in §5).
- **F8 Self-Healing Config & Updates** — schema-validated auto-migrating config; transactional auto-rollback updates.

### SHOULD
- **F9 Non-Regressive Skill Learning** — validated-behavior freeze + backward-transfer regression check + auto-rollback.
- **F10 Time-Travel Audit Log** — replayable, tamper-evident; undo any file change.
- **F11 Telegram interface** — approve/reject/history/cron from mobile.
- **F12 Injection Test Lab** — `sentinel test --attacks` → block-rate report.

### COULD
- **F13 Dual-LLM / CaMeL** privileged/quarantined split.
- **F14 Wasm sandbox** backend.
- **F15 Desktop (Tauri) GUI.**
- **F16 Cron / scheduled skills.**

### WON'T (this release)
- Marketplace, multi-agent, payments, voice, native mobile.

## 5. Pre-configured starter skills (ship with v1.0)
Daily Brief · Inbox Triage (read-only + draft) · Repo Janitor (code knowledge graph) · Cron Watcher · Skill-Maker (writes+verifies+freezes new skills) · Cost Auditor · Self-Doctor (runs reliability + injection tests).

## 6. Success metrics (KPIs)
- **Reliability:** task success ≥ 95%, tool-call validity ≥ 99% (incl. local models via grammar), 0 config-break reports across updates.
- **Cost:** 0 "surprise bill" reports; ≥ 60% token reduction vs naive baseline (routing + compression).
- **Local:** works on ≥ 3B local model with ≥ 99% valid tool calls.
- **Trust:** published injection block-rate each release; 0 plaintext-key incidents.
- **Community:** GitHub stars, Dev.to devlog reactions, Reddit/HN front-page, Product Hunt.

## 7. Constraints & assumptions
- $0 infra (no hosted keys/models). User supplies key or runs Ollama.
- Fully open-source, permissive license, minimal audited deps.
- Solo-maintainable → lean scope, deterministic core.

## 8. Risks (top 3)
| Risk | Mitigation |
|---|---|
| Dual-LLM/quarantine adds latency | Only invoke on untrusted data; use fast/local model for quarantine. |
| "Unhackable" expectation backfires | Never claim it; publish block-rate + run responsible disclosure. |
| Scope creep kills reliability | Hard MoSCoW; WON'T list enforced; finish before adding. |
