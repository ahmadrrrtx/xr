# SENTINEL — Master Planning Package
### The trustworthy, BYOK, local-first, non-regressive AI agent
**Author:** Muhammad Ahmad (@ahmadrrrtx) · **Date:** 2026-06-03 · **Status:** Planning v1.0

This folder contains the complete professional planning package, in order:

| # | Document | What it covers |
|---|----------|----------------|
| 00 | **MASTER-PLAN** (this file) | Vision, principles, architecture decisions, the "never breaks" doctrine |
| 01 | `01-PRD.md` | Product Requirements — what & why, users, features, success metrics |
| 02 | `02-TRD.md` | Technical Requirements — stack, components, the 4 killer subsystems, NFRs |
| 03 | `03-UIUX-brief.md` | UI/UX design brief — CLI/TUI + Telegram + Desktop, visual language |
| 04 | `04-app-flow.md` | App flows — onboarding, task loop, approval, self-improvement, failover |
| 05 | `05-backend-schema.md` | Data model — SQLite schema, file layout, provider manifest |
| 06 | `06-implementation-plan.md` | Phased build plan, milestones, devlogs, testing, launch |

> Companion research lives one level up: `SENTINEL-agent-research.md`, `how-agents-work-and-beating-hermes.md`, `what-makes-your-agent-different.md`.

---

## 1. Vision (one paragraph)

> **SENTINEL is the first personal AI agent you can actually trust.** It runs on *your* key or *your* local model (we ship none of our own), it physically cannot exceed a budget you set, it never forgets a skill it has learned, it never breaks on update, and you can prove it's safe with one command. Where OpenClaw is "the wild west" and Hermes is "smooth but drifts," SENTINEL is **smooth + safe + cheap + reliable — with receipts.**

## 2. The 5 pillars (everything maps to these)

1. **🔐 Trust** — BYOK only, keys encrypted in OS keychain, secure-by-architecture (Dual-LLM, least-privilege, egress allow-list, sandbox), runnable injection benchmark.
2. **💰 Cost Control** — hard per-task spend ceiling, live cost meter, auto model-routing, context compression, early-stop.
3. **🖥️ Local-First Reliability** — any local model as the brain, made reliable via **GBNF grammar-constrained tool calls** (100% valid output regardless of model size).
4. **🧠 Non-Regressive Memory/Skills** — validated-behavior freezing + backward-transfer health check + auto-rollback. The agent that never forgets a win.
5. **🛡️ It Just Works** — transactional self-healing updates, auto-migrating config, first-class single-container Docker, signed installers.

## 3. Architecture decisions (chosen, with rationale)

These choices are made *for reliability*, validated against how the best 2026 agents are actually built (Claude Code, Pi, OpenCode all use this shape).

| Decision | Choice | Why (the "never breaks" reason) |
|---|---|---|
| **Language/runtime** | **TypeScript on Bun** (Node fallback) | Every leading CLI agent uses TS/Bun. Single static-ish binary, fast cold-start (fixes the "wait a minute to start" complaint), huge ecosystem, easy npm distribution. |
| **State store** | **SQLite** (via Drizzle ORM) | OpenCode chose SQLite precisely for **session branching + state rollback** — which is exactly what non-regression & time-travel need. Files alone can't do transactional rollback. |
| **Provider integration** | **Declarative provider manifests** (JSON/YAML) over a normalized adapter | Add ANY provider with zero code change / zero release. Kills the "an update broke my Kimi integration" rage. |
| **Local model reliability** | **GBNF grammar-constrained decoding** (Ollama `format` / llama.cpp) | Forces token-level valid tool-call JSON → **100% compliance even on a 3B model**. This is THE reason local agents fail; we fix it structurally, not with retries. |
| **Tool execution** | **Swappable backend** (direct → Docker → **Wasm**), transparent to LLM | Pi/Claude Code pattern. Lets us harden execution (sandbox) without changing tool definitions. |
| **Prompt-injection defense** | **Dual-LLM split + deterministic policy engine** | Architectural, not behavioral. Privileged planner never sees untrusted data. |
| **Config** | **Schema-validated + auto-migrating** (Zod) | Validate on boot, auto-upgrade old config, suggest one-line fixes instead of crashing. |
| **Updates** | **Transactional with auto-rollback** | New version must pass a self-test or it reverts. Fixes "every update breaks." |
| **Extensibility** | **Signed skills (markdown SOPs) + TypeScript extensions** | Skills compound; signing + scanning prevents the ClawHub poisoning disaster. |
| **Dependencies** | **Minimal, audited, vendored where possible** | Nanobot got pwned by an untested LiteLLM dep. We keep the tree tiny and pinned. |
| **Interfaces** | **CLI/TUI first → Telegram → Desktop (Tauri)** | Terminal-native core, Telegram for mobile (users love it), Tauri desktop later for the non-terminal crowd (the Hermes Desktop lesson). |

## 4. The "Never Breaks" Doctrine (non-negotiable engineering rules)

1. **Determinism around the model.** Anything that must be correct (tool calls, policy, budget, rollback) is deterministic code — never "ask the model nicely."
2. **Every state change is transactional.** Config, updates, skill writes, file edits → all reversible (SQLite tx + git snapshots).
3. **Fail closed, explain clearly.** On any ambiguity (auth, untrusted data, over-budget), stop and ask the human with a readable reason — never silently proceed.
4. **Validate at every boundary.** Provider responses, tool outputs, config, skills → schema-validated before use (the "validation sandwich").
5. **No surprise cost, ever.** Hard ceilings enforced in code; the model cannot override the budget.
6. **Backward-compatible by default.** Old config/skills/sessions auto-migrate; nothing a user set up should break on upgrade.
7. **Small, audited surface.** Few dependencies, pinned versions, signed artifacts.

---

*Read the numbered docs in order. Each is self-contained but references this master plan.*
