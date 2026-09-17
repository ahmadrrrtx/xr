# XR — Complete Forensic Audit

> Phase: Blueprint (pre-implementation). Evidence date: 2026-09-17.
> Repository: https://github.com/ahmadrrrtx/xr @ `main` (7ba2dc8, tag `v1.0.0`).
> Method: full clone, code reading (not README-trusting), dependency install, build-free run (Bun JIT), CLI/TUI/daemon/dashboard exercise, test-suite run, npm artifact comparison.
> Evidence tags: **[OBSERVED]** measured/read · **[INFERRED]** reasoned from evidence · **[RECOMMENDED]** action.

---

## 1. Repository at a glance

| Property | Value | Evidence |
|---|---|---|
| Language/runtime | TypeScript on Bun (engines `bun>=1.3`, packageManager `bun@1.3.14`; audited on Bun 1.4.2) | [OBSERVED] `package.json`, `.bun-version` |
| Size | 1,130 `.ts` + 37 `.tsx`; **254,186 LOC** across src/extensions/plugins/satellites/scripts/test/benchmarks | [OBSERVED] `wc -l` census |
| Docs in repo | 1,299 `.md` files (docs/, skills/, phase reports, ADRs, CONSTITUTION) | [OBSERVED] file census |
| Runtime dependencies | `zod` only; optional `playwright` | [OBSERVED] `package.json` |
| Entry points | `bin/xr` (Node/Bun launcher) → `src/index.ts` → `src/cli/router.ts`; daemon `xr serve` → `src/daemon/server.ts` | [OBSERVED] |
| Surfaces | CLI (~40 verbs), fullscreen TUI Shell, local daemon + server-rendered web dashboard ("Control Center"), VS Code extension, Telegram bot, npm package, compiled binaries, Docker | [OBSERVED] |
| Governance | `docs/CONSTITUTION.md` (reconstructed canon, claim-lint enforced), ADRs, CODEOWNERS, release manifest w/ CI stamp-drift gates | [OBSERVED] |
| Tests | 317 test files; **3,242 pass / 0 fail / 19 skip** (148 s, Bun) | [OBSERVED] run 2026-09-17 |
| Version lineage | 0.x → 3.x → 4.x → 5.x → 6.x → 7.1.0 → **1.0.0 "Truth"** (deliberate semver rebaseline, 2026-08-13) | [OBSERVED] `CHANGELOG.md`, `release.manifest.json` comment |

## 2. Source-tree subsystem map (what / why / where / status)

### 2.1 Kernel & agent loop
- **What:** `src/core/` — kernel boot, service registry, event bus, workspace manager, `agent.ts` = the Observe→Think→Act loop (`runAgentLoop`, `src/core/agent.ts:425`).
- **Why:** single execution spine; every surface (CLI, TUI, daemon, Telegram) reaches the loop through `AgentService.execute()`; only `src/core/execution/runner.ts` may call `runAgentLoop` (enforced by `test/core/no-bypass.test.ts`). [OBSERVED]
- **Depends on:** tools registry, cost governor, memory store, capability grants (`mintGrant/runAuthorized/evaluateLoopGrant`), security tool-output framing, reliability repair, context compaction. [OBSERVED]
- **Status:** WORKS. `runAgent` retained as deprecated alias until 2.0.0 (ADR-0002). [OBSERVED]

### 2.2 Execution fabric (durable work)
- **What:** `src/execution/` — task runtime, state machine, checkpoints, leases, recovery, lanes, workflow engine (`workflow/engine.ts`, nodes, versioning), adapters (agent/tool/mcp/plugin/control/domain).
- **Why:** durable, resumable execution ("unresolved work" surfaced by `xr doctor`). [OBSERVED]
- **Status:** WORKS (unit-verified: workflow state machine tests pass). Partial UX exposure: `xr execution list` only. [OBSERVED]

### 2.3 Trust & isolation (security core)
- **What:** `src/runtime/trust/` — TrustService, risk classification, placement policy + escalate-only lattice, environment backends: in-process, restricted-process, namespace (bubblewrap), container, gVisor, Firecracker; `CredentialBroker` (default OFF per Phase 8), authority registry, isolated-spawn, verify.
- **Why:** decide WHERE actions run; Tier-2 work fails closed when no enforceable backend exists (`src/runtime/trust/policy.ts` hardened default). [OBSERVED]
- **Status:** WORKS as policy engine; heavy backends (gVisor/Firecracker) are detection hooks, rarely present on user machines. [OBSERVED/INFERRED]

### 2.4 Control plane (actions, approvals, computer use)
- **What:** `src/control/` — approvals (SQLite-backed store), typed-confirm, planner, preview, executor, files, browser (Playwright), computer-use (screen capture + vision + action schema), vision (local/cloud), permissions, audit.
- **Why:** governed side-effects: every risky action passes classify → approval → placement → execute → audit. [OBSERVED]
- **Status:** WORKS; computer control requires OS tools (xdotool/wmctrl on Linux) — absent in audit env, correctly reported by doctor. [OBSERVED]

