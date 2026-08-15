# PHASE 05 — Chat Streaming / Failure-Resilient Generation

**Commit:** `9db437c` · **Base:** `543990b` (Phase 04) · **Date:** 2026-08-16

Phase 05 turns XR chat from "send request → wait → fullText" into a
failure-resilient, cancellable, policy-governed **stream**:

```
request
  → immediate ack (= provider_selection status)
  → bounded health (2500ms)
  → streaming generation (real provider token deltas)
  → token events
  → tool_call / tool_result events (execution through the fabric)
  → usage
  → single terminal done event carrying fullText
  → exactly one [DONE]
```

All built **on top of** the Phase 04 ProviderGateway. No second provider
system, no second execution system, no second policy system, no second tool
system was created.

---

## 1. Architecture before

The chat route was an HTTP adapter over the canonical AgentService, but the
**agent loop called `provider.chat()` (non-streaming)** and the route only saw
`say()` observation lines. No token events, no structured tool events, no
per-event ids, no stream-level TTFT.

## 2. Architecture after

```
Chat route (SSE adapter)
   │  onStreamEvent + say
   ▼
AgentExecutor.runHeld
   ▼
AgentService.execute
   ▼
Execution envelope / Runner (runEnvelope)
   ▼
Agent loop (runAgentLoop)
   │  runModelTurn() → prefers provider.chatStream()
   │      └─ token deltas → {type:"token"} events
   │      └─ toolCalls     → {type:"tool_call"} events
   │  tool execution       → {type:"tool_result"} events
   ▼
Provider (resolved by ProviderService → ProviderGateway)
   ▼
Provider adapter (OpenAICompatProvider.chatStream → SSE)
```

## 3. Canonical stream event contract

Defined **once** in `src/core/types.ts` (`ChatStreamEvent`), produced by the
loop via `AgentDeps.onStreamEvent`, forwarded through the envelope
(`EnvelopeContext.onStreamEvent`) and `AgentService`, and serialized by the
route. The OpenAPI/typed-client contract (`ChatStreamEvent` in
`src/daemon/routes/schemas.ts`) documents the same shape.

```ts
type ChatStreamEvent =
  | { type: "status"; status: string; provider?: string; model?: string; message?: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; tool: string; args: unknown }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; result?: string; error?: string }
  | { type: "usage"; usage: { inTokens: number; outTokens: number } }
  | { type: "done"; fullText: string; usage?; finishReason?; steps; ttftMs?; totalMs? }
  | { type: "error"; code: string; message: string; retryable?: boolean; detail? };
```

**Backward compatibility:** every SSE frame is `data: <json>\n\n` terminated by
a single `data: [DONE]\n\n`. Each frame carries a monotonic `event_id`. The
legacy fields (`text`, `done`, `error`, `finalMessage`, `cancelled`) are
retained, so pre-Phase-05 consumers keep working; the terminal `done` frame
contains **both** `type:"done"` + `fullText` **and** the legacy `done:true` +
`finalMessage`.

## 4. SSE protocol

- Newline framing: each event is `data: <json>\n\n`.
- JSON is valid (all events built as objects, `JSON.stringify`).
- `[DONE]` is emitted **exactly once** (guarded by a `closed` flag).
- Events flushed promptly (each `controller.enqueue` is an independent frame).
- `event_id` is monotonic → ordering is guaranteed and resumable in principle.

## 5. Provider selection

The first SSE frame is the acknowledgement and doubles as the
`provider_selection` status event, so the client sees state the instant the
stream opens. The loop then emits `provider_ready` with the resolved provider
id before the first model turn.

## 6. Bounded health

Health is the Phase 01/04 canonical architecture: `checkProviderHealthCached`
bounded to `HEALTH_BOUND_MS = 2500ms` per provider, cached and deduplicated.
The daemon pre-flight races primary → fallback each at 2500ms and only 503s
before the stream if the whole chain is down. There is no unbounded health wait
and no `16.5s → 503` regression.

## 7. Fallback behavior

Fallback uses the Phase 04 ProviderGateway chain (primary → configured
fallbackProvider → best local healthy runtime) via
`ProviderGateway.executeWithFallback` / `fallback-chain.ts`. It is:

- **bounded** (per-step health at 2500ms),
- **deterministic** (documented precedence),
- **policy-aware** (`intelligencePlane.allowFallback`, `localityPolicy`),
- **auditable** (`attempted[]` + chain explanation),
- **capability-aware**.

