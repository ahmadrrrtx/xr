# XR — BUG REGISTER (verified, with reproduction)

Every bug below was **reproduced in a clean environment** during this audit unless marked "code-verified". Environment: Linux x64 · Bun 1.4.2 · Node 20 · repo @ v1.0.0 · @rrrtx/xr@1.0.0 from npm.

Severity: **P0** catastrophic · **P1** critical · **P2** important · **P3** polish.

---

## P0-1 · npm CLI is dead on machines without Bun

- **FILE:** `bin/xr` (shebang `#!/usr/bin/env bun`); `package.json` (`"bin": {"xr": "./bin/xr"}`)
- **FUNCTION:** `bin/xr main()` — imports `../src/cli/router.ts` (TypeScript) in-process
- **ROOT CAUSE:** npm symlinks `bin/xr` directly. Its interpreter is `env bun`, and even if it ran under Node, Node cannot import `.ts`. The Node-safe fallback `bin/xr.cjs` (friendly "XR requires Bun" message) is never linked. `engines: { bun: ">=1.3.0" }` is not an engine npm checks.
- **USER IMPACT:** `npm i -g @rrrtx/xr` — the README's first install row — fails on every Node-only machine with `env: 'bun': No such file or directory` (exit 127). No guidance, no install hint.
- **SEVERITY:** P0
- **REPRODUCTION:**
  ```bash
  npm i -g @rrrtx/xr          # on a machine without bun
  xr --version
  # env: 'bun': No such file or directory   (exit 127)
  ```
- **PROPOSED FIX:** Point `bin.xr` at `bin/xr.cjs`; keep `xr.cjs` as the real launcher (locate bun → run; else print one-line install: `curl -fsSL https://bun.sh/install | bash` and exit 127). Better: publish per-platform compiled binaries via `optionalDependencies` (`@rrrtx/xr-linux-x64` etc.) so no runtime is required at all.

---

## P0-2 · `--yes` does not approve tool calls; runs then report success while doing nothing

- **FILE:** `src/services/agent-service.ts` (policy.approve), `src/control/approval-store.ts:542` (`makeApprover`), `src/interfaces/cli.ts` (`confirm`)
- **FUNCTION:** `makeApprover()` → `options.prompt` → `confirm(msg, false)` — non-TTY `confirm` returns default `false` instantly
- **ROOT CAUSE:** `flags.yes` (re-threaded at `src/cli/router.ts:114`) is never consulted by the CLI approver. There is no assume-yes path through the durable approval store.
- **USER IMPACT:** Headless/CI usage (`xr --yes "task"`) auto-**denies** every consequential tool call, then prints `✓ done in N step(s)` and exits 0. Silent no-op success — precisely what XR's own "no success without effect" commandment forbids. Also misleads via "(auto-deny in 300s)" text that actually denies instantly in non-TTY.
- **SEVERITY:** P0
- **REPRODUCTION (mock provider):** `xr --yes "write the file"` → step line shows `⚙ write_file(...)`, approval block renders, `✗ write denied by user`, run ends `✓ done in 2 step(s)`, exit 0, no file created.
- **PROPOSED FIX:** Add `assumeYes` to `ApproverSurfaceOptions`; decide immediately with `channel: "assume_yes"` (audited); respect risk-tier floors (tier2+ still requires typed confirm or explicit config); fix TTL copy for non-interactive surfaces.

---

## P1-1 · Built-in tools never pass `args` to approvals → previews show "(no path in args)"

- **FILE:** `src/tools/files.ts:80` (write_file), `src/tools/system.ts:60` (delete_file), `src/tools/system.ts:111` (shell)
- **FUNCTION:** `ctx.approve({ tool, reason, preview })` — `args` omitted at every call site
- **ROOT CAUSE:** `ApprovalRequest.args` and the store's `argsHash` were designed (F-11/F-26) but built-ins were never wired. `buildStructuredPreview` (`src/control/preview.ts:214`) receives `undefined`, renders the empty-args fallback.
- **USER IMPACT:** The security-critical moment — human consent — shows "(no path in args)" and "(no content field — args redacted)" **directly under a step line printing the full raw args**. Durable approvals record `argsHash: "sha256:none"`, so remembered approvals cannot bind to argument hashes.
- **SEVERITY:** P1 (security-UX)
- **REPRODUCTION:** Any agent run that triggers `write_file` approval (see AUDIT.md mock setup) — the approval block renders the fallback text every time.
- **PROPOSED FIX:** Pass `args` at all three call sites (and audit every other `ctx.approve` caller); add a meta-test iterating the tool registry asserting `args` present for every `requiresApproval` tool; add an integration test asserting a rendered diff for a known write.