### 2.5 Providers, models, local AI, intelligence routing
- **What:** `src/providers/` (26 presets: 10 local runtimes — Ollama, LM Studio, Jan, LocalAI, vLLM, llama.cpp, GPT4All, KoboldCPP, TextGen WebUI, SGLang; 16 cloud — OpenAI, Anthropic, Google, Bedrock, Groq, DeepSeek, OpenRouter, Together, Mistral, Fireworks, Cerebras, SambaNova, HuggingFace, Cohere, xAI, Perplexity), openai-compat gateway, fallback chain, model-switch, request-guard; `src/local/` (hardware probe, admission, recommendations); `src/intelligence/` (router, scorer, failover, degradation, SLOs, behavioral metrics).
- **Why:** provider-neutrality + BYOK + local-first; routing layer picks models by capability/health/cost. [OBSERVED]
- **Status:** WORKS (health matrix verified via `xr doctor`, `xr providers list`). Cloud keys absent in audit env → honest ✗ states. [OBSERVED]

### 2.6 Tools
- **What:** `src/tools/` — 18 core tools: `read_file, write_file, delete_file, list_dir, shell, git_{status,diff,commit,branch,pull,push,stash,log}, fetch_url, web_search, check_package, computer_control` + registry builder/service.
- **Status:** WORKS; scoped per-mode and per-agent (allow/deny lists). [OBSERVED]

### 2.7 Context & memory
- **What:** `src/context/` (14.7k LOC — largest dir): memory store (SQLite), injection/compaction, isolated store, eval harness; repos: user-memory, project-memory.
- **Why:** durable, inspectable, user-controlled memory (Phase 7 policy layer: ACLs on by-id reads). [OBSERVED]
- **Status:** WORKS (`xr memory list/add/search`, API `/api/v1/memory*`). [OBSERVED]

### 2.8 Skills (65 bundled) + marketplace
- **What:** `skills/` = **65 directories** (54 with `xr-skill.json`, 11 legacy markdown-only); `src/skills/` (32 modules: loader, manifest, validator, signing, verifier, permissions, tool-allowlist, marketplace backend/store, download engine, search index, SDK).
- **Why:** role/playbook packaging ("professional skills") + marketplace distribution.
- **Status:** WORKS. `xr skills list` reports "Loaded skill records (80)" = 65 bundled + registry/online records. [OBSERVED] Legacy-markdown skills lack manifests → weaker permission metadata. [OBSERVED]

### 2.9 Plugins & MCP
- **What:** `src/plugins/` (host, sandbox-worker + worker-protocol, loader, manifest, signing (Phase 8), catalog, allowlist); bundled `plugins/hello`, `plugins/github`. `src/mcp/` (client, manager, registry, allowlist).
- **Status:** WORKS at CLI level (`xr plugins/mcp list`); MCP daemon routes exist in repo (`mcp.routes.ts`) but **are missing from the published npm 1.0.0 tarball** (see §6 BUG-001). [OBSERVED]

### 2.10 Research engine
- **What:** `src/research/` — plan/search/extract/rank/synthesize/report, citations, jobs registry with SSE streaming, url-guard + content-guard (prompt-injection hygiene for fetched content), budget.
- **Status:** WORKS (`xr research`, API `/api/v1/research*`). [OBSERVED]

### 2.11 Voice
- **What:** `src/voice/` — pipeline (VAD, wake, STT, TTS, intents), hardware probe, settings, v2 streaming state machine (Phase 9 flags).
- **Status:** CODE COMPLETE but opt-in; requires ffmpeg/whisper/piper (absent in audit env; doctor warns honestly). [OBSERVED]

### 2.12 Channels & automation
- **What:** `src/telegram/` (bot, commands, render, auth); `src/automation/` (triggers w/ governed table, cron, webhook, token-bucket, pause-all kill switch).
- **Status:** WORKS at CLI (`xr triggers list`); Telegram untested (no token in env). [OBSERVED]

### 2.13 Security services
- **What:** `src/security/` — egress proxy (parse→allow→resolve→block-private→pin→redirect-revalidate→caps; fail-closed), private-IP blocklist incl. metadata ranges, secret broker, secrets store integration (OS keyring: linux-secret-service observed), Ed25519 audit signer/verify/anchor, prompt-injection benchmark (`xr attacks`), exec-integrity, tool-output framing, shield.
- **Status:** WORKS; audit chain verified intact (`xr audit tail/verify`). [OBSERVED]

