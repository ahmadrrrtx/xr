# Phase 14 — Real LLM integration: build plan

Principle: the desktop renders engine truth and forwards decisions. No mock
`setTimeout` on the production chat path; every failure state is a real one.

## Files

| Area | File | Role |
| --- | --- | --- |
| engine | `src/services/config-service.ts`, `src/daemon/agent-executor.ts` | per-run config reload |
| engine | `src/intelligence/catalog.ts` | config-named local models visible to the router |
| engine | `src/daemon/routes/chat.routes.ts`, `src/daemon/server.ts` | SSE keepalive, 120 s idle |
| engine | `src/intelligence/degradation.ts`, `src/intelligence/routing-service.ts` | `chatStream()` on both fallback wrappers |
| engine | `src/core/agent.ts` | empty-turn retry without tools (ask/plan), matching tool ids |
| engine | `src/tools/files.ts` | honest `write_file` arg errors |
| engine tests | `test/intelligence/stream-wrappers.test.ts` | wrappers stream, fail over only before output, abort propagates; ids match |
| dev | `desktop/vite.config.ts` | `/api` proxy → engine; token from `XR_DEV_TOKEN` / `XR_DEV_TOKEN_FILE` (read per request); loopback by default, pairing when exposed |
| transport | `desktop/src/engine/transport.ts` | endpoint resolution (Tauri `engine_link` → sidecar; else `/api/v1`), `engineFetch`, `EngineDown`, `EngineHttpError` |
| transport | `desktop/src/engine/sse.ts` | SSE parser (skips `:` comments, `[DONE]`), `readSse(response, onFrame, signal)` |
| transport | `desktop/src/engine/types.ts` | wire types for chat events, models, providers, budget, approvals |
| chat | `desktop/src/engine/envelope.ts` | progressive `{"message": …}` decoder for envelope providers |
| chat | `desktop/src/engine/approvals.ts` | `approval_required` → `ApprovalRequest` → modal → `POST /approvals/:id/decision`; `listPending()` |
| chat | `desktop/src/engine/chat.ts` | `streamEngineChat(opts)` — engine events → `StreamEvent`, budget gate + engine cap + usage recording |
| chat | `desktop/src/lib/llm.ts` | single `streamChat()` entry: engine, or mock behind `xr.dev.mockLLM` (DEV only) |
| state | `desktop/src/stores/engineStore.ts` | link status + health polling, providers/models catalogue, `selectModel()`, `lastError`, `restart()` |
| state | `desktop/src/stores/chatStore.ts` | real provider call; `mode`; `runId`/`usage`/`status` on the streaming turn; honest error kinds |
| ui | `desktop/src/components/engine/EngineDownBanner.tsx` | "Engine not running" · Retry · Start engine (dev) / Restart (packaged) · Diagnostics |
| ui | `desktop/src/screens/Chat/components/{Composer,ModelPicker,MessageBubble,MessageList,ToolCallCard,ChatHeader,ModeSwitch}.tsx` | mode segmented, status line, counters, engine-backed picker, error cards, durations |
| ui | `desktop/src/components/palette/CommandPalette.tsx` | quick-ask → engine `mode:'ask'`, "Open in chat", "Switch model…" |
| ui | `desktop/src/screens/Workspaces/index.tsx` | Workbench chat → real stream (agent mode, workspace context) |
| ui | `desktop/src/stores/brainStore.ts`, `screens/Brain`, `screens/Runs` | real run from the engine when a provider is configured; demo labelled otherwise |
| ui | `desktop/src/screens/Budget`, `budget/api.ts` | counters from `/api/v1/budget`; caps mirrored to `/api/v1/budget/set` |
| ui | `desktop/src/screens/Shield` | audit rows from `/api/v1/audit`; pending approvals from `/api/v1/approvals` |
| ui | `desktop/src/screens/Settings/tabs/ModelsTab.tsx`, `lib/settingsApi.ts` | key save → `onboarding/provider`; ping → `models/test`; Ollama list / install CTA |
| ui | `desktop/src/screens/Diagnostics` (Settings tab) | Engine card: version, uptime, provider health, last error, logs tail |
| shell | `desktop/src-tauri/src/engine_state.rs` (port), `desktop/src-tauri/src/commands/engine.rs` | spawn `xr-engine-<triple> serve --port 0`, banner parse, `engine_link`, `engine_restart`, `engine_logs_tail` |
| shell | `desktop/src-tauri/tauri.conf.json`, `capabilities/default.json` | `bundle.externalBin`, CSP `connect-src http://127.0.0.1:*`, shell scope |

## Steps