---

## P1-2 · Custom providers are priced $0 → spend meter and USD budget unenforceable

- **FILE:** `src/cost/pricing.ts:131` — `priceFor()`: `if (!rules) return FREE; // unknown provider → assume free in the meter`
- **FUNCTION:** `priceFor(providerId, model)`
- **ROOT CAUSE:** Unknown provider IDs (all custom OpenAI-compatible endpoints) fall through to `FREE`. `isLocal()` also only knows `"ollama"`, yet the meter printed "local · $0" for a custom provider serving `gpt-4o-mini`.
- **USER IMPACT:** Users pointing XR at paid gateways (proxies, Azure-style endpoints) see $0 spend; the "cannot overspend" guarantee is void exactly where users bring their own paid endpoints.
- **SEVERITY:** P1
- **REPRODUCTION:** Register custom provider → set model `gpt-4o-mini` → run a task: banner shows `💰 1.5k tok (local · $0) / $0.0005 cap`; 3,000 tokens metered $0.0000; cap never triggers.
- **PROPOSED FIX:** Custom-provider schema gains optional pricing (`inPerMTok/outPerMTok`); when absent, try model-name pricing across a merged table and mark estimates; budget checks must **fail closed** (or warn-and-stop) on "unpriced but non-local" providers rather than $0.

---

## P1-3 · Unknown flags are silently absorbed into the task prompt; token cap unreachable

- **FILE:** `src/cli/flags.ts` (no unknown-flag rejection), `src/commands/run-agent.ts` (`--max-tokens` parsed but absent from `xr --help`), `src/commands/triggers.ts:95` (only consumer of `--budget-tokens`)
- **FUNCTION:** global arg → task-text assembly in the CLI router
- **ROOT CAUSE:** The parser never rejects `--unknown`; the raw token is concatenated into the prompt. The documented global flags (`xr --help`) include `--budget <usd>` but no token flag; `--max-tokens` exists only in `xr run`'s usage string.
- **USER IMPACT:** Typos silently mutate prompts (session title literally became "1600 write the file and run…"); the README's "token ceiling checked during the loop" cannot be set from the documented surface for one-shots.
- **SEVERITY:** P1
- **REPRODUCTION:** `xr --budget-tokens 1600 "do x"` → `xr session list` shows title `1600 do x`; `xr --frobnicate hello` runs "hello" with no warning.
- **PROPOSED FIX:** Unknown `--flag` → exit 2 with did-you-mean; promote `--max-tokens` to the documented global set; strip recognized flags from title derivation.

---

## P1-4 · Three model-routing sources of truth contradict on a fresh install

- **FILE:** `src/config/config.ts` (defaults `provider: openai`, `providerEngine.routingStrategy` default `"hybrid"`), `src/intelligence/router.ts` (`policyFromConfig`), `src/local/*`
- **FUNCTION:** routing decision assembly (defaults vs localModels vs intelligence plane)
- **ROOT CAUSE:** With `routingStrategy: "hybrid"` (the default), the intelligence router overrides `defaults.provider` and prefers local runtimes; `xr status` and the dashboard header still display `defaults.provider`.
- **USER IMPACT:** Fresh install simultaneously shows: status "openai / gpt-4o-mini", run banner "LM Studio (Local) → fallback Ollama (Local)", Models panel "ACTIVE LOCAL MODEL phi3:mini", Home bento "PROVIDER STATUS: ollama (Active Route)". Users cannot predict or control what runs. This is the #1 source of "XR feels confusing".
- **SEVERITY:** P1
- **REPRODUCTION:** Fresh HOME → `xr status` → `xr "hello"` → `xr serve` → compare the four surfaces.
- **PROPOSED FIX:** Single routing decision record (id, provider, model, strategy, why) persisted per workspace; every surface renders that record; `defaults.provider` either wins for `primary` strategy or is removed from display; `xr providers set` must visibly update all surfaces.

---

## P1-5 · Dashboard MCP panel is dead (404s swallowed)

- **FILE:** `src/daemon/dashboard/client-panels-b.ts:250` (`loadMcp`), `:266` (`registerMcp`); routes absent from `src/daemon/routes/registry.ts`
- **FUNCTION:** `loadMcp()` — `api("/api/mcp").catch(() => [])`
- **ROOT CAUSE:** The client calls `/api/mcp` and `/api/mcp/add`; no such daemon routes exist (only `skills.api` and `plugins.api` under extensions.routes). The `.catch(() => [])` converts 404 into "empty list".
- **USER IMPACT:** The MCP panel can never show registered servers (registered via `xr mcp add testserver stdio …` — verified present via CLI) and always shows "No Model Context Protocol connections registered." Adding a server from the dashboard fails.
- **SEVERITY:** P1
- **REPRODUCTION:** `xr serve` → open MCP panel (shows none) while `xr mcp list` shows 1 installed; `curl /api/mcp` → 404.
- **PROPOSED FIX:** Add `mcp.routes.ts` (GET list / POST add / DELETE remove / GET health) to the registry; remove the silent catch (surface load errors in-panel); contract test for every panel's fetches.