### 2.14 Hygiene / XR-Shield
- **What:** `src/hgiene`→`src/hygiene/scanner.ts` + `src/xr-shield/` — HOST hygiene scanning (processes, startup items, miners, privacy), browser adblock/privacy/download views.
- **Why:** user-visible safety telemetry. Explicitly **not** the enforcement boundary (ADR-0027). [OBSERVED]

### 2.15 State & persistence
- **What:** `src/state/` — WorkspaceStore (bun:sqlite), 11 repos (audit, checkpoint, cost, partition, project-memory, reservation, session, skill, trigger, user-memory, workflow), migrations, write-gate, idempotency.
- **Status:** WORKS. `src/state/store.ts` is a deprecated re-export shim (dead weight). [OBSERVED]

### 2.16 Daemon & dashboard (current frontend)
- **What:** `src/daemon/` — server (loopback bind w/ container-aware override), bearer token → HttpOnly SameSite=Strict session cookie, 129 OpenAPI operations across 27 route files; dashboard = **server-rendered single HTML page** (~106 KB) built from TS template modules (`dashboard/page-*.ts`, `style-*.ts`, `client-*.ts` vanilla-TS client scripts).
- **Why:** local Control Center: chat + 23 panels (dashboard, chat, sessions, agents, providers, skills, memory, approvals, settings, about, audit, automation, budget, capabilities, control, files, mcp, models, plugins, research, shield, voice, workspaces).
- **Status:** WORKS (exercised: 401 without token; 302+cookie with token; 200 dashboard). UX character: **mission-control/admin dashboard**, not a workstation (see UX audit). [OBSERVED]

### 2.17 CLI / TUI
- **What:** `src/cli/` (router, catalog, kernel-boot, output formats text/json/yaml/markdown), `src/commands/` (29 modules), `src/interfaces/shell/` fullscreen TUI (startup workspace picker, status bar, model switch Alt+P, command palette).
- **Status:** WORKS (exercised under pty). TUI is the default `xr` experience. [OBSERVED]

### 2.18 Satellites, website, packaging, CI
- **Satellites:** `satellites/business-os`, `satellites/xr-enterprise` (Phase 5 ADR-0028 extraction; CLI relocation shims retained until 2.0.0, exit non-zero by design). [OBSERVED]
- **Website:** `website/` Next.js 16 app (marketing + marketplace generator). [OBSERVED]
- **Packaging:** install.sh / install.ps1, Homebrew/Scoop/Winget manifests, Dockerfile + compose, `scripts/build-matrix.ts` compiled binaries. [OBSERVED]
- **CI:** 10 workflows (ci, cross-platform, nightly, release, supply-chain, fuzz-guard, soak, provider-canaries, consumer-smoke, channel-install) + ~30 repo gates (size-gate, hot-path-lint, boundaries via dependency-cruiser, claim-lint, api:compat, perf gates…). [OBSERVED]

## 3. End-to-end execution path trace (verified by reading + running)

```
User input (CLI one-shot / TUI Shell / dashboard chat / Telegram / trigger)
  → src/cli/router.ts or daemon route (chat.routes.ts)
  → AgentExecutor (src/daemon/agent-executor.ts) / CLI kernel-boot
  → XRApp composition root (src/core/app.ts) → AgentService.execute()
  → src/core/execution/runner.ts → runAgentLoop (src/core/agent.ts:425)
      ├─ context: memory inject/compact (src/context/memory/*)
      ├─ providers: resolver/fallback-chain/intelligence router
      ├─ tools: registry → capability grants (src/capabilities/*)
      │     → trust classify (src/runtime/trust/classify.ts)
      │     → policy placement (policy.ts + lattice.ts; fail-closed)
      │     → approvals (src/control/approvals.ts, SQLite store) if required
      │     → environment backend execute (in-process…firecracker)
      ├─ egress: guardedFetch (src/security/egress-proxy.ts) for network tools
      ├─ cost: CostGovernor/BudgetManager (reservations, partitions)
      └─ stream events → surface (SSE / TUI / chat)
  → persistence: session/checkpoint/cost/audit repos (src/state/repos/*)
  → audit: Ed25519 chained entry (src/security/audit-signer.ts)
```
[OBSERVED — code reading cross-checked against live daemon routes and CLI behavior.]

## 4. What works / partial / dead / duplicated / fragile