1. Engine fixes (done) + wrapper tests.
2. Vite proxy + `engine/transport.ts` + `engine/sse.ts` + `engineStore` health polling → EngineDownBanner in the app shell (composer disabled while down).
3. `engine/chat.ts` + `lib/llm.ts`; chatStore on the real stream; status line, Stop aborts the fetch; `done`/`error` mapping; token/cost counters.
4. Approvals bridge (modal fires from the engine, decision posted, denied → red card, abort withdraws).
5. Mode switch (Ask/Agent/Plan, default agent) persisted per session (`xr.chat.mode.<id>`).
6. Model picker from `/api/v1/models` + `/providers` (Local/Cloud groups, no-key rows disabled, "Set default" → `models/select`/`providers/set`).
7. Budget: local gate + `budget` cap on the request; `status budget_stopped` → blocked card; Budget screen counters from the engine.
8. HUD quick-ask real + "Open in chat"; cmdk "New chat" / "Switch model…" / "Open Chat"; Orb follows stream.
9. Workbench chat real (agent mode + workspace path hint).
10. Brain: real run spans from the SSE (status/tool events) when a provider is configured; Runs rows from the engine's recent runs (fallback local).
11. Shield audit from `/api/v1/audit`; Bell/Shield pending from `/api/v1/approvals`.
12. Provider setup: key save/ping/Ollama list; onboarding model choice sets the engine default.
13. Rust sidecar lifecycle + externalBin + CSP; Diagnostics Engine card; `scripts/compile-sidecar.ts` unchanged (document signing caveats).
14. Cross-surface + shortcuts + a11y + reduced motion; themes pass.
15. Tests (bun: engine wrappers, sse parser, envelope decoder, event mapper; desktop lint/tsc), screenshots, self-audit, PR.

## Honest-error matrix

| Condition | Where detected | UI |
| --- | --- | --- |
| engine unreachable | `EngineDown` from transport / health poll | banner (Retry · Start/Restart · Diagnostics), composer disabled, no send |
| no provider | pre-stream 503 `Provider offline` | assistant-side card "No AI provider configured. Add an API key or install Ollama to chat." + CTAs; nothing fabricated |
| auth | 401 | card "Engine rejected the session token" + Restart |
| lane busy / rate limit | 429 `{retryable}` | card with Retry (backoff hint) |
| budget | local gate denial or `status budget_stopped` / `done.stopped==='budget'` | inline blocked card + "Raise limit" |
| approval denied / expired | `tool_result{ok:false}` after `approval_required` | red denied tool card |
| model error | `error{code}` / `done.stopped==='error'` | error card, Retry when `retryable` |
| stream cut | reader ends without `done` | partial kept + "[Interrupted — retry]" |
| cancelled | user Stop (fetch abort) | partial kept, status cancelled |

## Step outcomes

| Step | Outcome |
| --- | --- |
| 1 | Engine fixes 1–7 shipped (`04ee15e`); wrapper tests + `boundedHistory` test. |
| 2 | Proxy + transport + SSE + `engineStore` (15 s poll) + banner; composer (Send + textarea) disabled while down. |
| 3 | `engine/chat.ts` → `lib/llm.ts#streamChat`; rAF-batched tokens; Stop aborts the fetch (reader closed); `done.fullText` authoritative; counters live (Ollama reports no usage → "— tok", honest). |
| 4 | Approvals bridge: modal from `approval_required`, decision `POST /approvals/:id/decision`, TTL/deny → red card, abort withdraws; Bell + Shield list `GET /approvals` (5 s). |
| 5 | Ask/Agent/Plan segmented, default agent, persisted per session. |
| 6 | Picker from `/models` + `/providers` (Local/Cloud, no-key rows disabled → Configure API key, Set default → engine). Default model from the engine (`resolveDefaultModel`). |
| 7 | Local gate + `budget.perTaskUsd` on the request; `budget_stopped` → blocked card + Raise limit; Budget screen ledger card from `/budget`. |
| 8 | HUD quick-ask real (`mode:'ask'`) + Open in chat; cmdk New chat / Switch model… / Open Chat; orb follows stream; orb click focuses composer. |
| 9 | Workbench → `/chat?workspace=:id` with workspace context chip, agent mode. |
| 10 | Brain: engine runs recorded from the SSE (`dash_` runIds); demo labelled "Demo run (no model configured)"; Runs rows from the engine when up. |
| 11 | Shield audit from `/audit` (engine verifies its own chain); pending approvals synced. |
| 12 | Keys saved by the engine (secret broker, `setDefault` opt-in); ping through `/models/test`; Ollama list / Install CTA; onboarding choice sets the engine default. |
| 13 | Rust: spawn/banner/`engine_link`/`engine_restart`/`engine_logs_tail`, externalBin + CSP, Diagnostics Engine card; `compile-sidecar.ts --if-missing`; signing documented, not wired. |
| 14 | Shortcuts (Enter/Shift+Enter/Esc/⌘N/⌘⇧O/ArrowUp/⌘K/`/`), focus rings, aria-live throttled, reduced motion static cursor; 5 themes checked (XR Native, Paper screenshots). |
| 15 | Tests `test/desktop/*` (9 files) + `test/core/bounded-history`; eslint/tsc clean; screenshots below; PR. |
| + | Found during testing: SIGTERM'd engine lingered → Start engine no-op (`cabb7cc`). |

## Screenshots (`previews/implementation/phase-14/`)

`chat-real.png` (reference mock, generated before coding) · `01-picker` ·
`02-waiting` ("Waiting for qwen2.5:0.5b…") · `03-done` (markdown reply) ·
`04-followup` · `05-approval` (modal fired by the engine) · `06-tool-done` ·
`07-tool-expanded` · `08-chat-trace` (View trace → Brain) · `10-brain-index` ·
`11-brain-live` · `12-brain-done` · `14-runs` · `20-diagnostics` (Engine card) ·
`21-shield-audit` · `22-shield-audit-engine-row` · `23-budget-ledger` ·
`30-chat-paper-waiting` · `31-chat-paper-done` (Paper theme) ·
`32-topbar-model-chip` · `33-hud-quick-ask` · `35-engine-down` ·
`36-engine-back` · `37-no-provider` · `38-workspace-landing` ·
`39-workbench-waiting` · `40-workbench-chat`.