Fallback is **not** attempted for non-retryable failures (invalid API key,
unsupported model, invalid request, policy refusal) or on cancellation.

## 8. Retry rules

Structured classification in `src/providers/errors.ts`:

- **Retryable:** network failure, timeout, unavailable, provider overload,
  rate limit.
- **Non-retryable:** auth failure, invalid request, model unavailable,
  unsupported capability, context length, content policy refusal.

Retry/fallback is bounded (≤ one extra attempt across the chain) and respects
cancellation and retry-after. A 2s failure never becomes a 2-minute failure.

## 9. Cancellation

The client dropping the stream triggers `ReadableStream.cancel()` →
`runController.abort()` → the run's `AbortSignal` → `guardedRequest` aborts the
provider fetch. The loop ends honestly as `stopped:"cancelled"`. No tokens are
emitted after cancellation (the route's `closed` flag + loop checkpoint
checks), and there are no hanging promises.

## 10. Tool-call loop (observable state machine)

```
GENERATING ──token──▶ GENERATING
   └──tool_call──▶ TOOL_PENDING → POLICY → DENIED → tool_result(ok:false)
                                          └─ APPROVED → EXECUTE → success
                                                             └─ failure → tool_result(ok:false)
   └──▶ GENERATING ... ──▶ DONE
```

Every state transition the user cares about is emitted: `tool_call` before
execution and `tool_result` (with `ok`, `result`/`error`) after — including for
denied/unavailable tools. Partial tool failure does **not** kill the stream;
the model can reason about the failure on the next turn.

Tool execution goes through the existing fabric: `ToolRegistry` /
`PolicyEngine` / `ApprovalGate` / Execution Fabric as the loop already does.
**Provider tool calls are never executed directly.**

## 11. Security boundary

- No API keys or provider headers appear in SSE events or stream errors
  (`normalizeProviderError` redacts secrets).
- **Tool output is DATA.** The loop frames tool output with
  `frameToolOutput()` before it reaches the model, so a prompt-injection-like
  tool result ("ignore previous instructions…") is delivered delimited as data
  and flagged — never spliced in as an instruction.
- Policy remains authoritative; cancellation cannot bypass audit/policy;
  fallback cannot bypass provider policy.

## 12. TTFT measurement

The route measures `requestStart → first token event` and reports it in the
`done` event (`ttftMs`) and as an `xr_chat_ttft_ms` histogram. The benchmark
(`scripts/benchmark-ttft.ts`) separates **XR overhead** from provider latency:

| metric | p50 | p95 |
| --- | --- | --- |
| acknowledgement | 0.2ms | 0.4ms |
| TTFT end-to-end | 80.7ms | 81.3ms |
| **TTFT XR overhead** | **0.7ms** | **1.3ms** |
| total latency | 143.6ms | 145.1ms |

(`samples=20`, simulated provider first-token = 80ms. XR adds ~nothing before
provider generation begins.)

## 13. Observability

New metrics (`src/observability/metrics.ts`):
`xr_chat_requests_total`, `xr_chat_stream_started_total`,
`xr_chat_stream_completed_total`, `xr_chat_stream_error_total`,
`xr_chat_stream_cancelled_total`, `xr_chat_fallback_total`,
`xr_chat_tool_calls_total`, `xr_chat_ttft_ms`. All low-cardinality, no sensitive
fields.

## 14. Reconnect / resume status

**Deferred (documented, not faked).** Each event carries a monotonic
`event_id` (the resume foundation), but the checkpoint architecture cannot
safely resume an already-started token stream without duplicating tool
execution, so resume is explicitly deferred rather than pretended. See the
final report's Deferred section.

## 15. Compatibility

- The final `done` frame still contains `fullText` → legacy consumers work.
- Existing chat consumers, provider config, audit, memory, checkpoints: intact.
- `api:schema:check`, `client:check`, `api:compat`: all pass (no breaking
  changes; the `ChatStreamEvent` schema was expanded additively).
- Existing `test/one-agent/chat-route.test.ts` (Phase 03) still passes.

## 16. Deferred work

- SSE `id:`/`Last-Event-ID` resume (token streams can't be resumed safely yet).
- Live approval-upgrade UI in the dashboard (dangerous tools still deny by
  default for HTTP).
- Wiring the loop's model-turn to `ProviderGateway.executeWithFallback` for
  streaming (currently fallback is exercised at the gateway/provider boundary;
  the loop uses the resolved provider).
