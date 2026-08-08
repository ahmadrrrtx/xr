# 02 — Technical Requirements Document (TRD)
### SENTINEL · v1.0 · 2026-06-03

---

## 1. Tech stack (final)

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (strict) | Type-safe boundaries everywhere |
| Runtime | **Bun** (Node 20+ fallback) | Fast cold start, single-binary build |
| CLI/TUI | **Ink (React)** or **OpenTUI**; `clack` for prompts; `commander` for args | Matches Claude Code/OpenCode |
| Persistence | **SQLite** + **Drizzle ORM** | Transactional rollback, branching, queries |
| Validation | **Zod** | Config, provider responses, tool args, skills |
| LLM access | **Custom thin adapter** (no heavy framework) | r/LocalLLaMA: "roll your own beats frameworks"; avoids LiteLLM-style supply-chain risk |
| Local models | **Ollama** / llama.cpp via OpenAI-compatible API | `format` param → GBNF grammar |
| Structured output | **GBNF grammar** (local) + native structured output (OpenAI/Gemini) + Zod re-validate | 100% valid tool calls |
| Sandbox | direct → Docker → **Wasmtime/Wasmer** (swappable) | Hardening without changing tools |
| Secrets | OS keychain (keytar) / encrypted file | Never plaintext |
| Egress control | local allow-list proxy | Exfiltration killer |
| Observability | OpenTelemetry → JSONL + hash chain | Replayable audit |
| Distribution | npm + signed installers (Win/macOS/Linux) + single-container Docker | Fixes Docker complaints |

**Dependency policy:** few, pinned, audited, vendored grammars; CI runs `npm audit` + license check; no transitive surprises.

## 2. High-level architecture

```
                        ┌──────────── INTERFACES ─────────────┐
                        │  CLI/TUI   ·   Telegram   ·  Desktop  │
                        └──────────────────┬───────────────────┘
                                           │ commands (trusted user input)
                          ┌────────────────▼─────────────────┐
                          │           AGENT CORE              │
                          │  Observe → Think → Act loop       │
                          │  modes: Agent / Plan / Ask        │
                          └───┬───────────┬───────────┬───────┘
              ┌───────────────┘           │           └─────────────────┐
   ┌──────────▼─────────┐   ┌─────────────▼────────────┐   ┌────────────▼───────────┐
   │ PROVIDER LAYER      │   │  COST GOVERNOR            │   │  POLICY ENGINE          │
   │ manifests, vault,   │   │  ceiling, meter, routing, │   │  capabilities, least-   │
   │ health, failover    │   │  compression, early-stop  │   │  privilege, approval    │
   └──────────┬─────────┘   └─────────────┬────────────┘   └────────────┬───────────┘
              │                            │                             │
   ┌──────────▼─────────┐   ┌─────────────▼────────────┐   ┌────────────▼───────────┐
   │ RELIABILITY HARNESS │   │  TOOL RUNTIME             │   │  EGRESS PROXY           │
   │ GBNF grammar,       │   │  swappable backend        │   │  domain allow-list      │
   │ auto-repair,        │   │  (direct/Docker/Wasm)     │   │                         │
   │ model profiles      │   └─────────────┬────────────┘   └─────────────────────────┘
   └─────────────────────┘                 │
                          ┌────────────────▼─────────────────┐
                          │      STATE (SQLite + files)        │
                          │  sessions · memory(3-tier) · skills│
                          │  audit log · config · snapshots    │
                          └────────────────────────────────────┘
```

## 3. The 4 killer subsystems (detailed spec)

### 3.1 Cost Governor (F3) 💰
**Components:** Budgeter, Meter, Router, Compressor, Stopper.
- **Budgeter:** every task gets a `max_tokens` / `max_usd` from config or prompt. A pre-flight estimator + running counter; when projected next step would exceed ceiling → **halt, surface "X of Y budget used, continue? (cost ≈ $Z)"**. Hard cap enforced in code; model cannot override.
- **Meter:** per-step token+$ accounting from provider usage fields; shown live in TUI/Telegram.
- **Router:** rules-based model selection (`cheap_model` for read/summarize/extract, `smart_model` for plan/reason). Config-driven thresholds.
- **Compressor:** scheduled context summarization every N steps (research: ~22.7% savings); large tool outputs → virtual filesystem (referenced, not inlined).
- **Stopper:** no-progress detector (repeated states / repeated tool calls / falling reward) → early-stop + ask. (Research: models "can't recognize when to stop early.")
- **Algorithm (per loop step):**
  1. `est = estimate(next_step)`; if `spent + est > ceiling` → pause+ask.
  2. pick model via Router for this step type.
  3. if step `N % compress_every == 0` → compress context.
  4. run step; record usage to `cost_events`.
  5. if `no_progress(window)` → early-stop+ask.

