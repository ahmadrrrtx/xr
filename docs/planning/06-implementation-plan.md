# 06 — Implementation Plan
### SENTINEL · v1.0 · 2026-06-03

Build order is chosen so that **each phase ships something usable**, the **killer differentiators come early** (for the build-in-public story), and the **"never breaks" guarantees are foundational, not retrofitted.**

---

## 0. Repo & foundations (Week 0)
- `bun init`, strict TS, ESLint/Prettier, Vitest, GitHub Actions (lint+test+`npm audit`+license check).
- Monorepo-ish `src/` layout:
  ```
  src/
  ├── core/         loop, modes, orchestrator
  ├── providers/    adapter + manifest loader + failover + health
  ├── cost/         budgeter, meter, router, compressor, stopper
  ├── reliability/  grammar builder, auto-repair, model profiles, validation
  ├── policy/       capabilities, least-privilege, approval gate, egress
  ├── tools/        read/write/shell/web/search + runtime backends
  ├── memory/       3-tier load/retrieve/curate
  ├── skills/       loader, signer, learner, freeze, regression
  ├── state/        sqlite (drizzle) + migrations + snapshots (git)
  ├── interfaces/   cli, tui, telegram
  ├── update/       installer, self-test, rollback
  └── security/     dual-llm, sandbox, redaction, injection lab
  ```
- **"Never breaks" rules enforced from commit #1:** Zod at every boundary; SQLite migrations reversible; config versioned.

## Phase 0 — The Engine (Weeks 1-2) → **Devlog #1**
**Deliver:** a working CLI agent.
- Commander CLI + Clack/Ink TUI; Agent/Plan/Ask modes; banner.
- Observe→Think→Act loop (single provider to start).
- Tools: `read_file`, `write_file` (with **diff-approve gate**).
- SQLite sessions/steps; basic audit log.
- ✅ *"I built a working OpenClaw-class agent in TS."*

## Phase 1 — Killer Feature #1: Cost Governor (Week 3) → **Devlog #2** 💰
**Deliver:** the agent that can't blow your budget.
- Budgeter + live Meter in TUI; per-task ceiling pause/ask.
- Router (cheap vs smart model); scheduled context compressor; no-progress early-stop.
- `cost_events` table + `sentinel cost` report.
- ✅ *"My agent literally cannot spend more than you allow."* (high-virality post)

## Phase 2 — Killer Feature #2: Universal Provider Layer + Local Reliability (Weeks 4-5) → **Devlog #3** 🖥️
**Deliver:** BYOK anything + local models that actually work.
- Manifest-driven providers; OS-keychain vault; health check + **auto-failover**.
- **GBNF grammar builder** (Zod→JSON Schema→GBNF) wired to Ollama `format`; native structured output for OpenAI/Gemini.
- Auto-repair loop; per-model capability profiles; validation sandwich.
- ✅ *"I made a 7B local model do 100% valid tool calls."* (r/LocalLLaMA gold)

## Phase 3 — Killer Feature #3: Non-Regressive Skills + Memory (Weeks 6-7) → **Devlog #4** 🧠
**Deliver:** self-improvement that never forgets a win.
- 3-tier memory (identity/strategic/operational); retrieval + curation.
- Skill loader + signing; Skill-Maker; **verifiability gate**; **frozen baselines**; **backward-transfer regression + auto-rollback**.
- Ship the **starter skills pack** (Daily Brief = your Gemma news monitor!).
- ✅ *"The agent that mathematically can't regress a learned skill."*

## Phase 4 — Killer Feature #4: Self-Healing + Security Proof (Weeks 8-9) → **Devlog #5** 🛡️🔒
**Deliver:** never breaks + provably safe.
- Self-healing config (validate/migrate/last-known-good).
- Transactional updates + self-test + `sentinel rollback`.
- Policy engine (capabilities/least-privilege/approval); egress allow-list; Docker sandbox backend.
- **Injection Test Lab** (`sentinel test --attacks`) + first published block-rate.
- ✅ *"I tried to break OpenClaw & Hermes with one prompt — then built one they couldn't break. Here's the benchmark."* (**launch post**)

## Phase 5 — Reach & Polish (Weeks 10-11) → **Launch** 🚀
- Telegram interface (approve/history/cron/cost from mobile).
- First-class single-container Docker; signed installers; great docs.
- Time-travel (`sentinel history`, undo); Self-Doctor.
- README + architecture diagram (reuse the SVG/diagrams from these docs).
- **Distribution:** npm publish, GitHub release, Product Hunt, Reddit (r/LocalLLaMA, r/netsec, r/selfhosted), HN, LinkedIn + Dev.to recap.

## Phase 6 — Stretch (post-launch, only after polish)
- Dual-LLM/CaMeL full split · Wasm sandbox · Desktop (Tauri) GUI · Cron scheduler · code-knowledge-graph tool.
- (Marketplace / multi-agent / payments stay OUT until core is rock-solid.)

---

## Testing strategy (continuous, every phase)
- **Unit:** cost math, grammar builder, config migration, freeze/rollback, redaction.
- **Integration:** full loop with a mock provider + a real local Ollama model.
- **Reliability suite:** 100-run tool-call validity per model (must be ~100% on grammar path).
- **Regression suite:** the frozen-baseline cases (the product feature *is* a test harness).
- **Security suite:** injection corpus (AgentDojo-style) → block-rate gate in CI.
- **Update suite:** simulate bad update → assert auto-rollback.
- **Coverage gate:** ≥ 80% on `core/`, `cost/`, `reliability/`, `skills/`.

## Definition of Done (v1.0)
- All MUST features (F1-F8) shipped + F9-F12.
- 100% valid tool calls on a 3B local model.
- 0 crash on malformed config; auto-rollback proven on bad update.
- Published injection block-rate ≥ baseline; no plaintext secrets anywhere.
- Docs + Docker + installers; 5 devlogs + launch post live.

## Build-in-public cadence (your fame engine)
1 devlog per phase on Dev.to (your proven format), cross-posted to LinkedIn + Hashnode, each ending with the GitHub link + "next up." The launch post (Phase 4/5) is the benchmark reveal — the shareable centerpiece.

## Effort estimate
~11 weeks solo part-time to a credible v1.0; the **first 3 weeks already yield a postable, differentiated product** (engine + Cost Governor). Prioritize shipping Phase 0-2 publicly fast for momentum.
