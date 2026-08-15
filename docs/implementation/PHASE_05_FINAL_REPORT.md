# PHASE 05 — FINAL REPORT · Chat Streaming / Failure-Resilient Generation

**Date:** 2026-08-16 · **Repo:** github.com/ahmadrrrtx/xr

---

## 1. Baseline commit
`543990b` — Merge PR #62 (Phase 04 Provider Gateway / Universal Provider Engine)

## 2. Phase 04 commit
`a7fcf49` (feat(provider): Phase 04 Provider Gateway) — merged at `543990b`

## 3. Phase 05 commit
`9db437c` — feat(chat): Phase 05 — chat streaming / failure-resilient generation

## 4. Architecture before
The chat route was an HTTP adapter over the canonical AgentService, but the
agent loop called `provider.chat()` (non-streaming). Only `say()` observation
lines reached the SSE stream (`{text}`). No token events, no structured tool
events, no event ids, no stream-level TTFT. `withTurnMetrics` wrapped `chat()`
only and silently dropped `chatStream()`, so the canonical path could not
stream even though the adapters had streaming.

## 5. Architecture after
Loop → `runModelTurn()` prefers `provider.chatStream()`; real token deltas are
surfaced as `{type:"token"}` events via `AgentDeps.onStreamEvent`, forwarded
through the envelope / AgentService / AgentExecutor to the chat route. The
route serializes the canonical `ChatStreamEvent` contract to SSE with monotonic
`event_id`, opens immediately (ack = `provider_selection`), and emits a single
terminal `done` frame carrying `fullText` then exactly one `[DONE]`.

## 6. Stream protocol
`data: <json>\n\n` frames, JSON-valid, flushed promptly, `[DONE]` exactly once.
Each frame has a monotonic `event_id`. Backward-compatible legacy fields
(`text`, `done`, `error`, `finalMessage`, `cancelled`) retained.

## 7. Provider health behavior
Bounded `HEALTH_BOUND_MS = 2500ms` per provider, cached + deduplicated
(Phase 01/04 canonical architecture). Pre-flight races primary → fallback each
at 2500ms; 503 only if the whole chain is down, **before** the stream opens.
No unbounded health wait; no 16.5s → 503 regression.

## 8. Fallback behavior
Phase 04 ProviderGateway chain (primary → fallbackProvider → best local healthy
runtime). Bounded, deterministic, policy-aware, auditable, capability-aware.
Not attempted for non-retryable failures or cancellation.

## 9. Retry behavior
Structured `ProviderError` classification. Retryable: network/timeout/
unavailable/overload/rate-limit. Non-retryable: auth/invalid_request/
model_unavailable/unsupported_capability/policy. Bounded (≤ one extra attempt
across the chain).

## 10. Cancellation behavior
`ReadableStream.cancel()` → `runController.abort()` → run signal →
`guardedRequest` aborts the provider fetch. Loop ends `stopped:"cancelled"`.
No tokens after cancellation; no hanging promises.

## 11. Tool-call behavior
Observable state machine: `tool_call` before execution, `tool_result`
(ok/error) after — including denied/unavailable tools. Partial tool failure
does not kill the stream. Execution stays in the existing fabric (registry,
policy, approval, trust); provider tool calls are never executed directly.

## 12. Security results
- No API keys / provider headers in SSE or stream errors (redaction verified).
- Tool output framed as DATA (`frameToolOutput`) and flagged; prompt-injection
  test passes.
- Policy authoritative; cancellation cannot bypass audit/policy; fallback
  cannot bypass provider policy.

## 13. TTFT measurements (benchmark, `scripts/benchmark-ttft.ts`, samples=20)
| metric | p50 | p95 | min | max |
| --- | --- | --- | --- | --- |
| acknowledgement | 0.2ms | 0.4ms | 0.2ms | 4.9ms |
| TTFT end-to-end | 80.7ms | 81.3ms | 80.6ms | 85.1ms |
| **TTFT XR overhead** | **0.7ms** | **1.3ms** | 0.6ms | 5.1ms |
| total latency | 143.6ms | 145.1ms | 142.3ms | 149.8ms |

XR adds ~0.7ms (p50) of its own waiting before the first provider token. The
80ms end-to-end is the simulated provider's own first-token latency — XR does
not add the provider's latency to its overhead.

## 14. p50 / p95
See table above.

## 15. Failure benchmarks
- Unbounded health wait: eliminated (2500ms bound). No `16.5s → 503`.
- Primary unavailable → fallback: verified via gateway `executeWithFallback`
  (retryable primary → fallback succeeds; `attempted` recorded).
- Non-retryable auth failure → no fallback (verified).
- Cancellation → no fallback (verified).

## 16. Test results
Full suite after Phase 05 commit:
- **3138 pass · 19 skip (live/axe/powershell, environment-gated) · 0 fail**
- New: `test/api/chat-stream.test.ts` (14 pass) — token ordering, TTFT/fullText,
  tool_call/tool_result, tool failure, cancellation, DATA framing, retry
  classification, SSE immediate-open, single `[DONE]`, truthful errors.
- New: `test/providers/gateway.test.ts` Phase 05 fallback execution (3 pass).
- `bun run typecheck`: PASS · `bun run boundaries`: PASS · `api:schema:check`,
  `client:check`, `api:compat`: PASS (108 operations, no breaking changes).

## 17. Golden task results
Executed via deterministic mock providers at both the loop and route level:
ack → provider selection → streaming token events → tool_call → policy-checked
tool execution → tool_result → continue generation → done → `[DONE]`, plus the
primary-unavailable → fallback path and mid-stream cancellation abort. A **live**
provider golden run was not possible in this sandbox (no provider credentials),
so the live-provider leg is covered by mocks and remains the deferred
validation step for a credentialed environment.

## 18. Compatibility
- Final `done` frame contains `fullText` → legacy consumers work.
- Existing chat consumers, provider config, audit, memory, checkpoints intact.
- API contract / typed client / compat checks pass.
- Phase 03 chat-route test unchanged and green.

## 19. Reconnect / resume status
**Deferred (documented, not faked).** Monotonic `event_id` per frame is in
place (resume foundation); actual `Last-Event-ID` token-stream resume is not
safe without duplicating tool execution and is explicitly deferred.

## 20. Remaining issues
- Live-provider golden validation not run (no credentials in sandbox).
- Streaming loop model-turn is not yet routed through
  `ProviderGateway.executeWithFallback` (fallback is verified at the gateway /
  provider boundary, not inside the loop's turn).

## 21. Deferred work
- SSE `id:`/`Last-Event-ID` resume.
- Dashboard live approval-upgrade UI (HTTP dangerous tools still deny by default).
- Loop-level streaming fallback via gateway.

## 22. Final verdict
**GREEN** for every item verifiable in this environment, with the live-provider
golden leg and resume explicitly deferred (honest, not claimed). No previous
phase regressed; all new Phase 05 behavior is measured and tested.