| Category | Items |
|---|---|
| **WORKS** | CLI verb set, TUI shell, daemon+auth+dashboard, agent loop, durable execution, approvals, audit chain, egress proxy, trust policy, providers/local health, skills load+manifests, plugins/MCP CLI, research jobs, memory, triggers, doctor honesty, test suite (3,242 pass) |
| **PARTIAL** | Voice (needs external binaries; v2 flags gated), computer control (OS-tool dependent), 11 legacy skills without manifests, MCP exposure in dashboard vs npm drift, business layer mid-migration (CLI moved to satellite; `core/business-l0.ts` + `business.routes.ts` still in core daemon) |
| **DEAD** | `src/state/store.ts` (deprecated shim), `runAgent` alias (scheduled 2.0.0), satellite shims (scheduled 2.0.0), `docs/release/{3.1.6,7.0.1}` frozen records (intentional), empty-ish `src/templates` only holds workflow JSON (live, not dead) |
| **DUPLICATED** | Brand marks: painterly PNG logo vs flat geometric SVG (two visual identities); dashboard client-*.ts panels overlap CLI capabilities 1:1 (parallel UI logic over same API); business views in daemon + satellite |
| **OVER-COMPLICATED** | Dashboard IA: 23 panels behind 11 nav items = admin cockpit; constitution-scale governance overhead (30+ CI gates) is impressive but taxes every change |
| **UNDER-DESIGNED** | Project/workspace UX (workspaces exist but no project-aware editor/files/terminal experience), onboarding (CLI wizard only), runs/history UX (list-only), skills discovery UX (CLI list), no command palette parity in desktop sense |
| **UNSAFE** | Nothing critical found default-on; secrets via OS keyring; token-gated loopback daemon. Residual risks are ecosystem-class (MCP/tool poisoning) — see Security Audit |
| **FRAGILE** | Windows child-process approval tests historically hung (git log: win32 skips + watchdogs); TUI startup spinner loops boot/link/sync text (cosmetic); single-maintainer release bus |

## 5. Runtime exercise log (2026-09-17, linux/x64, Bun 1.4.2)

| # | Action | Result |
|---|---|---|
| R1 | `bun install` | OK, 52 packages, 263 ms |
| R2 | `xr --version` / `help` | OK — "v1.0.0 (Truth)"; full verb tree |
| R3 | `xr doctor` | OK — honest warnings (no local runtime, voice tools missing, desktop-control tools missing); provider health matrix; audit chain intact |
| R4 | `xr status/workspace/skills/mcp/plugins/memory/audit/capabilities/providers/triggers/execution list` | All OK |
| R5 | `xr serve` | OK — loopback bind, token printed, cookie session, 401 JSON without token |
| R6 | Dashboard GET (cookie) | OK — 106 KB single-page Control Center, 23 panels, palette hint, keyboard map |
| R7 | TUI `xr shell` under pty | OK — startup workspace picker, status pipeline animation |
| R8 | `bun test` (full) | **3,242 pass / 19 skip / 0 fail**, 15,084 expects, 148 s |
| R9 | OpenAPI sync check | OK — `docs/api/openapi.json` matches live registry (129 ops) |

### Failure / defect log

| ID | Area | Repro | Expected | Actual | Root cause | Source | Sev | Phase |
|---|---|---|---|---|---|---|---|---|
| BUG-001 | npm/release | `npm pack @rrrtx/xr@1.0.0` vs repo main | tarball == repo src | tarball lacks `src/daemon/routes/mcp.routes.ts`; tarball OpenAPI 120 paths vs repo 126 | publish cut predates MCP daemon routes; no repo↔tarball invariant gate | `src/daemon/routes/mcp.routes.ts` | HIGH (npm consumers of daemon MCP API) | P1 |
| BUG-002 | brand/assets | view `assets/logo.png` vs `assets/logo.svg` | one mark, many renditions | two different marks (3D metallic X+orb+wordmark vs flat geometric X-in-rounded-rect) | SVG simplification diverged from PNG identity | `assets/*` | MED (brand coherence) | P2 |
| BUG-003 | docs/release | package.json `homepage` = xr-gules.vercel.app while `website/` Next.js app exists in repo | single canonical home | two web presences | historical deploy vs in-repo site | `package.json`, `website/` | LOW | P3 |
| ENV-001 | voice | `xr doctor` | optional warn | ffmpeg/whisper/piper absent → voice disabled | environment, not code | — | INFO | — |
| ENV-002 | computer control | `xr doctor` | optional warn | xdotool/wmctrl absent | environment | — | INFO | — |
| OBS-001 | tests/win32 | CI history | green win32 | approvals-durable child-process tests skipped on win32 (pipe hang) w/ watchdogs | platform pipe semantics | `test/…approvals-durable` | MED | P2 |

## 6. Verdict

XR's **backend/runtime is unusually strong**: one execution spine, fail-closed trust, tamper-evident audit, spend governance, durable execution, and a test culture that enforces its own constitution. The **user-facing layer is the weak half**: an admin-style web Control Center, a capable but terminal-bound TUI, list-only histories, and no project/workspace/editor/voice-first experience. The rebuild should therefore **wrap, not replace**: keep XR Core + daemon as the trusted engine; build XR Desktop as a new workstation experience over the existing 129-op local API. [RECOMMENDED]