### 3.2 Local-Model Reliability Harness (F4) 🖥️
**Goal:** make weak local models produce 100% valid tool calls.
- **Grammar-forced decoding:** every tool's Zod schema → JSON Schema → **GBNF grammar**; pass via Ollama `format` / llama.cpp `--grammar`. Token-level constraint = invalid tool JSON has zero probability → **100% compliance even on 3B models**.
- **Auto-repair loop:** if a (non-grammar) provider returns malformed output, a deterministic repairer (JSON5 parse, brace-balance, key-coerce) fixes it; if unfixable, re-ask once with the parse error. Never let bad output reach a tool.
- **Capability profiles:** detect model (id/family), load profile (tool-call format: native vs grammar vs ReAct text, max context, thinking on/off e.g. Gemma `enable_thinking=false`). Auto-tunes prompt + decoding per model.
- **Validation sandwich:** grammar (syntax) → Zod (schema) → semantic validators (business rules) before execution.

### 3.3 Non-Regressive Skills (F9) 🧠
**Goal:** self-improvement that can never overwrite a known-good behavior.
- **Skill model:** a skill = `{id, version, markdown SOP, tool_allowlist, verifier, frozen_runs[]}`.
- **Verifiability gate:** a skill run can only become "learned" if its outcome is *objectively checkable* (test passes / file diff matches / command exit 0 / user explicit approve). No verifier → no auto-learn (avoids reward-hacking; research-mandated).
- **Validated-behavior freezing:** on a verified success, store the action sequence as a **frozen baseline** (immutable, versioned in SQLite). Future learning forks a new version; the frozen base is never mutated.
- **Backward-transfer health check:** after any skill update, re-run a small **regression suite** of past frozen wins; if any regress → **auto-rollback** to previous version, log why.
- **Provenance:** each learned change stores a "why I learned this" note + diff + signer; pre-loaded skills are signed.

### 3.4 Self-Healing Config & Updates (F8) 🛡️
- **Config:** Zod schema with `version`; on boot validate; if older version → run ordered migrations; if invalid → print exact field + suggested fix, load last-known-good, never crash.
- **Updates:** download → install to a new versioned dir → run **self-test** (boot + 1 canned task + injection smoke test) → atomically switch symlink only if pass; else keep current. `sentinel rollback` reverts instantly.
- **All transactional:** SQLite migrations are reversible; file edits are git-snapshot backed.

## 4. Security architecture (cross-cutting)
- **Dual-LLM (F13):** Privileged planner sees only trusted input + typed results; Quarantined model reads untrusted content, has **no tools**, returns structured data only.
- **Policy engine:** capability/taint labels on values; tool calls gated by policy; least-privilege per-mode tool allow-list (e.g. Ask mode = read-only, no shell).
- **Egress allow-list:** all web/DNS via proxy; default-deny.
- **Secrets:** keychain only; injected as ephemeral env at call time; never written to config/logs (redaction filter on audit log).
- **Sandbox:** shell/code in Docker/Wasm, no host FS, no network unless allow-listed.
- **Approval gates:** code-enforced for write/delete/shell/send/keys/financial; default-deny on timeout.

## 5. Non-functional requirements (NFRs)
- **Performance:** cold start < 1.5s; first token < 2s on a cloud provider.
- **Reliability:** 0 crash on bad config; 100% valid tool calls (grammar path); auto-rollback on bad update.
- **Portability:** Linux/macOS/Windows; single-container Docker; ARM + x86.
- **Security:** no plaintext secrets; egress default-deny; published injection block-rate.
- **Observability:** every action a replayable span; redacted; exportable.
- **Maintainability:** strict TS, ≤ ~30 direct deps, CI lint+test+audit, ≥ 80% core coverage.
- **Privacy:** local-only mode (no network egress at all) supported.

## 6. Key technical decisions log (ADRs, summary)
- ADR-1 TS+Bun over Python (distribution + ecosystem; matches field leaders).
- ADR-2 SQLite over flat files (transactional rollback/branching for non-regression + time-travel).
- ADR-3 Thin custom adapter over LangChain/LiteLLM (supply-chain risk; "roll your own" reliability).
- ADR-4 GBNF grammar for local reliability (100% valid output, deterministic).
- ADR-5 Swappable tool backend (harden execution without changing tool defs).
- ADR-6 Manifest-driven providers (add providers with no release).
