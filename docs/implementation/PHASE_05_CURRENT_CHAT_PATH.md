# PHASE 05 — Current Chat Execution Path (Forensic Audit)

**Date:** 2026-08-16 · **Repo:** github.com/ahmadrrrtx/xr · **Baseline:** `543990b` (Phase 04)

This document records the **ACTUAL** chat execution path present in the
repository at the start of Phase 05, before the Phase 05 changes. It is the
forensic "source of truth" that the Phase 05 implementation was built on top
of. It deliberately reflects the real code (which had already evolved well
beyond the naive `provider.chat()` → 503 path the Phase 05 brief assumed).

---

## 1. What the Phase 05 brief assumed

The brief described a path roughly like:

```
request → provider.health() → wait → provider.chat() → fullText → SSE
```

with an unbounded health wait, no fallback, no token events, no tool events,
and a `~16.5s → 503` failure signature.

## 2. What was actually in the repository (Phases 00–04 already fixed most of it)

By Phase 04 the canonical path had already been unified. The daemon chat route
is **an HTTP adapter over the one AgentService**, exactly as the brief demands:

```
Dashboard / CLI / TUI
      │
      ▼
Chat route  (src/daemon/routes/chat.routes.ts)   ← HTTP/SSE adapter only
      │
      ▼
AgentExecutor (src/daemon/agent-executor.ts)      ← preflight + lane + runHeld
      │
      ▼
AgentService.runTask → execute() (src/services/agent-service.ts)
      │
      ▼
Execution envelope  (src/core/execution/envelope.ts)
      │
      ▼
Runner  (src/core/execution/runner.ts → runEnvelope)
      │
      ▼
Agent loop  (src/core/agent.ts → runAgentLoop)    ← the ONLY model-turn caller
      │
      ▼
Provider  (resolved via ProviderService → Phase 04 ProviderGateway)
```

Key Phase 01–04 facts found:

- **Bounded health** already existed: `src/providers/health.ts`
  `checkProviderHealthCached` is bounded to `HEALTH_BOUND_MS = 2500ms`, cached
  (success 60s / failure 15s) and deduplicated. The daemon pre-flight
  (`AgentExecutor.preflight`) races primary → fallback each at 2500ms and only
  throws `ProviderOfflineError` (→ HTTP 503) if the **whole chain** is down.
- **Fallback chain** already existed (Phase 04): `src/providers/fallback-chain.ts`
  primary → configured fallbackProvider → best local healthy runtime, with
  `ProviderGateway.executeWithFallback` and bounded, policy-aware fallback.
- **Streaming adapter** already existed: `src/providers/openai-compat.ts`
  implements `chatStream()` yielding normalized `ProviderStreamChunk`, and
  `ProviderGateway.stream()`.
- **Error classification** already existed: `src/providers/errors.ts`
  `ProviderError` with `retryable`/`isRetryable`, `normalizeProviderError`,
  `isRetryableProviderError` (retryable: network/timeout/rate_limit/
  unavailable/overload; non-retryable: auth/invalid_request/model_unavailable/
  unsupported_capability/policy).
- **Cancellation** already reached the socket: `src/providers/request-guard.ts`
  `guardedRequest` composes the caller `AbortSignal` with a bounded timeout and
  distinguishes cancellation vs timeout (`ProviderAbortError`).

## 3. The remaining Phase 05 gaps (what was actually missing)

The real, remaining gaps were narrower than the brief assumed but real:

| Gap | Where |
| --- | --- |
| **The agent loop called `provider.chat()` (non-streaming)** even though a streaming `chatStream()` existed. | `src/core/agent.ts` model-turn call |
| **No structured token / tool_call / tool_result / status stream events** — the route only received `say()` observation lines (`{text}`). | loop → route |
| **`withTurnMetrics` dropped `chatStream`** — it wrapped `chat()` only, so the canonical path could never stream even after the adapter gained `chatStream()`. | `src/providers/stream-metrics.ts` |
| **No canonical stream event contract** shared by loop, fabric, route. | missing type |
| **No per-stream event ids / ordering guarantee** in the SSE framing. | route |
| **TTFT was not measured or exposed at the stream level.** | route / metrics |
| **Fallback was reachable via the gateway but not exercised by the loop's model-turn** (the loop used the single resolved provider). | loop |

## 4. Actual observed failure signature at Phase 04 (pre-Phase 05)

The original forensic 16.5s → 503 was already bounded by the Phase 01 health
gate: with both primary and fallback unhealthy, pre-flight takes at most
`2 × 2500ms = ~5s` (bounded), then returns a **fast 503** **before** the stream
opens. There was no longer an unbounded wait; but the user still received no
intermediate state (no `provider_selection`, no token events) and a failed run
gave a bare 503 rather than a streamed, truthful, fallback-aware narrative.

---

## 5. Files inspected for this audit

- `src/daemon/routes/chat.routes.ts`
- `src/daemon/agent-executor.ts`
- `src/services/agent-service.ts`
- `src/core/execution/envelope.ts`, `src/core/execution/runner.ts`
- `src/core/agent.ts`
- `src/core/types.ts`
- `src/providers/gateway.ts`, `health.ts`, `fallback-chain.ts`, `errors.ts`,
  `request-guard.ts`, `stream-metrics.ts`, `openai-compat.ts`
- `src/services/provider-service.ts`
- `src/daemon/dashboard/client-chat.ts` (SSE consumer)
- `src/daemon/routes/schemas.ts` / `contract.ts` (API contract)
- `test/one-agent/chat-route.test.ts`, `test/providers/*`

## 6. Conclusion

Phase 05's job in this repository was not to build a chat stream from scratch;
it was to close the four gaps above **on top of** the Phase 04 ProviderGateway,
without creating a second provider / execution / policy / tool system. That is
what the Phase 05 implementation (see `PHASE_05_CHAT_STREAMING.md`) did.
