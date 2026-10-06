# Phase 14 — Real LLM integration: study notes

## Environment reality (sandbox)

- 2 vCPU / 2 GB RAM / no GPU. Ollama v0.35.1 runs from `~/.cache/ollama-bin`
  with `qwen2.5:0.5b` (≈600 MB resident). `qwen3:0.6b` OOM-killed the runner
  (`model runner has unexpectedly stopped`) — anything ≥1 GB is out.
- Engine dev loop: `XR_HOME=~/.xr-dev bun run src/index.ts serve --port 3141`.
  The bearer token is random per boot and only printed in the banner
  (`Token: <48 hex>`); `XR_DAEMON_TOKEN` does **not** set it. Dev tooling must
  parse the banner (helper script writes it to `~/.xr-dev/token`).
- Cold TTFT on this CPU is 15–85 s (the agent system prompt is ~2 050 tokens;
  Ollama's prompt cache brings warm TTFT to ~200 ms). Tests use `-m 300`.
- Rust toolchain and playwright are not installed; the full Tauri crate is too
  heavy to compile here (Rust modules are checked in a scratch crate with a
  tauri shim, as in Phases 11–13).

## What the brief assumed vs. what the repo has

| Brief assumed | Reality (`main` @ `993bee8`) |
| --- | --- |
| `desktop/src/api/client.ts`, `boot.ts`, `Workbench.tsx`, `src-tauri/src/engine_state.rs`, externalBin sidecar | None exist. The old generation lived at commit `c61fc29` (`git show c61fc29:desktop/<path>`): `api/client.ts` (endpoint resolution via `engine_link` invoke → sidecar, else relative `/api/v1` through the Vite proxy), `vite.config.ts` (loopback-only proxy, pairing when exposed — SEC-DEV-01), `engine_state.rs` (banner parsing, stderr tail, probe cache), `lib.rs` (spawn with `serve --port 0`, W-1/W-2/W-5/W-6), `EngineDownBanner.tsx`. |
| `useChatStream` hook | Chat runs through `stores/chatStore.ts` → `lib/mockLLM.ts#streamChat` (`StreamOptions` contract, events `token/tool_call/tool_result/done/error/budget_*`). HUD quick-ask (`components/palette/CommandPalette.tsx`) and Brain "demo run" (`brainStore.startMockRun`) are also mock-driven. |
| Engine-side streaming "just works" | Four engine defects blocked real chat (below). |
| `scripts/compile-sidecar.ts` | Exists and is already run by `.github/workflows/desktop-app.yml` (per-OS), but `tauri.conf.json` has no `bundle.externalBin` and the shell never spawns it. |

## Engine wire (verified live, `POST /api/v1/chat`)

Body: `{message, mode:'agent'|'ask'|'plan' (default ask), stream:true, sessionId?, provider?, model?, budget? (perTaskUsd), maxTokens?, maxSteps?, toolsAllow?, toolsDeny?, history?:[{role,content}]}`.
Pre-stream HTTP errors (JSON `{error}`): 503 `Provider offline: …` (no provider),
429 `{error, retryable, lane}` (lane busy), 400 (bad body), 401 (token).

SSE frames are `data: {...,"event_id":n}` separated by blank lines, plus
`: keepalive` comment lines every 5 s (added this phase — parsers must skip
lines starting with `:`), and a final `data: [DONE]`.

| Frame | Shape | Desktop mapping |
| --- | --- | --- |
| first frame | `{acknowledged:true, runId, mode, type:'status', status:'provider_selection'}` | remember `runId` on the message |
| `status` | `{type:'status', status, provider?, model?, message?, runId?}` — vocabulary `preparing · provider_selection · provider_ready · generating · tool_running · compacting_context · awaiting_approval · budget_stopped · cancelled · finishing · done · error` | `provider_ready{model}` → "Waiting for {model}…"; `budget_stopped{message}` → inline blocked card; others → status line only |
| `token` | `{type:'token', text}` | append (rAF-batched) |
| `tool_call` | `{type:'tool_call', id, tool, args}` | new ToolCallRecord (status running) |
| `tool_result` | `{type:'tool_result', id, tool, ok, result?, error?}` | update by id (ids now match — see fixes) |
| `usage` | `{type:'usage', usage:{inTokens,outTokens}}` | live token counter |
| `approval_required` | `{approval_required:{id, tool, reason, args, riskTier, preview:{kind,tool,riskTier,untrustedReason,sections:[{title,body,kind,truncated?}]}, ttlMs}}` | `approvalStore.requestApproval()` with the **engine id**; decision → `POST /api/v1/approvals/:id/decision {approved}` (404 unknown, 409 already decided, TTL default-deny 300 s) |
| `error` | `{type:'error', code, message, retryable?, detail?}` — e.g. `turn.empty`, `GENERATION_FAILED` | error card (retry when `retryable`) |
| `done` | `{type:'done', fullText, finalMessage, usage?, finishReason, stopped:'done'|'error'|'budget'|'cancelled'|'max_steps', steps, ttftMs, totalMs}` | finalize; `stopped==='error'` is an error, `'budget'` blocked, `'max_steps'` partial |
| legacy `{text}` | `▸ think (step 1/12) · Ollama (Local) → fallback Jan (Local) · 💰 0 tok (local · $0) / $0.25 cap`, `✗ error: …`, `✗ write denied by user` | ignored (canonical typed events carry the same facts) |
| cancel | `{cancelled:true, type:'status', status:'cancelled'}` | the abort of the fetch is what cancels the run server-side |

Verified sequence for a real reply: `status provider_selection → provider_ready{provider:'ollama',model:'qwen2.5:0.5b'} → compacting_context → generating → token×N → usage → status finishing → done{finishReason:'done'}`.
Verified tool flow (agent mode): `tool_call{id:'tc_<session>_1', tool:'write_file', args}` → `status tool_running` → `approval_required{id:'ap_…'}` → (REST decision) → `tool_result{id:'tc_<session>_1', ok:false, result:'write denied by user'}` → next step.

### Envelope vs. native text

Local/weak profiles use the JSON **envelope protocol** (`{"message": …, "tool_calls": …}` in content, GBNF grammar on Ollama's native API); providers with `functionCalling:true` (Ollama via `/v1`, OpenAI, Anthropic…) get plain text + native tool calls. On the native path tokens are plain words. On the envelope path the raw stream is JSON — the engine's own dashboard appends raw tokens and replaces them with `done.fullText`. The desktop does the same (authoritative `fullText` on done) plus a conservative progressive decoder: when the accumulated text starts with `{` and `"message":"` has been seen, only the decoded string value is displayed.

## Engine defects found and fixed (all required for real chat)

1. **Stale kernel config.** `ConfigService` snapshotted `config.json` at boot, so `POST /api/v1/providers/set` / `models/select` (and the desktop picker) never changed what a run used. Fix: `ConfigService.reload()`, called by `agent-executor` on every `executeTask` and `preflight`.
2. **Catalog blind to configured local models.** `IntelligenceRouter.findModel()` fell back to the preset default (`qwen2.5:7b`) for any model not in the static catalog, so a configured `qwen2.5:0.5b` routed to a model that was not installed. Fix: `catalog.ts` adds config-named models (tag `config`) and includes them in the fingerprint.
3. **SSE closed at 10 s.** `Bun.serve` default `idleTimeout` killed the stream during a slow cold TTFT (HTTP 200 EOF, no `done`). Fix: `: keepalive` comments every 5 s (`chat.routes.ts`) + `idleTimeout: 120` (`server.ts`).
4. **No token streaming on the default path.** Both provider wrappers used on the default run path — `ResilientProvider` (`degradation.ts`) and the legacy `FallbackProvider` (`routing-service.ts`) — exposed only `chat()`, so `runModelTurn` fell back to the non-streaming path and the whole reply arrived as ONE `token` frame after the full generation. Fix: `chatStream()` on both, with the same failover rule as `chat()` (fail over only before any output; never after partial output; aborts propagate).
5. **Empty turns from tiny models.** With a tool catalog attached, `qwen2.5:0.5b` answers plain questions with a malformed tool call that Ollama discards → empty completion (24 tokens billed, zero delivered) → `turn.empty`. Reproduced identically on Ollama's `/v1` and `/api/chat`, stream and non-stream; without tools the same prompt yields a correct haiku. Fix (`agent.ts`): in `ask`/`plan` modes an empty turn with tools attached is retried once **without tools** (audited `turn.empty_retry`, status `generating{message}`); agent mode keeps the honest error because there the tools are the task.
6. **`tool_call`/`tool_result` ids differed** (`tc_1` vs `tc_<session>_<seq>`). Fix: `runModelTurn` mints ids with the run-scoped scheme.
7. **`write_file` with a missing path** crashed on `EISDIR` before the approval prompt (small models emit `{file,text}`). Fix: honest tool error naming the required args.

## Existing desktop seams to reuse

- `lib/mockLLM.ts#StreamOptions` / `StreamEvent` — keep the contract; `lib/llm.ts` becomes the single entry (`streamChat`) that routes to the engine transport (`engine/stream.ts`) and only to the mock behind an explicit dev flag (`localStorage xr.dev.mockLLM = '1'`, DEV builds only).
- `lib/approvalEvents.ts#makeApprovalGate(signal)` (modal ⇄ abort race, `withdrawRequest`), `approvalStore.requestApproval(req)`, `decideApproval`. Engine approvals reuse the same queue with the engine's id (`ap_…`) so the Bell/Shield/Modal all show the real request; the gate posts the decision to the engine.
- `stores/chatStore.ts` (`runGeneration`, `finishStream`, `commit`) — keep; swap the provider call, add `runId`/engine status to the streaming turn.
- `stores/budgetStore` + `budget/enforce.ts` (`budgetGate`, `recordSpend`) — the local governor keeps its pre-call gate (Phase 12/13 "Enforced" stays enforced in Rust) and now records the **engine-reported** usage.
- `paletteStore.{startQuickAsk,appendQuickAskToken,finishQuickAsk}` for the HUD quick-ask; `brainStore.startMockRun` / `runsStore` for Brain; `shield/api.ts` for audit.
- Theme tokens, `Avatar`, `StreamingCursor`, `ToolCallCard`, `BudgetBlockedCard` — unchanged.

## Config / secret reload

`POST /api/v1/onboarding/provider {providerId, apiKey, model?, probe?}` stores the key through the secret broker and returns `{ok, provider, model, secretBackend, health}`; `POST /api/v1/providers/set {provider, model?}` and `POST /api/v1/models/select {runtime, model, routing}` update `config.json`. With fix 1 the next run picks them up — no engine restart. `POST /api/v1/models/test {runtime, model}` is the "ping" (`{ok,status,result{ok,detail,latencyMs}}`).

## Sessions

Chat persistence stays in `lib/chat-db.ts` (SQLite in Tauri, localStorage mirror in the browser). The engine's `sessionId` is passed as the lane key (serialises runs per conversation; a busy lane answers 429 before the stream opens) and the engine `runId` is kept in message metadata for the Brain trace link.

## Ollama detection

`GET /api/v1/models` → `current{installed, running, healthy, models[]}` + `hardware{specs}` + `recommendation`; `GET /api/v1/providers` → per provider `{kind:'local'|'cloud', hasKey, authOk, healthy, latencyMs, defaultModel}`. The picker groups Local (Ollama models actually installed) and Cloud (providers with a key); cloud rows without a key are disabled → "Configure API key" → `/budget?tab=models`.

## Engine lifecycle (dev and packaged)

- **One spawn mechanism per mode.** Browser dev: Vite's `/__xr/engine/start`
  spawns `desktop/scripts/dev-engine.ts` (which runs `bun run src/index.ts serve
  --port 3141` and writes the banner token to `desktop/.xr-dev/token`, read per
  request by the proxy). Packaged: the Tauri shell spawns
  `xr-engine-<triple> serve --port 0 --parent-pid <shell>` and parses the
  banner (`✓ Listening on http://127.0.0.1:<port>` + `Token: <48 hex>`);
  `engine_link` hands the pair to the web layer. Nothing else spawns an engine.
- **SIGTERM must end the process.** Measured during the engine-kill test: after
  SIGTERM the daemon closed its listener but lingered (kernel timers kept the
  loop alive). The dev wrapper waits for the child, so Vite still saw a live
  child and answered "already running" to the banner's Start engine while the
  port stayed silent. Fixed on both sides: `src/cli/router.ts` schedules a
  bounded `process.exit` 2 s after SIGINT/SIGTERM (unref'd — a clean drain
  still exits on its own), `dev-engine.ts` escalates to SIGKILL after 3 s, and
  `/__xr/engine/start` probes `/health` before trusting a live child. The Rust
  side already did SIGTERM → 1.5 s → SIGKILL (`unix.rs::terminate_gracefully`).
- **Health poll cadence.** `engineStore` polls `/health` every 15 s and flips to
  `down` on the first failed request, so a killed engine shows the banner
  within ≤15 s (measured 15 s idle, immediate on the next send). Start engine
  → banner gone in 2 s (engine boot ≈1 s).

## Sidecar build and signing (packaged builds)

- `scripts/compile-sidecar.ts` → `desktop/src-tauri/binaries/xr-engine-<target-triple>`
  (`bun build --compile`); `tauri.conf.json` lists it under `bundle.externalBin`
  as `binaries/xr-engine` and `tauri-build` refuses to build when the file for
  the host triple is missing, so `dev:tauri` / `build:tauri` compile it first
  (`--if-missing` for dev). CI (`desktop-app.yml`) compiles per OS.
- **Signing caveats (not done in this phase):** macOS — the sidecar is a
  separate Mach-O inside the bundle; it must be signed with the same identity
  and hardened runtime as the app (`tauri build` signs `externalBin` when
  `APPLE_SIGNING_IDENTITY` is set, but notarization also needs the Bun-compiled
  binary to pass `codesign --verify --deep`; Bun's single-file executables are
  signable but carry an embedded zip-like payload that some notarization runs
  flag — verify before shipping). Windows — unsigned sidecars trigger
  SmartScreen separately from the installer; sign `xr-engine-x86_64-pc-windows-msvc.exe`
  with the same certificate. Linux — no signing; AppImage must mark the
  sidecar executable. None of this is wired into CI yet.

## Diagnostics "providers with API keys" is engine data

`GET /api/v1/providers` reports `hasKey:true` for local providers (no key
needed) and for providers whose credentials come from the environment (e.g.
`bedrock` via AWS env). So the Diagnostics Engine card can say "1 cloud with
credentials" on a machine with no stored key — that is what the engine
reports (the label says credentials, not API keys, for that reason).

## Verification log (sandbox, `qwen2.5:0.5b` on CPU)

Playwright scripts live outside the repo (`/home/user/shots/p14/*.py`); every
screenshot in `previews/implementation/phase-14/` was taken against the real
engine + Ollama. Console errors: only the expected 503s during the no-provider
step. Measured: cold TTFT 15–34 s, warm ≈0.2–2 s; engine-kill → banner 15 s;
Start engine → recovered 2 s; no-provider → honest card, zero fabricated
replies; approval modal fires from the engine (`ap_…` id) and the decision is
posted back. Budget: a local model costs $0, so a $0.01 per-task cap can never
trip on this machine; the same engine governor was exercised through its token
ceiling instead (`perTaskTokens: 100` → `status budget_stopped` → blocked card
with the engine's reason + Raise limit, `42-budget-blocked-engine.png`). The
USD ceiling takes the identical path (`governor.checkBeforeStep`). `qwen2.5:0.5b` frequently skips or malforms tool calls — the
tool cards then show the honest failed state (not a desktop defect).