---

## P1-6 · Audit panel shows `ts: Invalid Date` on every entry

- **FILE:** `src/daemon/dashboard/client-panels-c.ts` — `loadAuditLog()` (~line 264)
- **FUNCTION:** `new Date(e.ts).toLocaleString()`
- **ROOT CAUSE:** The API returns `created_at`; the client reads `e.ts` → `new Date(undefined)` → "Invalid Date".
- **USER IMPACT:** The flagship "tamper-evident audit log" panel shows a broken timestamp on every row on every install.
- **SEVERITY:** P1 (visible in the flagship panel) / trivial fix
- **REPRODUCTION:** `xr serve` → Audit panel → every row `ts: Invalid Date`.
- **PROPOSED FIX:** `e.created_at`; add client↔API schema test.

---

## P1-7 · Dashboard fabricates / misrepresents data

- **FILE:** `src/daemon/dashboard/page-panels-b.ts:477` (Devices "Integrate Port" toast), `:513` (Webhooks "Listening"), Business CRM panel source (hardcoded metrics), bento matrix sources, Models local-runtime list
- **FUNCTION:** panel renderers
- **ROOT CAUSE:** Marketing/demo values embedded in server-rendered panels instead of API-driven data.
- **USER IMPACT:** Fresh install shows: Business CRM "12 pipelines · $4,850 invoices audited · 84 workflows triggered" (feature extracted to satellite); Webhooks "127.0.0.1:3141/api/webhook — Status: Listening" (no route exists; nothing listens); Home "MCP HEALTH: Healthy" (API 404s); "COMPUTER USE: Authorized · Jarvis permissions" (never authorized); Models panel lists Ollama at `http://127.0.0.1:1`, Jan/LocalAI at Ollama's port 11434.
- **SEVERITY:** P1 (product-honesty)
- **REPRODUCTION:** `xr serve` on a fresh HOME → visit Business, Webhooks, Home, Models panels.
- **PROPOSED FIX:** Delete or wire every non-API metric; per-PR lint rule that panel templates contain no numeric literals except version strings; "demo data" mode must be opt-in and labeled.

---

## P1-8 · Test suite writes into the user's real `~/.xr`

- **FILE:** `test/context/phase09-isolation.test.ts`, `test/security/secrets.test.ts`, plus others; preload `test/helpers/suite-tmp.ts` insufficient
- **FUNCTION:** `beforeEach` sets `process.env.XR_HOME` to a temp dir, but module-level initialization / leaked handles resolve the real home
- **ROOT CAUSE:** XR_HOME is resolved lazily *per call* in most modules, but some imported module state (workspace manager, secret memo/env writes, memory store handles) escapes the per-test override window.
- **USER IMPACT:** After `bun test` on a dev machine: phantom workspace `~/.xr/workspaces/phase09-b/` (with its own DB), sealed test keys `XR_TEST_LAUNCH_KEY` / `XR_TEST_OTHER` in the real `~/.xr/.env`, and a durable memory `WORKSPACE_A_SECRET` (visible in `xr memory list` and the dashboard Memory panel). "Local-first and private" is undermined; routing/health can be affected by phantom state.
- **SEVERITY:** P1
- **REPRODUCTION:** Fresh HOME → `bun test` → `ls ~/.xr/workspaces; cat ~/.xr/.env; xr memory list`.
- **PROPOSED FIX:** Hard isolation: `bunfig.toml` preload that, if `XR_TEST_HOME` is not set, re-exec's the test process with it set; or require explicit roots on all store constructors in test mode; sentinel test asserting `~/.xr` untouched after suite.

---

## P1-9 · Secret backend misreported + OS-backend keys still land on disk

