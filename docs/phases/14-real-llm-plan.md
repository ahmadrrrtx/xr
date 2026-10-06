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
