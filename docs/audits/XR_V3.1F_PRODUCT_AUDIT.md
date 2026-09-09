# XR FORENSIC AUDIT

**Repo:** github.com/ahmadrrrtx/xr @ `main` (v1.0.0 "Truth") · **Package:** @rrrtx/xr@1.0.0 (npm `latest`)
**Auditor method:** full source review + clean-environment execution of every major entry point + published-package install test + mock-provider end-to-end agent runs + browser-level dashboard exercise + npm artifact diff.
**Environment:** Linux x64, Bun 1.4.2, Node 20, fresh HOME per install test.

---

## 1. Executive Summary

XR is a **138,127-LOC TypeScript agent runtime** with an unusually strong security/engineering *process* layer (hash-chained + Ed25519-signed audit log, durable TTL-default-deny approvals, path-traversal-safe file APIs, CSRF-guarded daemon, claim-lint, 10 CI workflows, 3,260 green tests) wrapped around a **product experience that is fragmented, self-contradictory, and in places actively misleading**.

The core verdicts:

1. **The trust plane is real and good.** The audit chain (SHA-256 links + signed checkpoints + signed head), approval store (TTL default-deny, cross-process resolvable), and daemon hardening (token auth, origin checks, path scoping) are genuinely well-engineered and honestly documented.
2. **The consent plane is broken at the last mile.** The flagship "structured approval previews" (F-26) never receive tool arguments because `write_file`, `delete_file`, and `shell` call `approve()` without `args`. Users approve "(no path in args)" while the real args scroll by in the step line. Durable approvals record `argsHash: sha256:none`.
3. **The flagship budget claim has holes.** Custom (OpenAI-compatible) providers are priced **$0** ("unknown provider → assume free"), so the USD governor cannot enforce anything for them; the per-task token cap is not reachable through any documented global flag (`--budget-tokens` is silently absorbed into the prompt text; `--max-tokens` exists only in `xr run`'s usage string, not in `xr --help`).
4. **The dashboard lies in at least six places.** A dead MCP panel (API routes don't exist, errors swallowed, always "No connections registered"), "ts: Invalid Date" on every audit entry, a Business CRM panel with hardcoded fake metrics ($4,850 invoices, 84 workflows) for a feature that was extracted to a satellite package, a "Webhook Server … Listening" status for a server that does not exist, "MCP HEALTH: Healthy" and "COMPUTER USE: Authorized · Jarvis permissions" on a fresh install, and a local-runtimes list that shows Ollama on port `1`.
5. **Distribution is broken for the primary channel.** `npm i -g @rrrtx/xr` produces a CLI that dies with `env: 'bun': No such file or directory` on any machine without Bun — which is most npm users. The friendly Node fallback (`bin/xr.cjs`) is never linked. Additionally, npm history is a minefield: `latest` (1.0.0) is *lower* than the 3.1.5 published in July, so existing users can never semver-update into the current line.
6. **The test suite pollutes the user's real `~/.xr`.** Running `bun test` created a phantom workspace, wrote test keys into the real `~/.xr/.env`, and stored a test memory (`WORKSPACE_A_SECRET`) into the user's durable memory — visible in the dashboard and `xr memory list`.
7. **Three model-routing systems fight each other.** `config.defaults.provider` (openai) vs `localModels` selection vs the `intelligencePlane` router (default `hybrid` strategy → LM Studio → Ollama). A fresh install shows "provider openai / gpt-4o-mini" in status while runs silently use LM Studio with Ollama fallback. This single issue generates most of the "I don't understand what XR is doing" feeling.
8. **The system is over-processed and under-consolidated.** 1,134 "Phase N" references and 35 ADR references live in source comments; the codebase sits at 99.4% of its own size ceiling with 14 over-limit modules "waived"; 45 top-level src/ directories; 74 CLI commands; 26 dashboard panels; 4 parallel extension systems (skills, plugins, capabilities, MCP); 6 isolation backends; 45K LOC of half-extracted satellites. Every feature has a governance story; the *user-facing coherence* story is missing.

**Bottom line:** XR's problems are not "the code doesn't work" — the engine mostly works. The problems are (a) a handful of last-mile correctness bugs in exactly the places XR stakes its reputation (consent, budget, honesty of the dashboard), and (b) a product information architecture that grew by accretion (26 panels, 74 commands, 4 extension systems) instead of by design. The rebuild should keep the trust plane, replace the dashboard's IA, unify the extension/model concepts, and make every pixel tell the truth.

---

## 2. Current Architecture

### 2.1 Shape of the system

```
                        ┌────────────────────────────────────────────────┐
  Surfaces              │ CLI (74 commands) · TUI Shell · Dashboard (26  │
                        │ panels, 1.3MB HTML) · Telegram bot · VS Code   │
                        └───────────────┬────────────────────────────────┘
                                        │
                        ┌───────────────▼────────────────┐
  Kernel                │ kernel boot · service registry │
  (src/core)            │ agent loop · execution fabric │
                        │ (envelopes, checkpoints,       │
                        │  recovery, workflow engine)    │
                        └───────┬───────────────┬────────┘
                                │               │
              ┌─────────────────▼──┐   ┌────────▼─────────────────────┐
  Planes      │ Intelligence router│   │ Trust & isolation: 6 backends│
              │ (catalog, scoring, │   │ (in-process, restricted, ns, │
              │  difficulty,       │   │  container, gvisor, firecracker)
              │  fallback chains)  │   │ + policy + approvals + budget│
              └────────────────────┘   └──────────────────────────────┘
                                │
        ┌───────────┬────────────┼──────────────┬───────────────┐
  Infra │ Providers │ SQLite     │ Memory/RAG   │ Extensions:   │
        │ (26 pre-  │ workspace- │ (vector-ish  │ skills (65) · │
        │  sets +   │ store +    │  store, 1200 │ plugins ·     │
        │  custom)  │ repos/WAL  │  LOC)        │ capabilities  │
        │           │            │              │ (165) · MCP   │
        └───────────┴────────────┴──────────────┴───────────────┘
```

- **45 top-level `src/` directories**, 579 files, 138,127 LOC. Satellites (`satellites/`, 45,741 LOC) hold the extracted `xr-enterprise` and `business-os` packages; CLI shims still advertise them.
- **Daemon** (`src/daemon/`): Bun `serve`-based HTTP server, token auth (query → HttpOnly cookie, or bearer header), route groups per domain, dashboard rendered as one giant server-generated HTML page with a 157KB concatenated inline-JS client (no framework, no build step, no minification).
- **Persistence:** single SQLite DB per workspace (`~/.xr/xr.db`, WAL) behind a 2,539-LOC `workspace-store.ts` + repo classes + a write gate.
- **Config:** `~/.xr/config.json` (zod-validated, versioned migrations) — but routing truth is split across `defaults`, `localModels`, `providerEngine.routingStrategy`, and the `intelligencePlane`.

### 2.2 What is genuinely good (keep)

- **Audit chain** (`src/security/audit-signer.ts`, `audit-verify.ts`): SHA-256 chain + per-segment Ed25519 checkpoints + signed head counters + honest threat-model docs. `xr audit verify --crypto` works and correctly reports 2 signed segments.
- **Approval store** (`src/control/approval-store.ts`): durable, TTL default-deny, cross-process decide, surface-aware, audited. Well designed.
- **Daemon security**: token in query→cookie exchange, bearer header support, origin/CSRF guard (evil-origin POST → 401), assets behind auth, path traversal blocked on files API (`?path=../../etc/passwd` → 400 "path escapes the project root").
- **Doctor readiness honesty**: `xr doctor` exits non-zero and names the single next action when no provider is reachable. Claim verified.
- **Test discipline**: 3,260 tests / 14,965 expects, green in 132s; mutation testing, golden-path, soak, fuzz, canaries, consumer-smoke, supply-chain (SBOM, license check, cosign, SLSA provenance).
- **Fallback chains and repair**: provider fallback, JSON repair (`reliability/repair.ts`), retry classification, checkpoint/resume.

### 2.3 Where it breaks (map to sections below)

| Area | Verdict |
|---|---|
| Provider system | Works, but 3 competing config systems; custom providers unpriced |
| Agent loop | Works (verified end-to-end with mock provider + tool calls) |
| Approvals | Gate enforced ✅; preview data starved ❌; `--yes` broken ❌ |
| Budget | USD works for known presets ❌ for custom providers; token cap unreachable ❌ |
| Audit | Excellent ✅; dashboard rendering broken ❌ |
| Dashboard | Chat/SSE works ✅; 6+ panels dead/fake/misleading ❌; 2MB payload ❌ |
| MCP | CLI works ✅; dashboard dead ❌ |
| Plugins/Skills/Capabilities | CLI healthy; three overlapping systems |
| Telegram | Reasonable 500-LOC bot w/ rate limits + approval keyboard; untested here (needs token) |
| npm package | Source parity ✅; launcher broken on Node-only machines ❌; version regression ❌ |
| Installers | install.sh/install.ps1 substantial; home dir differs from npm (`~/.xr-agent` vs `~/.xr`) |
| Docker | Good (loopback publish, container bind logic); uses port 7842 while bare default is 3141 |
| VS Code extension | 67 lines; wrong default port; "Ask XR" is a message, not a feature |
| Tests | Green but leak into real `~/.xr`; skip the exact integration seams that are broken |

---

## 3. Critical Bugs (P0)

### P0-1 — npm-installed CLI is dead on any machine without Bun
- **FILE:** `bin/xr` (shebang `#!/usr/bin/env bun`), `bin/xr.cjs` (never linked), `package.json` (`bin.xr` → `bin/xr`).
- **ROOT CAUSE:** npm links `bin/xr`, whose interpreter is `env bun`. The Node fallback with the helpful "XR requires Bun" message (`bin/xr.cjs`) is not the bin entry. `engines.bun` is not a real npm engine, so nothing warns at install time.
- **EVIDENCE:** `env -i PATH=/usr/bin:/bin … xr --version` → `env: 'bun': No such file or directory`, exit 127. With Bun present → `v1.0.0 (Truth)`.
- **USER IMPACT:** The README's **first** install row (`npm i -g @rrrtx/xr`) fails cryptically for the majority of npm users (Node-only machines). First impression = broken product.
- **PROPOSED FIX:** Make `bin/xr` a Node-compatible launcher (`.cjs` first: locate Bun, offer one-line install, or download it); or ship a compiled binary per platform via `optionalDependencies`; or bundle the runtime. At minimum: friendly error + `npx bun`-style bootstrap.

### P0-2 — `--yes` ("assume yes for confirmations") does not approve tool calls; runs then report success while doing nothing
- **FILE:** `src/services/agent-service.ts` (policy.approve → `makeApprover`), `src/control/approval-store.ts:542` (no assume-yes path), `src/interfaces/cli.ts` (`confirm(..., false)`).
- **ROOT CAUSE:** `makeApprover` always goes through the durable store + interactive prompt. The `flags.yes` re-threaded in `src/cli/router.ts:114` is never consulted by the CLI approver. Non-TTY `confirm()` returns its default (`false`) instantly — so one-shot/CI runs auto-**deny** every consequential action, then print `✓ done in N step(s)`.
- **EVIDENCE:** `xr --yes "task"` (mock provider returning a write_file call) → approval prompt rendered → `✗ write denied by user` → run ends `✓ done in 2 step(s)`; no file written; exit 0.
- **USER IMPACT:** Scripts/CI silently accomplish nothing while reporting success — the exact "success theater" XR's constitution forbids. Interactive users are also misled by "(auto-deny in 300s)" which actually denies instantly in non-TTY.
- **PROPOSED FIX:** Thread `yes` into the approver factory as an explicit, audited `channel: "assume_yes"` decision with per-risk-tier limits (e.g., never auto-approve tier2+ without typed confirm), and fix the "(auto-deny in Ns)" copy for non-interactive runs.

---

## 4. High Severity Bugs (P1)

### P1-1 — Approval previews are starved of arguments (security-UX last-mile failure)
- **FILE/FUNCTION:** `src/tools/files.ts:80` (`write_file`), `src/tools/system.ts:60` (`delete_file`), `src/tools/system.ts:111` (`shell`) — none pass `args` to `ctx.approve()`; `src/control/preview.ts:214` (`buildStructuredPreview`) then renders from `undefined`.
- **ROOT CAUSE:** `ApprovalRequest.args` was added to the type and the store, but built-in tools were never updated.
- **EVIDENCE:** Approval renders `── path (no path in args)` / `── content (no content field — args redacted)` directly under a step line that prints the full raw args. Durable approval rows store `argsHash: "sha256:none"`.
- **USER IMPACT:** The "consent plane shows DATA, not model prose" guarantee (F-26) is void for the three most dangerous tools. "Remember this approval" cannot scope to argument hashes.
- **FIX:** Pass `args` at every `ctx.approve` call site; add a contract test asserting `args` non-null for every tool with `requiresApproval`.

### P1-2 — Custom providers are priced $0 → spend meter and USD budget unenforceable
- **FILE/FUNCTION:** `src/cost/pricing.ts:131` `priceFor()` — `if (!rules) return FREE; // unknown provider → assume free`.
- **EVIDENCE:** Custom provider `mock` serving model `gpt-4o-mini`: meter shows `💰 1.5k tok (local · $0) / $0.0005 cap`; 3,000 tokens billed $0.00; USD cap never triggers.
- **USER IMPACT:** "It cannot overspend" is false for the first-class "any OpenAI-compatible endpoint" path (paid proxies, Azure-style gateways, self-hosted billing).
- **FIX:** Custom providers must declare pricing (or default to *estimate from model name* with a visible "unpriced" warning that fails *closed* on budget checks, not open).

### P1-3 — Token budget unreachable + unknown flags silently become prompt text
- **FILE/FUNCTION:** `src/cli/flags.ts` (no unknown-flag rejection), `src/commands/run-agent.ts` (`--max-tokens` parsed but undocumented in `xr --help`), `src/commands/triggers.ts:95` (only `--budget-tokens` consumer).
- **EVIDENCE:** `xr --budget-tokens 1600 "task"` runs with the flag **inside the task title** ("1600 write the file and run…", visible in `xr session list`); no error. `--frobnicate hello` likewise.
- **USER IMPACT:** Typos and stale flags silently mutate the user's prompt; the README's "token ceiling checked during the loop" is not controllable from the documented surface.
- **FIX:** Reject unknown `--flags` (exit 2 + suggestion); document `--max-tokens` globally; add a session title that excludes swallowed tokens.

### P1-4 — Three model-routing sources of truth contradict each other on every fresh install
- **FILE/FUNCTION:** `src/config/config.ts` (`defaults.provider: openai` default; `providerEngine.routingStrategy` default `"hybrid"`), `src/intelligence/router.ts` (`policyFromConfig`), `src/local/*` (local model selection).
- **EVIDENCE:** Fresh install: `xr status` → "provider openai · model gpt-4o-mini"; one-shot run banner → "LM Studio (Local) → fallback Ollama (Local)"; Models panel → "ACTIVE LOCAL MODEL phi3:mini"; Home bento → "PROVIDER STATUS: ollama (Active Route)". Four different answers.
- **USER IMPACT:** Users cannot predict what model will run, what it costs, or how to change it — the single biggest "feels terrible and complicated" driver.
- **FIX:** One routing decision object, one rendering of it on every surface; `defaults.provider` must either win or be removed; the router's "why" must be human-readable (see UX_AUDIT).

### P1-5 — Dashboard MCP panel is dead (routes don't exist; errors swallowed)
- **FILE/FUNCTION:** `src/daemon/dashboard/client-panels-b.ts:250` (`loadMcp` → `api("/api/mcp").catch(() => [])`), `:266` (`registerMcp` → POST `/api/mcp/add`); no MCP routes exist in `src/daemon/routes/registry.ts`.
- **EVIDENCE:** `GET /api/mcp` → 404; `POST /api/mcp/add` → 404 (403 w/o origin); panel permanently shows "No Model Context Protocol connections registered." even with a server registered via `xr mcp add` (verified: CLI registers, panel still shows none).
- **FIX:** Add `mcp.routes.ts` to the daemon registry (list/add/remove/health) or remove the panel; never `.catch(() => [])` a 404.

### P1-6 — Dashboard audit panel renders `ts: Invalid Date` for every entry
- **FILE/FUNCTION:** `src/daemon/dashboard/client-panels-c.ts` `loadAuditLog()` (~line 264) reads `e.ts`; API (`/api/audit`) returns `created_at`.
- **EVIDENCE:** Every row in the Audit panel shows `ts: Invalid Date`; hashes and events render fine.
- **FIX:** Read `created_at` (and add a dashboard↔API contract test — this class of bug is invisible to the current suite).

### P1-7 — Dashboard shows fabricated or unverifiable data
| Panel | Claim (fresh install, zero data) | Reality |
|---|---|---|
| Business OS CRM | "CUSTOMER PIPELINES 12 · INVOICES AUDITED $4,850 · WORKFLOWS TRIGGERED 84" | Hardcoded strings; feature extracted to satellite (`xr business` says MOVED) |
| Webhooks API | "127.0.0.1:3141/api/webhook — Status: Listening" + "Integrate Port" button | No webhook route exists anywhere; nothing listens on 3141 when daemon is on another port; button just fires a toast |
| Home bento | "MCP HEALTH: Healthy" | MCP API 404s |
| Home bento | "COMPUTER USE: Authorized · Jarvis permissions" | Never authorized anything; "Jarvis" is leftover copy |
| Models | Local runtimes list: Ollama `http://127.0.0.1:1`, Jan/LocalAI on `:11434` (Ollama's port) | Port mapping scrambled/misleading |
- **FILES:** `src/daemon/dashboard/page-panels-b.ts:477,513`, `client-panels-*`, capabilities/bento sources.
- **USER IMPACT:** The product's differentiator is honesty ("an agent you can audit"); fake numbers on a fresh install destroy that trust in minutes.
- **FIX:** Every metric must come from an API or be labeled "demo". Delete the Business and Webhooks panels or wire them.

### P1-8 — Test suite pollutes the user's real `~/.xr`
- **FILE/FUNCTION:** `test/context/phase09-isolation.test.ts`, `test/security/secrets.test.ts` (XR_HOME set in `beforeEach`, but module-level/leaked state escapes), suite preload `test/helpers/suite-tmp.ts` insufficient.
- **EVIDENCE:** After `bun test` in a clean HOME: `~/.xr/workspaces/phase09-b/` (workspace + DB) created; `~/.xr/.env` contains sealed `XR_TEST_LAUNCH_KEY`, `XR_TEST_OTHER`; durable memory contains `WORKSPACE_A_SECRET` (visible in `xr memory list` and the dashboard Memory panel).
- **USER IMPACT:** Phantom workspaces, fake memories, and test keys in a real install; breaks "local-first, private" expectations and can confuse routing/health.
- **FIX:** Hard-isolate: set `XR_HOME` at process spawn (bunfig `--preload` that re-execs if unset), or make every store constructor require an explicit root; add a post-suite sentinel test asserting the real HOME is untouched.

### P1-9 — Secret-store display lies, and OS-backends don't remove the file copy
- **FILE/FUNCTION:** `src/security/secrets.ts:76` (`preferredSecretBackend()` returns `linux-secret-service` on Linux unconditionally — no `secret-tool` check), `src/install/system.ts:245-246` (status prints it), `secrets.ts:323-331` (`setSecret` always also writes the AES-GCM file).
- **EVIDENCE:** On a host with no secret-tool and no D-Bus secret service: `xr status` → "✓ Secret store … linux-secret-service"; keys nonetheless land in `~/.xr/.env` (encrypted with a key stored 2 directories away).
- **USER IMPACT:** Users believe keys are in the OS keychain when they are on disk; threat model doc is honest but the *status surface* contradicts it.
- **FIX:** Use the async probe for display; when an OS backend succeeds, either drop the file copy or clearly report "mirrored (encrypted) at ~/.xr/.env".

### P1-10 — npm release line regressed (`latest` 1.0.0 < previously published 3.1.5)
- **EVIDENCE:** `npm view` history: 0.2.0 → 3.0.0–3.1.5 (July) → 1.0.0-beta.1 → 1.0.0 (Sept). `release.manifest.json` admits "1.0.0 is a DELIBERATE semver rebaseline of 7.1.0".
- **USER IMPACT:** Anyone who installed 3.x can never `npm update` to 1.0.0 (it's a downgrade); two "stable" lines confuse every consumer and every package manager.
- **FIX:** Either resume ≥3.1.6 numbering, or deprecate 3.x versions with a message pointing to 1.0.0, and document the rebaseline on npm.

### P1-11 — VS Code extension cannot connect by default and its "Ask XR" is a stub
- **FILE:** `extensions/vscode/package.json` (`xr.daemonUrl` default `http://127.0.0.1:7842`), `extension.js` (67 LOC).
- **EVIDENCE:** `xr serve` defaults to **3141** (verified); Docker uses 7842; the extension's `xr.ask` command shows *"run `xr \"…\"` in your terminal (the daemon is read-only; tasks run via CLI for safety)"*.
- **FIX:** Default port 3141 (or autodiscover via `~/.xr` daemon state file); make `Ask XR` call `/api/v1/chat` (it exists and works — verified via SSE).

### P1-12 — Inconsistent exit codes break scripting
- **EVIDENCE:** `xr ask "..."` with zero reachable providers → **exit 0**; `xr "task"` same conditions → exit 1; unknown flags → exit 0.
- **FIX:** One exit-code contract table (OK / soft-fail / hard-fail / usage), enforced by tests.

---

## 5. Medium Severity Bugs (P2)

1. **`xr mcp add` error UX**: wrong syntax dumps raw zod JSON (`✗ [ { "received": "--cmd", … } ]`) under a generic "Why: An unexpected error occurred / Fix: Retry the command" template. (`src/commands/mcp.ts` + `src/cli/errors.ts`.)
2. **Dashboard payload**: 1.34MB HTML (≈1.25MB is inlined base64 brand PNGs) + 580KB CSS + 157KB JS; `/api/skills` returns 256KB and `/api/capabilities` 724KB JSON on panel open. Slow on first load, no caching strategy.
3. **Dashboard chat defaults to `ask` mode** while CLI/config default is `agent` (`src/daemon/routes/chat.routes.ts:42` "Default is the SAFE read-only ask mode") — users' first dashboard chat can't use tools and never says why.
4. **Automation panel suggests a non-existent command**: "xr cron add …" (actual: `xr triggers create`; `xr cron add` → "Unknown triggers command: add").
5. **`xr update` self-"updates"**: builds a 98MB binary from local source at the same version and reports "✓ Updated … Health canary passed; atomic swap complete" — success theater on a no-op.
6. **`xr status` vs `xr doctor` duplication**: status output is a strict prefix of doctor; two commands, one job.
7. **Shell startup modal** forces workspace selection on every launch even with a single workspace ("Select a workspace, then press Enter").
8. **Pricing table frozen in 2024** ("All prices are based on public pricing as of 2024") — meters drift from real spend on preset providers.
9. **Port identity crisis**: 3141 (serve default) vs 7842 (Docker + VS Code + dashboard copy) vs 7860-ish arbitrary; dashboard "Devices" panel claims VS Code API port 3141.
10. **`install.sh` uses `~/.xr-agent`** while npm/CLI use `~/.xr` — two homes, no migration story mentioned.
11. **Session titles polluted by swallowed flags** ("1600 write the file and run…").
12. **`getSecret`'s memo + `delete process.env[name]` in `removeSecret` bypass the compat gate** (minor spec violation of the "never hydrate env when compat off" rule — it *deletes*, which is benign but inconsistent).
13. **Chat sidebar "Primary conversation thread · 0 messages · 1s ago"** — a placeholder that renders as if it were real state.
14. **Budget panel "HIGHEST MODEL SPEND: Ollama (Local) → fallback LM Studio (Local)"** — a routing chain rendered as a model name.

## 6. Low Severity Problems (P3)

1. Banner/logo renders as garbled block glyphs in many terminals; tagline "The AI Agent You Can Actually Trust" is marketing-speak in a system status header.
2. "Jarvis permissions", "Bento Matrix", "Dojo test lab", "⌁ CONTROL", "EDR endpoint checking" — comic-book naming in a trust product.
3. i18n is 12 strings × 4 languages; README advertises multilingual more broadly.
4. `tsconfig.json` excludes `src/interfaces/tui2.ts` — file no longer exists (stale config, dead reference).
5. 1,134 "Phase N" comments, 35 ADR refs, constitution-article citations embedded in runtime code — archaeology that inflates reading cost (and the size gate is at 99.4% ceiling with 14 waivers).
6. `docs/` has 456 markdown files (65K LOC) incl. 100+ "historical" phase docs shipped **inside the npm package** (483 doc files, 18MB unpacked; brand PNGs up to 936KB shipped as package assets).
7. `xr help` lists "MOVED to @rrrtx/business-os" as a command — dead verbs in the primary help screen.
8. npm README (published) says "Status: Public Beta" while repo README says "Status: Stable" for the same version 1.0.0 (stamp drift between publish and HEAD).
9. The `XR_TEST_LAUNCH_KEY`-style names and `WORKSPACE_A_SECRET` canary strings are user-visible if tests leak (see P1-8).

---

## 7. Security Issues

| # | Issue | Severity | Detail |
|---|---|---|---|
| S-1 | Approval preview without args (P1-1) | **High (UX-security)** | The human approves prose, not data; the mitigating control (structured preview) exists but is unwired. |
| S-2 | Secrets always mirrored to disk (P1-9) | Medium | Defeats "OS-backed storage preferred" on Linux/macOS for the sync write path; status misreports backend. |
| S-3 | `--yes` semantics (P0-2) | Medium | Headless users will conclude approvals don't work and seek to disable them entirely (unsafe workaround culture). |
| S-4 | Token in URL query (`?token=…`) | Low | Convenience tradeoff; lands in shell history / logs. Cookie exchange mitigates after first load; offer header-only flow for the security-conscious. |
| S-5 | `XR_BINARY` env is honored without validation in `bin/xr` | Low | If an attacker can set env, they can run any binary as the user — standard env-trust caveat, worth documenting. |
| S-6 | 2024 pricing → under-charging meters (P2-8) | Low (integrity) | "Better to under-report" is honest, but budget *enforcement* uses the same numbers, so caps can silently overshoot real spend. |
| S-7 | Telegram surface | Unverified | Code review only: allowlist IDs, rate buckets, approval callbacks, chat budgets present; no second factor on tier-2 approvals via Telegram beyond typed-confirm gating (needs live test). |

**Verified-strong:** path traversal blocked; CSRF/origin guard; assets behind auth; TTL default-deny; signed audit; sandboxed plugin worker; egress allowlist concept; seccomp profiles shipped in `assets/seccomp`.

## 8. Reliability Issues

1. **Exit-code inconsistency** (P1-12) — orchestrators can't trust the CLI.
2. **`xr update` no-op success** (P2-5) — users believe they're patched.
3. **Startup recovery noise**: every CLI invocation writes `execution.startup_recovery` audit events — 52+ audit entries accumulated in minutes of light use; chain grows with meta-events, diluting signal.
4. **Fallback chain shows 4 models across surfaces** (mock→lmstudio→ollama→codellama) — good resilience, but the *display* of every hop (banner + warnings + bento) makes failures look like total failures.
5. **One process per CLI command** re-reads config + re-opens SQLite + re-runs health checks each time (~200–400ms); acceptable, but the daemon exists — surfaces other than chat don't use it for execution.

## 9. NPM Package Issues (summary — full report in NPM_AUDIT.md)

- P0-1 launcher (Bun shebang); P1-10 version regression; 18MB unpacked (brand PNGs + 483 doc files); README status drift; `optionalDependencies.playwright` pulls ~42MB node_modules by default; no `os`/`cpu` constraints despite binary launcher path; `files` ships `install.sh/ps1` (harmless but noisy in node_modules).

## 10. CLI Issues (summary — details in BUGS.md)

- Unknown flags absorbed into prompts (P1-3); 74 top-level commands with overlaps (`run` vs free-form, `ask`/`plan` as both verbs and modes, `models` vs `providers` vs `mcp` vs `skills`...); help lists removed/moved commands; `--max-tokens` undocumented globally; inconsistent subcommand verbs (`mcp add` vs `triggers create` vs `plugins install`); status/doctor duplication; raw zod dumps on validation errors.

## 11. TUI / Shell Issues

- Startup modal forces workspace pick every launch; session list polluted by failed/error one-shots with no way to clear from the modal; `/help`, `/model` slash commands fine but undiscoverable (only "?" hint); timeline/notices system exists but state model (views + palette + chat + research + notifications) is dense; `tui.ts` is a 24-line shim (kept for compat) and `tsconfig` still excludes a deleted `tui2.ts`.

## 12. Dashboard Issues (details in UX_AUDIT.md)

- 26 flat panels; 6+ dead/fake/misleading panels (P1-5/6/7); 2MB uncached payload; contradictory model status across 4 surfaces (P1-4); chat defaults to ask mode; approval queue panel exists but shows "No pending authorizations" even while a CLI-run approval is pending (surfaces not unified through the durable store for display); "Devices/Downloads/Integrations/Notifications" panels are placeholders or marketing copy.

## 13–16. UX / IA / Terminology / Technical Debt

→ Full treatment in **UX_AUDIT.md** (every issue with CURRENT EXPERIENCE / WHY BAD / CONFUSION / BETTER PATTERN / PRIORITY) and **ARCHITECTURE_AUDIT.md**. Headlines:

- **IA**: 26 panels → 4 overlapping clusters (model config ×2, extensions ×4, security ×3, sessions ×2). Should be ≤7 areas.
- **Terminology**: 15+ insider terms on primary screens (capability, trust tier, placement, provenance, Dojo, Bento, Shield vs audit vs trust...).
- **Debt**: satellites half-extracted (dashboard still has Business panel); `workspace-store.ts` 2,539 LOC; size-gate at 99.4% with waivers; no client build pipeline; string-concatenated client JS with interpolated tokens (no types, no contract tests).

## 17. Dead Code / Duplication

- `bin/xr.cjs` unreachable via npm bin (dead unless manually invoked).
- Business panel + `xr business`/`xr enterprise`/`xr evaluate` shims (documented removal 2.0.0).
- `tui2.ts` reference in tsconfig (file deleted).
- `xr status` ⊂ `xr doctor`.
- Chat Sessions vs Recent Sessions panels (two views of one table).
- Providers panel renders the 26-provider dropdown twice (default + fallback).
- `satellites/` shipped in repo but excluded from package (correct), yet 483 doc files and brand art **are** shipped.
- `intelligence/` difficulty/fidelity/behavioral machinery (718-LOC router + evaluator + scorer + metrics) computes decisions that the UI then fails to explain in human terms — heavy machinery, thin payoff.

## 18. Missing Tests (the seams that broke)

1. No **dashboard-client ↔ API contract tests** (field-name drift: `e.ts` vs `created_at` shipped broken).
2. No test that **built-in tools pass `args` to approve** (F-26 tests presumably use synthetic approvers).
3. No test that **`--yes` auto-approves** (or documents that it can't).
4. No **consumer test without Bun on PATH** (consumer-smoke exists but evidently assumes Bun).
5. No test asserting **unknown flags are rejected**.
6. No test that the **test suite leaves `$HOME` untouched** (would have caught P1-8).
7. No test that **custom-provider spend is priced** (P1-2).
8. A11y/browser tests exist but are **skipped** in default runs (19 skips observed) — the MCP-dead-panel and Invalid Date bugs are exactly in that gap.

## 19. Broken / Overstated Claims (README vs verified reality)

| Claim | Verdict |
|---|---|
| "npm i -g @rrrtx/xr" as primary channel | ❌ broken without Bun (P0-1) |
| "It cannot overspend — every task carries a USD **and token** ceiling, checked during the loop" | ⚠️ USD only for priced presets; token ceiling not exposed on one-shot; custom providers $0 (P1-2/3) |
| "Denial is enforced in the execution path" | ✅ verified (write denied, no file) |
| "hash-chained log you can verify offline" | ✅ verified (`audit verify --crypto`) |
| "26 presets, 16 hosted + 10 local, one switch command" | ✅ presets exist; ⚠️ switching fights the intelligence router (P1-4) |
| "plugins and MCP servers reachable identically from every surface" | ❌ MCP dead in dashboard (P1-5) |
| "The consent plane shows DATA, not model prose" | ❌ starved of args (P1-1) |
| "xr doctor … never prints ok for a system that cannot do work" | ✅ verified (exit 1, clear reason) |
| "Multilingual from day one (en/ur/ar/es)" | ⚠️ 12 strings |
| Website: "Mission Control" marketing pages (careers, pricing, enterprise) | ⚠️ marketing surface for a local-first tool; pricing page for a BYOK product is confusing |

## 20. Competitive Findings (summary — detail in UX_AUDIT.md)

- **OpenClaw**: one gateway port, 4 dashboard areas (agents / conversations / channels / system), prefixed tokens, read-only mode, hideable sections, rich third-party dashboard ecosystem. XR's 26-panel sprawl vs OpenClaw's 4 areas is the headline gap.
- **Claude Code**: permission *modes* (plan/default/acceptEdits/auto/bypass) + `yes / yes-always / no` per action + `/cost`. XR has modes and approvals but no "yes-always" memory surfaced, no permission-mode switcher, and `--yes` is broken.
- **Cursor / Raycast / Linear / Vercel**: model picker as a first-class control; command palette as primary nav; density without clutter; progressive disclosure (summary first, detail one click deep); skeletons not spinners; one primary KPI.
- **Agent-UX research (2026)**: activity timeline **separate from chat**; permission queue with **batch approvals**; receipts; progressive delegation (persist approval patterns → auto-approve categories). XR has all the *backend* primitives for these (durable approvals, run events, checkpoints) but no UI that composes them.

## 21. Architecture Risks

1. **Client as string concatenation** — the 157KB dashboard client is built by TS template literals with interpolated tokens; no types, no bundler, no minifier, no contract tests. Every panel bug found (MCP 404, Invalid Date, fake data) is structural to this choice.
2. **Three routing truths** (defaults / localModels / intelligencePlane) — every UX contradiction traces here.
3. **Feature accretion without concept consolidation** — skills vs plugins vs capabilities vs MCP; sessions vs runs vs tasks; shield vs trust vs audit vs control.
4. **Size-gate at 99.4% with 14 waivers** — the governance system is papering over structural growth instead of forcing consolidation.
5. **Half-finished extraction** — satellites moved, but dashboard panels, CLI shims, and docs still reference the old world.
6. **Audit chain meta-noise** — startup-recovery and status events flood the chain; signal-to-noise for real forensics degrades.

## 22–26. Recommended Product / UX Architecture, Navigation, Components

→ **ARCHITECTURE_AUDIT.md** (product mental model, concept unification) and **UX_AUDIT.md** §5–7 (UX architecture, navigation map, component system) and **REDESIGN_PLAN.md** (migration).

## 27. Priority Matrix

| ID | Problem | Severity | Effort | Blasts radius | Do when |
|---|---|---|---|---|---|
| P0-1 | npm launcher dead w/o Bun | P0 | M | All npm users | Immediately |
| P0-2 | `--yes` broken / silent auto-deny | P0 | S | CI + headless users | Immediately |
| P1-1 | Approvals starved of args | P1 | S | Trust core | Immediately |
| P1-4 | Routing truth ×3 | P1 | M | Every surface | Immediately |
| P1-7 | Fake dashboard data | P1 | S–M | Product honesty | Immediately |
| P1-5 | Dead MCP panel | P1 | S | Extensions | Now |
| P1-6 | `Invalid Date` audit | P1 | XS | Audit UX | Now |
| P1-8 | Tests pollute `~/.xr` | P1 | S | Every contributor/user | Now |
| P1-2 | Custom providers $0 | P1 | M | Budget guarantee | Now |
| P1-3 | Flag swallowing | P1 | S | CLI correctness | Now |
| P1-9 | Secret-store misreport | P1 | S | Security honesty | Now |
| P1-10 | npm version regression | P1 | S | All 3.x users | Now |
| P1-11 | VS Code port + stub | P1 | S | IDE users | Now |
| P1-12 | Exit codes | P1 | S | Scripting | Now |
| P2-* | Errors, payload, modes, update no-op… | P2 | S–M | Polish | Phase 1 |
| UX-IA | 26 panels → 7 areas | P1 (product) | L | Everyone | Phase 2 |
| UX-NAV | Palette-first nav, run/activity split | P2 | M–L | Everyone | Phase 2 |
| ARCH | Client build pipeline + contract tests | P1 (structural) | M | All dashboard work | Phase 1 |
| ARCH | Extension unification | P2 | L | Ecosystem | Phase 3 |

*(S ≤ 1 day · M ≤ 1 week · L multi-week)*

---

**Companion reports:** `BUGS.md` (full bug register with reproduction + fixes) · `NPM_AUDIT.md` (package forensics) · `UX_AUDIT.md` (UX + competitive research) · `ARCHITECTURE_AUDIT.md` (product architecture + unification) · `REDESIGN_PLAN.md` (phased migration plan).