- **FILE:** `src/security/secrets.ts:76` (`preferredSecretBackend()` — Linux → `"linux-secret-service"` unconditionally), `:323-331` (`setSecret` always `setFileSecret`), `src/install/system.ts:245` (status display)
- **FUNCTION:** `preferredSecretBackend()`, `setSecret()`
- **ROOT CAUSE:** The sync backend picker doesn't check `secret-tool` availability (the async one does); the sync write path always persists the AES-GCM file copy regardless of backend.
- **USER IMPACT:** `xr status` shows "✓ Secret store … linux-secret-service" on machines with no secret service; even on machines with one, every key also exists (encrypted with a local key) in `~/.xr/.env` — the "OS-backed storage preferred" header comment is not what the code does.
- **SEVERITY:** P1 (security honesty) / P2 (practical exposure: encrypted at rest with local key)
- **REPRODUCTION:** Headless Linux without secret-tool → `xr status` shows the false ✓; add a key → it appears in `~/.xr/.env`.
- **PROPOSED FIX:** Display via the async probe (or a cached probe result); when an OS backend is available, make the file copy opt-in ("recovery backup") or remove it; document the mirrored copy in status.

---

## P1-10 · npm version regression strands 3.x users

- **FILE:** npm registry metadata (release process), `release.manifest.json` ("deliberate semver rebaseline")
- **ROOT CAUSE:** Published 3.0.0–3.1.5 (July), then 1.0.0-beta.1/1.0.0 (Sept). `latest` = 1.0.0 < 3.1.5.
- **USER IMPACT:** Anyone on 3.1.5 cannot `npm update` to 1.0.0 (semver downgrade); two "stable" lines coexist; the npm README for 1.0.0 says "Public Beta" while GitHub says "Stable" for the same version (stamp drift post-publish).
- **SEVERITY:** P1 (release management)
- **REPRODUCTION:** `npm view @rrrtx/xr versions` + `dist-tags`.
- **PROPOSED FIX:** `npm deprecate @rrrtx/xr@3.0.0 … 3.1.5 "superseded by the 1.0.0 line"`; or resume ≥ 3.1.6 numbering; re-publish 1.0.1 so HEAD README and npm README agree.

---

## P1-11 · VS Code extension: wrong default port; "Ask XR" is a stub

- **FILE:** `extensions/vscode/package.json` (`xr.daemonUrl` default `http://127.0.0.1:7842`), `extensions/vscode/extension.js`
- **ROOT CAUSE:** Extension defaults to 7842 (the Docker port) while `xr serve` defaults to 3141 (verified live); `xr.ask` shows a message telling the user to use the terminal instead of calling the (working) `/api/v1/chat` endpoint.
- **USER IMPACT:** Out of the box the status bar shows "(daemon off)" while the daemon runs; the extension's main command does nothing.
- **SEVERITY:** P1
- **REPRODUCTION:** `xr serve` (default port) + install extension → "(daemon off)"; run "Ask XR about selection" → info message only.
- **PROPOSED FIX:** Default 3141 or read the daemon's state file under `~/.xr`; implement ask via `/api/v1/chat` (SSE verified working).

---

## P1-12 · Inconsistent exit codes

- **FILE:** `src/commands/ask-plan.ts` (ask path), `src/cli/router.ts`
- **ROOT CAUSE:** The `ask` command swallows provider errors (prints, returns OK); `run` propagates exit 1; unknown flags exit 0.
- **USER IMPACT:** Scripts cannot trust `xr ask` results.
- **SEVERITY:** P1
- **REPRODUCTION:** no reachable provider: `xr ask "q"; echo $?` → 0; `xr "q"; echo $?` → 1.
- **PROPOSED FIX:** Exit-code contract (OK=0, task-failed=1, usage=2, environment=3) + tests per command.

---

## P2 register (verified)

| ID | Bug | FILE / FUNCTION | Reproduction | Fix |
|---|---|---|---|---|
| P2-1 | `xr mcp add` dumps raw zod JSON error + useless "Retry" advice | `src/commands/mcp.ts` arg parsing | `xr mcp add x --cmd y` | Map zod issues to usage text; show correct syntax `xr mcp add <id> <stdio\|http\|sse> <url-or-command>` |
| P2-2 | Dashboard payload 1.34MB HTML (+~1.25MB inlined base64 brand PNGs) + 580KB CSS + 157KB JS; `/api/skills` 256KB, `/api/capabilities` 724KB | `src/daemon/dashboard/*` | `curl -s /?token=… \| wc -c` | External lazy-loaded assets, cache headers, gzip/brotli, paginate APIs |
| P2-3 | Dashboard chat defaults to `ask` mode (CLI default `agent`); MODE chip is subtle | `src/daemon/routes/chat.routes.ts:42,77` | New dashboard chat can't use tools | Default `agent` behind the existing approval gates, or a first-run mode explainer |
| P2-4 | Automation panel suggests non-existent `xr cron add` | `page-panels-b.ts` automation panel | Click: command errors "Unknown triggers command: add" | Show `xr triggers create` usage |
| P2-5 | `xr update` "updates" to itself: builds 98MB local binary, same version, reports success | `src/update/*` | `xr update` on repo checkout | Compare versions before building; honest "already at latest" |
| P2-6 | `xr status` output ⊂ `xr doctor` (two commands, one job) | `src/commands/doctor.ts` / status path | Run both | Merge into `doctor` with a `--quick` flag |
| P2-7 | Shell startup modal blocks on workspace pick every launch | `src/interfaces/shell/app.ts` startup view | Run `xr` (TUI) | Skip when only one workspace exists; remember last choice |
| P2-8 | Pricing table frozen at 2024 | `src/cost/pricing.ts` header | Read header | Move pricing to data file + update cadence; allow user overrides |
| P2-9 | Port identity: 3141 (serve) vs 7842 (Docker/VS Code/dashboard copy) | `Dockerfile`, `extensions/vscode`, `page-panels-b.ts` | Compare defaults | One default everywhere; document |
| P2-10 | `install.sh` home `~/.xr-agent` vs npm/CLI `~/.xr` | `install.sh:12` | Read TARGET_DIR | Unify or migrate |
| P2-11 | Session titles include swallowed flags ("1600 write the file…") | session title derivation | P1-3 repro | Sanitize titles |
| P2-12 | Chat placeholder renders as state: "Primary conversation thread · 0 messages · 1s ago" | `client-chat.ts` | Open chat panel | Real empty state |
| P2-13 | Budget panel shows routing chain as model name ("Ollama (Local) → fallback LM Studio (Local)") | budget panel renderer | Open Budget panel | Render model id, chain as subtitle |
| P2-14 | `removeSecret` deletes `process.env[name]` even with env-compat off | `src/security/secrets.ts` removeSecret | code-verified | Gate env mutation behind compat flag consistently |
| P2-15 | `tsconfig.json` excludes deleted `src/interfaces/tui2.ts` | `tsconfig.json` | Read file | Remove stale exclude |
| P2-16 | npm README says "Public Beta", repo README says "Stable" (same 1.0.0) | publish pipeline | Diff READMEs | Re-stamp + repatch |
| P2-17 | 483 doc files + 936KB brand PNGs shipped in npm package (18MB unpacked) | `package.json` files | `npm pack` listing | Ship only runtime docs (README, LICENSE, docs/cli subset); assets on demand |
| P2-18 | `~/.xr` audit chain flooded with meta events (startup_recovery, shield.scan per command) | audit event emitters | `xr audit tail` after light use | Classify system vs task events; filter default view |
| P2-19 | i18n = 12 strings × 4 languages | `src/i18n/strings.ts` | Read file | Either invest or remove the claim |
| P2-20 | Dashboard approvals panel shows "No pending authorizations" while a CLI-raised approval is pending | approvals panel + store wiring | Raise approval in one-shot run; open panel | Surface the durable approval store (it exists!) in the panel |

## P3 register (selected)

- Garbled block-glyph banner in many terminals; marketing tagline inside status output.
- "Jarvis permissions", "Dojo", "Bento Matrix", "⌁ CONTROL", "EDR" copy in a trust product.
- `xr help` advertises dead verbs ("xr business — MOVED…") as commands.
- 1,134 "Phase N" + 35 ADR references in runtime source comments.
- 456 markdown files in `docs/` (100+ historical) — includes 85–95KB `inventory.json` files; consider an archive branch.
- Providers panel renders the 26-provider dropdown twice (primary + fallback) as raw `<select>`s.
- "Voice Pipeline" panel is an honest placeholder ("the dashboard does not yet drive the audio pipeline") — fine, but then it should not be a top-level nav item.

---

## Things explicitly checked and found WORKING (regression guard for the rebuild)

- Approval **denial** is enforced in the execution path (denied write → no file, audited `write_file.denied`).
- `xr audit verify` / `--crypto` — chain + Ed25519 segments + signed head verified.
- Daemon auth: 401 without token; cookie exchange; bearer header; assets behind auth; evil-origin POST → 401/403.
- Files API path traversal blocked (`../../etc/passwd` → 400).
- `xr doctor` exits non-zero with a single clear next action when no provider is reachable.
- Dashboard chat SSE streaming end-to-end (status events, tokens, mode, run id) via `/api/v1/chat`.
- `xr triggers` (alias `cron`) list/pause/resume semantics; `xr mcp add … stdio …` registers; skills list (65) with health; plugin summary; `xr session show/export`; `xr run --resume` gives an honest unresumable error for pre-Phase-6 sessions.
- Full test suite: 3,241 pass / 0 fail / 132s. Typecheck: clean.
